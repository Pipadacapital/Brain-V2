/**
 * Product-COGS editor use-cases — list + per-product COGS update + bulk update.
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * Per-product COGS lives directly on `connector_product_facts.cost_mu` (BIGINT
 * minor units, e.g. paise). Shopify never sends COGS, so the field is
 * effectively user-owned: connector syncs leave it untouched. This module is
 * the canonical way for the UI to read/write it.
 *
 * RLS: every query runs inside withWorkspace(workspaceId, …) so the policy
 * `ws_isolation` evaluates `current_setting('app.workspace_id')` and the SQL
 * never touches another tenant's rows even if the bind values were wrong.
 *
 * Money: cost_mu is BIGINT (paise). The UI sends a major-unit decimal (e.g.
 * "12.50") which the gateway converts to paise (×100) before calling this.
 * Currency normalization (paise/halala/fils) happens at the gateway edge.
 *
 * Search: ILIKE on title — fast enough at < 5k SKUs per workspace; if the
 * count grows we add a trigram GIN index. status filter compares the connector
 * status string (ACTIVE/DRAFT/ARCHIVED).
 */

import type { PoolClient } from 'pg'
import { withWorkspace } from '../../infrastructure/db/workspace-context.js'

export type CogsFilter = 'all' | 'set' | 'not_set'
export type StatusFilter = 'all' | 'ACTIVE' | 'DRAFT' | 'ARCHIVED'

export interface ProductCogsRow {
  id: string
  vendor: string
  vendorProductId: string
  title: string
  handle: string
  imageUrl: string | null
  status: string
  productType: string | null
  inventoryQty: number | null
  costMu: bigint                                            // 0 when COGS not set
  mrpMu: bigint                                             // 0 when MRP not synced
  costSet: boolean                                          // cost_mu > 0
}

export interface ListResult {
  rows: ProductCogsRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ListOptions {
  search?: string
  status?: StatusFilter
  cogsFilter?: CogsFilter
  page?: number
  pageSize?: number
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export async function listProductsForCogs(
  workspaceId: string,
  opts: ListOptions = {},
): Promise<ListResult> {
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(10, opts.pageSize ?? DEFAULT_PAGE_SIZE))
  const offset = (page - 1) * pageSize
  const search = (opts.search ?? '').trim()
  const status = opts.status ?? 'all'
  const cogsFilter = opts.cogsFilter ?? 'all'

  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    // Building the WHERE clause; parameters keep us SQL-injection-safe even
    // though search is the only user string (ILIKE pattern uses positional binds).
    const where: string[] = []
    const args: unknown[] = []
    if (search) {
      args.push(`%${search}%`)
      where.push(`(title ILIKE $${args.length} OR handle ILIKE $${args.length})`)
    }
    if (status !== 'all') {
      args.push(status)
      where.push(`status = $${args.length}`)
    }
    if (cogsFilter === 'set')      where.push(`cost_mu > 0`)
    if (cogsFilter === 'not_set')  where.push(`(cost_mu = 0 OR cost_mu IS NULL)`)

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    // total count — bounded by the same WHERE.
    const cnt = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.connector_product_facts ${whereSql}`,
      args,
    )
    const total = Number(cnt.rows[0]?.n ?? '0')

    // page — title ASC for stable pagination (legacy parity).
    args.push(pageSize, offset)
    const rows = await tx.query<{
      id: string
      vendor: string
      vendor_product_id: string
      title: string | null
      handle: string | null
      image_url: string | null
      status: string | null
      product_type: string | null
      inventory_qty: number | null
      cost_mu: string
      mrp_mu: string
    }>(
      `SELECT id, vendor::text, vendor_product_id, title, handle, image_url,
              status, product_type, inventory_qty, cost_mu::text, mrp_mu::text
         FROM public.connector_product_facts
         ${whereSql}
         ORDER BY title NULLS LAST, vendor_product_id
         LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    )

    return {
      rows: rows.rows.map((r) => ({
        id: r.id,
        vendor: r.vendor,
        vendorProductId: r.vendor_product_id,
        title: r.title ?? '(untitled)',
        handle: r.handle ?? '',
        imageUrl: r.image_url,
        status: r.status ?? '',
        productType: r.product_type,
        inventoryQty: r.inventory_qty,
        costMu: BigInt(r.cost_mu ?? '0'),
        mrpMu: BigInt(r.mrp_mu ?? '0'),
        costSet: BigInt(r.cost_mu ?? '0') > 0n,
      })),
      total,
      page,
      pageSize,
      totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    }
  })
}

/**
 * Update one product's COGS. `costMu = 0n` clears it (legacy treats 0 as unset).
 * Returns the row count (1 on success; 0 if the product doesn't belong to this
 * workspace — RLS or PK miss).
 */
export async function updateProductCogs(
  workspaceId: string,
  productId: string,
  costMu: bigint,
): Promise<{ updated: boolean; costMu: bigint }> {
  if (costMu < 0n) throw new Error('cost_mu cannot be negative')
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{ cost_mu: string }>(
      `UPDATE public.connector_product_facts
          SET cost_mu = $2, synced_at = synced_at  -- don't change synced_at
        WHERE id = $1
       RETURNING cost_mu::text`,
      [productId, costMu.toString()],
    )
    const row = res.rows[0]
    return {
      updated: Boolean(row),
      costMu: BigInt(row?.cost_mu ?? '0'),
    }
  })
}

/**
 * Bulk-update COGS for many products in one transaction. Skips no-op rows
 * (same value), validates non-negative, returns counts. RLS ensures every
 * `id` is in the caller's workspace; mismatches just don't update.
 */
export async function bulkUpdateProductCogs(
  workspaceId: string,
  updates: Array<{ productId: string; costMu: bigint }>,
): Promise<{ attempted: number; updated: number }> {
  for (const u of updates) {
    if (u.costMu < 0n) throw new Error('cost_mu cannot be negative')
  }
  if (updates.length === 0) return { attempted: 0, updated: 0 }

  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    let updated = 0
    // UNNEST keeps the round-trip to one statement even for hundreds of rows.
    const ids = updates.map((u) => u.productId)
    const costs = updates.map((u) => u.costMu.toString())
    const res = await tx.query(
      `UPDATE public.connector_product_facts AS p
          SET cost_mu = u.cost_mu
         FROM (
           SELECT unnest($1::uuid[])   AS id,
                  unnest($2::bigint[]) AS cost_mu
         ) u
        WHERE p.id = u.id
          AND p.cost_mu IS DISTINCT FROM u.cost_mu`,
      [ids, costs],
    )
    updated = res.rowCount ?? 0
    return { attempted: updates.length, updated }
  })
}

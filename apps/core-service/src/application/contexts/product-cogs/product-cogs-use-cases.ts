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
import { withWorkspace } from '../../../infrastructure/db/workspace-context.js'
import { boundedOffset } from '../../shared/pagination.js'

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
  /**
   * COGS in paise (BIGINT minor units). NULL means the user has never set COGS
   * for this product ("unset"). A stored value of 0n means an explicit COGS of ₹0.
   * These must remain distinct: NULL is excluded from margin math; 0 is used as-is.
   */
  costMu: bigint | null                                     // null = unset; 0n = explicit ₹0
  mrpMu: bigint                                             // 0 when MRP not synced
  costSet: boolean                                          // cost_mu IS NOT NULL
}

export interface ListResult {
  rows: ProductCogsRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  // C10: true when the requested page is beyond MAX_OFFSET — rows are empty and
  // the caller should prompt the user to refine filters (deep-page guard).
  capped?: boolean
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
  const { offset, capped } = boundedOffset(page, pageSize)
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
    if (cogsFilter === 'set')      where.push(`cost_mu IS NOT NULL`)
    if (cogsFilter === 'not_set')  where.push(`cost_mu IS NULL`)

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    // total count — bounded by the same WHERE.
    const cnt = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.connector_product_facts ${whereSql}`,
      args,
    )
    const total = Number(cnt.rows[0]?.n ?? '0')

    // C10 deep-page guard: refuse pages past MAX_OFFSET — return an empty,
    // "refine your filters" page instead of running an O(n) deep-OFFSET scan.
    if (capped) {
      return {
        rows: [],
        total,
        page,
        pageSize,
        totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1,
        capped: true,
      }
    }

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
        // Preserve NULL: a null cost_mu means the user has never set COGS for
        // this product; do NOT coerce to 0 (that would corrupt margin math).
        costMu: r.cost_mu != null ? BigInt(r.cost_mu) : null,
        mrpMu: BigInt(r.mrp_mu ?? '0'),
        // costSet: null IS unset; 0n is an explicit "COGS = ₹0" (valid input).
        costSet: r.cost_mu != null,
      })),
      total,
      page,
      pageSize,
      totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    }
  })
}

/**
 * Update one product's COGS.
 *
 * - `costMu = null` → write NULL (unset / "not configured").
 * - `costMu = 0n`   → write 0 (explicit COGS of ₹0, valid for zero-margin products).
 * - `costMu > 0n`   → normal COGS in paise.
 *
 * Returns the row count (1 on success; 0 if the product doesn't belong to this
 * workspace — RLS or PK miss).
 */
export async function updateProductCogs(
  workspaceId: string,
  productId: string,
  costMu: bigint | null,
): Promise<{ updated: boolean; costMu: bigint | null }> {
  if (costMu != null && costMu < 0n) throw new Error('cost_mu cannot be negative')
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{ cost_mu: string | null }>(
      `UPDATE public.connector_product_facts
          SET cost_mu = $2, synced_at = synced_at  -- don't change synced_at
        WHERE id = $1
       RETURNING cost_mu::text`,
      [productId, costMu != null ? costMu.toString() : null],
    )
    const row = res.rows[0]
    return {
      updated: Boolean(row),
      costMu: row?.cost_mu != null ? BigInt(row.cost_mu) : null,
    }
  })
}

/**
 * Bulk-update COGS for many products in one transaction.
 *
 * Each entry accepts `costMu = null` (unset), `0n` (explicit ₹0), or a positive
 * paise value. Skips no-op rows (IS NOT DISTINCT FROM), validates non-negative,
 * returns counts. RLS ensures every `id` is in the caller's workspace.
 *
 * Because UNNEST with NULL bigint[] requires explicit casting, rows with NULL
 * are separated and written via individual UPDATE statements within the same
 * transaction to keep correctness simple.
 */
export async function bulkUpdateProductCogs(
  workspaceId: string,
  updates: Array<{ productId: string; costMu: bigint | null }>,
): Promise<{ attempted: number; updated: number }> {
  for (const u of updates) {
    if (u.costMu != null && u.costMu < 0n) throw new Error('cost_mu cannot be negative')
  }
  if (updates.length === 0) return { attempted: 0, updated: 0 }

  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    let updated = 0

    // Partition into NULL rows (clear COGS) and numeric rows.
    const nullRows = updates.filter((u) => u.costMu === null)
    const numericRows = updates.filter((u) => u.costMu !== null) as Array<{ productId: string; costMu: bigint }>

    // Numeric rows — UNNEST keeps the round-trip to one statement.
    if (numericRows.length > 0) {
      const ids = numericRows.map((u) => u.productId)
      const costs = numericRows.map((u) => (u.costMu as bigint).toString())
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
      updated += res.rowCount ?? 0
    }

    // NULL rows — clear COGS (unnest of nullable bigint[] is fragile; do it simply).
    for (const u of nullRows) {
      const res = await tx.query(
        `UPDATE public.connector_product_facts
            SET cost_mu = NULL
          WHERE id = $1
            AND cost_mu IS NOT NULL`,
        [u.productId],
      )
      updated += res.rowCount ?? 0
    }

    return { attempted: updates.length, updated }
  })
}

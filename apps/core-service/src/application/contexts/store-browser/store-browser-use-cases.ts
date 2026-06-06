/**
 * Store-browser use-cases — Orders / Products / Customers data tables
 * for the legacy /store page parity (Slice 4 of the parity epic).
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * All three lists are paginated, search-able, RLS-isolated via withWorkspace.
 * Money: BIGINT minor units, returned to the gateway as strings.
 *
 * PII posture (DPDP-aligned): customer_pii holds AES-GCM-encrypted email /
 * full_name / phone. The Customers list returns aggregates + `hasEmail` /
 * `hasName` booleans only; PII decryption is a separate, audited operation
 * (deferred). The legacy app stored these plaintext — we explicitly do NOT
 * regress to that.
 */

import type { PoolClient } from 'pg'
import { withWorkspace } from '../../../infrastructure/db/workspace-context.js'
import {
  decodeCursor,
  encodeCursor,
  keysetPredicate,
  type KeysetPage,
} from '../../shared/pagination.js'

// Keyset (seek) pagination: O(1) deep pages, no OFFSET cliff (conformance C10).
// Each list seeks forward from an opaque cursor; the web layer keeps a cursor
// stack for "Previous". `total` is the filtered count (drives "of N pages").

function clampSize(s?: number): number { return Math.min(100, Math.max(10, s ?? 20)) }

// ─────────────────────────────────────────────────────────────────────────────
// 1) Orders
// ─────────────────────────────────────────────────────────────────────────────
export interface StoreOrderRow {
  id: string
  vendor: string
  vendorOrderId: string
  orderNumber: string | null
  financialStatus: string
  fulfillmentStatus: string
  paymentMethod: string
  currencyCode: string
  totalMu: bigint                                 // gross - discount + tax + shipping
  customerRef: string                              // short hash; PII lives in customer_pii
  deliveryPincode: string | null
  deliveryCity: string | null
  isCod: boolean
  processedAt: string                              // ISO
  cancelledAt: string | null
}

export interface OrdersListOptions {
  search?: string                                  // matches order_number OR vendor_order_id
  status?: 'all' | 'paid' | 'pending' | 'refunded' | 'voided' | 'partially_refunded'
  cod?: 'all' | 'cod' | 'prepaid'
  cursor?: string                                  // keyset cursor (opaque); absent = first page
  pageSize?: number
}

export async function listOrders(
  workspaceId: string,
  opts: OrdersListOptions = {},
): Promise<KeysetPage<StoreOrderRow>> {
  const pageSize = clampSize(opts.pageSize)
  const cursor = decodeCursor(opts.cursor)
  const search = (opts.search ?? '').trim()
  const status = opts.status ?? 'all'
  const cod = opts.cod ?? 'all'

  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const where: string[] = []
    const args: unknown[] = []
    if (search) {
      args.push(`%${search}%`)
      where.push(`(order_number ILIKE $${args.length} OR vendor_order_id ILIKE $${args.length})`)
    }
    if (status !== 'all') {
      args.push(status)
      where.push(`financial_status = $${args.length}`)
    }
    if (cod === 'cod')      where.push(`is_cod = true`)
    if (cod === 'prepaid')  where.push(`is_cod = false`)

    // total = filtered count (cursor-independent), so the UI can show "of N pages".
    const cntWhere = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const cnt = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.connector_order_facts ${cntWhere}`,
      args,
    )
    const total = Number(cnt.rows[0]?.n ?? '0')

    // Seek predicate (appended after the filter binds) — ORDER BY processed_at
    // DESC NULLS LAST, id DESC. processed_at::text preserves full precision so
    // the cursor round-trips exactly (a Date would truncate to milliseconds).
    if (cursor) where.push(keysetPredicate('processed_at', 'DESC', cursor, args, { valueCast: '::timestamptz' }))
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    args.push(pageSize + 1)   // peek one extra row to decide nextCursor
    const rows = await tx.query<{
      id: string; vendor: string; vendor_order_id: string;
      order_number: string | null; financial_status: string | null;
      fulfillment_status: string | null; payment_method: string | null;
      currency_code: string | null;
      gross_sales_mu: string; total_discount_mu: string; total_tax_mu: string; shipping_mu: string;
      customer_ref: string | null;
      delivery_pincode: string | null; delivery_city: string | null;
      is_cod: boolean | null; processed_at: Date; cancelled_at: Date | null;
      _cursor_sort: string | null;
    }>(
      `SELECT id, vendor::text, vendor_order_id, order_number,
              financial_status, fulfillment_status, payment_method, currency_code,
              gross_sales_mu::text, total_discount_mu::text,
              total_tax_mu::text, shipping_mu::text,
              customer_ref, delivery_pincode, delivery_city,
              is_cod, processed_at, cancelled_at,
              processed_at::text AS _cursor_sort
         FROM public.connector_order_facts
         ${whereSql}
         ORDER BY processed_at DESC NULLS LAST, id DESC
         LIMIT $${args.length}`,
      args,
    )

    const hasNext = rows.rows.length > pageSize
    const pageRows = hasNext ? rows.rows.slice(0, pageSize) : rows.rows
    const last = pageRows[pageRows.length - 1]
    const nextCursor = hasNext && last ? encodeCursor({ v: last._cursor_sort, id: last.id }) : null

    return {
      rows: pageRows.map((r) => ({
        id: r.id,
        vendor: r.vendor,
        vendorOrderId: r.vendor_order_id,
        orderNumber: r.order_number,
        financialStatus: r.financial_status ?? '',
        fulfillmentStatus: r.fulfillment_status ?? '',
        paymentMethod: r.payment_method ?? '',
        currencyCode: r.currency_code ?? 'INR',
        // "Total" = gross + tax + shipping − discount (close to "what the customer paid").
        totalMu: BigInt(r.gross_sales_mu ?? '0') + BigInt(r.total_tax_mu ?? '0')
               + BigInt(r.shipping_mu ?? '0') - BigInt(r.total_discount_mu ?? '0'),
        customerRef: r.customer_ref ?? '',
        deliveryPincode: r.delivery_pincode,
        deliveryCity: r.delivery_city,
        isCod: Boolean(r.is_cod),
        processedAt: r.processed_at.toISOString(),
        cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
      })),
      total, pageSize, nextCursor,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Products (read-only browser; the COGS editor is its own page).
// ─────────────────────────────────────────────────────────────────────────────
export interface StoreProductRow {
  id: string
  vendor: string
  vendorProductId: string
  title: string
  handle: string
  imageUrl: string | null
  status: string
  productType: string | null
  inventoryQty: number | null
  costMu: bigint
  mrpMu: bigint
  syncedAt: string
}

export interface ProductsListOptions {
  search?: string
  status?: 'all' | 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
  cursor?: string
  pageSize?: number
}

export async function listStoreProducts(
  workspaceId: string,
  opts: ProductsListOptions = {},
): Promise<KeysetPage<StoreProductRow>> {
  const pageSize = clampSize(opts.pageSize)
  const cursor = decodeCursor(opts.cursor)
  const search = (opts.search ?? '').trim()
  const status = opts.status ?? 'all'

  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const where: string[] = []
    const args: unknown[] = []
    if (search) {
      args.push(`%${search}%`)
      where.push(`(title ILIKE $${args.length} OR handle ILIKE $${args.length} OR product_type ILIKE $${args.length})`)
    }
    if (status !== 'all') {
      args.push(status)
      where.push(`status = $${args.length}`)
    }

    const cntWhere = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const cnt = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.connector_product_facts ${cntWhere}`,
      args,
    )
    const total = Number(cnt.rows[0]?.n ?? '0')

    // ORDER BY title ASC NULLS LAST, id ASC. The id tiebreaker also fixes a
    // latent skip/dup bug: title is not unique, so the old title-only sort was
    // non-deterministic across pages.
    if (cursor) where.push(keysetPredicate('title', 'ASC', cursor, args))
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    args.push(pageSize + 1)
    const rows = await tx.query<{
      id: string; vendor: string; vendor_product_id: string;
      title: string | null; handle: string | null; image_url: string | null;
      status: string | null; product_type: string | null;
      inventory_qty: number | null; cost_mu: string; mrp_mu: string;
      synced_at: Date; _cursor_sort: string | null;
    }>(
      `SELECT id, vendor::text, vendor_product_id, title, handle, image_url,
              status, product_type, inventory_qty, cost_mu::text, mrp_mu::text, synced_at,
              title AS _cursor_sort
         FROM public.connector_product_facts
         ${whereSql}
         ORDER BY title ASC NULLS LAST, id ASC
         LIMIT $${args.length}`,
      args,
    )

    const hasNext = rows.rows.length > pageSize
    const pageRows = hasNext ? rows.rows.slice(0, pageSize) : rows.rows
    const last = pageRows[pageRows.length - 1]
    const nextCursor = hasNext && last ? encodeCursor({ v: last._cursor_sort, id: last.id }) : null

    return {
      rows: pageRows.map((r) => ({
        id: r.id, vendor: r.vendor, vendorProductId: r.vendor_product_id,
        title: r.title ?? '(untitled)', handle: r.handle ?? '', imageUrl: r.image_url,
        status: r.status ?? '', productType: r.product_type, inventoryQty: r.inventory_qty,
        costMu: BigInt(r.cost_mu ?? '0'), mrpMu: BigInt(r.mrp_mu ?? '0'),
        syncedAt: r.synced_at.toISOString(),
      })),
      total, pageSize, nextCursor,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) Customers — aggregate view; PII left encrypted.
// ─────────────────────────────────────────────────────────────────────────────
export interface StoreCustomerRow {
  id: string
  customerRef: string
  vendor: string
  vendorCustomerId: string
  ordersCount: number
  lifetimeSpentMu: bigint
  currencyCode: string
  firstSeenAt: string | null
  lastSeenAt: string | null
  consentStatus: string
  hasEmail: boolean
  hasName: boolean
  hasPhone: boolean
}

export interface CustomersListOptions {
  search?: string                                  // matches vendor_customer_id or customer_ref prefix
  minOrders?: number
  consent?: 'all' | 'opted_in' | 'opted_out' | 'unknown'
  cursor?: string
  pageSize?: number
}

export async function listStoreCustomers(
  workspaceId: string,
  opts: CustomersListOptions = {},
): Promise<KeysetPage<StoreCustomerRow>> {
  const pageSize = clampSize(opts.pageSize)
  const cursor = decodeCursor(opts.cursor)
  const search = (opts.search ?? '').trim()
  const minOrders = opts.minOrders ?? 0
  const consent = opts.consent ?? 'all'

  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const where: string[] = ['tombstoned_at IS NULL']
    const args: unknown[] = []
    if (search) {
      args.push(`%${search}%`)
      where.push(`(vendor_customer_id ILIKE $${args.length} OR customer_ref ILIKE $${args.length})`)
    }
    if (minOrders > 0) {
      args.push(minOrders)
      where.push(`orders_count >= $${args.length}`)
    }
    if (consent !== 'all') {
      args.push(consent)
      where.push(`consent_status = $${args.length}::customer_consent_status`)
    }

    const cnt = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.customer_pii WHERE ${where.join(' AND ')}`,
      args,
    )
    const total = Number(cnt.rows[0]?.n ?? '0')

    // ORDER BY last_seen_at DESC NULLS LAST, id DESC.
    if (cursor) where.push(keysetPredicate('last_seen_at', 'DESC', cursor, args, { valueCast: '::timestamptz' }))
    const whereSql = `WHERE ${where.join(' AND ')}`

    args.push(pageSize + 1)
    const rows = await tx.query<{
      id: string; customer_ref: string;
      source_vendor: string; vendor_customer_id: string;
      orders_count: number; lifetime_spent_mu: string; currency_code: string | null;
      first_seen_at: Date | null; last_seen_at: Date | null;
      consent_status: string;
      has_email: boolean; has_name: boolean; has_phone: boolean;
      _cursor_sort: string | null;
    }>(
      `SELECT id, customer_ref,
              source_vendor::text, vendor_customer_id,
              orders_count, lifetime_spent_mu::text, currency_code,
              first_seen_at, last_seen_at, consent_status::text,
              (email_ct IS NOT NULL)     AS has_email,
              (full_name_ct IS NOT NULL) AS has_name,
              (phone_ct IS NOT NULL)     AS has_phone,
              last_seen_at::text AS _cursor_sort
         FROM public.customer_pii
         ${whereSql}
         ORDER BY last_seen_at DESC NULLS LAST, id DESC
         LIMIT $${args.length}`,
      args,
    )

    const hasNext = rows.rows.length > pageSize
    const pageRows = hasNext ? rows.rows.slice(0, pageSize) : rows.rows
    const last = pageRows[pageRows.length - 1]
    const nextCursor = hasNext && last ? encodeCursor({ v: last._cursor_sort, id: last.id }) : null

    return {
      rows: pageRows.map((r) => ({
        id: r.id,
        customerRef: r.customer_ref,
        vendor: r.source_vendor,
        vendorCustomerId: r.vendor_customer_id,
        ordersCount: r.orders_count,
        lifetimeSpentMu: BigInt(r.lifetime_spent_mu ?? '0'),
        currencyCode: r.currency_code ?? 'INR',
        firstSeenAt: r.first_seen_at ? r.first_seen_at.toISOString() : null,
        lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
        consentStatus: r.consent_status,
        hasEmail: r.has_email,
        hasName: r.has_name,
        hasPhone: r.has_phone,
      })),
      total, pageSize, nextCursor,
    }
  })
}

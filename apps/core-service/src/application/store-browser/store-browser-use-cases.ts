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
import { withWorkspace } from '../../infrastructure/db/workspace-context.js'

// ── Common pagination shape ──────────────────────────────────────────────────
export interface Paged<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function clampPage(p?: number): number { return Math.max(1, p ?? 1) }
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
  page?: number
  pageSize?: number
}

export async function listOrders(
  workspaceId: string,
  opts: OrdersListOptions = {},
): Promise<Paged<StoreOrderRow>> {
  const page = clampPage(opts.page)
  const pageSize = clampSize(opts.pageSize)
  const offset = (page - 1) * pageSize
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
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const cnt = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.connector_order_facts ${whereSql}`,
      args,
    )
    const total = Number(cnt.rows[0]?.n ?? '0')

    args.push(pageSize, offset)
    const rows = await tx.query<{
      id: string; vendor: string; vendor_order_id: string;
      order_number: string | null; financial_status: string | null;
      fulfillment_status: string | null; payment_method: string | null;
      currency_code: string | null;
      gross_sales_mu: string; total_discount_mu: string; total_tax_mu: string; shipping_mu: string;
      customer_ref: string | null;
      delivery_pincode: string | null; delivery_city: string | null;
      is_cod: boolean | null; processed_at: Date; cancelled_at: Date | null;
    }>(
      `SELECT id, vendor::text, vendor_order_id, order_number,
              financial_status, fulfillment_status, payment_method, currency_code,
              gross_sales_mu::text, total_discount_mu::text,
              total_tax_mu::text, shipping_mu::text,
              customer_ref, delivery_pincode, delivery_city,
              is_cod, processed_at, cancelled_at
         FROM public.connector_order_facts
         ${whereSql}
         ORDER BY processed_at DESC NULLS LAST
         LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    )

    return {
      rows: rows.rows.map((r) => ({
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
      total, page, pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
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
  page?: number
  pageSize?: number
}

export async function listStoreProducts(
  workspaceId: string,
  opts: ProductsListOptions = {},
): Promise<Paged<StoreProductRow>> {
  const page = clampPage(opts.page)
  const pageSize = clampSize(opts.pageSize)
  const offset = (page - 1) * pageSize
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
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const cnt = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.connector_product_facts ${whereSql}`,
      args,
    )
    const total = Number(cnt.rows[0]?.n ?? '0')

    args.push(pageSize, offset)
    const rows = await tx.query<{
      id: string; vendor: string; vendor_product_id: string;
      title: string | null; handle: string | null; image_url: string | null;
      status: string | null; product_type: string | null;
      inventory_qty: number | null; cost_mu: string; mrp_mu: string;
      synced_at: Date;
    }>(
      `SELECT id, vendor::text, vendor_product_id, title, handle, image_url,
              status, product_type, inventory_qty, cost_mu::text, mrp_mu::text, synced_at
         FROM public.connector_product_facts
         ${whereSql}
         ORDER BY title NULLS LAST
         LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    )

    return {
      rows: rows.rows.map((r) => ({
        id: r.id, vendor: r.vendor, vendorProductId: r.vendor_product_id,
        title: r.title ?? '(untitled)', handle: r.handle ?? '', imageUrl: r.image_url,
        status: r.status ?? '', productType: r.product_type, inventoryQty: r.inventory_qty,
        costMu: BigInt(r.cost_mu ?? '0'), mrpMu: BigInt(r.mrp_mu ?? '0'),
        syncedAt: r.synced_at.toISOString(),
      })),
      total, page, pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
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
  page?: number
  pageSize?: number
}

export async function listStoreCustomers(
  workspaceId: string,
  opts: CustomersListOptions = {},
): Promise<Paged<StoreCustomerRow>> {
  const page = clampPage(opts.page)
  const pageSize = clampSize(opts.pageSize)
  const offset = (page - 1) * pageSize
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
    const whereSql = `WHERE ${where.join(' AND ')}`

    const cnt = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.customer_pii ${whereSql}`,
      args,
    )
    const total = Number(cnt.rows[0]?.n ?? '0')

    args.push(pageSize, offset)
    const rows = await tx.query<{
      id: string; customer_ref: string;
      source_vendor: string; vendor_customer_id: string;
      orders_count: number; lifetime_spent_mu: string; currency_code: string | null;
      first_seen_at: Date | null; last_seen_at: Date | null;
      consent_status: string;
      has_email: boolean; has_name: boolean; has_phone: boolean;
    }>(
      `SELECT id, customer_ref,
              source_vendor::text, vendor_customer_id,
              orders_count, lifetime_spent_mu::text, currency_code,
              first_seen_at, last_seen_at, consent_status::text,
              (email_ct IS NOT NULL)     AS has_email,
              (full_name_ct IS NOT NULL) AS has_name,
              (phone_ct IS NOT NULL)     AS has_phone
         FROM public.customer_pii
         ${whereSql}
         ORDER BY last_seen_at DESC NULLS LAST
         LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    )

    return {
      rows: rows.rows.map((r) => ({
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
      total, page, pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  })
}

/**
 * Fact analytics reader (Slice E) — reads the canonical connector facts for a
 * CONNECTED workspace and computes the analytics result shapes the BFF serves.
 *
 * @paradigm sql (deterministic SQL aggregation + integer math; NO ML, NO LLM)
 *
 * Every read goes through withWorkspace (FORCE RLS) — a context-less or cross-
 * workspace read returns 0 rows (persona P-003). The numbers are computed from the
 * ingested facts (persona P-001), and because every fact table is keyed on a UNIQUE
 * business key, a re-sync UPSERTs the same rows → these SUMs are unchanged on the
 * 2nd sync (persona P-002 proven at the aggregate layer).
 *
 * Revenue ladder (canon §6): Gross Sales → Net Sales (− discounts) → Net of Tax
 * (− tax, extracted per line item by SKU GST slab) → Net Revenue → Realized Revenue
 * (excludes cancelled/RTO). Money is BIGINT minor units throughout (no float).
 */

import type { PoolClient } from 'pg'
import { withWorkspace, withSuperadmin } from '../../../infrastructure/db/workspace-context.js'
import { readStoreSummaryCH } from './fact-analytics-ch.js'

// READ_FROM_CH=true routes specific read functions through brain.connector_*_facts
// in ClickHouse instead of the PG hot-mirror (v2 §6, function-by-function cutover).
// Default OFF so the rollout doesn't change behaviour. Per function we PG-fallback
// if the CH path throws (zero-regression rule from the Founder).
const READ_FROM_CH = process.env.READ_FROM_CH === 'true'

export interface FactStoreSummary {
  hasData: boolean
  currencyCode: string
  grossSalesMu: bigint
  totalDiscountMu: bigint
  netSalesMu: bigint
  totalTaxMu: bigint
  netNetTaxMu: bigint
  shippingRevenueMu: bigint
  netRevenueMu: bigint
  realizedRevenueMu: bigint
  orderCount: bigint
  aovMu: bigint | null
}

export interface FactPnl {
  hasData: boolean
  currencyCode: string
  netRevenueMu: bigint
  totalTaxMu: bigint
  totalAdSpendMu: bigint
  metaSpendMu: bigint
  googleSpendMu: bigint
  orderCount: bigint
}

export interface FactMarketing {
  hasData: boolean
  currencyCode: string
  netRevenueMu: bigint
  totalAdSpendMu: bigint
  metaSpendMu: bigint
  googleSpendMu: bigint
  newCustomerRevenueMu: bigint
  newCustomersCount: bigint
}

export interface FactIntegrationRow {
  connector: string
  status: string
  lastSyncAt: string | null
  lastSyncError: string | null
}

const VENDOR_LABEL: Record<string, string> = {
  SHOPIFY: 'Shopify',
  META: 'Meta Ads',
  GOOGLE: 'Google Ads',
  SHIPROCKET: 'Shiprocket',
}

const CANCELLED = "(cancelled_at IS NULL AND COALESCE(financial_status,'') NOT IN ('voided','refunded'))"

/**
 * Store summary + revenue ladder from connector_order_facts. Realized revenue
 * excludes cancelled/refunded orders (the honest billing base). Net of tax subtracts
 * the per-order tax (which the per-SKU line items roll up into total_tax_mu).
 */
export async function readStoreSummary(workspaceId: string): Promise<FactStoreSummary> {
  if (READ_FROM_CH) {
    // Flag-routed CH read with PG fallback (v2 §6, Founder no-regression rule).
    try { return await readStoreSummaryCH(workspaceId) } catch { /* fall through */ }
  }
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{
      currency_code: string | null
      gross: string | null
      discount: string | null
      tax: string | null
      shipping: string | null
      orders: string | null
      realized_gross: string | null
      realized_tax: string | null
      realized_discount: string | null
      realized_orders: string | null
    }>(
      `SELECT
         max(currency_code)                                   AS currency_code,
         COALESCE(sum(gross_sales_mu), 0)::text               AS gross,
         COALESCE(sum(total_discount_mu), 0)::text            AS discount,
         COALESCE(sum(total_tax_mu), 0)::text                 AS tax,
         COALESCE(sum(shipping_mu), 0)::text                  AS shipping,
         count(*)::text                                       AS orders,
         COALESCE(sum(gross_sales_mu) FILTER (WHERE ${CANCELLED}), 0)::text    AS realized_gross,
         COALESCE(sum(total_tax_mu) FILTER (WHERE ${CANCELLED}), 0)::text      AS realized_tax,
         COALESCE(sum(total_discount_mu) FILTER (WHERE ${CANCELLED}), 0)::text AS realized_discount,
         count(*) FILTER (WHERE ${CANCELLED})::text           AS realized_orders
       FROM connector_order_facts`,
    )
    const r = res.rows[0]
    const orders = BigInt(r?.orders ?? '0')
    const gross = BigInt(r?.gross ?? '0')
    const discount = BigInt(r?.discount ?? '0')
    const tax = BigInt(r?.tax ?? '0')
    const shipping = BigInt(r?.shipping ?? '0')
    const netSales = gross - discount
    const netNetTax = netSales - tax
    const netRevenue = netNetTax + shipping
    // Realized revenue: net-of-tax of NON-cancelled orders + their shipping share excluded
    // for simplicity (shipping is revenue-neutral); realized = gross − discount − tax for live orders.
    const realizedRevenue =
      BigInt(r?.realized_gross ?? '0') - BigInt(r?.realized_discount ?? '0') - BigInt(r?.realized_tax ?? '0')
    const realizedOrders = BigInt(r?.realized_orders ?? '0')
    const aov = realizedOrders > 0n ? realizedRevenue / realizedOrders : null
    return {
      hasData: orders > 0n,
      currencyCode: r?.currency_code ?? 'INR',
      grossSalesMu: gross,
      totalDiscountMu: discount,
      netSalesMu: netSales,
      totalTaxMu: tax,
      netNetTaxMu: netNetTax,
      shippingRevenueMu: shipping,
      netRevenueMu: netRevenue,
      realizedRevenueMu: realizedRevenue,
      orderCount: orders,
      aovMu: aov,
    }
  })
}

/** Ad spend split by vendor (Meta/Google) for the marketing surfaces. */
async function readAdSpend(tx: PoolClient): Promise<{ meta: bigint; google: bigint; currency: string }> {
  const res = await tx.query<{ vendor: string; spend: string | null; currency_code: string | null }>(
    `SELECT vendor, COALESCE(sum(spend_mu),0)::text AS spend, max(currency_code) AS currency_code
       FROM connector_ad_spend_facts GROUP BY vendor`,
  )
  let meta = 0n
  let google = 0n
  let currency = 'INR'
  for (const row of res.rows) {
    const v = BigInt(row.spend ?? '0')
    if (row.vendor === 'META') meta = v
    else if (row.vendor === 'GOOGLE') google = v
    if (row.currency_code) currency = row.currency_code
  }
  return { meta, google, currency }
}

export async function readPnl(workspaceId: string): Promise<FactPnl> {
  const store = await readStoreSummary(workspaceId)
  const spend = await withWorkspace(workspaceId, readAdSpend)
  return {
    hasData: store.hasData,
    currencyCode: store.currencyCode,
    netRevenueMu: store.realizedRevenueMu,
    totalTaxMu: store.totalTaxMu,
    totalAdSpendMu: spend.meta + spend.google,
    metaSpendMu: spend.meta,
    googleSpendMu: spend.google,
    orderCount: store.orderCount,
  }
}

/**
 * Connector connection state for the Integrations page — the REAL connected/synced
 * status from connector_connections (read under withWorkspace + RLS). Replaces the
 * Sugandh-Lok seed for a real workspace so the page reflects actual integrations.
 */
export async function readIntegrations(workspaceId: string): Promise<FactIntegrationRow[]> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{
      vendor: string
      status: string
      last_sync_at: Date | null
      last_sync_error: string | null
    }>(
      `SELECT vendor, status, last_sync_at, last_sync_error
         FROM connector_connections
        ORDER BY vendor`,
    )
    return res.rows.map((r) => ({
      connector: VENDOR_LABEL[r.vendor] ?? r.vendor,
      status: r.status,
      lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
      lastSyncError: r.last_sync_error ?? null,
    }))
  })
}

export async function readMarketing(workspaceId: string): Promise<FactMarketing> {
  const store = await readStoreSummary(workspaceId)
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const spend = await readAdSpend(tx)
    // New-customer revenue: orders whose customer_ref is first-seen (proxy for aMER).
    const ncRes = await tx.query<{ nc_rev: string | null; nc_count: string | null }>(
      `WITH ranked AS (
         SELECT customer_ref,
                (gross_sales_mu - total_discount_mu - total_tax_mu) AS net_mu,
                row_number() OVER (PARTITION BY customer_ref ORDER BY processed_at NULLS LAST) AS rn
           FROM connector_order_facts
          WHERE customer_ref IS NOT NULL AND ${CANCELLED}
       )
       SELECT COALESCE(sum(net_mu) FILTER (WHERE rn = 1),0)::text AS nc_rev,
              count(*) FILTER (WHERE rn = 1)::text                AS nc_count
         FROM ranked`,
    )
    const nc = ncRes.rows[0]
    return {
      hasData: store.hasData,
      currencyCode: store.currencyCode,
      netRevenueMu: store.realizedRevenueMu,
      totalAdSpendMu: spend.meta + spend.google,
      metaSpendMu: spend.meta,
      googleSpendMu: spend.google,
      newCustomerRevenueMu: BigInt(nc?.nc_rev ?? '0'),
      newCustomersCount: BigInt(nc?.nc_count ?? '0'),
    }
  })
}

// ---------------------------------------------------------------------------
// COGS — per-line cost = quantity × product.cost_mu, joined line→product. Only
// lines whose product has a cost contribute; coverage is reported so the caller
// can flag the report "estimated" below the data-quality bar (≥80% coverage).
// ---------------------------------------------------------------------------
export interface FactCogs {
  cogsMu: bigint
  coveredLines: bigint
  totalLines: bigint
}
export async function readCogs(workspaceId: string): Promise<FactCogs> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{ cogs: string | null; covered: string | null; total: string | null }>(
      `SELECT
         COALESCE(sum(li.quantity * pf.cost_mu) FILTER (WHERE pf.cost_mu IS NOT NULL), 0)::text AS cogs,
         count(*) FILTER (WHERE pf.cost_mu IS NOT NULL)::text AS covered,
         count(*)::text AS total
       FROM connector_line_item_facts li
       LEFT JOIN connector_product_facts pf
         ON pf.workspace_id = li.workspace_id AND pf.vendor_product_id = li.vendor_product_id`,
    )
    const r = res.rows[0]
    return {
      cogsMu: BigInt(r?.cogs ?? '0'),
      coveredLines: BigInt(r?.covered ?? '0'),
      totalLines: BigInt(r?.total ?? '0'),
    }
  })
}

// ---------------------------------------------------------------------------
// Product performance — per-product CM1 (revenue − COGS), units sold, orders,
// AOV, and a Pareto grade (A ≤80% cumulative CM1, B ≤95%, C rest, F if CM1≤0).
// ---------------------------------------------------------------------------
export interface FactProductRow {
  label: string
  paretoGrade: 'A' | 'B' | 'C' | 'F'
  cm1Mu: bigint
  revenueMu: bigint
  soldQty: bigint
  orders: bigint
  aovMu: bigint | null
}
export async function readProductPerformance(
  workspaceId: string,
): Promise<{ rows: FactProductRow[]; totalCm1Mu: bigint }> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{
      label: string | null
      grade: 'A' | 'B' | 'C' | 'F'
      cm1_mu: string
      revenue_mu: string
      sold: string
      orders: string
      total_cm1: string
    }>(
      `WITH per AS (
         SELECT li.vendor_product_id AS pid,
                max(COALESCE(pf.title, li.title)) AS label,
                COALESCE(sum(li.quantity * li.unit_price_mu), 0) AS revenue_mu,
                COALESCE(sum(li.quantity * COALESCE(pf.cost_mu, 0)), 0) AS cogs_mu,
                COALESCE(sum(li.quantity), 0) AS sold,
                count(DISTINCT li.vendor_order_id) AS orders
           FROM connector_line_item_facts li
           LEFT JOIN connector_product_facts pf
             ON pf.workspace_id = li.workspace_id AND pf.vendor_product_id = li.vendor_product_id
          WHERE li.vendor_product_id IS NOT NULL
          GROUP BY li.vendor_product_id
       ),
       ranked AS (
         SELECT *, (revenue_mu - cogs_mu) AS cm1_mu,
                SUM(revenue_mu - cogs_mu) OVER () AS total_cm1,
                SUM(revenue_mu - cogs_mu) OVER (ORDER BY (revenue_mu - cogs_mu) DESC, pid) AS cum_cm1
           FROM per
       )
       SELECT label, revenue_mu::text, cm1_mu::text, sold::text, orders::text, total_cm1::text,
         CASE WHEN cm1_mu <= 0 THEN 'F'
              WHEN total_cm1 > 0 AND cum_cm1 <= 0.80 * total_cm1 THEN 'A'
              WHEN total_cm1 > 0 AND cum_cm1 <= 0.95 * total_cm1 THEN 'B'
              ELSE 'C' END AS grade
       FROM ranked ORDER BY cm1_mu DESC LIMIT 200`,
    )
    const rows: FactProductRow[] = res.rows.map((r) => {
      const orders = BigInt(r.orders ?? '0')
      const revenue = BigInt(r.revenue_mu ?? '0')
      return {
        label: r.label ?? '(unknown)',
        paretoGrade: r.grade,
        cm1Mu: BigInt(r.cm1_mu ?? '0'),
        revenueMu: revenue,
        soldQty: BigInt(r.sold ?? '0'),
        orders,
        aovMu: orders > 0n ? revenue / orders : null,
      }
    })
    const totalCm1Mu = res.rows.length ? BigInt(res.rows[0].total_cm1 ?? '0') : 0n
    return { rows, totalCm1Mu }
  })
}

// ---------------------------------------------------------------------------
// Workspace members — real members + roles. users is superadmin-only RLS, so the
// read runs under withSuperadmin, scoped strictly to this workspace_id.
// ---------------------------------------------------------------------------
export interface FactMemberRow {
  userId: string
  fullName: string
  email: string
  role: string
  joinedAt: string
}
export async function readWorkspaceMembers(
  workspaceId: string,
): Promise<{ members: FactMemberRow[]; pendingInvitations: number }> {
  return withSuperadmin(async (tx: PoolClient) => {
    const m = await tx.query<{
      user_id: string
      full_name: string | null
      email: string
      role: string
      joined_at: Date | null
    }>(
      `SELECT wm.user_id, u.full_name, u.email, wm.role, wm.joined_at
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = $1
        ORDER BY wm.joined_at`,
      [workspaceId],
    )
    const inv = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM invitations WHERE workspace_id = $1`,
      [workspaceId],
    )
    return {
      members: m.rows.map((r) => ({
        userId: r.user_id,
        fullName: r.full_name ?? '',
        email: r.email,
        role: r.role,
        joinedAt: r.joined_at ? new Date(r.joined_at).toISOString() : '',
      })),
      pendingInvitations: Number(inv.rows[0]?.c ?? 0),
    }
  })
}

// ---------------------------------------------------------------------------
// Workspace settings — the real workspace row (readable under withWorkspace via
// ws_self_isolation). The local-dev schema doesn't store plan/timezone/region, so
// those are honest India defaults (NOT a Sugandh seed).
// ---------------------------------------------------------------------------
export interface FactWorkspaceSettings {
  name: string
  slug: string
  createdAt: string
}
export async function readWorkspaceSettings(workspaceId: string): Promise<FactWorkspaceSettings | null> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{ name: string; slug: string; created_at: Date | null }>(
      `SELECT name, slug, created_at FROM workspaces WHERE id = $1`,
      [workspaceId],
    )
    const r = res.rows[0]
    if (!r) return null
    return {
      name: r.name,
      slug: r.slug,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    }
  })
}

// ---------------------------------------------------------------------------
// Shipment analytics (Shiprocket facts) — feeds RTO + Logistics surfaces.
// status_bucket ∈ DELIVERED|RTO|CANCELLED|UNDELIVERED|IN_TRANSIT.
// ---------------------------------------------------------------------------
export interface FactCourierRow {
  courierName: string
  count: bigint
  deliveredCount: bigint
  rtoCount: bigint
  chargesMu: bigint
}
export interface FactShipmentAnalytics {
  totalShipments: bigint
  deliveredCount: bigint
  rtoCount: bigint
  codCount: bigint
  prepaidCount: bigint
  totalChargesMu: bigint
  rtoChargesMu: bigint
  codRtoCount: bigint
  codTotal: bigint
  prepaidRtoCount: bigint
  prepaidTotal: bigint
  byCourier: FactCourierRow[]
}
export async function readShipmentAnalytics(workspaceId: string): Promise<FactShipmentAnalytics> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const a = await tx.query<Record<string, string>>(
      `SELECT
         count(*)::text total,
         count(*) FILTER (WHERE status_bucket='DELIVERED')::text delivered,
         count(*) FILTER (WHERE status_bucket='RTO')::text rto,
         count(*) FILTER (WHERE is_cod)::text cod,
         count(*) FILTER (WHERE NOT is_cod)::text prepaid,
         COALESCE(sum(shipping_charges_mu),0)::text charges,
         COALESCE(sum(shipping_charges_mu) FILTER (WHERE status_bucket='RTO'),0)::text rto_charges,
         count(*) FILTER (WHERE is_cod AND status_bucket='RTO')::text cod_rto,
         count(*) FILTER (WHERE is_cod)::text cod_total,
         count(*) FILTER (WHERE NOT is_cod AND status_bucket='RTO')::text prepaid_rto,
         count(*) FILTER (WHERE NOT is_cod)::text prepaid_total
       FROM connector_shipment_facts`,
    )
    const c = await tx.query<Record<string, string>>(
      `SELECT COALESCE(NULLIF(courier_name,''),'Unknown') courier,
              count(*)::text cnt,
              count(*) FILTER (WHERE status_bucket='DELIVERED')::text delivered,
              count(*) FILTER (WHERE status_bucket='RTO')::text rto,
              COALESCE(sum(shipping_charges_mu),0)::text charges
         FROM connector_shipment_facts
        GROUP BY courier ORDER BY count(*) DESC LIMIT 50`,
    )
    const r = a.rows[0] ?? {}
    return {
      totalShipments: BigInt(r.total ?? '0'),
      deliveredCount: BigInt(r.delivered ?? '0'),
      rtoCount: BigInt(r.rto ?? '0'),
      codCount: BigInt(r.cod ?? '0'),
      prepaidCount: BigInt(r.prepaid ?? '0'),
      totalChargesMu: BigInt(r.charges ?? '0'),
      rtoChargesMu: BigInt(r.rto_charges ?? '0'),
      codRtoCount: BigInt(r.cod_rto ?? '0'),
      codTotal: BigInt(r.cod_total ?? '0'),
      prepaidRtoCount: BigInt(r.prepaid_rto ?? '0'),
      prepaidTotal: BigInt(r.prepaid_total ?? '0'),
      byCourier: c.rows.map((x) => ({
        courierName: x.courier ?? 'Unknown',
        count: BigInt(x.cnt ?? '0'),
        deliveredCount: BigInt(x.delivered ?? '0'),
        rtoCount: BigInt(x.rto ?? '0'),
        chargesMu: BigInt(x.charges ?? '0'),
      })),
    }
  })
}

// Pincode-level shipment reliability (Shiprocket facts).
export interface FactPincodeRow {
  pincode: string
  city: string
  shipmentCount: bigint
  rtoCount: bigint
  deliveredCount: bigint
  codCount: bigint
}
export async function readPincodes(workspaceId: string): Promise<FactPincodeRow[]> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<Record<string, string>>(
      `SELECT delivery_pincode pincode,
              max(COALESCE(delivery_city,'')) city,
              count(*)::text cnt,
              count(*) FILTER (WHERE status_bucket='RTO')::text rto,
              count(*) FILTER (WHERE status_bucket='DELIVERED')::text delivered,
              count(*) FILTER (WHERE is_cod)::text cod
         FROM connector_shipment_facts
        WHERE delivery_pincode IS NOT NULL AND delivery_pincode <> ''
        GROUP BY delivery_pincode ORDER BY count(*) DESC LIMIT 200`,
    )
    return res.rows.map((x) => ({
      pincode: x.pincode,
      city: x.city ?? '',
      shipmentCount: BigInt(x.cnt ?? '0'),
      rtoCount: BigInt(x.rto ?? '0'),
      deliveredCount: BigInt(x.delivered ?? '0'),
      codCount: BigInt(x.cod ?? '0'),
    }))
  })
}

// COD vs Prepaid — order counts + revenue from order facts (payment_method).
export interface FactCodPrepaid {
  codOrders: bigint
  prepaidOrders: bigint
  codGrossMu: bigint
  prepaidGrossMu: bigint
  aovMu: bigint | null
}
export async function readCodPrepaid(workspaceId: string): Promise<FactCodPrepaid> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<Record<string, string>>(
      `SELECT
         count(*) FILTER (WHERE payment_method='COD')::text cod_orders,
         count(*) FILTER (WHERE payment_method='Prepaid')::text prepaid_orders,
         COALESCE(sum(gross_sales_mu) FILTER (WHERE payment_method='COD'),0)::text cod_gross,
         COALESCE(sum(gross_sales_mu) FILTER (WHERE payment_method='Prepaid'),0)::text prepaid_gross,
         COALESCE(sum(gross_sales_mu - total_discount_mu - total_tax_mu),0)::text net,
         count(*)::text orders
       FROM connector_order_facts WHERE ${CANCELLED}`,
    )
    const r = res.rows[0] ?? {}
    const orders = BigInt(r.orders ?? '0')
    const net = BigInt(r.net ?? '0')
    return {
      codOrders: BigInt(r.cod_orders ?? '0'),
      prepaidOrders: BigInt(r.prepaid_orders ?? '0'),
      codGrossMu: BigInt(r.cod_gross ?? '0'),
      prepaidGrossMu: BigInt(r.prepaid_gross ?? '0'),
      aovMu: orders > 0n ? net / orders : null,
    }
  })
}

// ---------------------------------------------------------------------------
// Cohorts — acquisition-month cohorts from order history. m[] is cumulative net
// revenue (gross−discount−tax) by month-offset 0..11 from the cohort month; rr90 is
// the share of the cohort that re-ordered within 90 days. CAC/payback are null (ad
// spend is not cohort-attributed in the connector facts — honest).
// ---------------------------------------------------------------------------
const NET_EXPR = '(gross_sales_mu - total_discount_mu - total_tax_mu)'
const MONTH_OFFSET =
  "LEAST(11, GREATEST(0, (date_part('year', age(o.processed_at, fo.cohort_dt))*12 + date_part('month', age(o.processed_at, fo.cohort_dt)))::int))"

export interface FactCohortRow {
  cohortMonth: string
  newCustomers: bigint
  rr90Bp: number | null
  m: bigint[] // length 12, cumulative net revenue (minor units)
}
export async function readCohorts(workspaceId: string): Promise<FactCohortRow[]> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    // Set-based (no correlated subquery): one window pass to find each customer's
    // acquisition + 2nd-order date, then a 90-day-repeat flag. Uses the
    // (workspace_id, customer_ref, processed_at) index.
    const sizes = await tx.query<{ cohort: string; new_customers: string; rr90: string }>(
      `WITH ranked AS (
         SELECT customer_ref, processed_at,
                row_number() OVER (PARTITION BY customer_ref ORDER BY processed_at, vendor_order_id) rn,
                min(processed_at) OVER (PARTITION BY customer_ref) acq
           FROM connector_order_facts
          WHERE customer_ref IS NOT NULL AND ${CANCELLED}
       ),
       cust AS (
         SELECT customer_ref,
                max(acq) acq,
                to_char(date_trunc('month', max(acq)), 'YYYY-MM') cohort,
                min(processed_at) FILTER (WHERE rn = 2) second_at
           FROM ranked GROUP BY customer_ref
       )
       SELECT cohort,
              count(*)::text new_customers,
              count(*) FILTER (WHERE second_at IS NOT NULL AND second_at <= acq + interval '90 days')::text rr90
         FROM cust GROUP BY cohort ORDER BY cohort`,
    )
    const rev = await tx.query<{ cohort: string; off: string; net: string }>(
      `WITH fo AS (
         SELECT customer_ref, date_trunc('month', min(processed_at)) cohort_dt
           FROM connector_order_facts
          WHERE customer_ref IS NOT NULL AND ${CANCELLED}
          GROUP BY customer_ref
       )
       SELECT to_char(fo.cohort_dt, 'YYYY-MM') cohort,
              ${MONTH_OFFSET} off,
              sum(${NET_EXPR})::text net
         FROM connector_order_facts o
         JOIN fo ON fo.customer_ref = o.customer_ref
        WHERE o.customer_ref IS NOT NULL AND ${CANCELLED}
        GROUP BY 1, 2`,
    )
    // pivot revenue into per-cohort 12-month cumulative arrays
    const byCohort = new Map<string, bigint[]>()
    for (const row of rev.rows) {
      const arr = byCohort.get(row.cohort) ?? new Array<bigint>(12).fill(0n)
      const off = Math.max(0, Math.min(11, Number(row.off)))
      arr[off] += BigInt(row.net ?? '0')
      byCohort.set(row.cohort, arr)
    }
    return sizes.rows.map((s) => {
      const per = byCohort.get(s.cohort) ?? new Array<bigint>(12).fill(0n)
      const cum: bigint[] = []
      let running = 0n
      for (let i = 0; i < 12; i++) {
        running += per[i]
        cum.push(running)
      }
      const newCustomers = BigInt(s.new_customers ?? '0')
      const rr90 = BigInt(s.rr90 ?? '0')
      return {
        cohortMonth: s.cohort,
        newCustomers,
        rr90Bp: newCustomers > 0n ? Number((rr90 * 10000n) / newCustomers) : null,
        m: cum,
      }
    })
  })
}

// ---------------------------------------------------------------------------
// LTV — average cumulative net revenue per acquired customer at M0/M1/M3/M6/M12.
// rows are per acquisition-month cohort (per-customer cumulative trajectory).
// ---------------------------------------------------------------------------
export interface FactLtv {
  newCustomers: bigint
  firstOrderMu: bigint // avg first-order net per customer
  month1Mu: bigint
  month3Mu: bigint
  month6Mu: bigint
  month12Mu: bigint
  rows: { cohortMonth: string; newCustomers: bigint; firstOrderMu: bigint; m: bigint[] }[]
}
export async function readLtv(workspaceId: string): Promise<FactLtv> {
  const cohorts = await readCohorts(workspaceId)
  let totalCustomers = 0n
  let sumFirst = 0n
  let sumM1 = 0n
  let sumM3 = 0n
  let sumM6 = 0n
  let sumM12 = 0n
  const rows = cohorts.map((c) => {
    totalCustomers += c.newCustomers
    sumFirst += c.m[0] ?? 0n
    sumM1 += c.m[1] ?? 0n
    sumM3 += c.m[3] ?? 0n
    sumM6 += c.m[6] ?? 0n
    sumM12 += c.m[11] ?? 0n
    const per = c.newCustomers > 0n ? c.m.map((v) => v / c.newCustomers) : c.m
    return {
      cohortMonth: c.cohortMonth,
      newCustomers: c.newCustomers,
      firstOrderMu: c.newCustomers > 0n ? (c.m[0] ?? 0n) / c.newCustomers : 0n,
      m: per,
    }
  })
  const avg = (x: bigint) => (totalCustomers > 0n ? x / totalCustomers : 0n)
  return {
    newCustomers: totalCustomers,
    firstOrderMu: avg(sumFirst),
    month1Mu: avg(sumM1),
    month3Mu: avg(sumM3),
    month6Mu: avg(sumM6),
    month12Mu: avg(sumM12),
    rows,
  }
}

// ---------------------------------------------------------------------------
// Lifecycle states — recency segmentation by days since last order (fixed
// India-DTC fallback thresholds: new ≤30, active ≤90, at_risk ≤180, churned >180).
// ---------------------------------------------------------------------------
export interface FactLifecycleBucket { bucket: string; customerCount: bigint; revenueMu: bigint; orderCount: bigint }
export interface FactLifecycle { buckets: FactLifecycleBucket[]; totalCustomers: bigint; netActive: bigint }
export async function readLifecycleStates(workspaceId: string): Promise<FactLifecycle> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<Record<string, string>>(
      `WITH cust AS (
         SELECT customer_ref, max(processed_at) last_at, count(*) orders,
                sum(${NET_EXPR}) net
           FROM connector_order_facts
          WHERE customer_ref IS NOT NULL AND ${CANCELLED}
          GROUP BY customer_ref
       ), nowref AS (SELECT max(last_at) n FROM cust),
       b AS (
         SELECT CASE
                  WHEN (nowref.n - last_at) <= interval '30 days' THEN 'new'
                  WHEN (nowref.n - last_at) <= interval '90 days' THEN 'active'
                  WHEN (nowref.n - last_at) <= interval '180 days' THEN 'at_risk'
                  ELSE 'churned' END bucket,
                orders, net
           FROM cust, nowref
       )
       SELECT bucket, count(*)::text cnt, COALESCE(sum(net),0)::text rev, COALESCE(sum(orders),0)::text ord
         FROM b GROUP BY bucket`,
    )
    const byBucket = new Map(res.rows.map((r) => [r.bucket, r]))
    const names = ['new', 'active', 'at_risk', 'churned']
    const buckets = names.map((name) => {
      const r = byBucket.get(name)
      return {
        bucket: name,
        customerCount: BigInt(r?.cnt ?? '0'),
        revenueMu: BigInt(r?.rev ?? '0'),
        orderCount: BigInt(r?.ord ?? '0'),
      }
    })
    const total = buckets.reduce((a, b) => a + b.customerCount, 0n)
    const netActive = buckets[0].customerCount + buckets[1].customerCount
    return { buckets, totalCustomers: total, netActive }
  })
}

// Order timings — sequence rates (2nd/3rd/4th) + median days between orders.
export interface FactOrderTimings {
  firstOrders: bigint
  secondBp: number
  thirdBp: number
  fourthBp: number
  days12: number | null
  days23: number | null
  days34: number | null
}
export async function readOrderTimings(workspaceId: string): Promise<FactOrderTimings> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<Record<string, string>>(
      `WITH ranked AS (
         SELECT customer_ref, processed_at,
                row_number() OVER (PARTITION BY customer_ref ORDER BY processed_at, vendor_order_id) rn,
                processed_at - lag(processed_at) OVER (PARTITION BY customer_ref ORDER BY processed_at, vendor_order_id) gap
           FROM connector_order_facts
          WHERE customer_ref IS NOT NULL AND ${CANCELLED}
       )
       SELECT
         count(DISTINCT customer_ref) FILTER (WHERE rn = 1)::text first_orders,
         count(DISTINCT customer_ref) FILTER (WHERE rn >= 2)::text c2,
         count(DISTINCT customer_ref) FILTER (WHERE rn >= 3)::text c3,
         count(DISTINCT customer_ref) FILTER (WHERE rn >= 4)::text c4,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM gap)/86400) FILTER (WHERE rn = 2)::text d12,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM gap)/86400) FILTER (WHERE rn = 3)::text d23,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM gap)/86400) FILTER (WHERE rn = 4)::text d34
       FROM ranked`,
    )
    const r = res.rows[0] ?? {}
    const first = BigInt(r.first_orders ?? '0')
    const rate = (c: string | undefined) => (first > 0n ? Number((BigInt(c ?? '0') * 10000n) / first) : 0)
    const num = (x: string | undefined) => (x === null || x === undefined ? null : Math.round(Number(x)))
    return {
      firstOrders: first,
      secondBp: rate(r.c2),
      thirdBp: rate(r.c3),
      fourthBp: rate(r.c4),
      days12: num(r.d12),
      days23: num(r.d23),
      days34: num(r.d34),
    }
  })
}

// First-product cascade — the product of each customer's FIRST order → repeat behaviour.
export interface FactCascadeRow {
  productKey: string
  productTitle: string
  firstOrderCustomers: bigint
  with2nd: bigint
  with3rd: bigint
  with4thPlus: bigint
  avgLtvMu: bigint
}
export async function readFirstProductCascade(workspaceId: string): Promise<{ rows: FactCascadeRow[]; totalCohort: bigint }> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<Record<string, string>>(
      `WITH first_order AS (
         SELECT DISTINCT ON (customer_ref) customer_ref, vendor_order_id
           FROM connector_order_facts
          WHERE customer_ref IS NOT NULL AND ${CANCELLED}
          ORDER BY customer_ref, processed_at, vendor_order_id
       ),
       first_prod AS (
         SELECT DISTINCT ON (fo.customer_ref) fo.customer_ref,
                li.vendor_product_id pid, COALESCE(pf.title, li.title) title
           FROM first_order fo
           JOIN connector_line_item_facts li ON li.vendor = 'SHOPIFY' AND li.vendor_order_id = fo.vendor_order_id
           LEFT JOIN connector_product_facts pf ON pf.vendor_product_id = li.vendor_product_id
          WHERE li.vendor_product_id IS NOT NULL
          ORDER BY fo.customer_ref, li.vendor_line_id
       ),
       cust AS (
         SELECT customer_ref, count(*) orders, sum(${NET_EXPR}) ltv
           FROM connector_order_facts
          WHERE customer_ref IS NOT NULL AND ${CANCELLED}
          GROUP BY customer_ref
       )
       SELECT fp.pid,
              max(fp.title) title,
              count(*)::text first_customers,
              count(*) FILTER (WHERE c.orders >= 2)::text w2,
              count(*) FILTER (WHERE c.orders >= 3)::text w3,
              count(*) FILTER (WHERE c.orders >= 4)::text w4,
              COALESCE(avg(c.ltv),0)::bigint::text avg_ltv
         FROM first_prod fp JOIN cust c ON c.customer_ref = fp.customer_ref
        GROUP BY fp.pid ORDER BY count(*) DESC LIMIT 100`,
    )
    const rows = res.rows.map((r) => ({
      productKey: r.pid,
      productTitle: r.title ?? '(unknown)',
      firstOrderCustomers: BigInt(r.first_customers ?? '0'),
      with2nd: BigInt(r.w2 ?? '0'),
      with3rd: BigInt(r.w3 ?? '0'),
      with4thPlus: BigInt(r.w4 ?? '0'),
      avgLtvMu: BigInt(r.avg_ltv ?? '0'),
    }))
    const totalCohort = rows.reduce((a, r) => a + r.firstOrderCustomers, 0n)
    return { rows, totalCohort }
  })
}

// Distributions — per-product per-order value: mode vs mean (line value = qty × unit price).
export interface FactDistRow { product: string; orders: bigint; modeMu: bigint; meanMu: bigint }
export async function readDistributions(workspaceId: string): Promise<{ rows: FactDistRow[]; globalMode: bigint; globalMean: bigint }> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<Record<string, string>>(
      `SELECT COALESCE(max(pf.title), li.title, '(unknown)') product,
              count(*)::text orders,
              COALESCE(mode() WITHIN GROUP (ORDER BY li.quantity * li.unit_price_mu),0)::text mode_mu,
              COALESCE(avg(li.quantity * li.unit_price_mu),0)::bigint::text mean_mu
         FROM connector_line_item_facts li
         LEFT JOIN connector_product_facts pf ON pf.vendor_product_id = li.vendor_product_id
        WHERE li.vendor_product_id IS NOT NULL
        GROUP BY li.vendor_product_id, li.title ORDER BY count(*) DESC LIMIT 100`,
    )
    const g = await tx.query<Record<string, string>>(
      `SELECT COALESCE(mode() WITHIN GROUP (ORDER BY quantity * unit_price_mu),0)::text mode_mu,
              COALESCE(avg(quantity * unit_price_mu),0)::bigint::text mean_mu
         FROM connector_line_item_facts`,
    )
    return {
      rows: res.rows.map((r) => ({
        product: r.product ?? '(unknown)',
        orders: BigInt(r.orders ?? '0'),
        modeMu: BigInt(r.mode_mu ?? '0'),
        meanMu: BigInt(r.mean_mu ?? '0'),
      })),
      globalMode: BigInt(g.rows[0]?.mode_mu ?? '0'),
      globalMean: BigInt(g.rows[0]?.mean_mu ?? '0'),
    }
  })
}

// ---------------------------------------------------------------------------
// Daily net-sales series — feeds the AreaChart on the analytics page.
// Groups connector_order_facts by day; returns (date, net_sales_mu, orders).
// Only non-cancelled rows. net_sales = gross − discount (no tax deduction here;
// matches legacy analytics "netSales" which is pre-tax net).
// ---------------------------------------------------------------------------
export interface FactDailySalesRow {
  date: string        // 'YYYY-MM-DD'
  netSalesMu: bigint
  orders: bigint
}
export async function readDailyNetSales(
  workspaceId: string,
  from: string,
  to: string,
): Promise<FactDailySalesRow[]> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{ day: string; net: string; orders: string }>(
      `SELECT to_char(date_trunc('day', processed_at), 'YYYY-MM-DD') AS day,
              COALESCE(sum(gross_sales_mu - total_discount_mu), 0)::text AS net,
              count(*)::text AS orders
         FROM connector_order_facts
        WHERE ${CANCELLED}
          AND processed_at >= $1::date
          AND processed_at <  $2::date + interval '1 day'
        GROUP BY 1
        ORDER BY 1`,
      [from, to],
    )
    return res.rows.map((r) => ({
      date: r.day,
      netSalesMu: BigInt(r.net ?? '0'),
      orders: BigInt(r.orders ?? '0'),
    }))
  })
}

// ---------------------------------------------------------------------------
// Daily acquisition series — feeds the ComposedChart on the acquisition page.
// Per-day: new customers, NC CM2 (NC revenue − that day's ad spend), ad spend,
// CM2 per NC, CAC, and per-platform spend. Uses the first-order proxy for NC.
// Ad spend is joined by spend_date (best-effort: spend allocated to the same day).
// ---------------------------------------------------------------------------
export interface FactDailyAcquisitionRow {
  date: string
  newCustomers: bigint
  ncRevenueMu: bigint     // gross−discount−tax for NC orders on this day
  adSpendMu: bigint       // total spend on this day
  ncCm2Mu: bigint         // ncRevenueMu − adSpendMu
  cacMu: bigint | null
  cm2PerNcMu: bigint | null
  metaSpendMu: bigint
  googleSpendMu: bigint
}
export async function readDailyAcquisition(
  workspaceId: string,
  from: string,
  to: string,
): Promise<FactDailyAcquisitionRow[]> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    // Step 1: identify first-order date per customer
    // Step 2: aggregate new-customer orders per day
    const ncRes = await tx.query<{ day: string; nc: string; nc_rev: string }>(
      `WITH firsts AS (
         SELECT customer_ref, min(processed_at)::date acq_date
           FROM connector_order_facts
          WHERE customer_ref IS NOT NULL AND ${CANCELLED}
          GROUP BY customer_ref
       )
       SELECT f.acq_date::text AS day,
              count(*)::text AS nc,
              COALESCE(sum(o.gross_sales_mu - o.total_discount_mu - o.total_tax_mu), 0)::text AS nc_rev
         FROM firsts f
         JOIN connector_order_facts o
           ON o.customer_ref = f.customer_ref
          AND o.processed_at::date = f.acq_date
          AND ${CANCELLED.replace(/cancelled_at/g, 'o.cancelled_at').replace(/financial_status/g, 'o.financial_status')}
        WHERE f.acq_date >= $1::date
          AND f.acq_date <= $2::date
        GROUP BY 1
        ORDER BY 1`,
      [from, to],
    )
    // Step 3: ad spend per day, by vendor
    const spendRes = await tx.query<{ day: string; vendor: string; spend: string }>(
      `SELECT to_char(spend_date, 'YYYY-MM-DD') AS day, vendor,
              COALESCE(sum(spend_mu), 0)::text AS spend
         FROM connector_ad_spend_facts
        WHERE spend_date >= $1::date AND spend_date <= $2::date
        GROUP BY 1, 2`,
      [from, to],
    )
    // Build spend map keyed by date → { meta, google }
    const spendMap = new Map<string, { meta: bigint; google: bigint }>()
    for (const row of spendRes.rows) {
      const entry = spendMap.get(row.day) ?? { meta: 0n, google: 0n }
      const v = BigInt(row.spend ?? '0')
      if (row.vendor === 'META') entry.meta = v
      else if (row.vendor === 'GOOGLE') entry.google = v
      spendMap.set(row.day, entry)
    }
    return ncRes.rows.map((r) => {
      const nc = BigInt(r.nc ?? '0')
      const ncRev = BigInt(r.nc_rev ?? '0')
      const spend = spendMap.get(r.day) ?? { meta: 0n, google: 0n }
      const totalSpend = spend.meta + spend.google
      const ncCm2 = ncRev - totalSpend
      return {
        date: r.day,
        newCustomers: nc,
        ncRevenueMu: ncRev,
        adSpendMu: totalSpend,
        ncCm2Mu: ncCm2,
        cacMu: nc > 0n ? totalSpend / nc : null,
        cm2PerNcMu: nc > 0n ? ncCm2 / nc : null,
        metaSpendMu: spend.meta,
        googleSpendMu: spend.google,
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Distributions graph points — density curve from per-order line values.
// Buckets the (quantity × unit_price_mu) values into 40 even buckets across
// the observed range, counts orders per bucket, returns density in bp.
// ---------------------------------------------------------------------------
export interface FactDistGraphPoint {
  valueMu: bigint   // bucket midpoint (minor units)
  densityBp: number // share of orders in this bucket (basis points, sum ≈ 10000)
}
export async function readDistributionsGraphPoints(
  workspaceId: string,
  metric: 'sales' | 'cm1',
): Promise<FactDistGraphPoint[]> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    // Pull raw per-line values (capped at 500 rows for performance; adequate for density)
    const valueExpr =
      metric === 'cm1'
        ? 'li.quantity * li.unit_price_mu - COALESCE(li.quantity * pf.cost_mu, 0)'
        : 'li.quantity * li.unit_price_mu'
    const res = await tx.query<{ v: string }>(
      `SELECT (${valueExpr})::text AS v
         FROM connector_line_item_facts li
         LEFT JOIN connector_product_facts pf
           ON pf.workspace_id = li.workspace_id AND pf.vendor_product_id = li.vendor_product_id
        WHERE li.vendor_product_id IS NOT NULL
        LIMIT 2000`,
    )
    if (!res.rows.length) return []
    const values = res.rows.map((r) => BigInt(r.v ?? '0'))
    // Filter to positive values for meaningful density (negative CM1 is rare)
    const positive = values.filter((v) => v > 0n)
    if (!positive.length) return []
    const sorted = [...positive].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const minVal = sorted[0]
    const maxVal = sorted[sorted.length - 1]
    if (minVal === maxVal) return [{ valueMu: minVal, densityBp: 10000 }]
    const BUCKETS = 40
    const range = maxVal - minVal
    const bucketSize = range / BigInt(BUCKETS) || 1n
    const counts = new Array<number>(BUCKETS).fill(0)
    for (const v of positive) {
      const idx = Math.min(BUCKETS - 1, Number((v - minVal) / bucketSize))
      counts[idx]++
    }
    const total = positive.length
    return counts.map((c, i) => ({
      valueMu: minVal + bucketSize * BigInt(i) + bucketSize / 2n,
      densityBp: Math.round((c / total) * 10000),
    }))
  })
}

// ---------------------------------------------------------------------------
// P&L period grid — per-period (day/week/month/quarter) full P&L row set for
// the grid table view (legacy-parity). Groups order + spend + COGS by period.
//
// Columns with NO migrated source (productGross/shippingGross split,
// productDiscount/shippingDiscount, returnFees, shippingCosts/returnsCosts/
// paymentCosts/customsCosts/otherVariable, ncNetRevenue/ecNetRevenue,
// founderSalaryAllocated, fixedCosts) → honest 0n; the grid renders them as zeros.
// ---------------------------------------------------------------------------
export type PnlGranularity = 'day' | 'week' | 'month' | 'quarter'

export interface FactPnlPeriodRow {
  bucketKey: string          // ISO date of period start (YYYY-MM-DD)
  label: string              // display label e.g. "01 Apr" / "W15 2026"
  // Revenue block
  grossSales: bigint
  productGross: bigint       // honest 0n — no source
  shippingGross: bigint      // honest 0n — no source
  discounts: bigint
  productDiscount: bigint    // honest 0n — no source
  shippingDiscount: bigint   // honest 0n — no source
  sales: bigint              // grossSales (alias used by legacy)
  netSales: bigint           // grossSales − discounts
  productNet: bigint         // honest 0n — no source
  shippingNet: bigint        // honest 0n — no source
  // Refund block (sourced from financial_status='refunded' orders in the period)
  refunds: bigint
  productRefunds: bigint     // same as refunds — no split source
  shippingRefunds: bigint    // honest 0n — no source
  returnFees: bigint         // honest 0n — no source
  // Revenue after refunds
  revenue: bigint            // netSales − refunds
  ncNetRevenue: bigint       // honest 0n — no source
  ecNetRevenue: bigint       // honest 0n — no source
  netRevenue: bigint         // revenue − tax (realized pattern: non-cancelled only)
  // Cost block
  cogs: bigint
  variableCosts: bigint      // honest 0n — no variable-cost source
  shippingCosts: bigint      // honest 0n — no source
  returnsCosts: bigint       // honest 0n — no source
  paymentCosts: bigint       // honest 0n — no source
  customsCosts: bigint       // honest 0n — no source
  otherVariable: bigint      // honest 0n — no source
  // Ad spend
  adSpend: bigint
  metaAdSpend: bigint
  googleAdSpend: bigint
  // Margin ladder
  contributionMargin1: bigint
  contributionMargin2: bigint
  contributionMargin3: bigint
  fixedCosts: bigint         // honest 0n — no source
  founderSalaryAllocated: bigint // honest 0n — no source
  netProfit: bigint
  // Meta
  orders: bigint
  currencyCode: string
}

export async function readPnlPeriodGrid(
  workspaceId: string,
  from: string,
  to: string,
  granularity: PnlGranularity,
): Promise<FactPnlPeriodRow[]> {
  const trunc = granularity === 'quarter' ? 'quarter' : granularity
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    // ---- Order aggregates per period ----------------------------------------
    // Gross sales, discounts, tax for ALL orders in the period (non-cancelled).
    // Refunds are sourced from rows where financial_status = 'refunded'.
    const orderRes = await tx.query<Record<string, string>>(
      `SELECT
         to_char(date_trunc('${trunc}', processed_at), 'YYYY-MM-DD') AS period,
         max(currency_code) AS currency_code,
         COALESCE(sum(gross_sales_mu), 0)::text AS gross_sales,
         COALESCE(sum(total_discount_mu), 0)::text AS discounts,
         COALESCE(sum(total_tax_mu) FILTER (WHERE ${CANCELLED}), 0)::text AS tax,
         count(*) FILTER (WHERE ${CANCELLED})::text AS orders,
         COALESCE(sum(gross_sales_mu) FILTER (WHERE financial_status = 'refunded'), 0)::text AS refunds
       FROM connector_order_facts
       WHERE processed_at >= $1::date
         AND processed_at <  $2::date + interval '1 day'
       GROUP BY 1
       ORDER BY 1`,
      [from, to],
    )

    // ---- COGS per period (line items × cost_mu joined to orders in that period) --
    // Group by the ORDER's period bucket, then sum quantity × cost_mu.
    // Uses LEFT JOIN to product_facts so products with no cost contribute 0 (COALESCE).
    const cogsRes = await tx.query<Record<string, string>>(
      `SELECT
         to_char(date_trunc('${trunc}', o.processed_at), 'YYYY-MM-DD') AS period,
         COALESCE(sum(li.quantity * COALESCE(pf.cost_mu, 0)), 0)::text AS cogs
       FROM connector_order_facts o
       JOIN connector_line_item_facts li
         ON li.workspace_id = o.workspace_id
        AND li.vendor_order_id = o.vendor_order_id
       LEFT JOIN connector_product_facts pf
         ON pf.workspace_id = li.workspace_id
        AND pf.vendor_product_id = li.vendor_product_id
       WHERE o.processed_at >= $1::date
         AND o.processed_at <  $2::date + interval '1 day'
         AND ${CANCELLED.replace(/cancelled_at/g, 'o.cancelled_at').replace(/financial_status/g, 'o.financial_status')}
       GROUP BY 1`,
      [from, to],
    )

    // ---- Ad spend per period, split by vendor --------------------------------
    const spendRes = await tx.query<Record<string, string>>(
      `SELECT
         to_char(date_trunc('${trunc}', spend_date), 'YYYY-MM-DD') AS period,
         vendor,
         COALESCE(sum(spend_mu), 0)::text AS spend
       FROM connector_ad_spend_facts
       WHERE spend_date >= $1::date
         AND spend_date <= $2::date
       GROUP BY 1, 2`,
      [from, to],
    )

    // Build lookup maps
    const cogsMap = new Map<string, bigint>()
    for (const r of cogsRes.rows) {
      cogsMap.set(r.period, BigInt(r.cogs ?? '0'))
    }
    const spendMap = new Map<string, { meta: bigint; google: bigint }>()
    for (const r of spendRes.rows) {
      const entry = spendMap.get(r.period) ?? { meta: 0n, google: 0n }
      const v = BigInt(r.spend ?? '0')
      if (r.vendor === 'META') entry.meta = v
      else if (r.vendor === 'GOOGLE') entry.google = v
      spendMap.set(r.period, entry)
    }

    return orderRes.rows.map((r) => {
      const period = r.period ?? ''
      const grossSales = BigInt(r.gross_sales ?? '0')
      const discounts = BigInt(r.discounts ?? '0')
      const tax = BigInt(r.tax ?? '0')
      const orders = BigInt(r.orders ?? '0')
      const refunds = BigInt(r.refunds ?? '0')
      const netSales = grossSales - discounts
      const revenue = netSales - refunds
      const netRevenue = revenue - tax
      const cogs = cogsMap.get(period) ?? 0n
      const spend = spendMap.get(period) ?? { meta: 0n, google: 0n }
      const adSpend = spend.meta + spend.google
      const cm1 = netRevenue - cogs
      const cm2 = cm1 - adSpend
      const cm3 = cm2 // no fixed cost source
      const currencyCode = r.currency_code ?? 'INR'

      // Label per granularity
      let label: string = period
      try {
        const d = new Date(period + 'T00:00:00Z')
        if (granularity === 'day') {
          label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' })
        } else if (granularity === 'week') {
          label = `W${Math.ceil((d.getUTCDate()) / 7) + 1} ${d.getUTCFullYear()}`
        } else if (granularity === 'month') {
          label = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
        } else if (granularity === 'quarter') {
          const q = Math.floor(d.getUTCMonth() / 3) + 1
          label = `Q${q} ${d.getUTCFullYear()}`
        }
      } catch {
        label = period
      }

      return {
        bucketKey: period,
        label,
        grossSales,
        productGross: 0n,
        shippingGross: 0n,
        discounts,
        productDiscount: 0n,
        shippingDiscount: 0n,
        sales: grossSales,
        netSales,
        productNet: 0n,
        shippingNet: 0n,
        refunds,
        productRefunds: refunds,
        shippingRefunds: 0n,
        returnFees: 0n,
        revenue,
        ncNetRevenue: 0n,
        ecNetRevenue: 0n,
        netRevenue,
        cogs,
        variableCosts: 0n,
        shippingCosts: 0n,
        returnsCosts: 0n,
        paymentCosts: 0n,
        customsCosts: 0n,
        otherVariable: 0n,
        adSpend,
        metaAdSpend: spend.meta,
        googleAdSpend: spend.google,
        contributionMargin1: cm1,
        contributionMargin2: cm2,
        contributionMargin3: cm3,
        fixedCosts: 0n,
        founderSalaryAllocated: 0n,
        netProfit: cm3,
        orders,
        currencyCode,
      }
    })
  })
}

// Calendar report — per-period (day/week/month) revenue + ad spend + orders + new customers.
export interface FactCalendarRow {
  periodKey: string
  revenueMu: bigint
  orders: bigint
  newCustomers: bigint
  spendMu: bigint
}
export async function readCalendarReport(workspaceId: string, grain: 'day' | 'week' | 'month'): Promise<FactCalendarRow[]> {
  const trunc = grain === 'week' ? 'week' : grain === 'month' ? 'month' : 'day'
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const rev = await tx.query<Record<string, string>>(
      `WITH firsts AS (
         SELECT customer_ref, min(processed_at) acq
           FROM connector_order_facts WHERE customer_ref IS NOT NULL AND ${CANCELLED}
           GROUP BY customer_ref
       )
       SELECT to_char(date_trunc('${trunc}', o.processed_at), 'YYYY-MM-DD') period,
              COALESCE(sum(${NET_EXPR.replace(/gross_sales_mu/g, 'o.gross_sales_mu').replace(/total_discount_mu/g, 'o.total_discount_mu').replace(/total_tax_mu/g, 'o.total_tax_mu')}),0)::text revenue,
              count(*)::text orders,
              count(*) FILTER (WHERE f.acq = o.processed_at)::text new_customers
         FROM connector_order_facts o
         LEFT JOIN firsts f ON f.customer_ref = o.customer_ref
        WHERE ${CANCELLED.replace(/cancelled_at/g, 'o.cancelled_at').replace(/financial_status/g, 'o.financial_status')}
        GROUP BY 1 ORDER BY 1 DESC LIMIT 90`,
    )
    const spend = await tx.query<Record<string, string>>(
      `SELECT to_char(date_trunc('${trunc}', spend_date), 'YYYY-MM-DD') period,
              COALESCE(sum(spend_mu),0)::text spend
         FROM connector_ad_spend_facts GROUP BY 1`,
    )
    const spendByPeriod = new Map(spend.rows.map((r) => [r.period, BigInt(r.spend ?? '0')]))
    return rev.rows.map((r) => ({
      periodKey: r.period,
      revenueMu: BigInt(r.revenue ?? '0'),
      orders: BigInt(r.orders ?? '0'),
      newCustomers: BigInt(r.new_customers ?? '0'),
      spendMu: spendByPeriod.get(r.period) ?? 0n,
    }))
  })
}

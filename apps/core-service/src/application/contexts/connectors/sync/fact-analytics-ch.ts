/**
 * fact-analytics-ch.ts — the ClickHouse read companion to `fact-analytics.ts`.
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * Same function signatures + return shapes as fact-analytics.ts (PG), so the
 * dispatcher in fact-analytics.ts can flag-route per function without callers
 * caring which store served the read (v2 plan §6, Q2 — flag-gated cutover, PG
 * fallback kept). Numbers are identical at parity-tested precision.
 *
 * Each function returns the EXACT same shape (FactStoreSummary etc.) as the PG
 * sibling — that's the contract that keeps the gateway / data-plane unaware of
 * the swap. CH-side `FINAL` is added automatically by the gateway.
 *
 * Money: CH returns Int64 as JSON strings (json_quote_64bit_integers=1), so we
 * BigInt-cast at the seam — no Number precision loss.
 */

import { chQuery } from '@brain/lib-clickhouse-ts'
import type {
  FactStoreSummary, FactPnl, FactMarketing, FactCogs, CogsSettings, FactProductRow,
  FactCourierRow, FactShipmentAnalytics, FactPincodeRow, FactCodPrepaid,
  FactCohortRow, FactLtv, FactLifecycleBucket, FactLifecycle, FactOrderTimings,
  FactCascadeRow, FactDistRow, FactCalendarRow,
  FactShipmentRow, FactShipmentPage, ShipmentRowFiltersLocal,
  FactDateRange,
} from './fact-analytics.js'
import type {
  FactDailySalesRow, FactDailyAcquisitionRow, FactDistGraphPoint,
} from './fact-analytics.js'

// CH derives the same `status_bucket` PG materialized inline (PG's was a backfill
// CASE; CH recomputes it from raw `status` via multiIf for byte-perfect parity).
const STATUS_BUCKET = `multiIf(
  positionCaseInsensitive(status, 'RTO')            > 0, 'RTO',
  status = 'DELIVERED',                                 'DELIVERED',
  positionCaseInsensitive(status, 'SELF FULFILLED') > 0, 'DELIVERED',
  positionCaseInsensitive(status, 'CANCEL')         > 0, 'CANCELLED',
  positionCaseInsensitive(status, 'UNDELIVER')      > 0
    OR positionCaseInsensitive(status, 'QC FAILED') > 0, 'UNDELIVERED',
  'IN_TRANSIT')`

// PG-parity filter for "realized" / "non-cancelled" orders:
//   cancelled_at IS NULL AND financial_status NOT IN ('voided','refunded')
// CH: same predicate (cancelled_at was added by the Phase-6 one-shot ALTER).
// lower(): migrated financial_status is mixed-case (Shopify UPPERCASE
// 'VOIDED'/'REFUNDED', Woo lowercase). Without it, voided/refunded orders leak
// into realized revenue (873 orders for the anchor workspace).
const CANCELLED_OK = `cancelled_at IS NULL AND lower(coalesce(financial_status,'')) NOT IN ('voided','refunded')`

// Half-open date predicate for a Date/DateTime column, bound as CH params. Empty
// when no range → lifetime. Used so the dashboard date-range picker actually
// windows the headline summaries (was a no-op — every tile showed lifetime).
function chDateClause(col: string, range?: FactDateRange): { clause: string; params: Record<string, unknown> } {
  if (!range?.from || !range?.to) return { clause: '', params: {} }
  return { clause: ` AND ${col} >= {from:Date} AND ${col} < addDays({to:Date}, 1)`, params: { from: range.from, to: range.to } }
}

// ---------------------------------------------------------------------------
// readStoreSummary — first port (proof of the wire-up).
//
// PG-parity note: the canonical PG filter is
//   `cancelled_at IS NULL AND COALESCE(financial_status,'') NOT IN ('voided','refunded')`.
// The CH 0003 schema (Phase 1) doesn't carry `cancelled_at`. For first-pass
// parity we approximate with `financial_status NOT IN ('voided','refunded','cancelled')`.
// This is the SINGLE documented parity caveat for this function; the Phase-6
// per-function parity test will report any delta vs PG so we can decide whether
// to ALTER CH + re-backfill `cancelled_at` (a one-shot fix, cheap to do later).
// ---------------------------------------------------------------------------

interface ChStoreRow {
  currency_code: string | null
  gross: string | null
  discount: string | null
  tax: string | null
  shipping: string | null
  orders: string | null
  realized_gross: string | null
  realized_discount: string | null
  realized_tax: string | null
  realized_orders: string | null
}

export async function readStoreSummaryCH(workspaceId: string, range?: FactDateRange): Promise<FactStoreSummary> {
  const dc = chDateClause('placed_at', range)
  const rows = await chQuery<ChStoreRow>(
    `SELECT
       any(currency_code)                                              AS currency_code,
       toString(sum(gross_sales_mu))                                   AS gross,
       toString(sum(discount_mu))                                      AS discount,
       toString(sum(tax_mu))                                           AS tax,
       toString(sum(shipping_mu))                                      AS shipping,
       toString(count())                                               AS orders,
       toString(sumIf(gross_sales_mu, ${CANCELLED_OK}))                AS realized_gross,
       toString(sumIf(discount_mu,    ${CANCELLED_OK}))                AS realized_discount,
       toString(sumIf(tax_mu,         ${CANCELLED_OK}))                AS realized_tax,
       toString(countIf(              ${CANCELLED_OK}))                AS realized_orders
     FROM brain.connector_order_facts
     WHERE workspace_id = {workspace_id:String}${dc.clause}`,
    { workspaceId, params: dc.params },
  )
  const r = rows[0] ?? ({} as ChStoreRow)
  const orders = BigInt(r.orders ?? '0')
  const gross = BigInt(r.gross ?? '0')
  const discount = BigInt(r.discount ?? '0')
  const tax = BigInt(r.tax ?? '0')
  const shipping = BigInt(r.shipping ?? '0')
  const netSales = gross - discount
  const netNetTax = netSales - tax
  const netRevenue = netNetTax + shipping
  // Realized revenue = realized net SALES = gross − discount of non-cancelled
  // orders (the kept contract; tax is NOT subtracted here — net_net_tax is the
  // separate tax-exclusive metric). Aligns P&L/CM/KPI net to the store "Net Sales".
  const realizedRevenue =
    BigInt(r.realized_gross ?? '0') - BigInt(r.realized_discount ?? '0')
  const realizedOrders = BigInt(r.realized_orders ?? '0')
  const aov = realizedOrders > 0n ? realizedRevenue / realizedOrders : null
  return {
    hasData: orders > 0n,
    currencyCode: r.currency_code ?? 'INR',
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
}

// ---------------------------------------------------------------------------
// Ad spend split by vendor (internal helper — used by readPnlCH/readMarketingCH).
// ---------------------------------------------------------------------------
interface ChAdSpendRow {
  vendor: string
  spend: string | null
  currency_code: string | null
}
async function readAdSpendCH(workspaceId: string, range?: FactDateRange): Promise<{ meta: bigint; google: bigint; currency: string }> {
  const dc = chDateClause('date', range)
  const rows = await chQuery<ChAdSpendRow>(
    `SELECT vendor, toString(sum(spend_mu)) AS spend, any(currency_code) AS currency_code
       FROM brain.connector_ad_spend_facts
      WHERE workspace_id = {workspace_id:String}${dc.clause}
      GROUP BY vendor`,
    { workspaceId, params: dc.params },
  )
  let meta = 0n
  let google = 0n
  let currency = 'INR'
  for (const r of rows) {
    const v = BigInt(r.spend ?? '0')
    if (r.vendor === 'META') meta = v
    else if (r.vendor === 'GOOGLE') google = v
    if (r.currency_code) currency = r.currency_code
  }
  return { meta, google, currency }
}

// ---------------------------------------------------------------------------
// readPnlCH — same shape as PG. Reuses readStoreSummaryCH + readAdSpendCH.
// ---------------------------------------------------------------------------
export async function readPnlCH(workspaceId: string, range?: FactDateRange): Promise<FactPnl> {
  const store = await readStoreSummaryCH(workspaceId, range)
  const spend = await readAdSpendCH(workspaceId, range)
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

// ---------------------------------------------------------------------------
// readMarketingCH — same shape as PG. New-customer revenue derived per (customer_ref,
// processed-at) window; PG uses a window function, CH uses argMin over the partition
// to find the first order per customer.
// ---------------------------------------------------------------------------
export async function readMarketingCH(workspaceId: string, range?: FactDateRange): Promise<FactMarketing> {
  const store = await readStoreSummaryCH(workspaceId, range)
  const spend = await readAdSpendCH(workspaceId, range)
  const ncDc = chDateClause('placed_at', range)

  // New-customer net revenue = sum of (gross - discount - tax) for the first order of
  // each non-cancelled customer (cancelled_at IS NULL AND financial_status NOT IN voided/refunded).
  const ncRows = await chQuery<{ nc_rev: string | null; nc_count: string | null }>(
    `WITH ranked AS (
       SELECT customer_ref,
              row_number() OVER (PARTITION BY customer_ref ORDER BY placed_at, vendor_order_id) AS rn,
              (gross_sales_mu - discount_mu) AS net_mu  -- net = gross − discount (contract)
         FROM brain.connector_order_facts
        WHERE workspace_id = {workspace_id:String}${ncDc.clause}
          AND customer_ref != ''
          AND cancelled_at IS NULL
          AND lower(coalesce(financial_status,'')) NOT IN ('voided','refunded')
     )
     SELECT toString(sumIf(net_mu, rn = 1)) AS nc_rev,
            toString(countIf(rn = 1))     AS nc_count
       FROM ranked`,
    { workspaceId, params: ncDc.params },
  )
  const nc = ncRows[0] ?? {}
  return {
    hasData: store.hasData,
    currencyCode: store.currencyCode,
    netRevenueMu: store.realizedRevenueMu,
    totalAdSpendMu: spend.meta + spend.google,
    metaSpendMu: spend.meta,
    googleSpendMu: spend.google,
    newCustomerRevenueMu: BigInt(nc.nc_rev ?? '0'),
    newCustomersCount: BigInt(nc.nc_count ?? '0'),
  }
}

// ---------------------------------------------------------------------------
// readCogsCH — sum(li.quantity × pf.cost_mu) joined li → pf on vendor_product_id.
// Same shape as PG. Uses LEFT JOIN so lines with no costed product contribute 0.
// ---------------------------------------------------------------------------
export async function readCogsCH(workspaceId: string, settings: CogsSettings, range?: FactDateRange): Promise<FactCogs> {
  const ovr = settings.overrideBp | 0
  const fb = settings.fallbackBp | 0
  const mk = settings.markupBp | 0
  const dc = chDateClause('li.order_date', range)
  // Same precedence as PG readCogs: override% of revenue > product cost×(1+markup)
  // > fallback% of revenue for cost-less lines. li gets FINAL (the re-inserted
  // vendor_product_id versions must dedup); pf uses an explicit argMax subquery.
  const rows = await chQuery<{ cogs: string | null; covered: string | null; total: string | null }>(
    `SELECT
       toString(sum(multiIf(
         ${ovr} > 0,         intDiv(li.line_total_mu * ${ovr}, 10000),
         pf.cost_mu > 0,     intDiv(li.quantity * pf.cost_mu * (10000 + ${mk}), 10000),
         ${fb} > 0,          intDiv(li.line_total_mu * ${fb}, 10000),
         toInt64(0))))                                            AS cogs,
       toString(countIf(${ovr} > 0 OR pf.cost_mu > 0 OR ${fb} > 0)) AS covered,
       toString(count())                                         AS total
     FROM brain.connector_line_item_facts AS li
     LEFT JOIN (
       SELECT workspace_id, vendor, vendor_product_id, argMax(cost_mu, version) AS cost_mu
         FROM brain.connector_product_facts
        WHERE workspace_id = {workspace_id:String}
        GROUP BY workspace_id, vendor, vendor_product_id
     ) AS pf
       ON pf.workspace_id = li.workspace_id
      AND pf.vendor       = li.vendor
      AND pf.vendor_product_id = li.vendor_product_id
     WHERE li.workspace_id = {workspace_id:String}${dc.clause}`,
    { workspaceId, params: dc.params },
  )
  const r = rows[0] ?? {}
  return {
    cogsMu: BigInt(r.cogs ?? '0'),
    coveredLines: BigInt(r.covered ?? '0'),
    totalLines: BigInt(r.total ?? '0'),
  }
}

// ---------------------------------------------------------------------------
// readProductPerformanceCH — per-product CM1 + Pareto grade. Same shape as PG;
// window functions OVER () compute total + cumulative for the grading.
// ---------------------------------------------------------------------------
interface ChProductRow {
  label: string | null
  grade: 'A' | 'B' | 'C' | 'F'
  cm1_mu: string
  revenue_mu: string
  sold: string
  orders: string
  total_cm1: string
}
export async function readProductPerformanceCH(
  workspaceId: string,
): Promise<{ rows: FactProductRow[]; totalCm1Mu: bigint }> {
  const rows = await chQuery<ChProductRow>(
    `WITH per AS (
       SELECT li.vendor_product_id AS pid,
              any(coalesce(pf.title, li.title))                       AS label,
              sum(li.quantity * li.price_mu)                          AS revenue_mu,
              sum(li.quantity * coalesce(pf.cost_mu, 0))              AS cogs_mu,
              sum(li.quantity)                                        AS sold,
              uniqExact(li.vendor_order_id)                           AS orders
         FROM brain.connector_line_item_facts AS li
         LEFT JOIN (
           SELECT workspace_id, vendor, vendor_product_id,
                  argMax(cost_mu, version) AS cost_mu,
                  argMax(title, version)   AS title
             FROM brain.connector_product_facts
            WHERE workspace_id = {workspace_id:String}
            GROUP BY workspace_id, vendor, vendor_product_id
         ) AS pf
           ON pf.workspace_id = li.workspace_id
          AND pf.vendor       = li.vendor
          AND pf.vendor_product_id = li.vendor_product_id
        WHERE li.workspace_id = {workspace_id:String}
          AND li.vendor_product_id != ''
        GROUP BY li.vendor_product_id
     ),
     ranked AS (
       SELECT *, (revenue_mu - cogs_mu) AS cm1_mu,
              sum(revenue_mu - cogs_mu) OVER ()                                                        AS total_cm1,
              sum(revenue_mu - cogs_mu) OVER (ORDER BY (revenue_mu - cogs_mu) DESC, pid
                                              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)        AS cum_cm1
         FROM per
     )
     SELECT label,
            toString(revenue_mu) AS revenue_mu,
            toString(cm1_mu)     AS cm1_mu,
            toString(sold)       AS sold,
            toString(orders)     AS orders,
            toString(total_cm1)  AS total_cm1,
            multiIf(cm1_mu <= 0, 'F',
                    total_cm1 > 0 AND cum_cm1 <= toInt64(0.80 * total_cm1), 'A',
                    total_cm1 > 0 AND cum_cm1 <= toInt64(0.95 * total_cm1), 'B',
                    'C') AS grade
       FROM ranked
      ORDER BY cm1_mu DESC
      LIMIT 200`,
    // FINAL is required: connector_line_item_facts is a ReplacingMergeTree and a
    // backfill re-insert leaves duplicate versions until merged. skipFinal here
    // double-counted revenue/units (pf is already deduped via its argMax subquery,
    // so auto-FINAL only decorates li, which is what we need).
    { workspaceId },
  )
  const mapped: FactProductRow[] = rows.map((r) => {
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
  const totalCm1Mu = rows.length ? BigInt(rows[0].total_cm1 ?? '0') : 0n
  return { rows: mapped, totalCm1Mu }
}
// ---------------------------------------------------------------------------
// readShipmentAnalyticsCH — RTO/delivered/courier counts. Charges + COD are 0
// here (legacy never populated those in PG either → byte-perfect parity).
// ---------------------------------------------------------------------------
export async function readShipmentAnalyticsCH(workspaceId: string): Promise<FactShipmentAnalytics> {
  const a = await chQuery<Record<string, string>>(
    `SELECT
       toString(count())                                                  AS total,
       toString(countIf(${STATUS_BUCKET} = 'DELIVERED'))                  AS delivered,
       toString(countIf(${STATUS_BUCKET} = 'RTO'))                        AS rto,
       toString(countIf(is_cod = 1))                                      AS cod,
       toString(countIf(is_cod = 0))                                      AS prepaid,
       toString(0)                                                        AS charges,
       toString(0)                                                        AS rto_charges,
       toString(0)                                                        AS fwd_charges,
       toString(0)                                                        AS cod_charges,
       toString(countIf(is_cod = 1 AND ${STATUS_BUCKET} = 'RTO'))         AS cod_rto,
       toString(countIf(is_cod = 1))                                      AS cod_total,
       toString(countIf(is_cod = 0 AND ${STATUS_BUCKET} = 'RTO'))         AS prepaid_rto,
       toString(countIf(is_cod = 0))                                      AS prepaid_total
     FROM brain.connector_shipment_facts
     WHERE workspace_id = {workspace_id:String}`,
    { workspaceId },
  )
  const c = await chQuery<Record<string, string>>(
    `SELECT coalesce(nullIf(courier_name, ''), 'Unknown')                AS courier,
            toString(count())                                            AS cnt,
            toString(countIf(${STATUS_BUCKET} = 'DELIVERED'))            AS delivered,
            toString(countIf(${STATUS_BUCKET} = 'RTO'))                  AS rto,
            toString(0)                                                  AS charges
       FROM brain.connector_shipment_facts
      WHERE workspace_id = {workspace_id:String}
      GROUP BY courier ORDER BY count() DESC LIMIT 50`,
    { workspaceId },
  )
  const r = a[0] ?? {}
  return {
    totalShipments: BigInt(r.total ?? '0'),
    deliveredCount: BigInt(r.delivered ?? '0'),
    rtoCount: BigInt(r.rto ?? '0'),
    codCount: BigInt(r.cod ?? '0'),
    prepaidCount: BigInt(r.prepaid ?? '0'),
    totalChargesMu: BigInt(r.charges ?? '0'),
    rtoChargesMu: BigInt(r.rto_charges ?? '0'),
    forwardChargesMu: BigInt(r.fwd_charges ?? '0'),
    codChargesMu: BigInt(r.cod_charges ?? '0'),
    codRtoCount: BigInt(r.cod_rto ?? '0'),
    codTotal: BigInt(r.cod_total ?? '0'),
    prepaidRtoCount: BigInt(r.prepaid_rto ?? '0'),
    prepaidTotal: BigInt(r.prepaid_total ?? '0'),
    byCourier: c.map((x): FactCourierRow => ({
      courierName: x.courier ?? 'Unknown',
      count: BigInt(x.cnt ?? '0'),
      deliveredCount: BigInt(x.delivered ?? '0'),
      rtoCount: BigInt(x.rto ?? '0'),
      chargesMu: BigInt(x.charges ?? '0'),
    })),
  }
}

// ---------------------------------------------------------------------------
// readPincodesCH — per-pincode shipment reliability (top 200).
// ---------------------------------------------------------------------------
export async function readPincodesCH(workspaceId: string): Promise<FactPincodeRow[]> {
  const rows = await chQuery<Record<string, string>>(
    `SELECT delivery_pincode                                       AS pincode,
            any(delivery_city)                                     AS city,
            toString(count())                                      AS cnt,
            toString(countIf(${STATUS_BUCKET} = 'RTO'))            AS rto,
            toString(countIf(${STATUS_BUCKET} = 'DELIVERED'))      AS delivered,
            toString(countIf(is_cod = 1))                          AS cod
       FROM brain.connector_shipment_facts
      WHERE workspace_id = {workspace_id:String}
        AND delivery_pincode != ''
      GROUP BY delivery_pincode
      ORDER BY count() DESC
      LIMIT 200`,
    { workspaceId },
  )
  return rows.map((x) => ({
    pincode: x.pincode,
    city: x.city ?? '',
    shipmentCount: BigInt(x.cnt ?? '0'),
    rtoCount: BigInt(x.rto ?? '0'),
    deliveredCount: BigInt(x.delivered ?? '0'),
    codCount: BigInt(x.cod ?? '0'),
  }))
}

// ---------------------------------------------------------------------------
// readShipmentRowsCH — per-shipment operational console (CH companion to
// readShipmentRows). Keyset pagination on vendor_shipment_id (CH has no uuid id;
// the shiprocket shipment id is the stable key). Charge columns are 0 — legacy
// never populated shiprocket charges into the facts (they live in rawJson only).
// ---------------------------------------------------------------------------
export async function readShipmentRowsCH(
  workspaceId: string,
  filters: ShipmentRowFiltersLocal,
  cursor: string | undefined,
  pageSize: number,
): Promise<FactShipmentPage> {
  const esc = (s: string): string => s.replace(/'/g, "''")
  const conds: string[] = []
  if (filters.search && filters.search.trim() !== '') {
    const term = esc(filters.search.trim())
    conds.push(`(positionCaseInsensitive(vendor_shipment_id, '${term}') > 0 OR positionCaseInsensitive(vendor_order_id, '${term}') > 0)`)
  }
  if (filters.statuses && filters.statuses.length > 0) {
    conds.push(`status IN (${filters.statuses.map((s) => `'${esc(s)}'`).join(',')})`)
  }
  if (filters.payment === 'COD') conds.push('is_cod = 1')
  else if (filters.payment === 'PREPAID') conds.push('is_cod = 0')
  if (filters.rtoOnly) conds.push(`${STATUS_BUCKET} = 'RTO'`)
  const filterWhere = conds.length > 0 ? ` AND ${conds.join(' AND ')}` : ''
  const cursorWhere = cursor ? ` AND vendor_shipment_id < '${esc(cursor)}'` : ''

  const [rows, agg, statuses] = await Promise.all([
    chQuery<Record<string, unknown>>(
      `SELECT vendor_shipment_id                            AS id,
              vendor_shipment_id,
              vendor_order_id                               AS vendor_order_ref,
              status,
              ${STATUS_BUCKET}                              AS status_bucket,
              is_cod,
              courier_name,
              delivery_pincode,
              delivery_city,
              toString(shipped_at)                          AS shipped_at,
              toString(date)                                AS created_at
         FROM brain.connector_shipment_facts
        WHERE workspace_id = {workspace_id:String}${filterWhere}${cursorWhere}
        ORDER BY vendor_shipment_id DESC
        LIMIT ${pageSize + 1}`,
      { workspaceId },
    ),
    chQuery<Record<string, string>>(
      `SELECT toString(count())                              AS total,
              toString(countIf(${STATUS_BUCKET} = 'DELIVERED')) AS delivered,
              toString(countIf(${STATUS_BUCKET} = 'RTO'))       AS rto
         FROM brain.connector_shipment_facts
        WHERE workspace_id = {workspace_id:String}${filterWhere}`,
      { workspaceId },
    ),
    chQuery<Record<string, string>>(
      `SELECT DISTINCT status FROM brain.connector_shipment_facts
        WHERE workspace_id = {workspace_id:String} AND status != ''
        ORDER BY status LIMIT 50`,
      { workspaceId },
    ),
  ])

  const hasMore = rows.length > pageSize
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows
  const lastRow = pageRows[pageRows.length - 1]
  const nextCursor = hasMore && lastRow ? String(lastRow.id) : null
  const a = agg[0] ?? {}

  const mapped: FactShipmentRow[] = pageRows.map((r) => ({
    id: String(r.id ?? ''),
    vendorShipmentId: String(r.vendor_shipment_id ?? ''),
    vendorOrderRef: r.vendor_order_ref ? String(r.vendor_order_ref) : null,
    status: r.status != null ? String(r.status) : null,
    statusBucket: r.status_bucket != null ? String(r.status_bucket) : null,
    isCod: Number(r.is_cod) === 1,
    codAmountMu: null,
    shippingChargesMu: null,
    courierName: r.courier_name ? String(r.courier_name) : null,
    deliveryPincode: r.delivery_pincode ? String(r.delivery_pincode) : null,
    deliveryCity: r.delivery_city ? String(r.delivery_city) : null,
    shippedAt: r.shipped_at ? String(r.shipped_at) : null,
    createdAt: r.created_at ? String(r.created_at) : null,
  }))

  return {
    rows: mapped,
    nextCursor,
    totalCount: BigInt(a.total ?? '0'),
    filteredCount: BigInt(a.total ?? '0'),
    deliveredCount: BigInt(a.delivered ?? '0'),
    rtoCount: BigInt(a.rto ?? '0'),
    mappedCount: 0n,
    distinctStatuses: statuses.map((s) => s.status).filter(Boolean),
  }
}

// ---------------------------------------------------------------------------
// readCodPrepaidCH — order-side counts/revenue from order_facts.payment_method.
// (Shipment-side cod/prepaid never populated in legacy — same PG behaviour.)
// ---------------------------------------------------------------------------
export async function readCodPrepaidCH(workspaceId: string): Promise<FactCodPrepaid> {
  const rows = await chQuery<Record<string, string>>(
    `SELECT
       toString(countIf(payment_method = 'COD'))                                              AS cod_orders,
       toString(countIf(payment_method = 'Prepaid'))                                          AS prepaid_orders,
       toString(sumIf(gross_sales_mu, payment_method = 'COD'))                                AS cod_gross,
       toString(sumIf(gross_sales_mu, payment_method = 'Prepaid'))                            AS prepaid_gross,
       toString(sumIf(gross_sales_mu - discount_mu, ${CANCELLED_OK}))                          AS net,
       toString(countIf(${CANCELLED_OK}))                                                     AS orders
     FROM brain.connector_order_facts
     WHERE workspace_id = {workspace_id:String}`,
    { workspaceId },
  )
  const r = rows[0] ?? {}
  const orders = BigInt(r.orders ?? '0')
  const net = BigInt(r.net ?? '0')
  return {
    codOrders: BigInt(r.cod_orders ?? '0'),
    prepaidOrders: BigInt(r.prepaid_orders ?? '0'),
    codGrossMu: BigInt(r.cod_gross ?? '0'),
    prepaidGrossMu: BigInt(r.prepaid_gross ?? '0'),
    aovMu: orders > 0n ? net / orders : null,
  }
}

// ---------------------------------------------------------------------------
// readCohortsCH — acquisition-month cohorts + 90-day repeat + 12-mo cumulative.
// CH equivalent of PG's set-based cohorts query (Phase-6 perf rewrite).
// ---------------------------------------------------------------------------
const COHORT_NET = `(gross_sales_mu - discount_mu)`  // net = gross − discount (contract; no tax)
const MONTH_OFFSET_CH = `LEAST(11, GREATEST(0, dateDiff('month', cohort_dt, toDate(placed_at))))`

export async function readCohortsCH(workspaceId: string): Promise<FactCohortRow[]> {
  // (1) Cohort sizes + rr90: rn=1 = first order, rn=2 = second order. rr90 is the
  // count of rn=2 rows that fall within 90 days of the customer's acq date.
  // (Bug-fixed from minIf — CH minIf returns the type default for no-match instead
  // of NULL, which incorrectly admits customers with no 2nd order. countIf on rn=2
  // is the direct equivalent of PG's `count(*) FILTER (WHERE rn=2 AND ...)`.)
  const sizes = await chQuery<{ cohort: string; new_customers: string; rr90: string }>(
    `WITH ranked AS (
       SELECT customer_ref, placed_at,
              row_number() OVER (PARTITION BY customer_ref ORDER BY placed_at, vendor_order_id) AS rn,
              min(placed_at) OVER (PARTITION BY customer_ref)                                     AS acq
         FROM brain.connector_order_facts
        WHERE workspace_id = {workspace_id:String}
          AND customer_ref != ''
          AND cancelled_at IS NULL
          AND lower(coalesce(financial_status,'')) NOT IN ('voided','refunded')
     )
     SELECT formatDateTime(toStartOfMonth(toDate(acq)), '%Y-%m') AS cohort,
            toString(countIf(rn = 1))                                                  AS new_customers,
            toString(countIf(rn = 2 AND placed_at <= acq + INTERVAL 90 DAY))           AS rr90
       FROM ranked
      GROUP BY cohort
      ORDER BY cohort`,
    { workspaceId },
  )

  // (2) Revenue by cohort × month-offset (0..11).
  const rev = await chQuery<{ cohort: string; off: string; net: string }>(
    `WITH fo AS (
       SELECT customer_ref, toDate(min(placed_at)) AS cohort_dt
         FROM brain.connector_order_facts
        WHERE workspace_id = {workspace_id:String}
          AND customer_ref != ''
          AND cancelled_at IS NULL
          AND lower(coalesce(financial_status,'')) NOT IN ('voided','refunded')
        GROUP BY customer_ref
     )
     SELECT formatDateTime(toStartOfMonth(fo.cohort_dt), '%Y-%m')  AS cohort,
            toString(${MONTH_OFFSET_CH})                            AS off,
            toString(sum(${COHORT_NET}))                            AS net
       FROM brain.connector_order_facts AS o
       INNER JOIN fo USING (customer_ref)
      WHERE o.workspace_id = {workspace_id:String}
        AND o.customer_ref != ''
        AND o.cancelled_at IS NULL
        AND lower(coalesce(o.financial_status,'')) NOT IN ('voided','refunded')
      GROUP BY 1, 2`,
    { workspaceId },
  )

  const byCohort = new Map<string, bigint[]>()
  for (const row of rev) {
    const arr = byCohort.get(row.cohort) ?? new Array<bigint>(12).fill(0n)
    const off = Math.max(0, Math.min(11, Number(row.off)))
    arr[off] += BigInt(row.net ?? '0')
    byCohort.set(row.cohort, arr)
  }
  return sizes.map((s) => {
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
}

// ---------------------------------------------------------------------------
// readLtvCH — pure derivation from cohorts (matches PG behaviour exactly).
// ---------------------------------------------------------------------------
export async function readLtvCH(workspaceId: string): Promise<FactLtv> {
  const cohorts = await readCohortsCH(workspaceId)
  let totalCustomers = 0n, sumFirst = 0n, sumM1 = 0n, sumM3 = 0n, sumM6 = 0n, sumM12 = 0n
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
// readLifecycleStatesCH — recency segmentation (new ≤30d, active ≤90, at_risk ≤180,
// churned >180) from each customer's last order vs the workspace max.
// ---------------------------------------------------------------------------
export async function readLifecycleStatesCH(workspaceId: string): Promise<FactLifecycle> {
  const rows = await chQuery<Record<string, string>>(
    `WITH cust AS (
       SELECT customer_ref,
              max(placed_at)                          AS last_at,
              count()                                 AS orders,
              sum(${COHORT_NET})                      AS net
         FROM brain.connector_order_facts
        WHERE workspace_id = {workspace_id:String}
          AND customer_ref != ''
          AND cancelled_at IS NULL
          AND lower(coalesce(financial_status,'')) NOT IN ('voided','refunded')
        GROUP BY customer_ref
     ),
     nowref AS (SELECT max(last_at) AS n FROM cust),
     b AS (
       SELECT multiIf(
                 (nowref.n - last_at) <= INTERVAL 30  DAY, 'new',
                 (nowref.n - last_at) <= INTERVAL 90  DAY, 'active',
                 (nowref.n - last_at) <= INTERVAL 180 DAY, 'at_risk',
                                                          'churned') AS bucket,
              orders, net
         FROM cust, nowref
     )
     SELECT bucket,
            toString(count())                    AS cnt,
            toString(sum(net))                   AS rev,
            toString(sum(orders))                AS ord
       FROM b GROUP BY bucket`,
    { workspaceId },
  )
  const by = new Map(rows.map((r) => [r.bucket, r]))
  const names = ['new', 'active', 'at_risk', 'churned'] as const
  const buckets: FactLifecycleBucket[] = names.map((name) => {
    const r = by.get(name)
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
}

// ---------------------------------------------------------------------------
// readOrderTimingsCH — repeat-rate ladder (1st→2nd→3rd→4th) and median days
// between consecutive orders. PG used `percentile_cont(0.5) FILTER (WHERE rn=N)`;
// CH equivalent is `quantileExactIf(0.5)(gap_days, rn = N)`. The "first" cohort
// is `count(DISTINCT customer_ref) FILTER (WHERE rn=1)` — in CH, every customer
// has exactly one rn=1 row in the ranked CTE, so countIf(rn=1) gives the same.
// ---------------------------------------------------------------------------
export async function readOrderTimingsCH(workspaceId: string): Promise<FactOrderTimings> {
  const res = await chQuery<Record<string, string | null>>(
    `WITH ranked AS (
       SELECT customer_ref,
              placed_at,
              row_number() OVER (PARTITION BY customer_ref ORDER BY placed_at, vendor_order_id) AS rn,
              dateDiff('second',
                       lagInFrame(placed_at) OVER (PARTITION BY customer_ref ORDER BY placed_at, vendor_order_id),
                       placed_at) / 86400.0 AS gap_days
         FROM brain.connector_order_facts
        WHERE workspace_id = {workspace_id:String}
          AND customer_ref != ''
          AND ${CANCELLED_OK}
     )
     SELECT toString(countIf(rn = 1))                          AS first_orders,
            toString(countIf(rn >= 2))                         AS c2,
            toString(countIf(rn >= 3))                         AS c3,
            toString(countIf(rn >= 4))                         AS c4,
            toString(quantileExactIf(0.5)(gap_days, rn = 2))   AS d12,
            toString(quantileExactIf(0.5)(gap_days, rn = 3))   AS d23,
            toString(quantileExactIf(0.5)(gap_days, rn = 4))   AS d34
       FROM ranked`,
    { workspaceId },
  )
  const r = res[0] ?? {}
  const first = BigInt(r.first_orders ?? '0')
  const rate = (c: string | null | undefined) =>
    first > 0n ? Number((BigInt(c ?? '0') * 10000n) / first) : 0
  // CH `quantileExactIf` on no-match returns 0 (numeric default), PG returns NULL.
  // We map "no rn=N rows" → null to match PG semantics; check via cN.
  const median = (x: string | null | undefined, hasRows: bigint): number | null => {
    if (!hasRows) return null
    if (x === null || x === undefined || x === '0' || x === '') return null
    const n = Number(x)
    return Number.isFinite(n) ? Math.round(n) : null
  }
  return {
    firstOrders: first,
    secondBp: rate(r.c2),
    thirdBp: rate(r.c3),
    fourthBp: rate(r.c4),
    days12: median(r.d12, BigInt(r.c2 ?? '0')),
    days23: median(r.d23, BigInt(r.c3 ?? '0')),
    days34: median(r.d34, BigInt(r.c4 ?? '0')),
  }
}

// ---------------------------------------------------------------------------
// readFirstProductCascadeCH — the product of each customer's FIRST order →
// repeat behaviour cascade. PG used DISTINCT ON; CH uses argMin window-equivalent:
//   first_order:  argMin(vendor_order_id, (placed_at, vendor_order_id)) per customer
//   first_prod:   argMin(vendor_product_id, vendor_line_id) per (customer, first_order)
// Identical sort tiebreaks to PG.
// ---------------------------------------------------------------------------
export async function readFirstProductCascadeCH(
  workspaceId: string,
): Promise<{ rows: FactCascadeRow[]; totalCohort: bigint }> {
  const rows = await chQuery<Record<string, string>>(
    `WITH first_order AS (
       SELECT customer_ref,
              argMin(vendor_order_id, tuple(placed_at, vendor_order_id)) AS vendor_order_id
         FROM brain.connector_order_facts
        WHERE workspace_id = {workspace_id:String}
          AND customer_ref != ''
          AND ${CANCELLED_OK}
        GROUP BY customer_ref
     ),
     first_prod AS (
       SELECT fo.customer_ref                                                  AS customer_ref,
              argMin(li.vendor_product_id, li.vendor_line_id)                  AS pid
         FROM first_order fo
         JOIN brain.connector_line_item_facts li
              ON li.workspace_id = {workspace_id:String}
              AND li.vendor = 'SHOPIFY'
              AND li.vendor_order_id = fo.vendor_order_id
        WHERE li.vendor_product_id != ''
        GROUP BY fo.customer_ref
     ),
     prod_titles AS (
       SELECT vendor_product_id AS pid, any(title) AS title
         FROM brain.connector_product_facts
        WHERE workspace_id = {workspace_id:String}
        GROUP BY vendor_product_id
     ),
     li_titles AS (
       SELECT vendor_product_id AS pid, any(title) AS title
         FROM brain.connector_line_item_facts
        WHERE workspace_id = {workspace_id:String}
        GROUP BY vendor_product_id
     ),
     cust AS (
       SELECT customer_ref,
              count()                  AS orders,
              sum(${COHORT_NET})       AS ltv
         FROM brain.connector_order_facts
        WHERE workspace_id = {workspace_id:String}
          AND customer_ref != ''
          AND ${CANCELLED_OK}
        GROUP BY customer_ref
     )
     SELECT fp.pid                                                AS pid,
            coalesce(nullIf(pt.title, ''), nullIf(lt.title, ''), '(unknown)') AS title,
            toString(count())                                     AS first_customers,
            toString(countIf(c.orders >= 2))                      AS w2,
            toString(countIf(c.orders >= 3))                      AS w3,
            toString(countIf(c.orders >= 4))                      AS w4,
            toString(toInt64(round(avgOrNull(c.ltv))))            AS avg_ltv
       FROM first_prod fp
       JOIN cust c ON c.customer_ref = fp.customer_ref
       LEFT JOIN prod_titles pt ON pt.pid = fp.pid
       LEFT JOIN li_titles   lt ON lt.pid = fp.pid
      GROUP BY fp.pid, pt.title, lt.title
      ORDER BY count() DESC
      LIMIT 100`,
    { workspaceId },
  )
  const out: FactCascadeRow[] = rows.map((r) => ({
    productKey: r.pid,
    productTitle: r.title || '(unknown)',
    firstOrderCustomers: BigInt(r.first_customers ?? '0'),
    with2nd: BigInt(r.w2 ?? '0'),
    with3rd: BigInt(r.w3 ?? '0'),
    with4thPlus: BigInt(r.w4 ?? '0'),
    avgLtvMu: BigInt(r.avg_ltv ?? '0'),
    // CH path does not yet compute these; honest zeros (PG path is the authoritative source).
    sumAdditionalOrders: 0n,
    sumDaysToSecond: 0n,
    customersWith2ndInWindow: BigInt(r.w2 ?? '0'),
  }))
  const totalCohort = out.reduce((a, r) => a + r.firstOrderCustomers, 0n)
  return { rows: out, totalCohort }
}

// ---------------------------------------------------------------------------
// readDistributionsCH — per-product line-value mode vs mean (line value =
// quantity × unit_price_mu). PG `mode() WITHIN GROUP (ORDER BY v)` → CH
// `topK(1)(v)[1]` (most-frequent value). Lengths/joins mirror PG.
// ---------------------------------------------------------------------------
export async function readDistributionsCH(
  workspaceId: string,
): Promise<{ rows: FactDistRow[]; globalMode: bigint; globalMean: bigint }> {
  const rows = await chQuery<Record<string, string>>(
    `WITH prod_titles AS (
       SELECT vendor_product_id AS pid, any(title) AS title
         FROM brain.connector_product_facts
        WHERE workspace_id = {workspace_id:String}
        GROUP BY vendor_product_id
     )
     SELECT coalesce(nullIf(any(pt.title), ''), any(nullIf(li.title, '')), '(unknown)') AS product,
            toString(count())                                                AS orders,
            toString(arrayElement(topK(1)(li.quantity * li.price_mu), 1))    AS mode_mu,
            toString(toInt64(round(avg(li.quantity * li.price_mu))))         AS mean_mu
       FROM brain.connector_line_item_facts li
       LEFT JOIN prod_titles pt ON pt.pid = li.vendor_product_id
      WHERE li.workspace_id = {workspace_id:String}
        AND li.vendor_product_id != ''
      GROUP BY li.vendor_product_id, li.title
      ORDER BY count() DESC
      LIMIT 100`,
    { workspaceId },
  )
  const globals = await chQuery<Record<string, string>>(
    `SELECT toString(arrayElement(topK(1)(quantity * price_mu), 1))    AS mode_mu,
            toString(toInt64(round(avg(quantity * price_mu))))         AS mean_mu
       FROM brain.connector_line_item_facts
      WHERE workspace_id = {workspace_id:String}`,
    { workspaceId },
  )
  return {
    rows: rows.map((r) => ({
      product: r.product || '(unknown)',
      orders: BigInt(r.orders ?? '0'),
      modeMu: BigInt(r.mode_mu ?? '0'),
      meanMu: BigInt(r.mean_mu ?? '0'),
    })),
    globalMode: BigInt(globals[0]?.mode_mu ?? '0'),
    globalMean: BigInt(globals[0]?.mean_mu ?? '0'),
  }
}

// ---------------------------------------------------------------------------
// readDailyNetSalesCH — per-day series for the AreaChart on the analytics page.
// Direct port: group by toDate(placed_at). net_sales = gross − discount (PG
// definition is the same — see fact-analytics.ts:917).
// ---------------------------------------------------------------------------
export async function readDailyNetSalesCH(
  workspaceId: string,
  from: string,
  to: string,
): Promise<FactDailySalesRow[]> {
  const rows = await chQuery<{ day: string; net: string; orders: string }>(
    `SELECT formatDateTime(toDate(placed_at), '%Y-%m-%d')                   AS day,
            toString(sum(gross_sales_mu - discount_mu))                     AS net,
            toString(count())                                               AS orders
       FROM brain.connector_order_facts
      WHERE workspace_id = {workspace_id:String}
        AND ${CANCELLED_OK}
        AND placed_at >= {from:Date}
        AND placed_at <  addDays({to:Date}, 1)
      GROUP BY day
      ORDER BY day`,
    { workspaceId, params: { from, to } },
  )
  return rows.map((r) => ({
    date: r.day,
    netSalesMu: BigInt(r.net ?? '0'),
    orders: BigInt(r.orders ?? '0'),
  }))
}

// ---------------------------------------------------------------------------
// readDailyAcquisitionCH — per-day NC count, NC revenue, ad spend (split by
// META / GOOGLE), NC-CM2, CAC, CM2 per NC. PG's `firsts` CTE picks each
// customer's first order date and the self-join sums only the orders placed
// on that day. CH replicates it 1:1.
// ---------------------------------------------------------------------------
export async function readDailyAcquisitionCH(
  workspaceId: string,
  from: string,
  to: string,
): Promise<FactDailyAcquisitionRow[]> {
  const ncRows = await chQuery<{ day: string; nc: string; nc_rev: string }>(
    `WITH firsts AS (
       SELECT customer_ref, toDate(min(placed_at)) AS acq_date
         FROM brain.connector_order_facts
        WHERE workspace_id = {workspace_id:String}
          AND customer_ref != ''
          AND ${CANCELLED_OK}
        GROUP BY customer_ref
     )
     SELECT formatDateTime(f.acq_date, '%Y-%m-%d')                                       AS day,
            toString(count())                                                            AS nc,
            toString(sum(o.gross_sales_mu - o.discount_mu - o.tax_mu))                   AS nc_rev
       FROM firsts f
       JOIN brain.connector_order_facts o
            ON o.workspace_id = {workspace_id:String}
            AND o.customer_ref = f.customer_ref
            AND toDate(o.placed_at) = f.acq_date
      WHERE o.cancelled_at IS NULL
        AND lower(coalesce(o.financial_status,'')) NOT IN ('voided','refunded')
        AND f.acq_date >= {from:Date}
        AND f.acq_date <= {to:Date}
      GROUP BY day
      ORDER BY day`,
    { workspaceId, params: { from, to } },
  )
  const spendRows = await chQuery<{ day: string; vendor: string; spend: string }>(
    `SELECT formatDateTime(date, '%Y-%m-%d')   AS day,
            vendor                              AS vendor,
            toString(sum(spend_mu))             AS spend
       FROM brain.connector_ad_spend_facts
      WHERE workspace_id = {workspace_id:String}
        AND date >= {from:Date}
        AND date <= {to:Date}
      GROUP BY day, vendor`,
    { workspaceId, params: { from, to } },
  )
  const spendMap = new Map<string, { meta: bigint; google: bigint }>()
  for (const row of spendRows) {
    const entry = spendMap.get(row.day) ?? { meta: 0n, google: 0n }
    const v = BigInt(row.spend ?? '0')
    if (row.vendor === 'META') entry.meta = v
    else if (row.vendor === 'GOOGLE') entry.google = v
    spendMap.set(row.day, entry)
  }
  return ncRows.map((r) => {
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
}

// ---------------------------------------------------------------------------
// readDistributionsGraphPointsCH — pulls raw per-line values for the density
// curve; bucketing is identical TS logic (40 even buckets across the range).
// ---------------------------------------------------------------------------
export async function readDistributionsGraphPointsCH(
  workspaceId: string,
  metric: 'sales' | 'cm1',
): Promise<FactDistGraphPoint[]> {
  // sales: qty × unit_price_mu. cm1: qty × unit_price_mu − qty × cost_mu (per-product cost).
  // PG uses `LEFT JOIN connector_product_facts ON workspace_id + vendor_product_id`.
  const sql =
    metric === 'cm1'
      ? `SELECT toString(li.quantity * li.price_mu
                         - li.quantity * coalesce(pf.cost_mu, 0)) AS v
           FROM brain.connector_line_item_facts li
           LEFT JOIN brain.connector_product_facts pf
                  ON pf.workspace_id = li.workspace_id
                 AND pf.vendor_product_id = li.vendor_product_id
          WHERE li.workspace_id = {workspace_id:String}
            AND li.vendor_product_id != ''
          LIMIT 2000`
      : `SELECT toString(quantity * price_mu) AS v
           FROM brain.connector_line_item_facts
          WHERE workspace_id = {workspace_id:String}
            AND vendor_product_id != ''
          LIMIT 2000`
  const res = await chQuery<{ v: string }>(sql, { workspaceId })
  if (!res.length) return []
  const values = res.map((r) => BigInt(r.v ?? '0'))
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
}

// ---------------------------------------------------------------------------
// readCalendarReportCH — last-90 buckets of revenue / orders / new_customers /
// ad spend at day|week|month grain. PG used `date_trunc('${grain}', …)`; CH
// uses `toStartOf{Day,Week,Month}` (Monday-week to match PG ISO week).
// ---------------------------------------------------------------------------
export async function readCalendarReportCH(
  workspaceId: string,
  grain: 'day' | 'week' | 'month',
): Promise<FactCalendarRow[]> {
  const truncFn =
    grain === 'week' ? 'toMonday' : grain === 'month' ? 'toStartOfMonth' : 'toDate'
  const rev = await chQuery<Record<string, string>>(
    `WITH firsts AS (
       SELECT customer_ref, min(placed_at) AS acq
         FROM brain.connector_order_facts
        WHERE workspace_id = {workspace_id:String}
          AND customer_ref != ''
          AND ${CANCELLED_OK}
        GROUP BY customer_ref
     )
     SELECT formatDateTime(${truncFn}(toDate(o.placed_at)), '%Y-%m-%d')      AS period,
            toString(sum(o.gross_sales_mu - o.discount_mu - o.tax_mu))       AS revenue,
            toString(count())                                                 AS orders,
            toString(countIf(f.acq = o.placed_at))                           AS new_customers
       FROM brain.connector_order_facts o
       LEFT JOIN firsts f ON f.customer_ref = o.customer_ref
      WHERE o.workspace_id = {workspace_id:String}
        AND o.cancelled_at IS NULL
        AND lower(coalesce(o.financial_status,'')) NOT IN ('voided','refunded')
      GROUP BY period
      ORDER BY period DESC
      LIMIT 90`,
    { workspaceId },
  )
  const spend = await chQuery<Record<string, string>>(
    `SELECT formatDateTime(${truncFn}(date), '%Y-%m-%d')   AS period,
            toString(sum(spend_mu))                         AS spend
       FROM brain.connector_ad_spend_facts
      WHERE workspace_id = {workspace_id:String}
      GROUP BY period`,
    { workspaceId },
  )
  const spendByPeriod = new Map(spend.map((r) => [r.period, BigInt(r.spend ?? '0')]))
  return rev.map((r) => ({
    periodKey: r.period,
    revenueMu: BigInt(r.revenue ?? '0'),
    orders: BigInt(r.orders ?? '0'),
    newCustomers: BigInt(r.new_customers ?? '0'),
    spendMu: spendByPeriod.get(r.period) ?? 0n,
  }))
}

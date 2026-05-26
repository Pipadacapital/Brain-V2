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
  FactStoreSummary, FactPnl, FactMarketing, FactCogs, FactProductRow,
} from './fact-analytics.js'

// PG-parity filter for "realized" / "non-cancelled" orders:
//   cancelled_at IS NULL AND financial_status NOT IN ('voided','refunded')
// CH: same predicate (cancelled_at was added by the Phase-6 one-shot ALTER).
const CANCELLED_OK = `cancelled_at IS NULL AND financial_status NOT IN ('voided','refunded')`

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

export async function readStoreSummaryCH(workspaceId: string): Promise<FactStoreSummary> {
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
     WHERE workspace_id = {workspace_id:String}`,
    { workspaceId },
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
  const realizedRevenue =
    BigInt(r.realized_gross ?? '0') - BigInt(r.realized_discount ?? '0') - BigInt(r.realized_tax ?? '0')
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
async function readAdSpendCH(workspaceId: string): Promise<{ meta: bigint; google: bigint; currency: string }> {
  const rows = await chQuery<ChAdSpendRow>(
    `SELECT vendor, toString(sum(spend_mu)) AS spend, any(currency_code) AS currency_code
       FROM brain.connector_ad_spend_facts
      WHERE workspace_id = {workspace_id:String}
      GROUP BY vendor`,
    { workspaceId },
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
export async function readPnlCH(workspaceId: string): Promise<FactPnl> {
  const store = await readStoreSummaryCH(workspaceId)
  const spend = await readAdSpendCH(workspaceId)
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
export async function readMarketingCH(workspaceId: string): Promise<FactMarketing> {
  const store = await readStoreSummaryCH(workspaceId)
  const spend = await readAdSpendCH(workspaceId)

  // New-customer net revenue = sum of (gross - discount - tax) for the first order of
  // each non-cancelled customer (cancelled_at IS NULL AND financial_status NOT IN voided/refunded).
  const ncRows = await chQuery<{ nc_rev: string | null; nc_count: string | null }>(
    `WITH ranked AS (
       SELECT customer_ref,
              row_number() OVER (PARTITION BY customer_ref ORDER BY placed_at, vendor_order_id) AS rn,
              (gross_sales_mu - discount_mu - tax_mu) AS net_mu
         FROM brain.connector_order_facts
        WHERE workspace_id = {workspace_id:String}
          AND customer_ref != ''
          AND cancelled_at IS NULL
          AND financial_status NOT IN ('voided','refunded')
     )
     SELECT toString(sumIf(net_mu, rn = 1)) AS nc_rev,
            toString(countIf(rn = 1))     AS nc_count
       FROM ranked`,
    { workspaceId },
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
export async function readCogsCH(workspaceId: string): Promise<FactCogs> {
  const rows = await chQuery<{ cogs: string | null; covered: string | null; total: string | null }>(
    `SELECT
       toString(sumIf(li.quantity * pf.cost_mu, pf.cost_mu > 0)) AS cogs,
       toString(countIf(pf.cost_mu > 0))                         AS covered,
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
     WHERE li.workspace_id = {workspace_id:String}`,
    { workspaceId, skipFinal: true },  // we did argMax manually for pf; FINAL on li is fine but the join blocks it
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
    { workspaceId, skipFinal: true },
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
// readShipmentAnalyticsCH, readCohortsCH, readLtvCH, readPincodesCH, readCodPrepaidCH,
// readLifecycleStatesCH, readOrderTimingsCH, readFirstProductCascadeCH,
// readDistributionsCH, readCalendarReportCH, readDailyNetSalesCH, readDailyAcquisitionCH,
// readDistributionsGraphPointsCH. Each one flag-routes via fact-analytics.ts and
// must pass a per-function parity test before READ_FROM_CH=true is the default.

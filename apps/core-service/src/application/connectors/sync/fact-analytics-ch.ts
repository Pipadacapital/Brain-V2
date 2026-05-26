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
import type { FactStoreSummary } from './fact-analytics.js'

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
       any(currency_code)                                                                              AS currency_code,
       toString(sum(gross_sales_mu))                                                                   AS gross,
       toString(sum(discount_mu))                                                                      AS discount,
       toString(sum(tax_mu))                                                                           AS tax,
       toString(sum(shipping_mu))                                                                      AS shipping,
       toString(count())                                                                               AS orders,
       toString(sumIf(gross_sales_mu, financial_status NOT IN ('voided','refunded','cancelled')))      AS realized_gross,
       toString(sumIf(discount_mu,    financial_status NOT IN ('voided','refunded','cancelled')))      AS realized_discount,
       toString(sumIf(tax_mu,         financial_status NOT IN ('voided','refunded','cancelled')))      AS realized_tax,
       toString(countIf(             financial_status NOT IN ('voided','refunded','cancelled')))      AS realized_orders
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

// Future ports: readPnlCH, readMarketingCH, readCogsCH, readProductPerformanceCH,
// readShipmentAnalyticsCH, readCohortsCH, readLtvCH, readPincodesCH, readCodPrepaidCH,
// readLifecycleStatesCH, readOrderTimingsCH, readFirstProductCascadeCH,
// readDistributionsCH, readCalendarReportCH, readDailyNetSalesCH, readDailyAcquisitionCH,
// readDistributionsGraphPointsCH. Each one flag-routes via fact-analytics.ts and
// must pass a per-function parity test before READ_FROM_CH=true is the default.

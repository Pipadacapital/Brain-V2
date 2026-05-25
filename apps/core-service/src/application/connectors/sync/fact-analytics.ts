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
import { withWorkspace } from '../../../infrastructure/db/workspace-context.js'

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

const CANCELLED = "(cancelled_at IS NULL AND COALESCE(financial_status,'') NOT IN ('voided','refunded'))"

/**
 * Store summary + revenue ladder from connector_order_facts. Realized revenue
 * excludes cancelled/refunded orders (the honest billing base). Net of tax subtracts
 * the per-order tax (which the per-SKU line items roll up into total_tax_mu).
 */
export async function readStoreSummary(workspaceId: string): Promise<FactStoreSummary> {
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

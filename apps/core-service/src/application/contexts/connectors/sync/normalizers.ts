/**
 * Per-vendor normalizers — raw provider JSON → canonical ACL facts (Slice E).
 *
 * @paradigm sql (pure deterministic mapping; NO network, NO ML, NO LLM)
 *
 * The raw shapes are the SOURCE OF TRUTH from the legacy code (persona P-005):
 *   Shopify: Admin GraphQL ORDERS_QUERY / PRODUCTS_QUERY
 *     (legacy project/backend/src/lib/shopify/sync.ts) — orders.edges[].node with
 *     totalPriceSet.shopMoney.amount (decimal STRING), lineItems.edges[].node.
 *   Meta:   /act_{id}/insights rows — campaign_id, campaign_name, impressions,
 *     clicks, spend (decimal string), date_start (legacy lib/integrations/meta.ts).
 *   Google: GAQL rows — campaign.id, campaign.name, metrics.cost_micros,
 *     segments.date, metrics.impressions, metrics.clicks (legacy google.ts).
 *
 * These functions are pure: a fixture in → facts out. No token, no IO, no logging.
 */

import {
  decimalStringToMinorUnits,
  microsToMinorUnits,
  classifyPaymentMethod,
  resolveGstSlabBp,
  customerRef,
  type OrderFact,
  type LineItemFact,
  type ProductFact,
  type AdSpendFact,
} from './acl.js'

// ---------------------------------------------------------------------------
// Shopify GraphQL order node (the legacy ORDERS_QUERY shape — minimal typing).
// ---------------------------------------------------------------------------

interface ShopifyMoney {
  shopMoney?: { amount?: string; currencyCode?: string }
}
interface ShopifyLineNode {
  id?: string
  title?: string
  quantity?: number
  sku?: string | null
  originalUnitPriceSet?: ShopifyMoney
  variant?: { product?: { id?: string } } | null
}
export interface ShopifyOrderNode {
  id?: string
  name?: string
  email?: string | null
  totalPriceSet?: ShopifyMoney
  subtotalPriceSet?: ShopifyMoney
  totalTaxSet?: ShopifyMoney
  totalDiscountsSet?: ShopifyMoney
  totalShippingPriceSet?: ShopifyMoney
  currencyCode?: string
  displayFinancialStatus?: string
  displayFulfillmentStatus?: string
  processedAt?: string | null
  cancelledAt?: string | null
  paymentGatewayNames?: string[]
  customer?: { id?: string } | null
  shippingAddress?: { zip?: string | null; city?: string | null } | null
  lineItems?: { edges?: Array<{ node?: ShopifyLineNode }> }
}

export interface ShopifyProductNode {
  id?: string
  title?: string
  productType?: string
  status?: string
}

function moneyAmount(m?: ShopifyMoney): string {
  return m?.shopMoney?.amount ?? '0'
}

/** Normalize one Shopify order node → an OrderFact + its LineItemFacts. */
export function normalizeShopifyOrder(node: ShopifyOrderNode): { order: OrderFact; lineItems: LineItemFact[] } {
  const currency = node.currencyCode ?? node.totalPriceSet?.shopMoney?.currencyCode ?? 'INR'
  const vendorOrderId = String(node.id ?? '')

  const order: OrderFact = {
    vendor: 'SHOPIFY',
    vendorOrderId,
    orderNumber: node.name ?? null,
    financialStatus: node.displayFinancialStatus ?? null,
    fulfillmentStatus: node.displayFulfillmentStatus ?? null,
    paymentMethod: classifyPaymentMethod(node.paymentGatewayNames),
    currencyCode: currency,
    grossSalesMu: decimalStringToMinorUnits(moneyAmount(node.subtotalPriceSet) !== '0'
      ? moneyAmount(node.subtotalPriceSet)
      : moneyAmount(node.totalPriceSet), currency),
    totalDiscountMu: decimalStringToMinorUnits(moneyAmount(node.totalDiscountsSet), currency),
    totalTaxMu: decimalStringToMinorUnits(moneyAmount(node.totalTaxSet), currency),
    shippingMu: decimalStringToMinorUnits(moneyAmount(node.totalShippingPriceSet), currency),
    customerRef: customerRef(node.customer?.id),
    deliveryPincode: node.shippingAddress?.zip ?? null,
    deliveryCity: node.shippingAddress?.city ?? null,
    processedAt: node.processedAt ?? null,
    cancelledAt: node.cancelledAt ?? null,
  }

  const edges = node.lineItems?.edges ?? []
  const lineItems: LineItemFact[] = edges.map((e, idx) => {
    const ln = e.node ?? {}
    return {
      vendor: 'SHOPIFY' as const,
      vendorOrderId,
      vendorLineId: String(ln.id ?? `${vendorOrderId}:${idx}`),
      sku: ln.sku ?? null,
      title: ln.title ?? null,
      quantity: BigInt(ln.quantity ?? 0),
      unitPriceMu: decimalStringToMinorUnits(moneyAmount(ln.originalUnitPriceSet), currency),
      gstSlabBp: resolveGstSlabBp(),
    }
  })

  return { order, lineItems }
}

/** Normalize one Shopify product node → a ProductFact. */
export function normalizeShopifyProduct(node: ShopifyProductNode): ProductFact {
  return {
    vendor: 'SHOPIFY',
    vendorProductId: String(node.id ?? ''),
    title: node.title ?? null,
    productType: node.productType ?? null,
    status: node.status ?? null,
  }
}

// ---------------------------------------------------------------------------
// Meta insights row (legacy lib/integrations/meta.ts MetaInsightRow shape).
// ---------------------------------------------------------------------------

export interface MetaInsightRaw {
  campaign_id?: string
  campaign_name?: string
  impressions?: string | number
  clicks?: string | number
  spend?: string | number
  date_start?: string
  date_stop?: string
  currency?: string
}

export function normalizeMetaSpend(row: MetaInsightRaw, accountCurrency = 'INR'): AdSpendFact {
  const currency = row.currency ?? accountCurrency
  return {
    vendor: 'META',
    campaignId: String(row.campaign_id ?? ''),
    campaignName: row.campaign_name ?? null,
    spendDate: row.date_start ?? row.date_stop ?? '',
    spendMu: decimalStringToMinorUnits(row.spend ?? '0', currency),
    impressions: BigInt(parseInt(String(row.impressions ?? '0'), 10) || 0),
    clicks: BigInt(parseInt(String(row.clicks ?? '0'), 10) || 0),
    currencyCode: currency,
  }
}

// ---------------------------------------------------------------------------
// Google Ads GAQL row (legacy lib/integrations/google.ts GoogleAdsMetricRow shape).
// GAQL returns cost in micros (metrics.cost_micros) — 1e-6 of the currency unit.
// ---------------------------------------------------------------------------

export interface GoogleAdsRaw {
  campaign?: { id?: string; name?: string }
  campaignId?: string
  campaignName?: string
  metrics?: { cost_micros?: string | number; impressions?: string | number; clicks?: string | number; costMicros?: string | number }
  costMicros?: string | number
  impressions?: string | number
  clicks?: string | number
  segments?: { date?: string }
  date?: string
}

export function normalizeGoogleSpend(row: GoogleAdsRaw, customerCurrency = 'INR'): AdSpendFact {
  const campaignId = String(row.campaign?.id ?? row.campaignId ?? '')
  const campaignName = row.campaign?.name ?? row.campaignName ?? null
  const micros = row.metrics?.cost_micros ?? row.metrics?.costMicros ?? row.costMicros ?? '0'
  const impressions = row.metrics?.impressions ?? row.impressions ?? '0'
  const clicks = row.metrics?.clicks ?? row.clicks ?? '0'
  const date = row.segments?.date ?? row.date ?? ''
  return {
    vendor: 'GOOGLE',
    campaignId,
    campaignName,
    spendDate: date,
    spendMu: microsToMinorUnits(micros, customerCurrency),
    impressions: BigInt(parseInt(String(impressions), 10) || 0),
    clicks: BigInt(parseInt(String(clicks), 10) || 0),
    currencyCode: customerCurrency,
  }
}

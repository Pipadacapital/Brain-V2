/**
 * Connector sync + fact-analytics barrel (Slice E).
 * Exposed to the gateway via @brain/core-connectors (the connectors index re-exports).
 */

export { syncConnector, type SyncResult, type SyncDeps } from './sync-use-cases.js'
export {
  type ConnectorFetch,
  type SyncWindow,
  type ShopifyPull,
  LiveConnectorFetch,
  defaultConnectorFetch,
  defaultWindow,
  shopifyBackfillDays,
  adsBackfillDays,
} from './provider-fetch.js'
export {
  decimalStringToMinorUnits,
  microsToMinorUnits,
  classifyPaymentMethod,
  resolveGstSlabBp,
  customerRef,
  INDIA_DEFAULT_GST_BP,
  type OrderFact,
  type LineItemFact,
  type ProductFact,
  type AdSpendFact,
} from './acl.js'
export {
  normalizeShopifyOrder,
  normalizeShopifyProduct,
  normalizeMetaSpend,
  normalizeGoogleSpend,
  type ShopifyOrderNode,
  type ShopifyProductNode,
  type MetaInsightRaw,
  type GoogleAdsRaw,
} from './normalizers.js'
export {
  readStoreSummary,
  readPnl,
  readMarketing,
  type FactStoreSummary,
  type FactPnl,
  type FactMarketing,
} from './fact-analytics.js'

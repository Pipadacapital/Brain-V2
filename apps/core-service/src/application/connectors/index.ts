/**
 * Connector OAuth + custody barrel (Slice D).
 *
 * v1 internal contract path: @brain/core-connectors
 * The gateway imports these use-cases in-process (Phase-0) and calls them with the
 * VERIFIED sub + workspace from the JWT claim. core-service owns the business logic;
 * the token VALUE never leaves the custody backing.
 */

export {
  initiateConnect,
  completeCallback,
  listConnectors,
  disconnect,
  ConnectorError,
  type ConnectorDeps,
  type CallbackResult,
  type ConnectorStatusRow,
} from './connector-use-cases.js'

export {
  generateNonce,
  hashState,
  createOAuthState,
  validateAndConsumeOAuthState,
  type ConnectorVendor,
  type OAuthStateRecord,
} from './oauth-state.js'

export {
  buildAuthUrl,
  exchangeCode,
  validateShopifyHmac,
  isValidShopDomain,
  normalizeShopDomain,
  fetchProviderHttp,
  SHOPIFY_SCOPES,
  META_SCOPES,
  GOOGLE_SCOPES,
  type ProviderHttp,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type ExchangedToken,
} from './provider-config.js'

export {
  selectCustody,
  type CustodyBacking,
} from '../../infrastructure/secrets/custody-factory.js'

export {
  type Credential,
  type CredentialCustody,
  CredentialNotFoundError,
} from '../../infrastructure/secrets/credential-custody.js'

export { LocalAesGcmCustody } from '../../infrastructure/secrets/local-aesgcm-custody.js'
export { HeldProductionCustody, NotImplementedCustodyError } from '../../infrastructure/secrets/production-custody.js'

// Slice E — connector data ingestion (sync + ACL + normalizers + fact-analytics read).
export {
  syncConnector,
  type SyncResult,
  type SyncDeps,
  type ConnectorFetch,
  type SyncWindow,
  type ShopifyPull,
  LiveConnectorFetch,
  defaultConnectorFetch,
  defaultWindow,
  shopifyBackfillDays,
  adsBackfillDays,
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
  normalizeShopifyOrder,
  normalizeShopifyProduct,
  normalizeMetaSpend,
  normalizeGoogleSpend,
  type ShopifyOrderNode,
  type ShopifyProductNode,
  type MetaInsightRaw,
  type GoogleAdsRaw,
  readStoreSummary,
  readPnl,
  readMarketing,
  readIntegrations,
  readCogs,
  readProductPerformance,
  readWorkspaceMembers,
  readWorkspaceSettings,
  readShipmentAnalytics,
  readPincodes,
  readCodPrepaid,
  readCohorts,
  readLtv,
  readLifecycleStates,
  readOrderTimings,
  readFirstProductCascade,
  readDistributions,
  readCalendarReport,
  readDailyNetSales,
  readDailyAcquisition,
  readDistributionsGraphPoints,
  type FactStoreSummary,
  type FactPnl,
  type FactMarketing,
  type FactIntegrationRow,
  type FactCogs,
  type FactProductRow,
  type FactMemberRow,
  type FactWorkspaceSettings,
  type FactShipmentAnalytics,
  type FactPincodeRow,
  type FactCodPrepaid,
  type FactCohortRow,
  type FactLtv,
  type FactLifecycle,
  type FactOrderTimings,
  type FactCascadeRow,
  type FactDistRow,
  type FactCalendarRow,
  type FactDailySalesRow,
  type FactDailyAcquisitionRow,
  type FactDistGraphPoint,
} from './sync/index.js'

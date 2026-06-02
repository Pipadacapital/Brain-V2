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

// Liveness probes for the data planes (gateway /ready check). pingCh is
// re-exported here so the gateway doesn't take a direct @brain/lib-clickhouse-ts
// dependency (core-connectors already depends on it).
export { pingDb } from '../../../infrastructure/db/workspace-context.js'
export { pingCh } from '@brain/lib-clickhouse-ts'

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
} from '../../../infrastructure/secrets/custody-factory.js'

export {
  type Credential,
  type CredentialCustody,
  CredentialNotFoundError,
} from '../../../infrastructure/secrets/credential-custody.js'

export { LocalAesGcmCustody } from '../../../infrastructure/secrets/local-aesgcm-custody.js'
export { HeldProductionCustody, NotImplementedCustodyError } from '../../../infrastructure/secrets/production-custody.js'

// Boot-time presence assert (CF-TS-FAILFAST-1 / CF-TS-NEVERLOG-1).
// The gateway boot block calls this alongside assertBootableAuthConfig.
export { assertShopifyOAuthSecretsPresent } from './boot-assert.js'

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
  readCogsSettings,
  type CogsSettings,
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
  readPnlPeriodGrid,
  readDailyNetSales,
  readDailyAcquisition,
  readDistributionsGraphPoints,
  readShipmentRows,
  type FactShipmentRow,
  type FactShipmentPage,
  type ShipmentRowFiltersLocal,
  type PnlGranularity,
  type FactPnlPeriodRow,
  type FactStoreSummary,
  type FactPnl,
  type FactMarketing,
  type FactIntegrationRow,
  type FactCogs,
  type FactProductRow,
  type ReadProductPerformanceFilters,
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
  // Team CRUD mutations (parity-38 feat-parity-w6b):
  listTeamPendingInvitations,
  inviteTeamMember,
  changeTeamMemberRole,
  removeTeamMember,
  revokeTeamInvite,
  transferTeamOwnership,
  type FactPendingInvitationRow,
  // Email/SMS performance read (parity-38):
  readEmailPerformance,
  type FactEmailPerfRow,
} from './sync/index.js'

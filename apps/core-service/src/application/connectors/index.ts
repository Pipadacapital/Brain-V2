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

/**
 * Connector OAuth use-cases (Slice D): initiate · completeCallback · list · disconnect.
 *
 * @paradigm io (OAuth handshake + deterministic DB persistence; no ML, no LLM)
 *
 * core-service owns the connector business logic (canon: the gateway carries none).
 * Every DB touch goes through the Child-1 withWorkspace/withSuperadmin Single-Primitive.
 * Tokens are persisted ONLY via CredentialCustody (encrypted at rest, RLS-scoped); the
 * token VALUE never appears in a log, error, return value, or status payload.
 *
 * Idempotency (CF-C3-style): completeCallback UPSERTs connector_connections keyed
 * (workspace_id, vendor) and custody.put UPSERTs connector_credentials keyed
 * (workspace_id, vendor) — a replayed callback re-writes the same rows, never duplicates.
 */

import type { PoolClient } from 'pg'
import { packageLogger } from '@brain/lib-logger'
import { withWorkspace } from '../../infrastructure/db/workspace-context.js'
import { selectCustody } from '../../infrastructure/secrets/custody-factory.js'
import type { CredentialCustody } from '../../infrastructure/secrets/credential-custody.js'

// Per-package logger — every line emitted inside this module carries
// `package: 'core-connectors'` so an on-call sees WHICH package failed
// inside the api-gateway service. CRITICAL for OAuth flows: when a
// Shopify/Meta/Google callback fails, this binding pins the failure to
// THIS package, not "somewhere in the gateway."
//
// SAFETY: this module handles OAuth tokens. NEVER log the token VALUE itself;
// the canonical PII redact list (packages/lib-logger/src/redact-paths.ts)
// scrubs `access_token`, `refresh_token`, `credential.content`, etc. — but
// don't rely on redact: log shapes that don't include the secret in the
// first place (vendor, workspace_id_prefix, error code, duration_ms).
const log = packageLogger('api-gateway', 'core-connectors')
void log
import {
  createOAuthState,
  validateAndConsumeOAuthState,
  generateNonce,
  type ConnectorVendor,
} from './oauth-state.js'
import {
  buildAuthUrl,
  exchangeCode,
  validateShopifyHmac,
  isValidShopDomain,
  normalizeShopDomain,
  fetchProviderHttp,
  type ProviderHttp,
} from './provider-config.js'

export class ConnectorError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION'
      | 'INVALID_SHOP_DOMAIN'
      | 'INVALID_STATE'
      | 'HMAC_INVALID'
      | 'EXCHANGE_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'ConnectorError'
  }
}

// Injectable deps for unit tests (default to the real primitives).
export interface ConnectorDeps {
  withWorkspace: typeof withWorkspace
  custody: CredentialCustody
  http: ProviderHttp
}
function defaultDeps(): ConnectorDeps {
  return { withWorkspace, custody: selectCustody(), http: fetchProviderHttp }
}

const ALL_VENDORS: ConnectorVendor[] = ['SHOPIFY', 'META', 'GOOGLE']

// ---------------------------------------------------------------------------
// initiateConnect — create the CSRF state + return the provider consent URL.
// ---------------------------------------------------------------------------
export async function initiateConnect(
  params: {
    vendor: ConnectorVendor
    workspaceId: string
    userId: string
    shopDomain?: string | null
  },
  deps: Partial<ConnectorDeps> = {},
): Promise<{ authUrl: string }> {
  let shopDomain: string | null = null
  if (params.vendor === 'SHOPIFY') {
    if (!params.shopDomain) {
      throw new ConnectorError('VALIDATION', 'Shopify connect requires a store domain.')
    }
    shopDomain = normalizeShopDomain(params.shopDomain)
    if (!isValidShopDomain(shopDomain)) {
      throw new ConnectorError('INVALID_SHOP_DOMAIN', 'Invalid Shopify store domain.')
    }
  }

  const state = generateNonce()
  await createOAuthState({
    state,
    vendor: params.vendor,
    workspaceId: params.workspaceId,
    userId: params.userId,
    shopDomain,
  })

  const authUrl = buildAuthUrl(params.vendor, { state, shopDomain })
  return { authUrl }
}

// ---------------------------------------------------------------------------
// completeCallback — validate state (CSRF) + [Shopify] HMAC, exchange code, persist
// token via custody (encrypted), UPSERT the connection. Idempotent + RLS-scoped.
// Returns NON-secret outcome only (never the token).
// ---------------------------------------------------------------------------
export interface CallbackResult {
  vendor: ConnectorVendor
  workspaceId: string
  status: 'CONNECTED'
  accountRef: string | null
}

export async function completeCallback(
  params: {
    vendor: ConnectorVendor
    code: string
    state: string
    /** full callback query (Shopify HMAC validation needs hmac/shop/host/timestamp). */
    query?: Record<string, string>
  },
  deps: Partial<ConnectorDeps> = {},
): Promise<CallbackResult> {
  const d = { ...defaultDeps(), ...deps }
  if (!params.code || !params.state) {
    throw new ConnectorError('VALIDATION', 'callback requires code and state.')
  }

  // 1. CSRF — validate + consume the one-time state nonce.
  const stateRecord = await validateAndConsumeOAuthState(params.state, params.vendor)
  if (!stateRecord) {
    throw new ConnectorError('INVALID_STATE', 'OAuth state is invalid, expired, or already used.')
  }

  // 2. Shopify only — validate the callback HMAC (timing-safe) before exchange.
  if (params.vendor === 'SHOPIFY') {
    if (!params.query || !validateShopifyHmac(params.query)) {
      throw new ConnectorError('HMAC_INVALID', 'Shopify callback HMAC validation failed.')
    }
  }

  // 3. Exchange the code for a token (through the ProviderHttp seam).
  let exchanged
  try {
    exchanged = await exchangeCode(params.vendor, params.code, d.http, {
      shopDomain: stateRecord.shopDomain,
    })
  } catch (err) {
    // Generic message — never echo provider body or any token.
    throw new ConnectorError(
      'EXCHANGE_FAILED',
      `OAuth code exchange failed for ${params.vendor}.`,
    )
  }

  // 4. Persist the token ENCRYPTED via custody (idempotent UPSERT, RLS-scoped).
  await d.custody.put(stateRecord.workspaceId, params.vendor, exchanged.content)

  // 5. UPSERT the NON-secret connection row (idempotent, RLS-scoped). NO token here.
  await d.withWorkspace(stateRecord.workspaceId, async (tx: PoolClient) => {
    await tx.query(
      `INSERT INTO connector_connections
         (workspace_id, vendor, status, scopes, account_ref, external_metadata,
          token_expires_at, connected_at, last_sync_error, updated_at)
       VALUES ($1, $2, 'CONNECTED', $3, $4, $5::jsonb, $6, now(), NULL, now())
       ON CONFLICT (workspace_id, vendor) DO UPDATE
         SET status = 'CONNECTED',
             scopes = EXCLUDED.scopes,
             account_ref = EXCLUDED.account_ref,
             external_metadata = EXCLUDED.external_metadata,
             token_expires_at = EXCLUDED.token_expires_at,
             connected_at = COALESCE(connector_connections.connected_at, now()),
             last_sync_error = NULL,
             updated_at = now()`,
      [
        stateRecord.workspaceId,
        params.vendor,
        exchanged.scopes,
        exchanged.accountRef,
        JSON.stringify(exchanged.externalMetadata),
        exchanged.tokenExpiresAt,
      ],
    )
  })

  return {
    vendor: params.vendor,
    workspaceId: stateRecord.workspaceId,
    status: 'CONNECTED',
    accountRef: exchanged.accountRef,
  }
}

// ---------------------------------------------------------------------------
// listConnectors — per-vendor status for /settings/integrations. NEVER the token.
// TOKEN_EXPIRED is derived from token_expires_at < now(). A vendor with no row is
// reported NOT_CONNECTED. Data-ingestion is DEFERRED → last_sync_at stays null →
// "Connected · sync pending".
// ---------------------------------------------------------------------------
export interface ConnectorStatusRow {
  vendor: ConnectorVendor
  status: 'NOT_CONNECTED' | 'CONNECTED' | 'TOKEN_EXPIRED' | 'ERROR' | 'DISCONNECTED'
  scopes: string[]
  accountRef: string | null
  tokenExpiresAt: string | null
  lastSyncAt: string | null
  lastSyncError: string | null
  syncPending: boolean
}

export async function listConnectors(
  workspaceId: string,
  deps: Partial<Pick<ConnectorDeps, 'withWorkspace'>> = {},
): Promise<ConnectorStatusRow[]> {
  const run = deps.withWorkspace ?? withWorkspace
  const rows = await run(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{
      vendor: ConnectorVendor
      status: ConnectorStatusRow['status']
      scopes: string[]
      account_ref: string | null
      token_expires_at: Date | null
      last_sync_at: Date | null
      last_sync_error: string | null
    }>(
      `SELECT vendor, status, scopes, account_ref, token_expires_at,
              last_sync_at, last_sync_error
         FROM connector_connections
        WHERE workspace_id = $1`,
      [workspaceId],
    )
    return res.rows
  })

  const byVendor = new Map(rows.map((r) => [r.vendor, r]))
  const now = Date.now()
  return ALL_VENDORS.map((vendor) => {
    const r = byVendor.get(vendor)
    if (!r) {
      return {
        vendor,
        status: 'NOT_CONNECTED' as const,
        scopes: [],
        accountRef: null,
        tokenExpiresAt: null,
        lastSyncAt: null,
        lastSyncError: null,
        syncPending: false,
      }
    }
    // Derive TOKEN_EXPIRED at read time (a stored CONNECTED with a past expiry).
    let status = r.status
    if (status === 'CONNECTED' && r.token_expires_at && new Date(r.token_expires_at).getTime() < now) {
      status = 'TOKEN_EXPIRED'
    }
    return {
      vendor,
      status,
      scopes: r.scopes ?? [],
      accountRef: r.account_ref,
      tokenExpiresAt: r.token_expires_at ? new Date(r.token_expires_at).toISOString() : null,
      lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
      lastSyncError: r.last_sync_error,
      // Data-ingestion deferred: a connected connector with no sync yet → "sync pending".
      syncPending: status === 'CONNECTED' && !r.last_sync_at,
    }
  })
}

// ---------------------------------------------------------------------------
// disconnect — seal (delete) the credential + mark the connection DISCONNECTED.
// ---------------------------------------------------------------------------
export async function disconnect(
  params: { vendor: ConnectorVendor; workspaceId: string },
  deps: Partial<Pick<ConnectorDeps, 'withWorkspace' | 'custody'>> = {},
): Promise<{ vendor: ConnectorVendor; status: 'DISCONNECTED' }> {
  const run = deps.withWorkspace ?? withWorkspace
  const custody = deps.custody ?? selectCustody()
  await custody.seal(params.workspaceId, params.vendor)
  await run(params.workspaceId, async (tx: PoolClient) => {
    await tx.query(
      `UPDATE connector_connections
          SET status = 'DISCONNECTED', token_expires_at = NULL, updated_at = now()
        WHERE workspace_id = $1 AND vendor = $2`,
      [params.workspaceId, params.vendor],
    )
  })
  return { vendor: params.vendor, status: 'DISCONNECTED' }
}

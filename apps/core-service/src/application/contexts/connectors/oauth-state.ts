/**
 * OAuth state / CSRF nonce (Slice D). Ported from legacy lib/integrations/oauth-state.ts.
 *
 * @paradigm sql (deterministic crypto + DB transactions; no ML, no LLM)
 *
 * The state parameter defends the OAuth callback against CSRF: a random nonce is
 * generated at initiate, its sha256 hash is persisted (the RAW nonce is never stored),
 * and at callback the returned state is hashed + matched + CONSUMED (one-time, deleted).
 * 10-minute TTL. Expired states are pruned on create.
 *
 * Persistence runs on the local dev DB via withSuperadmin: the state row exists across
 * the redirect boundary (the callback is a fresh request that has not yet re-established
 * the workspace context), keyed by the unguessable state_hash — exactly the slice-C
 * invitation-accept-by-token no-context pattern. The SQL is scoped to the exact hash;
 * superadmin context does NOT mean "return everything".
 */

import { createHash, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { withSuperadmin } from '../../../infrastructure/db/workspace-context.js'

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export type ConnectorVendor = 'SHOPIFY' | 'META' | 'GOOGLE'

export interface OAuthStateRecord {
  workspaceId: string
  vendor: ConnectorVendor
  userId: string
  shopDomain: string | null
}

// Injectable runner for unit tests (defaults to the real RLS primitive).
export interface OAuthStateDbRunner {
  withSuperadmin: typeof withSuperadmin
}
const defaultRunner: OAuthStateDbRunner = { withSuperadmin }

/** Cryptographically random 32-byte nonce (hex). */
export function generateNonce(): string {
  return randomBytes(32).toString('hex')
}

/** sha256 hex of the raw nonce — only the hash is persisted. */
export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex')
}

/**
 * Persist a new oauth-state row (hashed). Prunes expired rows for this
 * workspace+vendor first. Returns nothing — the caller already holds the raw nonce.
 */
export async function createOAuthState(
  params: {
    state: string
    vendor: ConnectorVendor
    workspaceId: string
    userId: string
    shopDomain?: string | null
  },
  runner: OAuthStateDbRunner = defaultRunner,
): Promise<void> {
  const stateHash = hashState(params.state)
  const expiresAt = new Date(Date.now() + STATE_TTL_MS)
  await runner.withSuperadmin(async (tx: PoolClient) => {
    // Prune expired states for this workspace+vendor (housekeeping).
    await tx.query(
      `DELETE FROM connector_oauth_states
        WHERE workspace_id = $1 AND vendor = $2 AND expires_at < now()`,
      [params.workspaceId, params.vendor],
    )
    await tx.query(
      `INSERT INTO connector_oauth_states
         (state_hash, workspace_id, vendor, user_id, shop_domain, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (state_hash) DO NOTHING`,
      [stateHash, params.workspaceId, params.vendor, params.userId, params.shopDomain ?? null, expiresAt],
    )
  })
}

/**
 * Validate + CONSUME the state (one-time use). Returns the record on success, or
 * null if: no match, vendor mismatch, or expired (expired rows are deleted). On a
 * valid match the row is DELETED before returning — a replayed callback with the
 * same state therefore fails (null), which the caller treats as invalid_state.
 */
export async function validateAndConsumeOAuthState(
  state: string,
  vendor: ConnectorVendor,
  runner: OAuthStateDbRunner = defaultRunner,
): Promise<OAuthStateRecord | null> {
  const stateHash = hashState(state)
  return runner.withSuperadmin(async (tx: PoolClient) => {
    // DELETE-then-return: consume the state row FIRST (replay hardening). A replayed
    // callback with the same nonce finds no row (null) even if the original call was
    // still in-flight for vendor/expiry validation. Using RETURNING avoids a SELECT+DELETE.
    const res = await tx.query<{
      workspace_id: string
      vendor: ConnectorVendor
      user_id: string
      shop_domain: string | null
      expires_at: Date
    }>(
      `DELETE FROM connector_oauth_states
        WHERE state_hash = $1
        RETURNING workspace_id, vendor, user_id, shop_domain, expires_at`,
      [stateHash],
    )
    const row = res.rows[0]
    if (!row) return null
    // Validate vendor and expiry AFTER consuming — the row is already gone.
    if (row.vendor !== vendor) return null
    if (new Date(row.expires_at) < new Date()) return null
    return {
      workspaceId: row.workspace_id,
      vendor: row.vendor,
      userId: row.user_id,
      shopDomain: row.shop_domain,
    }
  })
}

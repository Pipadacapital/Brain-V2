/**
 * Infrastructure — per-workspace HMAC salt vault (P1-C, R10).
 *
 * @paradigm sql (deterministic crypto + DB persistence; no ML, no LLM)
 *
 * Manages the lifecycle of per-workspace HMAC salts used to compute
 * identity hashes (email_hash / phone_hash) and salted customer_ref.
 *
 * Salt material is stored encrypted (AES-256-GCM) in the local DB for dev,
 * and in AWS Secrets Manager (via CredentialCustodyStack) in production.
 * The same backing that guards connector OAuth tokens guards the identity salt.
 *
 * Salt is NEVER rotated in place — rotation appends a new salt_version row
 * and deactivates the previous active version. Historical hashes remain stable
 * because the salt_version is stamped on every hash row.
 *
 * LOCAL DEV: the salt bytes are stored AES-256-GCM encrypted in
 * workspace_identity_salt.salt_enc using the CONNECTOR_CUSTODY_KEY
 * (the same key that guards connector credentials). Missing key → throw.
 *
 * PRODUCTION: salt_enc is empty; the KMS vault provides the salt via
 * brain/{workspace_id}/pii_salt/{salt_version} (Python ingestion-service pattern).
 */

import { randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { withSuperadmin } from '../db/workspace-context.js'
import { encryptContent, decryptBlob } from '../secrets/local-aesgcm-custody.js'

const SALT_BYTE_LENGTH = 32 // 256-bit HMAC key

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceSalt {
  workspaceId: string
  salt: Buffer
  saltVersion: string
}

interface SaltRow {
  id: string
  workspace_id: string
  salt_version: string
  salt_enc: Buffer | null
  is_active: boolean
}

// ---------------------------------------------------------------------------
// Load the AES-256-GCM key (reuses the custody key to avoid a new env var).
// ---------------------------------------------------------------------------

function loadCustodyKey(): Buffer {
  const b64 = process.env['CONNECTOR_CUSTODY_KEY']
  if (!b64) {
    throw new Error(
      '[workspace-salt-vault] CONNECTOR_CUSTODY_KEY is not set. ' +
        'The salt vault requires the same 32-byte base64 key as the credential custody.',
    )
  }
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `[workspace-salt-vault] CONNECTOR_CUSTODY_KEY must decode to 32 bytes (got ${key.length}).`,
    )
  }
  return key
}

// ---------------------------------------------------------------------------
// Get the active salt for a workspace (or create one if none exists)
// ---------------------------------------------------------------------------

/**
 * Retrieve the active per-workspace HMAC salt.
 * If no salt exists for the workspace, one is created and stored.
 *
 * Uses withWorkspace for RLS-scoped reads; withSuperadmin for the initial
 * INSERT (which must bypass RLS as the workspace session may not yet exist).
 */
export async function getOrCreateWorkspaceSalt(workspaceId: string): Promise<WorkspaceSalt> {
  // Try to read the active salt under the workspace session.
  const existing = await _readActiveSalt(workspaceId)
  if (existing) return existing

  // No active salt — create one. Use superadmin to insert without RLS.
  return _createWorkspaceSalt(workspaceId, 'v1')
}

/**
 * Rotate the salt for a workspace: deactivate current + insert new version.
 * Historical hashes remain stable (they reference their salt_version).
 * Returns the new active salt.
 */
export async function rotateWorkspaceSalt(workspaceId: string): Promise<WorkspaceSalt> {
  let newVersion = 'v1'

  await withSuperadmin(async (tx: PoolClient) => {
    // Deactivate current active salt.
    const current = await tx.query<{ salt_version: string }>(
      `UPDATE workspace_identity_salt
         SET is_active = false, deactivated_at = now()
         WHERE workspace_id = $1 AND is_active = true
         RETURNING salt_version`,
      [workspaceId],
    )

    // Compute next version.
    if (current.rows.length > 0) {
      const latestVersion = current.rows[current.rows.length - 1]!.salt_version
      const match = latestVersion.match(/^v(\d+)$/)
      if (match) {
        newVersion = `v${parseInt(match[1]!, 10) + 1}`
      }
    }
  })

  return _createWorkspaceSalt(workspaceId, newVersion)
}

/**
 * Read a specific salt version (for re-hashing historical events during replay).
 * Returns null if the version does not exist.
 */
export async function getWorkspaceSaltVersion(
  workspaceId: string,
  saltVersion: string,
): Promise<WorkspaceSalt | null> {
  let result: WorkspaceSalt | null = null

  await withSuperadmin(async (tx: PoolClient) => {
    const row = await tx.query<SaltRow>(
      `SELECT id, workspace_id, salt_version, salt_enc, is_active
         FROM workspace_identity_salt
         WHERE workspace_id = $1 AND salt_version = $2
         LIMIT 1`,
      [workspaceId, saltVersion],
    )

    if (row.rows.length === 0) return
    result = _decodeSaltRow(row.rows[0]!)
  })

  return result
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function _readActiveSalt(workspaceId: string): Promise<WorkspaceSalt | null> {
  let result: WorkspaceSalt | null = null

  // SECURITY (warehouse-epic S4 LOW-2 — flagged for the Stage-8 KMS review):
  // workspace_identity_salt IS now RLS-FORCEd (migration 37-enable-rls-identity),
  // but this vault read intentionally uses withSuperadmin: the salt is part of the
  // tenancy-isolation substrate and is read during bootstrap, before a workspace
  // session/GUC exists. The bypass is NOT a cross-tenant exposure — the query is
  // explicitly scoped `WHERE workspace_id = $1`, so it returns only the caller's
  // salt. When the local-aesgcm backing is replaced by real AWS KMS at Stage-8,
  // re-review this path: the decrypt should move behind the KMS boundary and the
  // superadmin read should stay workspace_id-scoped (never an unfiltered SELECT).
  await withSuperadmin(async (tx: PoolClient) => {
    const row = await tx.query<SaltRow>(
      `SELECT id, workspace_id, salt_version, salt_enc, is_active
         FROM workspace_identity_salt
         WHERE workspace_id = $1 AND is_active = true
         LIMIT 1`,
      [workspaceId],
    )

    if (row.rows.length === 0) return
    result = _decodeSaltRow(row.rows[0]!)
  })

  return result
}

async function _createWorkspaceSalt(workspaceId: string, version: string): Promise<WorkspaceSalt> {
  const saltBytes = randomBytes(SALT_BYTE_LENGTH)
  const key = loadCustodyKey()
  // Encrypt the salt bytes using the same AES-256-GCM custody mechanism.
  // The salt content is stored as { salt: base64 } — a JSON object for consistency.
  const encryptedBlob = encryptContent({ salt: saltBytes.toString('base64') }, key)

  let result: WorkspaceSalt | null = null

  await withSuperadmin(async (tx: PoolClient) => {
    const inserted = await tx.query<SaltRow>(
      `INSERT INTO workspace_identity_salt (workspace_id, salt_version, salt_enc, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (workspace_id, salt_version) DO UPDATE
           SET is_active = true, deactivated_at = NULL, salt_enc = EXCLUDED.salt_enc
         RETURNING id, workspace_id, salt_version, salt_enc, is_active`,
      [workspaceId, version, encryptedBlob],
    )

    result = _decodeSaltRow(inserted.rows[0]!)
  })

  if (!result) {
    throw new Error(`[workspace-salt-vault] failed to create salt for workspace ${workspaceId}`)
  }

  return result!
}

function _decodeSaltRow(row: SaltRow): WorkspaceSalt {
  if (!row.salt_enc) {
    // Production path: KMS vault would be consulted. Not yet wired.
    throw new Error(
      `[workspace-salt-vault] salt_enc is NULL for workspace=${row.workspace_id} version=${row.salt_version}. ` +
        'Production KMS vault is held_for_console (P1-D). Local dev requires salt_enc.',
    )
  }

  const key = loadCustodyKey()
  const decrypted = decryptBlob(row.salt_enc, key) as { salt: string }
  const saltBytes = Buffer.from(decrypted.salt, 'base64')

  return {
    workspaceId: row.workspace_id,
    salt: saltBytes,
    saltVersion: row.salt_version,
  }
}

// ---------------------------------------------------------------------------
// Utility: load salt for testing (creates if absent, returns the active salt)
// ---------------------------------------------------------------------------

/**
 * FOR TESTING ONLY: create a deterministic salt from a fixed hex string.
 * This makes test outputs reproducible without touching the DB.
 */
export function buildTestSalt(hexSalt: string): Buffer {
  const buf = Buffer.from(hexSalt, 'hex')
  if (buf.length !== 32) {
    throw new Error(`[workspace-salt-vault] test salt must be 32 bytes hex (64 chars), got ${buf.length}`)
  }
  return buf
}

/**
 * LOCAL-DEV credential custody — authenticated symmetric encryption (AES-256-GCM).
 *
 * @paradigm sql (deterministic crypto + DB persistence; no ML, no LLM)
 *
 * THIS IS A LOCAL-DEV-ONLY BACKING. It is the real-enough custody the directive
 * calls for: tokens are stored ENCRYPTED-AT-REST, RLS-scoped, in the local Postgres.
 * It is the TEMPLATE the production seal() must satisfy — it does NOT make the
 * production custody decision (AWS Secrets Manager ap-south-1 vs Supabase
 * encrypt-in-place), which REMAINS HELD (CF-C7-CUSTODY-PROOF-1, Founder-gated).
 *
 * Persona TC-001..005 (token-custody-at-rest-realist) bindings:
 *   TC-001 AEAD: AES-256-GCM — a tampered ciphertext is REJECTED on decrypt (auth
 *          tag verification throws), never silently decrypted to garbage.
 *   TC-002 key custody: 32-byte key from CONNECTOR_CUSTODY_KEY (base64) in the
 *          git-ignored .env. Missing/short key → throw at use (NO silent default).
 *   TC-003 never log: Credential.content + the plaintext token never appear in any
 *          log/error/return. Errors carry only ids. The blob layout is opaque.
 *   TC-004 template-not-production: flag-gated (custody-factory); this is local-only.
 *   TC-005 RLS: read/write go through withWorkspace(workspaceId) — a context-less or
 *          cross-workspace read returns 0 rows (fail-closed) → CredentialNotFoundError.
 *
 * Blob layout (connector_credentials.credential_enc bytea):
 *   [ iv: 12 bytes ] [ authTag: 16 bytes ] [ ciphertext: N bytes ]
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { withWorkspace } from '../db/workspace-context.js'
import {
  type Credential,
  type CredentialCustody,
  CredentialNotFoundError,
} from './credential-custody.js'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // GCM standard nonce length
const TAG_LEN = 16
const KEY_LEN = 32 // AES-256

// Injectable DB runner for unit tests (defaults to the real RLS primitive).
export interface CustodyDbRunner {
  withWorkspace: typeof withWorkspace
}
const defaultRunner: CustodyDbRunner = { withWorkspace }

/**
 * Load + validate the 32-byte symmetric key from CONNECTOR_CUSTODY_KEY (base64).
 * Fail-closed: a missing or wrong-length key throws — NEVER falls back to a default
 * or zero key (TC-002). Read at use-time (not module-load) so tests can set env.
 */
function loadKey(): Buffer {
  const b64 = process.env['CONNECTOR_CUSTODY_KEY']
  if (!b64) {
    throw new Error(
      '[local-aesgcm-custody] CONNECTOR_CUSTODY_KEY is not set. The local custody ' +
        'backing requires a 32-byte base64 key in the git-ignored .env. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  let key: Buffer
  try {
    key = Buffer.from(b64, 'base64')
  } catch {
    throw new Error('[local-aesgcm-custody] CONNECTOR_CUSTODY_KEY is not valid base64.')
  }
  if (key.length !== KEY_LEN) {
    throw new Error(
      `[local-aesgcm-custody] CONNECTOR_CUSTODY_KEY must decode to exactly ${KEY_LEN} bytes ` +
        `(got ${key.length}). Generate a fresh AES-256 key.`,
    )
  }
  return key
}

/** Encrypt a token JSON object → iv||tag||ciphertext (AES-256-GCM). */
export function encryptContent(content: Record<string, unknown>, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const plaintext = Buffer.from(JSON.stringify(content), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag() // 16 bytes
  return Buffer.concat([iv, tag, ciphertext])
}

/**
 * Decrypt iv||tag||ciphertext → token JSON. The GCM auth tag is verified by
 * `final()`; a tampered blob throws (TC-001) — we surface a generic error that
 * carries NO content.
 */
export function decryptBlob(blob: Buffer, key: Buffer): Record<string, unknown> {
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error('[local-aesgcm-custody] credential blob is too short / corrupt.')
  }
  const iv = blob.subarray(0, IV_LEN)
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  let plaintext: Buffer
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    // Auth-tag mismatch (tampering) or wrong key. Generic — no content leaked.
    throw new Error('[local-aesgcm-custody] credential decryption failed (tampered or wrong key).')
  }
  return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>
}

/**
 * LOCAL-DEV AES-256-GCM custody backing. Encrypted-at-rest, RLS-scoped.
 * Never logs the token. Production seal() remains held (see production-custody.ts).
 */
export class LocalAesGcmCustody implements CredentialCustody {
  constructor(private readonly runner: CustodyDbRunner = defaultRunner) {}

  async put(
    workspaceId: string,
    vendor: string,
    content: Record<string, unknown>,
  ): Promise<void> {
    const key = loadKey()
    const blob = encryptContent(content, key)
    // RLS-scoped write (TC-005): the encrypted blob lands under the owning workspace.
    await this.runner.withWorkspace(workspaceId, async (tx: PoolClient) => {
      await tx.query(
        `INSERT INTO connector_credentials (workspace_id, vendor, credential_enc, updated_at)
           VALUES ($1, $2, $3, now())
         ON CONFLICT (workspace_id, vendor) DO UPDATE
           SET credential_enc = EXCLUDED.credential_enc,
               updated_at = now()`,
        [workspaceId, vendor, blob],
      )
    })
  }

  async get(workspaceId: string, vendor: string): Promise<Credential> {
    const key = loadKey()
    const blob = await this.runner.withWorkspace(workspaceId, async (tx: PoolClient) => {
      const res = await tx.query<{ credential_enc: Buffer }>(
        `SELECT credential_enc FROM connector_credentials
          WHERE workspace_id = $1 AND vendor = $2`,
        [workspaceId, vendor],
      )
      return res.rows[0]?.credential_enc ?? null
    })
    if (!blob) {
      // Context-less / cross-workspace / never-stored → 0 rows → not found (fail-closed).
      throw new CredentialNotFoundError(workspaceId, vendor)
    }
    const content = decryptBlob(blob, key)
    return { workspaceId, vendor, content }
  }

  async seal(workspaceId: string, vendor: string): Promise<void> {
    // Local revoke analogue: delete the encrypted row. (Production seal() — encrypt-
    // in-place / Secrets-Manager delete-with-recovery — is HELD: CF-C7-CUSTODY-PROOF-1.)
    await this.runner.withWorkspace(workspaceId, async (tx: PoolClient) => {
      await tx.query(
        `DELETE FROM connector_credentials WHERE workspace_id = $1 AND vendor = $2`,
        [workspaceId, vendor],
      )
    })
  }
}

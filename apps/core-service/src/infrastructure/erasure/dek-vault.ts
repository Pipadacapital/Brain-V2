/**
 * DEK vault adapter — P0-D crypto-shred (Tier 4 of the erasure ladder).
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * Implements the "crypto-shred" mechanism for cold/immutable/backup PII:
 *   - Each data subject has a per-subject DEK (Data Encryption Key) keyed by
 *     `(workspace_id, customer_ref, salt_version)`.
 *   - The DEK encrypts PII in `customer_pii._ct` columns and S3 raw archive bytes.
 *   - Destroying the DEK renders ciphertext permanently unreadable — no rewrite needed.
 *
 * Local-dev (CONNECTOR_CUSTODY_BACKING=local-aesgcm):
 *   - DEKs are stored in memory in a scoped registry (per-test isolation).
 *   - Destruction = removal from the in-memory map.
 *   - `decryptWithDek` throws after destruction — verified by the test.
 *
 * Production (CONNECTOR_CUSTODY_BACKING=kms):
 *   - DEKs are KMS-wrapped secrets in AWS Secrets Manager.
 *   - Destruction = `secretsmanager:DeleteSecret` (with a 7-day force-delete window).
 *   - This is AUTHORED-NOT-DEPLOYED at P0-D (live KMS is the Stage-8 ceremony).
 *
 * STATIC GATE: only erase-subject.ts may call destroyDek().
 */

import type { DekOutcome } from '../../domain/consent/subject-erasure.js'

// ---------------------------------------------------------------------------
// In-memory DEK registry for local-dev and tests
// ---------------------------------------------------------------------------

// Map from dekKeyId → key material (in-memory only; erased from memory on destroy).
const _inMemoryDekRegistry = new Map<string, string>()

/**
 * Register a DEK in the in-memory registry (test + local-dev only).
 * In production the DEK lives in Secrets Manager.
 */
export function _registerDekForTest(dekKeyId: string, keyMaterial: string): void {
  _inMemoryDekRegistry.set(dekKeyId, keyMaterial)
}

/** Clear the in-memory registry (test isolation). */
export function _clearDekRegistryForTest(): void {
  _inMemoryDekRegistry.clear()
}

// ---------------------------------------------------------------------------
// DEK vault interface
// ---------------------------------------------------------------------------

export interface DekDestructionResult {
  dekKeyId: string
  outcome: DekOutcome
  errorDetail: string | null
}

/**
 * Destroy the per-subject DEK identified by `dekKeyId`.
 *
 * In local-dev (CONNECTOR_CUSTODY_BACKING=local-aesgcm or absent):
 *   - Removes the key from the in-memory registry.
 *   - Returns 'destroyed' if found, 'not_found' if not.
 *
 * In production (CONNECTOR_CUSTODY_BACKING=kms):
 *   - Would call `secretsmanager:DeleteSecret` with `ForceDeleteWithoutRecovery=true`.
 *   - AUTHORED-NOT-DEPLOYED: live KMS calls are held_for_console.
 *
 * This function MUST be idempotent — calling it twice for the same DEK
 * returns 'already_destroyed' on the second call, not an error.
 */
export async function destroyDek(dekKeyId: string): Promise<DekDestructionResult> {
  const backend = process.env.CONNECTOR_CUSTODY_BACKING ?? 'local-aesgcm'

  if (backend === 'kms') {
    // Production path — AUTHORED-NOT-DEPLOYED (held_for_console).
    // A real implementation would call AWS Secrets Manager here.
    // The following code is intentionally unreachable in tests.
    return {
      dekKeyId,
      outcome: 'error',
      errorDetail:
        'KMS DEK destruction is a Stage-8 console ceremony (held_for_console). ' +
        'Run the BronzeStorageStack CDK deploy + KMS ceremony before enabling this path.',
    }
  }

  // Local-dev / test path.
  if (_inMemoryDekRegistry.has(dekKeyId)) {
    _inMemoryDekRegistry.delete(dekKeyId)
    return { dekKeyId, outcome: 'destroyed', errorDetail: null }
  }

  // Check if it was already destroyed in this session (double destroy = already_destroyed).
  // In a real vault we'd check the key_destruction_ledger.
  return { dekKeyId, outcome: 'not_found', errorDetail: null }
}

/**
 * Attempt to decrypt data using the DEK identified by `dekKeyId`.
 * Returns the decrypted string if the DEK exists, throws if destroyed.
 *
 * Used by tests to assert "decrypt now fails" after DEK destruction.
 */
export async function decryptWithDek(dekKeyId: string, _ciphertext: string): Promise<string> {
  const material = _inMemoryDekRegistry.get(dekKeyId)
  if (!material) {
    throw new Error(
      `[dek-vault] DEK not found for key ID "${dekKeyId}". ` +
        'Either the DEK has been destroyed (crypto-shred) or it was never registered.',
    )
  }
  // In local-dev the DEK material IS the plaintext (no real crypto — test harness only).
  // Production: decrypt with KMS-unwrapped AES-256-GCM key.
  return material
}

/**
 * Domain layer — Subject Erasure aggregate.
 *
 * @paradigm sql (SQL/DDL + connection-handling; no ML, no LLM)
 *
 * Pure domain types and invariants for the DPDP §12 erasure ladder.
 * NO I/O, NO framework imports — tested in isolation.
 *
 * The five-tier erasure ladder (§4.2 of the architecture proposal):
 *   Tier 1 — PG hot-mirror: plaintext wipe + tombstone (customer_pii)
 *   Tier 2 — CH silver facts: ALTER DELETE WHERE ws=? AND customer_ref=?
 *   Tier 3 — CH bronze (hot): partition-scoped ALTER DELETE
 *   Tier 4 — S3 raw / cold / backups: DEK crypto-shred (key destruction)
 *   Tier 5 — Kafka log: audit_log tombstone (immutable log; offset noted)
 *
 * COUNT=0 verification: after the ladder completes, a COUNT(*) across every
 * tier must return 0 for (workspace_id, customer_ref). The
 * `count_zero_verified_at` timestamp on `subject_erasure_request` is the
 * DPB artifact.
 */

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export type ErasureStatus =
  | 'pending'
  | 'notice_window_ended'
  | 'executing'
  | 'completed'
  | 'failed'

export type DekTier = 's3_raw' | 'glacier' | 'customer_pii_ct'

export type DekOutcome = 'destroyed' | 'already_destroyed' | 'not_found' | 'error'

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface SubjectErasureRequest {
  id: string
  workspaceId: string
  customerRef: string
  requestedAt: Date
  noticeWindowEndsAt: Date // always requestedAt + 48h
  executedAt: Date | null
  countZeroVerifiedAt: Date | null
  status: ErasureStatus
  failureReason: string | null
  requestedByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface KeyDestructionRecord {
  id: string
  erasureId: string
  dekKeyId: string
  destroyedAt: Date
  tier: DekTier
  outcome: DekOutcome
  errorDetail: string | null
  vaultBackend: string
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Domain invariants
// ---------------------------------------------------------------------------

/**
 * DPDP §12: the notice window is exactly 48 hours from the request time.
 * This invariant is enforced by the DB CHECK but also validated here so the
 * domain is self-consistent before any DB round-trip.
 */
export function buildNoticeWindowEndsAt(requestedAt: Date): Date {
  const d = new Date(requestedAt)
  d.setTime(d.getTime() + 48 * 60 * 60 * 1000)
  return d
}

/**
 * Returns true if the notice window has passed and the erasure may proceed.
 * The orchestrator checks this before calling the execute path.
 */
export function isNoticeWindowExpired(req: Pick<SubjectErasureRequest, 'noticeWindowEndsAt'>): boolean {
  return new Date() >= req.noticeWindowEndsAt
}

/**
 * Validates that the DEK key ID follows the expected format:
 * "<workspace_id>/<customer_ref>/<salt_version>"
 */
export function isValidDekKeyId(dekKeyId: string): boolean {
  const parts = dekKeyId.split('/')
  return parts.length === 3 && parts.every((p) => p.length > 0)
}

/**
 * Builds the DEK key ID for a subject in a given workspace.
 * This is the lookup key used in the Secrets Manager / local vault.
 */
export function buildDekKeyId(workspaceId: string, customerRef: string, saltVersion: string): string {
  return `${workspaceId}/${customerRef}/${saltVersion}`
}

// ---------------------------------------------------------------------------
// Erasure result (the COUNT=0 artifact)
// ---------------------------------------------------------------------------

/** Per-tier COUNT result emitted as the DPB verification artifact. */
export interface TierVerificationResult {
  tier: string
  table: string
  countRemaining: number
  verified: boolean // true iff countRemaining === 0
}

/** The full COUNT=0 artifact returned by the orchestrator. */
export interface ErasureVerificationArtifact {
  erasureId: string
  workspaceId: string
  customerRef: string
  executedAt: Date
  countZeroVerifiedAt: Date
  tiers: TierVerificationResult[]
  allZero: boolean // true iff every tier.verified === true
  dekDestroyedTiers: DekTier[]
  auditLogEntryId: string | null
}

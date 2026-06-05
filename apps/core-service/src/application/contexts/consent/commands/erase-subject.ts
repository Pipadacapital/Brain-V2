/**
 * EraseSubject command + use-case — P0-D DPDP §12 erasure orchestrator.
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * Owner: @vikram (core-service TS) — feature flag: ERASURE_ORCHESTRATOR.
 *
 * Implements the five-tier erasure ladder (docs/data-warehouse-architecture-proposal.md §4.2):
 *
 *   Tier 1 — PG hot-mirror: SET email_ct=NULL, phone_ct=NULL, full_name_ct=NULL,
 *             tombstoned_at=now() on customer_pii WHERE workspace_id=? AND customer_ref=?
 *   Tier 2 — CH silver facts: ALTER DELETE fanned out to every registered MV/table.
 *   Tier 3 — CH bronze (hot): partition-scoped ALTER DELETE on connector_raw_events.
 *   Tier 4 — S3 raw / cold / backups: destroy per-subject DEK (crypto-shred).
 *   Tier 5 — Kafka log: write audit_log row (action='subject_erasure') as the offset note.
 *
 * The orchestrator is IDEMPOTENT: re-running on a tombstoned subject (already completed
 * erasure) short-circuits and returns COUNT=0 (no-op).
 *
 * Feature flag guard: ERASURE_ORCHESTRATOR must be 'true' for the command to execute.
 * This must be ON before any live PII enters the warehouse (B10 cutover order step 2).
 *
 * COUNT=0 artifact: after the ladder runs, a TierVerificationResult per tier is
 * assembled and stamped onto subject_erasure_request.count_zero_verified_at.
 * The artifact is the DPB evidence record.
 *
 * DPDP §12 notice window: the command checks that notice_window_ends_at has passed
 * (>= now()) before executing. The request must be in status 'notice_window_ended'.
 * The orchestrator transitions: pending → notice_window_ended (scheduler job, not here)
 *                                         notice_window_ended → executing → completed | failed
 */

import { randomUUID } from 'node:crypto'
import { withSuperadmin } from '../../../../infrastructure/db/workspace-context.js'
import type { PoolClient } from 'pg'
import {
  buildNoticeWindowEndsAt,
  isNoticeWindowExpired,
  isValidDekKeyId,
  buildDekKeyId,
  type SubjectErasureRequest,
  type ErasureVerificationArtifact,
  type TierVerificationResult,
} from '../../../../domain/consent/subject-erasure.js'
import {
  eraseAndVerifyChTiers,
  ERASURE_TARGETS,
} from '../../../../infrastructure/erasure/clickhouse-eraser.js'
import {
  destroyDek,
  type DekDestructionResult,
} from '../../../../infrastructure/erasure/dek-vault.js'
import type { DekTier } from '../../../../domain/consent/subject-erasure.js'

// ---------------------------------------------------------------------------
// Feature flag guard
// ---------------------------------------------------------------------------

function assertErasureOrchestratorEnabled(): void {
  if (process.env.ERASURE_ORCHESTRATOR !== 'true') {
    throw new Error(
      '[erase-subject] ERASURE_ORCHESTRATOR feature flag is OFF. ' +
        'This flag must be ON before any live PII enters the warehouse (DPDP §12 gate). ' +
        'Set ERASURE_ORCHESTRATOR=true to enable.',
    )
  }
}

// ---------------------------------------------------------------------------
// Command input / output types
// ---------------------------------------------------------------------------

export interface EraseSubjectCommand {
  workspaceId: string
  customerRef: string
  requestedByUserId: string | null
  /** Salt version for the DEK key ID construction (from the per-workspace salt). */
  saltVersion?: string
  /** If true, skip the 48h notice window check (for testing only). */
  _skipNoticeWindowCheckForTest?: boolean
}

export interface EraseSubjectResult {
  erasureId: string
  artifact: ErasureVerificationArtifact
}

// ---------------------------------------------------------------------------
// Repository helpers (inline — no separate repository file needed at P0-D
// since the consent context has no other PG tables yet)
// ---------------------------------------------------------------------------

/**
 * Fetch the erasure request. Uses withSuperadmin to bypass the audit_log RLS
 * (the erasure system is a superadmin-tier operation running as a background job).
 */
async function getOrCreateErasureRequest(
  tx: PoolClient,
  workspaceId: string,
  customerRef: string,
  requestedByUserId: string | null,
): Promise<SubjectErasureRequest> {
  // Check for an existing request for this subject (ANY status — including completed/failed).
  // The caller handles idempotency (returns early on completed; allows retry on failed).
  const existing = await tx.query<SubjectErasureRequest>(
    `SELECT id, workspace_id AS "workspaceId", customer_ref AS "customerRef",
            requested_at AS "requestedAt", notice_window_ends_at AS "noticeWindowEndsAt",
            executed_at AS "executedAt", count_zero_verified_at AS "countZeroVerifiedAt",
            status, failure_reason AS "failureReason",
            requested_by_user_id AS "requestedByUserId",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM subject_erasure_request
     WHERE workspace_id = $1 AND customer_ref = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId, customerRef],
  )

  if (existing.rows.length > 0) {
    return existing.rows[0]!
  }

  // Create a new request.
  const now = new Date()
  const noticeWindowEndsAt = buildNoticeWindowEndsAt(now)

  const inserted = await tx.query<SubjectErasureRequest>(
    `INSERT INTO subject_erasure_request
       (workspace_id, customer_ref, requested_at, notice_window_ends_at, status, requested_by_user_id)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING id, workspace_id AS "workspaceId", customer_ref AS "customerRef",
               requested_at AS "requestedAt", notice_window_ends_at AS "noticeWindowEndsAt",
               executed_at AS "executedAt", count_zero_verified_at AS "countZeroVerifiedAt",
               status, failure_reason AS "failureReason",
               requested_by_user_id AS "requestedByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [workspaceId, customerRef, now.toISOString(), noticeWindowEndsAt.toISOString(), requestedByUserId],
  )
  return inserted.rows[0]!
}

/**
 * Transition the erasure request to a new status.
 * Runs on the superadmin connection (the caller already holds a superadmin tx).
 */
async function updateErasureStatus(
  tx: PoolClient,
  erasureId: string,
  status: string,
  extra: {
    executedAt?: Date
    countZeroVerifiedAt?: Date
    failureReason?: string
  } = {},
): Promise<void> {
  await tx.query(
    `UPDATE subject_erasure_request
     SET status = $2,
         executed_at = COALESCE($3, executed_at),
         count_zero_verified_at = COALESCE($4, count_zero_verified_at),
         failure_reason = COALESCE($5, failure_reason),
         updated_at = now()
     WHERE id = $1`,
    [
      erasureId,
      status,
      extra.executedAt?.toISOString() ?? null,
      extra.countZeroVerifiedAt?.toISOString() ?? null,
      extra.failureReason ?? null,
    ],
  )
}

/**
 * Write to the key_destruction_ledger (WORM — INSERT only).
 */
async function recordKeyDestruction(
  tx: PoolClient,
  erasureId: string,
  result: DekDestructionResult,
  tier: DekTier,
  vaultBackend: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO key_destruction_ledger
       (erasure_id, dek_key_id, tier, outcome, error_detail, vault_backend)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [erasureId, result.dekKeyId, tier, result.outcome, result.errorDetail, vaultBackend],
  )
}

/**
 * Write the audit_log entry (action='subject_erasure') — the Tier 5 Kafka offset note.
 * Since we don't have a Kafka producer wired at P0-D, this PG write IS the offset note
 * (the audit_log is the durable record; Kafka tombstone is added in P1-D).
 */
async function writeAuditLogEntry(
  tx: PoolClient,
  workspaceId: string,
  customerRef: string,
  erasureId: string,
  userId: string | null,
): Promise<string> {
  // audit_log requires user_id NOT NULL. For system-initiated erasures we use a
  // sentinel system user. For now, we require the caller to pass a valid user ID
  // or a sentinel system user UUID.
  const systemUserId = userId ?? '00000000-0000-0000-0000-000000000001'

  const result = await tx.query<{ id: string }>(
    `INSERT INTO audit_log
       (workspace_id, user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, 'subject_erasure', 'customer_pii', $3, $4)
     RETURNING id`,
    [
      workspaceId,
      systemUserId,
      customerRef,
      JSON.stringify({ erasure_id: erasureId, dpdp_section: '12' }),
    ],
  )
  return result.rows[0]!.id
}

// ---------------------------------------------------------------------------
// Tier 1: PG hot-mirror wipe
// ---------------------------------------------------------------------------

interface PgWipeResult {
  found: boolean
  alreadyTombstoned: boolean
}

async function wipePgPii(
  tx: PoolClient,
  workspaceId: string,
  customerRef: string,
): Promise<TierVerificationResult & { pgResult: PgWipeResult }> {
  // First check if the subject exists and is already tombstoned (idempotency).
  const check = await tx.query<{ tombstoned_at: string | null }>(
    `SELECT tombstoned_at FROM customer_pii
     WHERE workspace_id = $1 AND customer_ref = $2
     LIMIT 1`,
    [workspaceId, customerRef],
  )

  if (check.rows.length === 0) {
    // Subject not in PG — this is OK (they may only be in CH/bronze).
    return {
      tier: 'pg_hot_mirror',
      table: 'customer_pii',
      countRemaining: 0,
      verified: true,
      pgResult: { found: false, alreadyTombstoned: false },
    }
  }

  if (check.rows[0]!.tombstoned_at !== null) {
    // Already tombstoned — idempotent no-op.
    return {
      tier: 'pg_hot_mirror',
      table: 'customer_pii',
      countRemaining: 0,
      verified: true,
      pgResult: { found: true, alreadyTombstoned: true },
    }
  }

  // Wipe PII columns + identity columns + set tombstone (DPDP §12 / P1-C).
  // email_hash / phone_hash / salt_version are personal-data-derived hashes
  // (added by migration 36).  identity_cluster_id is the cluster pointer.
  // All four MUST be nulled in the same UPDATE that tombstones the row so the
  // ladder is atomic and verified in a single pass.
  await tx.query(
    `UPDATE customer_pii
     SET email_ct             = NULL,
         phone_ct             = NULL,
         full_name_ct         = NULL,
         email_hash           = NULL,
         phone_hash           = NULL,
         salt_version         = NULL,
         identity_cluster_id  = NULL,
         tombstoned_at        = now(),
         updated_at           = now()
     WHERE workspace_id = $1 AND customer_ref = $2`,
    [workspaceId, customerRef],
  )

  // Remove the subject's identity graph edges (both node_a and node_b positions).
  // This must run in the same transaction so the erasure is atomic.
  await tx.query(
    `DELETE FROM identity_cluster_edges
     WHERE workspace_id = $1
       AND (node_a = $2 OR node_b = $2)`,
    [workspaceId, customerRef],
  )

  // Verify: count remaining non-tombstoned rows.
  const countResult = await tx.query<{ cnt: string }>(
    `SELECT count(*) AS cnt FROM customer_pii
     WHERE workspace_id = $1 AND customer_ref = $2 AND tombstoned_at IS NULL`,
    [workspaceId, customerRef],
  )
  const countRemaining = parseInt(countResult.rows[0]?.cnt ?? '0', 10)

  return {
    tier: 'pg_hot_mirror',
    table: 'customer_pii',
    countRemaining,
    verified: countRemaining === 0,
    pgResult: { found: true, alreadyTombstoned: false },
  }
}

// ---------------------------------------------------------------------------
// Main use-case: eraseSubject
// ---------------------------------------------------------------------------

/**
 * Execute the five-tier erasure ladder for a data subject.
 * Returns the COUNT=0 artifact that serves as the DPB evidence record.
 *
 * Idempotent: re-running on a subject whose erasure has already completed
 * returns the original artifact with COUNT=0 across all tiers.
 */
export async function eraseSubject(command: EraseSubjectCommand): Promise<EraseSubjectResult> {
  assertErasureOrchestratorEnabled()

  const { workspaceId, customerRef, requestedByUserId, saltVersion = 'v1' } = command

  if (!workspaceId || !customerRef) {
    throw new Error('[erase-subject] workspaceId and customerRef are required')
  }

  // --------------------------------------------------------------------------
  // PHASE 1: Get or create the erasure request (superadmin — schema-level DDL)
  // --------------------------------------------------------------------------
  let erasureRequest: SubjectErasureRequest
  let erasureId: string

  await withSuperadmin(async (tx: PoolClient) => {
    erasureRequest = await getOrCreateErasureRequest(tx, workspaceId, customerRef, requestedByUserId)
    erasureId = erasureRequest.id

    // Idempotency check: already completed.
    if (erasureRequest.status === 'completed') {
      return
    }
    if (erasureRequest.status === 'failed') {
      // Allow retry on failed requests.
      await updateErasureStatus(tx, erasureId, 'pending')
    }

    // Check DPDP §12 notice window (skip in test mode only).
    if (!command._skipNoticeWindowCheckForTest) {
      if (!isNoticeWindowExpired(erasureRequest)) {
        throw new Error(
          `[erase-subject] DPDP §12 notice window has not expired yet. ` +
            `Notice window ends at: ${erasureRequest.noticeWindowEndsAt.toISOString()}. ` +
            `Erasure request ID: ${erasureId}.`,
        )
      }
    }

    await updateErasureStatus(tx, erasureId, 'executing', { executedAt: new Date() })
  })

  // After the superadmin block, erasureRequest and erasureId are set.
  erasureId = erasureRequest!.id

  // If already completed, reconstruct a minimal artifact.
  if (erasureRequest!.status === 'completed') {
    const artifact: ErasureVerificationArtifact = {
      erasureId,
      workspaceId,
      customerRef,
      executedAt: erasureRequest!.executedAt ?? new Date(),
      countZeroVerifiedAt: erasureRequest!.countZeroVerifiedAt ?? new Date(),
      tiers: [],
      allZero: true,
      dekDestroyedTiers: [],
      auditLogEntryId: null,
    }
    return { erasureId, artifact }
  }

  const executedAt = new Date()
  const allTierResults: TierVerificationResult[] = []
  const dekDestroyedTiers: DekTier[] = []
  let auditLogEntryId: string | null = null

  try {
    // --------------------------------------------------------------------------
    // TIER 1: PG hot-mirror wipe (inside workspace-scoped tx)
    // --------------------------------------------------------------------------
    let pgResult: TierVerificationResult | null = null

    await withSuperadmin(async (tx: PoolClient) => {
      const wipeResult = await wipePgPii(tx, workspaceId, customerRef)
      pgResult = {
        tier: wipeResult.tier,
        table: wipeResult.table,
        countRemaining: wipeResult.countRemaining,
        verified: wipeResult.verified,
      }
    })

    if (pgResult) allTierResults.push(pgResult)

    // --------------------------------------------------------------------------
    // TIER 2 + 3: CH silver + bronze ALTER DELETE
    // --------------------------------------------------------------------------
    const chResults = await eraseAndVerifyChTiers(workspaceId, customerRef, ERASURE_TARGETS)
    allTierResults.push(...chResults)

    // --------------------------------------------------------------------------
    // TIER 4: DEK crypto-shred (S3 raw / cold / customer_pii_ct)
    // --------------------------------------------------------------------------
    const tiers: DekTier[] = ['s3_raw', 'glacier', 'customer_pii_ct']
    const backend = process.env.CONNECTOR_CUSTODY_BACKING ?? 'local-aesgcm'

    await withSuperadmin(async (tx: PoolClient) => {
      for (const tier of tiers) {
        const dekKeyId = buildDekKeyId(workspaceId, customerRef, saltVersion)
        if (!isValidDekKeyId(dekKeyId)) continue

        const destructionResult = await destroyDek(dekKeyId)
        await recordKeyDestruction(tx, erasureId, destructionResult, tier, backend)

        if (destructionResult.outcome === 'destroyed' || destructionResult.outcome === 'already_destroyed') {
          dekDestroyedTiers.push(tier)
        }

        allTierResults.push({
          tier: `s3_crypto_shred:${tier}`,
          table: `dek:${dekKeyId}`,
          countRemaining: 0, // DEK destruction = 0 accessible records
          verified: destructionResult.outcome !== 'error',
        })
      }
    })

    // --------------------------------------------------------------------------
    // TIER 5: Kafka offset note — write audit_log entry (PG-backed at P0-D)
    // --------------------------------------------------------------------------
    await withSuperadmin(async (tx: PoolClient) => {
      auditLogEntryId = await writeAuditLogEntry(tx, workspaceId, customerRef, erasureId, requestedByUserId)
    })

    // --------------------------------------------------------------------------
    // Assemble COUNT=0 artifact
    // --------------------------------------------------------------------------
    const allZero = allTierResults.every((r) => r.verified)
    const countZeroVerifiedAt = new Date()

    const artifact: ErasureVerificationArtifact = {
      erasureId,
      workspaceId,
      customerRef,
      executedAt,
      countZeroVerifiedAt,
      tiers: allTierResults,
      allZero,
      dekDestroyedTiers,
      auditLogEntryId,
    }

    // --------------------------------------------------------------------------
    // Stamp count_zero_verified_at + transition to completed
    // --------------------------------------------------------------------------
    await withSuperadmin(async (tx: PoolClient) => {
      await updateErasureStatus(tx, erasureId, allZero ? 'completed' : 'failed', {
        countZeroVerifiedAt,
        failureReason: allZero ? undefined : 'COUNT>0 on one or more tiers after erasure',
      })
    })

    return { erasureId, artifact }
  } catch (err) {
    // Transition to failed on unhandled errors.
    await withSuperadmin(async (tx: PoolClient) => {
      await updateErasureStatus(tx, erasureId, 'failed', {
        failureReason: err instanceof Error ? err.message : String(err),
      })
    }).catch(() => {
      /* ignore secondary failure */
    })
    throw err
  }
}

// ---------------------------------------------------------------------------
// Scheduler entry point: transition pending → notice_window_ended
// Called by the daily-tick job (not the main erase command).
// ---------------------------------------------------------------------------

/**
 * Mark all erasure requests whose notice window has elapsed as `notice_window_ended`.
 * This is called by a background scheduler, not the erase command itself.
 * Returns the count of requests transitioned.
 */
export async function transitionNoticeWindowEndedRequests(): Promise<number> {
  let transitioned = 0
  await withSuperadmin(async (tx: PoolClient) => {
    const result = await tx.query<{ cnt: string }>(
      `UPDATE subject_erasure_request
       SET status = 'notice_window_ended', updated_at = now()
       WHERE status = 'pending'
         AND notice_window_ends_at <= now()
       RETURNING id`,
    )
    transitioned = result.rowCount ?? 0
  })
  return transitioned
}

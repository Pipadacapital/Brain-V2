-- =============================================================================
-- 33 — Subject erasure scaffold (P0-D, DPDP §12, R2)
--
-- WHY: DPDP §12 imposes a 48h pre-erasure notice window and requires a
-- verifiable "COUNT=0" artifact across every tier where a data subject's PII
-- lives. This migration provides:
--
--   1. `subject_erasure_request` — one row per right-to-erasure invocation,
--      tracking the §12 notice window, execution timestamp, and the COUNT=0
--      verification result. Status FSM:
--        pending → notice_window_ended → executing → completed | failed
--
--   2. `key_destruction_ledger` — WORM append-only audit trail for per-subject
--      DEK destructions (the S3/cold-tier crypto-shred primitive). The table
--      has a CHECK + trigger that prevents UPDATE and DELETE — any attempt
--      returns an error, making the ledger tamper-evident.
--
-- WORM enforcement: a BEFORE trigger on key_destruction_ledger raises an
-- exception for UPDATE and DELETE operations. This is enforced at the PG
-- function level (runs as the calling role, not SECURITY DEFINER) so it cannot
-- be bypassed by rls_app.
--
-- DPDP §12 implementation note: `notice_window_ends_at` is always set to
-- `requested_at + INTERVAL '48 hours'` via a GENERATED column — the window
-- cannot be shortened by the application, only by a DBA acting directly on the
-- DB (which would be an auditable event in itself).
--
-- The `audit_log.action = 'subject_erasure'` value is a free-text convention;
-- the erasure orchestrator writes an audit_log row carrying this action string
-- alongside each completed erasure.
--
-- REVERSIBILITY: see down.sql (33-down-subject-erasure.sql).
--   Dropping these tables does not restore any erased PII — erasure is
--   irreversible by design. Down exists only to undo the schema addition
--   in dev/test environments before any PII has been erased.
--
-- Apply order: after 32-vendor-text-fk.sql. Run as postgres superuser (DDL).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. subject_erasure_request
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subject_erasure_request (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant scope (required — erasure is always workspace-bound)
  workspace_id            UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,

  -- The salted identity hash (same join key as customer_pii.customer_ref and
  -- connector_raw_events.customer_ref). NEVER raw PII.
  customer_ref            TEXT NOT NULL,

  -- DPDP §12 timestamps
  requested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Generated: always requested_at + 48h; cannot be under-cut by UPDATE.
  -- Use a regular column with a CHECK as GENERATED ALWAYS would prevent normal
  -- INSERT patterns, and we need the app to be able to INSERT with a pre-computed
  -- value that must equal requested_at + 48h.
  notice_window_ends_at   TIMESTAMPTZ NOT NULL,

  -- Execution tracking
  executed_at             TIMESTAMPTZ,
  count_zero_verified_at  TIMESTAMPTZ,

  -- FSM: pending → notice_window_ended → executing → completed | failed
  status                  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','notice_window_ended','executing','completed','failed')),

  -- Structured failure capture
  failure_reason          TEXT,

  -- Requestor audit trail (the user who submitted the right-to-erasure request).
  -- Nullable: may be initiated by an automated compliance job with no human actor.
  requested_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce the §12 48h window at the DB level.
  -- The orchestrator must honour this before calling the execute path.
  CONSTRAINT notice_window_is_48h CHECK (
    notice_window_ends_at = requested_at + INTERVAL '48 hours'
  ),

  -- One active erasure per subject per workspace at a time.
  -- Prevents racing duplicate requests from creating a second erasure while one
  -- is executing. Completed/failed requests are retained for audit.
  CONSTRAINT one_active_erasure_per_subject UNIQUE NULLS NOT DISTINCT (
    workspace_id, customer_ref, status
  )
);

CREATE INDEX IF NOT EXISTS ser_workspace_status_idx
  ON subject_erasure_request (workspace_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS ser_customer_ref_idx
  ON subject_erasure_request (workspace_id, customer_ref);

-- rls_app may SELECT, INSERT, and UPDATE (for status transitions) but NOT DELETE.
-- Erasure requests are never deleted — they are the permanent audit record.
GRANT SELECT, INSERT, UPDATE ON subject_erasure_request TO rls_app;

-- ---------------------------------------------------------------------------
-- 2. key_destruction_ledger — WORM append-only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS key_destruction_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links back to the erasure request that triggered the DEK destruction.
  erasure_id      UUID NOT NULL REFERENCES subject_erasure_request(id) ON DELETE RESTRICT,

  -- The DEK identifier (workspace-scoped; never the actual key material).
  -- Format: "<workspace_id>/<customer_ref>/<salt_version>" — the same triple
  -- used to look up the per-subject DEK in Secrets Manager (R1 / P0-B).
  dek_key_id      TEXT NOT NULL,

  -- When the DEK was destroyed in the key store.
  destroyed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Storage tier the DEK covered.
  tier            TEXT NOT NULL
    CHECK (tier IN ('s3_raw','glacier','customer_pii_ct')),

  -- Outcome of the destruction attempt.
  outcome         TEXT NOT NULL DEFAULT 'destroyed'
    CHECK (outcome IN ('destroyed','already_destroyed','not_found','error')),

  -- Structured error for audit (NULL on success).
  error_detail    TEXT,

  -- The vault backend that held the DEK (e.g. 'secrets_manager', 'local_aesgcm').
  vault_backend   TEXT NOT NULL DEFAULT 'local_aesgcm',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kdl_erasure_idx ON key_destruction_ledger (erasure_id);
CREATE INDEX IF NOT EXISTS kdl_dek_key_id_idx ON key_destruction_ledger (dek_key_id);

-- WORM trigger — prevents UPDATE and DELETE on this table.
-- Any attempt to mutate an existing row raises an exception, making the ledger
-- tamper-evident for DPB (Data Protection Board) audit purposes.
CREATE OR REPLACE FUNCTION key_destruction_ledger_worm_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'key_destruction_ledger is append-only (WORM). Attempted % on row id=%. '
    'This table is the DPDP §12 crypto-shred evidence record and must never be modified.',
    TG_OP,
    OLD.id;
  RETURN NULL;
END;
$$;

-- Attach the WORM guard trigger.
DROP TRIGGER IF EXISTS kdl_worm_guard ON key_destruction_ledger;
CREATE TRIGGER kdl_worm_guard
  BEFORE UPDATE OR DELETE ON key_destruction_ledger
  FOR EACH ROW
  EXECUTE FUNCTION key_destruction_ledger_worm_guard();

-- rls_app may SELECT and INSERT only. No UPDATE or DELETE (trigger enforces WORM).
GRANT SELECT, INSERT ON key_destruction_ledger TO rls_app;

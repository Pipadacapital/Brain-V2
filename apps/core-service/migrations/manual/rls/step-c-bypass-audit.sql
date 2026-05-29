-- =============================================================================
-- STEP C: bypass_query_log — CREATE TABLE + policies
-- @paradigm sql
--
-- Runbook-gated DDL — NOT auto-applied by any migration runner (CF-BN-DDL-GATING-1).
-- Executed at STEP 3.5 of rollout-runbook.sh (AFTER STEP 3 ENABLE+CREATE, BEFORE STEP 4 probe).
--
-- CF-CUT-BYPASS-AUDIT-1 (half-2): structured audit of bypass-role queries.
-- CF-C1-RLS-DEFAULT-1.a: all policies use ONLY approved fail-closed shapes.
--
-- BANNED shapes (verified by Shreya at Stage-4 grep):
--   OR ... IS NULL
--   COALESCE
--   USING (true)
--   Session-level SET
--
-- §12 erasure-scopable per Child-7 CF-C7-DPDP-ERASURE-1:
--   DELETE FROM bypass_query_log WHERE workspace_id = $1;   -- per-data-principal
--
-- Retention: bounded by Path-B-completion exit deadline (CF-CUT-PATH-1).
-- Down: see sibling down-bypass-audit.sql (Stage 3 owns, symmetric rollback).
-- =============================================================================

CREATE TABLE IF NOT EXISTS bypass_query_log (
  id               BIGSERIAL PRIMARY KEY,
  ts               TIMESTAMPTZ NOT NULL DEFAULT now(),
  workspace_id     UUID,                    -- nullable; system queries → null (covered by superadmin policy)
  connection_id    TEXT,                    -- pg_stat_activity.application_name + pid
  application_name TEXT,                    -- e.g. 'legacy-express' vs other; attribution column
  statement_class  TEXT NOT NULL CHECK (statement_class IN ('SELECT','INSERT','UPDATE','DELETE','DDL','OTHER')),
  -- NOT raw text — preserves erasure-scopability per Child-1 audit-log discipline
  rows_affected    INTEGER,                 -- nullable; SELECTs may not log this
  duration_ms      INTEGER,
  table_touched    TEXT                     -- single primary table (best-effort parse); for cross-workspace tripwire
);

CREATE INDEX IF NOT EXISTS idx_bypass_query_log_ts             ON bypass_query_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_bypass_query_log_workspace_id   ON bypass_query_log (workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bypass_query_log_application    ON bypass_query_log (application_name, ts DESC);

ALTER TABLE bypass_query_log ENABLE ROW LEVEL SECURITY;

-- Workspace-scoped read/write policy (fail-closed: workspace_id must match context GUC).
-- Uses ONLY the approved current_setting form — no OR, no COALESCE, no USING(true).
CREATE POLICY ws_isolation ON bypass_query_log
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- System-row policy: rows where workspace_id IS NULL (system-level bypass-grant records)
-- are readable/writable only under app.is_superadmin=true. This is the dual-policy
-- shape from CF-C1-AUDITLOG-1.a — identical to audit_logs, notifications, system_settings.
CREATE POLICY superadmin_system_rows ON bypass_query_log
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');

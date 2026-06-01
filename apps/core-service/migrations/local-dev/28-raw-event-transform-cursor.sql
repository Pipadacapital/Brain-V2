-- =============================================================================
-- 28 — raw-event transform cursor (ADR-CONVERGENCE-001 finding B).
--
-- The transform worker that reads brain.connector_raw_events (CH, append-only)
-- and derives the typed facts must track its progress somewhere mutable. CH has
-- no in-place UPDATE, so the cursor lives HERE in Postgres (OLTP), one row per
-- (workspace_id, vendor, event_type). The worker reads CH events
-- WHERE received_at > last_processed_received_at, processes the batch, and
-- advances this cursor in a transaction. This is the Kafka/Flink cursor pattern
-- without the broker dependency — durable cursor in OLTP, immutable append log in CH.
--
-- workspace_id-scoped + RLS (fail-closed, Child-1 pattern). Money: none.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.raw_event_transform_state (
  workspace_id                   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor                         TEXT        NOT NULL,
  event_type                     TEXT        NOT NULL,
  last_processed_received_at     TIMESTAMPTZ,
  last_processed_idempotency_key TEXT,
  status                         TEXT        NOT NULL DEFAULT 'idle'
                                             CHECK (status IN ('idle','running','errored')),
  error                          TEXT,
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, vendor, event_type)
);

ALTER TABLE public.raw_event_transform_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON public.raw_event_transform_state;
CREATE POLICY ws_isolation ON public.raw_event_transform_state
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

CREATE INDEX IF NOT EXISTS idx_raw_event_transform_state_ws
  ON public.raw_event_transform_state (workspace_id, vendor, event_type);

-- @paradigm: sql
-- 0015 — Silver freshness tracking (P1-E Amendment 4).
--
-- Amendment 4 (Rohan, Stage-1):
--   emit silver_freshness{workspace_id,date};
--   recompute_daily MUST gate gold recompute on it during any replay window.
--
-- silver_freshness_log records when the silver tier for a given (workspace_id, date)
-- was last updated by the transform worker.  recompute_daily reads this log to verify
-- that silver data is present and fresh before writing gold
-- (workspace_daily_metrics_base).  During a replay window (an explicit replay_run_id
-- is passed), gold rows are only written for dates whose silver_freshness_log entry
-- is at least as recent as the replay trigger.
--
-- Design decisions:
--   - ReplacingMergeTree(refreshed_at) — idempotent UPSERTs; the latest
--     refreshed_at per (workspace_id, date) wins after background merge.
--   - FINAL read semantics: every SELECT on this table must use FINAL.
--   - No TTL: freshness rows are small (one per workspace per date); purge is
--     handled by the erasure orchestrator (P0-D) when a workspace is deleted.
--
-- Stored in the `brain` database alongside the other silver/gold tables.

CREATE TABLE IF NOT EXISTS brain.silver_freshness_log (
    workspace_id        String              NOT NULL,
    date                Date                NOT NULL,
    -- rows_written: the number of silver facts written for this date in the
    -- last transform-worker run.  Zero means the transform worker ran but
    -- produced no silver rows (still counts as fresh — prevents spurious gold
    -- skips when a vendor had no events on that date).
    rows_written        UInt64              DEFAULT 0,
    -- source: identifies which writer updated the freshness entry.
    --   'transform_worker'  — P1-B graduation worker (live path)
    --   'backfill_worker'   — replay / historical backfill
    --   'manual'            — ops override (break-glass)
    source              LowCardinality(String) NOT NULL DEFAULT 'transform_worker',
    refreshed_at        DateTime64(3)       NOT NULL DEFAULT now64()
)
ENGINE = ReplacingMergeTree(refreshed_at)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, date);

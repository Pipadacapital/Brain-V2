-- down.sql — REVERSE migration for Child 5 ai.* + memory.* schema.
-- Drops in reverse FK order. Run against Brain Supabase (ap-south-1).
-- Rollback note: cache purge is irreversible (cache cold); the audit
--   Decision-Log row from the purge is permanent. All other tables drop cleanly.

BEGIN;

-- Drop triggers first.
DROP TRIGGER IF EXISTS trg_decision_log_no_update ON ai.decision_log;
DROP FUNCTION IF EXISTS ai.decision_log_no_update();

-- Drop tables in reverse FK dependency order.
DROP TABLE IF EXISTS ai.insight_cache;
DROP TABLE IF EXISTS ai.workspace_action_cap;
DROP TABLE IF EXISTS ai.graduation;
DROP TABLE IF EXISTS ai.decision_log;
DROP TABLE IF EXISTS memory.brand_fingerprint;

-- Drop schemas (only if empty).
DROP SCHEMA IF EXISTS memory;
DROP SCHEMA IF EXISTS ai;

COMMIT;

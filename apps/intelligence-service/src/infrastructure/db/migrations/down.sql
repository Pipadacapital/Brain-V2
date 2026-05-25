-- down.sql — Reverse migration for Child 5 ai.* + memory.* schema.
--
-- Drops in reverse FK order. Reversible: restores the pre-Child-5 state.
-- WARNING: this DROPS all Decision-Log, graduation, cap, and cache data.
-- Run ONLY in a test environment or during a deliberate rollback.

DROP TABLE IF EXISTS ai.insight_cache;
DROP TABLE IF EXISTS ai.graduation;
DROP TABLE IF EXISTS ai.workspace_action_cap;
DROP TABLE IF EXISTS ai.decision_log;
DROP TABLE IF EXISTS memory.brand_fingerprint;
DROP SCHEMA IF EXISTS memory;
DROP SCHEMA IF EXISTS ai;

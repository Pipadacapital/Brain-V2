-- =============================================================================
-- Phase 5 — slice-E rename to *_hot + compatibility view (zero gateway regression).
-- Plan: docs/data-architecture-plan-v2.md §3.9 + §7.
--
-- The 2 high-volume slice-E facts become the 90-day hot mirror per canon. The CH
-- copy (Phase 8) is now authoritative beyond 90 days. To keep `fact-analytics.ts`
-- working unchanged during the read-path move (Phase 6), we replace each renamed
-- table with a security_invoker view at the OLD name:
--
--   - SELECT through the view → underlying *_hot table; RLS evaluated as the caller
--     (rls_app with app.workspace_id) — same behaviour as before the rename.
--   - INSERT/UPDATE/DELETE through the view → auto-updatable simple view: PG passes
--     writes through to *_hot, all constraints/indexes/unique keys still enforced.
--
-- After Phase 6 flips READ_FROM_CH for every read function + Phase 8 parity passes,
-- the compat view can be dropped (the code reads CH; writes still target *_hot).
-- =============================================================================

BEGIN;

-- connector_order_facts → _hot
ALTER TABLE connector_order_facts RENAME TO connector_order_facts_hot;

CREATE OR REPLACE VIEW connector_order_facts
  WITH (security_invoker = true)
  AS SELECT * FROM connector_order_facts_hot;
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_order_facts TO rls_app;

-- connector_line_item_facts → _hot
ALTER TABLE connector_line_item_facts RENAME TO connector_line_item_facts_hot;

CREATE OR REPLACE VIEW connector_line_item_facts
  WITH (security_invoker = true)
  AS SELECT * FROM connector_line_item_facts_hot;
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_line_item_facts TO rls_app;

COMMIT;

-- migrate: skip — HELD A4b cutover step, run manually by the operator (see below),
--   NOT part of the automatic local/CI migration. Auto-running it revokes the grants
--   the local gateway uses (DATABASE_URL connects as rls_app) and breaks every read.
-- =============================================================================
-- A4a — HELD ACTIVATION (A4b cutover step). Revoke rls_app's over-broad grants.
--
-- This is the ONE step that flips isolation ON. Run it ONLY AFTER every service
-- is confirmed connecting as its per-service role (svc_core/svc_ingestion/
-- svc_intelligence/svc_analytics_ro). Until then rls_app keeps its grants, so a
-- failed cutover is a one-line DATABASE_URL rollback to rls_app with zero DB change.
--
-- HELD: NOT auto-run by initdb and NOT part of the additive local migration. The
-- Founder/operator runs it at the A4b live ceremony (and locally only after the
-- svc_core gateway cutover is smoke-verified). Reverse = down-27-*.sql.
-- =============================================================================

REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM rls_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM rls_app;
REVOKE ALL ON ALL TABLES IN SCHEMA legacy_aggregates FROM rls_app;

-- Once nothing connects as rls_app, it may be dropped (kept commented — the very
-- last, hardest-to-reverse step; do under explicit Founder authorization):
-- DROP ROLE IF EXISTS rls_app;

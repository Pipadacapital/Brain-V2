-- =============================================================================
-- 37 — Enable + FORCE RLS on the three P1-C identity tables.
--
-- WHY: migration 36 created workspace_identity_salt, identity_cluster_registry,
-- and identity_cluster_edges with GRANTs but NO row security.  Any connection
-- as rls_app can therefore read ALL workspaces' salts — a cross-tenant salt
-- read that defeats the per-workspace isolation guarantee (R10).
--
-- Policy shape (ws_isolation — identical to 02-enable-rls-onboarding.sql):
--   USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
--   No OR..IS NULL · No COALESCE · No USING(true) — fail-closed by design.
--
-- NULLIF(current_setting(..., true), '') pattern:
--   - missing GUC → NULL → NULLIF returns NULL → cast returns NULL → row invisible
--   - empty-string GUC → NULLIF('', '') = NULL → same fail-closed result
--   - valid UUID GUC → cast succeeds → only matching rows visible
--
-- All three tables are strictly workspace-scoped; there is no cross-workspace
-- sanctioned read path (unlike workspace_members which has a superadmin path for
-- onboarding).  A superadmin_rows policy is NOT added: the salt vault helpers
-- already call withSuperadmin() (which uses the postgres superuser and bypasses
-- RLS by having rolbypassrls=true), so the RLS policies here apply to rls_app only.
--
-- Apply order: after 36-identity-hashes.sql. Run as postgres superuser.
-- Reversible via 37-down-enable-rls-identity.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- workspace_identity_salt
-- ---------------------------------------------------------------------------
ALTER TABLE workspace_identity_salt ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_identity_salt;
CREATE POLICY ws_isolation ON workspace_identity_salt
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_identity_salt FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- identity_cluster_registry
-- ---------------------------------------------------------------------------
ALTER TABLE identity_cluster_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON identity_cluster_registry;
CREATE POLICY ws_isolation ON identity_cluster_registry
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE identity_cluster_registry FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- identity_cluster_edges
-- ---------------------------------------------------------------------------
ALTER TABLE identity_cluster_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON identity_cluster_edges;
CREATE POLICY ws_isolation ON identity_cluster_edges
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE identity_cluster_edges FORCE ROW LEVEL SECURITY;

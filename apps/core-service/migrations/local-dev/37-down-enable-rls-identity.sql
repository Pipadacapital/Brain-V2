-- =============================================================================
-- DOWN — 37-enable-rls-identity.sql
-- Removes FORCE + ENABLE RLS from the three P1-C identity tables.
-- Safe to run in dev/test; never run in production.
-- =============================================================================

ALTER TABLE identity_cluster_edges NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON identity_cluster_edges;
ALTER TABLE identity_cluster_edges DISABLE ROW LEVEL SECURITY;

ALTER TABLE identity_cluster_registry NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON identity_cluster_registry;
ALTER TABLE identity_cluster_registry DISABLE ROW LEVEL SECURITY;

ALTER TABLE workspace_identity_salt NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_identity_salt;
ALTER TABLE workspace_identity_salt DISABLE ROW LEVEL SECURITY;

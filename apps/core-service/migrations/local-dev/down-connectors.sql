-- =============================================================================
-- LOCAL-DEV — symmetric rollback for the slice-D connector schema.
--
-- Reverses 04-enable-rls-connectors.sql + 03-schema-connectors.sql.
-- Idempotent (IF EXISTS). Run as the postgres superuser BEFORE slice-C down.sql
-- (these tables FK to workspaces, so they must drop first — or rely on the
-- workspaces CASCADE in down.sql). LOCAL DEV teardown only; live DB untouched.
-- =============================================================================

ALTER TABLE IF EXISTS connector_oauth_states NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS connector_oauth_states DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation    ON connector_oauth_states;
DROP POLICY IF EXISTS superadmin_rows ON connector_oauth_states;

ALTER TABLE IF EXISTS connector_credentials NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS connector_credentials DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation    ON connector_credentials;
DROP POLICY IF EXISTS superadmin_rows ON connector_credentials;

ALTER TABLE IF EXISTS connector_connections NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS connector_connections DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation    ON connector_connections;
DROP POLICY IF EXISTS superadmin_rows ON connector_connections;

DROP TABLE IF EXISTS connector_oauth_states CASCADE;
DROP TABLE IF EXISTS connector_credentials  CASCADE;
DROP TABLE IF EXISTS connector_connections  CASCADE;

DROP TYPE IF EXISTS connector_status;
DROP TYPE IF EXISTS connector_vendor;

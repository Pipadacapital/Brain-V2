-- =============================================================================
-- LOCAL-DEV — symmetric rollback for the slice-C onboarding/membership schema.
--
-- Reverses 02-enable-rls-onboarding.sql + 01-schema-onboarding.sql.
-- Idempotent (IF EXISTS). Run as the postgres superuser.
--
-- NOTE: this is the LOCAL DEV teardown only. The live/legacy production DB is
-- never touched by slice C.
-- =============================================================================

-- Drop policies + RLS, then tables (CASCADE drops the FK-dependent rows/indexes).
ALTER TABLE IF EXISTS invitations        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invitations        DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation    ON invitations;
DROP POLICY IF EXISTS superadmin_rows ON invitations;

ALTER TABLE IF EXISTS workspace_members NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS workspace_members DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation    ON workspace_members;
DROP POLICY IF EXISTS superadmin_rows ON workspace_members;

ALTER TABLE IF EXISTS workspaces        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS workspaces        DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_self_isolation ON workspaces;
DROP POLICY IF EXISTS superadmin_rows   ON workspaces;

ALTER TABLE IF EXISTS users             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users             DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS superadmin_only ON users;

DROP TABLE IF EXISTS invitations        CASCADE;
DROP TABLE IF EXISTS workspace_members  CASCADE;
DROP TABLE IF EXISTS workspaces         CASCADE;
DROP TABLE IF EXISTS users              CASCADE;

DROP TYPE IF EXISTS invitation_status;
DROP TYPE IF EXISTS store_platform;
DROP TYPE IF EXISTS workspace_role;
DROP TYPE IF EXISTS system_role;

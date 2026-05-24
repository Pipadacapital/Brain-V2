-- F1 fix: create non-BYPASSRLS application role for integration tests.
-- The postgres superuser has rolbypassrls=true and bypasses RLS even under
-- FORCE ROW LEVEL SECURITY, making RLS isolation assertions structurally
-- unprovable when tests run as postgres.
--
-- rls_app is a dedicated application role that:
--   (a) is NOT a superuser (no rolsuper)
--   (b) has rolbypassrls=false (default for non-superuser roles)
--   (c) has LOGIN (needed for direct connection)
--   (d) is granted CONNECT + schema/table privileges needed by integration tests
--
-- This mirrors the production constraint: Brain's DIRECT_URL application role
-- MUST have rolbypassrls=false for FORCE ROW LEVEL SECURITY to be meaningful.
-- The _rawQuery helper in workspace-context.ts asserts this at runtime.

-- Create the application role (NOINHERIT for belt-and-suspenders privilege isolation).
CREATE ROLE rls_app WITH LOGIN PASSWORD 'rls_app_pw' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Grant database connection.
GRANT CONNECT ON DATABASE brain_test TO rls_app;

-- Grant schema usage.
GRANT USAGE ON SCHEMA public TO rls_app;

-- Grant DML on all current and future tables in the public schema.
-- setupSchema() in pool-isolation.test.ts creates rls_test_table dynamically;
-- the superuser (postgres) creates it, then must grant privileges to rls_app.
-- The ALTER DEFAULT PRIVILEGES ensures future tables created by postgres are
-- automatically accessible to rls_app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rls_app;

-- Also grant access to pg_roles for the BYPASSRLS runtime check in _rawQuery.
-- pg_roles is a view accessible to all roles by default in Postgres, no extra grant needed.

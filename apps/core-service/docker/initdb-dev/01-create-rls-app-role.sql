-- LOCAL-DEV role init for the brain_dev database (slice C).
--
-- Creates rls_app: the non-BYPASSRLS application role the api-gateway connects as
-- via DATABASE_URL. This MIRRORS the production constraint: Brain's application
-- role MUST have rolbypassrls=false for FORCE ROW LEVEL SECURITY to be meaningful.
-- (The postgres superuser bypasses RLS — it is used only for DDL/migrations.)
--
-- This file is auto-run by the postgres image's docker-entrypoint-initdb.d on
-- first container start (empty data dir). It runs against POSTGRES_DB=brain_dev.
--
-- rolbypassrls defaults to false for a non-superuser role — RLS actually applies.

CREATE ROLE rls_app WITH LOGIN PASSWORD 'rls_app_pw' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE brain_dev TO rls_app;
GRANT USAGE ON SCHEMA public TO rls_app;

-- Future tables created by postgres become accessible to rls_app automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rls_app;

-- pg_roles is readable by all roles by default (needed by the BYPASSRLS runtime
-- check in workspace-context._rawQuery) — no extra grant required.

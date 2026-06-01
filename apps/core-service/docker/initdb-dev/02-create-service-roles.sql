-- =============================================================================
-- A4a — per-service Postgres roles (isolation by permission).
--
-- Splits the single over-broad `rls_app` role into four least-privilege,
-- per-service login roles. RLS still applies (all are NON-BYPASSRLS); A4 changes
-- WHICH TABLES each service can touch, not WHICH ROWS (workspace_id RLS is
-- unchanged). The per-table GRANTs live in each owning service's migration
-- (one-writer-per-store): core → 26-grant-svc-roles.sql; ingestion →
-- migrations/manual/raw/grant-svc-ingestion.sql; intelligence → migrations/
-- postgres/up.sql. This file creates the roles + schema-level USAGE + the
-- non-overlapping-schema DEFAULT PRIVILEGES.
--
-- Runs at first-boot of postgres-dev (docker-entrypoint-initdb.d), after the
-- 01-rls_app role file. Live ceremony (A4b): the identical SQL is run by the
-- Founder against ap-south-1 Supabase, then each service's DATABASE_URL is
-- rotated to its role + 27-revoke-rls-app-overbroad.sql is applied.
--
-- Idempotent: guarded CREATE ROLE.
-- =============================================================================

-- Local-dev passwords ONLY — live roles get console-set passwords (A4b).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_core') THEN
    CREATE ROLE svc_core        WITH LOGIN PASSWORD 'svc_core_pw'        NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ingestion') THEN
    CREATE ROLE svc_ingestion   WITH LOGIN PASSWORD 'svc_ingestion_pw'   NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_intelligence') THEN
    CREATE ROLE svc_intelligence WITH LOGIN PASSWORD 'svc_intelligence_pw' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_analytics_ro') THEN
    CREATE ROLE svc_analytics_ro WITH LOGIN PASSWORD 'svc_analytics_ro_pw' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- All roles may connect.
GRANT CONNECT ON DATABASE brain_dev TO svc_core, svc_ingestion, svc_intelligence, svc_analytics_ro;

-- ---------------------------------------------------------------------------
-- Schema USAGE — the FIRST isolation layer.
--   - svc_core / svc_ingestion share the `public` schema (table-level grants
--     partition who touches what within it).
--   - svc_intelligence gets ai + memory ONLY — NO public USAGE, so it cannot
--     even resolve public.customer_pii (denied at schema resolution).
--   - svc_analytics_ro gets public USAGE but ZERO table grants (its PG
--     connection exists only for the startup read-only-role probe).
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public            TO svc_core, svc_ingestion, svc_analytics_ro;
GRANT USAGE ON SCHEMA legacy_aggregates TO svc_core;
GRANT USAGE ON SCHEMA ai                TO svc_intelligence;
GRANT USAGE ON SCHEMA memory            TO svc_intelligence;

-- ---------------------------------------------------------------------------
-- DEFAULT PRIVILEGES — ONLY for NON-OVERLAPPING schemas (single owner).
-- For shared `public` we deliberately DO NOT set default privileges (it would
-- mis-grant cross-owner tables); new public tables are granted explicitly in
-- the owning service's migration, and conformance C12 fails if a new public
-- table is left ungranted to its owner.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ai
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_intelligence;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA memory
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_intelligence;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA legacy_aggregates
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_core;

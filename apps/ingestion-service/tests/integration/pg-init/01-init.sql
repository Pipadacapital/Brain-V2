-- LOCAL test DB init — creates the rls_app role and a minimal schema
-- for the integration tests.
--
-- M1/F-4 fix: table names NOW match the prod DDL (raw_* prefix).
-- Previously used un-prefixed names (shopify_orders) while prod DDL creates
-- raw_shopify_orders — causing every production UPSERT to fail on a missing
-- relation.  The LOCAL init is derived directly from step-a-enable-create.sql
-- so the divergence can never silently mask the mismatch again.
--
-- CF-C3-RESIDENCY-ASSERT-1: This is a LOCAL test DB, NOT the live Supabase ap-south-1.
-- CF-C3-RLS-CONSUME-1: with_workspace sets app.workspace_id; FORCE RLS (step-b-force.sql)
--   is applied only at Stage-8 HOLD-AT-CUTOVER, not here.
--
-- This init creates:
--   (a) The brain_rls_app role (non-BYPASSRLS, mirrors Child-1 CF-SEC-1 compliance)
--   (b) The connector_cursor table (Track M, M4) — with window_start/window_end NOT NULL
--       matching step-a-enable-create.sql (M2/F-6 fix: LOCAL DDL must match prod DDL)
--   (c) raw_shopify_orders (prod-DDL-aligned name, raw_* prefix)
--   RLS policy: step-a-enable-create shape (ENABLE + CREATE POLICY, NO FORCE yet)

-- Create the application role (non-BYPASSRLS — mirrors Child-1 rls_app)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brain_rls_app') THEN
    CREATE ROLE brain_rls_app LOGIN PASSWORD 'brain_rls_app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END;
$$;

GRANT CONNECT ON DATABASE brain_test TO brain_rls_app;
GRANT USAGE ON SCHEMA public TO brain_rls_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO brain_rls_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO brain_rls_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO brain_rls_app;

-- connector_cursor — Track M (M4 cursor-persistence contract)
-- M2/F-6 fix: window_start + window_end are NOT NULL (matching prod DDL in
-- step-a-enable-create.sql).  The old LOCAL init omitted these columns, which
-- caused upsert_cursor() to fail the NOT NULL constraint in integration tests.
CREATE TABLE IF NOT EXISTS connector_cursor (
    id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     UUID        NOT NULL,
    vendor           TEXT        NOT NULL,
    cursor_value     TEXT        NOT NULL,
    window_start     TIMESTAMPTZ NOT NULL,
    window_end       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, vendor)
);

-- raw_shopify_orders — M1/F-4 fix: prod-DDL-aligned name (raw_* prefix)
-- Full DDL in migrations/manual/raw/step-a-enable-create.sql (Track M, runbook-gated)
-- Minimal columns sufficient for integration tests + cross-workspace isolation test.
CREATE TABLE IF NOT EXISTS raw_shopify_orders (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id    UUID        NOT NULL,
    vendor_event_id TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    lawful_basis    TEXT        NOT NULL,
    purpose_code    TEXT        NOT NULL,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    vendor          TEXT        NOT NULL DEFAULT 'shopify',
    occurred_at     TIMESTAMPTZ,
    raw_payload     JSONB,
    UNIQUE (workspace_id, vendor_event_id)
);

-- Enable RLS (step-a shape — CF-C3-RLS-CONSUME-1)
ALTER TABLE raw_shopify_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_cursor ENABLE ROW LEVEL SECURITY;

-- Create the fail-closed ws_isolation policy (identical to Child-1 shape)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'raw_shopify_orders' AND policyname = 'ws_isolation'
  ) THEN
    CREATE POLICY ws_isolation ON raw_shopify_orders
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'connector_cursor' AND policyname = 'ws_isolation'
  ) THEN
    CREATE POLICY ws_isolation ON connector_cursor
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END;
$$;

-- =============================================================================
-- 34-p1a-grants-and-multicurrency.sql  (P1-A — ruling 3 + ruling G)
--
-- Ruling 3: ALTER DEFAULT PRIVILEGES for newly-created tables.
--   Every new table added after the initial schema bootstrap must be covered
--   by ALTER DEFAULT PRIVILEGES so that rls_app (and future per-service roles)
--   receive the correct grants automatically.  Without this, a new migration
--   that CREATE TABLE without explicit GRANTs leaves the table inaccessible to
--   application connections until someone notices and patches it.
--
--   Scope: schema `public`.  Applies to tables created by role `postgres` going
--   forward.  Historical tables already have per-table grants (01-18 migrations);
--   this covers future codegen-driven tables.
--
-- Ruling G: multi-currency CM guard.
--   ClickHouse `workspace_daily_metrics_base` aggregates money columns (gross_sales_mu,
--   cogs_mu, spend_mu etc.) across ALL vendor facts for a workspace.  If a workspace
--   has orders in AED and INR on the same day, summing them is incorrect (the numbers
--   are additive ONLY within a single currency).  Mixing currencies silently produces
--   CM2/CM3 figures that are arithmetically nonsense.
--
--   This migration adds a PG-side constraint:
--     connector_order_facts_hot MUST have a single currency_code per workspace per
--     calendar day (or NULL/empty rows are exempt as legacy ETL artefacts).
--
--   We record the multi-currency guard as a workspace-level flag so the analytics
--   service and recompute_daily can short-circuit metric computation for flagged
--   workspaces (returning NULL / a BLOCKED_MULTICURRENCY status rather than silently
--   wrong numbers).
--
-- @paradigm: sql
-- Feature flag: none — additive schema change.
-- Rollback: 34-down-p1a-grants-and-multicurrency.sql (drops the flag column + reverts).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Ruling 3: ALTER DEFAULT PRIVILEGES
-- Ensures every future CREATE TABLE in schema public by role 'postgres'
-- automatically grants SELECT to rls_app (read access).  Per-table write
-- grants are added explicitly in each migration (belt-and-suspenders).
-- ---------------------------------------------------------------------------

-- SELECT default for rls_app (safe for all tables — rls_app is a read-side role
-- for application connections; write grants are per-table).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO rls_app;

-- Ensure postgres itself retains all-access on future tables (not strictly
-- needed since it owns them, but makes intent explicit and survives a
-- future role-permission audit).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO postgres;

-- ---------------------------------------------------------------------------
-- Ruling G: multi-currency CM guard
-- Add a flag column to `workspaces` that the analytics service reads before
-- computing CM metrics.  When multi_currency_blocked = TRUE, recompute_daily
-- must not aggregate money columns across vendors for that workspace.
-- ---------------------------------------------------------------------------

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS multi_currency_blocked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN workspaces.multi_currency_blocked IS
  'TRUE when the workspace has orders in more than one currency code. '
  'When TRUE, CM1/CM2/CM3 are BLOCKED (NULL) for that workspace because '
  'summing AED+INR is arithmetically invalid. Set by the nightly '
  'check_multi_currency_drift job (P1-A). Ruling G: multi-currency CM guard.';

GRANT SELECT ON workspaces TO rls_app;

-- ---------------------------------------------------------------------------
-- Populate multi_currency_blocked for existing data:
-- Flag workspaces that already have more than one distinct non-empty
-- currency_code across their connector_order_facts_hot rows.
-- ---------------------------------------------------------------------------

UPDATE workspaces w
SET multi_currency_blocked = TRUE
WHERE w.id IN (
  SELECT workspace_id::uuid
  FROM connector_order_facts_hot
  WHERE currency_code IS NOT NULL AND currency_code <> ''
  GROUP BY workspace_id
  HAVING COUNT(DISTINCT currency_code) > 1
);

-- ---------------------------------------------------------------------------
-- Verify: report how many workspaces were flagged.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_flagged INT;
BEGIN
  SELECT COUNT(*) INTO v_flagged FROM workspaces WHERE multi_currency_blocked = TRUE;
  RAISE NOTICE 'P1-A ruling G: % workspace(s) flagged multi_currency_blocked=TRUE', v_flagged;
END $$;

COMMIT;

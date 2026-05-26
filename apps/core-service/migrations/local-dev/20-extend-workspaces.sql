-- =============================================================================
-- Phase 1 — additive columns on workspaces (legacy parity).
-- Design: docs/data-architecture-plan.md §3.11.
-- All NOT NULL columns have safe defaults so the ALTER doesn't break existing 3 rows.
-- tax_percent migrates from legacy Decimal(5,2) → bp (5.00% → 500 bp).
-- founder_salary_monthly migrates → minor units via subunit_multiplier(currency) at ETL.
-- =============================================================================

-- subscription_plan enum (referenced by ALTER below)
DO $$ BEGIN
  CREATE TYPE subscription_plan AS ENUM ('FREE','STARTER','GROWTH','ENTERPRISE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS features                   JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo_url                   TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan                       subscription_plan NOT NULL DEFAULT 'FREE';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS tax_percent_bp             INT NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS timezone                   TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS founder_salary_currency    TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS founder_salary_monthly_mu  BIGINT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS skip_zero_sales_orders     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS skipped_shopify_order_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS product_data_source        TEXT NOT NULL DEFAULT 'SHOPIFY';

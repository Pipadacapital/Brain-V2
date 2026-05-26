-- =============================================================================
-- Phase 2 — Foundations: lift the 3-workspace filter and load ALL 13 legacy
-- workspaces + users + members + invitations (with the new additive columns).
-- Idempotent (ON CONFLICT DO UPDATE) — re-runnable to the same end state.
-- Reads via legacy_src (postgres_fdw to the IPv4 pooler) — established in Phase 0.
-- Read-only contract on legacy_src.* (SELECT only — verifiable by grep on this file).
-- =============================================================================
SET TIME ZONE 'UTC';

-- ---------------------------------------------------------------------------
-- Extend the FDW foreign tables for the 4 source tables (Phase 0 created only
-- workspaces for connectivity). Enums cast via text — same pattern as 02_migrate.sql.
-- ---------------------------------------------------------------------------
DROP FOREIGN TABLE IF EXISTS legacy_src.users;
CREATE FOREIGN TABLE legacy_src.users (
  id uuid, email text, full_name text, avatar_url text, job_role text,
  system_role text, created_at timestamp, updated_at timestamp
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'users');

DROP FOREIGN TABLE IF EXISTS legacy_src.workspaces;
CREATE FOREIGN TABLE legacy_src.workspaces (
  id uuid, name text, slug text, industry text, monthly_revenue text,
  store_url text, platform text, created_by_id uuid,
  features jsonb, logo_url text, plan text,
  tax_percent numeric, timezone text,
  founder_salary_currency text, founder_salary_monthly numeric,
  skip_zero_sales_orders boolean, skipped_shopify_order_tags text[],
  product_data_source text,
  created_at timestamp, updated_at timestamp
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'workspaces');

DROP FOREIGN TABLE IF EXISTS legacy_src.workspace_members;
CREATE FOREIGN TABLE legacy_src.workspace_members (
  id uuid, workspace_id uuid, user_id uuid, role text,
  created_at timestamp, updated_at timestamp
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'workspace_members');

DROP FOREIGN TABLE IF EXISTS legacy_src.invitations;
CREATE FOREIGN TABLE legacy_src.invitations (
  id uuid, email text, workspace_id uuid, role text, status text, token text,
  invited_by_id uuid, expires_at timestamp,
  created_at timestamp, updated_at timestamp
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'invitations');

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) users — re-upsert (idempotent; existing 24 rows unchanged).
-- ---------------------------------------------------------------------------
INSERT INTO users (id, email, full_name, avatar_url, job_role, system_role, created_at, updated_at)
SELECT id, email, full_name, avatar_url, job_role,
       (CASE WHEN system_role = 'SUPERADMIN' THEN 'SUPERADMIN' ELSE 'USER' END)::system_role,
       created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
FROM legacy_src.users
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email, full_name = EXCLUDED.full_name, avatar_url = EXCLUDED.avatar_url,
  job_role = EXCLUDED.job_role, system_role = EXCLUDED.system_role, updated_at = EXCLUDED.updated_at;

-- ---------------------------------------------------------------------------
-- 2) workspaces — ALL 13 (no filter), with new additive columns.
--    tax_percent (5.00%) → tax_percent_bp (500 bp).
--    founder_salary_monthly × subunit_multiplier(currency) → founder_salary_monthly_mu.
--    Inline subunit CASE (INR/AED/USD/EUR/GBP/SAR=100, KWD/BHD=1000, JPY=1, default=100).
-- ---------------------------------------------------------------------------
INSERT INTO workspaces (
  id, name, slug, industry, monthly_revenue, store_url, platform, created_by_id,
  features, logo_url, plan, tax_percent_bp, timezone,
  founder_salary_currency, founder_salary_monthly_mu,
  skip_zero_sales_orders, skipped_shopify_order_tags, product_data_source,
  created_at, updated_at
)
SELECT id, name, slug, industry, monthly_revenue, store_url,
  (CASE WHEN platform = 'WOOCOMMERCE' THEN 'WOOCOMMERCE' ELSE 'SHOPIFY' END)::store_platform,
  created_by_id,
  COALESCE(features, '{}'::jsonb),
  logo_url,
  (CASE WHEN plan IS NULL OR plan = '' THEN 'FREE' ELSE upper(plan) END)::subscription_plan,
  COALESCE((tax_percent * 100)::int, 0),
  COALESCE(NULLIF(timezone,''), 'Asia/Kolkata'),
  founder_salary_currency,
  CASE
    WHEN founder_salary_monthly IS NULL THEN NULL
    ELSE (founder_salary_monthly
          * (CASE WHEN upper(COALESCE(founder_salary_currency,'INR')) IN ('KWD','BHD') THEN 1000
                  WHEN upper(COALESCE(founder_salary_currency,'INR')) = 'JPY' THEN 1
                  ELSE 100 END))::bigint
  END,
  COALESCE(skip_zero_sales_orders, FALSE),
  COALESCE(skipped_shopify_order_tags, '{}'::text[]),
  COALESCE(product_data_source, 'SHOPIFY'),
  created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
FROM legacy_src.workspaces
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name, slug=EXCLUDED.slug, industry=EXCLUDED.industry,
  monthly_revenue=EXCLUDED.monthly_revenue, store_url=EXCLUDED.store_url,
  platform=EXCLUDED.platform, features=EXCLUDED.features, logo_url=EXCLUDED.logo_url,
  plan=EXCLUDED.plan, tax_percent_bp=EXCLUDED.tax_percent_bp, timezone=EXCLUDED.timezone,
  founder_salary_currency=EXCLUDED.founder_salary_currency,
  founder_salary_monthly_mu=EXCLUDED.founder_salary_monthly_mu,
  skip_zero_sales_orders=EXCLUDED.skip_zero_sales_orders,
  skipped_shopify_order_tags=EXCLUDED.skipped_shopify_order_tags,
  product_data_source=EXCLUDED.product_data_source,
  updated_at=EXCLUDED.updated_at;

-- ---------------------------------------------------------------------------
-- 3) workspace_members — ALL 25 (no filter). Conflict on (user_id, workspace_id).
--    Rishabh's locally-added memberships (boddactive / boddactive-uae) are NOT in
--    legacy → they don't conflict and remain (intentional: keep local-test access).
-- ---------------------------------------------------------------------------
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT workspace_id, user_id,
  (CASE role
     WHEN 'OWNER' THEN 'OWNER' WHEN 'ADMIN' THEN 'ADMIN' WHEN 'MANAGER' THEN 'MANAGER'
     WHEN 'ANALYST' THEN 'ANALYST' ELSE 'VIEWER' END)::workspace_role
FROM legacy_src.workspace_members
ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = EXCLUDED.role;

-- ---------------------------------------------------------------------------
-- 4) invitations — ALL 48. legacy token (text) → token (uuid) via ::uuid cast.
--    Conflict on id (PK).
-- ---------------------------------------------------------------------------
INSERT INTO invitations (id, email, workspace_id, role, status, token, invited_by_id,
                         expires_at, created_at, updated_at)
SELECT id, email, workspace_id,
  (CASE role
     WHEN 'OWNER' THEN 'OWNER' WHEN 'ADMIN' THEN 'ADMIN' WHEN 'MANAGER' THEN 'MANAGER'
     WHEN 'ANALYST' THEN 'ANALYST' ELSE 'VIEWER' END)::workspace_role,
  (CASE status
     WHEN 'PENDING' THEN 'PENDING' WHEN 'ACCEPTED' THEN 'ACCEPTED'
     WHEN 'EXPIRED' THEN 'EXPIRED' WHEN 'REVOKED' THEN 'REVOKED' ELSE 'PENDING' END)::invitation_status,
  token::uuid,
  invited_by_id,
  expires_at AT TIME ZONE 'UTC',
  created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
FROM legacy_src.invitations
ON CONFLICT (id) DO UPDATE SET
  email=EXCLUDED.email, workspace_id=EXCLUDED.workspace_id, role=EXCLUDED.role,
  status=EXCLUDED.status, token=EXCLUDED.token, invited_by_id=EXCLUDED.invited_by_id,
  expires_at=EXCLUDED.expires_at, updated_at=EXCLUDED.updated_at;

COMMIT;

-- Phase 2 verification
SELECT 'users='||count(*)::text FROM users;
SELECT 'workspaces='||count(*)::text FROM workspaces;
SELECT 'workspace_members='||count(*)::text FROM workspace_members;
SELECT 'invitations='||count(*)::text FROM invitations;
SELECT slug, plan::text, tax_percent_bp, timezone FROM workspaces ORDER BY slug;

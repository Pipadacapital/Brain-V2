-- =============================================================================
-- Phase 7 — workspace-config ETL (legitimately OLTP per v2 store-split).
-- 6 source tables → Brain-native PG (Phase 1 schemas). All idempotent, RLS-forced.
-- No impact on the running gateway (these are new tables it doesn't read yet).
-- Plan: docs/data-architecture-plan-v2.md §3 (PG side); legacy schemas confirmed.
-- =============================================================================
SET TIME ZONE 'UTC';

-- ---------------------------------------------------------------------------
-- Extend FDW for the 6 source tables (read-only contract on legacy_src.*).
-- ---------------------------------------------------------------------------
DROP FOREIGN TABLE IF EXISTS legacy_src.workspace_cogs_settings;
CREATE FOREIGN TABLE legacy_src.workspace_cogs_settings (
  id uuid, workspace_id uuid,
  override_all_cogs_percent numeric, fallback_cogs_percent numeric, cogs_markup_percent numeric,
  updated_at timestamp
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'workspace_cogs_settings');

DROP FOREIGN TABLE IF EXISTS legacy_src.workspace_costs;
CREATE FOREIGN TABLE legacy_src.workspace_costs (
  id uuid, workspace_id uuid, cost_type text, name text,
  amount numeric, effective_from date, effective_to date,
  currency text, created_at timestamp,
  is_percent boolean, billing_mode text
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'workspace_costs');

DROP FOREIGN TABLE IF EXISTS legacy_src.workspace_misc_expenses;
CREATE FOREIGN TABLE legacy_src.workspace_misc_expenses (
  id uuid, workspace_id uuid, name text, amount numeric, currency text,
  effective_start_date date, created_at timestamp, updated_at timestamp
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'workspace_misc_expenses');

DROP FOREIGN TABLE IF EXISTS legacy_src.workspace_metric_goals;
CREATE FOREIGN TABLE legacy_src.workspace_metric_goals (
  id uuid, workspace_id uuid, metric_name text, period_type text,
  period_start date, goal_value numeric, goal_type text,
  created_at timestamp, updated_at timestamp
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'workspace_metric_goals');

DROP FOREIGN TABLE IF EXISTS legacy_src.workspace_festivals;
CREATE FOREIGN TABLE legacy_src.workspace_festivals (
  id text, workspace_id uuid, name text, start_date timestamp, end_date timestamp,
  color text, expected_multiplier double precision, regions text[], categories text[],
  is_template boolean, is_active boolean, created_at timestamp, updated_at timestamp
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'workspace_festivals');

DROP FOREIGN TABLE IF EXISTS legacy_src.workspace_ad_campaign_classifications;
CREATE FOREIGN TABLE legacy_src.workspace_ad_campaign_classifications (
  id uuid, workspace_id uuid, platform text, campaign_id text, intent text, campaign_name text,
  created_at timestamp, updated_at timestamp
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'workspace_ad_campaign_classifications');

BEGIN;

-- 1) workspace_cogs_settings — percent×100 → bp. PK is workspace_id.
INSERT INTO workspace_cogs_settings (workspace_id, override_all_cogs_bp, fallback_cogs_bp, cogs_markup_bp, updated_at)
SELECT workspace_id,
  COALESCE((override_all_cogs_percent * 100)::int, 0),
  COALESCE((fallback_cogs_percent * 100)::int, 0),
  COALESCE((cogs_markup_percent * 100)::int, 0),
  updated_at AT TIME ZONE 'UTC'
FROM legacy_src.workspace_cogs_settings
ON CONFLICT (workspace_id) DO UPDATE SET
  override_all_cogs_bp = EXCLUDED.override_all_cogs_bp,
  fallback_cogs_bp     = EXCLUDED.fallback_cogs_bp,
  cogs_markup_bp       = EXCLUDED.cogs_markup_bp,
  updated_at           = EXCLUDED.updated_at;

-- 2) workspace_costs — amount × 100 → mu when !is_percent; when is_percent, amount × 100 → bp.
--    Reuses the legacy "one column, two meanings" pattern.
INSERT INTO workspace_costs (id, workspace_id, cost_type, name, amount_mu, is_percent,
                             currency_code, billing_mode, effective_from, effective_to, created_at)
SELECT id, workspace_id,
  (cost_type)::workspace_cost_type,
  name,
  (amount * 100)::bigint,
  COALESCE(is_percent, FALSE),
  currency,
  (upper(billing_mode))::workspace_cost_billing_mode,
  effective_from, effective_to,
  created_at AT TIME ZONE 'UTC'
FROM legacy_src.workspace_costs
ON CONFLICT (id) DO UPDATE SET
  cost_type=EXCLUDED.cost_type, name=EXCLUDED.name, amount_mu=EXCLUDED.amount_mu,
  is_percent=EXCLUDED.is_percent, currency_code=EXCLUDED.currency_code,
  billing_mode=EXCLUDED.billing_mode, effective_from=EXCLUDED.effective_from,
  effective_to=EXCLUDED.effective_to;

-- 3) workspace_misc_expenses — amount × subunit(currency) → mu.
INSERT INTO workspace_misc_expenses (id, workspace_id, name, amount_mu, currency_code,
                                     effective_start_date, created_at, updated_at)
SELECT id, workspace_id, name,
  (amount * (CASE WHEN upper(currency) IN ('KWD','BHD') THEN 1000
                  WHEN upper(currency) = 'JPY' THEN 1 ELSE 100 END))::bigint,
  COALESCE(currency, 'INR'),
  effective_start_date,
  created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
FROM legacy_src.workspace_misc_expenses
ON CONFLICT (workspace_id, name, effective_start_date) DO UPDATE SET
  amount_mu=EXCLUDED.amount_mu, currency_code=EXCLUDED.currency_code,
  updated_at=EXCLUDED.updated_at;

-- 4) workspace_metric_goals — goal_value × 10000 → bigint, default unit 'bp' for ratios
--    (the legacy schema doesn't carry a unit discriminator; refine per-metric later).
INSERT INTO workspace_metric_goals (id, workspace_id, metric_name, period_type, period_start,
                                    goal_value, goal_unit, goal_type, created_at, updated_at)
SELECT id, workspace_id, metric_name,
  (period_type)::goal_period_type,
  period_start,
  (goal_value * 10000)::bigint,
  'bp'::goal_unit,
  (goal_type)::goal_value_type,
  created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
FROM legacy_src.workspace_metric_goals
ON CONFLICT (workspace_id, metric_name, period_type, period_start) DO UPDATE SET
  goal_value=EXCLUDED.goal_value, goal_unit=EXCLUDED.goal_unit,
  goal_type=EXCLUDED.goal_type, updated_at=EXCLUDED.updated_at;

-- 5) workspace_festivals — multiplier × 10000 → bp; legacy id text (UUID-shaped) → uuid.
INSERT INTO workspace_festivals (id, workspace_id, name, start_date, end_date, color,
                                 expected_multiplier_bp, regions, categories,
                                 is_template, is_active, created_at, updated_at)
SELECT id::uuid, workspace_id, name,
  start_date::date, end_date::date,
  COALESCE(color, '#F59E0B'),
  (expected_multiplier * 10000)::int,
  COALESCE(regions, '{}'::text[]),
  COALESCE(categories, '{}'::text[]),
  COALESCE(is_template, FALSE),
  COALESCE(is_active, TRUE),
  created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
FROM legacy_src.workspace_festivals
ON CONFLICT (workspace_id, name, start_date) DO UPDATE SET
  end_date=EXCLUDED.end_date, color=EXCLUDED.color,
  expected_multiplier_bp=EXCLUDED.expected_multiplier_bp,
  regions=EXCLUDED.regions, categories=EXCLUDED.categories,
  is_template=EXCLUDED.is_template, is_active=EXCLUDED.is_active,
  updated_at=EXCLUDED.updated_at;

-- 6) workspace_ad_campaign_classifications — passthrough.
INSERT INTO workspace_ad_campaign_classifications (id, workspace_id, platform, campaign_id,
                                                    intent, campaign_name, created_at, updated_at)
SELECT id, workspace_id, platform, campaign_id, intent, campaign_name,
  created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
FROM legacy_src.workspace_ad_campaign_classifications
ON CONFLICT (workspace_id, platform, campaign_id) DO UPDATE SET
  intent=EXCLUDED.intent, campaign_name=EXCLUDED.campaign_name, updated_at=EXCLUDED.updated_at;

COMMIT;

-- Verification
SELECT 'workspace_cogs_settings='||count(*)::text FROM workspace_cogs_settings;
SELECT 'workspace_costs='||count(*)::text FROM workspace_costs;
SELECT 'workspace_misc_expenses='||count(*)::text FROM workspace_misc_expenses;
SELECT 'workspace_metric_goals='||count(*)::text FROM workspace_metric_goals;
SELECT 'workspace_festivals='||count(*)::text FROM workspace_festivals;
SELECT 'workspace_ad_campaign_classifications='||count(*)::text FROM workspace_ad_campaign_classifications;

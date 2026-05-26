-- =============================================================================
-- Phase 1 — D10..D15 workspace config (cogs settings, costs, misc expenses,
-- metric goals, festivals, ad-campaign classifications).
-- Design: docs/data-architecture-plan.md §3.9.
-- =============================================================================

-- Enums used below (idempotent).
DO $$ BEGIN
  CREATE TYPE workspace_cost_type AS ENUM ('SHIPPING','PACKAGING','WEBSITE','CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE workspace_cost_billing_mode AS ENUM ('MONTHLY','PER_ORDER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE goal_period_type AS ENUM ('DAILY','WEEKLY','MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE goal_value_type AS ENUM ('MINIMUM','MAXIMUM','TARGET');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE goal_unit AS ENUM ('mu','bp','count');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- D10 — cogs settings (one row per workspace; default 0)
CREATE TABLE IF NOT EXISTS workspace_cogs_settings (
  workspace_id          UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  override_all_cogs_bp  INT NOT NULL DEFAULT 0,    -- 0..10000 (0..100%)
  fallback_cogs_bp      INT NOT NULL DEFAULT 0,
  cogs_markup_bp        INT NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_cogs_settings TO rls_app;

-- D11 — workspace costs (effective-dated; amount_mu IS bp when is_percent=true)
CREATE TABLE IF NOT EXISTS workspace_costs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cost_type       workspace_cost_type NOT NULL,
  name            TEXT,
  amount_mu       BIGINT NOT NULL,
  is_percent      BOOLEAN NOT NULL DEFAULT FALSE,
  currency_code   TEXT,
  billing_mode    workspace_cost_billing_mode NOT NULL DEFAULT 'MONTHLY',
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_costs_ws_idx
  ON workspace_costs (workspace_id, cost_type, effective_from, effective_to);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_costs TO rls_app;

-- D12 — misc expenses (named, currency-aware)
CREATE TABLE IF NOT EXISTS workspace_misc_expenses (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  amount_mu            BIGINT NOT NULL,
  currency_code        TEXT NOT NULL DEFAULT 'INR',
  effective_start_date DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name, effective_start_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_misc_expenses TO rls_app;

-- D13 — metric goals (Brain stores no Decimal; goal_value interpreted by goal_unit)
CREATE TABLE IF NOT EXISTS workspace_metric_goals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric_name  TEXT NOT NULL,
  period_type  goal_period_type NOT NULL,
  period_start DATE NOT NULL,
  goal_value   BIGINT NOT NULL,
  goal_unit    goal_unit NOT NULL,
  goal_type    goal_value_type NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, metric_name, period_type, period_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_metric_goals TO rls_app;

-- D14 — festivals (India calendar templates + workspace overrides; 1.5x = 15000 bp)
CREATE TABLE IF NOT EXISTS workspace_festivals (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  start_date             DATE NOT NULL,
  end_date               DATE NOT NULL,
  color                  TEXT NOT NULL DEFAULT '#F59E0B',
  expected_multiplier_bp INT NOT NULL DEFAULT 15000,
  regions                TEXT[] NOT NULL DEFAULT '{}',
  categories             TEXT[] NOT NULL DEFAULT '{}',
  is_template            BOOLEAN NOT NULL DEFAULT FALSE,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name, start_date)
);
CREATE INDEX IF NOT EXISTS workspace_festivals_ws_date_idx
  ON workspace_festivals (workspace_id, start_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_festivals TO rls_app;

-- D15 — ad-campaign classification (acquisition vs retargeting vs brand)
CREATE TABLE IF NOT EXISTS workspace_ad_campaign_classifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,                   -- 'meta' | 'google'
  campaign_id   TEXT NOT NULL,
  intent        TEXT NOT NULL,                   -- 'acquisition' | 'retargeting' | 'brand'
  campaign_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, campaign_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_ad_campaign_classifications TO rls_app;

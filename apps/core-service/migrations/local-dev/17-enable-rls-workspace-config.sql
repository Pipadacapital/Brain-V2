-- =============================================================================
-- Phase 1 — RLS for D10..D15 workspace-config tables. All ws_isolation, fail-closed.
-- =============================================================================
ALTER TABLE workspace_cogs_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_cogs_settings;
CREATE POLICY ws_isolation ON workspace_cogs_settings
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_cogs_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE workspace_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_costs;
CREATE POLICY ws_isolation ON workspace_costs
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_costs FORCE ROW LEVEL SECURITY;

ALTER TABLE workspace_misc_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_misc_expenses;
CREATE POLICY ws_isolation ON workspace_misc_expenses
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_misc_expenses FORCE ROW LEVEL SECURITY;

ALTER TABLE workspace_metric_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_metric_goals;
CREATE POLICY ws_isolation ON workspace_metric_goals
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_metric_goals FORCE ROW LEVEL SECURITY;

ALTER TABLE workspace_festivals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_festivals;
CREATE POLICY ws_isolation ON workspace_festivals
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_festivals FORCE ROW LEVEL SECURITY;

ALTER TABLE workspace_ad_campaign_classifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_ad_campaign_classifications;
CREATE POLICY ws_isolation ON workspace_ad_campaign_classifications
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_ad_campaign_classifications FORCE ROW LEVEL SECURITY;

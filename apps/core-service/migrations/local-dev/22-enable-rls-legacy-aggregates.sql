-- =============================================================================
-- Phase 1 — RLS for the 3 legacy_aggregates.* tables. ws_isolation, fail-closed.
-- =============================================================================
ALTER TABLE legacy_aggregates.workspace_daily_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON legacy_aggregates.workspace_daily_metrics;
CREATE POLICY ws_isolation ON legacy_aggregates.workspace_daily_metrics
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE legacy_aggregates.workspace_daily_metrics FORCE ROW LEVEL SECURITY;

ALTER TABLE legacy_aggregates.shopify_analytics_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON legacy_aggregates.shopify_analytics_daily;
CREATE POLICY ws_isolation ON legacy_aggregates.shopify_analytics_daily
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE legacy_aggregates.shopify_analytics_daily FORCE ROW LEVEL SECURITY;

ALTER TABLE legacy_aggregates.product_daily_aggregates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON legacy_aggregates.product_daily_aggregates;
CREATE POLICY ws_isolation ON legacy_aggregates.product_daily_aggregates
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE legacy_aggregates.product_daily_aggregates FORCE ROW LEVEL SECURITY;

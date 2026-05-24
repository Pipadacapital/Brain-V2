-- =============================================================================
-- STEP A ONLY: ENABLE RLS + CREATE fail-closed ws_isolation POLICY
--
-- Runbook: STEP 3 — run AFTER quiesce-crons (STEP 1) and context-code verify
-- (STEP 2). Run BEFORE CF-SEC-1 probe (STEP 4).
--
-- FORCE is in step-b-force.sql — NEVER run this file and step-b-force.sql
-- without following rollout-runbook.sh exactly.
--
-- CF-BN-DDL-GATING-1: this file is NOT auto-applied by any migration runner.
-- CF-C1-RLS-DEFAULT-1.a: all policies use ONLY approved fail-closed shapes.
-- CF-C1-AUDITLOG-1.a: audit_logs + notifications get dual-policy.
--
-- BANNED shapes (static grep gate in Track T tests):
--   OR ... IS NULL
--   COALESCE
--   USING (true)
--   SET [session-level]
--
-- After ENABLE (before FORCE): the table owner (service role) BYPASSES RLS.
-- This is the safe intermediate state — RLS is on but not enforced for the
-- privileged role. FORCE is the structural moment (step-b-force.sql, HELD).
--
-- QUIESCE-CRONS is REQUIRED at ENABLE time (CF-C1-ROLLOUT-ORDER-1 sharpened):
-- even ENABLE-without-FORCE gates `authenticated`-role reads → partial outage
-- for non-service-role connections.
-- =============================================================================

-- =============================================================================
-- Group A — 22 tables with direct workspace_id column
-- Policy shape: USING/WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid)
-- =============================================================================

ALTER TABLE marketing_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON marketing_actions
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE workspace_festivals ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON workspace_festivals
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE workspace_metric_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON workspace_metric_goals
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE workspace_ad_campaign_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON workspace_ad_campaign_classifications
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON ai_insights
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE workspace_ai_insights_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON workspace_ai_insights_cache
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE workspace_cogs_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON workspace_cogs_settings
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON workspace_members
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON invitations
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE workspace_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON workspace_costs
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE workspace_misc_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON workspace_misc_expenses
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE shopify_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_connections
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE product_lead_times ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON product_lead_times
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE shiprocket_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shiprocket_connections
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE unicommerce_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON unicommerce_connections
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE klaviyo_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON klaviyo_connections
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE email_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON email_performance
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON oauth_states
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE workspace_daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON workspace_daily_metrics
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE woocommerce_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON woocommerce_connections
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE google_ads_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON google_ads_connections
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE meta_ads_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON meta_ads_connections
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- =============================================================================
-- Group B — 17 tables with connId-FK 1-hop through a connection table
-- Policy shape: connection_id IN (SELECT id FROM <conn_table> WHERE workspace_id = current_setting(...)::uuid)
-- =============================================================================

ALTER TABLE product_daily_aggregates ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON product_daily_aggregates
  USING (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE shopify_analytics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_analytics_daily
  USING (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE shopify_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_orders
  USING (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE shopify_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_line_items
  USING (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE shopify_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_products
  USING (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE shopify_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_variants
  USING (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE shopify_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_customers
  USING (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE unicommerce_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON unicommerce_products
  USING (connection_id IN (SELECT id FROM unicommerce_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM unicommerce_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE shiprocket_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shiprocket_orders
  USING (connection_id IN (SELECT id FROM shiprocket_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shiprocket_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE shiprocket_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shiprocket_shipments
  USING (connection_id IN (SELECT id FROM shiprocket_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shiprocket_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE google_ads_funnel_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON google_ads_funnel_daily
  USING (connection_id IN (SELECT id FROM google_ads_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM google_ads_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE google_ads_daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON google_ads_daily_metrics
  USING (connection_id IN (SELECT id FROM google_ads_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM google_ads_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE meta_ads_creative_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON meta_ads_creative_daily
  USING (connection_id IN (SELECT id FROM meta_ads_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM meta_ads_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE meta_ads_daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON meta_ads_daily_metrics
  USING (connection_id IN (SELECT id FROM meta_ads_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM meta_ads_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE woocommerce_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON woocommerce_orders
  USING (connection_id IN (SELECT id FROM woocommerce_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM woocommerce_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE woocommerce_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON woocommerce_products
  USING (connection_id IN (SELECT id FROM woocommerce_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM woocommerce_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

ALTER TABLE shopify_refund_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_refund_line_items
  USING (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));

-- =============================================================================
-- Group C — 1 table with orderId-FK 2-hop
-- woocommerce_line_items → woocommerce_orders → woocommerce_connections
-- =============================================================================

ALTER TABLE woocommerce_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON woocommerce_line_items
  USING (order_id IN (
    SELECT id FROM woocommerce_orders
    WHERE connection_id IN (
      SELECT id FROM woocommerce_connections
      WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  ))
  WITH CHECK (order_id IN (
    SELECT id FROM woocommerce_orders
    WHERE connection_id IN (
      SELECT id FROM woocommerce_connections
      WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  ));

-- =============================================================================
-- Dual-policy tables (CF-C1-AUDITLOG-1.a)
-- audit_logs + notifications: nullable workspace_id
--   ws_isolation: workspace-scoped reads/writes
--   superadmin_system_rows: system/null-workspace rows (SUPERADMIN only)
-- system_settings: SUPERADMIN-only (no workspace_id column)
-- =============================================================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON audit_logs
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY superadmin_system_rows ON audit_logs
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON notifications
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY superadmin_system_rows ON notifications
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY superadmin_only ON system_settings
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');

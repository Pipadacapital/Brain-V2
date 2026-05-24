-- =============================================================================
-- Migration: feat-tenancy-auth-rls-hardening (Child 1, Track 1a-C)
-- Paradigm: sql-ddl-and-connection-handling
--
-- PURPOSE: Apply fail-closed Row Level Security on all workspace-scoped tables.
-- This file is the FORWARD migration (STEP 3 of the rollout runbook).
-- FORCE RLS (STEP 5) is in a separate statement block below.
--
-- CRITICAL: This DDL is applied AT STAGE-8 DEPLOY by Jatin, NOT at build time.
-- NEVER run this against the live DB without completing the runbook pre-steps:
--   STEP 0 region-assert, STEP 1 quiesce-crons, STEP 2 deploy context code.
-- See: rollout-runbook.sh (Track 1a-F).
--
-- CF-C1-RLS-DEFAULT-1.a: every USING / WITH CHECK uses EXACTLY:
--   workspace_id  = current_setting('app.workspace_id', true)::uuid  (Group A)
--   connection_id IN (SELECT id FROM <parent> WHERE workspace_id = ...)   (Group B)
-- BANNED patterns (static gate):
--   OR current_setting(...) IS NULL
--   COALESCE(current_setting(...),'...')
--   USING (true)
-- =============================================================================

-- =============================================================================
-- STEP A: ENABLE RLS + CREATE POLICY on all workspace-scoped tables
-- (owner still bypasses; FORCE is STEP B below)
-- =============================================================================

-- -----------------------------------------------------------------------
-- Group A — DIRECT workspace_id column tables (21 tables)
-- -----------------------------------------------------------------------

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

-- google_ads_connections and meta_ads_connections use workspace_id (column name = workspace_id)
ALTER TABLE google_ads_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON google_ads_connections
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE meta_ads_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON meta_ads_connections
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- -----------------------------------------------------------------------
-- Group B — FK-transitive via connectionId → connection-table.workspace_id
-- JOIN-policy is the DEFAULT (per CF-C1-FK-SCOPE-1.a, changed to direct
-- workspace_id column only if live EXPLAIN gate fails — see rollout runbook).
-- -----------------------------------------------------------------------

-- ProductDailyAggregate → shopify_connections
ALTER TABLE product_daily_aggregates ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON product_daily_aggregates
  USING (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- ShopifyAnalyticsDaily → shopify_connections
ALTER TABLE shopify_analytics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_analytics_daily
  USING (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- ShopifyOrder → shopify_connections (hot table — EXPLAIN gate pre-step required)
ALTER TABLE shopify_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_orders
  USING (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));
-- NOTE: If the live EXPLAIN gate (CF-C1-FK-SCOPE-1.a) shows seqscan on
-- shopify_orders, replace above with direct workspace_id column policy
-- after running the chunked backfill (§3c). See rollout runbook EXPLAIN-GATE section.

-- ShopifyLineItem has BOTH connection_id AND order_id — use connection_id (1-hop)
ALTER TABLE shopify_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_line_items
  USING (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- ShopifyProduct → shopify_connections
ALTER TABLE shopify_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_products
  USING (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- ShopifyVariant → shopify_connections
ALTER TABLE shopify_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_variants
  USING (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- ShopifyCustomer → shopify_connections (PII: email/firstName/lastName — DPDP §4 scope)
ALTER TABLE shopify_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_customers
  USING (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- UnicommerceProduct → unicommerce_connections
ALTER TABLE unicommerce_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON unicommerce_products
  USING (connection_id IN (
    SELECT id FROM unicommerce_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM unicommerce_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- ShiprocketOrder → shiprocket_connections
ALTER TABLE shiprocket_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shiprocket_orders
  USING (connection_id IN (
    SELECT id FROM shiprocket_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM shiprocket_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- ShiprocketShipment → shiprocket_connections (PII: deliveryPincode/City/State)
ALTER TABLE shiprocket_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shiprocket_shipments
  USING (connection_id IN (
    SELECT id FROM shiprocket_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM shiprocket_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- google_ads_funnel_daily → google_ads_connections
ALTER TABLE google_ads_funnel_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON google_ads_funnel_daily
  USING (connection_id IN (
    SELECT id FROM google_ads_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM google_ads_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- google_ads_daily_metrics → google_ads_connections
ALTER TABLE google_ads_daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON google_ads_daily_metrics
  USING (connection_id IN (
    SELECT id FROM google_ads_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM google_ads_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- meta_ads_creative_daily → meta_ads_connections
ALTER TABLE meta_ads_creative_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON meta_ads_creative_daily
  USING (connection_id IN (
    SELECT id FROM meta_ads_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM meta_ads_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- meta_ads_daily_metrics → meta_ads_connections
ALTER TABLE meta_ads_daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON meta_ads_daily_metrics
  USING (connection_id IN (
    SELECT id FROM meta_ads_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM meta_ads_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- WoocommerceOrder → woocommerce_connections (PII: customerEmail/Phone)
ALTER TABLE woocommerce_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON woocommerce_orders
  USING (connection_id IN (
    SELECT id FROM woocommerce_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM woocommerce_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- WoocommerceProduct → woocommerce_connections
ALTER TABLE woocommerce_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON woocommerce_products
  USING (connection_id IN (
    SELECT id FROM woocommerce_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM woocommerce_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- shopify_refund_line_items has connection_id directly → shopify_connections
ALTER TABLE shopify_refund_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON shopify_refund_line_items
  USING (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
  ));

-- -----------------------------------------------------------------------
-- Group C — FK-transitive via order_id → woocommerce_orders (2-hop)
-- -----------------------------------------------------------------------

-- WoocommerceLineItem (Group C, 2-hop): order_id → woocommerce_orders → connectionId → workspace_id
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

-- -----------------------------------------------------------------------
-- AuditLog — dual-policy (CF-C1-AUDITLOG-1.a)
-- -----------------------------------------------------------------------

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy 1: workspace-scoped tenant rows
CREATE POLICY ws_isolation ON audit_logs
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- Policy 2: null/system rows — reachable ONLY under SUPERADMIN session context
-- Two policies are OR-combined by Postgres. A tenant session (workspace_id set,
-- is_superadmin unset/false) sees ONLY its own rows. Null rows fail BOTH for
-- tenants → invisible (no leak). SUPERADMIN sees system rows via policy 2.
CREATE POLICY superadmin_system_rows ON audit_logs
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');

-- -----------------------------------------------------------------------
-- SystemSettings — SUPERADMIN-only (Group D, no tenant data)
-- -----------------------------------------------------------------------

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY superadmin_only ON system_settings
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');

-- -----------------------------------------------------------------------
-- Notifications — workspace-scoped (nullable workspace_id, user-scoped)
-- Strategy: scoped by workspace_id when set, OR userId match for system
-- notifications (where workspace_id IS NULL and is_superadmin is set)
-- -----------------------------------------------------------------------

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON notifications
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY superadmin_system_rows ON notifications
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');

-- =============================================================================
-- STEP B: FORCE ROW LEVEL SECURITY per table
-- (executed ONLY after CF-SEC-1 probe GREEN — see rollout runbook STEP 5)
-- =============================================================================

-- Group A
ALTER TABLE marketing_actions              FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_festivals            FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_metric_goals         FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_ad_campaign_classifications FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_insights                    FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_ai_insights_cache    FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_cogs_settings        FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_members              FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations                    FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_costs                FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_misc_expenses        FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_connections            FORCE ROW LEVEL SECURITY;
ALTER TABLE product_lead_times             FORCE ROW LEVEL SECURITY;
ALTER TABLE shiprocket_connections         FORCE ROW LEVEL SECURITY;
ALTER TABLE unicommerce_connections        FORCE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_connections            FORCE ROW LEVEL SECURITY;
ALTER TABLE email_performance              FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_states                   FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_daily_metrics        FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_connections        FORCE ROW LEVEL SECURITY;
ALTER TABLE google_ads_connections         FORCE ROW LEVEL SECURITY;
ALTER TABLE meta_ads_connections           FORCE ROW LEVEL SECURITY;

-- Group B
ALTER TABLE product_daily_aggregates       FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_analytics_daily        FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_orders                 FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_line_items             FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_products               FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_variants               FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_customers              FORCE ROW LEVEL SECURITY;
ALTER TABLE unicommerce_products           FORCE ROW LEVEL SECURITY;
ALTER TABLE shiprocket_orders              FORCE ROW LEVEL SECURITY;
ALTER TABLE shiprocket_shipments           FORCE ROW LEVEL SECURITY;
ALTER TABLE google_ads_funnel_daily        FORCE ROW LEVEL SECURITY;
ALTER TABLE google_ads_daily_metrics       FORCE ROW LEVEL SECURITY;
ALTER TABLE meta_ads_creative_daily        FORCE ROW LEVEL SECURITY;
ALTER TABLE meta_ads_daily_metrics         FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_orders             FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_products           FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_refund_line_items      FORCE ROW LEVEL SECURITY;

-- Group C
ALTER TABLE woocommerce_line_items         FORCE ROW LEVEL SECURITY;

-- AuditLog + Notifications + SystemSettings
ALTER TABLE audit_logs                     FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications                  FORCE ROW LEVEL SECURITY;
ALTER TABLE system_settings                FORCE ROW LEVEL SECURITY;

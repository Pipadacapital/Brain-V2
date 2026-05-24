-- =============================================================================
-- ROLLBACK: feat-tenancy-auth-rls-hardening (Child 1, Track 1a-C)
-- Paradigm: sql-ddl-and-connection-handling
--
-- Reverses the forward migration (up.sql): removes FORCE, DISABLES RLS,
-- and DROPs all ws_isolation / superadmin_* policies.
-- App-layer workspaceId filtering remains — no isolation regression below
-- the pre-RLS baseline.
--
-- CF-C1-ROLLOUT-ORDER-1 (corrects A4): rollback is a DDL migration, NOT
-- a feature-flag flip.
-- =============================================================================

-- -----------------------------------------------------------------------
-- Remove FORCE, DISABLE RLS, DROP policies — Group A
-- -----------------------------------------------------------------------

ALTER TABLE marketing_actions              NO FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_actions              DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON marketing_actions;

ALTER TABLE workspace_festivals            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_festivals            DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_festivals;

ALTER TABLE workspace_metric_goals         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_metric_goals         DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_metric_goals;

ALTER TABLE workspace_ad_campaign_classifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_ad_campaign_classifications DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_ad_campaign_classifications;

ALTER TABLE ai_insights                    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_insights                    DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON ai_insights;

ALTER TABLE workspace_ai_insights_cache    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_ai_insights_cache    DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_ai_insights_cache;

ALTER TABLE workspace_cogs_settings        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_cogs_settings        DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_cogs_settings;

ALTER TABLE workspace_members              NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_members              DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_members;

ALTER TABLE invitations                    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations                    DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON invitations;

ALTER TABLE workspace_costs                NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_costs                DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_costs;

ALTER TABLE workspace_misc_expenses        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_misc_expenses        DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_misc_expenses;

ALTER TABLE shopify_connections            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_connections            DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shopify_connections;

ALTER TABLE product_lead_times             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE product_lead_times             DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON product_lead_times;

ALTER TABLE shiprocket_connections         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shiprocket_connections         DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shiprocket_connections;

ALTER TABLE unicommerce_connections        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE unicommerce_connections        DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON unicommerce_connections;

ALTER TABLE klaviyo_connections            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_connections            DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON klaviyo_connections;

ALTER TABLE email_performance              NO FORCE ROW LEVEL SECURITY;
ALTER TABLE email_performance              DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON email_performance;

ALTER TABLE oauth_states                   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_states                   DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON oauth_states;

ALTER TABLE workspace_daily_metrics        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_daily_metrics        DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_daily_metrics;

ALTER TABLE woocommerce_connections        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_connections        DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON woocommerce_connections;

ALTER TABLE google_ads_connections         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE google_ads_connections         DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON google_ads_connections;

ALTER TABLE meta_ads_connections           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE meta_ads_connections           DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON meta_ads_connections;

-- -----------------------------------------------------------------------
-- Group B
-- -----------------------------------------------------------------------

ALTER TABLE product_daily_aggregates       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE product_daily_aggregates       DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON product_daily_aggregates;

ALTER TABLE shopify_analytics_daily        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_analytics_daily        DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shopify_analytics_daily;

ALTER TABLE shopify_orders                 NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_orders                 DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shopify_orders;

ALTER TABLE shopify_line_items             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_line_items             DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shopify_line_items;

ALTER TABLE shopify_products               NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_products               DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shopify_products;

ALTER TABLE shopify_variants               NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_variants               DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shopify_variants;

ALTER TABLE shopify_customers              NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_customers              DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shopify_customers;

ALTER TABLE unicommerce_products           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE unicommerce_products           DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON unicommerce_products;

ALTER TABLE shiprocket_orders              NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shiprocket_orders              DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shiprocket_orders;

ALTER TABLE shiprocket_shipments           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shiprocket_shipments           DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shiprocket_shipments;

ALTER TABLE google_ads_funnel_daily        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE google_ads_funnel_daily        DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON google_ads_funnel_daily;

ALTER TABLE google_ads_daily_metrics       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE google_ads_daily_metrics       DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON google_ads_daily_metrics;

ALTER TABLE meta_ads_creative_daily        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE meta_ads_creative_daily        DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON meta_ads_creative_daily;

ALTER TABLE meta_ads_daily_metrics         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE meta_ads_daily_metrics         DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON meta_ads_daily_metrics;

ALTER TABLE woocommerce_orders             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_orders             DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON woocommerce_orders;

ALTER TABLE woocommerce_products           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_products           DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON woocommerce_products;

ALTER TABLE shopify_refund_line_items      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_refund_line_items      DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON shopify_refund_line_items;

-- -----------------------------------------------------------------------
-- Group C
-- -----------------------------------------------------------------------

ALTER TABLE woocommerce_line_items         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_line_items         DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON woocommerce_line_items;

-- -----------------------------------------------------------------------
-- AuditLog + Notifications + SystemSettings
-- -----------------------------------------------------------------------

ALTER TABLE audit_logs                     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                     DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON audit_logs;
DROP POLICY IF EXISTS superadmin_system_rows ON audit_logs;

ALTER TABLE notifications                  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications                  DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON notifications;
DROP POLICY IF EXISTS superadmin_system_rows ON notifications;

ALTER TABLE system_settings                NO FORCE ROW LEVEL SECURITY;
ALTER TABLE system_settings                DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS superadmin_only ON system_settings;

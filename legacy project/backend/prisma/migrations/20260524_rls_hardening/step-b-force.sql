-- =============================================================================
-- STEP B ONLY: FORCE ROW LEVEL SECURITY per table
-- Run at rollout STEP 5 — ONLY after CF-SEC-1 probe returns GREEN.
-- This is the moment isolation becomes structural for the privileged role too.
-- =============================================================================

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
ALTER TABLE woocommerce_line_items         FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                     FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications                  FORCE ROW LEVEL SECURITY;
ALTER TABLE system_settings                FORCE ROW LEVEL SECURITY;

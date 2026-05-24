-- =============================================================================
-- STEP B ONLY: FORCE ROW LEVEL SECURITY per table
--
-- Runbook: STEP 5 — HELD
-- DO NOT RUN THIS FILE until ALL HOLD-AT-FORCE pre-conditions are met:
--   1. CF-SEC-1 probe GREEN (Step 4 passed)
--   2. Complete bare-write grep returns ZERO hits
--      (Must NOT grep -v backfill or grep -v discoverChannels — the legacy
--       grep was DEFECTIVE by excluding those paths. R-O7.)
--   3. Child-3 residual no-context writers converted (backfill, discoverChannels,
--      inner sync libs, route-handler connection writes)
--   4. FK-scope live EXPLAIN gate passes per hot table
--   5. Founder/CTO-Advisor sign-off that all four conditions are satisfied
--
-- CF-BN-DDL-GATING-1: this file is NOT auto-applied by any migration runner.
-- CF-BN-SHAPE-A-1: FORCE is deferred to Stage-8 per the HOLD-AT-FORCE state.
--
-- This is the structural moment: FORCE makes RLS apply to the table OWNER role
-- too (i.e. the service role). After this step, any consumer without workspace
-- context gets 0 rows — including legacy sync paths.
-- =============================================================================

ALTER TABLE marketing_actions                     FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_festivals                   FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_metric_goals                FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_ad_campaign_classifications FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_insights                           FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_ai_insights_cache           FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_cogs_settings               FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_members                     FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations                           FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_costs                       FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_misc_expenses               FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_connections                   FORCE ROW LEVEL SECURITY;
ALTER TABLE product_lead_times                    FORCE ROW LEVEL SECURITY;
ALTER TABLE shiprocket_connections                FORCE ROW LEVEL SECURITY;
ALTER TABLE unicommerce_connections               FORCE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_connections                   FORCE ROW LEVEL SECURITY;
ALTER TABLE email_performance                     FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_states                          FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_daily_metrics               FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_connections               FORCE ROW LEVEL SECURITY;
ALTER TABLE google_ads_connections                FORCE ROW LEVEL SECURITY;
ALTER TABLE meta_ads_connections                  FORCE ROW LEVEL SECURITY;
ALTER TABLE product_daily_aggregates              FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_analytics_daily               FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_orders                        FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_line_items                    FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_products                      FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_variants                      FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_customers                     FORCE ROW LEVEL SECURITY;
ALTER TABLE unicommerce_products                  FORCE ROW LEVEL SECURITY;
ALTER TABLE shiprocket_orders                     FORCE ROW LEVEL SECURITY;
ALTER TABLE shiprocket_shipments                  FORCE ROW LEVEL SECURITY;
ALTER TABLE google_ads_funnel_daily               FORCE ROW LEVEL SECURITY;
ALTER TABLE google_ads_daily_metrics              FORCE ROW LEVEL SECURITY;
ALTER TABLE meta_ads_creative_daily               FORCE ROW LEVEL SECURITY;
ALTER TABLE meta_ads_daily_metrics                FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_orders                    FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_products                  FORCE ROW LEVEL SECURITY;
ALTER TABLE shopify_refund_line_items             FORCE ROW LEVEL SECURITY;
ALTER TABLE woocommerce_line_items                FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                            FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications                         FORCE ROW LEVEL SECURITY;
ALTER TABLE system_settings                       FORCE ROW LEVEL SECURITY;

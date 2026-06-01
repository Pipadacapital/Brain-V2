-- =============================================================================
-- A4a — grant svc_core its owned tables (core public OLTP + legacy_aggregates).
--
-- One-writer-per-store: core-service grants ITS tables to svc_core here. ingestion
-- grants raw_* to svc_ingestion in its own migration; intelligence grants ai.*/
-- memory.* to svc_intelligence in its own up.sql. svc_core is therefore RW on
-- core tables and (because it is not granted raw_* / ai.* and has no USAGE on
-- ai/memory) cannot touch another service's store.
--
-- Applied after 01-25 (tables exist) and after initdb 02-create-service-roles.sql
-- (roles exist). RLS unchanged: svc_core is NON-BYPASSRLS, rows stay workspace-scoped.
-- New core public tables MUST be added to this GRANT (conformance C12 fails otherwise).
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, workspaces, workspace_members, invitations,
  connector_connections, connector_credentials, connector_oauth_states,
  connector_order_facts, connector_line_item_facts, connector_product_facts,
  connector_variant_facts, connector_ad_spend_facts, connector_ad_creative_facts,
  connector_ad_funnel_facts, connector_email_send_facts, connector_logistics_order_facts,
  connector_refund_facts, customer_pii, audit_log, notifications, ai_insights,
  marketing_actions, workspace_costs, workspace_misc_expenses, workspace_metric_goals,
  workspace_festivals, workspace_cogs_settings, workspace_ad_campaign_classifications,
  connector_definitions
TO svc_core;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  legacy_aggregates.workspace_daily_metrics,
  legacy_aggregates.shopify_analytics_daily,
  legacy_aggregates.product_daily_aggregates
TO svc_core;

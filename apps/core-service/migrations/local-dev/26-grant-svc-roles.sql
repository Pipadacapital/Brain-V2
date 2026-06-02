-- =============================================================================
-- A4a — grant svc_core its owned tables (core public OLTP + legacy_aggregates).
--
-- One-writer-per-store: core-service grants ITS tables to svc_core here. ingestion
-- grants raw_* to svc_ingestion in its own migration; intelligence grants ai.*/
-- memory.* to svc_intelligence in its own up.sql. svc_core is therefore RW on
-- core tables and (because it is not granted raw_* / ai.* and has no USAGE on
-- ai/memory) cannot touch another service's store.
--
-- Applied after 01-25 and after initdb 02-create-service-roles.sql (roles exist).
-- RLS unchanged: svc_core is NON-BYPASSRLS, rows stay workspace-scoped.
-- New core public tables MUST be added to this GRANT (conformance C12 fails otherwise).
--
-- P1-18 fix: the OLAP tables created in files 10-15/21-22 were DROPPED in file 23
-- (Postgres→ClickHouse pivot). This grant still listed them, so a clean from-scratch
-- replay errored here ("relation connector_variant_facts does not exist"). The live
-- volume only ever worked because it was built incrementally, never replayed clean.
-- Removed the grants on the 5 dropped OLAP facts + the dropped legacy_aggregates
-- schema; only tables that actually survive file 23/24 remain. (connector_order_facts
-- and connector_line_item_facts survive as security_invoker views over their *_hot
-- tables — file 24 — so they still resolve.)
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, workspaces, workspace_members, invitations,
  connector_connections, connector_credentials, connector_oauth_states,
  connector_order_facts, connector_line_item_facts, connector_product_facts,
  connector_ad_spend_facts, connector_refund_facts,
  customer_pii, audit_log, notifications, ai_insights,
  marketing_actions, workspace_costs, workspace_misc_expenses, workspace_metric_goals,
  workspace_festivals, workspace_cogs_settings, workspace_ad_campaign_classifications,
  connector_definitions
TO svc_core;

-- NOTE: connector_variant_facts, connector_ad_creative_facts, connector_ad_funnel_facts,
-- connector_email_send_facts, connector_logistics_order_facts and the legacy_aggregates.*
-- tables were DROPPED in file 23 (they live in ClickHouse now). They are intentionally
-- NOT granted here — svc_core never reads OLAP from Postgres.

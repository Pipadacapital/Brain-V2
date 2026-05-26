-- =============================================================================
-- Phase 4 — rollback OLAP-misplaced PG tables (Postgres → ClickHouse pivot).
-- Plan: docs/data-architecture-plan-v2.md §7. These 6 tables were created in Phase 1
-- DDL (files 10-15, 21-22) when v1 put everything in Postgres. v2 moves OLAP to
-- ClickHouse (apps/analytics-service/migrations/clickhouse/0003-0009.sql), so these
-- PG copies are removed.
--
-- SAFE: all 6 are empty (Phase 1 contract was DDL-only). NO data is lost.
-- The CH versions of these tables exist + are ready (verified Phase 3).
-- =============================================================================

-- 6 public-schema OLAP-misplaced tables
DROP TABLE IF EXISTS connector_variant_facts;
DROP TABLE IF EXISTS connector_email_send_facts;
DROP TABLE IF EXISTS connector_ad_creative_facts;
DROP TABLE IF EXISTS connector_ad_funnel_facts;
DROP TABLE IF EXISTS connector_logistics_order_facts;

-- legacy_aggregates schema (3 tables → CH)
DROP TABLE IF EXISTS legacy_aggregates.workspace_daily_metrics;
DROP TABLE IF EXISTS legacy_aggregates.shopify_analytics_daily;
DROP TABLE IF EXISTS legacy_aggregates.product_daily_aggregates;
DROP SCHEMA IF EXISTS legacy_aggregates CASCADE;

-- ── intentionally KEPT in Postgres (per v2 store-split: legitimately OLTP) ──
--   customer_pii                              (PII dim, RLS-scoped)
--   workspace_cogs_settings / workspace_costs / workspace_misc_expenses /
--     workspace_metric_goals / workspace_festivals /
--     workspace_ad_campaign_classifications   (workspace config)
--   notifications / ai_insights / marketing_actions / audit_log   (app data)
--   workspaces additive columns               (identity / config)
--   connector_order_facts / connector_line_item_facts / connector_product_facts /
--     connector_ad_spend_facts / connector_shipment_facts / connector_refund_facts
--     — these are existing slice-E PG facts; Phase 5 will RENAME to *_hot (90-day
--     hot mirror) once CH parity is verified per function in Phase 6.

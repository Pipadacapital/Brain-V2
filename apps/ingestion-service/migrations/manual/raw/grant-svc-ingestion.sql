-- =============================================================================
-- A4a — grant svc_ingestion its owned tables (raw_* + cursor + identity map).
--
-- One-writer-per-store: ingestion-service grants ITS public tables to
-- svc_ingestion. svc_ingestion has USAGE on `public` but is NOT granted any core
-- table, so it CANNOT read/write customer_pii / connector_credentials / facts —
-- proven by the db-isolation negative-test harness.
--
-- HOLD-AT-CUTOVER: like the rest of migrations/manual/raw/ (CF-BN-DDL-GATING-1),
-- this is applied by the Founder/operator alongside the raw-table creation +
-- the A4b live role cutover, NOT auto-run. svc_ingestion is created by
-- core-service/docker/initdb-dev/02-create-service-roles.sql (local) or the live
-- ceremony.
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON
  raw_shopify_orders, raw_shopify_line_items, raw_shopify_customers,
  raw_shopify_products, raw_woocommerce_orders, raw_meta_ads_daily,
  raw_google_ads_daily, raw_klaviyo_email_performance, raw_shiprocket_shipments,
  raw_unicommerce_products, connector_cursor, connector_identity_map
TO svc_ingestion;

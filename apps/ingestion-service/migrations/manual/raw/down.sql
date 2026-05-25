-- =============================================================================
-- RAW EVENT STORE — SYMMETRIC ROLLBACK
--
-- Reverses step-a-enable-create.sql + step-b-force.sql:
--   NO FORCE ROW LEVEL SECURITY → DISABLE ROW LEVEL SECURITY
--   → DROP POLICY → DROP TABLE (CASCADE for indexes)
--
-- Usage: psql "$DIRECT_URL" --file down.sql
-- Idempotent (IF EXISTS on every DROP).
--
-- CF-C1-ROLLOUT-ORDER-1 (carried): rollback is a DDL operation, NOT a
-- feature-flag flip. After rollback, the legacy connector paths remain
-- authoritative — no isolation regression below the pre-cutover baseline.
--
-- HOLD-AT-CUTOVER: if no live token has moved (normal Stage-3 state),
-- rolling back these DDL statements is the ONLY rollback needed — no data
-- to restore, no credential to recover.
-- =============================================================================

-- connector_cursor
ALTER TABLE IF EXISTS connector_cursor       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS connector_cursor       DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_cursor;
DROP TABLE IF EXISTS connector_cursor CASCADE;

-- raw_shopify_orders
ALTER TABLE IF EXISTS raw_shopify_orders     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_shopify_orders     DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON raw_shopify_orders;
DROP TABLE IF EXISTS raw_shopify_orders CASCADE;

-- raw_shopify_line_items
ALTER TABLE IF EXISTS raw_shopify_line_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_shopify_line_items DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON raw_shopify_line_items;
DROP TABLE IF EXISTS raw_shopify_line_items CASCADE;

-- raw_shopify_customers
ALTER TABLE IF EXISTS raw_shopify_customers  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_shopify_customers  DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON raw_shopify_customers;
DROP TABLE IF EXISTS raw_shopify_customers CASCADE;

-- raw_shopify_products
ALTER TABLE IF EXISTS raw_shopify_products   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_shopify_products   DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON raw_shopify_products;
DROP TABLE IF EXISTS raw_shopify_products CASCADE;

-- raw_woocommerce_orders
ALTER TABLE IF EXISTS raw_woocommerce_orders NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_woocommerce_orders DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON raw_woocommerce_orders;
DROP TABLE IF EXISTS raw_woocommerce_orders CASCADE;

-- raw_meta_ads_daily
ALTER TABLE IF EXISTS raw_meta_ads_daily     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_meta_ads_daily     DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON raw_meta_ads_daily;
DROP TABLE IF EXISTS raw_meta_ads_daily CASCADE;

-- raw_google_ads_daily
ALTER TABLE IF EXISTS raw_google_ads_daily   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_google_ads_daily   DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON raw_google_ads_daily;
DROP TABLE IF EXISTS raw_google_ads_daily CASCADE;

-- raw_klaviyo_email_performance
ALTER TABLE IF EXISTS raw_klaviyo_email_performance NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_klaviyo_email_performance DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON raw_klaviyo_email_performance;
DROP TABLE IF EXISTS raw_klaviyo_email_performance CASCADE;

-- raw_shiprocket_shipments
ALTER TABLE IF EXISTS raw_shiprocket_shipments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_shiprocket_shipments DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON raw_shiprocket_shipments;
DROP TABLE IF EXISTS raw_shiprocket_shipments CASCADE;

-- raw_unicommerce_products
ALTER TABLE IF EXISTS raw_unicommerce_products NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_unicommerce_products DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON raw_unicommerce_products;
DROP TABLE IF EXISTS raw_unicommerce_products CASCADE;

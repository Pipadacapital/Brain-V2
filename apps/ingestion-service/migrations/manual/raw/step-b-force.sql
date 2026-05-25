-- =============================================================================
-- RAW EVENT STORE — STEP B: FORCE ROW LEVEL SECURITY
--
-- Runbook: STEP 5 — HELD
-- DO NOT RUN THIS FILE until ALL HOLD-AT-CUTOVER pre-conditions are met:
--   1. Startup gates GREEN (residency both URLs + workspace allowlist: STEP 0)
--   2. Real-pooler integration test GREEN (STEP 0.5 — Option A gap-closer)
--   3. Live HTTP vendor auth test GREEN (STEP 2)
--   4. Count-based parity + field-spot-check confirmed within rollback window N (STEP 5)
--   5. Founder/CTO-Advisor sign-off on all four conditions
--
-- CF-BN-DDL-GATING-1: this file is NOT auto-applied by any migration runner.
-- CF-C3-RLS-CONSUME-1: FORCE makes RLS apply to the table owner role too.
--   After FORCE, any session without a bound workspace_id GUC gets 0 rows.
--
-- After FORCE: the named HOLD-AT-CUTOVER state transitions to the live ingest
-- path — this is the structural moment, mirrors Child-1's step-b-force.sql.
-- =============================================================================

ALTER TABLE connector_cursor                  FORCE ROW LEVEL SECURITY;
ALTER TABLE raw_shopify_orders                FORCE ROW LEVEL SECURITY;
ALTER TABLE raw_shopify_line_items            FORCE ROW LEVEL SECURITY;
ALTER TABLE raw_shopify_customers             FORCE ROW LEVEL SECURITY;
ALTER TABLE raw_shopify_products              FORCE ROW LEVEL SECURITY;
ALTER TABLE raw_woocommerce_orders            FORCE ROW LEVEL SECURITY;
ALTER TABLE raw_meta_ads_daily                FORCE ROW LEVEL SECURITY;
ALTER TABLE raw_google_ads_daily              FORCE ROW LEVEL SECURITY;
ALTER TABLE raw_klaviyo_email_performance     FORCE ROW LEVEL SECURITY;
ALTER TABLE raw_shiprocket_shipments          FORCE ROW LEVEL SECURITY;
ALTER TABLE raw_unicommerce_products          FORCE ROW LEVEL SECURITY;

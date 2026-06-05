-- =============================================================================
-- RAW EVENT STORE — STEP A: CREATE TABLES + ENABLE RLS + CREATE POLICIES
--
-- HOLD-AT-CUTOVER: NOT applied by any migration runner.
-- Applied ONLY at Stage-8 ceremony (STEP 3 of the per-connector runbook),
-- AFTER startup gates are GREEN (residency + workspace allowlist) and AFTER
-- the mandatory STEP 0.5 real-pooler integration test passes.
--
-- CF-BN-DDL-GATING-1 : not auto-applied.
-- CF-C3-CONSENT-COLUMN-1 : every PII-bearing table carries NON-NULLABLE
--   workspace_id / lawful_basis / purpose_code / ingested_at from day one,
--   stamped at ingest-write, NEVER backfilled.
-- CF-C3-RLS-CONSUME-1  : every raw table gets Child-1 ws_isolation shape.
--
-- BANNED policy shapes (mirrors Child-1 static grep gate):
--   OR ... IS NULL
--   COALESCE
--   USING (true)
--   SET [session-level]
--
-- lawful_basis enum (enforced by CHECK):
--   'owner_brand_controller' | 'data_principal_consent' | 'legitimate_interest'
--
-- purpose_code enum (enforced by CHECK):
--   'analytics_performance' | 'logistics_tracking'
--   'email_performance'     | 'catalog_sync'
--
-- money stays as-is (raw text / numeric) — NO conversion here.
-- Money conversion is Child-2 / Child-4 at the ACL.
--
-- Idempotency key per table: UNIQUE (workspace_id, vendor_event_id)
-- Cursor query index: (workspace_id, ingested_at)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- connector_cursor
-- Cursor persistence table consumed by P2 ingest_batch.
-- Not PII-bearing; does carry workspace_id for RLS scoping.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS connector_cursor (
    id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     UUID        NOT NULL,
    vendor           TEXT        NOT NULL,
    cursor_value     TEXT        NOT NULL,
    window_start     TIMESTAMPTZ NOT NULL,
    window_end       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, vendor)
);

ALTER TABLE connector_cursor ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON connector_cursor
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS connector_cursor_ws_vendor_idx
  ON connector_cursor (workspace_id, vendor);

-- ---------------------------------------------------------------------------
-- shopify_orders  (PII-bearing: email)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_shopify_orders (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    -- tenant scope + consent columns (CF-C3-CONSENT-COLUMN-1)
    workspace_id         UUID        NOT NULL,
    lawful_basis         TEXT        NOT NULL
        CHECK (lawful_basis IN ('owner_brand_controller','data_principal_consent','legitimate_interest')),
    purpose_code         TEXT        NOT NULL
        CHECK (purpose_code IN ('analytics_performance','logistics_tracking','email_performance','catalog_sync')),
    ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- idempotency
    vendor_event_id      TEXT        NOT NULL,
    UNIQUE (workspace_id, vendor_event_id),
    -- raw vendor payload (no money conversion)
    vendor               TEXT        NOT NULL DEFAULT 'shopify',
    event_type           TEXT        NOT NULL,
    occurred_at          TIMESTAMPTZ NOT NULL,
    -- Order identity + status
    shopify_order_id     TEXT        NOT NULL,
    order_number         TEXT,
    financial_status     TEXT,
    fulfillment_status   TEXT,
    -- PII fields — DPDP §2(t) personal data; all declared in SHOPIFY_PII_MANIFEST
    -- (lawful_basis owner_brand_controller, purpose analytics_performance). The
    -- table-level lawful_basis/purpose_code/ingested_at consent columns cover them.
    -- NOTE (S2.4): order webhooks carry the buyer name; first_name/last_name added
    -- to match ShopifyAdapter.normalize. FLAG FOR SECURITY REVIEW (Shreya) before
    -- the live Stage-8 apply — confirm minimisation vs the manifest is acceptable.
    email                TEXT,
    first_name           TEXT,
    last_name            TEXT,
    -- Money — lands RAW as Shopify decimal strings; NO conversion (ACL converts).
    total_price          TEXT,
    subtotal_price       TEXT,
    total_discounts      TEXT,
    total_tax            TEXT,
    total_price_raw      TEXT,           -- legacy alias (kept; nullable)
    currency             TEXT,
    -- Vendor timestamps — land raw (ISO strings), NO conversion.
    created_at           TEXT,
    updated_at           TEXT,
    closed_at            TEXT,
    cancelled_at         TEXT,
    tags                 TEXT,
    raw_payload          JSONB       NOT NULL  -- full vendor JSON archived
);

ALTER TABLE raw_shopify_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_shopify_orders
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS raw_shopify_orders_ws_ingested_idx
  ON raw_shopify_orders (workspace_id, ingested_at);

-- ---------------------------------------------------------------------------
-- shopify_line_items  (not directly PII-bearing; scoped via order)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_shopify_line_items (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    lawful_basis         TEXT        NOT NULL
        CHECK (lawful_basis IN ('owner_brand_controller','data_principal_consent','legitimate_interest')),
    purpose_code         TEXT        NOT NULL
        CHECK (purpose_code IN ('analytics_performance','logistics_tracking','email_performance','catalog_sync')),
    ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor_event_id      TEXT        NOT NULL,
    UNIQUE (workspace_id, vendor_event_id),
    vendor               TEXT        NOT NULL DEFAULT 'shopify',
    event_type           TEXT        NOT NULL DEFAULT 'line_item',
    occurred_at          TIMESTAMPTZ NOT NULL,
    shopify_order_id     TEXT        NOT NULL,
    line_item_id         TEXT        NOT NULL,
    product_id           TEXT,
    variant_id           TEXT,
    sku                  TEXT,
    title                TEXT,
    quantity             INTEGER,
    price_raw            TEXT,           -- raw; no conversion
    raw_payload          JSONB       NOT NULL
);

ALTER TABLE raw_shopify_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_shopify_line_items
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS raw_shopify_line_items_ws_ingested_idx
  ON raw_shopify_line_items (workspace_id, ingested_at);

-- ---------------------------------------------------------------------------
-- shopify_customers  (PII-bearing: email, first_name, last_name)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_shopify_customers (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    lawful_basis         TEXT        NOT NULL
        CHECK (lawful_basis IN ('owner_brand_controller','data_principal_consent','legitimate_interest')),
    purpose_code         TEXT        NOT NULL
        CHECK (purpose_code IN ('analytics_performance','logistics_tracking','email_performance','catalog_sync')),
    ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor_event_id      TEXT        NOT NULL,
    UNIQUE (workspace_id, vendor_event_id),
    vendor               TEXT        NOT NULL DEFAULT 'shopify',
    event_type           TEXT        NOT NULL DEFAULT 'customer',
    occurred_at          TIMESTAMPTZ NOT NULL,
    shopify_customer_id  TEXT        NOT NULL,
    email                TEXT,           -- DPDP §2(t) personal data
    first_name           TEXT,           -- DPDP §2(t) personal data
    last_name            TEXT,           -- DPDP §2(t) personal data
    orders_count         INTEGER,
    total_spent_raw      TEXT,           -- raw; no conversion
    raw_payload          JSONB       NOT NULL
);

ALTER TABLE raw_shopify_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_shopify_customers
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS raw_shopify_customers_ws_ingested_idx
  ON raw_shopify_customers (workspace_id, ingested_at);

-- ---------------------------------------------------------------------------
-- shopify_products  (not PII-bearing; catalog data)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_shopify_products (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    lawful_basis         TEXT        NOT NULL
        CHECK (lawful_basis IN ('owner_brand_controller','data_principal_consent','legitimate_interest')),
    purpose_code         TEXT        NOT NULL
        CHECK (purpose_code IN ('analytics_performance','logistics_tracking','email_performance','catalog_sync')),
    ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor_event_id      TEXT        NOT NULL,
    UNIQUE (workspace_id, vendor_event_id),
    vendor               TEXT        NOT NULL DEFAULT 'shopify',
    event_type           TEXT        NOT NULL DEFAULT 'product',
    occurred_at          TIMESTAMPTZ NOT NULL,
    shopify_product_id   TEXT        NOT NULL,
    title                TEXT,
    product_type         TEXT,
    status               TEXT,
    raw_payload          JSONB       NOT NULL
);

ALTER TABLE raw_shopify_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_shopify_products
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS raw_shopify_products_ws_ingested_idx
  ON raw_shopify_products (workspace_id, ingested_at);

-- ---------------------------------------------------------------------------
-- woocommerce_orders  (PII-bearing: customer_email, customer_phone, billing_*, shipping_*)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_woocommerce_orders (
    id                     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id           UUID        NOT NULL,
    lawful_basis           TEXT        NOT NULL
        CHECK (lawful_basis IN ('owner_brand_controller','data_principal_consent','legitimate_interest')),
    purpose_code           TEXT        NOT NULL
        CHECK (purpose_code IN ('analytics_performance','logistics_tracking','email_performance','catalog_sync')),
    ingested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor_event_id        TEXT        NOT NULL,
    UNIQUE (workspace_id, vendor_event_id),
    vendor                 TEXT        NOT NULL DEFAULT 'woocommerce',
    event_type             TEXT        NOT NULL DEFAULT 'order',
    occurred_at            TIMESTAMPTZ NOT NULL,
    woo_order_id           TEXT        NOT NULL,
    status                 TEXT,
    customer_email         TEXT,           -- DPDP §2(t) personal data
    customer_phone         TEXT,           -- DPDP §2(t) personal data
    billing_first_name     TEXT,           -- DPDP §2(t) personal data
    billing_last_name      TEXT,           -- DPDP §2(t) personal data
    -- billing_address_1 REMOVED (P0-B DPDP GATE): full street address is not
    -- required for analytics; city/state/postcode retained for geo-bucketing.
    billing_city           TEXT,           -- DPDP §2(t) personal data
    billing_state          TEXT,           -- DPDP §2(t) personal data
    billing_postcode       TEXT,           -- DPDP §2(t) personal data
    shipping_first_name    TEXT,           -- DPDP §2(t) personal data
    shipping_last_name     TEXT,           -- DPDP §2(t) personal data
    -- shipping_address_1 REMOVED (P0-B DPDP GATE): same rationale as billing_address_1.
    shipping_city          TEXT,           -- DPDP §2(t) personal data
    shipping_state         TEXT,           -- DPDP §2(t) personal data
    shipping_postcode      TEXT,           -- DPDP §2(t) personal data
    total_raw              TEXT,           -- raw; no conversion
    currency               TEXT,
    raw_payload            JSONB       NOT NULL
);

ALTER TABLE raw_woocommerce_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_woocommerce_orders
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS raw_woocommerce_orders_ws_ingested_idx
  ON raw_woocommerce_orders (workspace_id, ingested_at);

-- ---------------------------------------------------------------------------
-- meta_ads_daily  (NOT PII-bearing; aggregate campaign metrics only)
-- Conversions API / hashed-PII OUT OF SCOPE until separately gated.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_meta_ads_daily (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    lawful_basis         TEXT        NOT NULL
        CHECK (lawful_basis IN ('owner_brand_controller','data_principal_consent','legitimate_interest')),
    purpose_code         TEXT        NOT NULL
        CHECK (purpose_code IN ('analytics_performance','logistics_tracking','email_performance','catalog_sync')),
    ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor_event_id      TEXT        NOT NULL,
    UNIQUE (workspace_id, vendor_event_id),
    vendor               TEXT        NOT NULL DEFAULT 'meta',
    event_type           TEXT        NOT NULL DEFAULT 'ads_daily',
    occurred_at          TIMESTAMPTZ NOT NULL,
    campaign_id          TEXT,
    adset_id             TEXT,
    ad_id                TEXT,
    date_start           DATE,
    date_stop            DATE,
    impressions          INTEGER,
    clicks               INTEGER,
    spend_raw            TEXT,           -- raw; no conversion
    currency             TEXT,
    raw_payload          JSONB       NOT NULL
);

ALTER TABLE raw_meta_ads_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_meta_ads_daily
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS raw_meta_ads_daily_ws_ingested_idx
  ON raw_meta_ads_daily (workspace_id, ingested_at);

-- ---------------------------------------------------------------------------
-- google_ads_daily  (NOT PII-bearing; aggregate campaign metrics only)
-- Enhanced-conversions hashed-PII OUT OF SCOPE until separately gated.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_google_ads_daily (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    lawful_basis         TEXT        NOT NULL
        CHECK (lawful_basis IN ('owner_brand_controller','data_principal_consent','legitimate_interest')),
    purpose_code         TEXT        NOT NULL
        CHECK (purpose_code IN ('analytics_performance','logistics_tracking','email_performance','catalog_sync')),
    ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor_event_id      TEXT        NOT NULL,
    UNIQUE (workspace_id, vendor_event_id),
    vendor               TEXT        NOT NULL DEFAULT 'google',
    event_type           TEXT        NOT NULL DEFAULT 'ads_daily',
    occurred_at          TIMESTAMPTZ NOT NULL,
    campaign_id          TEXT,
    ad_group_id          TEXT,
    date_day             DATE,
    impressions          INTEGER,
    clicks               INTEGER,
    cost_micros_raw      TEXT,           -- raw; no conversion
    currency             TEXT,
    raw_payload          JSONB       NOT NULL
);

ALTER TABLE raw_google_ads_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_google_ads_daily
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS raw_google_ads_daily_ws_ingested_idx
  ON raw_google_ads_daily (workspace_id, ingested_at);

-- ---------------------------------------------------------------------------
-- klaviyo_email_performance  (NOT PII-bearing; aggregate campaign metrics only)
-- Individual subscriber data OUT OF SCOPE; declared explicitly in PiiManifest.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_klaviyo_email_performance (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    lawful_basis         TEXT        NOT NULL
        CHECK (lawful_basis IN ('owner_brand_controller','data_principal_consent','legitimate_interest')),
    purpose_code         TEXT        NOT NULL
        CHECK (purpose_code IN ('analytics_performance','logistics_tracking','email_performance','catalog_sync')),
    ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor_event_id      TEXT        NOT NULL,
    UNIQUE (workspace_id, vendor_event_id),
    vendor               TEXT        NOT NULL DEFAULT 'klaviyo',
    event_type           TEXT        NOT NULL DEFAULT 'email_performance',
    occurred_at          TIMESTAMPTZ NOT NULL,
    campaign_id          TEXT,
    campaign_name        TEXT,
    date_day             DATE,
    delivered            INTEGER,
    unique_opens         INTEGER,
    unique_clicks        INTEGER,
    placed_order_count   INTEGER,
    unsubscribe_count    INTEGER,
    raw_payload          JSONB       NOT NULL
);

ALTER TABLE raw_klaviyo_email_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_klaviyo_email_performance
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS raw_klaviyo_email_performance_ws_ingested_idx
  ON raw_klaviyo_email_performance (workspace_id, ingested_at);

-- ---------------------------------------------------------------------------
-- shiprocket_shipments  (PII-bearing: delivery_pincode, delivery_city, delivery_state)
-- HIGHEST-blast-radius connector — sequenced LAST at Stage-8.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_shiprocket_shipments (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    lawful_basis         TEXT        NOT NULL
        CHECK (lawful_basis IN ('owner_brand_controller','data_principal_consent','legitimate_interest')),
    purpose_code         TEXT        NOT NULL
        CHECK (purpose_code IN ('analytics_performance','logistics_tracking','email_performance','catalog_sync')),
    ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor_event_id      TEXT        NOT NULL,
    UNIQUE (workspace_id, vendor_event_id),
    vendor               TEXT        NOT NULL DEFAULT 'shiprocket',
    event_type           TEXT        NOT NULL DEFAULT 'shipment',
    occurred_at          TIMESTAMPTZ NOT NULL,
    shipment_id          TEXT        NOT NULL,
    order_id             TEXT,
    status               TEXT,
    courier_name         TEXT,
    delivery_pincode     TEXT,          -- DPDP §2(t) personal data
    delivery_city        TEXT,          -- DPDP §2(t) personal data
    delivery_state       TEXT,          -- DPDP §2(t) personal data
    raw_payload          JSONB       NOT NULL
);

ALTER TABLE raw_shiprocket_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_shiprocket_shipments
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS raw_shiprocket_shipments_ws_ingested_idx
  ON raw_shiprocket_shipments (workspace_id, ingested_at);

-- ---------------------------------------------------------------------------
-- unicommerce_products  (NOT PII-bearing; catalog sync)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_unicommerce_products (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    lawful_basis         TEXT        NOT NULL
        CHECK (lawful_basis IN ('owner_brand_controller','data_principal_consent','legitimate_interest')),
    purpose_code         TEXT        NOT NULL
        CHECK (purpose_code IN ('analytics_performance','logistics_tracking','email_performance','catalog_sync')),
    ingested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor_event_id      TEXT        NOT NULL,
    UNIQUE (workspace_id, vendor_event_id),
    vendor               TEXT        NOT NULL DEFAULT 'unicommerce',
    event_type           TEXT        NOT NULL DEFAULT 'product',
    occurred_at          TIMESTAMPTZ NOT NULL,
    sku_code             TEXT,
    item_type_sku        TEXT,
    category             TEXT,
    mrp_raw              TEXT,          -- raw; no conversion
    raw_payload          JSONB       NOT NULL
);

ALTER TABLE raw_unicommerce_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_unicommerce_products
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE INDEX IF NOT EXISTS raw_unicommerce_products_ws_ingested_idx
  ON raw_unicommerce_products (workspace_id, ingested_at);

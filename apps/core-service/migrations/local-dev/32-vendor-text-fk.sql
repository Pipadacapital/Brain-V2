-- =============================================================================
-- 32-vendor-text-fk.sql  (P0-R6 — closes G3, unblocks Shiprocket)
--
-- Converts the 3/7-value connector_vendor ENUM to TEXT with an FK to a new
-- connector_vendors(code TEXT PK, archetype TEXT) registry table.
--
-- Why:  Every day the ENUM lives, adding vendor #4 requires ALTER TYPE
--       coordinated across 10+ tables.  A data-row is a single INSERT.
--       phase5-legacy-facts-to-pg.sql:524 already casts 'SHIPROCKET'::connector_vendor;
--       that cast fails until this migration runs.
--
-- Scope of affected tables (connector_vendor column):
--   connector_connections   .vendor
--   connector_credentials   .vendor
--   connector_oauth_states  .vendor
--   connector_order_facts_hot  .vendor
--   connector_line_item_facts_hot .vendor
--   connector_product_facts  .vendor
--   connector_ad_spend_facts .vendor
--   connector_refund_facts   .vendor
--   connector_shipment_facts .vendor
--   connector_definitions    .vendor  (PK — becomes FK target basis)
--   customer_pii             .source_vendor
--
-- Views (connector_order_facts, connector_line_item_facts) are rebuilt so they
-- read TEXT from the hot tables they wrap — no semantic change.
--
-- Feature flag: none (additive schema change; fully reversible via down.sql).
-- CTOA sign-off: typed-contract change, additive + reversible — flagged per
--   ADR-CONVERGENCE-001 escalation for Rohan visibility.
--
-- Rollback: run 32-down-vendor-text-fk.sql (restores the enum 1:1).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1 — create the connector_vendors registry table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_vendors (
  code      TEXT PRIMARY KEY,          -- e.g. 'SHOPIFY', 'SHIPROCKET'
  archetype TEXT NOT NULL DEFAULT ''   -- e.g. 'ecom', 'logistics', 'ads', 'email', 'erp'
);

COMMENT ON TABLE  connector_vendors IS
  'Registry of known vendor codes.  Adding a new vendor = INSERT one row here; '
  'no ALTER TYPE, no code change.  archetype mirrors connector_definitions.category.';

COMMENT ON COLUMN connector_vendors.code IS
  'Upper-case vendor identifier — matches connector_vendor enum values 1:1.';

GRANT SELECT                         ON connector_vendors TO rls_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_vendors TO postgres;

-- ---------------------------------------------------------------------------
-- Step 2 — seed all 7 currently-known vendors (idempotent).
-- ---------------------------------------------------------------------------
INSERT INTO connector_vendors (code, archetype) VALUES
  ('SHOPIFY',     'ecom'),
  ('META',        'ads'),
  ('GOOGLE',      'ads'),
  ('SHIPROCKET',  'logistics'),
  ('WOOCOMMERCE', 'ecom'),
  ('UNICOMMERCE', 'erp'),
  ('KLAVIYO',     'email')
ON CONFLICT (code) DO UPDATE SET archetype = EXCLUDED.archetype;

-- ---------------------------------------------------------------------------
-- Step 3 — drop views that wrap the hot tables (we recreate them below).
-- Must drop before altering underlying table columns.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS connector_order_facts;
DROP VIEW IF EXISTS connector_line_item_facts;

-- ---------------------------------------------------------------------------
-- Step 4 — convert connector_vendor ENUM columns to TEXT + FK, table by table.
--
-- Pattern per table:
--   a. ALTER COLUMN … TYPE TEXT  (USING col::TEXT — safe cast from enum to text)
--   b. ADD CONSTRAINT … FOREIGN KEY REFERENCES connector_vendors(code)
--
-- connector_definitions is the connector registry; its PK (vendor) stays TEXT
-- after conversion.  No other table FKs to connector_definitions, so no
-- child-FK cascade issue.
-- ---------------------------------------------------------------------------

-- 4.1  connector_connections
ALTER TABLE connector_connections
  ALTER COLUMN vendor TYPE TEXT USING vendor::TEXT;

ALTER TABLE connector_connections
  ADD CONSTRAINT connector_connections_vendor_fk
    FOREIGN KEY (vendor) REFERENCES connector_vendors(code);

-- 4.2  connector_credentials
ALTER TABLE connector_credentials
  ALTER COLUMN vendor TYPE TEXT USING vendor::TEXT;

ALTER TABLE connector_credentials
  ADD CONSTRAINT connector_credentials_vendor_fk
    FOREIGN KEY (vendor) REFERENCES connector_vendors(code);

-- 4.3  connector_oauth_states
ALTER TABLE connector_oauth_states
  ALTER COLUMN vendor TYPE TEXT USING vendor::TEXT;

ALTER TABLE connector_oauth_states
  ADD CONSTRAINT connector_oauth_states_vendor_fk
    FOREIGN KEY (vendor) REFERENCES connector_vendors(code);

-- 4.4  connector_order_facts_hot
ALTER TABLE connector_order_facts_hot
  ALTER COLUMN vendor TYPE TEXT USING vendor::TEXT;

ALTER TABLE connector_order_facts_hot
  ADD CONSTRAINT connector_order_facts_hot_vendor_fk
    FOREIGN KEY (vendor) REFERENCES connector_vendors(code);

-- 4.5  connector_line_item_facts_hot
ALTER TABLE connector_line_item_facts_hot
  ALTER COLUMN vendor TYPE TEXT USING vendor::TEXT;

ALTER TABLE connector_line_item_facts_hot
  ADD CONSTRAINT connector_line_item_facts_hot_vendor_fk
    FOREIGN KEY (vendor) REFERENCES connector_vendors(code);

-- 4.6  connector_product_facts
ALTER TABLE connector_product_facts
  ALTER COLUMN vendor TYPE TEXT USING vendor::TEXT;

ALTER TABLE connector_product_facts
  ADD CONSTRAINT connector_product_facts_vendor_fk
    FOREIGN KEY (vendor) REFERENCES connector_vendors(code);

-- 4.7  connector_ad_spend_facts
ALTER TABLE connector_ad_spend_facts
  ALTER COLUMN vendor TYPE TEXT USING vendor::TEXT;

ALTER TABLE connector_ad_spend_facts
  ADD CONSTRAINT connector_ad_spend_facts_vendor_fk
    FOREIGN KEY (vendor) REFERENCES connector_vendors(code);

-- 4.8  connector_refund_facts
ALTER TABLE connector_refund_facts
  ALTER COLUMN vendor TYPE TEXT USING vendor::TEXT;

ALTER TABLE connector_refund_facts
  ADD CONSTRAINT connector_refund_facts_vendor_fk
    FOREIGN KEY (vendor) REFERENCES connector_vendors(code);

-- 4.9  connector_shipment_facts
-- IF EXISTS: this fact table is not in the base local-dev schema — it is created
-- (and populated) by the legacy ETL (tools/migrate-legacy/phase5). On a from-scratch
-- DB it is absent at migration time, so guard the conversion; the ETL creates it
-- already vendor-as-TEXT against the connector_vendors registry seeded above.
ALTER TABLE IF EXISTS connector_shipment_facts
  ALTER COLUMN vendor TYPE TEXT USING vendor::TEXT;

ALTER TABLE IF EXISTS connector_shipment_facts
  ADD CONSTRAINT connector_shipment_facts_vendor_fk
    FOREIGN KEY (vendor) REFERENCES connector_vendors(code);

-- 4.10  connector_definitions  (PK column — convert to TEXT)
ALTER TABLE connector_definitions
  ALTER COLUMN vendor TYPE TEXT USING vendor::TEXT;

ALTER TABLE connector_definitions
  ADD CONSTRAINT connector_definitions_vendor_fk
    FOREIGN KEY (vendor) REFERENCES connector_vendors(code);

-- 4.11  customer_pii  (source_vendor column)
ALTER TABLE customer_pii
  ALTER COLUMN source_vendor TYPE TEXT USING source_vendor::TEXT;

ALTER TABLE customer_pii
  ADD CONSTRAINT customer_pii_source_vendor_fk
    FOREIGN KEY (source_vendor) REFERENCES connector_vendors(code);

-- ---------------------------------------------------------------------------
-- Step 5 — drop the now-unused connector_vendor ENUM type.
-- (All columns referencing it have been converted to TEXT above.)
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS connector_vendor;

-- ---------------------------------------------------------------------------
-- Step 6 — recreate the convenience views so callers see no change.
-- The vendor column is now TEXT — same values, same positions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW connector_order_facts AS
  SELECT
    id, workspace_id, vendor, vendor_order_id, order_number,
    financial_status, fulfillment_status, payment_method,
    currency_code, gross_sales_mu, total_discount_mu, total_tax_mu,
    shipping_mu, customer_ref, is_new_customer, delivery_pincode,
    delivery_city, processed_at, cancelled_at, synced_at,
    billing_pincode, is_cod, order_type, total_refund_mu
  FROM connector_order_facts_hot;

CREATE OR REPLACE VIEW connector_line_item_facts AS
  SELECT
    id, workspace_id, vendor, vendor_order_id, vendor_line_id,
    sku, title, quantity, unit_price_mu, gst_slab_bp, synced_at,
    vendor_product_id
  FROM connector_line_item_facts_hot;

-- ---------------------------------------------------------------------------
-- Step 7 — verify: Shiprocket is now a valid data row (this is the acceptance
-- probe the plan calls out; it would have failed pre-migration).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM connector_vendors WHERE code = 'SHIPROCKET') THEN
    RAISE EXCEPTION 'P0-R6 invariant: SHIPROCKET must be a row in connector_vendors';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'connector_vendor'
  ) THEN
    RAISE EXCEPTION 'P0-R6 invariant: connector_vendor enum must be dropped';
  END IF;
END $$;

COMMIT;

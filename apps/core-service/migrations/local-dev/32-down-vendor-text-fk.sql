-- =============================================================================
-- 32-down-vendor-text-fk.sql  (P0-R6 rollback)
--
-- Reverses 32-vendor-text-fk.sql:  restores the connector_vendor ENUM from the
-- connector_vendors registry (values map 1:1 — all 7 enum members are seeded in
-- migration 09 already, so ADD VALUE is idempotent).
--
-- IMPORTANT: run this ONLY in a pre-go-live environment.  Rolling back after
-- live PII has been ingested will not corrupt data (the TEXT values are identical
-- to the enum labels), but the enum will reject any vendor code that was INSERTed
-- into connector_vendors after this migration ran — those rows must be deleted
-- first or the ALTER COLUMN will fail with invalid-input-value.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1 — drop the convenience views (rebuilt at the end).
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS connector_order_facts;
DROP VIEW IF EXISTS connector_line_item_facts;

-- ---------------------------------------------------------------------------
-- Step 2 — recreate the connector_vendor ENUM with all 7 values.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE connector_vendor AS ENUM
    ('SHOPIFY','META','GOOGLE','SHIPROCKET','WOOCOMMERCE','UNICOMMERCE','KLAVIYO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Step 3 — drop FK constraints, convert TEXT back to enum, restore FKs.
-- Order is the reverse of the up migration.
-- ---------------------------------------------------------------------------

-- customer_pii
ALTER TABLE customer_pii DROP CONSTRAINT IF EXISTS customer_pii_source_vendor_fk;
ALTER TABLE customer_pii
  ALTER COLUMN source_vendor TYPE connector_vendor USING source_vendor::connector_vendor;

-- connector_definitions
ALTER TABLE connector_definitions DROP CONSTRAINT IF EXISTS connector_definitions_vendor_fk;
ALTER TABLE connector_definitions
  ALTER COLUMN vendor TYPE connector_vendor USING vendor::connector_vendor;

-- connector_shipment_facts
ALTER TABLE connector_shipment_facts DROP CONSTRAINT IF EXISTS connector_shipment_facts_vendor_fk;
ALTER TABLE connector_shipment_facts
  ALTER COLUMN vendor TYPE connector_vendor USING vendor::connector_vendor;

-- connector_refund_facts
ALTER TABLE connector_refund_facts DROP CONSTRAINT IF EXISTS connector_refund_facts_vendor_fk;
ALTER TABLE connector_refund_facts
  ALTER COLUMN vendor TYPE connector_vendor USING vendor::connector_vendor;

-- connector_ad_spend_facts
ALTER TABLE connector_ad_spend_facts DROP CONSTRAINT IF EXISTS connector_ad_spend_facts_vendor_fk;
ALTER TABLE connector_ad_spend_facts
  ALTER COLUMN vendor TYPE connector_vendor USING vendor::connector_vendor;

-- connector_product_facts
ALTER TABLE connector_product_facts DROP CONSTRAINT IF EXISTS connector_product_facts_vendor_fk;
ALTER TABLE connector_product_facts
  ALTER COLUMN vendor TYPE connector_vendor USING vendor::connector_vendor;

-- connector_line_item_facts_hot
ALTER TABLE connector_line_item_facts_hot DROP CONSTRAINT IF EXISTS connector_line_item_facts_hot_vendor_fk;
ALTER TABLE connector_line_item_facts_hot
  ALTER COLUMN vendor TYPE connector_vendor USING vendor::connector_vendor;

-- connector_order_facts_hot
ALTER TABLE connector_order_facts_hot DROP CONSTRAINT IF EXISTS connector_order_facts_hot_vendor_fk;
ALTER TABLE connector_order_facts_hot
  ALTER COLUMN vendor TYPE connector_vendor USING vendor::connector_vendor;

-- connector_oauth_states
ALTER TABLE connector_oauth_states DROP CONSTRAINT IF EXISTS connector_oauth_states_vendor_fk;
ALTER TABLE connector_oauth_states
  ALTER COLUMN vendor TYPE connector_vendor USING vendor::connector_vendor;

-- connector_credentials
ALTER TABLE connector_credentials DROP CONSTRAINT IF EXISTS connector_credentials_vendor_fk;
ALTER TABLE connector_credentials
  ALTER COLUMN vendor TYPE connector_vendor USING vendor::connector_vendor;

-- connector_connections
ALTER TABLE connector_connections DROP CONSTRAINT IF EXISTS connector_connections_vendor_fk;
ALTER TABLE connector_connections
  ALTER COLUMN vendor TYPE connector_vendor USING vendor::connector_vendor;

-- ---------------------------------------------------------------------------
-- Step 4 — drop the connector_vendors registry.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS connector_vendors;

-- ---------------------------------------------------------------------------
-- Step 5 — recreate the views referencing connector_vendor-typed columns.
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

COMMIT;

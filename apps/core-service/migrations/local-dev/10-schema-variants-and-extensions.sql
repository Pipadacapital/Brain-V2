-- =============================================================================
-- Phase 1 — D3 (variants) + additive ALTERs on connector_product_facts /
-- connector_order_facts / connector_refund_facts (WooCommerce parity, Shopify enrichment).
-- Design: docs/data-architecture-plan.md §3.2 – §3.4, §3.7.
-- =============================================================================

-- D3: variant_facts (per-SKU child of product; sku unique within a workspace+vendor product)
CREATE TABLE IF NOT EXISTS connector_variant_facts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor              connector_vendor NOT NULL,
  vendor_variant_id   TEXT NOT NULL,
  vendor_product_id   TEXT NOT NULL,                  -- FK-by-business-key to connector_product_facts.vendor_product_id
  sku                 TEXT,
  title               TEXT,
  price_mu            BIGINT,
  compare_at_price_mu BIGINT,
  inventory_qty       INT,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, vendor_variant_id)
);
CREATE INDEX IF NOT EXISTS connector_variant_facts_product_idx
  ON connector_variant_facts (workspace_id, vendor, vendor_product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_variant_facts TO rls_app;

-- §3.3 — product_facts additive (cost_mu already added by /tmp/brain_mig/03b — promoted)
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS cost_mu       BIGINT;
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS mrp_mu        BIGINT;
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS inventory_qty INT;
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS handle        TEXT;
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS image_url     TEXT;
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS tags          TEXT[] NOT NULL DEFAULT '{}';

-- §3.4 — order_facts additive (WooCommerce parity)
ALTER TABLE connector_order_facts ADD COLUMN IF NOT EXISTS billing_pincode TEXT;
ALTER TABLE connector_order_facts ADD COLUMN IF NOT EXISTS is_cod          BOOLEAN;
ALTER TABLE connector_order_facts ADD COLUMN IF NOT EXISTS order_type      TEXT;
ALTER TABLE connector_order_facts ADD COLUMN IF NOT EXISTS total_refund_mu BIGINT NOT NULL DEFAULT 0;

-- §3.7 — refund-line additive (vendor_product_id for product-level returns join)
ALTER TABLE connector_refund_facts ADD COLUMN IF NOT EXISTS vendor_product_id TEXT;
CREATE INDEX IF NOT EXISTS connector_refund_facts_prod_idx
  ON connector_refund_facts (workspace_id, vendor_product_id);

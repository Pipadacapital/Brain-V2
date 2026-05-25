-- =============================================================================
-- LOCAL-DEV — Slice E (connector data ingestion: canonical facts post-ACL).
--
-- Four canonical-fact tables on the LOCAL dev Postgres (docker, :5432). Additive on
-- top of slice-D's connector tables (03/04). These hold the NORMALIZED, post-ACL
-- facts the analytics read for a CONNECTED workspace (Shopify orders/line-items/
-- products; Meta+Google daily ad spend). Money = BIGINT minor units (paise) — NEVER
-- float/NUMERIC. The raw vendor decimal converts at the ACL (acl.ts), not here.
--
-- IDEMPOTENCY: each table has a UNIQUE business key so a re-sync UPSERTs the SAME
-- row (ON CONFLICT DO UPDATE) — re-sync never double-counts, even at the aggregate
-- (SUM) layer the analytics compute. (Persona P-002.)
--
-- PII MINIMIZATION (DPDP — persona P-006): the canonical order FACT stores NO email,
-- name, full street address, or phone. Only an OPAQUE customer_ref (sha256 of the
-- vendor customer id, for new-vs-returning) and the pincode/city the India RTO metric
-- needs. Raw PII (email/name) stays in the slice-D / Child-3 raw landing under the PII
-- manifest; it never reaches these analytics facts.
--
-- Apply order: 01 → 02 → 03 → 04 → THIS (05) → 06-enable-rls-connector-facts.sql.
-- Run as the postgres superuser (DDL); the app connects as rls_app (non-BYPASSRLS).
-- Reuses the connector_vendor ENUM from 03-schema-connectors.sql (no new enum).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- connector_order_facts — one canonical order per (workspace, vendor, vendor_order_id).
-- Drives slice-1 store/revenue-ladder + slice-2 P&L + slice-3 COD/RTO + slice-4 aMER.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_order_facts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor             connector_vendor NOT NULL,
  vendor_order_id    TEXT NOT NULL,
  order_number       TEXT,
  financial_status   TEXT,
  fulfillment_status TEXT,
  payment_method     TEXT,                       -- 'COD' | 'Prepaid' (India adapter classifier)
  currency_code      TEXT NOT NULL,
  gross_sales_mu     BIGINT NOT NULL,            -- minor units (paise); NEVER float
  total_discount_mu  BIGINT NOT NULL,
  total_tax_mu       BIGINT NOT NULL,
  shipping_mu        BIGINT NOT NULL DEFAULT 0,
  customer_ref       TEXT,                        -- sha256(vendor customer id) — opaque, NOT email
  is_new_customer    BOOLEAN,
  delivery_pincode   TEXT,                        -- India RTO/pincode metric ONLY
  delivery_city      TEXT,                        -- India RTO/pincode metric ONLY
  processed_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, vendor_order_id)  -- idempotency key (P-002)
);
CREATE INDEX IF NOT EXISTS connector_order_facts_ws_idx
  ON connector_order_facts (workspace_id, processed_at);

-- ---------------------------------------------------------------------------
-- connector_line_item_facts — per-SKU line items (drives per-SKU GST extraction).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_line_item_facts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor          connector_vendor NOT NULL,
  vendor_order_id TEXT NOT NULL,
  vendor_line_id  TEXT NOT NULL,
  sku             TEXT,
  title           TEXT,
  quantity        BIGINT NOT NULL,
  unit_price_mu   BIGINT NOT NULL,               -- minor units; NEVER float
  gst_slab_bp     INT,                            -- 0 / 500 / 1800 / 4000 bp (India GST 2.0)
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, vendor_order_id, vendor_line_id)  -- idempotency key
);
CREATE INDEX IF NOT EXISTS connector_line_item_facts_order_idx
  ON connector_line_item_facts (workspace_id, vendor, vendor_order_id);

-- ---------------------------------------------------------------------------
-- connector_product_facts — products (catalog; drives slice-6 product perf).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_product_facts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor            connector_vendor NOT NULL,
  vendor_product_id TEXT NOT NULL,
  title             TEXT,
  product_type      TEXT,
  status            TEXT,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, vendor_product_id)  -- idempotency key
);

-- ---------------------------------------------------------------------------
-- connector_ad_spend_facts — Meta + Google daily campaign spend. Drives slice-4
-- marketing (MER/CAC, acquisition spend). One row per (ws, vendor, campaign, day)
-- → a re-sync of the same day UPSERTs the same row (no double-count, P-002).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_ad_spend_facts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor        connector_vendor NOT NULL,        -- META | GOOGLE
  campaign_id   TEXT NOT NULL,
  campaign_name TEXT,
  spend_date    DATE NOT NULL,
  spend_mu      BIGINT NOT NULL,                  -- minor units; NEVER float
  impressions   BIGINT NOT NULL DEFAULT 0,
  clicks        BIGINT NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, campaign_id, spend_date)  -- idempotency key (P-002)
);
CREATE INDEX IF NOT EXISTS connector_ad_spend_facts_ws_date_idx
  ON connector_ad_spend_facts (workspace_id, spend_date);

-- ---------------------------------------------------------------------------
-- Grants — the app role (rls_app, non-BYPASSRLS) needs DML on these tables.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_order_facts      TO rls_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_line_item_facts  TO rls_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_product_facts    TO rls_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_ad_spend_facts   TO rls_app;

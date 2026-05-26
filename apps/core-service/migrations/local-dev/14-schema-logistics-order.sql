-- =============================================================================
-- Phase 1 — D9 (logistics order layer; the Shiprocket order ↔ Shopify order join).
-- Design: docs/data-architecture-plan.md §3.8.
-- channel_order_id carries the Shopify order ref so realized-GMV-by-order is computable.
-- =============================================================================
CREATE TABLE IF NOT EXISTS connector_logistics_order_facts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor                      connector_vendor NOT NULL,    -- SHIPROCKET
  vendor_logistics_order_id   TEXT NOT NULL,                -- shiprocket internal order id
  channel_order_id            TEXT,                         -- → connector_order_facts.vendor_order_id
  channel_name                TEXT,
  channel_id                  TEXT,
  status                      TEXT,
  status_code                 INT,
  payment_method              TEXT,
  total_mu                    BIGINT,
  currency_code               TEXT,
  order_date                  TIMESTAMPTZ,
  synced_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, vendor_logistics_order_id)
);
CREATE INDEX IF NOT EXISTS connector_logistics_order_facts_chref_idx
  ON connector_logistics_order_facts (workspace_id, channel_order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_logistics_order_facts TO rls_app;

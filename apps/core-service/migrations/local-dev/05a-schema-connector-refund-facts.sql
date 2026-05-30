-- =============================================================================
-- LOCAL-DEV — Slice E base fix: connector_refund_facts canonical fact table.
--
-- WHY THIS FILE EXISTS: migration 10 (variants-and-extensions) ALTERs
-- connector_refund_facts (adds vendor_product_id + index), and 23 references it,
-- but no prior local-dev migration CREATEd it — the table was historically
-- present from the legacy ETL schema, so a from-scratch `docker compose up` +
-- ordered migration apply failed at 10 with "relation connector_refund_facts
-- does not exist". This makes the local stand-up self-contained (no live ETL).
--
-- Shape mirrors the other canonical connector fact tables (05): money = BIGINT
-- minor units (paise), workspace_id-leading, idempotent business key for re-sync
-- UPSERT. NO PII (opaque vendor ids + amounts only). Apply order: after 05,
-- before 06 (RLS) and 10 (ALTER).
-- =============================================================================
CREATE TABLE IF NOT EXISTS connector_refund_facts (
  id                    uuid        DEFAULT gen_random_uuid() NOT NULL,
  workspace_id          uuid        NOT NULL,
  vendor                connector_vendor NOT NULL,
  vendor_order_id       text        NOT NULL,
  vendor_refund_id      text        NOT NULL,
  vendor_refund_line_id text        NOT NULL,
  sku                   text,
  quantity              bigint,
  subtotal_mu           bigint,
  tax_mu                bigint,
  processed_at          timestamptz,
  synced_at             timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  -- idempotent business key: a re-sync UPSERTs the SAME refund line (no double-count)
  UNIQUE (workspace_id, vendor, vendor_refund_line_id)
);

-- FORCE RLS + workspace isolation — mirrors 06-enable-rls-connector-facts.sql so
-- this workspace-scoped fact table is not a tenant-isolation gap.
ALTER TABLE connector_refund_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_refund_facts;
CREATE POLICY ws_isolation ON connector_refund_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE connector_refund_facts FORCE ROW LEVEL SECURITY;

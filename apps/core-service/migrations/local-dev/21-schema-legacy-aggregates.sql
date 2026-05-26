-- =============================================================================
-- Phase 1 — D20 transitional aggregates schema (legacy_aggregates.*).
-- Design: docs/data-architecture-plan.md §3.12. Separate namespace so the
-- deprecation boundary is loud: the Brain metric engine recomputes from facts
-- in parallel and a parity report is filed against these aggregates.
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS legacy_aggregates;
GRANT USAGE ON SCHEMA legacy_aggregates TO rls_app;

-- workspace_daily_metrics — 1:1 mirror of legacy, money normalized to BIGINT mu
CREATE TABLE IF NOT EXISTS legacy_aggregates.workspace_daily_metrics (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  date                      DATE NOT NULL,
  net_sales_mu              BIGINT NOT NULL,
  gross_sales_mu            BIGINT NOT NULL,
  total_tax_mu              BIGINT NOT NULL,
  total_discount_mu         BIGINT NOT NULL,
  orders_count              INT    NOT NULL,
  aov_mu                    BIGINT NOT NULL,
  currency_code             TEXT   NOT NULL,
  cogs_mu                   BIGINT NOT NULL,
  shipping_mu               BIGINT NOT NULL,
  packaging_mu              BIGINT NOT NULL,
  website_charges_mu        BIGINT NOT NULL,
  cm1_mu                    BIGINT NOT NULL,
  meta_ad_spend_mu          BIGINT NOT NULL,
  google_ad_spend_mu        BIGINT NOT NULL,
  total_ad_spend_mu         BIGINT NOT NULL,
  cm2_mu                    BIGINT NOT NULL,
  misc_expenses_prorated_mu BIGINT NOT NULL,
  cm3_mu                    BIGINT NOT NULL,
  acos_bp                   INT,
  blended_roas_x100         INT,
  sessions                  INT,
  conversion_rate_bp        INT,
  rto_orders                INT,
  rto_value_mu              BIGINT,
  rto_percent_bp            INT,
  rto_mapped                INT,
  rto_unmapped              INT,
  total_shipments           INT,
  prepaid_orders_count      INT,
  prepaid_percentage_bp     INT,
  computed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, date)
);
CREATE INDEX IF NOT EXISTS wdm_ws_date_idx
  ON legacy_aggregates.workspace_daily_metrics (workspace_id, date);
GRANT SELECT, INSERT, UPDATE, DELETE ON legacy_aggregates.workspace_daily_metrics TO rls_app;

-- shopify_analytics_daily — keyed by workspace via the connection's workspace_id
CREATE TABLE IF NOT EXISTS legacy_aggregates.shopify_analytics_daily (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shop_domain         TEXT NOT NULL,
  date                DATE NOT NULL,
  net_sales_mu        BIGINT NOT NULL,
  gross_sales_mu      BIGINT NOT NULL,
  orders_count        INT NOT NULL,
  aov_mu              BIGINT NOT NULL,
  total_tax_mu        BIGINT NOT NULL,
  total_discount_mu   BIGINT NOT NULL,
  currency_code       TEXT NOT NULL,
  conversion_rate_bp  INT,
  sessions            INT,
  returns_mu          BIGINT,
  total_returns_mu    BIGINT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, shop_domain, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON legacy_aggregates.shopify_analytics_daily TO rls_app;

-- product_daily_aggregates — workspace_id-leading, product key denormalized
CREATE TABLE IF NOT EXISTS legacy_aggregates.product_daily_aggregates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor            connector_vendor NOT NULL,
  vendor_product_id TEXT NOT NULL,
  date              DATE NOT NULL,
  quantity_sold     INT NOT NULL,
  gross_sales_mu    BIGINT NOT NULL,
  orders_count      INT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, vendor_product_id, date)
);
CREATE INDEX IF NOT EXISTS pda_ws_date_idx
  ON legacy_aggregates.product_daily_aggregates (workspace_id, date);
GRANT SELECT, INSERT, UPDATE, DELETE ON legacy_aggregates.product_daily_aggregates TO rls_app;

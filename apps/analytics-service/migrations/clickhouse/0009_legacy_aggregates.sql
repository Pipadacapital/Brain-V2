-- @paradigm: sql
-- C14, C15, C16 — transitional legacy aggregates mirrored to ClickHouse.
-- Mechanical port of v1 §3.12 to CH types (BIGINT→Int64, INT→Int32, TEXT→LowCardinality
-- where bounded, DATE→Date, TIMESTAMPTZ→DateTime). Same workspace_id-leading ORDER BY.
-- Plan: docs/data-architecture-plan-v2.md §3.8. The Brain metric engine recomputes from
-- facts in parallel; a parity report compares against these aggregates.
CREATE TABLE IF NOT EXISTS brain.workspace_daily_metrics_legacy (
    workspace_id              String          NOT NULL,
    date                      Date            NOT NULL,
    net_sales_mu              Int64           NOT NULL,
    gross_sales_mu            Int64           NOT NULL,
    total_tax_mu              Int64           NOT NULL,
    total_discount_mu         Int64           NOT NULL,
    orders_count              Int32           NOT NULL,
    aov_mu                    Int64           NOT NULL,
    currency_code             LowCardinality(String) NOT NULL,
    cogs_mu                   Int64           NOT NULL,
    shipping_mu               Int64           NOT NULL,
    packaging_mu              Int64           NOT NULL,
    website_charges_mu        Int64           NOT NULL,
    cm1_mu                    Int64           NOT NULL,
    meta_ad_spend_mu          Int64           NOT NULL,
    google_ad_spend_mu        Int64           NOT NULL,
    total_ad_spend_mu         Int64           NOT NULL,
    cm2_mu                    Int64           NOT NULL,
    misc_expenses_prorated_mu Int64           NOT NULL,
    cm3_mu                    Int64           NOT NULL,
    acos_bp                   Nullable(Int32),
    blended_roas_x100         Nullable(Int32),
    sessions                  Nullable(Int32),
    conversion_rate_bp        Nullable(Int32),
    rto_orders                Nullable(Int32),
    rto_value_mu              Nullable(Int64),
    rto_percent_bp            Nullable(Int32),
    rto_mapped                Nullable(Int32),
    rto_unmapped              Nullable(Int32),
    total_shipments           Nullable(Int32),
    prepaid_orders_count      Nullable(Int32),
    prepaid_percentage_bp     Nullable(Int32),
    version                   UInt64          NOT NULL,
    ingested_at               DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, date);

CREATE TABLE IF NOT EXISTS brain.shopify_analytics_daily (
    workspace_id        String          NOT NULL,
    shop_domain         LowCardinality(String) NOT NULL,
    date                Date            NOT NULL,
    net_sales_mu        Int64           NOT NULL,
    gross_sales_mu      Int64           NOT NULL,
    orders_count        Int32           NOT NULL,
    aov_mu              Int64           NOT NULL,
    total_tax_mu        Int64           NOT NULL,
    total_discount_mu   Int64           NOT NULL,
    currency_code       LowCardinality(String) NOT NULL,
    conversion_rate_bp  Nullable(Int32),
    sessions            Nullable(Int32),
    returns_mu          Nullable(Int64),
    total_returns_mu    Nullable(Int64),
    version             UInt64          NOT NULL,
    ingested_at         DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, shop_domain, date);

CREATE TABLE IF NOT EXISTS brain.product_daily_aggregates (
    workspace_id      String          NOT NULL,
    vendor            LowCardinality(String) NOT NULL,
    vendor_product_id String          NOT NULL,
    date              Date            NOT NULL,
    quantity_sold     Int32           NOT NULL,
    gross_sales_mu    Int64           NOT NULL,
    orders_count      Int32           NOT NULL,
    version           UInt64          NOT NULL,
    ingested_at       DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, vendor_product_id, date);

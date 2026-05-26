-- @paradigm: sql
-- C2 — Line item facts (per-SKU). order_date denormalized for partitioning + locality.
-- Plan: docs/data-architecture-plan-v2.md §3.3.
CREATE TABLE IF NOT EXISTS brain.connector_line_item_facts (
    workspace_id        String          NOT NULL,
    vendor              LowCardinality(String) NOT NULL,
    vendor_order_id     String          NOT NULL,
    vendor_line_id      String          NOT NULL,
    vendor_product_id   String,
    vendor_variant_id   String,
    sku                 String,
    title               String,
    quantity            Int32           DEFAULT 0,
    price_mu            Int64           DEFAULT 0,
    line_total_mu       Int64           DEFAULT 0,
    discount_mu         Int64           DEFAULT 0,
    tax_mu              Int64           DEFAULT 0,
    cogs_mu             Int64           DEFAULT 0,
    currency_code       LowCardinality(String) NOT NULL,
    order_date          Date            NOT NULL,
    version             UInt64          NOT NULL,
    ingested_at         DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_order_id, vendor_line_id)
SETTINGS index_granularity = 8192;

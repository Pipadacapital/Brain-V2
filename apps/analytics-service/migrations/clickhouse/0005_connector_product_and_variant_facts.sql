-- @paradigm: sql
-- C3, C4 — product + variant facts. Catalog isn't time-series; synced_date is a
-- partition pseudo-date (one partition per month of sync). Plan: v2 §3.4.
CREATE TABLE IF NOT EXISTS brain.connector_product_facts (
    workspace_id        String          NOT NULL,
    vendor              LowCardinality(String) NOT NULL,
    vendor_product_id   String          NOT NULL,
    sku                 String,
    title               String,
    handle              String,
    image_url           String,
    cost_mu             Int64           DEFAULT 0,
    mrp_mu              Int64           DEFAULT 0,
    inventory_qty       Int32,
    tags                Array(String)   DEFAULT [],
    currency_code       LowCardinality(String),
    synced_date         Date            DEFAULT today(),
    version             UInt64          NOT NULL,
    ingested_at         DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(synced_date)
ORDER BY (workspace_id, vendor, vendor_product_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS brain.connector_variant_facts (
    workspace_id           String          NOT NULL,
    vendor                 LowCardinality(String) NOT NULL,
    vendor_variant_id      String          NOT NULL,
    vendor_product_id      String          NOT NULL,
    sku                    String,
    title                  String,
    price_mu               Int64           DEFAULT 0,
    compare_at_price_mu    Int64           DEFAULT 0,
    inventory_qty          Int32,
    synced_date            Date            DEFAULT today(),
    version                UInt64          NOT NULL,
    ingested_at            DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(synced_date)
ORDER BY (workspace_id, vendor, vendor_variant_id)
SETTINGS index_granularity = 8192;

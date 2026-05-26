-- @paradigm: sql
-- C8, C9, C10 — shipment + refund + logistics-order facts.
-- Plan: docs/data-architecture-plan-v2.md §3.6.
CREATE TABLE IF NOT EXISTS brain.connector_shipment_facts (
    workspace_id            String          NOT NULL,
    vendor                  LowCardinality(String) NOT NULL,
    vendor_shipment_id      String          NOT NULL,
    vendor_order_id         String,
    status                  LowCardinality(String),
    courier_name            LowCardinality(String),
    delivery_pincode        LowCardinality(String),
    is_rto                  UInt8,
    shipped_at              Nullable(DateTime),
    delivered_at            Nullable(DateTime),
    rto_at                  Nullable(DateTime),
    date                    Date            NOT NULL,
    version                 UInt64          NOT NULL,
    ingested_at             DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, vendor_shipment_id);

-- Refund grain is per LINE (matches legacy shopify_refund_line_items + PG connector_refund_facts).
-- ORDER BY includes vendor_refund_line_id so multiple lines per refund don't dedupe.
CREATE TABLE IF NOT EXISTS brain.connector_refund_facts (
    workspace_id          String          NOT NULL,
    vendor                LowCardinality(String) NOT NULL,
    vendor_refund_id      String          NOT NULL,
    vendor_refund_line_id String          NOT NULL,
    vendor_order_id       String,
    vendor_product_id     String,
    sku                   String,
    quantity              Int32           DEFAULT 0,
    refund_amount_mu      Int64           DEFAULT 0,
    tax_mu                Int64           DEFAULT 0,
    currency_code         LowCardinality(String) NOT NULL,
    date                  Date            NOT NULL,
    version               UInt64          NOT NULL,
    ingested_at           DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, vendor_refund_id, vendor_refund_line_id);

CREATE TABLE IF NOT EXISTS brain.connector_logistics_order_facts (
    workspace_id                String          NOT NULL,
    vendor                      LowCardinality(String) NOT NULL,
    vendor_logistics_order_id   String          NOT NULL,
    channel_order_id            String,
    channel_name                LowCardinality(String),
    status                      LowCardinality(String),
    payment_method              LowCardinality(String),
    total_mu                    Int64           DEFAULT 0,
    currency_code               LowCardinality(String) NOT NULL,
    order_date                  Date            NOT NULL,
    version                     UInt64          NOT NULL,
    ingested_at                 DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_logistics_order_id);

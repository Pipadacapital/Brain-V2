-- @paradigm: sql
-- C1 — Order facts (header). workspace_id LEADING; ReplacingMergeTree(version) for
-- idempotent re-ingest; Int64 minor units; LowCardinality on vendor/currency/status.
-- Reads through the gateway add FINAL for ReplacingMergeTree dedup semantics.
-- Plan: docs/data-architecture-plan-v2.md §3.2.
CREATE TABLE IF NOT EXISTS brain.connector_order_facts (
    workspace_id        String          NOT NULL,
    vendor              LowCardinality(String) NOT NULL,
    vendor_order_id     String          NOT NULL,
    order_date          Date            NOT NULL,
    placed_at           DateTime64(3, 'UTC'),
    customer_ref        String,
    delivery_pincode    LowCardinality(String),
    delivery_city       LowCardinality(String),
    gross_sales_mu      Int64           DEFAULT 0,
    discount_mu         Int64           DEFAULT 0,
    tax_mu              Int64           DEFAULT 0,
    shipping_mu         Int64           DEFAULT 0,
    net_sales_mu        Int64           DEFAULT 0,
    total_refund_mu     Int64           DEFAULT 0,
    currency_code       LowCardinality(String) NOT NULL,
    payment_method      LowCardinality(String),
    is_cod              UInt8,
    order_type          LowCardinality(String),
    financial_status    LowCardinality(String),
    fulfillment_status  LowCardinality(String),
    tags                Array(String)   DEFAULT [],
    version             UInt64          NOT NULL,
    ingested_at         DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_order_id)
SETTINGS index_granularity = 8192;

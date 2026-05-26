-- @paradigm: sql
-- C11 — email/SMS send-day grain (Klaviyo today; future Mailchimp etc.).
-- Plan: docs/data-architecture-plan-v2.md §3.7.
CREATE TABLE IF NOT EXISTS brain.connector_email_send_facts (
    workspace_id          String          NOT NULL,
    vendor                LowCardinality(String) NOT NULL,
    source_type           LowCardinality(String) NOT NULL,
    vendor_resource_id    String          NOT NULL,
    name                  String,
    channel               LowCardinality(String),
    send_date             Date            NOT NULL,
    delivered             Int32           DEFAULT 0,
    unique_opens          Int32           DEFAULT 0,
    unique_clicks         Int32           DEFAULT 0,
    orders                Int32           DEFAULT 0,
    revenue_mu            Int64           DEFAULT 0,
    currency_code         LowCardinality(String),
    unsubscribes          Int32           DEFAULT 0,
    spam_complaints       Int32           DEFAULT 0,
    version               UInt64          NOT NULL,
    ingested_at           DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(send_date)
ORDER BY (workspace_id, vendor, source_type, vendor_resource_id, send_date);

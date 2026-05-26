-- @paradigm: sql
-- C5, C6, C7 — ad spend (campaign-day) + ad creative (ad-day) + ad funnel (stage-day).
-- avg_watch_sec_x100 stored as Int32 × 100; conversions_x1000 as Int64 × 1000.
-- Plan: docs/data-architecture-plan-v2.md §3.5.
CREATE TABLE IF NOT EXISTS brain.connector_ad_spend_facts (
    workspace_id    String          NOT NULL,
    vendor          LowCardinality(String) NOT NULL,
    ad_account_id   String          NOT NULL,
    campaign_id     String          NOT NULL,
    campaign_name   String,
    date            Date            NOT NULL,
    impressions     Int64           DEFAULT 0,
    clicks          Int64           DEFAULT 0,
    spend_mu        Int64           DEFAULT 0,
    conversions     Int32           DEFAULT 0,
    revenue_mu      Int64           DEFAULT 0,
    currency_code   LowCardinality(String) NOT NULL,
    version         UInt64          NOT NULL,
    ingested_at     DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, ad_account_id, campaign_id, date);

CREATE TABLE IF NOT EXISTS brain.connector_ad_creative_facts (
    workspace_id        String          NOT NULL,
    vendor              LowCardinality(String) NOT NULL,
    ad_account_id       String          NOT NULL,
    ad_id               String          NOT NULL,
    ad_name             String,
    campaign_id         String,
    adset_id            String,
    date                Date            NOT NULL,
    impressions         Int64           DEFAULT 0,
    clicks              Int64           DEFAULT 0,
    spend_mu            Int64           DEFAULT 0,
    video_thruplay      Int32           DEFAULT 0,
    avg_watch_sec_x100  Int32           DEFAULT 0,
    video_p25           Int32           DEFAULT 0,
    video_p50           Int32           DEFAULT 0,
    video_p75           Int32           DEFAULT 0,
    video_p95           Int32           DEFAULT 0,
    conversions         Int32           DEFAULT 0,
    revenue_mu          Int64           DEFAULT 0,
    currency_code       LowCardinality(String) NOT NULL,
    version             UInt64          NOT NULL,
    ingested_at         DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, ad_account_id, ad_id, date);

CREATE TABLE IF NOT EXISTS brain.connector_ad_funnel_facts (
    workspace_id         String          NOT NULL,
    vendor               LowCardinality(String) NOT NULL,
    customer_id          String          NOT NULL,
    campaign_id          String          NOT NULL,
    date                 Date            NOT NULL,
    stage                LowCardinality(String) NOT NULL,
    conversions_x1000    Int64           DEFAULT 0,
    conversion_value_mu  Int64           DEFAULT 0,
    currency_code        LowCardinality(String) NOT NULL,
    version              UInt64          NOT NULL,
    ingested_at          DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, customer_id, campaign_id, date, stage);

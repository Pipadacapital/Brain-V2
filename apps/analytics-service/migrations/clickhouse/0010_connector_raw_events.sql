-- @paradigm: sql
-- 0010 — Generic raw-events store for ALL integrations (Founder direction
-- 2026-05-26 — design for 100+ future integrations).
--
-- Every integration's poll/webhook writes here FIRST, with the original JSON
-- payload preserved. The vendor-agnostic transform layer reads from here and
-- derives the typed facts (connector_order_facts, connector_ad_spend_facts,
-- etc.). New integrations add only a new transform — no schema migration.
--
-- Why ClickHouse and not Postgres?
--   • Append-heavy, read-rarely (transforms scan, humans don't query raw).
--   • JSON column compresses excellently with ZSTD.
--   • workspace_id LEADING so per-tenant isolation + locality.
--   • TTL-friendly when we later add lifecycle policy (e.g., 90d raw retention).
--
-- Plan: docs/data-architecture-plan-v2.md §7 (Integration registry — extensibility).

CREATE TABLE IF NOT EXISTS brain.connector_raw_events (
    workspace_id      String                  NOT NULL,
    vendor            LowCardinality(String)  NOT NULL,   -- 'SHOPIFY','META',… open-ended
    event_type        LowCardinality(String)  NOT NULL,   -- 'order.created', 'campaign.daily', 'shipment.update'
    idempotency_key   String                  NOT NULL,   -- vendor's unique id (order_id, ad_account+date+campaign, …)
    received_at       DateTime64(3, 'UTC')    NOT NULL,   -- when Brain ingested it
    event_at          Nullable(DateTime64(3, 'UTC')),     -- vendor's own timestamp (when the event happened)
    payload           String                  NOT NULL,   -- raw JSON (compressed with ZSTD)
    payload_version   LowCardinality(String)  DEFAULT '', -- vendor's payload schema version (e.g. 'shopify-2024-10')
    transform_status  LowCardinality(String)  DEFAULT 'pending',  -- 'pending'|'processed'|'errored'|'skipped'
    transform_error   String                  DEFAULT '',
    version           UInt64                  NOT NULL,   -- monotonic for ReplacingMergeTree dedupe
    ingested_at       DateTime                DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(received_at)
ORDER BY (workspace_id, vendor, event_type, idempotency_key)
SETTINGS index_granularity = 8192;

-- Index on transform_status so the transform worker can quickly find pending rows.
ALTER TABLE brain.connector_raw_events
  ADD INDEX IF NOT EXISTS idx_transform_status (transform_status) TYPE set(8) GRANULARITY 4;

-- Index on event_at for time-range scans during re-ingestion / backfills.
ALTER TABLE brain.connector_raw_events
  ADD INDEX IF NOT EXISTS idx_event_at (event_at) TYPE minmax GRANULARITY 4;

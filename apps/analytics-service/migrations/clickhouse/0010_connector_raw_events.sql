-- @paradigm: sql
-- 0010 — Generic raw-events store for ALL integrations (Founder direction
-- 2026-05-26 — design for 100+ future integrations).
--
-- Every integration's poll/webhook writes here FIRST, with the original JSON
-- payload preserved. The vendor-agnostic transform layer reads from here and
-- derives the typed facts (connector_order_facts, connector_ad_spend_facts,
-- etc.). New integrations add only a new transform — no schema migration.
--
-- APPEND-ONLY (ADR-CONVERGENCE-001 finding B): this is a MergeTree, not a
-- ReplacingMergeTree, and it carries NO mutable transform_status column.
-- ClickHouse has no in-place UPDATE; a mutable status flag + ReplacingMergeTree
-- forces the transform worker to either re-process already-done events (it can't
-- see the not-yet-merged 'processed' version) or pay FINAL on every poll (too slow
-- as a work-queue). Transform-worker CURSOR state therefore lives in Postgres
-- (public.raw_event_transform_state — core-service migration 28), and this table
-- stays a pure append log. Re-delivered events append a second row (distinct by
-- received_at in the ORDER BY); the typed fact tables dedup idempotently on their
-- business key, so the raw log does not need dedup.
--
-- Why ClickHouse: append-heavy, read-by-transform-only, JSON compresses with ZSTD,
-- workspace_id LEADING for per-tenant locality, TTL-friendly for later raw retention.
--
-- Plan: docs/data-architecture-plan-v2.md §7 + docs/adr-convergence-001-schema-100-integrations.md.

CREATE TABLE IF NOT EXISTS brain.connector_raw_events (
    workspace_id      String                  NOT NULL,
    vendor            LowCardinality(String)  NOT NULL,   -- 'SHOPIFY','META',… open-ended
    event_type        LowCardinality(String)  NOT NULL,   -- 'order.created', 'campaign.daily', 'shipment.update'
    idempotency_key   String                  NOT NULL,   -- vendor's unique id (order_id, ad_account+date+campaign, …)
    received_at       DateTime64(3, 'UTC')    NOT NULL,   -- when Brain ingested it
    event_at          Nullable(DateTime64(3, 'UTC')),     -- vendor's own timestamp (when the event happened)
    payload           String                  NOT NULL,   -- raw JSON (compressed with ZSTD)
    payload_version   LowCardinality(String)  DEFAULT '', -- vendor's payload schema version (e.g. 'shopify-2024-10')
    ingested_at       DateTime                DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(received_at)
ORDER BY (workspace_id, vendor, event_type, idempotency_key, received_at)
SETTINGS index_granularity = 8192;

-- Index on event_at for time-range scans during re-ingestion / backfills.
ALTER TABLE brain.connector_raw_events
  ADD INDEX IF NOT EXISTS idx_event_at (event_at) TYPE minmax GRANULARITY 4;

-- NOTE: transform progress is NOT tracked here. The worker reads
--   WHERE received_at > <cursor.last_processed_received_at>
-- where the cursor lives in Postgres public.raw_event_transform_state.

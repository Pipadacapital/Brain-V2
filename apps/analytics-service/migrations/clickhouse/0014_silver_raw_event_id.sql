-- @paradigm: sql
-- 0014 — Silver facts: add raw_event_id + provenance columns (P1-B provenance).
--
-- R11/R12 from data-warehouse-architecture-proposal.md:
--   raw_event_id: the idempotency_key from the bronze row that produced this silver
--                 fact.  Makes every silver row traceable back to a raw payload.
--                 Legacy rows (pre-bronze ETL) carry NULL.
--   provenance:   'transform_worker' for rows produced by the P1-B graduation
--                 worker; 'legacy_etl' for the 83k rows that were ETL'd directly.
--                 LowCardinality is near-free; a column filter is O(1).
--
-- Applied to: connector_order_facts, connector_line_item_facts,
--             connector_ad_spend_facts (the three silver tables the transform
--             worker writes to in Phase-1).  Additional tables added when their
--             mappers land.
--
-- Migration safety:
--   - ADD COLUMN … DEFAULT '' / 'legacy_etl' is additive and nullable-safe.
--     Existing rows get the default value; no SELECT breaks.
--   - Reversible via down.sql (DROP COLUMN).
--   - raw_event_id is String (nullable-safe empty default); not a FK because
--     bronze is a CH append-only table with no enforcement mechanism.

-- connector_order_facts
ALTER TABLE brain.connector_order_facts
    ADD COLUMN IF NOT EXISTS raw_event_id  String                   DEFAULT '',
    ADD COLUMN IF NOT EXISTS provenance    LowCardinality(String)   DEFAULT 'legacy_etl';

-- connector_line_item_facts (if it exists)
ALTER TABLE brain.connector_line_item_facts
    ADD COLUMN IF NOT EXISTS raw_event_id  String                   DEFAULT '',
    ADD COLUMN IF NOT EXISTS provenance    LowCardinality(String)   DEFAULT 'legacy_etl';

-- connector_ad_spend_facts (if it exists)
ALTER TABLE brain.connector_ad_spend_facts
    ADD COLUMN IF NOT EXISTS raw_event_id  String                   DEFAULT '',
    ADD COLUMN IF NOT EXISTS provenance    LowCardinality(String)   DEFAULT 'legacy_etl';

-- Bloom-filter index on raw_event_id so "find all silver from bronze row X" is fast.
ALTER TABLE brain.connector_order_facts
    ADD INDEX IF NOT EXISTS idx_raw_event_id (raw_event_id) TYPE bloom_filter(0.01) GRANULARITY 4;

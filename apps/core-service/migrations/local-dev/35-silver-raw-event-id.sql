-- =============================================================================
-- 35 — silver facts: raw_event_id + provenance (P1-B provenance columns).
--
-- Adds two columns to the PG hot-mirror fact tables so every silver row
-- produced by the transform-graduation worker can be traced back to the
-- bronze row that produced it.
--
-- raw_event_id: the idempotency_key of the source bronze row (NULL for legacy).
-- provenance:   'transform_worker' or 'legacy_etl' (NULL-safe; default legacy).
--
-- Migration safety: additive, nullable-safe, reversible via down.sql.
-- =============================================================================

-- Note: the PG hot-mirror is connector_order_facts_hot (underlying table of the
-- connector_order_facts view created by the architecture restructure).
ALTER TABLE connector_order_facts_hot
    ADD COLUMN IF NOT EXISTS raw_event_id  TEXT        DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS provenance    TEXT        DEFAULT 'legacy_etl';

CREATE INDEX IF NOT EXISTS connector_order_facts_hot_raw_event_id_idx
    ON connector_order_facts_hot (raw_event_id)
    WHERE raw_event_id IS NOT NULL;

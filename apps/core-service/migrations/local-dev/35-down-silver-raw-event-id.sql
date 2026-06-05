-- 35 DOWN — remove raw_event_id + provenance from PG hot-mirror.

DROP INDEX IF EXISTS connector_order_facts_hot_raw_event_id_idx;

ALTER TABLE connector_order_facts_hot
    DROP COLUMN IF EXISTS raw_event_id,
    DROP COLUMN IF EXISTS provenance;

-- @paradigm: sql
-- 0014 DOWN — remove raw_event_id + provenance from silver facts.

ALTER TABLE brain.connector_order_facts
    DROP INDEX IF EXISTS idx_raw_event_id;

ALTER TABLE brain.connector_order_facts
    DROP COLUMN IF EXISTS raw_event_id,
    DROP COLUMN IF EXISTS provenance;

ALTER TABLE brain.connector_line_item_facts
    DROP COLUMN IF EXISTS raw_event_id,
    DROP COLUMN IF EXISTS provenance;

ALTER TABLE brain.connector_ad_spend_facts
    DROP COLUMN IF EXISTS raw_event_id,
    DROP COLUMN IF EXISTS provenance;

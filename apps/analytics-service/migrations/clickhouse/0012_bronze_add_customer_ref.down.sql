-- @paradigm: sql
-- 0012 DOWN — revert customer_ref, lawful_basis, purpose_code columns from bronze.
--
-- Rollback: flag PII_TOKENIZER OFF first (reverts to passthrough).
-- Then apply this down.sql to remove the columns.
-- Safe only pre-go-live — never with live PII already landed in these columns.

ALTER TABLE brain.connector_raw_events
    DROP INDEX IF EXISTS idx_customer_ref;

ALTER TABLE brain.connector_raw_events
    DROP COLUMN IF EXISTS purpose_code,
    DROP COLUMN IF EXISTS lawful_basis,
    DROP COLUMN IF EXISTS customer_ref;

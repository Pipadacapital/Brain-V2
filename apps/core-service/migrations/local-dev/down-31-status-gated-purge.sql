-- =============================================================================
-- Rollback for 31-status-gated-purge.sql
-- Drops the nightly PII purge infrastructure.
-- Data NOT restored: nulled PII columns cannot be recovered from this migration
-- alone (restore from vendor API or legacy raw tables if needed).
-- =============================================================================

DROP PROCEDURE IF EXISTS run_nightly_pii_purge(INT);
DROP FUNCTION IF EXISTS purge_closed_order_pii(UUID, INT);
DROP FUNCTION IF EXISTS is_order_pii_purgeable(TEXT, TEXT, TIMESTAMPTZ);
DROP TABLE IF EXISTS pii_purge_log;

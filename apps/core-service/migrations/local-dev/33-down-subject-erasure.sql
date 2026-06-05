-- =============================================================================
-- 33-down — Reverse 33-subject-erasure.sql (P0-D rollback)
--
-- CAUTION: this down migration is only valid to run in dev/test environments
-- BEFORE any real erasure requests have been processed. In production, subject
-- erasure records and the WORM key-destruction ledger are permanent legal
-- evidence; dropping them would destroy the DPDP §12 compliance record.
--
-- The ERASURE_ORCHESTRATOR feature flag MUST be OFF before running this down.
-- =============================================================================

-- Drop the WORM trigger + function first (before dropping the table).
DROP TRIGGER IF EXISTS kdl_worm_guard ON key_destruction_ledger;
DROP FUNCTION IF EXISTS key_destruction_ledger_worm_guard();

-- Drop the ledger (must come before subject_erasure_request due to FK).
DROP TABLE IF EXISTS key_destruction_ledger;

-- Drop the erasure request table.
DROP TABLE IF EXISTS subject_erasure_request;

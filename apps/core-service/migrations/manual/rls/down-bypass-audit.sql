-- =============================================================================
-- ROLLBACK: bypass_query_log — symmetric down for step-c-bypass-audit.sql
-- @paradigm sql
--
-- CF-CUT-ROLLBACK-ATOMIC-1 (BINDING ORDERING):
--   Run THIS FILE FIRST (drops policies + DROP TABLE).
--   Run bypass-revoke SECOND: ALTER ROLE "<legacy_rolname>" NOBYPASSRLS
--
-- WRONG order = 0-row outage window for the legacy app:
--   If bypass is revoked BEFORE this file drops the FORCE'd policies, the legacy
--   postgres.<tenant> role loses bypass while FORCE is still on → 0 rows returned
--   on every query until down.sql also runs. Captured as G3.kill in staging-rehearsal/.
--
-- Idempotent: DROP POLICY IF EXISTS + DROP TABLE IF EXISTS
--
-- Usage:
--   Step 1: psql "$DIRECT_URL" --file down.sql          (drops main 44-table policies)
--   Step 2: psql "$DIRECT_URL" --file down-bypass-audit.sql   (drops bypass_query_log)
--   Step 3: psql "$DIRECT_URL" -c "ALTER ROLE \"$LEGACY_ROLNAME\" NOBYPASSRLS"
--
-- Note: down.sql (the main rollback for all 44 tables) runs BEFORE this file.
-- This file handles ONLY the bypass_query_log table added in step-c-bypass-audit.sql.
-- =============================================================================

-- Drop policies first (required before DROP TABLE on an RLS-enabled table)
DROP POLICY IF EXISTS ws_isolation          ON bypass_query_log;
DROP POLICY IF EXISTS superadmin_system_rows ON bypass_query_log;

-- Drop table and all dependent indexes (CASCADE covers the three indexes)
DROP TABLE IF EXISTS bypass_query_log CASCADE;

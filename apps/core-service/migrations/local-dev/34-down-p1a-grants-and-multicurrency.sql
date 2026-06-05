-- =============================================================================
-- 34-down-p1a-grants-and-multicurrency.sql — Down/rollback for 34-p1a.sql
--
-- Reverses P1-A ruling 3 (ALTER DEFAULT PRIVILEGES) and ruling G
-- (multi-currency CM guard column on workspaces).
--
-- @paradigm: sql
-- =============================================================================

BEGIN;

-- Reverse ruling G: drop multi_currency_blocked column.
ALTER TABLE workspaces
  DROP COLUMN IF EXISTS multi_currency_blocked;

-- Reverse ruling 3: revoke default privileges added in 34-p1a.
-- Note: rls_app per-table grants from earlier migrations are NOT reverted here;
-- only the ALTER DEFAULT PRIVILEGES grants are rolled back.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT ON TABLES FROM rls_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM postgres;

COMMIT;

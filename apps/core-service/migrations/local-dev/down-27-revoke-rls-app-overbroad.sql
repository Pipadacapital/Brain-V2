-- Reverse of 27-revoke-rls-app-overbroad.sql — restore rls_app's grants
-- (rollback the A4b activation). Mirrors 01-create-rls-app-role.sql's defaults.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rls_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rls_app;

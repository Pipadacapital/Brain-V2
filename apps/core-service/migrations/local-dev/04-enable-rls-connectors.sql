-- =============================================================================
-- LOCAL-DEV — ENABLE + FORCE RLS on the three slice-D connector tables.
--
-- Slice D (live integrations OAuth + custody). Same fail-closed RLS shape as
-- slice C / Child-1 (CF-C1-RLS-DEFAULT-1.a). FORCE applied immediately — the local
-- dev DB has NO legacy writers; every write goes through withWorkspace/withSuperadmin.
--
-- Policy shapes (BANNED: OR..IS NULL · COALESCE · USING(true) · session SET):
--   connector_connections / connector_credentials / connector_oauth_states —
--     workspace_id-leading ws_isolation: a context-less or cross-workspace read
--     returns 0 rows (fail-closed). The OAuth token blob is therefore unreadable
--     except inside the owning workspace's context.
--   PLUS a superadmin_rows policy on each so the callback path may create/validate
--     the oauth-state row BEFORE the workspace context is re-established at the
--     redirect (the state_hash lookup is the sanctioned no-context path — exactly
--     the slice-C invitation-accept-by-token pattern; the SQL is scoped to the
--     unguessable state_hash, superadmin context does NOT mean "return everything").
--
-- NULLIF(current_setting('app.workspace_id', true), '')::uuid : empty GUC → NULL →
--   0 rows (fail-closed), never a cast error.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- connector_connections — workspace_id-leading ws_isolation + superadmin.
-- ---------------------------------------------------------------------------
ALTER TABLE connector_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_connections;
CREATE POLICY ws_isolation ON connector_connections
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS superadmin_rows ON connector_connections;
CREATE POLICY superadmin_rows ON connector_connections
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
ALTER TABLE connector_connections FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- connector_credentials — the custody store. SAME ws_isolation shape: the
-- encrypted token blob is readable ONLY inside the owning workspace's context.
-- ---------------------------------------------------------------------------
ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_credentials;
CREATE POLICY ws_isolation ON connector_credentials
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS superadmin_rows ON connector_credentials;
CREATE POLICY superadmin_rows ON connector_credentials
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
ALTER TABLE connector_credentials FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- connector_oauth_states — ws_isolation + superadmin (callback no-context lookup).
-- ---------------------------------------------------------------------------
ALTER TABLE connector_oauth_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_oauth_states;
CREATE POLICY ws_isolation ON connector_oauth_states
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS superadmin_rows ON connector_oauth_states;
CREATE POLICY superadmin_rows ON connector_oauth_states
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
ALTER TABLE connector_oauth_states FORCE ROW LEVEL SECURITY;

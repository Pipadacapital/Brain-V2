-- =============================================================================
-- LOCAL-DEV — ENABLE + FORCE RLS on the four onboarding/membership tables.
--
-- Slice C (feat-onboarding-membership-db). Applies the SAME fail-closed RLS shape
-- Child-1 codified (CF-C1-RLS-DEFAULT-1.a) to the freshly-created local tables.
--
-- Unlike the live/legacy cutover (where FORCE is HELD at Stage 8 behind the
-- HOLD-AT-FORCE runbook because legacy sync paths still write context-less), the
-- LOCAL DEV DB has NO legacy writers — every write goes through the Brain-native
-- withWorkspace/withSuperadmin primitive. So FORCE is applied immediately here:
-- the local DB proves fail-closed at the wire from the first migration, which is
-- the whole point of slice C's RLS verification gate.
--
-- Policy shapes (BANNED: OR..IS NULL · COALESCE · USING(true) · session SET):
--   workspace_members / invitations — workspace_id-leading ws_isolation.
--   workspaces — visible only inside its own id context (id = app.workspace_id).
--     PLUS a superadmin policy so onboarding (withSuperadmin) can INSERT a new
--     workspace row before any context exists for it.
--   users — superadmin-only policy (no workspace_id; user rows are managed on the
--     system path keyed by the verified sub). A context-less / non-superadmin
--     connection sees 0 user rows → fail-closed.
--
-- NULLIF(current_setting('app.workspace_id', true), '')::uuid : empty GUC → NULL →
--   0 rows (fail-closed), never a cast error. Identical to pool-isolation.test.ts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users — superadmin-managed (system path). Fail-closed for any non-superadmin
-- context-less connection.
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS superadmin_only ON users;
CREATE POLICY superadmin_only ON users
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- workspaces — own-id context policy + superadmin policy (onboarding insert).
-- ---------------------------------------------------------------------------
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_self_isolation ON workspaces;
CREATE POLICY ws_self_isolation ON workspaces
  USING      (id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS superadmin_rows ON workspaces;
CREATE POLICY superadmin_rows ON workspaces
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- workspace_members — workspace_id-leading ws_isolation + superadmin policy.
-- The superadmin policy lets onboarding (withSuperadmin) create the OWNER row in
-- the same no-context transaction as the workspace, and lets DbMembershipResolver
-- enumerate a user's memberships across workspaces (the sanctioned cross-workspace
-- read path, filtered by user_id in SQL).
-- ---------------------------------------------------------------------------
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON workspace_members;
CREATE POLICY ws_isolation ON workspace_members
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS superadmin_rows ON workspace_members;
CREATE POLICY superadmin_rows ON workspace_members
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
ALTER TABLE workspace_members FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- invitations — workspace_id-leading ws_isolation + superadmin policy.
-- The superadmin policy lets /invite/[token] accept look up an invitation by its
-- unguessable token BEFORE the joining user is a member (no workspace context yet),
-- then perform the scoped accept under withWorkspace(invitation.workspace_id).
-- ---------------------------------------------------------------------------
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON invitations;
CREATE POLICY ws_isolation ON invitations
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS superadmin_rows ON invitations;
CREATE POLICY superadmin_rows ON invitations
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

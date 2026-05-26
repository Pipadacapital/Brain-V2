-- =============================================================================
-- Phase 1 — RLS for D16..D19 app data.
-- notifications + audit_log use the SANCTIONED ws_or_user_isolation pattern
-- (workspace_id is nullable for system/legal events). The static gate must
-- whitelist this exact pattern for these two tables only:
--   - both halves carry an '=' predicate (no IS-NULL-as-pass-through), so
--     a context-less connection still returns 0 rows (fail-closed under NULLIF).
--   - depends on the session GUC `app.user_id` (Brain primitive to plumb).
-- ai_insights + marketing_actions use standard ws_isolation.
-- =============================================================================

-- D16 — notifications: ws_or_user_isolation (documented exception)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_or_user_isolation ON notifications;
CREATE POLICY ws_or_user_isolation ON notifications
  USING      ((workspace_id IS NOT NULL
               AND workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
              OR
              (workspace_id IS NULL
               AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK ((workspace_id IS NOT NULL
               AND workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
              OR
              (workspace_id IS NULL
               AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

-- D17 — ai_insights: standard ws_isolation
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON ai_insights;
CREATE POLICY ws_isolation ON ai_insights
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE ai_insights FORCE ROW LEVEL SECURITY;

-- D18 — marketing_actions: standard ws_isolation
ALTER TABLE marketing_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON marketing_actions;
CREATE POLICY ws_isolation ON marketing_actions
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE marketing_actions FORCE ROW LEVEL SECURITY;

-- D19 — audit_log: ws_or_user_isolation (documented exception, same justification)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_or_user_isolation ON audit_log;
CREATE POLICY ws_or_user_isolation ON audit_log
  USING      ((workspace_id IS NOT NULL
               AND workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
              OR
              (workspace_id IS NULL
               AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK ((workspace_id IS NOT NULL
               AND workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
              OR
              (workspace_id IS NULL
               AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

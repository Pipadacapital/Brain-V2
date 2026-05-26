-- =============================================================================
-- Phase 1 — RLS for D6/D7a/D7b. All ws_isolation, fail-closed.
-- =============================================================================
ALTER TABLE connector_email_send_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_email_send_facts;
CREATE POLICY ws_isolation ON connector_email_send_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE connector_email_send_facts FORCE ROW LEVEL SECURITY;

ALTER TABLE connector_ad_creative_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_ad_creative_facts;
CREATE POLICY ws_isolation ON connector_ad_creative_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE connector_ad_creative_facts FORCE ROW LEVEL SECURITY;

ALTER TABLE connector_ad_funnel_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_ad_funnel_facts;
CREATE POLICY ws_isolation ON connector_ad_funnel_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE connector_ad_funnel_facts FORCE ROW LEVEL SECURITY;

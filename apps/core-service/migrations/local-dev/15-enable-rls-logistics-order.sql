-- =============================================================================
-- Phase 1 — RLS for connector_logistics_order_facts (ws_isolation, fail-closed).
-- =============================================================================
ALTER TABLE connector_logistics_order_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_logistics_order_facts;
CREATE POLICY ws_isolation ON connector_logistics_order_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE connector_logistics_order_facts FORCE ROW LEVEL SECURITY;

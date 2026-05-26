-- =============================================================================
-- Phase 1 — RLS for connector_variant_facts (ws_isolation, fail-closed).
-- Existing facts (connector_product_facts/order_facts/refund_facts) already have RLS
-- enabled by 04 + 06; the additive columns inherit those policies.
-- =============================================================================
ALTER TABLE connector_variant_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_variant_facts;
CREATE POLICY ws_isolation ON connector_variant_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE connector_variant_facts FORCE ROW LEVEL SECURITY;

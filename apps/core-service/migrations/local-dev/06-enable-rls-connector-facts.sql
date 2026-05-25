-- =============================================================================
-- LOCAL-DEV — ENABLE + FORCE RLS on the four slice-E connector-fact tables.
--
-- Same fail-closed RLS shape as slices C/D + Child-1 (CF-C1-RLS-DEFAULT-1.a).
-- FORCE applied immediately — the local dev DB has NO legacy writers; every read/
-- write goes through withWorkspace. (Persona P-003: cross-tenant isolation once ≥2
-- workspaces have synced facts.)
--
-- Policy shape (BANNED: OR..IS NULL · COALESCE · USING(true) · session SET):
--   workspace_id-leading ws_isolation — a context-less or cross-workspace read
--   returns 0 rows (fail-closed). NULLIF(current_setting('app.workspace_id', true),
--   '')::uuid : empty GUC → NULL → 0 rows (never a cast error).
--
-- NO superadmin policy here — the analytics facts are ALWAYS read inside a workspace
-- context (withWorkspace); there is no sanctioned no-context path for facts (unlike
-- the slice-D oauth-state callback lookup). Facts are workspace-only.
-- =============================================================================

ALTER TABLE connector_order_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_order_facts;
CREATE POLICY ws_isolation ON connector_order_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE connector_order_facts FORCE ROW LEVEL SECURITY;

ALTER TABLE connector_line_item_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_line_item_facts;
CREATE POLICY ws_isolation ON connector_line_item_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE connector_line_item_facts FORCE ROW LEVEL SECURITY;

ALTER TABLE connector_product_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_product_facts;
CREATE POLICY ws_isolation ON connector_product_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE connector_product_facts FORCE ROW LEVEL SECURITY;

ALTER TABLE connector_ad_spend_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_ad_spend_facts;
CREATE POLICY ws_isolation ON connector_ad_spend_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE connector_ad_spend_facts FORCE ROW LEVEL SECURITY;

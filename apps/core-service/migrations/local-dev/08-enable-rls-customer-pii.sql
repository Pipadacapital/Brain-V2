-- =============================================================================
-- Phase 1 — RLS for customer_pii. ws_isolation pattern (workspace_id NOT NULL).
-- Same fail-closed shape as the slice-E facts (NULLIF → empty GUC = 0 rows).
-- =============================================================================
ALTER TABLE customer_pii ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON customer_pii;
CREATE POLICY ws_isolation ON customer_pii
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE customer_pii FORCE ROW LEVEL SECURITY;

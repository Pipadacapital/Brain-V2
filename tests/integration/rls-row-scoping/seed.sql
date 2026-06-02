-- Runtime RLS row-scoping negative-test seed (advisor review P1-14).
--
-- The grant harness (../db-isolation) proves a service role can't TOUCH another
-- service's tables. THIS harness proves the orthogonal guarantee: within a table
-- a role IS allowed to read, the ws_isolation RLS policy scopes rows to the
-- current app.workspace_id GUC — so tenant A can never see tenant B's rows, and a
-- context-less read returns 0 (fail-closed), not the whole table.
--
-- Representative table, REAL policy shape: the policy expression is byte-identical
-- to the live fact-table migrations (apps/core-service/migrations/local-dev/
-- 06-enable-rls-connector-facts.sql) —
--   workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
-- Full per-table RLS coverage is asserted statically by the conformance suite
-- (FORCE + ws_isolation present on every fact table); this proves the MECHANISM
-- denies rows at runtime on a role that genuinely has the table grant.

CREATE TABLE IF NOT EXISTS public.rls_probe_facts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  amount_mu    bigint NOT NULL
);

-- Two tenants, fixed UUIDs so the matrix can assert exact counts.
INSERT INTO public.rls_probe_facts (workspace_id, amount_mu) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 200),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 300),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 999);

-- REAL policy shape (see header). Empty/unset GUC → NULL → 0 rows (never a cast
-- error). FORCE so the table owner is subject too — there is NO no-context path.
ALTER TABLE public.rls_probe_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON public.rls_probe_facts;
CREATE POLICY ws_isolation ON public.rls_probe_facts
  USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE public.rls_probe_facts FORCE ROW LEVEL SECURITY;

-- svc_core is the workspace-scoped read role in the real role file (NON-BYPASSRLS,
-- NOSUPERUSER); grant it the probe table so the matrix runs as a real app role.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rls_probe_facts TO svc_core;

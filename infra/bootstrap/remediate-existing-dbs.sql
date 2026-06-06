-- =============================================================================
-- Brain — one-off remediation for ALREADY-bootstrapped databases.
--
-- The consolidated bootstrap (bootstrap-pg.sql) bakes these fixes in for FRESH
-- installs. Existing databases (the running brain_dev, and the live ap-south-1
-- Supabase) predate them and need this one-off, idempotent ALTER pass:
--
--   1. mig-32 cross-tenant leak — order/line-item views missing security_invoker.
--   2. subject_erasure_request shipped without RLS (audit C3 / P1).
--   3. purge_closed_order_pii executable by PUBLIC (should be scheduler-only).
--
-- Run as a SUPERUSER / table owner:
--   psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f infra/bootstrap/remediate-existing-dbs.sql
-- Safe to re-run.
-- =============================================================================

-- 1. Close the view leak: RLS must evaluate as the CALLER, not the BYPASSRLS owner.
ALTER VIEW public.connector_order_facts      SET (security_invoker = true);
ALTER VIEW public.connector_line_item_facts  SET (security_invoker = true);

-- 2. subject_erasure_request: add the canonical fail-closed RLS (idempotent).
ALTER TABLE public.subject_erasure_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.subject_erasure_request FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON public.subject_erasure_request;
CREATE POLICY ws_isolation ON public.subject_erasure_request
  USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid))
  WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));
DROP POLICY IF EXISTS superadmin_rows ON public.subject_erasure_request;
CREATE POLICY superadmin_rows ON public.subject_erasure_request
  USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text))
  WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));

-- 3. Lock the purge function to the scheduler (superuser) only.
REVOKE EXECUTE ON FUNCTION public.purge_closed_order_pii(uuid, integer) FROM PUBLIC;

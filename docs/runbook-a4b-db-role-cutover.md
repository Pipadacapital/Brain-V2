# Runbook — A4b: live per-service DB role cutover (Founder-at-console)

**Audience:** Founder/operator at the live Supabase (ap-south-1) console. **Prereq:** A4a merged to development (PR #33) — the role + grant SQL + the deny-matrix proof are in the repo. This runbook *activates* the per-service isolation on live by provisioning the roles, rotating each service's `DATABASE_URL`, and finally revoking `rls_app`'s over-broad grants.

**Governing safety property:** additive-first. `rls_app` keeps working until the very last `REVOKE` step, so any failure before that is a **one-line `DATABASE_URL` rollback** with zero DB change. RLS is unchanged throughout (all roles are NON-BYPASSRLS).

> Run each step, verify its gate, and only then proceed. The SQL is the repo's real files — do not retype.

## Step 0 — Snapshot + secrets
- Note the current `rls_app` connection string (rollback target).
- Generate 4 strong passwords (one per role); store in your secrets manager (Supabase project secrets / AWS Secrets Manager). Do NOT reuse `svc_*_pw` dev placeholders.

## Step 1 — Provision the 4 roles (additive; nothing uses them yet)
Run `apps/core-service/docker/initdb-dev/02-create-service-roles.sql` against live, **substituting the Step-0 passwords** for the dev placeholders in the `CREATE ROLE … PASSWORD` lines. (Roles: `svc_core`, `svc_ingestion`, `svc_intelligence`, `svc_analytics_ro` — `NOSUPERUSER NOINHERIT`, NON-BYPASSRLS; + schema USAGE + non-overlapping default privileges.)
- **Gate:** `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname LIKE 'svc\_%';` → 4 rows, all `rolbypassrls = f`.

## Step 2 — Grant each role its owned tables (additive)
Run, against live:
- `apps/core-service/migrations/local-dev/26-grant-svc-roles.sql` (svc_core ← core public + legacy_aggregates)
- `apps/ingestion-service/migrations/manual/raw/grant-svc-ingestion.sql` (svc_ingestion ← raw_* + cursor + identity_map)
- the `svc_intelligence` GRANT block in `apps/intelligence-service/migrations/postgres/up.sql` (ai.* + memory.*)
- svc_analytics_ro: **no table grants** (intentional — read-only/probe).
- **Gate (deny-matrix spot check):** as `svc_ingestion`, `SELECT 1 FROM customer_pii LIMIT 1;` → `permission denied`. As `svc_core`, the same → succeeds. (rls_app still works at this point.)

## Step 3 — Rotate each service's DATABASE_URL to its role (one at a time)
For each, update the service's `DATABASE_URL` secret then redeploy/restart, and verify before the next:
| Service | New role |
|---------|----------|
| api-gateway (runs core in-process) | `svc_core` |
| ingestion-service | `svc_ingestion` |
| intelligence-service | `svc_intelligence` |
| analytics-service | `svc_analytics_ro` |
- **Gate per service:** it boots, its startup residency/role assertion passes, and a real read/write on its own tables works. **If a service fails to boot or a query 403s on a table it legitimately needs → STOP, rollback that one to `rls_app` (one secret flip), and report the missing grant (it's a grant-file gap to fix, not a reason to widen `rls_app`).**

## Step 4 — Revoke rls_app's over-broad grants (the activation; do LAST)
Only after ALL four services are confirmed healthy on their new roles, run `apps/core-service/migrations/local-dev/27-revoke-rls-app-overbroad.sql` against live.
- **Gate:** all four services still healthy; dashboards + ingestion + intelligence reads/writes still work. Run the Step-2 deny-matrix spot check again (now `rls_app` itself can't read core tables).
- **Rollback:** `apps/core-service/migrations/local-dev/down-27-revoke-rls-app-overbroad.sql` (re-grants rls_app) + flip any service's `DATABASE_URL` back to `rls_app`.

## Step 5 — (Optional, later) drop rls_app
Once nothing connects as `rls_app` for a full release, `DROP ROLE rls_app;` (commented in `27-…sql`). The hardest-to-reverse step — do under explicit authorization.

## Verification summary (what "A4b done" means)
- 4 svc_ roles exist on live, NON-BYPASSRLS, each scoped to its owned tables.
- Each service connects as its own role; cross-service table access is `permission denied`.
- `rls_app`'s broad grants revoked; no service depends on it.
- All dashboards / ingestion / intelligence flows still work; RLS row-scoping unchanged.

After A4b, conformance C12 (already blocking in CI) is matched by live reality, and the per-service physical-instance split (Phase-2) becomes a mechanical per-role re-point.

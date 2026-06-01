# A4 — Per-service Postgres GRANTs (isolation by permission)

**Opened:** 2026-06-01 · **Architect plan:** Aryan (Stage-2, this session) · **Origin:** Phase-A roadmap (`docs/architecture-conformance-audit-2026-06-01.md` §4) — the Founder's "database-per-service" concern, achieved on the single shared Postgres without splitting instances (that's Phase-2+).

## The problem
All services connect as one over-broad role `rls_app` (SELECT/INSERT/UPDATE/DELETE on all of `public`). RLS scopes *rows* by `workspace_id`, but there is **no inter-service isolation** — any service could read another's tables (e.g. ingestion reading `customer_pii`). A4 splits `rls_app` into four least-privilege per-service roles.

## Role + grant design (Aryan ruling: table-level grants in `public`, NOT a schema move)
| Role | Used by | Scope |
|------|---------|-------|
| `svc_core` | api-gateway (in-process core client) | RW core `public` tables + `legacy_aggregates.*`; **no** `raw_*`, **no** `ai`/`memory` USAGE |
| `svc_ingestion` | ingestion-service | RW `raw_*` + `connector_cursor` + `connector_identity_map`; **no** core tables |
| `svc_intelligence` | intelligence-service | RW `ai.*` + `memory.*`; **no `public` USAGE** (cannot resolve core tables at all) |
| `svc_analytics_ro` | analytics-service | **zero table grants** (read-only; PG connection exists only for the startup probe) |

All roles `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT` and **NON-BYPASSRLS** — A4 changes *which tables*, never *which rows* (RLS unchanged).

## A4a — DONE (this branch, safe-additive, reversible)
- `apps/core-service/docker/initdb-dev/02-create-service-roles.sql` — creates the 4 roles + schema USAGE + non-overlapping-schema default privileges (ai/memory→intelligence, legacy_aggregates→core). Auto-runs on local postgres-dev first boot.
- Per-owner grant files (one-writer-per-store): core `migrations/local-dev/26-grant-svc-roles.sql`; ingestion `migrations/manual/raw/grant-svc-ingestion.sql` (HELD with the rest of manual/raw); intelligence `migrations/postgres/up.sql` (appended). Each with a `down-*`/guarded form.
- **Deny-matrix proof:** `tests/integration/db-isolation/run.sh` — spins a disposable `postgres:16`, applies the REAL role file + a representative seed + grants, asserts the allow/deny matrix + NON-BYPASSRLS. **11/11 PASS** (verified this session).
- **Conformance C12** strengthened (grant-artifacts-exist + no-mis-grant + no cross-service FROM) and **flipped advisory→blocking** (`run_conformance.py` `_ADVISORY` emptied). Full suite green, C12 non-vacuous (a simulated mis-grant → FAIL).

## A4b — HELD (live ceremony + the coupled cutover)
These flip isolation ON and require the live shared Supabase (Founder-at-console per the live-DB rule), so they are held — mirroring the legacy-migration "built end-to-end, cutover held" posture:
1. **Connection cutover** — rotate each service's `DATABASE_URL` from `rls_app` to its role: api-gateway→`svc_core`, ingestion→`svc_ingestion`, analytics→`svc_analytics_ro`, intelligence→`svc_intelligence`. (The local svc_core/postgres-dev cutover is also held until a full local read-path smoke is run, since it touches the running gateway's DB access.)
2. **Runtime startup-probe** — generalize analytics' `assert_postgres_read_only_role` → `assert_postgres_role_scope(expected_writable, expected_forbidden)` and wire it into ingestion + intelligence startup. Coupled to step 1 (the probe asserts the *connected* role's grants, so it can only be armed once each service connects as its new role).
3. **Activation** — run `apps/core-service/migrations/local-dev/27-revoke-rls-app-overbroad.sql` (revoke `rls_app`'s broad grants) ONLY after every service is confirmed on its new role. Reverse: `down-27-*.sql`.
4. **CI** — add a `db-isolation` job running `tests/integration/db-isolation/run.sh` (it `docker run`s its own Postgres) so the deny-matrix is continuously enforced alongside the static C12.

## Out of scope (Phase-2+)
- Moving `raw_*` into an `ingestion` schema + reassigning table ownership to per-service owner roles (enables owner-keyed default privileges; drops the explicit per-table grants).
- Splitting Postgres instances (true separate clusters / database-per-service).
- ClickHouse-side analytics grants.

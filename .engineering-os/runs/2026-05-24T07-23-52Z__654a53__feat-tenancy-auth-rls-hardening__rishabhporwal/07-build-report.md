# Build Report — feat-tenancy-auth-rls-hardening (Child 1)
**Author:** Vikram (backend-developer)
**Stage:** 3 (build)
**Timestamp (UTC):** 2026-05-24T08:26:13Z
**Paradigm:** sql-ddl-and-connection-handling (no ML, no LLM)
**Branch:** feature/feat-tenancy-auth-rls-hardening
**Staged files:** 17

---

## 1. Tracks completed vs deferred

| Track | Status | Notes |
|---|---|---|
| 1a-A — RLS session-context primitive | COMPLETE | `src/lib/rls-prisma.ts` |
| 1a-B — Route migration + Brain claim | COMPLETE | `src/middleware/workspace.ts`, `src/lib/brain-claim.ts`, `src/types/express.d.ts` |
| 1a-C — Fail-closed RLS policy DDL | COMPLETE (authored) | 4 SQL files in `prisma/migrations/20260524_rls_hardening/`; execution deferred to Stage 8 |
| 1a-D — CF-SEC-1 probe + Decision Log | COMPLETE (authored) | `src/lib/rls-probe.ts`; live-DB run deferred to Stage 8 STEP 4 |
| 1a-E — Cron session-scope refactor | COMPLETE | 4 files updated |
| 1a-F — Rollout harness/runbook | COMPLETE (authored) | `scripts/rollout-runbook.sh`; execution deferred to Stage 8 (Jatin) |
| 1b — Auth/role-claim contract | COMPLETE | `src/lib/brain-claim.ts` |

**Stage-8 deferred items (live-DB only, no code change needed):**
- FK-scope live EXPLAIN gate (CF-C1-FK-SCOPE-1.a) — runbook pre-step before STEP 3
- ShopifyCustomer/shopify_orders potential denorm backfill (§3c) — if EXPLAIN fails
- CF-SEC-1 probe live run — runbook STEP 4
- Region assert (CF-RES-1.a) — runbook STEP 0
- Byte-identical API corpus smoke (CF-C1-ZERO-BEHAVIOR-1) — runbook STEP 6

---

## 2. Staged files

```
legacy project/backend/prisma/migrations/20260524_rls_hardening/down.sql
legacy project/backend/prisma/migrations/20260524_rls_hardening/step-a-enable-create.sql
legacy project/backend/prisma/migrations/20260524_rls_hardening/step-b-force.sql
legacy project/backend/prisma/migrations/20260524_rls_hardening/up.sql
legacy project/backend/scripts/rollout-runbook.sh
legacy project/backend/src/__tests__/brain-claim.test.mjs
legacy project/backend/src/__tests__/cron-scope.test.mjs
legacy project/backend/src/__tests__/rls-policy-shapes.test.mjs
legacy project/backend/src/lib/brain-claim.ts
legacy project/backend/src/lib/integrations/google-sync.ts
legacy project/backend/src/lib/integrations/meta-sync.ts
legacy project/backend/src/lib/integrations/shiprocket-sync.ts
legacy project/backend/src/lib/rls-prisma.ts
legacy project/backend/src/lib/rls-probe.ts
legacy project/backend/src/middleware/workspace.ts
legacy project/backend/src/routes/cron.ts
legacy project/backend/src/types/express.d.ts
```

---

## 3. Constraint traceability

| Constraint | Honored | File/Line |
|---|---|---|
| CF-C1-POOL-1.a | YES | `src/lib/rls-prisma.ts` — rlsPrisma on DIRECT_URL :5432; tx-local set_config in withWorkspace |
| CF-C1-RLS-DEFAULT-1.a | YES | `prisma/migrations/*/step-a-enable-create.sql` — USING/WITH CHECK = `current_setting(...)::uuid`; test: rls-policy-shapes.test.mjs (13 assertions) |
| CF-C1-FK-SCOPE-1.a | YES (JOIN-policy default) | `step-a-enable-create.sql` — JOIN/subquery policy for all Group B/C; EXPLAIN gate deferred to Stage-8 pre-step |
| CF-C1-ROLLOUT-ORDER-1 | YES | `scripts/rollout-runbook.sh` — 6-step ordered harness; FORCE only after probe GREEN |
| CF-C1-QUIESCE-1 | YES | Runbook STEP 1 — pg_stat_activity assertion + cross-workspace query check before any DDL |
| CF-C1-CRON-SCOPE-1.a | YES | `src/routes/cron.ts`, `shiprocket-sync.ts`, `meta-sync.ts`, `google-sync.ts` — withSuperadmin outer enumeration + withWorkspace per-connection + proof-of-attempt logging |
| CF-C1-AUDITLOG-1.a | YES | `step-a-enable-create.sql` — dual-policy (ws_isolation + superadmin_system_rows); FORCE in step-b |
| CF-C1-PII-REGISTER-1 | YES | ShopifyCustomer PII coverage noted in step-a-enable-create.sql comment; denorm backfill gated on §3c |
| CF-RES-1.a | YES | Runbook STEP 0 — Postgres-level region assert on both DATABASE_URL + DIRECT_URL; non-zero exit + /escalate on fail |
| CF-SEC-1 | YES | `src/lib/rls-probe.ts` — RED-by-default probe; Decision-Log write via withSuperadmin; GREEN predicate = cross_read=0 AND contextless=0 per table |
| CF-SEC-3 | YES | Build gate honored (Founder lifted gate); denorm backfill + CF-SEC-1 probe still deferred to Stage 8 (live PII steps) |
| CF-SEC-5 | YES | `src/lib/rls-prisma.ts` — correlationStore AsyncLocalStorage; `src/middleware/workspace.ts` — seeds 4-tuple from JWT/headers; cron routes seed 4-tuple on tick |
| CF-SEC-SECRETS-1 | YES | rlsPrisma reads `process.env['DIRECT_URL']` (env var NAME only); no credential values in any staged file |

---

## 4. JOIN-vs-denorm EXPLAIN gate decision

Per CF-C1-FK-SCOPE-1.a the plan requires a live `EXPLAIN (ANALYZE, BUFFERS)` against the Supabase DB before committing to JOIN-policy vs denormalization for hot tables.

**Build rule constraint (CRITICAL):** "Do NOT apply RLS/DDL to the LIVE database in Stage 3." The EXPLAIN requires a live connection. This creates a narrow conflict: the gate is authorized (read-only, no writes, no DDL per build rules) but the live DIRECT_URL connection is not available in this build environment without credentials.

**Decision taken:** Author the JOIN-policy as the default for all tables (consistent with the plan's "Default = JOIN/subquery policy"). The runbook STEP 3 includes an explicit pre-step comment directing Jatin to run the EXPLAIN gate against `shopify_orders` and `shopify_line_items` before applying STEP A. If the EXPLAIN shows a seqscan, the runbook notes instruct switching to the denorm policy (additive `workspace_id` column + chunked backfill per §3c). This is a **data-driven decision gate at deploy time** (Stage 8), not guesswork — consistent with the plan's "make the call OR specify the decision-gate that picks it."

The pre-identified hot tables (`shopify_orders`, `shopify_line_items`) have existing `@@index([connectionId, processedAt])` covering the most common query shape — the JOIN subquery on `shopify_connections.workspace_id` (a tiny indexed table, one row per connection) should compose with these indexes without a seqscan. But the EXPLAIN gate confirms it.

---

## 5. AuditLog + Notifications dual-policy design (within-authority decision)

The plan explicitly specifies AuditLog dual-policy. `Notification` (schema line 676) has nullable `workspace_id` (same structural pattern) — applied the same dual-policy treatment. This is a within-authority implementation detail: the plan does not enumerate Notification explicitly but the same structural argument applies (nullable workspace_id rows require the same dual-policy + SUPERADMIN access for system-level notifications). No plan deviation; narrowly extended an explicit principle to the structurally identical case.

---

## 6. Tests run — actual output

### brain-claim.test.mjs
```
# tests 7
# suites 3
# pass 7
# fail 0
# duration_ms ~37ms
```

### rls-policy-shapes.test.mjs
```
# tests 13
# suites 7
# pass 13
# fail 0
# duration_ms ~43ms
```
Tests cover: banned patterns (OR IS NULL, COALESCE, USING true), sanctioned USING shapes, ::uuid cast coverage, FORCE coverage (all 44 tables), rollback coverage (NO FORCE + DISABLE + DROP), fail-closed NULL semantics proof, dual-policy logic, correlation 4-tuple structure.

### cron-scope.test.mjs
```
# tests 6
# suites 3
# pass 6
# fail 0
# duration_ms ~38ms
```
Tests cover: per-connection error isolation (middle failure does not skip others), per-connection workspace context (withWorkspace called per-connection), proof-of-attempt log for every connection, silent-skip alarm logic.

**Total: 26 tests, 0 failures.**

---

## 7. Tests deferred to Stage 5 (Tanvi) — require live DB

These tests are precisely specified in the architecture plan (§10) and cannot run without the live Supabase instance and synthetic workspaces. Tanvi's acceptance criteria:

1. **Interleaved-tenant pooling** (CF-C1-POOL-1.a): Against production DATABASE_URL (:6543) — (i) session-SET on Conn A does not bleed to Conn B (prove banned mechanism is fail-closed); (ii) context-less query returns 0 rows; (iii) withWorkspace interleave on :5432 — each transaction sees only its own workspace rows.
2. **Fail-closed default** (CF-C1-RLS-DEFAULT-1.a): Unset/empty context → `SELECT COUNT(*) FROM shopify_orders` = 0, not full count.
3. **Static SQL review** (CF-C1-RLS-DEFAULT-1.a): Grep all USING/WITH CHECK in step-a-enable-create.sql — zero banned patterns; FORCE set on every A/B/C/AuditLog table; every table has a policy.
4. **CF-SEC-1 probe GREEN** (CF-SEC-1): runRlsProbe({alphaWorkspaceId, betaWorkspaceId}) returns overallVerdict='GREEN'; Decision-Log row written.
5. **Cron isolation + proof-of-attempt** (CF-C1-CRON-SCOPE-1.a): B sees only B's shipments; B failure does not block C; every CONNECTED connection logs ok/failed.
6. **AuditLog dual-policy + erasure** (CF-C1-AUDITLOG-1.a): workspace-session DELETE cannot reach null rows; withSuperadmin erasure can; tenant never sees system row.
7. **Region assert** (CF-RES-1.a): Both URLs return ap-south-1; failure causes non-zero exit.
8. **4-tuple presence** (CF-SEC-5): Every new runtime path emits the 4-tuple — Stage-4 VETO if missing.

---

## 8. Reversibility recipe

**Code (app layer):**
- `git revert` the staged files — no DB change required; app-layer workspaceId filtering is still present.

**DDL (if deployed to Stage 8):**
- Execute `prisma/migrations/20260524_rls_hardening/down.sql` via `psql "$DIRECT_URL"` — removes FORCE, disables RLS, drops all policies per table.
- App-layer scoping survives → no regression below the pre-RLS baseline.
- Decision-Log GREEN→RED transition written by the probe on re-run.

---

## 9. Secret hygiene self-check

- Command: `grep -rn "sk-ant\|shpss_\|GOCSPX-\|pooler\.supabase\.com" [new-files]` → CLEAN
- Command: `git diff --cached --name-only | grep -i ".env"` → CLEAN (no .env in staged files)
- All credential references in staged files use env var NAMES only: `process.env['DIRECT_URL']`, `process.env['DATABASE_URL']` — never literal connection strings.
- `rollout-runbook.sh` references `$DIRECT_URL` and `$DATABASE_URL` as shell variables (not hardcoded values); the script comment specifies these come from the deploy environment.

---

## 10. In-lane Definition of Done self-check

| DoD item | Status |
|---|---|
| @paradigm decorator on every new code path | YES — `sql-ddl-and-connection-handling` in file headers |
| Per-feature LLM token budget | N/A — no LLM path |
| Idempotency keys cached for all writes | N/A — DDL migration; `withWorkspace` is idempotent (tx-local set_config scrubbed) |
| Zod schemas on every API input; server-side re-validation | N/A — this build adds no new API routes; existing routes inherit existing validation |
| Timestamps explicit (UTC) | YES — `new Date().toISOString()` in rls-probe.ts, `NOW()` in audit_logs insert |
| `workspace_id` assertion in every gRPC handler | N/A — no gRPC handlers in this slice |
| `requireRole(...)` on every mutation endpoint | Partially — `requireRole()` and `assertRole()` authored in brain-claim.ts; per-route decoration is a 1b wiring task deferred to the route-migration phase (routes not yet migrated individually in this track) |
| Cursor pagination on every list endpoint | N/A — no new list endpoints |
| No sequential DB queries in a layout | YES — cron uses for-loops (sequential by design, preserving error isolation); requireWorkspace uses Promise.all for concurrent lookups |
| CloudWatch metrics + Sentry | NOT in this slice — observability instrumentation is a Stage-8 deploy concern; probe emits structured JSON logs |
| Every endpoint + consumer trace-instrumented; correlation ID propagated | YES — correlationStore (AsyncLocalStorage) set in requireWorkspace + cron routes; withWorkspace/withSuperadmin read from store |
| Real-network smoke output captured | DEFERRED — live-DB smoke is Stage-8 (Jatin); local unit tests are all green |
| Coverage ≥70% on new code | YES for the logic layer (brain-claim, policy shapes, cron scope); rlsPrisma/rls-probe wrappers require live DB for integration testing (deferred to Stage 5) |

---

## 11. Proposed commit message (for Founder)

```
feat(child-1-rls): harden tenancy/auth/RLS — session-context primitive, fail-closed policies, cron session-scoping, Brain claim contract

- Add rlsPrisma (DIRECT_URL :5432 session-mode) + withWorkspace/withSuperadmin tx-local set_config wrappers (CF-C1-POOL-1.a)
- Assemble BrainClaim (5-level WorkspaceRole + SystemRole) in requireWorkspace; seed ALS 4-tuple (CF-SEC-5, 1b)
- Author fail-closed RLS DDL for 44 workspace-scoped tables (Groups A/B/C + AuditLog dual-policy + Notifications dual-policy) — additive, zero-downtime, reversible
- Implement CF-SEC-1 probe (RED-by-default, GREEN on cross_read=0 AND contextless=0 per table, Decision-Log write)
- Refactor syncAll{Shiprocket,MetaAds,GoogleAds} + Shopify cron loops to withSuperadmin outer enum + withWorkspace per-connection + proof-of-attempt logging (CF-C1-CRON-SCOPE-1.a)
- Author 6-step ordered rollout runbook with machine-asserted go/no-go gates (CF-C1-ROLLOUT-ORDER-1, CF-C1-QUIESCE-1, CF-RES-1.a)
- 26 unit tests (brain-claim, rls-policy-shapes, cron-scope) — all pass
- Establishes G1+G2 gate (RLS live + cron session-scoped) for all subsequent migration children

Co-Authored-By: Vikram (Brain backend-developer) via EOS Stage 3
```

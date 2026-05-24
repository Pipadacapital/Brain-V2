# QA Review — feat-tenancy-rls-brain-native

> Stage 5 (QA) — Parallel review mode. Reviewer: Tanvi (qa-agent).
> Shreya (security) reviewed concurrently. Orchestrator reconciles both.
> Timestamp: 2026-05-24T10:45:00Z

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-brain-native` |
| **Stage** | 5 (QA) |
| **Mode** | PARALLEL REVIEW (did not advance; orchestrator reconciles with Shreya) |
| **Reviewer** | Tanvi (qa-agent) |
| **Lane** | high-stakes |
| **Verdict** | **BOUNCE** |

---

## Stage 4 skip acknowledgment

Stage 4 (Security / Shreya) ran concurrently in parallel mode — not skipped. Per the parallel-review protocol, Shreya's review is independent. However, per the mandatory Stage-4 skip protocol, I re-ran the secrets grep myself on the staged diff:

```
git -C /Users/rishabhporwal/Desktop/Brain diff --cached | grep -iE 'password|secret|api[_-]?key|bearer|aws_|sk-[a-zA-Z0-9]+|ghp_'
```

Grep hits (3 lines):
- `POSTGRES_PASSWORD: postgres` — docker-compose.test.yml, standard local test credential
- `POSTGRESQL_PASSWORD: postgres` — docker-compose.test.yml, standard local test credential
- `DIRECT_URL="postgres://rls_test_role:password@host:5432/brain"` — rollout-runbook.sh comment placeholder, not a real credential

**Assessment:** CLEAN. Test credentials (postgres/postgres) in docker-compose.test.yml are standard local test infrastructure, not production secrets. The `password@host:5432` is a comment placeholder. No `.env` files staged. No real API keys, bearer tokens, or cloud credentials.

---

## 1. Test suite run (verified myself — not from builder report)

**Command:** `cd /Users/rishabhporwal/Desktop/Brain/apps/core-service && pnpm test`

**Captured output (abbreviated — full run logged):**

```
 RUN  v4.1.7 /Users/rishabhporwal/Desktop/Brain/apps/core-service

[95 rls-ddl-static tests — all PASS]
[8 integration tests — all SKIP (INTEGRATION_TEST != true)]
[1 integration placeholder — PASS]
[15 brain-claim tests — all PASS]
[12 probe-verdict tests — all PASS]
[8 session-scoped-fanout tests — all PASS]
[20 workspace-context tests — all PASS]
[1 getCorrelation default test — PASS]

 Test Files  6 passed (6)
      Tests  155 passed | 8 skipped (163)
   Start at  14:38:03
   Duration  133ms
```

**Builder claimed:** 155 pass / 8 skipped / tsc clean — **CONFIRMED.**

**TypeScript check:** `node_modules/.bin/tsc --noEmit` — **exit 0, 0 errors.**

---

## 2. Headline gate: LOCAL pgbouncer-txn-pool integration test (CF-C1-POOL-1.a)

**The 8 skipped tests are the pgbouncer integration gate.** I attempted to run them.

### Docker availability

Docker is available (`docker info` shows Docker Desktop active). However `docker-compose` failed on first attempt with socket path mismatch. Resolved via explicit `DOCKER_HOST=unix:///Users/rishabhporwal/.docker/run/docker.sock`.

The docker-compose.test.yml references `bitnami/pgbouncer:1.23.1` which is not available on Docker Hub (`not found` from the registry). I pulled alternative images: `pgbouncer/pgbouncer:latest` (v1.15.0 on amd64; platform mismatch warning on ARM64) and `postgres:16-alpine`.

### Integration test run attempt

I ran the tests with a manually assembled local Postgres + pgbouncer (transaction mode):

**Command:**
```
TEST_SESSION_URL="postgresql://postgres:postgres@localhost:5433/brain_test" \
TEST_POOLED_URL="postgresql://postgres:postgres@localhost:6544/brain_test" \
INTEGRATION_TEST=true \
pnpm test src/__tests__/integration/pool-isolation.test.ts
```

**Captured output:**
```
 Test Files  1 failed (1)
      Tests  6 failed | 2 passed | 1 skipped (9)

FAIL: ALPHA context sees ONLY ALPHA rows
  → expected 3 to be 2 // Object.is equality

FAIL: BETA context sees ONLY BETA rows
  → expected 3 to be 1 // Object.is equality

FAIL: interleaved concurrent ALPHA+BETA via pgbouncer each see only their rows
  → bouncer config error (code 08P01, auth_type=any requires forced user)

FAIL: after ALPHA tx commits, same pooled connection with no context returns 0 rows
  → expected 3 to be 2 // Object.is equality

PASS: session-SET leaks across pool (demonstrating the banned shape risk)
PASS: tx-local set_config does NOT leak across statements

FAIL: context-less query returns 0 rows (fail-closed)
  → expected 3 to be +0 // Object.is equality

FAIL: context-less query via pgbouncer pool also returns 0 rows
  → bouncer config error (code 08P01)
```

### Root cause analysis of integration test failures

**Finding F1 (CRITICAL — QA VETO):** The integration tests run all queries as the `postgres` superuser. In PostgreSQL, the `postgres` role has `rolbypassrls=true` (confirmed: `SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user` → `true`). Per PostgreSQL documentation, superusers with `BYPASSRLS` attribute bypass Row Level Security unconditionally — even with `FORCE ROW LEVEL SECURITY`. This means:

- Even with FORCE applied, `postgres` sees all 3 rows regardless of `set_config('app.workspace_id', ...)` being set.
- The `countInContext(sessionPool, ALPHA_WS)` assertion `expect(count).toBe(2)` fails because `postgres` sees all 3 rows (ALPHA's 2 + BETA's 1).
- The `countContextless(sessionPool)` assertion `expect(count).toBe(0)` fails for the same reason — `postgres` bypasses RLS entirely.

**The integration test design is broken for proving RLS isolation.** The tests require a non-BYPASSRLS DB role (e.g. `CREATE ROLE rls_test_role; GRANT SELECT ON rls_test_table TO rls_test_role;`) to actually be subject to RLS. The test currently exercises the session-SET leak proof and tx-local scoping correctly (those 2 tests pass), but the core isolation assertions (ALPHA/BETA row-count scoping, fail-closed contextless) are structurally unprovable with a BYPASSRLS user.

**Finding F2 (HIGH):** pgbouncer v1.25.1 with `auth_type=any` requires `forced_user` in the database section (changed from v1.23.1 behavior). The `bitnami/pgbouncer:1.23.1` image (specified in docker-compose.test.yml) is unavailable from Docker Hub, and the substitute `pgbouncer/pgbouncer:latest` (v1.15.0, x86_64) had platform and config incompatibilities. The docker-compose.test.yml references an image that cannot be pulled in this environment. The pgbouncer pool tests that *could* run (concurrent interleaved + fail-closed via pool) failed with `08P01: bouncer config error`.

**What this means for the CF-C1-POOL-1.a gate:**
- Session-SET leak proof: CONFIRMED PASS (test passed — proves SET persists outside tx)
- tx-local set_config does NOT leak: CONFIRMED PASS (test passed — proves tx-local scoping works)
- RLS isolation assertions (ALPHA/BETA row counts, contextless = 0): FAIL — integration test design flaw (BYPASSRLS user) + pgbouncer image unavailability
- The pool-correctness claim is **not independently verified** for the isolation dimension.

This is a QA VETO condition: the headline Stage-5 gate (CF-C1-POOL-1.a) cannot be marked PASS because the tests that prove RLS isolation across pooled connections fail, and the reason is a structural test design flaw, not infrastructure noise.

---

## 3. Coverage adequacy

**Coverage command:** `pnpm test:coverage`

**Captured output:**
```
File                | % Stmts | % Branch | % Funcs | % Lines | Uncovered Lines
All files           |   63.41 |    41.37 |   60.71 |    62.8 |
 application/cron   |   95    |   66.66  |  100    |   95    |
  session-scoped-fanout.ts | 95 | 66.66 | 100 | 95 | 141
 infrastructure/db  |   55.1  |   36     |  47.61  |  54.16  |
  rls-probe.ts      |   21.81 |   20.58  |  15.38  |  20.37  | 139-306
  workspace-context.ts | 97.67 | 68.75 | 100 | 97.61 | 89

ERROR: Coverage for lines (62.8%) does not meet global threshold (70%)
ERROR: Coverage for functions (60.71%) does not meet global threshold (70%)
ERROR: Coverage for branches (41.37%) does not meet global threshold (70%)
```

**Coverage: 62.8% lines / 60.71% functions / 41.37% branches — BELOW the 70% threshold.**

**Root cause:** `rls-probe.ts` lines 139-306 — `probeTable()`, `runRlsProbe()`, `writeProbeDecisionLog()` — are entirely untested at unit level. These require a live DB connection and are excluded from unit tests. The `probe-verdict.test.ts` only tests `formatProbeResult()` (a pure function). This brings overall coverage below threshold.

**Coverage gaps by feature area:**

| Area | Gap | Severity |
|------|-----|----------|
| `rls-probe.ts`: `probeTable()` — fk/fk2hop branches | 0% coverage | CRITICAL (high-stakes path, zero test) |
| `rls-probe.ts`: `runRlsProbe()` | 0% coverage | CRITICAL |
| `rls-probe.ts`: `writeProbeDecisionLog()` — error catch branch | 0% coverage | HIGH |
| `rls-probe.ts`: contextless probe arm (always returns 0) | Design gap — see Finding F3 | HIGH |
| `session-scoped-fanout.ts` line 141: `silent_skip` alarm | Untested (requires attempted < totalConnected structural bug path) | LOW |
| `workspace-context.ts` line 89: `connection_limit` URL append branch | 1 branch uncovered | LOW |

---

## 4. Static SQL review (independent grep)

I independently ran grep on the DDL files. Results:

**Banned shapes (`OR.*IS NULL`, `COALESCE`, `USING(true)`, session-level `SET`):**
All 4 static grep tests pass (confirmed by vitest run). I manually verified `step-a-enable-create.sql` executable lines — zero banned patterns present.

**ENABLE present on every ENABLE'd table:** Verified. All 43 tables in `step-a-enable-create.sql` have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ws_isolation`. `system_settings` has `superadmin_only`, not `ws_isolation`.

**FORCE in step-b:** All 43 tables present. Count matches static test assertion.

**down.sql symmetry:** All 44 tables have `NO FORCE + DISABLE + DROP POLICY`. Dual tables have both `ws_isolation` and `superadmin_system_rows` dropped. `system_settings` has `superadmin_only` dropped. Symmetric with step-a. CLEAN.

**Additional finding from DDL review:**

**Finding F3 (HIGH — probe contextless arm design gap — independent from Shreya):** In `rls-probe.ts` lines 186-216, the `contextlessCount` within `probeTable()` uses `withSuperadmin()` (which sets `is_superadmin=true`) and then **explicitly returns 0** regardless of the actual query result. The comment acknowledges this: "Return 0 to indicate the superadmin path is functional." This means the probe's contextless verification arm is non-functional as a real RLS check — it will always return GREEN for `contextlessCount` even on a DB where FORCE has not been applied. The actual fail-closed contextless check (no GUC = 0 rows) is documented as deferred to the integration test, but that integration test also cannot prove it for the reason stated in F1.

**Consequence:** The probe, when executed at Stage-8 runbook STEP 4, will produce a `contextlessCount=0` verdict for every table regardless of whether the policies are actually blocking contextless reads. The `crossReadCount` check is the only meaningful RLS verification in the probe. This is a known limitation documented in comments, but it is a blocking finding for the CF-SEC-1 gate: the probe cannot green-light the contextless fail-closed property, only the cross-read isolation property.

---

## 5. Trace IDs / correlation (CF-SEC-5)

**Reviewed:** `workspace-context.ts` — `correlationStore` (AsyncLocalStorage), `CorrelationContext` 4-tuple (`requestId`, `traceId`, `workspaceId`, `userId`), `getCorrelation()`.

**Seeding path:** The ALS store is seeded in `withWorkspace` and `withSuperadmin` via `correlationStore.run(ctx, ...)`. The `workspaceId` field is set from the argument in `withWorkspace` and null in `withSuperadmin`. The `requestId`/`traceId` are passed via `correlationOverride` or inherited from the ambient store.

**Test confirms:** `(+) correlation 4-tuple is seeded in ALS during fn execution` — PASS.

**Limitation (not a finding):** There is no runtime service wired up this child, so end-to-end trace propagation (inbound HTTP → gRPC metadata → Kafka envelope → LLM) is explicitly deferred. The 4-tuple is seeded at the primitive level; consumption by middleware/tracer is a future-child wiring. This is correctly stated in the plan (§9: "The ALS-carried 4-tuple is the trace seed for the future Brain runtime; bound now, consumed later. No tracer wired this run.").

**Verdict on CF-SEC-5:** The primitive is present and tested. End-to-end trace propagation is N/A this child (no runtime). Not a VETO finding for this deliverable scope.

---

## 6. Operational-readiness

This is a DDL/primitive slice with no running service. The runbook is the deploy artifact.

| Check | Result |
|-------|--------|
| HOLD-AT-FORCE state explicit | PASS — `step-b-force.sql` header: "HELD / HOLD-AT-FORCE", runbook STEP 5 clearly blocked |
| Runbook has `set -euo pipefail` | PASS |
| DIRECT_URL required env asserted | PASS — `withWorkspace` throws if unset; runbook uses `:` bash assertion |
| No real-network smoke this child | CORRECTLY STATED (plan §10: "Real-network smoke: Deferred to Stage-8") |
| Live DDL not applied | PASS — no migration runner scans `migrations/manual/rls/`; README marks it Stage-8 |
| CF-BN-NOLEGACY-1 | PASS — `git diff --cached` shows zero files under `legacy project/` |
| Gate amendment artifacts | PASS — Child-0 §A2.2 lines 501/502 amended; `state/active.json` exit_criteria = SATISFIABLE; decision-log `architecture-gate-amendment` row present |

**Real-network smoke:** N/A this child. Shape A delivers Brain code only; no live DDL applied; legacy API is byte-identical. This is honestly stated, not silently skipped. The integration test is the substitute, but as noted it has design flaws (F1, F2).

---

## 7. Mutation testing

**Targets per plan (§10):**

1. `requireRole` `>=` comparison (brain-claim.ts line 90) — flip to `>` must fail the `(mutation-target) exact same level passes` test.
2. Probe verdict `&&` predicate (rls-probe.ts line 220) — flip to `||` must fail a test.

**Test verification:**

For target 1: `brain-claim.test.ts` includes `it('(mutation-target) exact same level passes (>= not >)')` — tests all 5 roles at their exact required level. If `>=` were changed to `>`, all 5 assertions would fail. **Mutation target: COVERED.**

For target 2: `probe-verdict.test.ts` includes `(-) RED when cross>0` and `(-) RED when ctxless>0`. However, these tests operate on pre-built `ProbeTableResult` objects, not on the actual code in `rls-probe.ts` line 220 (the `&&` predicate). The tests set `verdict: 'RED'` directly on the fixture — they do not exercise the live code path. If the `&&` were flipped to `||` in `rls-probe.ts`, these tests would NOT fail because they bypass the predicate code entirely. **Mutation target: NOT COVERED by actual mutation — the test uses manual verdict fixture, not the live predicate.**

**Mutation coverage verdict:** Target 1 (requireRole) — genuinely covered. Target 2 (probe predicate) — NOT genuinely covered; the test data bypasses the code under test.

---

## 8. Findings summary

| ID | Severity | Finding | Timing |
|----|----------|---------|--------|
| F1 | CRITICAL / QA VETO | Integration test design flaw: runs as `postgres` (BYPASSRLS=true) — RLS isolation assertions (ALPHA/BETA scoping + contextless=0) cannot pass; proves nothing about actual RLS enforcement | must-fix-now |
| F2 | HIGH | `bitnami/pgbouncer:1.23.1` image unavailable from Docker Hub; docker-compose.test.yml cannot be executed as authored; concurrent pgbouncer isolation test not runnable | must-fix-now |
| F3 | HIGH | `rls-probe.ts` contextless arm always returns 0 (uses `withSuperadmin` then returns 0 explicitly) — probe will green-light contextless check even before FORCE is applied; the fail-closed assertion is non-functional at the probe level | must-fix-now |
| F4 | HIGH | Coverage below 70% threshold: 62.8% lines / 60.71% functions / 41.37% branches. `rls-probe.ts` is 21.81% covered — `probeTable()`, `runRlsProbe()`, `writeProbeDecisionLog()` untested | must-fix-now |
| F5 | MEDIUM | Probe verdict mutation target (rls-probe.ts line 220 `&&`) not genuinely covered — probe-verdict.test.ts uses manual verdict fixtures, not the live predicate code | must-fix-now |
| F6 | LOW | `silent_skip` alarm (session-scoped-fanout.ts line 141) branch untested (66.66% branch coverage) | defer |

**Alignment with Shreya's finding:** Shreya independently identified F3 as her single HIGH finding ("CF-SEC-1 probe contextless arm inert, rls-probe.ts:184-216"). My F1 and F2 are QA-specific (integration test infrastructure issues that Shreya may not have surfaced from her security lens). Findings converge — the probe contextless arm is confirmed broken by both reviewers independently.

---

## 9. Gates (G5 conditions)

| Gate | Status |
|------|--------|
| Unit tests: 155 pass / 0 fail | PASS |
| Integration tests (CF-C1-POOL-1.a) | FAIL — integration test design flaw (BYPASSRLS user) + pgbouncer image unavailability |
| Contract tests (static DDL grep) | PASS — all 4 banned shapes absent, all 43 tables covered |
| E2E (web) | N/A |
| Load | N/A |
| Real-network smoke | N/A this child (no Brain runtime; honestly stated) |
| TypeScript (tsc --noEmit) | PASS — 0 errors |
| Metric registry TS↔Python parity | N/A — paradigm=sql, no metrics emitted this child |
| Trace IDs end-to-end | PARTIAL — ALS 4-tuple primitive present and tested; no runtime to trace through (N/A for this deliverable scope) |
| Operational-readiness | PASS — runbook gated, HOLD-AT-FORCE explicit |
| Mutation tests (high-stakes paths) | PARTIAL — requireRole covered; probe predicate NOT genuinely covered |
| Coverage ≥ 70% | FAIL — 62.8% lines (threshold: 70%) |

---

## 10. Verdict

**BOUNCE** — to @vikram (backend-developer).

Blocking findings (must-fix-now):

1. **F1 (CRITICAL):** Integration test must use a non-BYPASSRLS Postgres role. Add `CREATE ROLE rls_test_role NOINHERIT NOBYPASSRLS; GRANT SELECT, INSERT, UPDATE, DELETE ON rls_test_table TO rls_test_role;` in `setupSchema()` and connect the test's isolation assertions via `rls_test_role` credentials. The session-SET proof and tx-local tests can remain on `postgres`.

2. **F2 (HIGH):** Replace `bitnami/pgbouncer:1.23.1` in `docker-compose.test.yml` with a pullable image (e.g. `edoburu/pgbouncer`, or the official pgbouncer image with correct entrypoint and `pool_mode = transaction` config). Alternatively use `pgbouncer/pgbouncer:latest` with a custom config file that correctly sets `pool_mode = transaction` and `auth_type = md5` (not `any`).

3. **F3 (HIGH):** Fix `probeTable()` contextless arm in `rls-probe.ts`. Replace the `withSuperadmin()` fake path with a genuinely context-less query using a raw pool client (no `set_config` in the transaction). The module's `getPool()` function is private but can be extracted or a separate bare-pool exported for the probe's contextless check.

4. **F4 (HIGH):** Add unit tests for `runRlsProbe()` with a mocked pool (as in workspace-context.test.ts pattern). At minimum: mock `withWorkspace`/`withSuperadmin` to return controlled counts, assert GREEN predicate fires. Bring coverage to ≥70% on lines, functions, and branches.

5. **F5 (MEDIUM — treat as must-fix given mutation-testing mandate):** Add a direct unit test for the `&&` predicate in `rls-probe.ts:220` that exercises the actual code, not a pre-built fixture. E.g. mock the pool and assert that a `crossReadCount > 0` response from the mock causes verdict to be `RED`.

mode: parallel-review (did not advance)

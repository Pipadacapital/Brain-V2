# QA Re-Review (Round 2) — feat-tenancy-rls-brain-native

> Stage 5 (QA) — Round 2 — Parallel review mode. Reviewer: Tanvi (qa-agent).
> Shreya reviewing concurrently. Orchestrator reconciles both.
> Timestamp: 2026-05-24T12:32:00Z

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-brain-native` |
| **Stage** | 5 (QA) — Re-review round 2 |
| **Mode** | PARALLEL REVIEW (did not advance; orchestrator reconciles with Shreya) |
| **Reviewer** | Tanvi (qa-agent) |
| **Lane** | high-stakes |
| **Round-1 verdict** | BOUNCE (F1 CRITICAL/VETO + F2/F3/F4 HIGH + F5 MEDIUM) |
| **Round-2 verdict** | **PASS** |

---

## Stage 4 skip acknowledgment

Stage 4 (Shreya) runs concurrently in parallel mode — not skipped. Per mandatory skip protocol, I re-ran the secrets grep myself on the staged diff:

```
git -C /Users/rishabhporwal/Desktop/Brain diff --cached | grep -iE 'password|secret|api[_-]?key|bearer|aws_|sk-[a-zA-Z0-9]+|ghp_'
```

**Hits (all assessed CLEAN):**
- `POSTGRES_PASSWORD: postgres` — docker-compose.test.yml standard local test credential
- `DB_PASSWORD: rls_app_pw` — docker-compose.test.yml pgbouncer config, local test credential only
- `PASSWORD 'rls_app_pw'` — docker/initdb/01-create-rls-app-role.sql, local test role, no production system
- `DIRECT_URL="postgres://rls_test_role:password@host:5432/brain"` — rollout-runbook.sh comment placeholder

**Assessment: CLEAN.** All four hits are test infrastructure credentials or comment placeholders. No production API keys, bearer tokens, AWS credentials, or real service secrets.

---

## 1. Unit test suite + TypeScript (re-run myself)

**Command:** `cd /Users/rishabhporwal/Desktop/Brain/apps/core-service && pnpm test`

**Captured output (summary):**

```
 RUN  v4.1.7 /Users/rishabhporwal/Desktop/Brain/apps/core-service

[brain-claim.test.ts — 15 tests PASS]
[rls-ddl-static.test.ts — 102 tests PASS]
[session-scoped-fanout.test.ts — 8 tests PASS]
[probe-verdict.test.ts — 19 tests PASS (incl. F5 mutation-target tests)]
[workspace-context.test.ts — 13 tests PASS]
[pool-isolation.test.ts — 1 skipped (INTEGRATION_TEST != true)]

 Test Files  6 passed (6)
      Tests  158 passed | 9 skipped (167)
   Start at  16:29:44
   Duration  136ms
```

**TypeScript:** `node_modules/.bin/tsc --noEmit` — exit 0, 0 errors.

**Builder claimed:** 158 pass / 9 skipped / 167 total / tsc clean — **CONFIRMED.**

---

## 2. F1 (CRITICAL VETO) — Headline integration gate (re-run myself)

**What was broken (round 1):** Integration tests ran all RLS assertions as `postgres` (rolbypassrls=true). BYPASSRLS unconditionally bypasses FORCE RLS. Every isolation assertion failed for the wrong reason.

**Vikram's fix:** Created `docker/initdb/01-create-rls-app-role.sql` — provisions `rls_app` role with `NOINHERIT NOSUPERUSER` (rolbypassrls=false by default). Integration test now splits: superuser (`postgres`) for DDL only; `rls_app` for ALL isolation assertions. `assertNonBypassRls()` guard in `beforeAll` blocks the suite if pointed at a BYPASSRLS role.

**Replaced docker image:** `bitnami/pgbouncer:1.23.1` (F2 — unavailable) replaced with `edoburu/pgbouncer:latest` (ARM64 multi-arch, AUTH_TYPE=scram-sha-256 matching postgres 16 default).

### Integration test run — commands I ran

```bash
# 1. Start stack
DOCKER_HOST=unix:///Users/rishabhporwal/.docker/run/docker.sock \
docker compose -f apps/core-service/docker-compose.test.yml up -d
# Both containers healthy (postgres:healthy, pgbouncer:healthy)

# 2. Run integration test as rls_app
TEST_SUPER_URL="postgresql://postgres:postgres@localhost:5433/brain_test" \
TEST_SESSION_URL="postgresql://rls_app:rls_app_pw@localhost:5433/brain_test" \
TEST_POOLED_URL="postgresql://rls_app:rls_app_pw@localhost:6544/brain_test" \
INTEGRATION_TEST=true \
pnpm test src/__tests__/integration/pool-isolation.test.ts
```

### Captured output:

```
 RUN  v4.1.7 /Users/rishabhporwal/Desktop/Brain/apps/core-service

 ✓ LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a) > (production-correctness) rls_app role has rolbypassrls=false 1ms
 ✓ LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a) > (a) No cross-workspace context leak > ALPHA context sees ONLY ALPHA rows (2) 2ms
 ✓ LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a) > (a) No cross-workspace context leak > BETA context sees ONLY BETA rows (1) 1ms
 ✓ LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a) > (a) No cross-workspace context leak > interleaved concurrent ALPHA+BETA via pgbouncer each see only their rows 26ms
 ✓ LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a) > (b) Context clears at transaction end > after ALPHA tx commits, same pooled connection with no context returns 0 rows 1ms
 ✓ LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a) > (c) Session-SET negative control (WHY session-SET is banned) > session-SET leaks across pool -- demonstrating the banned shape risk 1ms
 ✓ LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a) > (c) Session-SET negative control (WHY session-SET is banned) > tx-local set_config (the approved pattern) does NOT leak across statements 1ms
 ✓ LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a) > (d) Fail-closed default (CF-C1-RLS-DEFAULT-1.a) > context-less query returns 0 rows via rls_app session pool (fail-closed) 0ms
 ✓ LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a) > (d) Fail-closed default (CF-C1-RLS-DEFAULT-1.a) > context-less query via pgbouncer pool also returns 0 rows 1ms
 ↓ pgbouncer integration tests (SKIPPED -- INTEGRATION_TEST != true) > pool-isolation tests are deferred to Stage-5 QA (Tanvi) with docker-compose

 Test Files  1 passed (1)
      Tests  9 passed | 1 skipped (10)
   Start at  16:30:53
   Duration  152ms
```

### assertNonBypassRls guard verification

I separately ran the integration test pointed at `postgres` (BYPASSRLS) to confirm the guard actually fires:

```bash
TEST_SESSION_URL="postgresql://postgres:postgres@localhost:5433/brain_test" \
TEST_POOLED_URL="postgresql://postgres:postgres@localhost:6544/brain_test" \
INTEGRATION_TEST=true pnpm test src/__tests__/integration/pool-isolation.test.ts
```

**Output:**

```
⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯

 FAIL  src/__tests__/integration/pool-isolation.test.ts > LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a)
Error: Integration test connected as a BYPASSRLS role -- RLS isolation assertions are unprovable.
 ❯ assertNonBypassRls src/__tests__/integration/pool-isolation.test.ts:171:13

 Test Files  1 failed (1)
      Tests  10 skipped (10)
```

**Guard fires correctly.** All tests are skipped and the suite errors when a BYPASSRLS role is used. Production corollary confirmed.

### Isolation assertions correctness

The ALPHA/BETA assertions pass for the RIGHT reason:
- `rls_app` has `rolbypassrls=false` (confirmed by the `(production-correctness)` test which queries `pg_roles`)
- `setupSchema()` applies `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ws_isolation ON rls_test_table USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)` + `FORCE ROW LEVEL SECURITY`
- ALPHA sees exactly 2 rows (seeded as ALPHA); BETA sees exactly 1 (seeded as BETA)
- The NULLIF(..., '') pattern handles empty-GUC correctly (returns NULL, not a UUID-cast error) — this is the production policy shape

**F1: RESOLVED.** Evidence: 9/9 PASS, rls_app confirmed non-BYPASSRLS, guard confirmed throws on postgres.

### Flakiness check (3x)

```
=== RUN 1 === Tests  9 passed | 1 skipped (10)
=== RUN 2 === Tests  9 passed | 1 skipped (10)
=== RUN 3 === Tests  9 passed | 1 skipped (10)
```

No flakiness detected.

---

## 3. F2 (HIGH) — pgbouncer image

**What was broken (round 1):** `bitnami/pgbouncer:1.23.1` unavailable on Docker Hub; `pgbouncer/pgbouncer:latest` had platform + auth incompatibilities (08P01 errors).

**Vikram's fix:** `edoburu/pgbouncer:latest` (ARM64 multi-arch), `AUTH_TYPE=scram-sha-256`.

**Verified by running:** Docker stack came up cleanly. `edoburu/pgbouncer:latest` pulled without errors. Both containers reached `healthy` state. Concurrent interleaved test (ALPHA+BETA via pgbouncer, 5 rounds) PASSED. Fail-closed via pooled connection PASSED.

**F2: RESOLVED.** Evidence: docker-compose up clean, `core-service-pgbouncer-1` healthy, all pgbouncer-path tests PASS.

---

## 4. F3 (HIGH) — contextless probe arm real (not fabricated)

**What was broken (round 1):** `probeTable()` contextless arm used `withSuperadmin(); return 0` — always returned 0 regardless of actual DB state. The probe could never detect a missing FORCE policy.

**Vikram's fix:** The contextless arm now calls `runner.rawQuery(...)` — a genuinely bare connection (no GUC, no `is_superadmin`). `_rawQuery` in `workspace-context.ts` asserts `rolbypassrls=false` at runtime and throws if the role is BYPASSRLS. Pre-FORCE: returns real count → probe RED → blocks FORCE. Post-FORCE: returns 0 → GREEN.

**Verified by code inspection:**
- `rls-probe.ts` lines 234-263: contextless arm calls `runner.rawQuery(...)` (not `withSuperadmin`)
- `workspace-context.ts` lines 117-143: `_rawQuery` queries `pg_roles WHERE rolname = current_user`, throws if `rolbypassrls=true`
- Old dead block (`withSuperadmin(); return 0` pattern at lines 186-216) is absent
- The only `return 0` remaining is line 231 — the TypeScript exhaustive-branch fallback inside the `crossReadCount` `withWorkspace` call for an unrecognized `entry.type`, which is unreachable in practice given the TypeScript union type

**Integration test confirms:** `context-less query returns 0 rows via rls_app session pool (fail-closed)` PASS and `context-less query via pgbouncer pool also returns 0 rows` PASS — these pass because `rls_app` (BYPASSRLS=false) with no GUC set returns 0 rows under FORCE RLS, not because the probe fabricated 0.

**F3: RESOLVED.**

---

## 5. F4 (HIGH) — coverage ≥ 70%

**What was broken (round 1):** 62.8% lines / 60.71% functions / 41.37% branches. `rls-probe.ts` had 21.81% coverage — `probeTable()`, `runRlsProbe()`, `writeProbeDecisionLog()` entirely untested at unit level.

**Vikram's fix:** `ProbeQueryRunner` injectable interface + `_setProbeQueryRunner`/`_resetProbeQueryRunner` hooks + `_runnerOverride` param. 19 new unit tests in `probe-verdict.test.ts` covering `probeTable` (direct/fk/fk2hop), `runRlsProbe` GREEN/RED transitions, `writeProbeDecisionLog` error-catch, rawQuery throw path, PROBE_TABLES count, runner injection hooks.

**Command run:** `cd /Users/rishabhporwal/Desktop/Brain/apps/core-service && pnpm test:coverage`

**Captured output (VERBATIM):**

```
 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   90.71 |    71.42 |   94.11 |   90.57 |
 application/cron  |      95 |    66.66 |     100 |      95 |
  ...ped-fanout.ts |      95 |    66.66 |     100 |      95 | 141
 infrastructure/db |   89.56 |    70.96 |   92.59 |   89.38 |
  rls-probe.ts     |   96.82 |    78.57 |   94.44 |   96.77 | 84,231
  ...ce-context.ts |   80.76 |       55 |   88.88 |   80.39 | 89,121-141
-------------------|---------|----------|---------|---------|-------------------

=============================== Coverage summary ===============================
Statements   : 90.71% ( 127/140 )
Branches     : 71.42% ( 50/70 )
Functions    : 94.11% ( 32/34 )
Lines        : 90.57% ( 125/138 )
================================================================================
(No threshold failures — all >= 70%)
```

**All four metrics ≥ 70%: Statements 90.71 / Branches 71.42 / Functions 94.11 / Lines 90.57.**

**F4: RESOLVED.** Builder's claimed numbers match exactly.

---

## 6. F5 (MEDIUM) — mutation target genuinely covered

**What was broken (round 1):** `probe-verdict.test.ts` used pre-built `ProbeTableResult` fixtures with `verdict: 'RED'` set directly — bypassing the live `&&` predicate at rls-probe.ts line 269. Flipping `&&` to `||` would not fail those tests.

**Vikram's fix:** Three `(F5-mutation-target)` tests use `runRlsProbe` via injectable runner with controlled counts, exercising the real predicate code:
- (a) `cross=0, ctxless=0` → expects GREEN (live predicate: `true && true` → GREEN)
- (b) `cross=1, ctxless=0` → expects RED (live predicate: `false && true` → RED)
- (c) `cross=0, ctxless=3` → expects RED (live predicate: `true && false` → RED)

**Mutation analysis — flip `&&` → `||` at rls-probe.ts:269:**
- Test (b): `cross=1, ctxless=0`. With `||`: `1===0 || 0===0` = `false || true` = true → GREEN. Test expects RED. **Test FAILS → mutant caught.**
- Test (c): `cross=0, ctxless=3`. With `||`: `0===0 || 3===0` = `true || false` = true → GREEN. Test expects RED. **Test FAILS → mutant caught.**

The `||` mutant is caught by at least 2 tests. The mutation coverage is GENUINE.

**F5: RESOLVED.**

---

## 7. No regression checks

| Check | Command | Result |
|-------|---------|--------|
| Banned shapes (OR/IS NULL, COALESCE, USING(true), session-SET) | `pnpm test src/__tests__/rls-ddl-static.test.ts` | 102 tests PASS |
| HOLD-AT-FORCE intact | rls-ddl-static.test.ts: `(+) step-b-force.sql header contains HELD / HOLD-AT-FORCE warning` | PASS |
| FORCE not flipped in step-a | rls-ddl-static.test.ts: static grep | PASS |
| Trace 4-tuple seeded | `correlationStore` ALS, `CorrelationContext` {requestId, traceId, workspaceId, userId} in workspace-context.ts | CONFIRMED present |
| Legacy files not staged | `git diff HEAD~1 HEAD --name-only \| grep "legacy project"` | 0 hits |
| TypeScript | `tsc --noEmit` | exit 0 |

---

## 8. Findings resolution table

| ID | Round-1 Severity | Resolution | Evidence |
|----|-----------------|------------|----------|
| **F1** | CRITICAL / QA VETO | **RESOLVED** | `rls_app` (rolbypassrls=false) role created via initdb SQL. Integration test uses `rls_app` for ALL isolation assertions. `assertNonBypassRls()` guard blocks suite if BYPASSRLS role used. 9/9 integration tests PASS. Guard confirmed throws when pointed at `postgres`. |
| **F2** | HIGH | **RESOLVED** | `edoburu/pgbouncer:latest` (ARM64, scram-sha-256) in docker-compose.test.yml. Stack pulled and came up healthy. All pgbouncer-path tests PASS including concurrent interleaved. |
| **F3** | HIGH | **RESOLVED** | `runner.rawQuery()` in contextless arm of `probeTable()`. `_rawQuery` in workspace-context.ts asserts `rolbypassrls=false` at runtime. Old `withSuperadmin(); return 0` dead block gone. Integration test fail-closed assertions PASS. |
| **F4** | HIGH | **RESOLVED** | Coverage: 90.71% stmts / 71.42% branches / 94.11% funcs / 90.57% lines. All ≥ 70%. ProbeQueryRunner injectable interface with 19 new unit tests. Captured verbatim. |
| **F5** | MEDIUM | **RESOLVED** | Three live-predicate tests call `runRlsProbe` via injectable runner. `&&`→`||` mutation caught by tests (b) and (c). Mutation analysis confirmed above. |

**No new findings identified.**

---

## 9. Gates (G5 conditions)

| Gate | Status | Evidence |
|------|--------|----------|
| Unit tests (158 pass / 0 fail) | **PASS** | Captured: 158 passed / 9 skipped / 167 total |
| Integration tests (CF-C1-POOL-1.a) — as rls_app | **PASS** | 9/9 PASS, 3x no-flake; BYPASSRLS guard confirmed |
| Contract tests (static DDL grep) | **PASS** | 102 rls-ddl-static tests PASS; 4 banned shapes absent |
| E2E (web) | N/A | No web UI this child |
| Load | N/A | Phase 3+ gate |
| Real-network smoke | **PASS (integration gate)** | Integration test IS the real-network smoke for this child — local Docker Postgres+pgbouncer stack, live RLS enforcement |
| TypeScript (tsc --noEmit) | **PASS** | exit 0, 0 errors |
| Metric registry TS↔Python parity | N/A | paradigm=sql, no metrics emitted |
| Trace IDs end-to-end | **PARTIAL — PASS for scope** | ALS 4-tuple present and tested; no runtime service this child; primitive seeded correctly |
| Operational-readiness | **PASS** | HOLD-AT-FORCE intact; runbook gated; DIRECT_URL assertion present |
| Mutation tests (high-stakes paths) | **PASS** | requireRole `>=` target: covered (round 1); probe `&&` target: genuinely covered (confirmed this round) |
| Coverage ≥ 70% all metrics | **PASS** | 90.71/71.42/94.11/90.57 — all ≥ 70% (verbatim capture) |
| No flaky tests (3x re-run) | **PASS** | Integration test: 3/3 consecutive 9/9 PASS |

---

## 10. Verdict

**PASS.**

All five must-fix findings from round 1 are verified resolved with captured evidence:
- F1 (CRITICAL VETO): integration test now structurally proves RLS isolation using a non-BYPASSRLS role
- F2 (HIGH): pgbouncer image pulled, stack healthy, all tests pass
- F3 (HIGH): contextless arm uses real rawQuery with BYPASSRLS runtime check
- F4 (HIGH): coverage 90.71%/71.42%/94.11%/90.57% — all ≥ 70%
- F5 (MEDIUM): live-predicate mutation tests catch `&&`→`||` flip

No new findings.

mode: parallel-review (did not advance)

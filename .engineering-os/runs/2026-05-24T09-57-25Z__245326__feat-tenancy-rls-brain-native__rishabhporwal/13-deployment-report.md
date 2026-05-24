# Deployment Report — feat-tenancy-rls-brain-native

> Filled by Jatin (platform-devops) in Stage 8.
> Mode: READINESS SLICE — deploy-class = db-ddl-migration (runbook-gated DDL).
> No live DDL applied. No runtime deployed. FORCE flip is HELD (HOLD-AT-FORCE).

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-brain-native` |
| **Actor** | platform-devops (Jatin) |
| **Timestamp (latest update)** | 2026-05-24T17:30:00Z |
| **Deploy class** | **db-ddl-migration** — manual runbook-gated DDL; no ArgoCD Application, no ECR image. The runbook (`rollout-runbook.sh`) IS the deploy artifact. The FORCE step is HELD (HOLD-AT-FORCE); this report covers readiness validation only. |

---

## 0. Deploy class (fast-path)

This change is a **db-ddl-migration** — Brain-native code (workspace-context primitive, RLS probe, auth-claim, cron fanout) plus manually-applied DDL (step-a-enable-create.sql, step-b-force.sql) gated behind a 6-step operator runbook. There is no Brain runtime service deployed. The rollout runbook is the deploy artifact.

**Sections that apply:** §1 (CI/build readiness — local), §5 (dashboards/alarms — defined as armed-at-rollout), §6 (release notes), §7 (runbook link).

**Sections N/A with reason:**
- §2 ArgoCD staging sync — no ArgoCD Application; no ECR image; DDL ships via operator-run psql.
- §3 Production ArgoCD sync + canary — same reason; FORCE is not yet run.
- §4 48h monitor — no runtime to monitor yet. Monitor plan is defined here as armed-at-rollout predicates (see §4-deferred).

---

## 1. CI / Build Readiness (local verification — no CI pipeline wired yet)

> No GitHub Actions pipeline exists for `core-service` yet (the service has not had a first runtime deploy). Pipeline wiring is a future task identified below. CI verification was run locally against the feature branch, capturing output inline.

| Field | Value |
|-------|-------|
| **Pipeline** | Local (no GH Actions pipeline for core-service yet — see §1.5) |
| **URL** | N/A — local |
| **Outcome** | **PASS (all gates)** |
| Typecheck (`tsc --noEmit`) | **PASS** — exit 0, 0 errors |
| Unit tests (`pnpm test`) | **PASS** — 158 passed / 9 skipped / 0 failed (6 test files, 142ms) |
| Integration tests (Docker stack) | **PASS** — 9/9 (pool-isolation.test.ts with edoburu/pgbouncer + rls_app role; requires `INTEGRATION_TEST=true` + docker-compose.test.yml stack; captured in 08b) |
| Coverage | **PASS** — Stmts 90.71% / Branch 71.42% / Funcs 94.11% / Lines 90.57% (all ≥ 70%) |
| Image push to ECR | **N/A** — no ECR image for this slice (no runtime service) |
| Fail-open pattern grep (executable DDL) | **PASS** — 0 hits of `USING(true)`, `COALESCE`, `OR ... IS NULL` on non-comment lines of step-a-enable-create.sql |
| Bash syntax (`bash -n rollout-runbook.sh`) | **PASS** — exit 0 |
| DDL symmetry | **PASS** — ENABLE 43 = FORCE 43 (step-b) = NO FORCE 43 (down) = DISABLE 44 (down; includes system tables) = DROP POLICY 45 (down; 42 ws_isolation + 2 superadmin_system_rows dual + 1 superadmin_only). Rohan independently confirmed ENABLE 43 = FORCE 43 = NO-FORCE 43 = DISABLE 43 on executable set; CREATE POLICY 45 = DROP POLICY 45. |

### 1.1 Captured: typecheck
```
cd apps/core-service && node_modules/.bin/tsc --noEmit
(exit 0, 0 errors)
```

### 1.2 Captured: unit suite
```
cd apps/core-service && pnpm test

Test Files  6 passed (6)
     Tests  158 passed | 9 skipped (167)
  Duration  142ms
```

### 1.3 Integration test command (requires Docker stack)
```bash
# Start stack first (~15s for healthy):
docker-compose -f apps/core-service/docker-compose.test.yml up -d

# Run integration tests as rls_app (non-BYPASSRLS role):
TEST_SUPER_URL="postgresql://postgres:postgres@localhost:5433/brain_test" \
TEST_SESSION_URL="postgresql://rls_app:rls_app_pw@localhost:5433/brain_test" \
TEST_POOLED_URL="postgresql://rls_app:rls_app_pw@localhost:6544/brain_test" \
INTEGRATION_TEST=true pnpm test apps/core-service/src/__tests__/integration/pool-isolation.test.ts

# Teardown:
docker-compose -f apps/core-service/docker-compose.test.yml down -v
```
Results captured in 08b: 9/9 PASS (no skips). Critical gates: rls_app rolbypassrls=false asserted; ALPHA sees only ALPHA rows; BETA sees only BETA rows; pooled connection returns 0 rows contextless (fail-closed).

### 1.4 Fail-open pattern verification (captured)
```bash
grep -vE '^\s*--' apps/core-service/migrations/manual/rls/step-a-enable-create.sql \
  | grep -cE 'USING\s*\(true\)|COALESCE|OR.*IS NULL'
# Result: 0 (exit 1 = count 0 — no fail-open patterns in executable lines)
```

### 1.5 Future pipeline wiring (noted, not built now — day-one rule for first runtime deploy)

When `core-service` has its first runtime deploy (likely at Child-3 when the context-aware consumer goes live), the following must be created on that same day:
- GitHub Actions workflow: affected-build (`turbo --affected --filter=core-service`), Docker build, ECR push.
- Own ArgoCD Application for `core-service`.
- Canary rollout configuration (10% → 25% → 50% → 100%).
- Health-check endpoint (`/health`) and liveness/readiness probes (liveness must NOT depend on Postgres — restart-loop risk).
- Auto-rollback alarms (p95 > 2s, error rate > 1%).
- CloudWatch dashboard + Sentry DSN.
- OTel → X-Ray/CloudWatch trace pipeline wired and verified.

These are explicitly **not built now** — this slice ships no runtime service. Building them now would be over-build against the HOLD-AT-FORCE state.

---

## 2. Staging deploy

**N/A — no ArgoCD Application, no ECR image.** DDL ships via operator-run psql against the Supabase Postgres instance (ap-south-1). There is no staging environment separate from the single Supabase instance at this phase.

---

## 3. Production deploy

**N/A — FORCE flip HELD (HOLD-AT-FORCE).** The live FORCE ceremony is a separate Founder-gated action. What follows is the pre-recorded rollback plan.

### Consuming services note
This is a library/DDL slice — Brain code ships with the consuming service's next deploy. The consuming service (`core-service`) has no independent deploy yet; its first runtime deploy (Child-3 or equivalent) will inherit the primitive.

### Rollback plan (pre-recorded, permanent reference)

The rollback path is **DDL-only** — there is no feature flag to flip.

**Post-ENABLE, pre-FORCE (if probe is RED or STEP 3 fails):**
```bash
psql "$DIRECT_URL" --file apps/core-service/migrations/manual/rls/down.sql
# Verify: SELECT COUNT(*) FROM pg_policies WHERE policyname = 'ws_isolation';
# Expected: 0
```
`down.sql` is idempotent (`DROP POLICY IF EXISTS`). After rollback, the legacy app-layer `workspaceId` middleware filter remains active — no isolation regression below the pre-RLS baseline.

**Post-FORCE (if STEP 6 smoke fails):**
Same `down.sql` — NO FORCE + DISABLE + DROP POLICY in that order. The `down.sql` sequence is: `NO FORCE → DISABLE → DROP POLICY IF EXISTS`. Fully symmetric with step-a + step-b.

**Why this is reversible:** no live DDL has been applied by this Stage-8 readiness slice. The code changes (workspace-context.ts, rls-probe.ts, brain-claim.ts, session-scoped-fanout.ts) are additive Brain-native code — no existing path is modified; removing them is a `git restore`. The DDL files are authored but not applied to any live database.

---

## 4. Deploy-gate ledger — Rohan's 11-row table: status as of Stage 8 readiness

> Source: `11-final-review.md` §Deploy-gate ledger. Each row mapped to READY / HELD / DEFERRED-TO-ROLLOUT.

| # | Stage-8 live predicate | Status | Validated how |
|---|------------------------|--------|---------------|
| 1 | **Region assert ap-south-1** on BOTH `:6543` + `:5432` via `inet_server_addr()`, same-backend cross-check | **DEFERRED-TO-ROLLOUT-WINDOW** | Cannot reach live DB from this environment. Runbook STEP 0 implements it correctly (verified syntactically + logically). Exact commands documented in §4a below. |
| 2 | **Quiesce crons** before ENABLE *and* before FORCE | **READY-IN-RUNBOOK** | Runbook STEP 1 (before ENABLE) + STEP 5 re-confirm (before FORCE) both present with `confirm()` gates. Verified lines 75-77 + 198. CF-C1-ROLLOUT-ORDER-1 sharpened. |
| 3 | **ENABLE + CREATE** fail-closed policies | **READY-IN-RUNBOOK** | step-a-enable-create.sql: 43 ENABLE + 45 CREATE POLICY statements, 0 fail-open patterns in executable lines. Bash syntax PASS. STEP 3 applies via `psql "$DIRECT_URL" --file step-a-enable-create.sql`; policy count post-apply asserted ≥ 43. |
| 4 | **Live CF-SEC-1 probe GREEN** on non-bypass role | **DEFERRED-TO-ROLLOUT-WINDOW** | Probe code is structurally correct and independently mutation-verified (Rohan check #4; &&→\|\| fails 3 tests). No live DB to run it against. Exact command in §4a. MED-2 (sentinel user_id FK) must also be verified before live probe. |
| 5 | **FK-scope live EXPLAIN gate** per hot table | **DEFERRED-TO-ROLLOUT-WINDOW** | Runbook STEP 2.5 documents the exact EXPLAIN queries. Operator must run and confirm cost is acceptable or denorm has been applied. shopify_orders + shopify_line_items are the hot tables. |
| 6 | **Complete bare-write grep = ZERO hits** (must include backfill/discoverChannels — R-O7) | **DEFERRED-TO-ROLLOUT-WINDOW** | Grep command documented in runbook STEP 5 (lines 183-188). Must be run against the live monorepo state at rollout time, not validated now (source changes between now and Child-3). |
| 7 | **Child-3 residual-writer conversion** complete | **HELD — cross-child gate** | This is the primary HOLD-AT-FORCE blocker. Child-3's scope is to convert all bare-write paths (discoverChannels, backfill*, cron.ts:249, meta.ts:192 catch, shopify/sync.ts, webhooks.ts, woocommerce-sync.ts, all route-handler connection writes). Gate does not unlock until Child-3 ships + grep is ZERO. |
| 8 | **FORCE flip** (step-b-force.sql, 43 tables) | **HELD — Founder + CTO-Advisor sign-off required** | step-b-force.sql HELD header intact (verified: lines 1-21 present with all 5 pre-conditions). NOT run this Stage 8. The confirm() gate at runbook STEP 5 line 195 requires explicit operator acknowledgment of all conditions AND Founder/CTOA sign-off. Cannot be accidentally triggered. |
| 9 | **Byte-identical smoke + re-probe** post-FORCE | **DEFERRED-TO-ROLLOUT-WINDOW** | Runbook STEP 6 documents the re-probe + byte-identical corpus smoke. No runtime to run against now. |
| 10 | **CF-SEC-3.HARD re-arm** before third-party-brand PII | **CARRIED-CONSTRAINT** | Not a Stage-8 action. Must be live before Child-3 onboards a non-Founder brand. State + plan §11 carry this verbatim. |
| 11 | **MED-2 sentinel user_id FK** existence verified | **DEFERRED-TO-ROLLOUT-WINDOW** | Must check that a `users` row with id `00000000-0000-0000-0000-000000000001` exists before the live probe write. Non-blocking now (no live probe run). |

**Summary:** 2 rows READY-IN-RUNBOOK (quiesce, DDL), 1 HELD (FORCE flip — requires Founder+CTOA sign-off), 1 HELD cross-child (Child-3 residual-writer conversion), 7 DEFERRED-TO-ROLLOUT-WINDOW (require live DB access). Zero rows are FAILED — all deferred items have concrete predicates + runbook commands.

### 4a. Deferred-to-rollout predicates (exact commands)

**Row 1 — Region assert:**
```bash
# Run at rollout window before any DDL:
POOLED_ADDR=$(psql "$DATABASE_URL" -tAc "SELECT inet_server_addr()" 2>/dev/null || echo "FAIL")
DIRECT_ADDR=$(psql "$DIRECT_URL"   -tAc "SELECT inet_server_addr()" 2>/dev/null || echo "FAIL")
[[ "$POOLED_ADDR" == "$DIRECT_ADDR" ]] || exit 1  # same backend
# Confirm ap-south-1 via Supabase console (timezone alone is not reliable)
```
Pass condition: both addrs identical AND operator confirms ap-south-1 on Supabase console.

**Row 4 — CF-SEC-1 probe (pre-FORCE, after STEP 3):**
```bash
DIRECT_URL="postgres://rls_app:${RLS_APP_PW}@${HOST}:5432/postgres" \
ALPHA_WORKSPACE_ID="${ALPHA_WS}" BETA_WORKSPACE_ID="${BETA_WS}" node -e "
  const {runRlsProbe,formatProbeResult} = require('./apps/core-service/dist/infrastructure/db/rls-probe');
  runRlsProbe({alphaWorkspaceId:process.env.ALPHA_WORKSPACE_ID, betaWorkspaceId:process.env.BETA_WORKSPACE_ID})
    .then(r => { console.log(formatProbeResult(r)); process.exit(r.overallVerdict==='GREEN' ? 0 : 1); })
"
```
Pass condition: exit 0, overallVerdict=GREEN, crossRead=0 AND contextless=0 per table.
Pre-condition: MED-2 sentinel user_id FK must exist, or probe Decision-Log write must be relaxed (FK dropped or sentinel row inserted).

**Row 5 — FK EXPLAIN gate:**
```bash
psql "$DIRECT_URL" -c "EXPLAIN(ANALYZE,BUFFERS,FORMAT TEXT) SELECT COUNT(*) FROM shopify_orders WHERE connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = '${ALPHA_WS}'::uuid)"
psql "$DIRECT_URL" -c "EXPLAIN(ANALYZE,BUFFERS,FORMAT TEXT) SELECT COUNT(*) FROM shopify_line_items WHERE connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = '${ALPHA_WS}'::uuid)"
```
Pass condition: seq-scan cost acceptable OR workspace_id denorm + CONCURRENTLY index applied + IS-NULL=0 verified.

**Row 6 — Complete bare-write grep (R-O7 corrected):**
```bash
grep -rn "prisma\.\|db\.\|pool\." apps/core-service/src/ \
  | grep -v "withWorkspace\|withSuperadmin\|//\|\.test\.\|\.spec\."
# NOTE: backfill and discoverChannels MUST appear — do NOT grep -v them (R-O7)
```
Pass condition: zero matching lines after Child-3 conversion.

**Row 11 — MED-2 sentinel FK:**
```bash
psql "$DIRECT_URL" -tAc "SELECT COUNT(*) FROM users WHERE id = '00000000-0000-0000-0000-000000000001'"
# Expected: 1. If 0: INSERT sentinel row OR drop audit_logs.user_id FK before probe.
```

---

## 4-deferred. 48h monitor plan (armed at rollout, not now)

No runtime to monitor at this stage. The following alarms and SLOs are DEFINED here and WILL be armed at the live FORCE rollout window. They are not armed now.

| Alarm | Trigger | Action | Armed at |
|-------|---------|--------|---------|
| **Probe-RED alarm** | CF-SEC-1 probe returns RED at H+2/H+24/H+48 scheduled re-run | Page on-call; halt further schema changes; evaluate rollback via down.sql | Live rollout window |
| **Cron attempt-vs-connected gap** | cron proof-of-attempt log emits workspace_id but session `app.workspace_id` GUC not set (ctxless > 0 in probe at next re-run) | Investigate cron quiesce failure; rollback if persistent | Live rollout window |
| **0-rows outage canary** | Any workspace-scoped API endpoint returns empty result set for a workspace with known data for > 2 consecutive minutes post-FORCE | Immediate rollback via down.sql; page Founder | Live rollout window |
| **p95 latency** | > 2s for 5 min | Roll back | At first runtime deploy (not this slice) |
| **Error rate** | > 1% for 5 min | Roll back | At first runtime deploy (not this slice) |

**48h re-probe schedule:** H+2, H+24, H+48 post-FORCE. Each re-probe runs the CF-SEC-1 probe against a non-BYPASSRLS role and confirms GREEN. If any re-probe returns RED: halt, page on-call, evaluate rollback.

**SLOs that apply post-FORCE:**
- Cross-workspace read isolation: cross=0 per table (hard zero; not a SLO percentage — any non-zero is a P0).
- Contextless isolation: contextless=0 per table post-FORCE (hard zero; any non-zero = P0 regression).
- p95 latency: < 2s (applies at first Brain runtime deploy, not this DDL-only slice).

---

## 5. Dashboard + alarms

**No runtime dashboards or alarms armed now.** There is no Brain runtime service emitting metrics. This is proportionate — a dashboard would be over-build against a HOLD-AT-FORCE state (as Rohan confirmed in his observability sub-review).

**What IS the observability signal at runbook execution:**
- `rls-probe.ts` probe verdict gauge — written to Decision-Log on every probe run with the 4-tuple (workspace_id, correlationId, crossRead, verdict).
- Cron proof-of-attempt 4-tuple log — emitted by `session-scoped-fanout.ts` for every cron attempt.
- Runbook `log()` lines — timestamped machine-readable go/no-go at each step (STEP 0-6).

**Future (at first runtime deploy — day-one rule):**
- CloudWatch custom metric: `rls.probe.verdict` (GREEN=1 / RED=0).
- CloudWatch alarm on `rls.probe.verdict = 0` for 1 evaluation period.
- Sentry DSN wired for `core-service`.
- OTel → X-Ray/CloudWatch trace pipeline verified with a sample trace.

---

## 6. Release notes

**feat-tenancy-rls-brain-native — Brain-native C5 tenant isolation (SATISFIABLE state)**

This slice delivers the foundational tenant-isolation machinery for the Brain platform in `core-service`:

- **Session-context primitive** (`workspace-context.ts`): `withWorkspace` / `withSuperadmin` built once, consumed N times. Each call sets `app.workspace_id` as a tx-local GUC (not a session-level SET — leak-safe). The `_rawQuery` path asserts at runtime that the executing role has `rolbypassrls=false`.
- **43-table fail-closed RLS DDL** (`step-a-enable-create.sql`, `step-b-force.sql`): authored and verified, NOT yet applied to any live database. FORCE is deferred to the HOLD-AT-FORCE ceremony.
- **CF-SEC-1 verification probe** (`rls-probe.ts`): cross-workspace read isolation + contextless isolation probed per table; bi-conditional GREEN predicate mutation-verified.
- **Auth-claim contract** (`brain-claim.ts`): OWNER(5)/ADMIN(4)/ANALYST(3)/EDITOR(2)/VIEWER(1) ordering with `requireRole(>=)` guard.
- **Cron session-scoping** (`session-scoped-fanout.ts`): workspace enumeration under `withSuperadmin`; per-connection `withWorkspace` fan-out; proof-of-attempt 4-tuple logs.
- **6-step operator runbook** (`rollout-runbook.sh`): machine-asserting region check (both URLs), quiesce gates, probe GREEN-or-HALT, FORCE HELD with all 5 pre-conditions explicit.

**C5 gate state: SATISFIABLE.** The live FORCE flip is a separate Founder-gated action (HOLD-AT-FORCE). No PII processed, no live DDL applied, ₹0 incremental infra.

---

## 7. Runbook

`apps/core-service/migrations/manual/rls/rollout-runbook.sh`

Operator prerequisites: `psql` in PATH, `DATABASE_URL` (`:6543` pooled) and `DIRECT_URL` (`:5432` session-mode) set to Supabase ap-south-1, `ALPHA_WORKSPACE_ID` + `BETA_WORKSPACE_ID` set to test workspaces with known data. Node.js + compiled `core-service/dist` for the probe step.

**FORCE requires separate Founder + CTO-Advisor sign-off.** The runbook `confirm()` gate at STEP 5 enforces this interactively. The runbook cannot accidentally flip FORCE — the STEP 5 path requires a `yes` response to the sign-off confirm prompt; any other answer exits with HALT.

---

## 8. Rollout runbook validation — Jatin's static analysis (Stage 8 work product)

> This is what Stage 8 actually validated for this slice. Live DB execution is deferred (see §4a).

| Check | Result | Evidence |
|-------|--------|---------|
| Bash syntax clean | **PASS** | `bash -n rollout-runbook.sh` exit 0 |
| `set -euo pipefail` present | **PASS** | Line 23 |
| Required-env guards (`:?`) on all 4 vars | **PASS** | Lines 26-29: DATABASE_URL, DIRECT_URL, ALPHA_WORKSPACE_ID, BETA_WORKSPACE_ID |
| STEP-0 uses `inet_server_addr()` on BOTH `:6543` + `:5432` | **PASS** | Lines 47-55: pooled + direct both queried; addr equality asserted (`[[ "$POOLED_ADDR" == "$DIRECT_ADDR" ]]`); halts on mismatch |
| STEP-0 cannot be bypassed by DNS spoofing | **PASS** | Uses Postgres-level `inet_server_addr()`, not hostname/DNS. Operator confirm for region label (Supabase console cross-check). |
| Quiesce-crons at ENABLE (STEP 1) | **PASS** | Lines 75-77 with two `confirm()` gates (disable + drain) |
| Quiesce-crons re-confirmed at FORCE (STEP 5) | **PASS** | Line 198 — second `confirm()` before step-b-force.sql |
| STEP 3 verifies policy count post-ENABLE (≥43) | **PASS** | Lines 114-121: psql count query + `halt` if < 43 |
| STEP 4 probe is GREEN-or-HALT | **PASS** | Line 144: `confirm()` gate — operator must confirm GREEN before proceeding; runbook exits with HALT if not confirmed |
| STEP 5 HELD with Founder/CTOA sign-off gate | **PASS** | Line 195: `confirm()` gate with explicit "Founder+CTO-Advisor have signed off" language; `halt()` on any non-`yes` answer |
| STEP 5 cannot accidentally execute step-b-force.sql | **PASS** | The confirm() at line 195 is the only path to line 200. `set -euo pipefail` means any earlier failure aborts the script before reaching line 200. |
| R-O7 bare-write grep (backfill/discoverChannels not excluded) | **PASS** | Lines 165, 178, 188: explicit "do NOT grep -v backfill or grep -v discoverChannels" instruction with correct grep pattern |
| STEP 6 rollback reference | **PASS** | Lines 226-229: rollback command (`psql "$DIRECT_URL" --file down.sql`) and verify query present |
| shellcheck | **DEFERRED** — shellcheck not installed in this environment. Bash syntax validation via `bash -n` passed (exit 0). Shellcheck should be run in CI when the pipeline is wired. |
| FORCE cannot be auto-applied by any migration runner | **PASS** | CF-BN-DDL-GATING-1 header in step-b-force.sql line 15: "this file is NOT auto-applied by any migration runner". No Prisma migration runner, no automated apply path exists. |

---

## 9. Reversibility confirmation

**This Stage-8 readiness slice is fully reversible:**
- No DDL applied to any live database.
- No live database connections made (no psql against a live URL).
- Brain code changes are additive (new files only — workspace-context.ts, rls-probe.ts, brain-claim.ts, session-scoped-fanout.ts, docker-compose.test.yml, initdb role script).
- FORCE NOT run: step-b-force.sql HELD header confirmed intact.
- No legacy files touched: `git diff HEAD -- "legacy project/"` = empty (verified by Rohan check #5).
- No git commit by Jatin (product code staged by developer; commit requires explicit Founder "commit it").
- `down.sql` symmetry: NO FORCE 43 → DISABLE 44 → DROP POLICY 45 (IF EXISTS, idempotent). Fully reverses step-a + step-b.
- Reversibility of eventual live FORCE: `psql "$DIRECT_URL" --file down.sql` — idempotent, DDL-only, restores pre-RLS baseline; legacy app-layer workspaceId filter remains active post-rollback (no isolation regression).

---

## INTEGRITY GATES (A1-A8) — all captured

| Gate | Result |
|------|--------|
| A1 — tsc clean | PASS — exit 0, 0 errors |
| A2 — unit suite | PASS — 158 passed / 9 skipped / 0 failed |
| A3 — integration test (Docker) | PASS — 9/9 (captured in 08b; requires docker-compose.test.yml stack + INTEGRATION_TEST=true) |
| A4 — fail-open grep on executable DDL | PASS — 0 hits |
| A5 — bash -n (runbook syntax) | PASS — exit 0 |
| A6 — DDL symmetry | PASS — ENABLE 43 = FORCE 43 = NO FORCE 43 = DISABLE per-table; CREATE POLICY 45 = DROP POLICY 45 |
| A7 — FORCE not flipped | PASS — step-b-force.sql HELD header intact; no psql against any live URL with irreversible DDL |
| A8 — no legacy files touched | PASS — git diff HEAD -- "legacy project/" = empty |

# Stage 4 — Security RE-REVIEW (round 2) (Shreya)

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-brain-native` |
| **Stage** | 4 (security re-review, round 2) |
| **Mode** | **PARALLEL REVIEW** (Tanvi/QA concurrent) — did NOT advance the pipeline |
| **Timestamp** | 2026-05-24T16:35:00Z |
| **Lane** | high-stakes |
| **Paradigm** | sql (SQL/DDL + connection-handling; no ML/LLM) |
| **Round-1 verdict** | BOUNCE (HIGH-1: CF-SEC-1 contextless arm structurally inert) |
| **Round-2 verdict** | **PASS** |
| **Bounce-fix author** | backend-developer (@vikram) — report `08b-bounce-fix-report.md` |

---

## Change-class scope (declared FIRST)

Unchanged from round 1. SQL/DDL + connection-handling data-layer slice. Surfaces IN scope: multi-tenancy isolation (RLS), defense-in-depth (fail-closed SQL + injection), audit-log immutability, data-residency, auth/role-claim, traceability. ALWAYS-ON checks re-ran: vuln scan, secret-hygiene grep, supply-chain, input-validation. Money-derived code: N/A. Outbound/DLT/NCPR/calling-hours/WhatsApp/recording-consent: N/A — out of scope (no outbound channel). Prompt-injection: N/A — no LLM. PCI: N/A — no card data. DPDP §4 live PII processing: NOT triggered (probe/backfill Stage-8-deferred; FORCE HELD).

**Re-review delta scope:** the bounce-fix touched 7 files (`workspace-context.ts`, `rls-probe.ts`, `index.ts`, `probe-verdict.test.ts`, `pool-isolation.test.ts`, `docker-compose.test.yml`, NEW `docker/initdb/01-create-rls-app-role.sql`). I verified the HIGH-1 delta + the F1 non-BYPASSRLS security crux with my own captured evidence, and re-confirmed all prior-PASS items did not regress.

---

## Verdict: PASS

The single round-1 blocker (HIGH-1 / Tanvi's F3) is **genuinely resolved** — verified by independent code read **and** a live mutation test I ran myself (`&&`→`||` flip now fails 3 tests; in round 1 it failed none because the arm was a constant-true no-op). The F1 fix (non-BYPASSRLS `rls_app` role) is the security crux of the C5 gate and is correctly implemented with a runtime assertion + a proving test. Zero CRITICAL, zero HIGH, zero compliance violations, zero missing-traceability, zero new findings. **G4 PASSED.**

---

## Delta confirmation — each round-1 finding → resolved with my own evidence

### HIGH-1 / Tanvi F3 — CF-SEC-1 contextless arm now GENUINE — **RESOLVED**

The round-1 defect: `contextlessCount` was computed under `withSuperadmin` (RLS-bypassing), then hardcoded `return 0`; the dead `import().then` block existed; the `&& contextlessCount===0` term was constant-true; `formatProbeResult` printed a fabricated 0.

My captured evidence the fix is real:
1. **Genuine context-less query on a non-bypass connection.** `rls-probe.ts:245-263` now calls `runner.rawQuery(...)` → `_rawQuery` (`workspace-context.ts:117-143`), which acquires a raw pool client, sets **NO** `set_config` and **NO** `is_superadmin`, and returns the real `COUNT(*)`. `grep "withSuperadmin" rls-probe.ts` shows it appears ONLY in the Decision-Log write path (`:331`) and the runner type/default (`:77,:85`) — **not** in the contextless arm.
2. **Dead block gone.** `grep "import(.*).then" rls-probe.ts` → 0 hits. The only `return 0` occurrences (`:231`) is the legitimate fk/dual fall-through default in the cross-read branch, not a fabricated contextless value.
3. **Bi-conditional predicate genuinely live.** I mutated `rls-probe.ts:269` `&&`→`||`, ran `probe-verdict.test.ts`: **3 tests FAILED** — `(F5-mutation-target) RED when cross>0`, `(F5-mutation-target) RED when ctxless>0`, and `overallVerdict RED when ANY table fails`. Reverted. In round 1 the same flip failed **zero** tests. This proves `contextlessCount` is now a real term that can drive the verdict RED.
4. **Real count printed.** `formatProbeResult:378` prints `ctxless=${r.contextlessCount}` from the genuine `_rawQuery` result; no fabrication path remains.
5. **Pre/post-FORCE semantics correct.** Pre-FORCE: bare connection (owner subject only after FORCE) returns full count → RED → correctly BLOCKS FORCE at runbook STEP-4. Post-FORCE: no GUC → NULL ≠ any UUID → 0 rows → eligible GREEN. Documented `rls-probe.ts:234-244` and proven by integration test (item below).

### F1 — non-BYPASSRLS `rls_app` role (security crux of C5) — **RESOLVED & VALIDATED**

This is the property that makes FORCE meaningful: if Brain's app role could bypass RLS, FORCE is a no-op for Brain's own queries.
1. **Runtime assertion exists and throws hard.** `_rawQuery` (`workspace-context.ts:127-137`) runs `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user` and **throws** if `rolbypassrls=true`. The probe catches the throw and returns a hard RED (`rls-probe.ts:251-263`, `crossReadCount/contextlessCount = -1`, error message), correctly blocking FORCE on a misconfigured role.
2. **Throw path proven by test.** `probe-verdict.test.ts:221-234` `(-) RED when rawQuery throws (rolbypassrls=true production misconfiguration)` asserts overall RED + `errorMessage` contains `contextless-probe` + `contextlessCount===-1`. Passed in my run.
3. **initdb role correct.** `docker/initdb/01-create-rls-app-role.sql:17` — `CREATE ROLE rls_app WITH LOGIN PASSWORD '...' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE`. **NOSUPERUSER** → `rolbypassrls=false` by default; **no `BYPASSRLS` grant** anywhere in the file. Mirrors the production DIRECT_URL constraint.
4. **Integration test now proves isolation on the non-bypass role.** `pool-isolation.test.ts` splits a SUPERUSER pool (DDL/seed only, `:50`) from `rls_app` session+pooled pools (`:54,:57`) used for ALL isolation assertions. `beforeAll` runs `assertNonBypassRls(sessionPool)` (`:195`). The fail-closed contextless test (`:335-345`) and the post-commit context-clear test (`:257-278`) now assert `toBe(0)` against `rls_app` — structurally provable, unlike round 1 where they ran as `postgres` (BYPASSRLS). Vikram's captured run: 9/9 integration PASS.

### No new fail-open / injection — **CONFIRMED**
- **Banned patterns over executable DDL = 0.** `step-a-enable-create.sql`: the COALESCE/`OR..IS NULL`/`USING (true)` matches are ALL in the documentation comment block (lines 15-17, "BANNED shapes"); zero on executable lines (verified by stripping comment lines). `step-b-force.sql` + `down.sql`: 0 of every banned pattern. 91 `current_setting(..., true)` (missing_ok=true → unset GUC = NULL = fail-closed).
- **`_rawQuery` is parameterized.** Signature `(text, params?)`; the call passes `client.query(text, params)` with bind params; the only string-built query in the probe is the table name from the **static** `PROBE_TABLES` allow-list (`"${table}"` double-quoted identifier, no user input). No interpolation of values.
- **Context still scrubs.** `withWorkspace` (`:193-200`) sets `app.workspace_id` via bind-param `$1` tx-local AND explicitly clears `is_superadmin='false'`; `withSuperadmin` (`:242-248`) sets `is_superadmin='true'` AND clears `app.workspace_id=''`. tx-local (3rd arg `true`) → scrubbed at COMMIT/ROLLBACK.

### No regression on prior-PASS items — **CONFIRMED**
- **CF-BN-NOLEGACY-1:** `git diff --cached --name-only | grep "legacy project"` → empty.
- **CF-BN-SHAPE-A-1 / DDL-GATING-1:** `step-b-force.sql` header intact — "Runbook: STEP 5 — HELD"; runbook STEP-5 HELD with `confirm` gates + Founder/CTO sign-off prerequisite; no migration runner path. FORCE not flipped.
- **Residency CF-RES-1.a:** runbook STEP-0 asserts region on BOTH `DATABASE_URL`(:6543) + `DIRECT_URL`(:5432) via Postgres `inet_server_addr()` (not DNS-trusted).
- **Dual-policy CF-C1-AUDITLOG-1.a:** `ws_isolation` + `superadmin_system_rows` on both audit_logs and notifications intact (`step-a:265-278`).
- **Auth CF (requireRole):** `brain-claim.ts` 5-level ordering OWNER5..VIEWER1, `>=` guard load-bearing (mutation target). Unchanged this round; tests pass.
- **Traceability CF-SEC-5:** correlation 4-tuple `{requestId,traceId,workspaceId,userId}` via ALS; threaded into probe result, Decision-Log metadata, cron. Unchanged; the new `_rawQuery` runs inside the existing pool under the ambient ALS context.
- **withSuperadmin call-sites:** only cron fan-out + probe (Decision-Log) + barrel re-export. No new privileged call-site.

### MED-1 (formatProbeResult ctxless label) — **CLOSED** by the HIGH-1 "preferred" fix. `formatProbeResult` now prints a real `ctxless=N` from a genuine query; no "deferred"/fabricated marker needed.

### MED-2 (probe Decision-Log user_id sentinel FK) — **STILL NON-BLOCKING.** `rls-probe.ts:333-341` still inserts sentinel `00000000-…-001` as `user_id`; comment acknowledges FK existence must be verified before the Stage-8 live probe run. No live write occurs this child (FORCE HELD). Carry to Stage-8.

### LOW-1 (test-only exports in prod barrel) — **STILL NON-BLOCKING.** `index.ts:15-18` exports `_setPoolForTest`/`_resetPoolForTest`/`_rawQuery` underscore-prefixed + commented probe/test-only. `_rawQuery` has a STATIC-GATE comment ("only rls-probe.ts may call this"). Convention acceptable; `@internal`/lint rule remains tech debt.

### Secret hygiene — **CLEAN.** Full staged-diff scan: only local test creds (`postgres:postgres`, `rls_app:rls_app_pw`) in docker-compose/initdb, a comment placeholder URL in the runbook, and decision-log/audit JSON metadata (not secrets). No `.env`/`.pem`/`.key`/real API keys/tokens staged.

---

## Verification evidence (captured this round, not taken on faith)

- **Test suite:** `pnpm test` → **158 passed / 0 failed / 9 skipped** (6/6 files). `tsc --noEmit` → exit 0, 0 errors.
- **Mutation proof (HIGH-1 crux):** flipped `rls-probe.ts:269` `&&`→`||` → **3 tests FAILED** (cross>0 RED, ctxless>0 RED, any-RED). Reverted to `&&`. (Round 1: same flip failed 0 tests.)
- **Vuln scan:** `pnpm audit --prod` → **No known vulnerabilities found.** (Node-engine WARN only; not a vuln. No `.py` staged → Python scanners N/A.)
- **Banned-pattern grep:** 0 on executable DDL across step-a/step-b/down (matches are doc-comment only).
- **Bind-param / injection:** `_rawQuery` parameterized; identifiers from static allow-list only.
- **Role:** `rls_app` = NOSUPERUSER, no BYPASSRLS grant; `_rawQuery` + integration test both assert `rolbypassrls=false` and throw/fail otherwise.
- **Legacy:** 0 files under `legacy project/` staged.
- **FORCE:** step-b HELD header intact; runbook STEP-5 HELD; force_NOT_run_this_child=true.

---

## Compliance gates

| Gate | Status |
|------|--------|
| DPDP (consent/minimization/retention/erasure/residency) | **PASS** — slice purpose IS §8(6) cross-tenant isolation; residency ap-south-1 asserted (Stage-8); no live PII this run; CF-SEC-3.HARD correctly not-triggered, re-arms before 3rd-party PII. |
| DLT / NCPR / DND / 9am–9pm / 48h cap | **N/A** — no outbound channel. |
| WhatsApp opt-in/template/window | **N/A** — no messaging. |
| AI-voice disclosure / recording consent | **N/A** — no voice/recording. |
| UAE/KSA PDPL | **N/A** — region-agnostic primitive; ap-south-1 only. |

**Zero compliance violations.**

---

## Gate (G4)

- [x] Zero CRITICAL
- [x] **Zero HIGH** (HIGH-1 resolved + independently verified by mutation test)
- [x] Zero compliance violations
- [x] Zero missing-traceability (correlation 4-tuple intact; `_rawQuery` runs under ambient ALS)
- [x] Every mutation endpoint guarded — N/A (no endpoints this slice)
- [x] Every MCP tool tenant-checked — N/A (no MCP this slice)
- [x] Every connector OAuth/webhook — N/A this slice
- [x] PII not in logs (sampled — no PII surface; correlation carries IDs not PII)
- [x] Vuln scans CLEAN on CRITICAL/HIGH

**G4 = PASSED.**

---

## NEW findings (this round)

**None.** No new CRITICAL/HIGH/MED/LOW introduced by the bounce-fix. The 7 changed files are tightly scoped to the HIGH-1/F1 remediation; the security surface (banned patterns, injection, residency, dual-policy, auth, traceability, FORCE-held) is unchanged or improved.

---

## HANDOFF

```
verdict: PASS
mode: parallel-review (did not advance)
delta_confirmation:
  - HIGH-1 / F3 (CF-SEC-1 contextless arm): RESOLVED — genuine _rawQuery on non-bypass conn; dead block gone; predicate bi-conditional (mutation && -> || now fails 3 tests; was 0); formatProbeResult prints real ctxless=N.
  - F1 (non-BYPASSRLS rls_app): RESOLVED & VALIDATED — _rawQuery asserts rolbypassrls=false + throws hard; throw path proven by unit test; initdb rls_app = NOSUPERUSER, no BYPASSRLS grant; integration test proves isolation on the non-bypass role (9/9 PASS per builder).
  - No new fail-open/injection: CONFIRMED — 0 executable banned patterns; _rawQuery parameterized; context scrubs.
  - No regression: CONFIRMED — NOLEGACY (0 staged), FORCE HELD, residency STEP-0 both URLs, dual-policy, auth >= guard, correlation 4-tuple all intact.
  - MED-1: CLOSED by HIGH-1 fix.
  - MED-2 (sentinel user_id FK at Stage-8): still NON-BLOCKING — verify before Stage-8 live probe.
  - LOW-1 (test-only barrel exports): still NON-BLOCKING — tech debt.
  - Secret hygiene: CLEAN.
new_findings: none
evidence: 158 pass/0 fail/9 skip; tsc 0; mutation &&->|| fails 3 tests (reverted); pnpm audit --prod clean; 0 executable banned patterns; rls_app NOSUPERUSER.
note: All CF-* PASS. G4 PASSED. Orchestrator reconciles with Tanvi's round-2 QA.
```

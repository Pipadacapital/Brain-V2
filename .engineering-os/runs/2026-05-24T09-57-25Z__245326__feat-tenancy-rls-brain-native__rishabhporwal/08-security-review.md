# Stage 4 — Security Review (Shreya)

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-brain-native` |
| **Stage** | 4 (security review) |
| **Mode** | **PARALLEL REVIEW** (Tanvi/QA concurrent) — did NOT advance the pipeline |
| **Timestamp** | 2026-05-24T14:42:00Z |
| **Lane** | high-stakes |
| **Paradigm** | sql (SQL/DDL + connection-handling; no ML/LLM) |
| **Verdict** | **BOUNCE** (1 HIGH — must-fix-now) |
| **Bounce target** | backend-developer (@vikram) |

---

## Change-class scope (declared FIRST)

SQL/DDL + connection-handling data-layer slice. Surfaces IN scope: **multi-tenancy isolation (RLS), defense-in-depth (fail-closed SQL + injection), audit-log immutability, data-residency, auth/role-claim, traceability.** ALWAYS-ON checks ran: vuln scan (`pnpm audit --prod`), secret-hygiene grep, supply-chain, input-validation (UUID guard + bind-param). Money-derived code: **N/A** (no money types introduced; minor-units seam not touched — confirmed). Outbound-channel / DLT / NCPR / calling-hours / WhatsApp / recording-consent: **N/A — out of scope (no outbound channel in this slice; plan §12 confirms).** Prompt-injection: **N/A — no LLM.** PCI: **N/A — no card data.** DPDP §4 live PII processing: **NOT triggered this run** (probe/backfill Stage-8-deferred; Founder owns Sugandh Lok; CF-SEC-3.HARD re-arms before 3rd-party PII — verified correct, see §Compliance).

---

## Verdict: BOUNCE

One **HIGH** finding (must-fix-now per the shared severity rubric). Zero CRITICAL. Zero compliance violations. Zero missing-traceability. The RLS DDL, session-context primitive, auth-claim, cron fan-out, runbook, residency asserts, and audit dual-policy are **excellent and correct**. The single blocker is the **CF-SEC-1 probe's contextless arm**, which is structurally inert — it cannot verify the fail-closed invariant it exists to verify.

---

## Findings

### HIGH-1 — CF-SEC-1 probe `contextlessCount` is hardcoded `0` and measured under superadmin-bypass; the fail-closed arm of the GREEN predicate is structurally dead

**File:** `apps/core-service/src/infrastructure/db/rls-probe.ts:184-216` (and dead-code block `186-200`)
**Contract:** CF-SEC-1 (GREEN iff `crossReadCount===0 AND contextlessCount===0` per table)
**Rubric class:** **MUST-FIX-NOW** — clause fired: *"correctness/safety/security defect reachable in the code this requirement ships"* + *"breaks a day-one invariant (RLS fail-closed)."* Conservative tie-break applied (verification instrument for the C5 hard gate).

**What's wrong:**
1. `contextlessCount` is computed inside `withSuperadmin(...)` (line 202) — which sets `is_superadmin='true'`, intentionally **bypassing RLS**. It then discards the actual count and `return 0` (line 215) unconditionally.
2. The GREEN verdict (line 219-220) therefore rests **solely on `crossReadCount`**. The `&& contextlessCount===0` term is a constant-true no-op.
3. Lines 186-200 are dead code (`const pool = await import(...).then(m => m)` — imports the module and returns it unused).
4. **No test exercises the probe's live arms** — `probe-verdict.test.ts` only tests the synthetic predicate on hand-built `ProbeTableResult` objects; `runRlsProbe`/`probeTable` are never invoked against a DB. So the inert arm is invisible to the suite.

**Why it matters (blast radius — compliance-gated/irreversible-class instrument):** The contextless check (a connection with NO `app.workspace_id` GUC returns **0 rows** post-FORCE) is the single most important property of the entire feature — it is *the* definition of fail-closed. The Stage-8 runbook STEP-4 (`rollout-runbook.sh:130-145`) is the live gate that decides whether FORCE proceeds, and it invokes `runRlsProbe` + prints `formatProbeResult`. That output prints `ctxless=0` for **every table unconditionally**, regardless of reality — giving the operator (and the commented `process.exit(verdict==='GREEN')` auto-gate at lines 138-142) **false assurance** on the exact property whose failure is a cross-tenant data breach. A policy that is fail-closed on cross-read but NOT on contextless (e.g., a `USING(true)`-equivalent slip the cross-read arm coincidentally misses, or a table where ALPHA has 0 seeded rows so `crossReadCount` is trivially 0) would pass this probe GREEN.

**Why HIGH and not CRITICAL:** mitigants cap the live blast radius — (a) FORCE is not run this child (HOLD-AT-FORCE; `force_NOT_run_this_child=true`); (b) the cross-read arm IS a genuine non-hardcoded isolation check; (c) the *true* contextless check exists and passes in the LOCAL pgbouncer integration test (`pool-isolation.test.ts:266-276`, `toBe(0)`); (d) Stage-8 STEP-4 is operator-confirmed behind sign-off. But the **shipped instrument is wrong**, the integration test does NOT redeem the probe (it asserts with its own inline queries, not via the probe), and at Stage-8 this probe is the runbook's gate. HIGH = VETO.

**Remediation (any one closes it):**
- (Preferred) Make `probeTable`'s contextless arm a **genuinely context-less query** on a raw pooled client with NO `set_config` and NO superadmin flag (expose a narrow `_rawClient()` helper from `workspace-context.ts` for probe-only use, or run a `BEGIN; <no set_config>; SELECT COUNT(*)` so the GUC is unset → post-FORCE returns 0, pre-FORCE owner-bypass returns full count → RED → correctly blocks FORCE, exactly as the comment at 182-185 promises). Then add a test that invokes `probeTable` against the local FORCE'd DB asserting `contextlessCount===0` post-FORCE and `>0` (RED) pre-FORCE.
- (Minimum acceptable) If the contextless arm genuinely cannot be implemented at the probe layer this child, **remove `contextlessCount` from the GREEN predicate entirely** and rename the field/output so neither the runbook operator nor `formatProbeResult` can read a fabricated `ctxless=0` as a passed fail-closed check; document the contextless gate as exclusively the integration test + Stage-8 live re-probe, and make STEP-4 print "ctxless: DEFERRED-TO-INTEGRATION" not "ctxless=0". Delete the dead block 186-200 either way.

---

## MEDIUM / LOW (logged — non-blocking, tech debt)

### MED-1 — `formatProbeResult` prints `ctxless=<n>` with no "deferred" marker
**File:** `rls-probe.ts:324` — even after HIGH-1 is fixed, the per-table line should make the contextless semantics explicit so a Stage-8 operator never mistakes a deferred check for a passed one. Folds into HIGH-1 remediation. Track if HIGH-1 is fixed the "preferred" way (then it's a real number and this is moot).

### MED-2 — probe Decision-Log `user_id` sentinel `00000000-…-001` assumes a row exists in `users` (or FK relaxed)
**File:** `rls-probe.ts:281-302`, comment line 279-280 acknowledges it. The system-workspace sentinel for `workspace_id=NULL` is correct (CF-C1-AUDITLOG-1.a — not orphaned, not co-mingled). But the `user_id` FK to `users` may fail the INSERT at Stage-8 if no such user row exists. Verify the sentinel user exists or the FK is nullable before the Stage-8 probe run. Non-blocking this child (no live write occurs).

### LOW-1 — `_setPoolForTest`/`_resetPoolForTest` are exported from the production barrel (`index.ts:15-17`)
Underscore-prefixed + commented as test-only; acceptable convention, but a lint rule or `@internal` would harden against accidental prod import. Tech debt.

---

## CF-* security map (traceability — every CF maps to code/test/runbook)

| CF | Requirement | Evidence | Status |
|----|-------------|----------|--------|
| **CF-C1-RLS-DEFAULT-1.a** | fail-closed shapes only; banned patterns absent | `step-a-enable-create.sql` — 85 uses of `current_setting('app.…',true)`; grep: 0 `OR…IS NULL` / 0 `COALESCE` / 0 `USING(true)` / 0 session-SET. `rls-ddl-static.test.ts` per-table greps. | **PASS** |
| **CF-C1-POOL-1.a** | session-mode (:5432) + tx-local `set_config($1,true)`; session-SET banned; injection-safe; LOCAL pgbouncer test | `workspace-context.ts:156` bind-param `$1`; `:95` Pool on DIRECT_URL; `pool-isolation.test.ts` (leak/clear/session-SET-negative-control). | **PASS** (integration test skipped sans Docker — Tanvi's Stage-5 gate) |
| **CF-C1-AUDITLOG-1.a** | dual-policy + system-workspace sentinel for null-ws rows | `step-a:264-283` audit_logs/notifications dual-policy + system_settings superadmin-only; probe writes null-ws under `withSuperadmin`. | **PASS** |
| **CF-SEC-1** | RED-by-default probe; GREEN on cross-read=0 AND contextless=0 | `rls-probe.ts` — cross-read arm genuine; **contextless arm inert** (HIGH-1). | **FAIL → HIGH-1** |
| **CF-SEC-3.HARD** | not triggered this run; re-arms before 3rd-party PII | No live PII processing (probe/backfill Stage-8-deferred); carried verbatim in state + plan §11. | **PASS (correctly not-triggered)** |
| **CF-SEC-5** | correlation 4-tuple on new runtime paths | `workspace-context.ts` ALS `CorrelationContext{requestId,traceId,workspaceId,userId}`; threaded into cron logs, probe result, BrainClaim. | **PASS** |
| **CF-RES-1.a** | ap-south-1 asserted on BOTH :6543 + :5432 | `rollout-runbook.sh:40-66` STEP 0 — same-backend cross-check + operator confirm both URLs. | **PASS (artifact; live at Stage-8)** |
| **CF-BN-NOLEGACY-1** | zero legacy files staged | `git diff --cached --name-only | grep "legacy project"` → empty. | **PASS** |
| **CF-BN-SHAPE-A-1 / DDL-GATING-1** | FORCE deferred; DDL un-applicable by runner; STEP-5 HELD | No prisma schema; `migrations/manual/` not a runner path; `step-b-force.sql` HELD header; runbook STEP-5 HELD; `force_NOT_run_this_child=true`. | **PASS** |
| **Auth / requireRole** | 5-level ordering; no priv-escalation; >= guard | `brain-claim.ts:46-91` OWNER5…VIEWER1, `>=` guard; `brain-claim.test.ts` +/− incl. mutation-target (`>=` vs `>`). | **PASS** |
| **withSuperadmin gate** | only cron + probe call-sites | grep: only `rls-probe.ts` (2) + `session-scoped-fanout.ts` (1) + barrel re-export. | **PASS** |
| **DDL symmetry** | up/down reconcile; no orphan/locked table | 43 ENABLE = 43 FORCE = 43 DISABLE (same table set, comm-verified); 45 CREATE POLICY = 45 DROP POLICY, 0 orphans. | **PASS** |

---

## Verification evidence (captured, not taken on faith)

- **Vuln scan:** `pnpm audit --prod` → **No known vulnerabilities found.** Python scanners N/A (0 `.py` staged). Trivy not installed (pnpm audit authoritative here).
- **Tests:** `vitest run` → **155 passed / 0 failed / 8 skipped** (pgbouncer integration — correctly skipped sans Docker). `tsc --noEmit` → **0 errors.**
- **Banned-pattern grep (executable SQL):** 0 `OR…IS NULL`, 0 `COALESCE`, 0 `USING(true)`, 0 session-SET.
- **Bind-param:** `set_config('app.workspace_id', $1, true)` — bound, never interpolated.
- **Secret hygiene:** no `.env`/secret/key files staged; only credential-bearing URLs are localhost test defaults (`postgres:postgres@localhost`) in the integration fixture — acceptable.
- **Legacy:** 0 files under `legacy project/` staged.
- **Table-set reconciliation:** `comm` diffs ENABLE/FORCE/DISABLE = identical 43-table set; CREATE/DROP POLICY = 45/45, 0 orphans.
- **`current_setting` missing_ok:** all 85 calls pass `true` → unset GUC = NULL = fail-closed (0 rows).

---

## Compliance gates

| Gate | Status |
|------|--------|
| DPDP (consent/minimization/retention/erasure/residency) | **PASS** — §8(6) cross-tenant isolation is the slice's purpose; residency ap-south-1 asserted (Stage-8); no live PII processing this run; CF-SEC-3.HARD correctly not-triggered + re-arms before 3rd-party PII. |
| DLT / NCPR / DND / 9am–9pm / 48h cap | **N/A** — no outbound channel. |
| WhatsApp opt-in/template/window | **N/A** — no messaging. |
| AI-voice disclosure / recording consent | **N/A** — no voice/recording. |
| UAE/KSA PDPL | **N/A** — region-agnostic primitive; ap-south-1 only this run. |

**Zero compliance violations.**

---

## Gate (G4)

- [x] Zero CRITICAL
- [ ] **Zero HIGH — FAILS (HIGH-1)**
- [x] Zero compliance violations
- [x] Zero missing-traceability
- [x] Every connector OAuth/webhook — N/A this slice
- [x] PII not in logs (sampled — no PII surface; correlation 4-tuple carries IDs not PII)
- [x] Vuln scans CLEAN on CRITICAL/HIGH

**G4 = NOT PASSED** (1 HIGH). BOUNCE to @vikram.

---

## HANDOFF

```
verdict: BOUNCE
mode: parallel-review (did not advance)
bounce_target: backend-developer (@vikram)
blocking_findings:
  - HIGH-1: rls-probe.ts:184-216 — CF-SEC-1 contextless arm structurally inert (hardcoded 0 under superadmin-bypass); fail-closed verdict not actually verified; runbook STEP-4 gate gives false assurance. Remediate per options in finding. MUST-FIX-NOW (conservative tie-break; verification instrument for C5 hard gate).
non_blocking:
  - MED-1 formatProbeResult ctxless label (folds into HIGH-1)
  - MED-2 probe Decision-Log user_id sentinel FK existence (verify before Stage-8)
  - LOW-1 test-only exports in prod barrel
note: All other CF-* PASS. DDL/primitive/auth/cron/runbook/residency/audit-dual-policy are correct. Single blocker is the probe's contextless verification.
```

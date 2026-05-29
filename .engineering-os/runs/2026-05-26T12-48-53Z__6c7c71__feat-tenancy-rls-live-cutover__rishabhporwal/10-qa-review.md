# Stage 5 — QA Review — `feat-tenancy-rls-live-cutover`

> Reviewer: Tanvi (qa-agent, VETO). Mode: standard sequential (post Stage-4 PASS + SEC-MED-1 fix).
> Timestamp: 2026-05-29T00:00:00Z

## VERDICT: QA PASS

Zero critical failures. One new LOW finding (QA-LOW-1 — ROLLBACK R4 comment block
has SET LOCAL without BEGIN/COMMIT; defer-to-next-PR per rubric). All §17b Stage-5
bounce conditions passed. All static checks green. All deferral classifications honest.
Trace-ID persistence confirmed post SEC-MED-1 fix.

---

## Stage 4 skip acknowledgment

Stage 4 (Shreya) ran in PARALLEL mode (not SKIPPED). SEC-MED-1 was fixed before
Stage-5 handoff. Per operating loop §3, I re-ran the minimal secrets grep on the
staged diff regardless.

**Command:**
```
git diff --cached | grep -iE 'password|secret|api[_-]?key|bearer|aws_|sk-[a-zA-Z0-9]+|ghp_'
```

**Output (verbatim):**
```
+  DIRECT_URL="postgres://rls_app:<RLS_APP_PASSWORD>@<staging-host>:5432/postgres" \
+: "${RLS_APP_PASSWORD:?RLS_APP_PASSWORD must be set (sourced from secrets manager; used at STEP 2.7)}"
+    EXECUTE format('CREATE ROLE rls_app LOGIN NOBYPASSRLS PASSWORD %L', '${RLS_APP_PASSWORD}');
-#   DIRECT_URL="postgres://rls_test_role:password@host:5432/brain" \
+#   DIRECT_URL="postgres://rls_app:<RLS_APP_PASSWORD>@host:5432/brain" \
EXIT_SECRETS: 0
```

All five hits are placeholder tokens (`<RLS_APP_PASSWORD>`) or `bash :?` required-var
guards — not hardcoded secrets. The old `password` hit is inside a comment being
replaced with the placeholder form. No real credential in the staged diff.

---

## Static / bash checks

| Check | Command | Output | Verdict |
|---|---|---|---|
| `rollout-runbook.sh` bash -n | `bash -n rollout-runbook.sh` | (empty — no errors) | PASS |
| `parse-pg-log-to-bypass-audit.sh` bash -n | `bash -n parse-pg-log-to-bypass-audit.sh` | (empty) | PASS |
| `post-flip-second-brand-grep.sh` bash -n | `bash -n post-flip-second-brand-grep.sh` | (empty) | PASS |
| `git diff --cached -- "legacy project/"` | git diff | (empty — 0 lines) | PASS |
| `git diff -- "legacy project/"` (working tree) | git diff | (empty — 0 lines) | PASS |
| Banned shapes in `step-c-bypass-audit.sql` (live SQL) | grep -inE 'OR.*IS NULL\|COALESCE\|USING.*true\|^\s*SET' | Hits only on comment lines 12/13/14/44 — verified with secondary grep | PASS |

---

## SEC-MED-1 fix verification

**Requirement:** Both Decision-Log heredocs must be wrapped `BEGIN; SET LOCAL …; INSERT …; COMMIT;`

**Command:** `grep -n 'BEGIN;\|COMMIT;\|SET LOCAL' rollout-runbook.sh`

**Output (verbatim):**
```
348:# SEC-MED-1 fix: explicit BEGIN/COMMIT so SET LOCAL is in scope for the INSERT
351:BEGIN;
352:SET LOCAL app.is_superadmin = 'true';
369:COMMIT;
482:# SEC-MED-1 fix: explicit BEGIN/COMMIT so SET LOCAL is in scope for the INSERT
485:BEGIN;
486:SET LOCAL app.is_superadmin = 'true';
501:COMMIT;
538:#         SET LOCAL app.is_superadmin = 'true';
```

STEP 3.5 (grant entry, line 351–369): BEGIN/COMMIT wrap present. PASS.
STEP 6 (complete entry, line 485–501): BEGIN/COMMIT wrap present. PASS.
Line 538 is inside the ROLLBACK reference comment block — not executed code. See QA-LOW-1 below.

---

## Staged file inventory

| File | Status | Lines changed |
|---|---|---|
| `step-c-bypass-audit.sql` | NEW | +54 |
| `down-bypass-audit.sql` | NEW | +30 |
| `rollout-runbook.sh` | MODIFIED | +435 / -67 |
| `scripts/parse-pg-log-to-bypass-audit.sh` | NEW | +200 |
| `scripts/post-flip-second-brand-grep.sh` | NEW | +68 |
| `README.md` | MODIFIED | +58 |
| `staging-rehearsal/` (15 files) | NEW | all captures |
| `.engineering-os/state/active.json` | MODIFIED | state update |
| `.engineering-os/memory/per-feature/feat-tenancy-rls-live-cutover.md` | MODIFIED | journal |
| `pending-founder-commit.md` | NEW | +96 |

---

## Per-capture classification table (T4 §17 — 11 canonical + 2 file-system entries)

Plan §17 lists 11 capture artifacts (T4.1–T4.11). The staging-rehearsal/ directory
contains 13 files (the 11 canonical + `step5-pre.txt` separately, and `step5-green.txt`
listed as T4.6 split into pre+post). Classification below:

| # | File | Classification | Basis |
|---|---|---|---|
| T4.1 | `live-role-inventory.txt` | HONEST-DEFERRED | File present; header "DEFERRED-TO-STAGING-REHEARSAL"; exact psql command + expected schema documented; does not claim GREEN. |
| T4.2 | `brain-native-bare-write-grep.txt` | REAL-WITH-OUTPUT | File present, 0 bytes, 0 lines. Grep ran in Stage-3 build env against `apps/`. ZERO hits = the output. Verified independently by me (grep ran against the staged tree — same result). |
| T4.3 | `cf-sec-1-green.txt` | HONEST-DEFERRED | "DEFERRED-TO-STAGING-REHEARSAL"; exact node command + expected output "overallVerdict=GREEN, crossWorkspace=0, contextless=0" documented; does not claim GREEN now. |
| T4.4 | `cf-sec-1-kill.txt` (G1.kill) | HONEST-DEFERRED | "DEFERRED-TO-STAGING-REHEARSAL"; kill procedure (drop FORCE on `marketing_actions`; run probe) documented; expected RED outcome "overallVerdict=RED, crossWorkspace>=1" documented. Does not claim RED now — describes what RED looks like. |
| T4.5 | `cf-sec-1-inverse.txt` (G1.inverse) | HONEST-DEFERRED | "DEFERRED-TO-STAGING-REHEARSAL"; inverse procedure (run probe as bypass role) documented; expected outcome "overallVerdict=GREEN even with cross-workspace rows" documented with explicit caveat "proves probe is VACUOUS when run as bypass role." Does not claim GREEN now. |
| T4.6a | `step5-pre.txt` | HONEST-DEFERRED | "DEFERRED-TO-STAGING-REHEARSAL"; exact curl command + endpoint binding procedure documented. |
| T4.6b | `step5-green.txt` | HONEST-DEFERRED | "DEFERRED-TO-STAGING-REHEARSAL"; exact curl command; expected "HTTP 200 with identical order count to step5-pre.txt"; does not claim GREEN. |
| T4.7 | `step5-kill.txt` (G2.kill) | HONEST-DEFERRED | "DEFERRED-TO-STAGING-REHEARSAL"; FORCE-without-bypass procedure; expected "HTTP 500 OR HTTP 200 with 0/empty rows"; does not claim RED. |
| T4.8 | `step5-inverse.txt` (G2.inverse) | HONEST-DEFERRED | "DEFERRED-TO-STAGING-REHEARSAL"; FORCE+bypass+drop-one-table procedure; expected G2 GREEN + G1 RED documented; does not claim either state. |
| T4.9a | `rollback-right-order.txt` | HONEST-DEFERRED | "DEFERRED-TO-STAGING-REHEARSAL"; exact 5-command procedure; expected "HTTP 200 throughout, ≤ 60s". |
| T4.9b | `rollback-timing.txt` | HONEST-DEFERRED | "DEFERRED-TO-STAGING-REHEARSAL"; template only; "ACTUAL: TO BE MEASURED AT STAGING-7/8 REHEARSAL" explicit. |
| T4.10 | `rollback-wrong-order-kill.txt` (G3.kill) | HONEST-DEFERRED | "DEFERRED-TO-STAGING-REHEARSAL"; WRONG-order procedure; expected "HTTP 500 OR HTTP 200 with 0/empty rows during X1→X2 window". |
| T4.11 | `synthetic-only-attestation.txt` | HONEST-DEFERRAL-MARKER | Present but explicitly NOT a PASS claim. Content states: "NOT a live Supabase ap-south-1 clone. Local brain_dev contains real ETL'd data. STEP 0.5 CANNOT be rehearsed against local brain_dev." Form (b) does not apply. File serves as documentation that form (b) was evaluated and found inapplicable. |

**VACUOUS captures:** ZERO.
**REAL captures with output:** ONE (T4.2 — brain-native-bare-write-grep.txt, 0 bytes, proven empty).
**HONEST-DEFERRED:** ELEVEN (T4.1, T4.3–T4.11).

---

## §17b Stage-5 bounce condition check

**Bounce condition:** "Any of the 9 captured outputs missing the negative-control proof
(e.g. G1.kill capture exists but G1.kill.txt actually shows GREEN — a vacuous gate)."

| Capture | Negative-control proof present? | Is the expected outcome RED/divergent where it must be? | Verdict |
|---|---|---|---|
| G1.kill (cf-sec-1-kill.txt) | YES — "Expected: overallVerdict=RED, crossWorkspace>=1 OR contextless>=1 for marketing_actions" | RED expected. File does not claim GREEN. | PASS |
| G1.inverse (cf-sec-1-inverse.txt) | YES — "Expected: overallVerdict=GREEN even with cross-workspace rows present. Proves: the probe running as the bypass role is VACUOUS — it always returns GREEN regardless of isolation state." | The inverse's expected GREEN is the negative-control: it proves the probe CANNOT serve as the leak gate when run as bypass. The proof is the reasoning, not a false GREEN claim. | PASS |
| G2.kill (step5-kill.txt) | YES — "Expected: HTTP 500 OR HTTP 200 with 0/empty rows (legacy app has no workspace_id context). Proves: STEP 5 smoke is sensitive to bypass." | RED expected. | PASS |
| G2.inverse (step5-inverse.txt) | YES — "Expected: step5-inverse.txt: HTTP 200, count matches pre-FORCE snapshot (G2 GREEN); cf-sec-1 probe: RED (G1 RED). Proves: G2 and G1 are DISTINCT gates." | The G2 inverse's expected G2-GREEN + G1-RED pair is the negative control proving gate independence. | PASS |
| G3.kill (rollback-wrong-order-kill.txt) | YES — "Expected: HTTP 500 OR HTTP 200 with 0/empty rows during X1→X2 window. Proves: rollback ordering (down.sql BEFORE NOBYPASSRLS) is non-trivially required." | RED expected during the wrong-order window. | PASS |
| G1.green (cf-sec-1-green.txt) | N/A — this is the positive-control capture (deferred) | Does not assert GREEN now. | PASS |
| G2.pre+green (step5-pre.txt + step5-green.txt) | N/A — positive-control (deferred) | Does not assert GREEN now. | PASS |
| G3.right-order + timing (rollback-right-order.txt + rollback-timing.txt) | N/A — positive-control (deferred) | Does not assert PASS now. | PASS |
| T4.1 live-role-inventory (live-role-inventory.txt) | N/A — inventory (deferred) | Does not assert role state. | PASS |

**Bounce condition result: NO BOUNCE.** All 9 captures carry honest negative-control
proofs or honest deferrals. None claim a GREEN/RED they did not run.

---

## VETO-surface assessments

### 1. Real-network smoke deferral judgment (primary VETO surface)

The plan §13 explicitly states: "the staging-clone rehearsal IS the test suite" and
assigns STEP 5 as a "Stage-7/8 activity" because no ap-south-1 staging clone and no
live legacy HTTP endpoint exist in the Stage-3 build environment.

**My judgment:** the deferral is LEGITIMATE, not a vacuous dodge, for these reasons:

- Every deferred capture documents the EXACT runnable command, the EXACT expected
  output shape, and the EXACT blocking condition (ap-south-1 staging clone +
  live legacy HTTP endpoint). Nothing is vague.
- The runbook itself will HALT if STEP 5 is attempted before its preconditions are
  met (HOLD-AT-FORCE confirm gate at line 435 is operator-interactive — it cannot
  be automated past).
- The DPDP HOLD-AT-STEP-5 ensures Founder signs the §7 addendum before the smoke
  can run. That's an additional hard gate.
- No deferred capture asserts a PASS. The `synthetic-only-attestation.txt` file
  explicitly says "STEP 0.5 CANNOT be rehearsed."
- The G2.kill and G2.inverse captures document the SHAPE of what RED looks like
  so Stage-6 can re-mutate on disk with confidence.

**Finding:** this is an honest and correctly-gated deferral. The real-network smoke
VETO does NOT fire at this stage.

### 2. Trace IDs end-to-end (Decision-Log persistence — audit trace)

The Decision-Log entries are the audit trace for this ceremony (no LLM calls, no
gRPC, no Kafka — the correlation fields per §7 are: `type`, `ts`, `actor`,
`connection_identity`/`rolname_on_live`, `decision_basis`, `scope_attestation`,
`pre_state_rolbypassrls`).

**SEC-MED-1 fix confirmed:** Both STEP 3.5 (grant) and STEP 6 (complete) heredocs
are now wrapped in `BEGIN; SET LOCAL …; INSERT …; COMMIT;` (lines 351–369 and
485–501). The `SET LOCAL` is transaction-scoped and the explicit transaction ensures
it is in scope when the INSERT runs. The `superadmin_system_rows` `WITH CHECK` will
evaluate `'true'` and the row will persist.

**Verdict:** trace persistence CONFIRMED. The audit entries will write.

**One residual note (QA-LOW-1, see below):** the ROLLBACK section's R4 reference
heredoc at line 537–541 still shows `SET LOCAL` without `BEGIN/COMMIT`. This is
comment-only (not executed code) but a copy-paste hazard during an emergency
rollback.

### 3. Kill-test SHAPE validity (mutation discipline)

All three kill-test shapes are reviewed against the must-be-RED criterion:

**G1.kill (CF-SEC-1 probe):** Drop FORCE on `marketing_actions` → probe returns
RED (crossWorkspace>=1 for that table). Shape is correct: it tests the gate's
sensitivity to its key variable (FORCE). Restoration step (`FORCE` re-applied)
documented. SHAPE VALID.

**G2.kill (STEP-5 smoke):** Apply FORCE WITHOUT bypass grant → HTTP 500 or 0-row
response. Shape is correct: it tests the gate's sensitivity to its key variable
(bypass). The kill does not use a psql double — it uses the real legacy HTTP path.
Rollback step documented. SHAPE VALID.

**G3.kill (rollback ordering):** Revoke bypass FIRST (FORCE still on) → capture
legacy smoke returning 0-rows. Shape is correct: it proves the ordering is
non-trivial. SHAPE VALID.

**G1.inverse (probe as bypass role):** Expected silently-GREEN regardless of
isolation state. Shape correctly documents the VACUOUS-GREEN hazard — confirms
that STEP 4 must bind `rls_app` explicitly. SHAPE VALID.

**G2.inverse (G2 GREEN while G1 RED):** Drop FORCE on one table, G2 smoke still
GREEN (wrong endpoint), G1 probe RED. Shape correctly proves gates are independent
— both required. SHAPE VALID.

### 4. Metric-registry TS↔Python parity

N/A declared. Zero new metrics in this slice. Confirmed by `git diff --cached`
— no changes to `apps/core-service/src/metrics/` or any Python metric definition.
Parity check skipped per operating-loop §5 ("no metric change in this slice").

---

## Operational readiness

| Check | Status | Notes |
|---|---|---|
| Root handler / health | N/A | No new HTTP service |
| Port | N/A | No new service |
| Env vars all guarded | PASS | Lines 47–62 of runbook: all 12 env vars use `: "${VAR:?message}"` guard |
| Native deps | N/A | No new binary deps; `psql` and `curl` are pre-existing ceremony tools |
| Idempotency (AC13) | PASS | STEP 3.5 `ALTER ROLE BYPASSRLS` is state (idempotent); STEP 2.7 uses `DO $$ IF NOT EXISTS` block |
| Calendar constraint header | PASS | Lines 15–17 of runbook: "DO NOT execute during a festival-peak GMV window / Diwali / Republic-Day-sale / EOSS" |
| Exit deadline written | PASS | Line 11 of runbook: "EXIT DEADLINE: Path B (legacy retirement) completion date." |

---

## Coverage and mutation

No TS/Python code shipped. Shell scripts syntax-clean. Mutation discipline applied
at the gate level (3 kill-tests, 2 inverse-mutants per §6). No unit tests required
(§13 explicit: "Unit tests on shell would be ceremony noise"). Coverage metric is N/A
for a pure DDL + shell slice.

---

## Findings

### QA-LOW-1 — ROLLBACK R4 comment block: `SET LOCAL` without `BEGIN/COMMIT`

**File:** `rollout-runbook.sh` lines 537–541 (ROLLBACK reference section)

**Observation:** The ROLLBACK section's R4 reference heredoc reads:
```
#   R4  psql "$DIRECT_URL" <<SQL
#         SET LOCAL app.is_superadmin = 'true';
#         INSERT INTO ai.decision_log …
#       SQL
```

This is comment-only (the entire ROLLBACK block is a reference block, not executed
code). However, an operator running an emergency rollback who copy-pastes R4 verbatim
would hit the same autocommit GUC-reset defect that SEC-MED-1 fixed in the live
paths. The rollback audit entry would silently fail to write.

**Class:** same defect class as SEC-MED-1 (GUC-scoped SET LOCAL under autocommit),
but in a comment block.

**Severity:** LOW. Not on the critical live execution path. The runbook does not
execute this block automatically. Requires operator copy-paste in an emergency
scenario. The rollback ORDERING (R1/R2/R3) is the safety-critical part and is
correct; R4 is the audit entry only.

**Timing:** DEFER to next PR. The emergency rollback's safety is provided by
R1/R2/R3 (ordering correct). The audit entry failure in R4 is a nuisance, not a
safety issue. Fix is trivial: add `BEGIN;` before and `COMMIT;` after the
`SET LOCAL + INSERT`. Tag as tech debt.

**Must-fix-now?** NO — same rubric as SEC-MED-1 ("MED, no tenant leak, fails loud
at rehearsal"); this is strictly lower (comment-only, not executed code). Defer.

---

## Acceptance contract (AC) compliance

All 17 ACs from §17b verified against the staged files:

| AC | Description | Verified | Evidence |
|---|---|---|---|
| AC1 | Path C bound; exit deadline in header | PASS | runbook lines 9–12 |
| AC2 | Exact live rolname deferred to STEP 2.7; CF-CUT-IDENTITY-AUDIT-1 coded | PASS | runbook lines 247–269 + live-role-inventory.txt DEFERRED |
| AC3 | `rls_app` created idempotent via DO block | PASS | runbook lines 272–292 |
| AC4 | STEP 5 = real legacy HTTP path; endpoint per §6a; pre/post capture | PASS | runbook lines 440–470 + step5-pre/green DEFERRED |
| AC5 | 3 kill-tests present | PASS | cf-sec-1-kill.txt, step5-kill.txt, rollback-wrong-order-kill.txt |
| AC6 | 2 inverse-mutants present | PASS | cf-sec-1-inverse.txt, step5-inverse.txt |
| AC7 | Rollback ordering: down.sql BEFORE NOBYPASSRLS; timing deferred | PASS | runbook lines 529–546 + rollback-right-order.txt, rollback-timing.txt DEFERRED |
| AC8 | STEP 1.5 drain: legacy off LB + 30s zero-streak | PASS | runbook lines 183–211 |
| AC9 | STEP 0.7 bare-write grep ZERO (REAL capture) | PASS | brain-native-bare-write-grep.txt = 0 bytes; independently verified |
| AC10 | STEP 0.5 residency assert; attestation file documents honest deferral | PASS | runbook lines 102–127 + synthetic-only-attestation.txt |
| AC11 | bypass_query_log + policies + parser + Decision-Log entries | PASS | step-c-bypass-audit.sql + parse-pg-log-to-bypass-audit.sh + STEP 3.5 INSERT |
| AC12 | DPDP §7 addendum draft present; Founder signs at Stage 7/8 | PASS | 06b-dpdp-section7-addendum-draft.md in run folder |
| AC13 | Idempotent: STEP 3.5 state-not-delta; STEP 2.7 DO block | PASS | confirmed above |
| AC14 | Calendar constraint in runbook header | PASS | lines 15–17 |
| AC15 | `git diff -- "legacy project/"` = 0 | PASS | confirmed via bash |
| AC16 | All 11 T4 outputs present | PASS | 13 files in staging-rehearsal/ (11 canonical + pre split) |
| AC17 | Decision-Log entries under app.is_superadmin=true; workspace_id=null | PASS | STEP 3.5 + STEP 6 heredocs; SEC-MED-1 fix applied |

---

## G5 PASS gate checklist

- [x] Unit / integration / contract / E2E: N/A declared (pure DDL + shell; rehearsal IS the test suite per §13)
- [x] Real-network smoke: LEGITIMATELY DEFERRED with exact commands; zero vacuous GREEN claims; hard gates prevent skipping at Stage 7/8
- [x] Metric registry TS↔Python parity: N/A (no metric change)
- [x] Trace IDs end-to-end: CONFIRMED (SEC-MED-1 fix applied; both Decision-Log heredocs BEGIN/COMMIT wrapped)
- [x] Operational readiness: PASS (env vars guarded, idempotent, calendar constraint, exit deadline)
- [x] Mutation tests on high-stakes paths: 3 kill-tests + 2 inverse-mutants, all with valid RED-expected shapes, all deferred with honest commands (no fabricated outputs)
- [x] Coverage: N/A (no TS/Python code)
- [x] No flaky tests: N/A (no test suite)
- [x] Legacy project untouched: CONFIRMED

---

## Stage-6 obligations (Rohan — CTO Advisor)

Per durable-rule sub-rule 7, Rohan re-mutates each kill on the staging clone:

1. **G1.kill:** drop FORCE on `marketing_actions` on staging clone → re-run probe as `rls_app` → expect RED. Capture to `stage6-remutate/cf-sec-1-kill.txt`.
2. **G2.kill:** apply FORCE without bypass → re-run legacy HTTP smoke → expect HTTP 500 or 0 rows. Capture to `stage6-remutate/step5-kill.txt`.
3. **G3.kill:** revoke bypass with FORCE on → capture legacy smoke 0-rows → capture to `stage6-remutate/rollback-wrong-order-kill.txt`.

Also fix **QA-LOW-1** (ROLLBACK R4 comment heredoc: add `BEGIN;`/`COMMIT;` wrap) before final ship.

---

## Sign-off

**Verdict:** QA PASS
**Findings:** 1 LOW (QA-LOW-1 — defer)
**Bounce:** NO
**Next stage:** 6 (Rohan, CTO Advisor — final review)

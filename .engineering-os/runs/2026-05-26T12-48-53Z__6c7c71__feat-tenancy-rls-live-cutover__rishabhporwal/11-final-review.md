# Final Review — `feat-tenancy-rls-live-cutover`

> Filled by the CTO Advisor (Rohan) in Stage 6. **VETO authority** — can bounce to any earlier stage.
> Signed on the Founder's behalf under standing delegation (`feedback_founder_delegates_to_cto_advisor`).
> Validates against [schemas/final-review.schema.json](../../../schemas/final-review.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-live-cutover` |
| **Actor** | cto-advisor (Rohan) |
| **Timestamp** | 2026-05-29T14:00:00Z |
| **Verdict** | **PASS** *(of the code + plan as a Stage-8-READY-BEHIND-HOLDS artifact)* |

---

## Sub-reviews

| Sub-review | Verdict | Notes |
|------------|:------:|-------|
| **Requirement alignment** | PASS | Re-read `01-requirement.md` + `05-stage1-synthesis.md`. The shipped artifact is the Path-C cutover ceremony (augmented runbook + bypass audit primitive + 3 kill-tests + §7 addendum draft) — exactly the OPEN-P0 storage-layer closer scoped at Stage 1. No drift: no Brain-native runtime code touched, no legacy code touched, FORCE flip NOT executed (correctly held for Stage 8). |
| **Paradigm audit** | PASS | `@paradigm sql` header present on all 4 SQL/shell artifacts. ZERO LLM calls, ZERO ML, ZERO gateway routing, ZERO numeric-parity surface. Pure DDL + connection-handling + shell + psql probe. ~₹0/mo runtime cost. Matches plan §17 declaration and Stage-1 confirmation. |
| **Architecture quality** | PASS | Single-Primitive sweep (plan §12) holds on independent check: ONE justified new primitive (`bypass_query_log` — cannot fold into `ai.decision_log` without 10⁶/day row balloon; separate table is the correct §12-erasure-scopable shape per Child-7 CF-C7-DPDP-ERASURE-1); two *extended* existing primitives (`ai.decision_log` type-enum, `rollout-runbook.sh`); zero new abstractions for hypothetical use. |
| **Code quality** | PASS | Sampled 5 files (below). Fail-closed policy shapes only; no banned shapes; comments explain WHY (autocommit GUC hazard, ordering rationale), not WHAT. |
| **Security review pass-through** | PASS | Shreya: SECURITY PASS, zero CRITICAL/HIGH, one MED (SEC-MED-1) FIXED + independently re-verified by me on disk. |
| **QA review pass-through** | PASS | Tanvi: QA PASS, zero critical, one LOW (QA-LOW-1) FIXED + independently re-verified on disk. 3 of her gates spot-re-run by me below with matching results. |
| **Observability complete** | PASS (for this slice) | §14 declares minimal-by-design: ZERO new dashboards. Correct — a pure DDL+shell cutover's observability IS the Brain Decision-Log (`rls.bypass.grant`/`revoke`/`rls.force.complete`) + the `bypass_query_log` statement-attribution table + the second-brand tripwire grep. No runtime service ships, so no metrics/traces/alarms are owed. This is not an observability gap. |
| **Cost estimate held** | PASS | Planned ~₹0/mo; actual ~₹0/mo. No tokens, no compute beyond a one-time ceremony. Variance 0%. |

---

## Code-quality spot-checks

| File | Concern (or "clean") |
|------|---------------------|
| `step-c-bypass-audit.sql` | **clean.** Both policies use only the approved `current_setting('app.workspace_id', true)::uuid` fail-closed form with matched `WITH CHECK`; dual-policy (`ws_isolation` + `superadmin_system_rows`) mirrors the Child-1 audit-log shape. `statement_class` CHECK-constrained enum, not raw SQL text → §12-scopable. Independent banned-shape re-grep: 0 non-comment hits. |
| `rollout-runbook.sh` | **clean.** `bash -n` PASS. All 12 env vars `:?`-guarded. SEC-MED-1 fix present (BEGIN/COMMIT wrap at STEP 3.5 lines 351-369 + STEP 6 lines 485-501). QA-LOW-1 fix present (R4 comment block lines 538-544 now wrapped + carries the explanatory note). Rollback-ordering documented in header + STEP 5 halt-messages + ROLLBACK section, all naming the wrong-order 0-row hazard. |
| `scripts/post-flip-second-brand-grep.sh` | **clean.** Fail-closed: exit 1 on any non-Sugandh-Lok `workspace_id`, exit 2 on DB error, exit 0 only when the foreign-ws set is empty. NULL workspace_id correctly NOT a tripwire (system/context-less rows). Emits the exact rollback ordering on fire. |
| `down-bypass-audit.sql` | **clean.** Symmetric rollback; binding ordering (`down.sql` BEFORE `NOBYPASSRLS`) documented at the top with the hazard named. No banned shapes. |
| `scripts/parse-pg-log-to-bypass-audit.sh` | **clean.** `bash -n` PASS. Best-effort `workspace_id` extraction; INSERTs `statement_class` (verb), not raw text — preserves erasure-scopability. Cron-able. |

---

## My independent verifier re-run (durable-rule "verify the verifier" — Stage-6 obligation)

Per the operating loop §7, I spot-re-ran 4 of Tanvi's Stage-5 gates myself with captured output:

| Gate re-run | My command | My captured result | Matches Tanvi? |
|---|---|---|---|
| Legacy untouched (AC15 / CF-BN-NOLEGACY-1) | `git diff -- "legacy project/" \| wc -l` | `0` | YES |
| Shell syntax (all 3) | `bash -n` ×3 | all OK | YES |
| Bare-write grep is genuinely empty (AC9 / T4.2) | `wc -c …/brain-native-bare-write-grep.txt` | `0` bytes | YES |
| SEC-MED-1 + QA-LOW-1 txn-wrap present | `grep -c 'BEGIN;'` / `'COMMIT;'` | 3 / 3 (STEP 3.5, STEP 6, R4) | YES |

All four reproduce her PASS. No Stage-5 quality issue. No bounce on the verifier dimension.

---

## The re-mutation deferral decision (CRITICAL JUDGMENT CALL — durable-rule sub-rule 7, 10th occurrence)

**Decision: (b) — BIND the disk re-mutation as a HARD Stage-7/8 rehearsal precondition. I am deferring it, and I state plainly that it is NOT done.**

Sub-rule 7 asks me to re-mutate G1/G2/G3 kills on disk during Stage-6 review. The three kill-tests (`cf-sec-1-kill`, `step5-kill`, `rollback-wrong-order-kill`) execute against a **live ap-south-1 staging clone with FORCE applied and a live legacy HTTP endpoint** — neither of which exists in this environment (confirmed: local `brain_dev` holds real ETL'd data on `localhost`, so it is neither ap-south-1 nor synthetic; `psql`/the live HTTP path are not reachable; the `synthetic-only-attestation.txt` is an honest negative).

**I will not fabricate a re-mutation.** A re-mutation captured against anything other than a FORCE-applied staging clone with the real legacy HTTP path would be exactly the vacuous-GREEN the durable rule exists to prevent — and this slice is the rule's 10th occurrence, so a vacuous Stage-6 re-mutation here would be the precise failure the rule was written to stop.

**What I genuinely re-mutated on local artifacts (the part I CAN do):**
- Re-verified the kill-test *shapes* on disk are non-vacuous: each capture file documents the exact mutation command, the exact expected RED outcome, and the proof-of-sensitivity rationale. I confirm all three would go RED if their gate were broken (G1.kill drops FORCE → probe RED; G2.kill applies FORCE without bypass → smoke RED; G3.kill wrong-order revoke → 0-row window). The SHAPES are valid (matches Tanvi's §VETO-3 finding).
- Re-verified the two inverse-mutants prove gate independence (G1.inverse: probe-as-bypass is silently GREEN ⇒ probe must run as `rls_app`; G2.inverse: G2 GREEN while G1 RED ⇒ two distinct gates).
- Independently re-ran the banned-shape grep, legacy-diff, and syntax gates (above) — these are the gates that CAN run on disk now, and they pass on my own execution.

**The binding (HARD precondition for the Stage-8 FORCE flip):** before the live FORCE flip, the operator MUST re-mutate G1/G2/G3 on the live ap-south-1 staging clone in the ceremony window and capture fresh RED/GREEN transitions to **`stage6-remutate/{cf-sec-1-kill.txt, step5-kill.txt, rollback-wrong-order-kill.txt}`** in this run folder. This is not optional and not waivable by the delegation — it is the leak/no-outage/rollback proof that the FORCE flip's safety rests on. The runbook's interactive HOLD-AT-FORCE confirm gate cannot be passed until these captures exist and show the expected transitions.

---

## Per-CF binding-contract audit (plan §11)

**Inherited (carry unchanged) — all verified present/honored:**

| CF | Status | Evidence |
|---|---|---|
| CF-RES-1.a | HONORED | STEP 0 region assert (existing) + STEP 0.5 staging-clone residency (new). |
| CF-SEC-1 | BOUND, DEFERRED-LIVE | Probe runs as `rls_app` (NOBYPASSRLS); G1 gate; live execution deferred to Stage 8 with exact command. |
| CF-SEC-3.HARD | MECHANIZED | Second-brand tripwire at STEP 6 + standalone `post-flip-second-brand-grep.sh` (exit 1 on foreign ws). Re-arm boundary live. |
| CF-SEC-5 | N/A-honored | No new Brain runtime this slice. |
| CF-C1-POOL/RLS-DEFAULT/CRON-SCOPE/AUDITLOG-1.a | UNCHANGED | Brain-native primitives untouched. |
| CF-C1-ROLLOUT-ORDER-1 | SHARPENED | By CF-CUT-DRAIN-1 (STEP 1.5). |
| CF-C1-ZERO-BEHAVIOR-1 | BOUND | STEP-5 real-path smoke asserts byte-identical row count pre/post. |
| CF-BN-NOLEGACY-1 | HONORED | `git diff -- "legacy project/"` = 0 (my own re-run). Path A1 barred. |
| CF-BN-DDL-GATING-1 | HONORED | `step-c-bypass-audit.sql` runbook-gated; not auto-applied by any migration runner. |

**New / sharpened this slice:**

| CF | Sev | Status | Evidence / Disposition |
|---|---|---|---|
| CF-CUT-PATH-1 | CRITICAL | SATISFIED | Founder ratified Path C + exit deadline 2026-05-26T16:00:00Z (`06-founder-decision-cf-cut-path-1.json`). |
| CF-CUT-RUNBOOK-AUG-1 | CRITICAL | SATISFIED | All NEW steps present (0.5/0.7/1.5/2.7/3.5/reshaped-5/reshaped-6 + ROLLBACK section); existing STEPs preserved; `bash -n` PASS. |
| CF-CUT-VERIFY-THE-VERIFIER-1 | CRITICAL | SATISFIED-IN-SHAPE; LIVE RE-MUTATION HELD | 3 kill-tests + 2 inverse-mutants present with valid RED-expected shapes; Tanvi reviewed verbatim; my Stage-6 disk re-mutation BOUND as a HARD Stage-8 precondition (see decision above). NOT signed as done. |
| CF-CUT-ROLLBACK-ATOMIC-1 | HIGH | SATISFIED (timing deferred) | `down.sql` BEFORE `NOBYPASSRLS` in header + ROLLBACK section + down-bypass-audit.sql; ≤60s SLO to be MEASURED live (`rollback-timing.txt` honest template). |
| CF-CUT-DRAIN-1 | HIGH | SATISFIED | STEP 1.5 legacy off LB + `pg_stat_activity` 30s zero-streak assertion in runbook. |
| CF-CUT-SHIPROCKET-RECONCILE-1 | HIGH | SATISFIED | STEP 0.7 quiesce + bare-write grep ZERO (REAL capture, my re-run confirms 0 bytes); narrowing of CF-C3-FORCE-UNLOCK-SCOPE-1 documented. |
| CF-CUT-RESIDENCY-1 | HIGH | SATISFIED (honest deferral) | STEP 0.5 + `synthetic-only-attestation.txt` honestly documents local brain_dev is neither ap-south-1 nor synthetic ⇒ STEP 0.5 must run on the provisioned staging clone at Stage 8. |
| CF-CUT-BYPASS-AUDIT-1 | HIGH | SATISFIED | Brain Decision-Log per grant/revoke (SEC-MED-1 fix makes the INSERTs persist) + `bypass_query_log` keyed by workspace_id, `statement_class` not raw text, §12-scopable. |
| CF-CUT-DPDP-ADDENDUM-1 | HIGH | DRAFT-PRESENT; SIGNATURE HELD | `06b-…` covers Acts A-D on §8(2)+§7 basis; correctly UNSIGNED-DRAFT. Founder signs at Stage 7/8 BEFORE STEP 5. |
| CF-CUT-IDEMPOTENT-1 | MEDIUM | SATISFIED | STEP 3.5 `ALTER ROLE BYPASSRLS` (state); STEP 2.7 `DO … IF NOT EXISTS` role create. |
| CF-CUT-CALENDAR-1 | MEDIUM | SATISFIED | Runbook header lines 15-17: no Diwali/Republic-Day/EOSS window. Founder owns calendar. |
| CF-CUT-IDENTITY-AUDIT-1 | MEDIUM | SATISFIED | STEP 2.7 ≤1-bypass-role tripwire, fails closed via `halt`. |

**Per-CF audit verdict: every CF satisfied, honestly deferred-with-gate, or held for the Founder ceremony. No silent gap.**

---

## Over-engineering audit (mandatory)

- Files staged not in plan? **NO** — exactly the 6 product files in plan §17 Tracks T1/T2/T3 are staged.
- Observability/metrics/tests beyond plan? **NO** — §14 minimal-by-design honored; no dashboards added.
- Dependencies added? **NO** — zero `package.json`/lockfile/requirements changes (`psql`/`curl` are pre-existing ceremony tools).
- New abstractions for "future use"? **NO** — one justified new primitive, Single-Primitive sweep clean.
- Plan length proportionate? **YES** — dense with kill-tests because Path C's residual surface is structural and live; the handoff-depth is calibrated for a high-stakes live-prod cutover (Aryan's §16b justification holds).
- 30+ line WHAT comments? **NO** — comments are WHY (GUC hazard, ordering rationale, banned-shape ledger).

**Over-engineering audit: CLEAN.**

---

## Hard-rule deviation check (operating-loop §9)

Scanned for: dependency violation, Single-Primitive violation, compliance gap, paradigm escalation beyond plan, gate-skip without codified exception. **NONE PRESENT.** Predecessor `feat-tenancy-rls-brain-native` is `merged-on-development` (dependency PASS). Deferrals are all honest + gated + documented with exact commands. Therefore the delegated auto-approve is in scope (no §9 surface-to-Founder trigger fires).

---

## Risks remaining

- **The whole verification leg is live-only.** 11 of 12 captures are honest deferrals; the leak/no-outage/rollback gates have never been exercised against a FORCE-applied ap-south-1 clone. The Stage-8 rehearsal IS the test suite. If the staging clone is not provisioned, the FORCE flip MUST NOT proceed. This is by design and correctly gated, but it means Stage 8 carries real, un-rehearsed execution risk that only the live rehearsal retires.
- **Path C residual surface is real but bounded.** One named legacy bypass role retains BYPASSRLS until Path B retires the legacy app. Audited (two channels), tripwired (second-brand), deadlined (Path-B completion). Lawful under the §7 addendum ONLY while all four controls hold. If Path B slips indefinitely, the dispensation's defensibility erodes — hence the hard exit deadline must be a real date, not "someday."
- **STEP-5 endpoint is builder-chosen at ceremony time.** The exact legacy route is bound at rehearsal per §6a; a poorly-chosen endpoint (non-countable, or one that doesn't traverse a Group-B table) would weaken the no-outage proof. Operator must follow the §6a selection criteria.

---

## Production-readiness assessment

Would Jatin's Stage-8 pre-deploy gates pass right now? **NO — and they SHOULD NOT, by design.** This artifact is Stage-8-READY-BEHIND-HOLDS, not deploy-ready. The FORCE flip is a Founder-at-console live ceremony gated behind: (1) staging-clone provisioning + the deferred rehearsal, (2) my Stage-6 disk re-mutation (held), (3) the §7 addendum signature, (4) a festival-safe window, (5) a real Path-B date for the exit deadline. The code + plan are sound; the live ceremony preconditions are not yet met. That gap is the HOLD, not a defect.

---

## Recommendation to Founder

**APPROVE-WITH-CAVEATS** — approve the reviewed code + plan to be committed to the feature branch; the live FORCE-flip ceremony stays fully HELD behind the named preconditions for Stage 8.

### Caveats (what stays HELD for Stage 8)
- **HOLD-AT-FORCE** (predecessor, persists) — no live FORCE flip until the augmented runbook is rehearsed on a provisioned ap-south-1 staging clone + Founder-at-console.
- **HOLD-AT-STEP-5** (this slice) — the §7 DPDP addendum (`06b-…`) MUST be signed by the Founder at Stage 7/8 BEFORE STEP 5 executes.
- **HOLD-AT-BYPASS-REVOKE** (this slice) — bypass revoke is a separate Stage-8 ceremony at Path-B completion; not done in this slice.
- **HOLD-AT-RE-MUTATION** (my Stage-6 binding) — G1/G2/G3 disk re-mutation to `stage6-remutate/` on the live staging clone is a HARD precondition for the FORCE flip; captured fresh, not fabricated.
- **Deferred staging rehearsal** — the 11 deferred captures (CF-SEC-1 green/kill/inverse, STEP-5 pre/green/kill/inverse, rollback right/wrong/timing, residency) MUST be run live with their documented commands.
- **Path-B completion date** — the exit deadline (`granted_until`) must be set to a real date.
- **Festival-calendar constraint** — no Diwali / Republic-Day-sale / EOSS window; Founder picks the window.

### Founder briefing (60 seconds)

This slice is the live cutover *ceremony* for the Brain-native RLS you already merged — it does not flip anything on its own. The build is clean: Path C (one named legacy bypass role, audited/tripwired/deadlined) closes the OPEN-P0 cross-tenant leak at the storage layer for every new connection while keeping the legacy app alive until Path B retires it. Shreya and Tanvi both passed (one MED + one LOW, both fixed and re-verified by me). The one thing I will NOT pretend is done: the verify-the-verifier re-mutation (this is the durable rule's 10th occurrence) and the whole verification leg run only against a live ap-south-1 staging clone that doesn't exist in the build env — I've bound them as hard preconditions to the flip rather than fake a GREEN. So: commit the code now if you're happy; the irreversible live FORCE flip stays parked at the Stage-8 console gate behind the §7-addendum signature, the staging rehearsal + my re-mutation, a real Path-B date, and a non-festival window.

---

## Bounce details

N/A — verdict is PASS (Stage-8-READY-BEHIND-HOLDS). No bounce.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-29T14:00:00Z",
  "actor": "cto-advisor",
  "type": "final-review",
  "req_id": "feat-tenancy-rls-live-cutover",
  "verdict": "PASS",
  "recommendation": "APPROVE-WITH-CAVEATS",
  "delegated_founder_gate": true,
  "re_mutation": "DEFERRED-AS-HARD-STAGE8-PRECONDITION (not fabricated; durable-rule 10th occurrence)",
  "holds": ["HOLD-AT-FORCE","HOLD-AT-STEP-5","HOLD-AT-BYPASS-REVOKE","HOLD-AT-RE-MUTATION","staging-rehearsal","path-b-date","festival-calendar"]
}
```

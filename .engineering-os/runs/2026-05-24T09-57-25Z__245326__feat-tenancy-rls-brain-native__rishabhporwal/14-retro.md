# Retro — feat-tenancy-rls-brain-native

> Filled by CTO Advisor (Rohan) at the close of Stage 6. Append-only — never edited after write.
> Feeds the lessons-learned registry at `.engineering-os/lessons-learned.md`.

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-brain-native` |
| **Parent req_id** | `chore-migrate-legacy-to-brain` (epic) / rebuild of `feat-tenancy-auth-rls-hardening` |
| **Shipped at** | 2026-05-24T17:10:00Z (Stage 6 PASS → Founder gate) |
| **Author** | cto-advisor (Rohan) |

---

## What worked (concrete patterns to replicate)

- **The single-persona, single-dimension call was correct.** Stage 1 spent one `:sonnet` persona (`live-rollout-strangler-realist`) on the one unsettled dimension (deliverable boundary: can the C5 gate be "satisfiable" with no Brain runtime?) and explicitly *declined* a compliance persona because DPDP was resolved-on-record and the live-PII acts were deferred. The persona's CRITICAL — "you can't soft-read 'satisfiable' as 'live'; you need a decision-logged amendment + a named hold state or Child-2 blocks on a ghost criterion" — was load-bearing and became the headline deliverable. Evidence: `05-stage1-synthesis.md` §1-2; the amendment in Child-0 §A2.1/§A2.2.
- **Naming the HOLD-AT-FORCE state in the binding architecture (not informally) made the gate machine-honest.** The C5 three-state model (NOT-SATISFIABLE → SATISFIABLE → LIVE/FORCED) means Child-2's pre-flight reads the real criterion. This converted an "understanding" into a checkable state. Replicate for any future gate that ships in a deferred/partial condition.
- **Mining proven legacy logic without importing legacy code held perfectly.** 0 files under `legacy project/` touched; the fail-closed shapes, 43-table FK-scope map, probe predicate, cron scoping, and runbook were all re-expressed Brain-native. CF-BN-NOLEGACY-1 is a clean, enforceable constraint.
- **The LOCAL pgbouncer-txn-pool integration test closed the legacy child's "untestable-in-isolation" gap.** The legacy slice could only confirm pool-correctness against live `:6543/:5432`. This child proved no-leak + context-clear + the session-SET negative control locally, so Stage-5 QA was completable without live-DB access. Replicate: when a primitive's correctness depends on infra behavior (pooling), build the local infra harness as a Stage-3 deliverable, not a Stage-8 deferral.

---

## What didn't work (concrete patterns to avoid)

- **The CF-SEC-1 probe shipped structurally inert and caught only at review (1 bounce round).** The contextless verification arm — the single most important property of the whole feature (no context = 0 rows) — was computed under `withSuperadmin` (RLS-bypassing) and then hardcoded `return 0`, with the `&& contextlessCount===0` term a constant-true no-op and no test exercising the live predicate. Both Shreya (HIGH-1) and Tanvi (F3) caught it independently, and Tanvi's F1 found the deeper sibling: the *integration* test ran as `postgres` (BYPASSRLS=true), so its isolation assertions proved nothing either. A verification instrument that doesn't actually verify is worse than none — it gives false GREEN at the exact gate that decides FORCE. Avoid: any "the probe/check returns 0/PASS" that isn't exercised by a mutation-style test on the live code path.
- **The plan's decision-log path reference was wrong** (`.engineering-os/memory/decision-log/...` vs the canonical `.engineering-os/decision-log/...`). The row landed in the right place, but the plan text pointing at a non-existent path cost me a verification detour at Stage 6. Avoid: cite the canonical decision-log path; the orchestrator writes to `.engineering-os/decision-log/YYYY/MM/`.

---

## What surprised us

- **The most dangerous defect in an RLS feature is not a fail-open policy — it's a verification instrument that runs on a BYPASSRLS role.** The DDL itself was correct from round 1 (0 fail-open patterns). The risk was entirely in the *test/probe* layer pretending to confirm isolation while running as a superuser that bypasses RLS unconditionally (even under FORCE). This is a category of bug specific to RLS: the thing testing the gate must itself be subject to the gate.
- **The mutation test was the decisive signal, not the green test suite.** In round 1 the suite was green AND the `&&`→`||` flip failed 0 tests — proving the predicate was dead. In round 2 the same flip fails 3. The pass/fail count alone (155 vs 158) would not have told the story; the mutation delta did. Reinforces the value of mutation targets on load-bearing comparisons.
- **"Satisfiable but not live" needed a formal architecture amendment to be honest — a soft success-metric rewrite was insufficient.** It surprised me how easily a child could *silently* ship against a binding gate by restating the gate softer in its own success metric. The persona caught that the binding criterion lives in a `done` spike and downstream checks enforce it mechanically.

---

## Lessons to file in the registry

| # | Lesson (one-line) | Applies to | Evidence |
|---|---|---|---|
| 1 | An RLS verification probe/integration test MUST run on a non-BYPASSRLS role (NOSUPERUSER, no BYPASSRLS grant) and assert `rolbypassrls=false` at runtime — a superuser bypasses RLS even under FORCE, so the test proves nothing. | `security`, `code`, `migration` | Tanvi F1 (CRITICAL) + Shreya HIGH-1 + F3; fix `docker/initdb/01-create-rls-app-role.sql` + `_rawQuery` runtime assertion |
| 2 | Put a mutation target on every load-bearing boolean/comparison in a verification instrument; a green suite with 0 mutants killed = a dead predicate. | `code`, `agent-discipline` | `&&`→`||` failed 0 tests round-1, 3 tests round-2 (`probe-verdict.test.ts`) |
| 3 | When a child ships a binding gate in a deferred/partial state, amend the binding architecture with a named, decision-logged hold state and reconcile downstream entry criteria — do not soft-read the success metric. | `process`, `migration`, `pipeline-mechanics` | CF-BN-GATE-BOUNDARY-1; Child-0 §A2.1 HOLD-AT-FORCE + §A2.2 lines 505/506 |
| 4 | Build the local infra harness (pgbouncer txn-pool) for a primitive whose correctness depends on infra behavior as a Stage-3 deliverable, not a Stage-8 deferral, so QA is completable without live access. | `infra`, `process`, `single-primitive` | CF-C1-POOL-1.a sharpened; `pool-isolation.test.ts` 9/9 |

**Applies-to tags used:** `process`, `code`, `security`, `migration`, `numeric-parity`(n/a), `single-primitive`, `agent-discipline`, `pipeline-mechanics`, `infra`.

---

## Action items for next child

- [ ] **Child-2/3 intake:** confirm the CF-SEC-3.HARD tripwire status before onboarding any non-Founder brand PII (it re-arms; it is NOT a standing pass).
- [ ] **Stage-8 (Jatin):** before the live probe run, verify the probe Decision-Log sentinel `user_id` FK exists in `users` or the FK is relaxed (MED-2), else the audit write fails.
- [ ] **Next intake referencing a binding gate:** check that the gate's machine-checkable state (in `state/active.json` exit_criteria + the binding spike) matches what the child actually ships — don't trust the success-metric prose alone.
- [ ] **Any RLS/isolation child:** require the verification test to run on a proven non-BYPASSRLS role as a Stage-2 plan obligation (carry lesson #1 forward).

---

## Cost + paradigm reality vs plan

| Metric | Planned | Actual | Variance |
|---|---|---|---|
| Monthly $ cost | ₹0 incremental this run | ₹0 incremental | 0% |
| LLM tokens / day | 0 (sql paradigm) | 0 | 0% |
| Wall-clock duration | child-sized slice | ~1 day incl. 1 bounce round | within band |
| Paradigm declared | sql | sql (no LLM/ML) | MATCH |
| Persona count | 1 (`:sonnet`) | 1 | MATCH |

**Calibration note for next time:** The single-persona call was right and the bounce was NOT a planning miss — the persona correctly scoped the architecture question; the defect was in build-layer verification rigor (probe/test running on a privileged role), which is a code-discipline issue the reviewers are designed to catch. The pipeline worked as intended: a serious latent defect was caught at the VETO gates and fixed with genuine, independently-verified evidence before reaching the Founder. No paradigm/persona recalibration needed.

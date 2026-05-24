# 14 — Retro — spike-legacy-migration-architecture

| Field | Value |
|---|---|
| **req_id** | `spike-legacy-migration-architecture` (Child 0 of `chore-migrate-legacy-to-brain`) |
| **Author** | Rohan (cto-advisor), Stage 6 |
| **Timestamp** | 2026-05-24T01:36:40Z |
| **Outcome** | Stage 6 PASS → Founder gate; recommend APPROVE + greenlight Child 1 |

## What worked
- **The no-code-spike lane decision held up under review.** Keeping high-stakes but honestly degrading code-specific gates to design analogues (`gate_applicability_no_code_spike`) was the right call: Shreya ran a real design-level VETO on the isolation/residency plan, Tanvi ran real completeness/consistency verification, and neither gate was ceremony. The codified exception (not a silent skip) is what made this defensible.
- **Binding the 9 persona concerns onto specific artifacts at Stage 1 paid off.** Both reviews could trace each concern to a falsifiable rule (Shreya 0/9 hand-waved, Tanvi 9/9 located). The Stage-1 synthesis binding table was the spine the whole spike hung on.
- **Demarcating Maya's stubs (A1.5, A5.2) with explicit constraints worked.** She deepened the numeric harness + AI-surface map to file-ready depth without changing any of Aryan's dispositions or the 6 A5.1 rules — zero plan-amendments. Co-ownership with a clear "extend, don't re-home" boundary avoided a turf collision.
- **The C5 gate as a table COLUMN (not prose) is the single best decision in the plan.** It is the one thing that stops a downstream builder treating RLS-before-shadow as optional. Shreya called it the strongest binding in the plan; I agree.

## What didn't / friction
- **The architecture doc is ~46k tokens — it exceeded single-Read limits.** Proportionate for the work, but it forced chunked reads at review time. For future spikes of this size, consider splitting A1–A6 into separate artifact files under one index, so review (and child-time retrieval) is cheaper.
- **The state.json `blocks` vs A2 entry-criteria two-layer distinction needed a QA note to disambiguate.** It is correct, but the dual meaning of "depends on" (filing prerequisite vs runtime gate) is a latent source of confusion. Worth a one-line glossary in the epic record.

## What surprised us
- **~80% of the legacy AI surface is deterministic SQL/ML that never needed an LLM.** The legacy product was routing Opus/Sonnet for anomaly/trend/comparator work that is pure ClickHouse aggregation. The migration's biggest cost lever (Child 5) is "stop calling LLMs for arithmetic," not "pick a cheaper model." Good paradigm-discipline signal for the whole program.
- **Residency is genuinely undeterminable from the repo (0 markers; `DATABASE_URL` in uncommitted `.env`).** The tripwire-not-escalate call was vindicated — there was no canon ambiguity to escalate, only an unread fact. Both Shreya and I reached this independently, which is the strongest form of confirmation.

## Carry-forward (feeds next CTOA intake)
- The 11-row carry-forward ledger (§7 of `10-cto-final-review.md`) is binding on Children 1–7. When I run Stage-1 on each child I MUST pull the relevant rows into that child's acceptance contract.
- For a no-code spike, the Stage-6 load-bearing output is the **carry-forward ledger**, not a code re-run. The "re-run 3 gates" rule mapped cleanly to "re-verify the load-bearing ground truth the architecture rests on" — and that ground-truth re-verification (no-RLS, cron fan-out, plaintext creds at cited lines) is what made the PASS trustworthy rather than a rubber stamp.

## Recurring-pattern check (auto-candidate-rule detection)
- Root cause of any bounce: **none** (this run had no bounce). No recurring failure pattern to codify. The closest reusable *lesson* (not yet a ≥3-run rule) is "no-code/design-only spikes need a codified gate-applicability map at Stage 1" — first clean application here; watch for a 2nd/3rd occurrence before proposing a durable rule.

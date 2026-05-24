# 14 — Retro — feat-money-minor-units-parity (Child 2)

> Authored by Rohan (cto-advisor) at Stage 6. Feeds the lessons-learned registry consulted by the next CTOA intake.

## What worked

- **Shift-left on the CRITICAL paid off.** The string-typed conversion API (CF-C2-STRING-API-1) and the divergence-probe fixture were folded into the build contract at Stage 2 as must-fix-pass-1 items. Both shipped correctly in PASS 1 and never bounced — the reviewers found them satisfied. The Stage-1 persona (`money-finance-parity-realist:sonnet`) earned its keep: its CRITICAL became the load-bearing contract.
- **Independent re-verification caught nothing new but proved everything.** All 6 replicated gates matched the reviewers exactly. The drift-injection non-triviality test and the RMM live-fire are the two that actually prove the C7 gate is real — both green from my own run.
- **Single-Primitive discipline held.** One Money rep per language, one conversion primitive per language, `decimal.js` correctly rejected for an inline audited function. Zero new runtime deps.
- **Scope boundary respected under a "do all children without asking" directive.** No Child 3/4 scope pulled forward despite the open-ended Founder directive; the `expected_definitional_delta` hook is present-but-unpopulated exactly as bound.

## What didn't (the round-1 bounce)

- **The single-source-of-truth violation was a real defect that shipped to review.** Two divergent golden-fixture trees existed at submission (a stale top-level `pylibs/brain_metrics/parity/` vs the canonical package path), already drifted (`probe-1` vs `divergence-proof-probe-1`). The CI gate read the stale copy. This is the SAME class of finding that bounced Child-1 (single-source / fail-closed). Two children in a row.
- **The RMM re-derivation was a tautology in round 1** — `re_derive` called the same function used to compute `legacy_mu`, so the branch was structurally dead. A "designed now, populated later" deliverable still needs a test that proves the branch can FIRE, or it ships as dead code.
- **A mutation gap survived 61 tests** — the FLOOR sign-adjustment had no negative-with-remainder vector; only `-1/3` (or any non-exact negative) kills the mutant.

## What surprised us

- The original divergence-probe used IEEE-754-undershoot values that DON'T undershoot on Node v22/V8 — Vikram correctly re-based the probe on the structural ROUND_HALF_EVEN-vs-`Math.round` (HALF_UP) divergence on even-tied amounts (`"100.005"`), a systematic 1-paise bias rather than a coincidence-epsilon. Good catch; the probe is stronger for it.
- The harness path shorthand in the 06-plan (`pylibs/brain_metrics/parity/`) vs the importable package path (`pylibs/brain_metrics/brain_metrics/parity/`) was the root enabler of the duplicate-tree confusion. Plan shorthand for a path that must also be import-resolvable is a trap.

## Lesson candidates

1. **Co-located-vs-importable path shorthand in a plan is a duplicate-source trap.** When a plan names a home that must be both importable AND co-located with its engine, bind the FULL importable path in the plan, not a repo-relative shorthand. (See "Auto-candidate rule detection" below — this is now at the ≥3 threshold with the C7/RLS single-source bounces.)
2. **"Designed now, populated later" deliverables MUST ship with a test that proves the branch can fire** (not just that it exists). A dead branch is not a discharged contract.
3. **High-stakes numeric/sign logic needs a non-exact (remainder-producing) vector per sign** to kill truncate-vs-floor mutants; exact divisors silently pass.

## Process note

The bounce-fix → re-review → Stage-6-PASS loop worked exactly as the Child-1 precedent. Parallel review (Security + QA, did-not-advance) reconciled cleanly. No escalation needed.
</content>
</invoke>

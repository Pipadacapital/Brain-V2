# Retro — feat-metric-engine-olap-split (Child 4)

> Written by Rohan (cto-advisor) at Stage 6. Feeds the lessons-learned registry consulted by the next CTOA intake.

| Field | Value |
|---|---|
| **req_id** | `feat-metric-engine-olap-split` (Child 4 of EPIC `chore-migrate-legacy-to-brain`) |
| **Lane** | high-stakes (money, schema-proto, multi-tenancy, india-compliance) |
| **Outcome** | PASS (1 bounce round; round-2 Security + QA both PASS) |
| **Bounce rounds** | 1 (Security H-1 → Maya+Vikram bounce-fix → round-2 PASS) |
| **Tests** | 434 (41 analytics + 291 brain_metrics + 102 lib-metrics), 0 failures |

---

## What worked

- **Stage-1 personas paid for themselves.** Both `:sonnet` personas pre-emptively named the exact failure classes that mattered: the OLAP realist's CRITICAL (ClickHouse `/` returns Float64, harness had zero round-trip coverage) and the finance realist's True-CM2-has-no-comparand + the 6→9 field DDR expansion. The build was structured around these from the start — `intDiv` everywhere, `parity_gap`/`child_dependency`/`formula_snapshot` fields, the correctness-fixture gate.
- **The 9-field DDR is genuinely good governance.** `parity_gap` + `child_dependency` + `formula_snapshot` with code-enforced sign-off rules (`assert_signable()`) made my Stage-6 sign-off honest and mechanical: I could SIGN 9 rows and leave 2 UNSIGNED-PENDING with a structural guarantee that a premature sign-off is impossible. The `formula_snapshot` immutability means my signature pins the exact formula — a later silent amendment can't ride on it.
- **The bounce worked exactly as designed.** Security caught a real money/governance-integrity HIGH; the bounce-fix split cleanly by lane (Maya locked canon from canon sources → Vikram aligned TS + rebuilt the gate); round-2 both reviewers re-verified against actual files and killed mutants themselves.
- **Shape-A discipline held.** Zero live DDL, zero read-flip, zero legacy edit, no Child-5/6 scope pulled forward. The HELD `HOLD-AT-READ-FLIP` kept the irreversible act out of this child entirely.

## What didn't work / what surprised us

- **The verify-the-verifier root cause recurred INSIDE the child built to end it — and this time it MATERIALIZED, it wasn't just predicted.** This is the strong lesson. `CF-C4-VERIFY-THE-VERIFIER-1` was bound at Stage 1 specifically to prevent vacuous gates in this child. Yet the round-1 build shipped a **vacuous registry-parity gate** (step 6 checked directory presence only) that let 4 Brain-native decision metrics carry **materially different formulas in TS vs Python/DDR** straight to review. The `correctness_fixture` routing (`parity_gap:true`) — itself a Stage-1 safety mechanism — became the hiding place: it routed those metrics AWAY from the only cross-language comparison, so the divergence was invisible to every gate. The instrument designed to catch the failure class was the instrument that exhibited it.
- **Round-1 QA gave PASS on the same defect Security bounced.** Tanvi's round-1 review classified the registry-id asymmetry (F2) as DEFER, not blocking — she saw the 17-vs-25 metric mismatch and the `ltv_cac_x100` vs `ltv_cac_bp` scale divergence and reasoned it away as "shadow-phase, not a byte-identity violation for the current gate scope." Shreya, looking at the same facts, correctly read it as a HIGH money/governance breach. **A vacuous gate plus a reviewer who trusts the gate's GREEN is two verify-the-verifier failures stacked.** QA's round-2 fix (re-killing both mutants herself, not trusting the report) is the right posture — and it's the posture that should have applied in round-1.
- **A self-consistent unit test pinned the WRONG formula as "correct."** `registry.test.ts:204-216` asserted the divergent TS formulas (flat-per-order true_cm2; reciprocal pamer; gross-sales amer) and passed green — a tautological pin. A test that encodes the implementation's value and then asserts the implementation produces that value proves nothing.

## Root-cause classification

Same class as Child-1 (contextless RLS probe), Child-2 (tautological re-derivation), Child-3 (impossible-PII-condition + self-verifying HMAC): **a verification instrument that cannot actually fail on real inputs gives a false GREEN at a high-stakes gate.** Child-4 adds two new flavors: (a) the gate checks the wrong thing entirely (directory presence, not content); (b) a safety-routing mechanism (correctness-fixture) doubles as the hiding place. This is now the **5th occurrence** (Child-4 in-child, materialized) on top of the 4 prior (Child-4 was already logged as #4 for the Stage-1 *pre-emptive* catch; the in-child round-1 recurrence is a distinct, materialized #5).

## What I changed at this Stage-6

- Signed 9 DDR rows; left 2 (`total_tax_mu`, `fx_restatement`) UNSIGNED-PENDING-child-dependency (Child-3).
- Recorded the True-CM2 RTO-provision formula as **Phase-0 proxy canon** with a forward caveat to refine toward the granular canon cost components.
- Reinforced the human-gated rule proposal `verify-the-verifier-mutation-on-gate` with this in-child materialized recurrence as **evidence #5** (NOT self-adopted — awaiting `/adopt-rule`).

## Lessons for the next CTOA intake (registry candidates)

1. **A correctness-fixture / parity-gap routing is a verification BLIND SPOT until proven otherwise.** Any time a metric is routed away from the primary cross-language comparison, the Stage-2 plan MUST name the *replacement* gate AND its killed mutant — and Stage-6 MUST mutate the real source on disk to confirm the replacement gate is non-vacuous. (I did this; it should be standard.)
2. **A "registry seam present" / "directories exist" check is NOT a parity gate.** Presence ≠ content equality. Treat any gate that asserts existence rather than agreement as vacuous-by-default.
3. **QA must re-kill mutants, not trust the build report's GREEN — in round 1, not just round 2.** The round-1 QA PASS on a bounced defect is the avoidable miss here.
4. **The pending `verify-the-verifier-mutation-on-gate` rule now has 5 occurrences across 4 consecutive high-stakes children + one in-child materialized recurrence.** This is the single strongest standing-rule candidate in the epic. Surfaced to Founder for `/adopt-rule`.

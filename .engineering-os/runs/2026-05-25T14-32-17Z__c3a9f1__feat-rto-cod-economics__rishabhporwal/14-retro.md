# Retro — feat-rto-cod-economics (Phase-2 slice 3)

## What worked

- **Reading the actual legacy formula at Stage-1 caught a wrong SPEC before any code.** The ratified
  slice table said break-even `r*=M/(M+C)`. The real legacy (`cod-prepaid-analytics.ts:218-231`) is the
  FULL `(V·P + (COD_fee − PG_fee) + P·(S+RS))/(V+S+RS)` — 500bp vs the naive ~9493bp on the same inputs.
  Following the slice table literally would have shipped a wrong moat metric GREEN. This is the slice-2
  "don't assume correctness; read the legacy" lesson applied — now in a new direction (wrong spec, not
  wrong code).
- **The persona earned its keep.** `india-rto-cod-numeric-realist:haiku` (bounded, ~6× cheaper) surfaced
  4 real concerns, all bound into the plan: the break-even formula, integerizing the pincode float score,
  the cod-realization predicate, and the connector-dependency on RTO cost/value. A 1-persona, single-
  dimension call was right — no over-spawn.
- **Non-vacuous anchors that DISTINGUISH right from wrong.** Every new gate pins a cross-language anchor
  that fails the plausible-wrong form: break-even `== 500 && != 9493`; pincode `== 5900` (kills a float
  port); plus moves-with-each-input mutant-kills. The parity gate's correctness_fixture SQL+DDR coverage
  bit automatically for the 2 Brain-native econ metrics.
- **Foundation reuse held (~90% plumbing).** Query gateway, DataPlanePort, registry+parity harness, DDR
  machinery, `rto_rate_bp`/`prepaid_rate_bp`/`aov_mu` (Child-4), format-money, requireRole, the shell —
  all reused. `rto_rate_bp` was NOT re-added (Single-Primitive Rule).
- **Honest-input pattern carried cleanly.** Shipment-level operational facts (counts, charges, fees,
  pincode aggregates) are EXPLICIT workspace-scoped use-case inputs — never gateway columns, never hidden
  defaults — exactly like slice-1 ReversalFacts / slice-2 VariableCostFacts. Connector-sourced money
  (`rto_cost_mu`/`rto_revenue_lost_mu`) correctly held via a DDR child_dependency (mirrors `total_tax_mu`).
- **Privacy improvement.** The legacy pincode module used `customer_phone` for repeat counts; Brain
  accepts only aggregate `unique_customers`/`repeat_customers` integers — no PII crosses the boundary.
- **Live wire smoke proved real data on all 4 surfaces + fail-closed tenancy** (foreign workspace →
  UnscopedQueryError) + the high_rto filter on the wire.

## What didn't (or surprised us)

- **A seed inconsistency slipped to the first router-test run.** The RTO-analytics by-payment counts
  (180+10=190) didn't reconcile to `rto_orders=224`; the test caught it; fixed the seed (180+44=224).
  Minor, but a reminder that even harness seeds need an internal-consistency invariant test.
- **Stale dev servers again.** :3000/:3001 had stale processes from a prior session (the recurring
  slice-2 lesson) — killed before smoke. The runbook lesson holds: always verify the booted process is
  on the current build before trusting a smoke.
- **NDR was in the brief but has no honest pre-Child-3 data source.** Scoped OUT (building an NDR metric
  on absent intermediate-status data would be dishonest); flagged for a future slice. Recorded so it
  isn't silently dropped.

## Root cause of the primary finding

A specification (the slice table) carried a simplified formula that diverged from the legacy source of
truth. The general root cause is the same verify-the-verifier family: trusting an artifact (a green gate
in #8, a spec in #9) without an anchor that distinguishes it from the plausible-wrong alternative.

## Disposition

- Added as **evidence #9** to the existing human-gated proposal
  `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md` (NOT self-adopted
  — awaits Founder `/adopt-rule`). #9 extends the pattern: a non-vacuous anchor catching a *wrong spec*
  at intake, the inverse of #8 (a vacuous gate hiding wrong code).
- Slice-3 closed its instance with production-path cross-language anchors (break-even 500≠9493, pincode
  5900) re-verified to bite at Stage-6 (independent re-run + live wire re-smoke + hand re-derivation).

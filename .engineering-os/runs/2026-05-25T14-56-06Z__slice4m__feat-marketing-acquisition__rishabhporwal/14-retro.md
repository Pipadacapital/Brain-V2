# Retro — feat-marketing-acquisition (Phase 2, slice 4)

## What worked

- **Reading the actual legacy formula at Stage 1 again caught the spec being wrong — twice over.** The ratified slice-table named paMER/payback/placed→realized→incremental for slice 4. Ground truth: paMER has NO legacy comparand, payback + the attribution ladder are slice-5 cohort concepts. Building them would have re-implemented non-existent or mis-placed metrics. (Same lesson as slice 2/3 — now codified as a candidate rule.)
- **The semantic-recall + parity-gate output surfaced a hidden pre-build divergence.** Running the parity gate at intake exposed that Child-4 had speculatively pre-built `amer_bp` (= true_cm2/total_spend, ≠ legacy aMER) and `pamer_bp` (phantom, no comparand), split unevenly across registries behind a "shadow-phase" carve so no cross-language gate bit them. Caught before any page wired to them.
- **Reconcile-don't-wire kept the slice honest.** Redefined `amer_bp` to legacy (nc_revenue/acquisition-classified-spend), decommissioned `pamer_bp`, brought `mer_bp`/`cac_mu` into both registries. The decommission was net-negative LOC on dead code.
- **The aMER classification-split anchor (acq ₹40k < total ₹100k → 15000bp, "use total spend"→6000 KILL) is genuinely non-vacuous** and now lives in the parity gate's mutant-1 (retargeted from the decommissioned pamer_bp), 2 unit tests, and a router test. The exact landmine I found is now permanently guarded.
- Reuse held: zero new deps, zero new primitives, the DataPlanePort seam + registry + DDR + format helpers all reused. 380 tests green across 5 suites; typecheck 0; live wire smoke correct.

## What didn't (friction)

- **The decommission collided with a `test_locked_canon.py` "LOCKED CANON" suite** that froze the old (invented) pamer/amer canon — ~8 references across 3 test files + the DDR `.md` mirror. Updating a "locked" canon to a MORE legacy-faithful one is correct but laborious, and a naive build would have either skipped it (red tests) or left stale canon. The lock was protecting an invented metric, which is the deeper smell.
- **TS `formula_ts` type is `bigint | number` (no null)**, but `cac_mu`/`cm2_per_nc_mu` naturally want to return null on zero denominator. Resolved by throwing (matching the ratio-formula convention; callers already guard) — but this is a small TS/PY behavioral asymmetry on the zero-denominator edge (PY returns None). Acceptable (parity gate checks structure, not edge-behavior; both guarded) but worth noting.

## What surprised us

- **A GREEN parity gate was hiding a real divergence.** The "shadow-phase" carve (PY-only/TS-only metrics exempted from cross-language equality) is a legitimate mechanism, but it let an invented, unvalidated def sit GREEN indefinitely. The slice-4 reconciliation shrank the PY-only carve from 5 to 3 and removed the phantom — the gate is now stricter and still non-vacuous.

## Auto-candidate rule (step 8a)

Root cause "slice-table shorthand / speculative pre-build diverges from legacy; must read the real formula at Stage 1/2 and reconcile" appears in ≥3 distinct runs (slices 3, 4, + the metric-engine/pnl divergence retros). Generated CANDIDATE rule `.engineering-os/rule-proposals/2026-05-25__verify-legacy-formula-at-stage1-not-slice-table.md` (human-gated; NOT self-adopted). Surfaced to Founder.

## Carried forward

- `new_customer_revenue_mu`/`nc_cm2_mu`/`cm2_per_nc_mu`/`acquisition_ad_spend_mu` are UNSIGNED-PENDING child-3-shopify-connector (live first-order/classification facts) — flips at the held cutover, same pattern as slice-1/3.
- Deferred (explicit non-goals, future slices): acquisition trend MA90/180/365 + composition strip; WooCommerce acquisition path; campaign-classification CRUD UI (slice 7); goals overlay (slice 7); payback + cohort/LTV attribution ladder (slice 5).

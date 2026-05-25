# Retro — feat-cohorts-ltv (Phase 2, slice 5)

## What worked
- **Reading the actual legacy formulas at Stage 1 caught 5 divergences before a line was built** — including a 3rd speculative pre-built phantom (`cac_payback_months` = CAC/MonthlyCM2, which is NOT the legacy cumulative bucket-walk). This is the SAME root cause as slice-4's `pamer_bp` and the slice-2/3 spec/code divergences.
- The honest-input + fail-closed use-case pattern (from slices 1-4) ported cleanly; the registry → use-case → DataPlanePort → tRPC → web pipeline is now a well-grooved 5th repeat.
- Non-vacuous anchors carried all the way to the wire: the live smoke proved payback=1.0mo (not the phantom 2mo) and an interpolated 0.33mo on a second cohort — interpolation is genuinely exercised, not a whole-month shortcut.
- Centi-months (×100 integer) preserved the legacy linear interpolation without floats — integer-paise discipline held.

## What didn't (caught + fixed in-flight)
- First LTV summary implementation double-applied the cumulative mode (aggregated the mode-applied `m[]` then re-applied mode for the cards) → `month1` was 1999999 not 1166666. Fixed to aggregate the per-row INCREMENTAL and apply the mode once. A real bug the test caught — exactly why the summary-card anchor exists.
- `m[]` typed `bigint[]` means repeat-rate bp values are bigint in that array; one router test expected `number`. Minor; fixed.

## What surprised us
- The slice-table's `cohort_cumulative_cm2_mu` AND the pre-built `ltv_cac_bp` comment BOTH named CM2 for the cohort rung, while legacy uses CM3. Two artifacts agreed with each other and both were wrong vs the legacy code — a reminder that internal consistency is not correctness.
- LTV and cohorts share surface vocabulary ("LTV", "retention") but are structurally different computations (CM2 dimensioned vs CM3 monthly; no-CAC vs CAC+payback). The slice-table conflation would have produced a plausible-but-wrong build.

## Recurring root cause (feeds step 8a)
"Slice-table shorthand + speculative pre-builds diverge from legacy ground truth" now recurs across slices 2, 3, 4, and 5 (≥4 runs). The candidate rule `verify-legacy-formula-at-stage1-not-slice-table` already exists (generated at slice-4, human-gated). This run is evidence #5.

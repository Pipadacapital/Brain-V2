# Persona — marketing-efficiency-numeric-parity-realist (:sonnet)

Adversarial stress-test of slice 4's marketing-metric correctness vs legacy ground truth. Mandate: surface ≥1 real concern (a "looks good" pass is rejected).

## Concern 1 (HIGH) — aMER denominator must be acquisition-classified spend, NOT total spend

Legacy `marketing-efficiency.ts`: `aMer = newCustomerRevenue / acquisitionAdSpend` where `acquisitionAdSpend = sumDailyMapInRange(acquisitionByDate, ...)` — and `acquisitionByDate` is populated ONLY from campaigns whose resolved intent === 'acquisition' (`ads-spend.ts:82-84`). Unclassified, brand, and non_acquisition spend are EXCLUDED. If Brain models aMER as `true_cm2 / total_ad_spend` (the Child-4 `amer_bp`) or even `nc_revenue / total_ad_spend`, it will be **systematically wrong** (denominator too large → aMER understated) for any workspace that classifies campaigns. The plan MUST carry a distinct `acquisition_ad_spend_mu` input separate from `total_ad_spend_mu`, and the worked anchor MUST use a classification split (e.g. total=₹100k, acquisition=₹60k) so the gate FAILS a "use total spend" mutant.

## Concern 2 (HIGH) — `pamer_bp` is a phantom; `amer_bp` is mis-defined. Both must be fixed, not consumed.

`pamer_bp` (cm2/total_ad_spend) has NO legacy comparand — it was invented in Child-4. `amer_bp` (true_cm2/total_ad_spend) is NOT legacy aMER. If `/acquisition` wires to either as-is, the page shows numbers the Founder never validated. Decision required at Stage 2: (a) DECOMMISSION `pamer_bp` (preferred — dead def, removes the landmine), and (b) REDEFINE `amer_bp` to legacy semantics with a DDR row recording the change. Leaving them and "shadow-carving" them is how this debt was created in the first place — do not extend the carve.

## Concern 3 (MED) — MER numerator basis divergence is silent today

Legacy MER numerator = `fetchStoreNetRevenueForPeriod` = per-order (totalPrice − totalTax − refundShare) with analytics/gap-fill reconciliation. The Child-4 `mer_bp` uses `net_sales_mu`. These may not be equal (net_sales may not subtract the same refund share / may include tax differently). Because `mer_bp` is PY-only, NO cross-language parity bites it. Stage 2 must: define `mer_bp` in BOTH registries AND register a DDR row stating which net-revenue basis Brain uses, with a worked anchor tied to the SAME range the /store page reports — so MER numerator == /store net revenue (cross-surface consistency). A mismatch here makes MER look "off" vs the store page and erodes trust.

## Concern 4 (MED) — new-customer revenue must exclude RTO and tax, per-order, never blended

Legacy: `newCustomerRevenue += totalPrice − totalTax − orderShareRefunds`, and ONLY when `!isRto`. Two India-correctness traps: (1) `totalTax` is per-order (flows from per-SKU GST upstream) — a blended-tax shortcut would violate the canon; (2) RTO orders contribute 0 (reuse slice-3 RTO ids). The negative-path tests MUST include an RTO new-customer order (contributes 0 revenue + 0 CM2) and a refund-share case, or the gate is vacuous.

## Concern 5 (MED) — `cac_payback_months` and the attribution ladder are NOT slice 4

`cac_payback_months` = cac/monthly_cm2 is a cohort-payback proxy; real payback (cumulative CM3 crossing CAC over cohort months) lives in `lib/cohorts`/`lib/ltv` (slice 5). The slice-table's "paMER/payback/placed→realized→incremental" shorthand conflates slice 5 into slice 4. Wiring payback here would either (a) ship a wrong proxy or (b) prematurely pull cohort machinery. Keep it out; do not wire `cac_payback_months`.

## Concern 6 (LOW) — distributions is statistical, not attribution; mode determinism

`distributions.ts` computes per-product per-order distributions (mode/mean/diff + 60-bucket density of sales OR CM1). The mode tie-break (`count === bestCount && val < bestValue`) and the 2dp rounding before frequency counting are load-bearing for determinism — port them exactly. This is NOT an attribution ladder; do not over-engineer it into one. SQL/statistical, deterministic, no float drift in the displayed mode/mean.

## Verdict

Slice 4 is buildable and correct ONLY if (1) aMER uses acquisition-classified spend, (2) `amer_bp` is redefined to legacy + `pamer_bp` decommissioned, (3) `mer_bp` gets a both-registry def + DDR numerator-basis row, (4) NC revenue excludes RTO + uses per-order tax, (5) payback/attribution stay out (slice 5). All six are reflected in the Stage-1 binding scope. Non-vacuous anchors with a classification split and an RTO new-customer case are mandatory.

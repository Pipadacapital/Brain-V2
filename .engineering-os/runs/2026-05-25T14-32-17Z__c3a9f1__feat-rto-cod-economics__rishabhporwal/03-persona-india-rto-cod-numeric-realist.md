# Persona — india-rto-cod-numeric-realist (:haiku, bounded)

> Adversarial numeric-parity stress-test of the slice-3 economics formula ports.
> Mandate: surface ≥1 concern. A "looks good" persona is rejected.

## Concern 1 (PRIMARY) — the break-even formula is NOT M/(M+C); port the FULL legacy formula

The slice table says `breakeven_cod_rto_rate (r*=M/(M+C))`. The actual legacy
(`cod-prepaid-analytics.ts:218-231`) is:

```
numerator   = V·P + (COD_fee − PG_fee) + P·(S + RS)
denominator = V + S + RS
r*_cod      = numerator / denominator     (only valid if 0 ≤ r* ≤ 1)
```
V=AOV, P=prepaid RTO rate, COD_fee=flat COD handling fee, PG_fee=V·gatewayPct, S=return-shipping/RTO, RS=restocking(=0).

**Worked example that distinguishes the two:** V=₹1500 (150000p), P=0.05, COD_fee=₹30 (3000p),
gatewayPct=2% → PG_fee=₹30 (3000p), S=₹80 (8000p), RS=0.
- numerator = 150000·0.05 + (3000−3000) + 0.05·8000 = 7500 + 0 + 400 = 7900 (paise-scaled units)
- denominator = 150000 + 8000 + 0 = 158000
- r* = 7900/158000 = 0.05 = **500 bp** (5.00%).
- The naive `M/(M+C)` with M=AOV, C=RTO cost would give a totally different number (~95%). **They are not close.**

**Required:** registry `breakeven_cod_rto_rate_bp` MUST implement the FULL formula; DDR row
`_ROW_BREAKEVEN_COD_RTO`; cross-language anchor pinning the worked example above (TS and Python both
return 500bp for these inputs) — a fixture that FAILS the naive `M/(M+C)` and PASSES the full form.
Without this anchor the gate is vacuous (slice-2 lesson). **Integer caution:** the formula has nested
divisions; compute in integer paise with a single final FLOOR-to-bp (`intDiv(numerator·10000,
denominator)`), NOT chained float ratios — otherwise TS↔Python will drift.

## Concern 2 — pincode reliability score has float-shape risk; must be integerized deterministically

Legacy `calcProfitabilityScore(rtoRate, codRate, repeatRate, aov)` =
`clamp(0,100, 100 − rtoRate·2 − codRate·0.5 + repeatRate·0.5 + (aov/1000)·10)` where the rates are
*percent points* (e.g. 18 for 18%) and aov is rupees. This is float-native. A naive port will TS↔Python
drift on the `·0.5` and `aov/1000·10` terms.

**Required:** define `pincode_reliability_score` on INTEGER inputs (rates in bp, aov in paise) with a
single integer formula and a fixed scale, e.g. score in centi-points (×100) so all coefficients become
integers: `score_cp = clamp(0, 10000, 10000 − intDiv(rto_bp·2·100, 100) − … )` — pick ONE integer scale,
pin it in the DDR formula_snapshot, and anchor a worked example both languages reproduce byte-identically.
parity_class = correctness_fixture (Brain-native; the legacy float fn is not a byte comparand). Do NOT
ship the float formula.

## Concern 3 — cod_realization_rate_bp predicate + zero-denominator guard

Legacy `codRealizationRatePercent = round(codDelivered/codOrders·10000)/100`, where delivered = status
contains 'DELIVER', null when codOrders=0. Port as `cod_realization_rate_bp = intDiv(cod_delivered·10000,
cod_orders)` with NULL guard when cod_orders ≤ 0 (reuse the `_ratio_bp` helper — same null-guard class as
`rto_rate_bp`). Confirm the status predicate is the exact substring match ('DELIVER' / 'RTO'), not an
equality — the legacy uses `.includes()`. The use-case (not the registry) owns the predicate; the
registry owns the ratio. Keep that separation.

## Concern 4 — rto_cost_mu / rto_revenue_lost_mu are SUMs, not ratios; keep them passthrough money defs

`rto_cost_mu` = SUM of per-RTO-shipment charges; `rto_revenue_lost_mu` = SUM of RTO order/COD value.
These are aggregate money facts (like `gross_sales_mu`) — register as passthrough `money/mu` defs
(shadow_compare structurally, but Brain-native value with no clean legacy byte comparand on the new
ingest path → safest as correctness_fixture with a DDR row, OR shadow_compare with a child_dependency on
Child-3 like `total_tax_mu`). Recommend: child_dependency `child-3-shopify-connector` (the cost/value
data is connector-sourced and not measurable pre-cutover) — mirrors `_ROW_TOTAL_TAX`. Aryan to rule;
either way it must NOT be silently float-matched.

## Verdict

ADVANCE with these four bound corrections. The dominant risk (Concern 1) would have been a silent
correctness regression if the slice table had been followed literally — exactly the class the slice-2
retro warned about. All four are SQL/integer-discipline items; no ML/LLM is implied. No paradigm risk.

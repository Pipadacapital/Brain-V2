# Definitional-Delta Register — Child 4 (Brain-native Metric Engine)

> **Status:** **PARTIALLY SIGNED by Rohan (cto-advisor) at Stage 6, 2026-05-25.** 9 rows SIGNED · 2 rows UNSIGNED-PENDING-child-dependency.
> **Signed:** `cm2_mu`, `misc_expenses_prorated_mu`, `cogs_mu`, `true_cm2_mu` (correctness-fixture, no-legacy-shadow acknowledged), `amer_bp` (correctness-fixture, REDEFINED to legacy in slice-4), `ltv_cac_bp` (correctness-fixture), `blended_roas_x100`, `acos_bp`, `mer_bp` (slice-4). **Decommissioned:** `pamer_bp` (slice-4 — no legacy comparand). **Unsigned-pending child-3:** `new_customer_revenue_mu`/`nc_cm2_mu`/`cm2_per_nc_mu`/`acquisition_ad_spend_mu`.
> **UNSIGNED-PENDING-child-dependency:** `total_tax_mu` (unlocks when `child-3-shopify-connector` is GREEN — per-SKU GST tax) · `fx_restatement` (unlocks when `child-3-workspace-cost-currency-migration` is GREEN — live FX).
> **True-CM2 RTO-provision formula recorded as Phase-0 proxy canon** (cost-base-per-order); refine toward the canon's granular forward/reverse/restock/write-down + refund/payment-failure form in a later child (tracked by `formula_snapshot` immutability). See `11-final-review.md` §DDR.
> **Adjudication source:** `.engineering-os/runs/2026-05-24T22-25-29Z__0e76f7__feat-metric-engine-olap-split__rishabhporwal/11-final-review.md`.
> **Machine-readable counterpart:** `definitional_delta_register.py` (drives the parity harness hook).
> **9-field schema:** `legacy_formula` · `brain_formula` · `reason` · `shadow_compare_classification` · `delta_direction_and_magnitude` · `business_impact` · `parity_gap` · `child_dependency` · `formula_snapshot`
>
> **Two structural sign-off rules (CF-C4-DDR-1 — enforced in code):**
> 1. A `parity_gap:True` row can NEVER be signed as "shadow-compare GREEN" — it has no legacy shadow. Routes to correctness-fixture gate.
> 2. A row with a non-null `child_dependency` can NEVER be signed before that dependency's gate is GREEN.

---

## Day-one rows

### 1. `cm2_mu` — CM2 (pnl.ts lagged vs compute-daily daily)

| Field | Value |
|---|---|
| **legacy_formula** | `compute-daily.ts:234` (`cm2 = cm1 - totalAdSpend`); divergent path `pnl.ts:195` (lagged range) |
| **brain_formula** | `cm2_mu` |
| **reason** | Brain canonicalizes on `compute-daily.ts` daily path. `pnl.ts:195` is a range-aggregate (lagged shipping cost attribution) that diverges on high-RTO / fast-shipping days. |
| **shadow_compare_classification** | `EXPECTED_DEFINITIONAL_DELTA` |
| **delta_direction_and_magnitude** | Brain slightly higher when `pnl.ts` lags shipping. Magnitude: 0–5% of total ad spend on high-shipping days. |
| **business_impact** | Small delta on range aggregates; daily comparand is correct. Non-blocking. |
| **parity_gap** | `False` |
| **child_dependency** | `null` |
| **formula_snapshot** | `cm2_mu = cm1_mu - total_ad_spend_mu` (integer subtraction, paise) |

Rohan sign-off: ☑ SIGNED (Rohan, Stage-6, 2026-05-25)

---

### 2. `misc_expenses_prorated_mu` — Misc Expenses (proration boundary)

> **CF-C4-DDR-MISC-PRORATE-1 — Adjudication discipline:** triage MUST ask "Is Brain's `toDaysInMonth(date)` correct?" BEFORE stamping `EXPECTED_DEFINITIONAL_DELTA`. A wrong-constant bug (e.g. hardcoded 30 instead of `toDaysInMonth`) must NOT be hidden behind `ROUNDING_MODE_MISMATCH`.

| Field | Value |
|---|---|
| **legacy_formula** | `compute-daily.ts:236-243` (`monthlyAmt / getDaysInMonth(dateAtNoonUtc)`) |
| **brain_formula** | `misc_expenses_prorated_mu` |
| **reason** | Brain uses `intDiv(monthly_amount_mu, toDaysInMonth(date))` — integer FLOOR division. Legacy used JS float stored as Postgres Decimal (ROUND_HALF_UP). Delta = Postgres ROUND_HALF_UP vs Brain ROUND_HALF_EVEN on .X45 midpoints (±1 paise). **NOT a Float64 coercion artifact.** |
| **shadow_compare_classification** | `EXPECTED_DEFINITIONAL_DELTA` |
| **delta_direction_and_magnitude** | **Feb-boundary worked example (CF-C4-DDR-MISC-PRORATE-1):** monthly=₹10,000 (1000000 paise). Feb 2026 (28 days): `intDiv(1000000,28)` = **35714** paise/day. Feb 2024 (leap, 29 days): `intDiv(1000000,29)` = 34482. March (31 days): `intDiv(1000000,31)` = 32258. **Wrong constant 30:** `intDiv(1000000,30)` = 33333 — **WRONG by 2381 paise (₹23.81/day) in Feb** — BLOCKING_BUG, not rounding. ROUNDING_MODE_MISMATCH drift: at most 1 paise on .X45 midpoints. |
| **business_impact** | 1-paise drift non-material. Wrong-constant bug (₹23.81/day for ₹10k monthly) is material on Feb boundary. |
| **parity_gap** | `False` |
| **child_dependency** | `null` |
| **formula_snapshot** | `misc_expenses_prorated_mu = intDiv(monthly_amount_mu, toDaysInMonth(date))`; ClickHouse: `if(toDaysInMonth(date) > 0, intDiv(monthly_amount_mu, toDaysInMonth(date)), NULL)` |

Rohan sign-off: ☑ SIGNED (Rohan, Stage-6, 2026-05-25)

---

### 3. `cogs_mu` — COGS (coq-settings-change model)

> **CF-C4-COGS-MV-REFRESH-1:** `COGS_SETTINGS_CHANGE_DELTA` is DISTINCT from `EXPECTED_DEFINITIONAL_DELTA` — this is a data-staleness class, not a formula change.

| Field | Value |
|---|---|
| **legacy_formula** | `compute-daily.ts` (nightly full recompute via `resolveLineItemCogs` + `coqMap`) |
| **brain_formula** | `cogs_mu` |
| **reason** | Brain uses scheduled full daily recompute keyed on `(workspace_id, date)`. Matches legacy: on a coq-settings-change day, full recompute uses CURRENT `coq` for ALL line items. An incremental MV would be WRONG (old `coq` for pre-change events, new `coq` after — permanently wrong). |
| **shadow_compare_classification** | `COGS_SETTINGS_CHANGE_DELTA` |
| **delta_direction_and_magnitude** | Zero delta (full-recompute model). Incremental MV delta on coq-change day = `(new_coq - old_coq) × line_items_before_change_time`. Example: 10 orders before change × (₹75 - ₹50) = ₹250 error. |
| **business_impact** | COGS feeds CM1→CM2→CM3 ladder. Wrong COGS on coq-change day silently corrupts all downstream margins. Full-recompute eliminates this risk. |
| **parity_gap** | `False` |
| **child_dependency** | `null` |
| **formula_snapshot** | `cogs_mu = SUM(resolveLineItemCogs(item, coqMap, cogsSettings))` per line item; scheduled full daily recompute at `(workspace_id, date)`, integer per-item paise |

Rohan sign-off: ☑ SIGNED (Rohan, Stage-6, 2026-05-25)

---

### 4. `true_cm2_mu` — True CM2 (RTO-provisioned) — Brain-native

> **CF-C4-DDR-TRUE-CM2-1 — parity_gap:True.** Rohan's Stage-6 sign-off MUST explicitly acknowledge there is no legacy shadow. Routes to **correctness-fixture gate ONLY**.

| Field | Value |
|---|---|
| **legacy_formula** | **NONE** — `compute-daily.ts` stops at `cm2` (line 234); no `trueCm2` / `rtoProvision` field exists in legacy |
| **brain_formula** | `true_cm2_mu` |
| **reason** | True-CM2 is Brain-native with NO legacy comparand. Brain's True CM2 = CM2 − RTO Provision, where: `rto_provision_mu = intDiv(rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu), total_orders_count)`. The legacy system does not provision for RTO reversal costs. |
| **shadow_compare_classification** | `CORRECTNESS_FIXTURE` |
| **delta_direction_and_magnitude** | Not applicable — no legacy comparand. True CM2 ≤ CM2 always. **Worked example (CF-C4-DDR-TRUE-CM2-1):** total_orders=120, rto_orders=18 (15% RTO), ad_spend=₹50,000, variable_costs=₹12,000, COGS=₹30,000, CM2=₹80,000. `cost_base = 9200000 paise`. `rto_provision = intDiv(18×9200000, 120) = 1380000 paise`. **`true_cm2 = 8000000 - 1380000 = 6620000 paise (₹66,200)`**. |
| **business_impact** | True CM2 is a more conservative signal for high-RTO categories. 15% RTO reduces CM2 by ~17% in the worked example. Material for fashion/impulse D2C (20%+ RTO common). |
| **parity_gap** | **`True`** — Brain-native, no legacy shadow |
| **child_dependency** | `null` |
| **formula_snapshot** | `true_cm2_mu = cm2_mu - intDiv(rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu), total_orders_count)`; `NULL` when `total_orders_count <= 0`; ClickHouse: `if(total_orders_count > 0, toInt64(cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), total_orders_count)), NULL)` |

**Rohan sign-off (required):** ☑ SIGNED (Rohan, Stage-6, 2026-05-25) — correctness-fixture acknowledgment: "I have reviewed the correctness-fixture worked example (re-derived independently: cost_base=9200000, rto_provision=1380000, true_cm2=6620000 paise). There is no legacy shadow for `true_cm2_mu`. I am signing the **correctness of the formula**, NOT a shadow-compare GREEN. The RTO-provision form (cost-base-per-order) is signed as **Phase-0 proxy canon** — to be refined toward the business-canon granular forward/reverse/restock/write-down + refund/payment-failure cost components in a later child; the `formula_snapshot` immutability guarantees this signature pins exactly the proxy form."

---

### 5. `pamer_bp` — paMER — **DECOMMISSIONED (Phase-2 slice-4, feat-marketing-acquisition)**

paMER (= cm2/total_ad_spend) was a Child-4 pre-build with **NO legacy comparand** — an invented
"profit-adjusted MER" that never matched the legacy acquisition surface and was never consumed by any
page. Rohan's slice-4 Stage-1 review caught it and **removed `pamer_bp` from both registries + the DDR**.
No DDRRow remains for `pamer_bp`. This row is retained as an audit-trail marker only.

---

### 6. `amer_bp` — aMER — **REDEFINED to legacy (Phase-2 slice-4)**

| Field | Value |
|---|---|
| **legacy_formula** | `marketing-efficiency.ts:25-28` — `aMer = newCustomerRevenue / acquisitionAdSpend` (acquisition campaign-intent bucket ONLY; `ads-spend.ts:82-84`). |
| **brain_formula** | `amer_bp` |
| **reason** | REDEFINED from the Child-4 placeholder (`true_cm2/total_ad_spend`) to the legacy semantics: `nc_revenue / ACQUISITION-classified spend`. The denominator is its own def (`acquisition_ad_spend_mu`), NOT `total_ad_spend_mu` — the load-bearing correction (Rohan Stage-1 finding + persona Concern 1). |
| **shadow_compare_classification** | `CORRECTNESS_FIXTURE` |
| **delta_direction_and_magnitude** | Brain integerizes the legacy float to a single FLOOR-to-bp. Anchor (classification split): nc_revenue=₹60k (6000000p), acquisition_ad_spend=₹40k (4000000p) — total spend may be ₹100k but only ₹40k is acquisition-classified → `amer_bp = intDiv(6000000×10000, 4000000) = 15000 bp = 1.50x`. "Use total spend" mutant → 6000 bp (KILLED). |
| **business_impact** | aMER is THE new-customer acquisition-efficiency decision metric. Using total spend understates aMER for any brand that classifies campaigns. |
| **parity_gap** | **`True`** |
| **child_dependency** | `null` |
| **formula_snapshot** | `amer_bp = intDiv(new_customer_revenue_mu * 10000, acquisition_ad_spend_mu); NULL if acquisition_ad_spend_mu <= 0` |

Rohan sign-off: ☑ SIGNED (Rohan, Stage-6, 2026-05-25; redefined to legacy semantics)

---

### 7. `ltv_cac_bp` — LTV:CAC — Brain-native

| Field | Value |
|---|---|
| **legacy_formula** | NONE — Brain-native |
| **brain_formula** | `ltv_cac_bp` |
| **reason** | LTV:CAC = Customer Lifetime Value / CAC (bp). LTV computed by lifecycle-service. Brain-native ratio. |
| **shadow_compare_classification** | `CORRECTNESS_FIXTURE` |
| **delta_direction_and_magnitude** | No legacy comparand. Example: LTV=₹3,000 (300000p), CAC=₹1,000 (100000p). `ltv_cac_bp = intDiv(300000×10000, 100000) = 30000 bp = 3.0x`. |
| **business_impact** | LTV:CAC > 30000 (3.0x) = healthy D2C acquisition. Signals acquisition efficiency vs retention trade-off. |
| **parity_gap** | **`True`** |
| **child_dependency** | `null` |
| **formula_snapshot** | `ltv_cac_bp = intDiv(ltv_mu * 10000, cac_mu); NULL if cac_mu <= 0` |

Rohan sign-off: ☑ SIGNED (Rohan, Stage-6, 2026-05-25)

---

### 8. `total_tax_mu` — Total Tax (GST-2.0 event-level vs ShopifyQL aggregate)

> **CF-C4-DDR-GST-TAX-1 — HIGHEST-RISK wrong-but-signed delta.** NOT signable or measurable pre-Child-3.

| Field | Value |
|---|---|
| **legacy_formula** | `analytics-sync.ts:42-43` (ShopifyQL: `SHOW taxes TIMESERIES day`); `analytics-sync.ts:208` (`taxes = Number(row['taxes'] ?? 0)`); `analytics-sync.ts:256` (`total_tax: row['taxes']`) |
| **brain_formula** | `total_tax_mu` |
| **reason** | DIFFERENT INGEST PIPELINES. Legacy: ShopifyQL `taxes` = DAY-LEVEL aggregate (not per-order, not per-SKU). Brain: `SUM(event-level per-SKU GST-2.0 line tax via RegionAdapter India)`. Cannot be measured until Child-3 provides per-SKU event-level tax. `total_tax_mu` feeds `Net-Net-Tax → Net Revenue → CM1 → whole ladder`. |
| **shadow_compare_classification** | `EXPECTED_DEFINITIONAL_DELTA` |
| **delta_direction_and_magnitude** | **Magnitude estimate (CF-C4-DDR-GST-TAX-1):** Homogeneous-SKU workspace (all 18% or all 0%): delta ~0–2%. Mixed slab workspace (mix of 0%/5%/12%/18% SKUs): delta ~5–10%. Cannot be measured until Child-3. |
| **business_impact** | 5% tax delta on ₹5,00,000/day GMV = ₹25,000/day error in CM1. **MATERIAL.** |
| **parity_gap** | `False` |
| **child_dependency** | **`child-3-shopify-connector`** — NOT signable until this gate is GREEN |
| **formula_snapshot** | `total_tax_mu = SUM(event-level per-SKU GST-2.0 line tax) via RegionAdapter India`; pending Child-3 connector ingest |

**Rohan sign-off:** ☐ **UNSIGNED-PENDING-child-dependency** (Rohan, Stage-6, 2026-05-25) — `child_dependency: child-3-shopify-connector` must be GREEN first. Adjudicated as a GENUINE definitional delta (ShopifyQL day-level aggregate vs per-SKU GST-2.0 event-level), NOT a mis-filed bug — but not measurable while shadowing on legacy-sourced data, and it feeds the whole revenue→CM ladder. Rule 2 correctly blocks. I will sign at the live-flip re-review once Child-3 lands GREEN and parity holds on Brain-sourced data.

---

### 9. `fx_restatement` — FX Re-statement (INR:83.5 shadow-phase pin)

> **CF-C4-DDR-FX-RESTATEMENT-1:** Shadow-phase Brain uses the same static rate (83.5) as legacy to prevent contaminated comparison.

| Field | Value |
|---|---|
| **legacy_formula** | `workspace-costs.ts:9-21` (`EXCHANGE_RATES: {USD:1, INR:83.5, ...}`); `pnl.ts:11-17` (`convertCurrency` using same `EXCHANGE_RATES`) |
| **brain_formula** | `FX_SHADOW_RATE_INR_PER_USD` (registry constant = 8350 paise/USD = ₹83.50) |
| **reason** | Shadow phase: Brain MV MUST use same static rate as legacy (INR:83.5) so comparison is not contaminated by two simultaneous FX changes. Live-rate conversion activates only once workspace-cost entries are migrated to primary-currency-at-entry (Child-3). |
| **shadow_compare_classification** | `EXPECTED_DEFINITIONAL_DELTA` |
| **delta_direction_and_magnitude** | Shadow phase: delta = 0 (same rate). Post-Child-3: delta = `(live_rate - 83.5) × foreign_cost_mu / 8350`. Magnitude: immaterial if all costs in INR; material for USD/EUR-denominated costs. |
| **business_impact** | 5% FX rate change on ₹50k/month USD cost = ₹2,500/month delta. Non-material in shadow phase (same rate). |
| **parity_gap** | `False` |
| **child_dependency** | **`child-3-workspace-cost-currency-migration`** — NOT signable until this gate is GREEN |
| **formula_snapshot** | `FX_SHADOW_RATE_INR_PER_USD = 8350 paise per USD (= ₹83.50)`; matches legacy `EXCHANGE_RATES {INR: 83.5}`; live-rate conversion held for Child-3 |

**Rohan sign-off:** ☐ **UNSIGNED-PENDING-child-dependency** (Rohan, Stage-6, 2026-05-25) — `child_dependency: child-3-workspace-cost-currency-migration` must be GREEN first. Adjudicated as GENUINE: shadow-phase correctly pins the same static 83.5 as legacy (zero contamination); the live-FX restatement is the post-Child-3 delta. Rule 2 correctly blocks. I will sign at the live-flip re-review once the cost-currency migration lands GREEN.

---

### 10. `blended_roas_x100` — ROAS (display-only)

| Field | Value |
|---|---|
| **legacy_formula** | `compute-daily.ts schema:879-880` (`blendedRoas = netSales / totalAdSpend`) |
| **brain_formula** | `blended_roas_x100` |
| **reason** | ROAS is **display-only** at Brain. CM2-first paradigm. `display_only:True` enforced in registry. `intDiv(net_sales_mu × 100, total_ad_spend_mu)`. |
| **shadow_compare_classification** | `EXPECTED_DEFINITIONAL_DELTA` |
| **delta_direction_and_magnitude** | At most 0.01x (1 unit in ×100 representation). Brain ≤ legacy (FLOOR vs ROUND). Non-material for display. |
| **business_impact** | Display only. Non-blocking. Not used for any Brain decision. |
| **parity_gap** | `False` |
| **child_dependency** | `null` |
| **formula_snapshot** | `blended_roas_x100 = intDiv(net_sales_mu * 100, total_ad_spend_mu); display_only:True` |

Rohan sign-off: ☑ SIGNED (Rohan, Stage-6, 2026-05-25)

---

### 11. `acos_bp` — ACOS (display-only)

| Field | Value |
|---|---|
| **legacy_formula** | `compute-daily.ts:247` (`acos = (totalAdSpend / netSales) × 10000 / 100`) |
| **brain_formula** | `acos_bp` |
| **reason** | ACOS is **display-only** at Brain. CM2-first paradigm. `intDiv(total_ad_spend_mu × 10000, net_sales_mu)` — basis points. |
| **shadow_compare_classification** | `EXPECTED_DEFINITIONAL_DELTA` |
| **delta_direction_and_magnitude** | Representation difference (bp vs percent). At most 1 bp from FLOOR vs ROUND. |
| **business_impact** | Display only. Non-blocking. Not used for any Brain decision. |
| **parity_gap** | `False` |
| **child_dependency** | `null` |
| **formula_snapshot** | `acos_bp = intDiv(total_ad_spend_mu * 10000, net_sales_mu); display_only:True` |

Rohan sign-off: ☑ SIGNED (Rohan, Stage-6, 2026-05-25)

---

## Phase-2 slice-3 rows (feat-rto-cod-economics)

### 12. `breakeven_cod_rto_rate_bp` — break-even COD RTO rate (FULL legacy formula, NOT M/(M+C))

| Field | Value |
|---|---|
| **legacy_formula** | `cod-prepaid-analytics.ts:218-231` (`num = V·P + (COD_fee − PG_fee) + P·(S+RS)`; `denom = V + S + RS`; `rCodBe = num/denom`; `PG_fee = V·gatewayPct`) |
| **brain_formula** | `breakeven_cod_rto_rate_bp` |
| **reason** | The ratified slice table's naive `r*=M/(M+C)` is a degenerate special case and would mis-advise COD-vs-prepaid policy. Brain ports the FULL legacy formula in integer paise with a SINGLE final FLOOR-to-bp (no chained float) → byte-identical TS/Python. parity_gap:true (legacy float not a byte comparand); correctness-fixture gate with a cross-language anchor that FAILS the naive form and PASSES the full form. |
| **shadow_compare_classification** | `CORRECTNESS_FIXTURE` |
| **delta_direction_and_magnitude** | No legacy byte comparand. Anchor (CF-S3-BREAKEVEN-1): aov=150000, P=500bp, cod_fee=3000, gateway=200bp, S=8000, RS=0 → pg_fee=3000; num_scaled=79000000; denom=158000; **= 500 bp**. Naive M/(M+C) ≈ 9493 bp — distinguished. |
| **business_impact** | The decision threshold for COD-vs-prepaid policy — the single largest controllable Indian-D2C margin lever. A naive formula would systematically mis-advise the COD-discount / prepaid-nudge strategy. |
| **parity_gap** | `True` |
| **child_dependency** | `null` |
| **formula_snapshot** | `breakeven_cod_rto_rate_bp = intDiv(aov_mu·prepaid_rto_rate_bp + (cod_fee_mu − intDiv(aov_mu·gateway_fee_bp, 10000))·10000 + prepaid_rto_rate_bp·(return_shipping_mu + restocking_mu), aov_mu + return_shipping_mu + restocking_mu); NULL when denom ≤ 0` |

Rohan sign-off (Stage-6): ☑ SIGNED (correctness-fixture; no legacy byte shadow acknowledged; anchor 500bp re-derived; naive M/(M+C) killed)

---

### 13. `pincode_reliability_score` — pincode reliability (integerized centi-points)

| Field | Value |
|---|---|
| **legacy_formula** | `pincode-intelligence.ts:60-66` (`clamp(0,100, 100 − rtoRate·2 − codRate·0.5 + repeatRate·0.5 + (aov/1000)·10)`; rates in pp, aov in rupees — FLOAT) |
| **brain_formula** | `pincode_reliability_score` |
| **reason** | Brain integerizes the legacy float score to deterministic CENTI-POINTS (0..10000) so TS/Python are byte-identical (the `0.5` and `aov/1000` float coefficients are drift risk). Inputs: rates in bp, aov in paise. parity_gap:true; correctness-fixture + worked anchor. |
| **shadow_compare_classification** | `CORRECTNESS_FIXTURE` |
| **delta_direction_and_magnitude** | No legacy byte comparand. Anchor (CF-S3-PINCODE-1): rto_bp=1800, cod_bp=6000, repeat_bp=2000, aov_mu=150000 → 10000 − 3600 − 3000 + 1000 + 1500 = **5900** (= 59.00). Legacy float ×100 = 59.00 → matches. |
| **business_impact** | Ranks delivery pincodes by RTO risk / COD load / repeat loyalty / AOV — drives serviceability + COD-gating per pincode (direct RTO-leak control). A drifting float score would rank pincodes inconsistently across surfaces. |
| **parity_gap** | `True` |
| **child_dependency** | `null` |
| **formula_snapshot** | `pincode_reliability_score = clamp(0, 10000, 10000 − rto_bp·2 − intDiv(cod_bp,2) + intDiv(repeat_bp,2) + intDiv(aov_mu,100))` (centi-points) |

Rohan sign-off (Stage-6): ☑ SIGNED (correctness-fixture; no legacy byte shadow acknowledged; anchor 5900 re-derived)

---

### 14. `rto_cost_mu` (+ sibling `rto_revenue_lost_mu`) — connector-sourced RTO money

| Field | Value |
|---|---|
| **legacy_formula** | `shiprocket-charges.ts` (`rtoChargesFromRaw` → `rto_cost_mu`; `shiprocketRtoRevenueLost` → `rto_revenue_lost_mu`); summed per RTO shipment in `rto-analytics.ts:114-144` |
| **brain_formula** | `rto_cost_mu` |
| **reason** | Both are connector-sourced aggregates from Shiprocket raw_json — unmeasurable until the Child-3 connector cutover provides per-shipment charge/value (mirrors `total_tax_mu`). Brain defs are passthrough money aggregates (`toInt64` of summed paise); never silently float-matched. |
| **shadow_compare_classification** | `EXPECTED_DEFINITIONAL_DELTA` |
| **delta_direction_and_magnitude** | Unmeasurable pre-Child-3. Post-GREEN: Brain integer-paise SUM vs legacy `Math.round(sum·100)/100` — sub-paise FLOOR-vs-ROUND only. `rto_revenue_lost_mu` shares this dependency. |
| **business_impact** | The ₹ headline of /rto-analytics + /logistics — the explicit size of the RTO leak. NOT signable until Child-3 gate is GREEN. |
| **parity_gap** | `False` |
| **child_dependency** | `child-3-shopify-connector` |
| **formula_snapshot** | `rto_cost_mu = toInt64(SUM(rtoChargesFromRaw(...)))`; `rto_revenue_lost_mu = toInt64(SUM(shiprocketRtoRevenueLost(...)))`; pending Child-3 ingest |

Rohan sign-off (Stage-6): ☐ UNSIGNED-PENDING until `child-3-shopify-connector` gate GREEN (Rule 2)

---

## Phase-2 slice-4 rows (feat-marketing-acquisition)

### 15. `mer_bp` — MER numerator-basis reconciliation

| Field | Value |
|---|---|
| **legacy_formula** | `marketing-efficiency.ts:21-24` — `mer = storeNetRevenue / totalAdSpend`; `storeNetRevenue` from `ads-spend.ts:fetchStoreNetRevenueForPeriod` (net-of-tax minus refund share, analytics+gap-fill reconciled). |
| **brain_formula** | `mer_bp` |
| **reason** | Brain MER numerator = `net_revenue_mu` (the slice-1 /store rung) so /acquisition MER == /store net revenue for the same range (cross-surface consistency; persona Concern 3). Child-4 used `net_sales_mu` — reconciled to `net_revenue_mu`. |
| **shadow_compare_classification** | `EXPECTED_DEFINITIONAL_DELTA` |
| **delta_direction_and_magnitude** | Numerator basis `net_sales_mu` → `net_revenue_mu`. Anchor: net_revenue=₹120k (12000000p), total_ad_spend=₹100k (10000000p) → `intDiv(12000000×10000, 10000000) = 12000 bp = 1.20x`. |
| **business_impact** | MER must visibly match the /store net revenue or operators distrust the number. |
| **parity_gap** | `False` |
| **child_dependency** | `null` |
| **formula_snapshot** | `mer_bp = intDiv(net_revenue_mu * 10000, total_ad_spend_mu); NULL if total_ad_spend_mu <= 0` |

Rohan sign-off: ☑ SIGNED (Rohan, Stage-6, 2026-05-25)

### 16. `new_customer_revenue_mu` (+ `nc_cm2_mu` / `cm2_per_nc_mu` / `acquisition_ad_spend_mu`) — connector-sourced acquisition facts

| Field | Value |
|---|---|
| **legacy_formula** | `acquisition/compute.ts:384-423` — per-NC-order revenue/CM2 with COGS/variable/adSpend allocation + refund share + RTO exclusion; new customer = first order in range. |
| **brain_formula** | `new_customer_revenue_mu / nc_cm2_mu / cm2_per_nc_mu / acquisition_ad_spend_mu` |
| **reason** | Connector-sourced first-order facts + per-order per-SKU GST tax (NEVER blended) + RTO→0. Use-case assembles; registry rungs are passthrough aggregates. Unmeasurable pre-Child-3 (mirrors `total_tax_mu`). |
| **shadow_compare_classification** | `EXPECTED_DEFINITIONAL_DELTA` |
| **delta_direction_and_magnitude** | child_dependency: child-3-shopify-connector (Rule 2). Anchors: cac_mu ₹500 (10000000/200); cm2_per_nc_mu ₹100 (2000000/200). |
| **business_impact** | New-customer CM2/revenue are the acquisition-quality core; per-order per-SKU tax keeps GST-2.0 honesty; RTO exclusion keeps CM2 honest. |
| **parity_gap** | `False` |
| **child_dependency** | `child-3-shopify-connector` |
| **formula_snapshot** | `new_customer_revenue_mu = SUM(price − tax − refundShare), RTO→0`; `cm2_per_nc_mu = intDiv(nc_cm2_mu, new_customers_count)`; `acquisition_ad_spend_mu = SUM spend where intent=='acquisition'` |

Rohan sign-off (Stage-6): ☐ UNSIGNED-PENDING until `child-3-shopify-connector` gate GREEN (Rule 2)

---

## Structural enforcement (code-level)

The two rules are enforced in `definitional_delta_register.py::DDRRow.assert_signable()`:

```python
# Rule 1: parity_gap:True → SignOffBlockedError
if self.parity_gap:
    raise SignOffBlockedError(
        "parity_gap=True — no legacy shadow. Route to correctness-fixture gate."
    )
# Rule 2: non-null child_dependency → SignOffBlockedError
if self.child_dependency is not None:
    raise SignOffBlockedError(
        f"child_dependency='{self.child_dependency}' — blocked until GREEN."
    )
```

Rohan cannot sign any row without `assert_signable()` passing first.

---

## Stage-6 checklist for Rohan

- [x] `cm2_mu` — formula correct, delta magnitude reasonable — **SIGNED**
- [x] `misc_expenses_prorated_mu` — verified `toDaysInMonth(date)` correct; Feb-boundary example re-derived (35714; wrong-30=33333, −2381); NOT a wrong-constant bug — **SIGNED**
- [x] `cogs_mu` — full-recompute model confirmed; no incremental MV — **SIGNED**
- [x] `true_cm2_mu` — **parity_gap acknowledged; correctness-fixture worked example re-derived (6620000); no legacy shadow; Phase-0 proxy canon** — **SIGNED (correctness-fixture)**
- [x] `amer_bp` / `ltv_cac_bp` — correctness-fixture examples re-derived; **slice-4: amer_bp REDEFINED to legacy (15000bp on acquisition split; "use total spend" mutant→6000 KILLED)** — **SIGNED (correctness-fixture)**
- [x] `pamer_bp` — **DECOMMISSIONED (slice-4, no legacy comparand); removed from registry + DDR** — **N/A**
- [x] `mer_bp` — slice-4 numerator reconciled to `net_revenue_mu` (12000bp anchor) — **SIGNED**
- [ ] `total_tax_mu` — **UNSIGNED-PENDING until `child-3-shopify-connector` gate GREEN** (Rule 2)
- [ ] `fx_restatement` — **UNSIGNED-PENDING until `child-3-workspace-cost-currency-migration` gate GREEN** (Rule 2)
- [ ] `new_customer_revenue_mu` (+nc_cm2/cm2_per_nc/acquisition_ad_spend) — **UNSIGNED-PENDING until `child-3-shopify-connector` gate GREEN** (Rule 2)
- [x] `blended_roas_x100` / `acos_bp` — display-only confirmed; non-blocking — **SIGNED**

**DDR sign-off: 10 SIGNED · 3 UNSIGNED-PENDING-child-dependency · 1 DECOMMISSIONED.**

_Signed:_ **Rohan (cto-advisor) — partial sign-off per above** _Date:_ **2026-05-25** _Authority:_ CF-C4-DDR-1 / M-A1-Q2 (Stage-6 VETO + governance gate). Live read-source flip remains HELD (`HOLD-AT-READ-FLIP`) until the 2 pending rows unlock and I re-sign at the Stage-8 live-flip re-review.

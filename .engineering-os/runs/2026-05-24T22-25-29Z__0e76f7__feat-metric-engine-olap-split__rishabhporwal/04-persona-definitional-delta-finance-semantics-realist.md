# Stage 1 Persona Review — `definitional-delta-finance-semantics-realist`

**req_id:** `feat-metric-engine-olap-split` (Child 4)
**Persona:** `definitional-delta-finance-semantics-realist` (`:sonnet`)
**Reviewer role lens:** Finance semantics — which formula changes are genuine definitional progress vs bugs wearing the `expected_definitional_delta` label; Register sufficiency; parity-gap metrics.
**Timestamp:** 2026-05-25T03:30:00Z
**Review round:** Stage 1 brainstorm (pre-architecture)

---

## Persona framing

I am a finance-semantics practitioner who has seen metric definitions poisoned during migrations — not by malicious intent, but by the natural tendency to classify a confusing number as "expected" because it is inconvenient to fix before cutover. My job is to pressure-test every row of the Definitional-Delta Register before Rohan signs it and before any live read-source flip. My lens is: does the label `expected_definitional_delta` describe a genuine, intentional, well-bounded improvement from legacy to Brain — or does it describe a bug that got a hall pass?

I read the full legacy compute path (`compute-daily.ts` lines 1–336, `lib/ai-calc/pnl.ts` lines 1–239, `lib/workspace-costs.ts` lines 1–77, `lib/shopify/analytics-sync.ts` lines 1–267), the binding Child-0 architecture (06-architecture-plan.md, M-A1-Q2 ruling lines 386–418, A5.2 shadow-compare mechanics lines 597–670), and the requirement + Rohan's CTO review. I ground every concern in exact file:line evidence from the legacy codebase.

---

## Concern 1 — The `pnl.ts` CM2 "definitional delta" is actually two superimposed differences, and one of them may be a bug

**Severity: HIGH**

**Evidence:**

The M-A1-Q2 ruling (architecture plan line 406) characterizes the `pnl.ts` vs `compute-daily.ts` CM2 divergence as a single definitional delta: "P&L route uses lagged Shiprocket average; `compute-daily.ts` uses actual day-level costs." Brain canonicalizes on `compute-daily.ts`. Register row is pre-authorized: `expected_definitional_delta`.

But reading both files shows this is actually **two superimposed differences** — and only one is definitional:

**Difference A (genuinely definitional):** `pnl.ts` computes shipping via a lagged Shiprocket average (a prior-month proxy). `compute-daily.ts` uses actual-day `WorkspaceCost` entries. Brain's choice of actual costs is correct. This delta is intentional and bounded.

**Difference B (potentially a bug):** `pnl.ts` (`lib/ai-calc/pnl.ts:174–183`) prorates `miscExpenses` using `eachDayOfInterval` against each day in the range, applying `monthlyAmt / getDaysInMonth(d)` per day. `compute-daily.ts` (line 237–244) prorates using `getDaysInMonth` against a single `dateAtNoonUtc` for that one day only. These produce identical results when `fromDate`/`toDate` span a single calendar month. But when the date range **crosses a month boundary** (e.g. Jan 28 – Feb 4), `pnl.ts` correctly applies Jan's days-in-month for Jan days and Feb's days-in-month for Feb days, while `compute-daily.ts` — because it is per-day — also applies the correct single day's `daysInMonth`. So for a daily rollup these are mathematically equivalent.

However, the **Brain registry** definition of `misc_expenses_prorated_mu` (per the architecture table, line 257: `SUM(monthly_amount_mu / days_in_month)`) is described as a SQL formula using "a calendar join for days-in-month." The formula description is ambiguous about whether `days_in_month` is per-calendar-row or a workspace-level value. If Brain's SQL MV computes `days_in_month` using `toRelativeMonthNum` or `daysInMonth(date)` in ClickHouse, this is correct. But if it inadvertently uses a fixed 30-day denominator (a common ClickHouse proration shortcut), it will diverge from both legacy paths on months with 28, 29, or 31 days.

**The risk:** Brain's `misc_expenses_prorated_mu` MV formula is not pinned in the architecture to a specific ClickHouse date function. If an implementer reaches for `30` as a constant (common in ad-hoc SQL) and this lands in the Register as `expected_definitional_delta` because the shadow-compare shows a difference in February or January, the Register row will say "known divergence from pnl.ts lagged-shipping path" when the real cause is a wrong constant in Brain's own formula.

**The definitional-adjudication failure mode:** the M-A1-Q2 ruling pre-authorizes the pnl.ts divergence. An implementer who sees a mismatch in `misc_expenses_prorated_mu` will reach for the pre-authorized label rather than diagnose whether Brain's own formula is correct. This is exactly the "real bug mis-filed as expected delta" scenario.

**Proposed constraint: `CF-C4-DDR-MISC-PRORATE-1`** — The Register row for `misc_expenses_prorated_mu` must explicitly state: (a) the ClickHouse function used for `days_in_month` (must be `toDaysInMonth(date)` or equivalent, never a constant), (b) a worked example for a date range straddling a February boundary (28 or 29 days), and (c) a CI test that covers `date = '2024-02-15'` (29-day month) and `date = '2025-02-15'` (28-day month). If the shadow-compare diverges on this field, the triage flow must ask "is Brain's `days_in_month` function correct?" before stamping `expected_definitional_delta`.

---

## Concern 2 — True CM2 (RTO-provisioned) has no legacy comparand: the parity-gate is structurally undefined for it, and the silence is dangerous

**Severity: HIGH**

**Evidence:**

The requirement (01-requirement.md line 44) and Rohan's review (02-cto-advisor-review.md line 66) both list "True CM2" as in-scope for Child 4. The business canon (business-context.md line 56) defines it: "True CM2 subtracts RTO provision + refund/payment-failure provisions."

Reading `compute-daily.ts` in full (lines 1–336): there is **no `trueCm2` field, no `rtoProvision` field, no payment-failure provision**. The legacy schema columns that feed `WorkspaceDailyMetrics` (architecture plan lines 235–270) include `rto_value`, `rto_orders`, `rto_percent`, `prepaid_percentage` — but no `rto_provision_mu`, no `true_cm2_mu`. The legacy code computes `cm2 = cm1 - totalAdSpend` and stops (line 234).

This means True CM2 is a **Brain-native metric with no legacy equivalent**. It is not a definitional delta from legacy to Brain. It is a new metric that Brain introduces.

**The parity-gate problem:** the requirement's shadow-compare extends Child-2's "exact-integer-equality vs legacy rollups." For True CM2, there is no legacy rollup row to compare against. The parity harness has three options when it encounters a Brain metric with no legacy column:

1. **Skip it silently** — this is dangerous. If True CM2 is computed incorrectly in Brain (wrong RTO provision formula, wrong sign, wrong cost inputs), the parity gate passes because there is nothing to fail against. A wrong number ships as "parity GREEN."
2. **Fail closed (treat missing legacy column as a block)** — this prevents the read-source flip for True CM2 until a manually authored "ground truth" fixture is provided. Correct posture, but not described anywhere in the requirement or Rohan's review.
3. **Register it explicitly as a "parity gap" — a Brain-native metric** — with a separate correctness gate (not a shadow-compare gate) that validates the formula against hand-calculated worked examples for known workspaces (e.g. Sugandh Lok, if RTO data is available).

The requirement uses the phrase "parity gate" uniformly. It does not distinguish between (a) metrics that have a legacy shadow to compare against and (b) metrics that are Brain-native additions. If True CM2 is treated by the harness as option 1 (skip), the parity gate gives false confidence.

**The RTO provision formula is itself unspecified:** the business canon says "subtracts RTO provision" but does not define the provision formula. Is `rto_provision_mu = rto_rate_bp/10000 × (forward_logistics_cost + reverse_logistics_cost + restock_cost + write_down_cost)` per-order? Or is it `rto_value_mu × rto_rate_bp / 10000`? The architecture plan's M-A1-Q2 ruling never pins this formula — it only confirms `rto_value`, `rto_orders`, `rto_rate_bp` as metrics, not the provisioning arithmetic. The COD break-even formula is mentioned in business-context.md line 58: `r* = M/(M+C)` — but that is the break-even rate, not the provision amount.

**Proposed constraint: `CF-C4-DDR-TRUE-CM2-1`** — True CM2 and any other Brain-native metric with no legacy comparand must be explicitly listed in the Definitional-Delta Register as `parity_gap: true` (a new field the 6-field CF-C4-DDR-1 schema does not currently include). For each `parity_gap: true` row: (a) the formula must be pinned in full (not just "subtracts RTO provision"), (b) a hand-calculated worked example for at least one real workspace date must be provided, (c) the parity harness must treat these rows as a separate "correctness fixture" gate — not a shadow-compare gate — and (d) Rohan's sign-off on these rows must explicitly acknowledge there is no legacy shadow for comparison. Without this extension, the 6-field Register is not sufficient for Rohan to sign honestly.

---

## Concern 3 — GST 2.0 per-SKU: the legacy `total_tax` field is a ShopifyQL daily aggregate, not a per-SKU extraction — the Register row for this is currently missing

**Severity: HIGH**

**Evidence:**

Rohan's review (line 68) correctly flags: "`total_tax_mu` summed from event-level per-SKU GST-2.0 rates, NOT a blended workspace rate." Constraint `CF-C4-GST-EVENT-TAX-1` is bound: sum from event-level rates.

But reading the actual legacy ingest path (`lib/shopify/analytics-sync.ts` lines 41–46):

```
function buildShopifyAnalyticsQl(from: string, to: string): string {
  return `FROM sales
  SHOW gross_sales, net_sales, discounts, taxes, orders, total_returns, returns
  TIMESERIES day
  SINCE ${from} UNTIL ${to}
  ORDER BY day`
}
```

The `taxes` column from ShopifyQL's `FROM sales` dataset is a **day-level aggregate** — it is the sum of all taxes collected across all orders on that day, as reported by Shopify's analytics engine. It is NOT derived from per-SKU GST line items. Shopify aggregates tax across all rate tiers before Brain ever sees the number (line 229: `totalTax: taxes`).

This means the legacy `total_tax` in `ShopifyAnalyticsDaily` is already a blended aggregate. Brain's `CF-C4-GST-EVENT-TAX-1` requires summing from event-level per-SKU rates — which requires either: (a) reading `ShopifyOrder.totalTax` per order and then per `ShopifyLineItem` tax lines, OR (b) Brain's Child-3 Shopify connector ingesting line-item-level tax data. The legacy path never touches per-SKU tax rates.

**The definitional-delta problem:** this is NOT the same metric. "ShopifyQL daily aggregate tax" vs "Brain per-SKU event-level tax sum" will produce different values for any workspace with mixed-rate SKUs (0% and 18% in the same order, for example). When the shadow-compare runs, this divergence will appear as a numeric delta on `total_tax_mu`. The Register must classify this correctly.

The current requirement and Rohan's review describe `total_tax_mu` as "SQL aggregation from order events" (architecture plan line 243) — but the legacy path is ShopifyQL-level, not order-event-level. The delta between these two is a **definitional delta** and must appear as a Register row.

**The double risk:** if `total_tax_mu` diverges in the shadow-compare AND this Register row is absent, the parity harness will either (a) block cutover on what is actually an expected definitional change, or (b) an implementer will manually stamp it `expected_definitional_delta` without a formal row — bypassing the governance gate.

Furthermore, `total_tax_mu` feeds the revenue ladder: `Net-Net-Tax` = `net_sales_mu - total_tax_mu`. If the tax figure is wrong-but-signed-as-expected, every metric downstream in the revenue ladder is silently wrong.

**This is the one metric definition most likely to be wrong-but-signed-as-expected-delta.** The legacy path (ShopifyQL aggregate) and the Brain path (per-SKU event-level extraction via `RegionAdapter.extract_net_revenue()`) are architecturally different ingest pipelines producing semantically different numbers. The expected delta is real, bounded, and justified — but without an explicit Register row with a worked example and a direction/magnitude estimate, Rohan cannot sign it honestly.

**Proposed constraint: `CF-C4-DDR-GST-TAX-1`** — The Definitional-Delta Register must contain an explicit row for `total_tax_mu` with: (a) `legacy_formula = "ShopifyQL FROM sales taxes column (day-level aggregate, analytically reported)"`, (b) `brain_formula = "SUM(order_line_items.tax_amount_mu) from event-level ingest via RegionAdapter.extract_net_revenue(), per-SKU GST-2.0 slab"`, (c) reason = "Brain uses per-SKU actual tax lines; legacy uses Shopify-aggregated analytics figure — these will differ when SKU mix includes multiple GST slabs within a day", (d) magnitude estimate = "expected delta bounded to within 0–2% of `total_tax_mu` for typical homogeneous-SKU brands; potentially 5–10% for brands with mixed 0/18% slab SKUs", (e) Child-3 dependency noted: this Register row is only signable after Child-3's Shopify connector confirms it ingests line-item-level tax fields. If Child-4 shadows on legacy-sourced data (pre-Child-3), this delta cannot be measured at all — the shadow-compare on `total_tax_mu` is not meaningful until the Brain Shopify connector supplies per-SKU event data.

---

## Concern 4 — The 6-field Register is insufficient for Rohan to sign honestly: it is missing `parity_gap` classification and `child_dependency` fields

**Severity: MEDIUM**

**Evidence:**

Rohan's `CF-C4-DDR-1` (review line 94) specifies 6 fields per Register row:
1. `legacy_formula` (file:line)
2. `brain_formula` (registry definition id)
3. reason (why legacy is wrong-by-design vs bug)
4. shadow-compare classification (`expected_definitional_delta`)
5. direction + magnitude of expected delta
6. business impact (does this change a CM2 number a brand has seen?)

This 6-field schema correctly captures the **known-delta** case. But as Concerns 2 and 3 demonstrate, Child 4 introduces at least two additional row types that the 6-field schema cannot represent:

**Missing field A: `parity_gap`** — for Brain-native metrics (True CM2, `paMER`, `aMER`, `LTV:CAC`) where there is no legacy comparand. The 6-field schema forces the reviewer to enter something in `legacy_formula` that does not exist. This either causes a blank field (which looks like an oversight) or a fictional entry (which is false). Neither supports honest sign-off.

**Missing field B: `child_dependency`** — for Register rows whose delta cannot be measured until a downstream child (Child-3 connector) has cut over. The `total_tax_mu` row (Concern 3) is only meaningful after Child-3's Shopify connector supplies per-SKU tax data. Without this field, Rohan may sign a row believing it is fully validated when in fact it was measured against a legacy-sourced shadow that does not exercise the Brain formula at all.

**Missing field C: `formula_pin`** — a machine-readable formula string (not just a registry definition id) that uniquely identifies the formula at the time of sign-off. A "registry definition id" can change if the definition is amended post-sign-off. The Register should capture the formula itself at sign-off, not just a pointer to it.

**Proposed constraint (extension of `CF-C4-DDR-1`):** add three fields to the Register schema:
- `parity_gap: boolean` — true if no legacy comparand exists; triggers a "correctness fixture" gate instead of a shadow-compare gate.
- `child_dependency: string | null` — e.g. `"child-3-shopify-connector"` — if set, the row is NOT signable until the named child's parity gate is GREEN.
- `formula_snapshot: string` — the exact formula expression at sign-off time, not just a registry id.

Without these additions, the Register is a governance theater artifact — it looks signed but does not constrain the actual delta at the level of rigor required for a finance system.

---

## Concern 5 — The FX WorkspaceCost re-statement delta is pre-authorized but the adjudication rule for "did Brain compute this right before the live rate service exists?" is absent

**Severity: MEDIUM**

**Evidence:**

The architecture (plan line 408) describes the second confirmed definitional delta: `WorkspaceCost.currency @default("USD")` — legacy calls `convertCurrency()` with hardcoded `EXCHANGE_RATES: { USD: 1, INR: 83.5, ... }` at compute time. Brain eliminates this by requiring workspace costs stored in primary currency at entry time, or converted once at entry using a live rate service.

Reading `lib/workspace-costs.ts` lines 9–23: the same hardcoded `EXCHANGE_RATES` table (`USD: 1, INR: 83.5`) is used in the `getDailyVariableContribution` function. This means every call to this function for a non-INR workspace cost introduces the static 83.5 rate into shipping/packaging/website charges, and consequently into CM1/CM2/CM3.

The architecture says Brain "converts once at entry using a live rate service." But no live rate service is scoped in Child 4 (or any prior child). Child 4 is metric materialization; it reads workspace costs from the Brain Postgres store. If the Brain Postgres store still holds workspace costs in USD (because the migration from legacy Postgres carries the original currency values), and Brain's metric MV applies a different FX rate than legacy's hardcoded 83.5, the shadow-compare will diverge.

**The adjudication problem:** the Register pre-authorizes this as `expected_definitional_delta`. But the *direction* of the delta depends on the live FX rate at the time of shadow-compare. If USD/INR is 83.0 at compare time, Brain's CM1 is slightly higher than legacy's CM1 for USD-cost workspaces. If the rate is 85.0, Brain's CM1 is slightly lower. The magnitude field in the Register cannot be known until the live rate service exists and a specific compare date is chosen.

Worse: if Child 4 builds the metric MV but uses a hardcoded rate as a placeholder (because the live rate service is not available yet), then the shadow-compare produces a delta that is partially "expected FX re-statement" and partially "wrong placeholder rate." These two components are indistinguishable from the compare output.

**Proposed constraint: `CF-C4-DDR-FX-RESTATEMENT-1`** — The Register row for FX re-statement must include: (a) the precise FX handling Brain uses in the metric MV at time of shadow-compare (hardcoded fallback, or live service), (b) if a hardcoded fallback is used during the Child-4 shadow phase, the rate must match legacy's `83.5` exactly (so the shadow-compare is not contaminated by two simultaneous FX changes), and (c) the row is marked `child_dependency: "child-3-workspace-cost-currency-migration"` — the live-rate conversion is only activated once workspace cost entries have been migrated to primary currency at entry. Until that migration is complete, Brain must use the same static rate as legacy for the shadow-compare to be meaningful.

---

## The one metric definition most likely to be wrong-but-signed-as-expected-delta

**`total_tax_mu` / the revenue ladder's `Net-Net-Tax` step.**

Reason: (a) the legacy and Brain ingest paths for this metric are architecturally different (ShopifyQL aggregate vs per-SKU event-level lines), not just formula variants; (b) the delta is real and justified but the Register row for it does not currently exist; (c) the delta cannot be measured until Child-3 cuts over the Shopify connector, meaning any sign-off during Child-4's shadow phase is signing against a comparison that cannot actually exercise Brain's formula; (d) `total_tax_mu` feeds `Net-Net-Tax` → `Net Revenue` → `CM1`, so an incorrect value propagates silently through the entire revenue and CM ladder; (e) the constraint `CF-C4-GST-EVENT-TAX-1` is bound in Rohan's review but no corresponding Register row is prescribed — making it the most likely candidate for a "looks obvious, doesn't need a row" omission that bites at cutover.

---

## Summary table

| # | Concern | Severity | Proposed constraint | Escalate? |
|---|---|---|---|---|
| 1 | `pnl.ts` CM2 delta is two superimposed differences; `misc_expenses_prorated_mu` risks a wrong ClickHouse `days_in_month` constant being stamped as expected delta | HIGH | `CF-C4-DDR-MISC-PRORATE-1` | No — bind at Stage 2 |
| 2 | True CM2 (RTO-provisioned) has no legacy comparand; parity gate is structurally undefined; RTO provision formula is unspecified | HIGH | `CF-C4-DDR-TRUE-CM2-1` (+ extend 6-field schema with `parity_gap`) | No — bind at Stage 2 |
| 3 | `total_tax_mu` delta (ShopifyQL aggregate vs per-SKU event-level) has no Register row; it is the one metric most likely wrong-but-signed-as-expected | HIGH | `CF-C4-DDR-GST-TAX-1` | No — bind at Stage 2 |
| 4 | 6-field Register schema missing `parity_gap`, `child_dependency`, `formula_snapshot` fields — insufficient for honest sign-off | MEDIUM | Extend `CF-C4-DDR-1` schema | No — bind at Stage 2 |
| 5 | FX re-statement delta magnitude is unknowable until live rate service exists; shadow-compare contamination risk if Brain uses a different placeholder rate than legacy's 83.5 | MEDIUM | `CF-C4-DDR-FX-RESTATEMENT-1` | No — bind at Stage 2 |

**Escalate to Founder:** NO. All five concerns are resolvable at Stage 2 (architecture + Maya co-own). None require Founder interpretation. The Register is a Rohan-owned governance artifact; extending its schema and adding missing rows is within Rohan's sign-off authority.

**Stage 2 must-resolves from this persona:**
- Maya must pin the `misc_expenses_prorated_mu` ClickHouse function before the formula is registered.
- True CM2's RTO provision formula must be written out in full (not just named) before the Register row is created.
- `total_tax_mu` Register row must be written and its `child_dependency` on Child-3's Shopify connector must be marked — preventing premature sign-off.
- The 6-field Register schema in `CF-C4-DDR-1` must be extended to 9 fields before any row is signed.
- FX re-statement row must specify the Brain fallback rate used during the Child-4 shadow phase.

---

## One-liner for Rohan's synthesis

The Definitional-Delta Register has five gaps that would let bugs or under-specified formulas wear the `expected_definitional_delta` label: `misc_expenses_prorated_mu` proration risks a wrong constant; True CM2 has no comparand and an unspecified provision formula; `total_tax_mu` is missing a Register row entirely and cannot be validly compared until Child-3 cuts over; the 6-field schema lacks `parity_gap`/`child_dependency`/`formula_snapshot`; and FX re-statement sign-off requires the shadow phase to use the same rate as legacy. None escalate to Founder — all bind at Stage 2 with Maya.

# Architecture Plan — feat-marketing-acquisition (Stage 2, Aryan)

| Field | Value |
|-------|-------|
| **req_id** | `feat-marketing-acquisition` (Phase 2, slice 4) |
| **Stage** | 2 (binding plan) |
| **Architect** | Aryan |
| **Paradigm** | `@paradigm("sql")` — confirmed; zero inference path; join-heavy MER/aMER/CAC = deterministic integer aggregation in a use-case (scheduled-rollup shape), NOT an MV, NOT ML |
| **Shape** | feature-vertical on slice-1/2/3 foundation: **reconcile** 3 marketing registry defs to legacy (close the uneven TS/PY split) + **decommission** 1 phantom + add ≤4 new defs (TS+PY byte-identical, non-vacuous anchors) + DDR rows + 3 analytics use-cases + 3 DataPlanePort methods + a `marketing.*` tRPC group + 2 page wirings. Additive + reversible. Legacy untouched. |

## D0 — The reconciliation mandate (Rohan Stage-1 finding; persona Concerns 1-3, 5)

Child-4 pre-built marketing defs that diverge from legacy. This plan FIXES them; it does NOT extend the "shadow phase" carve.

| Def | Today | Action | Legacy ground truth |
|---|---|---|---|
| `amer_bp` | TS-only; = true_cm2/total_ad_spend | **REDEFINE** in BOTH registries to `new_customer_revenue_mu / acquisition_ad_spend_mu` (bp). correctness_fixture + DDR row recording the change. | `aMer = newCustomerRevenue / acquisitionAdSpend` (acquisition-classified spend ONLY) |
| `pamer_bp` | TS+PY; = cm2/total_ad_spend | **DECOMMISSION** (remove from both registries + barrel + METRIC_REGISTRY + `_METRIC_COLUMNS` if present). No legacy comparand; dead landmine. | none |
| `mer_bp` | PY-only | **DEFINE in TS too** (byte-identical) = `net_revenue_basis / total_ad_spend_mu` (bp); DDR row pinning which net-revenue basis Brain uses (= the slice-1 /store net-revenue rung, for cross-surface consistency). | `mer = storeNetRevenue / totalAdSpend` |
| `cac_mu` | PY-only | **DEFINE in TS too** (byte-identical) = `total_ad_spend_mu / new_customers_count`. shadow_compare (legacy comparand = blendedCac). | `blendedCac = totalAdSpend / newCustomers` |
| `cac_payback_months` | PY-only | **LEAVE UNTOUCHED, DO NOT WIRE.** Cohort/slice-5 concept. | cohort cumulative CM3 vs CAC (slice 5) |
| `acos_bp`, `blended_roas_x100` | both, display_only | **KEEP display_only:true.** Never a decision metric. Confirm not wired as decisions. | `acos = totalAdSpend/storeNetRevenue` |

**MER numerator basis decision (persona Concern 3):** Brain MER numerator = the slice-1 `net_revenue_mu` rung supplied as an explicit workspace-scoped input equal to the /store net revenue for the same range, so MER on /acquisition == /store net revenue ÷ spend (no surprise mismatch). The DDR row `_ROW_MER_BASIS` records that legacy `fetchStoreNetRevenueForPeriod` (net-of-tax minus refund share + analytics/gap reconciliation) is canonicalized as Brain's `net_revenue_mu` basis; parity_gap documented.

## D1 — Reuse, don't rebuild (anti-rework)

REUSE (do NOT re-add): query gateway (`query_metrics`, `UnscopedQueryError`, `DateRange`), `DataPlanePort` + `StubDataPlane` + `SUGANDH_LOK_CANONICAL`, DDR machinery (`DDRRow`, `assert_signable`), parity gate, `ratioToBasisPoints`/`_ratio_bp`, `formatMoney`/`requireRole`/`workspaceProc`/superjson bigint, the registry-mapper traceability pattern, slice-1 `net_revenue_mu`/`aov_mu`, slice-2 `cm1_mu`/`cm2_mu`/`true_cm2_mu`/`total_ad_spend_mu`/`variable_costs_mu`/`cogs_mu`, slice-3 RTO identification. **Honest-input pattern:** first-order facts, ad-spend-by-classification, refund share, and store net revenue arrive as EXPLICIT frozen-dataclass workspace-scoped inputs (like slice-3 `CodPrepaidFacts`/`FeeInputs`), NOT gateway columns. They populate live at the held Child-3 connector cutover.

## D2 — Registry defs (TS↔Python byte-identical)

**Reconcile (edit existing):** `amer_bp` (redefine), `mer_bp` (add TS twin), `cac_mu` (add TS twin). **Decommission:** `pamer_bp`.

**New defs (add to BOTH registries + METRIC_REGISTRY + barrel):**
1. `new_customer_revenue_mu` (money/mu, scale=1) — passthrough aggregate of per-NC-order (totalPrice − totalTax − refundShare), RTO→0. `formula = (new_customer_revenue_mu) => new_customer_revenue_mu`; `clickhouse_sql: toInt64(new_customer_revenue_mu)`. shadow_compare; the per-order RTO/tax/refund exclusion lives in the use-case + DDR note (per-SKU tax, never blended — persona Concern 4).
2. `nc_cm2_mu` (money/mu, scale=1) — passthrough aggregate of per-NC-order CM2 (totalPrice − COGS − per-order variable − per-order adSpend − refundShare; RTO→0). `formula = (nc_cm2_mu) => nc_cm2_mu`; `clickhouse_sql: toInt64(nc_cm2_mu)`. shadow_compare.
3. `cm2_per_nc_mu` (money/mu, scale=1) — `intDiv(nc_cm2_mu, new_customers_count)`. `clickhouse_sql: if(new_customers_count>0, intDiv(nc_cm2_mu, new_customers_count), NULL)`. shadow_compare; NULL-guard.
4. `acquisition_ad_spend_mu` (money/mu, scale=1) — passthrough aggregate of acquisition-classified spend (the aMER denominator — distinct from `total_ad_spend_mu`). `clickhouse_sql: toInt64(acquisition_ad_spend_mu)`. shadow_compare. **This is the def that makes the aMER denominator correct (persona Concern 1).**

`new_customers_count` is a count metric (allowed by name, no registry def — like `total_orders`). REUSE `total_ad_spend_mu`, `cm2_mu`, `net_revenue_mu`, `aov_mu`.

**`amer_bp` (redefined) formula (single FLOOR-to-bp):**
```
amer_bp = if(acquisition_ad_spend_mu > 0,
             intDiv(new_customer_revenue_mu * 10000, acquisition_ad_spend_mu), NULL)
formula_ts: (new_customer_revenue_mu, acquisition_ad_spend_mu) => ratioToBasisPoints(new_customer_revenue_mu, acquisition_ad_spend_mu)
```
correctness_fixture (Brain redefines from the Child-4 placeholder) + DDR `_ROW_AMER_REDEF`.

**`mer_bp` (TS twin) formula:**
```
mer_bp = if(total_ad_spend_mu > 0, intDiv(net_revenue_mu * 10000, total_ad_spend_mu), NULL)
formula_ts: (net_revenue_mu, total_ad_spend_mu) => ratioToBasisPoints(net_revenue_mu, total_ad_spend_mu)
```
NOTE: Child-4 PY `mer_bp` used `net_sales_mu`. Reconcile BOTH to `net_revenue_mu` (the slice-1 /store basis) for cross-surface consistency + DDR `_ROW_MER_BASIS`. shadow_compare with the legacy basis documented.

**`cac_mu` (TS twin) formula:**
```
cac_mu = if(new_customers_count > 0, intDiv(total_ad_spend_mu, new_customers_count), NULL)
formula_ts: (total_ad_spend_mu, new_customers_count) => new_customers_count > 0n ? total_ad_spend_mu / new_customers_count : null
```
shadow_compare (legacy blendedCac comparand). Integer FLOOR.

## D3 — NON-VACUOUS gates (the slice-2/3 lesson)

Cross-language anchors that FAIL the wrong formula:
- **`amer_bp`:** worked anchor with a CLASSIFICATION SPLIT — `new_customer_revenue_mu=6_000_000p`, `acquisition_ad_spend_mu=4_000_000p` (total spend ₹100k but only ₹40k acquisition) → `intDiv(6_000_000×10000, 4_000_000) = 15000bp` (1.5×). A "use total_ad_spend (₹100k=10_000_000p)" mutant yields 6000bp → KILLED. Both TS + PY.
- **`mer_bp`:** `net_revenue_mu=12_000_000p`, `total_ad_spend_mu=10_000_000p` → 12000bp (1.2×). A "use net_sales" mutant with a different value → KILLED.
- **`cac_mu`:** `total_ad_spend_mu=10_000_000p`, `new_customers_count=200` → 50_000p (₹500). Zero-customers → NULL.
- **`cm2_per_nc_mu`:** `nc_cm2_mu=2_000_000p`, count=200 → 10_000p (₹100).
- Add the new/reconciled ids to the completeness + correctness_fixture lists. `pamer_bp` REMOVED from all lists (decommission). The parity gate's "PY-only shadow" set shrinks by `mer_bp`, `cac_mu` (now in TS); `pamer_bp` removed from shared.

## D4 — DDR rows (don't reconcile silently)

In `definitional_delta_register.py` (+ mirror `.md`):
1. `_ROW_AMER_REDEF` (brain_formula="amer_bp", parity_gap=True, CORRECTNESS_FIXTURE): legacy_formula `marketing-efficiency.ts:25-28 (aMer = newCustomerRevenue / acquisitionAdSpend)`; reason = Brain redefines amer_bp from the Child-4 placeholder (true_cm2/total_spend) to the legacy semantics (NC-revenue / acquisition-classified spend); the denominator is the acquisition bucket ONLY (conservative); single FLOOR-to-bp; worked anchor 15000bp. business_impact: aMER is the new-customer-efficiency decision metric; the placeholder would mis-state it.
2. `_ROW_MER_BASIS` (brain_formula="mer_bp", parity_gap=True/documented, EXPECTED_DEFINITIONAL_DELTA): legacy_formula `marketing-efficiency.ts:21-24 + ads-spend.ts fetchStoreNetRevenueForPeriod`; reason = Brain MER numerator = slice-1 net_revenue_mu (== /store net revenue), cross-surface consistent; legacy reconciles analytics+gap-fill net-of-tax minus refund share; Child-4 used net_sales — reconciled to net_revenue. business_impact: MER must match the store page.
3. `_ROW_NC_REVENUE_CM2` (covers `new_customer_revenue_mu` + `nc_cm2_mu` + `cm2_per_nc_mu`; parity_gap=False, child_dependency="child-3-shopify-connector", EXPECTED_DEFINITIONAL_DELTA): legacy_formula `acquisition/compute.ts:384-423`; reason = connector-sourced first-order + per-order COGS/variable/adSpend/refund share + RTO exclusion + per-SKU tax (never blended); unmeasurable pre-Child-3 (mirrors `_ROW_TOTAL_TAX`); not signable until connector gate GREEN (Rule 2).
4. `_ROW_PAMER_DECOMMISSION` (informational, in `.md` register): records that `pamer_bp` (Child-4, cm2/total_spend) had NO legacy comparand and is DECOMMISSIONED in slice 4 — so the audit trail shows why it left the registry.

No new DDR row for `cac_mu` (legacy comparand exists; shadow_compare, no delta) or `acquisition_ad_spend_mu` (passthrough; covered by `_ROW_NC_REVENUE_CM2`).

## D5 — Three analytics use-cases (application layer)

New `apps/analytics-service/src/application/marketing/`:
- `marketing_efficiency_query.py` — `MarketingEfficiencyQuery.execute(workspace_id, date_range, facts, *, _client)`. `MarketingEfficiencyFacts` (frozen): `net_revenue_mu`, `total_ad_spend_mu`, `new_customer_revenue_mu`, `acquisition_ad_spend_mu`, `meta_spend_mu`, `google_spend_mu`. Computes `mer_bp`, `amer_bp` (acquisition denominator!), `acos_bp` (display), `blended_roas_x100` (display). Reads via `query_metrics(workspace_id, "mer_bp", ...)` (fail-closed). NULL guards (no spend → mer NULL; no acq spend → amer NULL).
- `acquisition_summary_query.py` — `AcquisitionSummaryQuery.execute(workspace_id, date_range, facts, *, _client)`. `AcquisitionFacts` (frozen): `new_customers_count`, `nc_cm2_mu`, `new_customer_revenue_mu`, `total_ad_spend_mu`, `acquisition_ad_spend_mu`, `meta_spend_mu`, `google_spend_mu`, `daily` (tuple of per-day rows: date, nc_count, nc_cm2_mu, ad_spend_mu, acquisition_ad_spend_mu, nc_revenue_mu, meta_mu, google_mu). Computes `cac_mu` (blended), `cm2_per_nc_mu`, daily `cac_mu`/`cm2_per_nc_mu`/daily `amer` (nc_rev/acq_spend). RTO/tax/refund exclusion already baked into the supplied nc_cm2_mu/nc_revenue facts (connector use-case responsibility) — documented.
- `distributions_query.py` — `DistributionsQuery.execute(workspace_id, date_range, facts, *, metric, search, sort, dir, page, page_size, _client)`. `DistributionsFacts` (frozen): tuple of per-product rows {product_label, per_order_values_mu (tuple of per-order sales OR cm1 in paise)}. Computes per-product `mode` (legacy tie-break: 2dp-rounded freq, lowest value on tie), `mean`, `diff = mode − mean`, + 60-bucket density histogram (globalMode/globalMean). Filter/sort/paginate in the use-case. Deterministic integer-paise; mode rounding ported EXACTLY (persona Concern 6). NOT attribution.
- Each carries `@paradigm: sql`. Zero float in money paths. Zero LLM.
- `__init__.py`.
- Tests: `test_marketing_efficiency_query.py`, `test_acquisition_summary_query.py`, `test_distributions_query.py` — POSITIVE (aMER classification-split anchor 15000bp; MER 12000bp; CAC ₹500; distributions mode/mean/diff) + NEGATIVE (falsy workspace_id → UnscopedQueryError; cross-workspace isolation; "use total spend for aMER" mutant killed; RTO new-customer order → 0 revenue + 0 CM2; zero-denominator NULL guards; empty product set).

## D6 — Three DataPlanePort additive methods (BFF seam)

`apps/api-gateway/src/domain/proto-types.ts` — ADD result row interfaces (all `_mu` bigint, `_bp` number|null): `MarketingEfficiencyResult`, `AcquisitionSummaryResult` (+ `AcquisitionDailyRow`), `DistributionsResult` (+ `DistributionsProductRow`, `DistributionsGraphPoint`). ADD 3 methods on `DataPlanePort`: `getMarketingEfficiency`, `getAcquisitionSummary`, `getDistributions`. `StubDataPlane` implements all three from `SUGANDH_LOK_CANONICAL`, EXTENDED with slice-4 facts chosen so: (a) MER numerator (`net_revenue_mu`) == the slice-1 /store net revenue seed (cross-surface consistency — persona Concern 3), (b) the aMER anchor reproduces 15000bp with `acquisition_ad_spend_mu` < `total_ad_spend_mu` (classification split — persona Concern 1), (c) CAC ₹500 reproduces, (d) distributions has ≥2 products with multi-order value arrays.

## D7 — tRPC `marketing.*` group

`apps/api-gateway/src/application/router.ts` — NEW `marketingRouter`:
- `marketing.efficiency` — workspaceProc, requireRole(ANALYST), input {date_start,date_end}, returns {result, data_epoch, request_id}.
- `marketing.acquisition` — same guard; returns {summary, daily, data_epoch, request_id}.
- `marketing.distributions` — same guard + inputs {date_start,date_end, metric?('sales'|'cm1'), search?, sort?, dir?, page?, page_size?}; returns {rows, total_rows, graph_points, global_mode, global_mean, data_epoch, request_id}.
- Every money field bigint over superjson; every metric field traced via `assertMarketingDefinitionId` (registry-mapper). Mounted under root as `marketing`.

`apps/api-gateway/src/domain/registry-mapper.ts` — ADD `MARKETING_DEFINITION_IDS` (`mer_bp, amer_bp, cac_mu, cm2_per_nc_mu, new_customer_revenue_mu, nc_cm2_mu, acquisition_ad_spend_mu, total_ad_spend_mu, acos_bp, blended_roas_x100`) + `assertMarketingDefinitionId`. **REMOVE `pamer_bp` references** if any exist in mapper/columns.

## D8 — Two page wirings (Ananya) — render-only, reuse shell

- `/acquisition`: MER/aMER/ACOS strip (bp scale /10000, display "1.50×"), CAC card (formatMoney), CM2-per-NC card, new-customers count, meta/google spend split, daily table (date, NC, NC-CM2, CAC, aMER). ROAS/ACOS labeled "display-only". request_id sr-only; loading/error; freshness label (data_epoch). ZERO arithmetic in components.
- `/distributions`: metric toggle (sales/CM1), per-product table (product, orders, mode, mean, diff) with search/sort/paginate, + density histogram (graph_points). formatMoney for mode/mean. Render-only.

## D9 — Reversibility, residency, FX, GST, compliance

- All additive/reconciliation: edit 3 defs + decommission 1 + add 4 defs + 4 DDR rows + 3 use-cases + 3 port methods + 1 tRPC group + 2 page swaps. No migration of existing data, no live DDL. Reversal = revert registry/DDR edits (restore pamer_bp from git) + drop new files + restore 2 scaffold pages + remove marketing router.
- FX poison NOT ported (these modules don't use static EXCHANGE_RATES; confirm none introduced — legacy `storeCurrency='INR'` constant, no FX).
- Per-SKU GST untouched: `new_customer_revenue_mu` uses per-order `totalTax` (flows from per-SKU slabs upstream); DDR note forbids a blended-tax shortcut (persona Concern 4).
- ap-south-1 residency carried.
- No outbound channel — no DLT/NCPR/calling-hours trigger. Read-only analytics; no Decision-Log write. Campaign-classification consumed read-only.
- Non-goals (DO NOT build): paMER (decommissioned), cac_payback_months (slice 5), cohort/LTV attribution ladder (slice 5), WooCommerce acquisition path, campaign-classification CRUD UI (slice 7), goals overlay (slice 7), acquisition trend MA90/180/365 + composition (defer — not parity-critical for the slice-4 page; can add in a follow-up; keep slice tight).

## Files to create / change (the ONLY staged paths)

**Create:**
1. `apps/analytics-service/src/application/marketing/__init__.py`
2. `apps/analytics-service/src/application/marketing/marketing_efficiency_query.py`
3. `apps/analytics-service/src/application/marketing/acquisition_summary_query.py`
4. `apps/analytics-service/src/application/marketing/distributions_query.py`
5. `apps/analytics-service/tests/test_marketing_efficiency_query.py`
6. `apps/analytics-service/tests/test_acquisition_summary_query.py`
7. `apps/analytics-service/tests/test_distributions_query.py`
8. `apps/api-gateway/src/application/router.marketing.test.ts`
9. `apps/web/src/interfaces/components/marketing/acquisition-content.tsx`
10. `apps/web/src/interfaces/components/marketing/distributions-content.tsx`

**Change:**
11. `packages/lib-metrics/src/registry/definitions.ts` — redefine AMER_BP; add MER_BP + CAC_MU + new defs; remove PAMER_BP; register/deregister in METRIC_REGISTRY.
12. `packages/lib-metrics/src/registry/index.ts` — export new defs; remove PAMER_BP export.
13. `packages/lib-metrics/src/registry/registry.test.ts` — completeness + correctness-fixture lists + non-vacuous anchors; remove pamer_bp.
14. `pylibs/brain_metrics/brain_metrics/registry/definitions.py` — redefine amer_bp; reconcile mer_bp basis; add new defs; remove pamer_bp; update METRIC_REGISTRY.
15. `pylibs/brain_metrics/brain_metrics/registry/__init__.py` — barrel updates.
16. `pylibs/brain_metrics/tests/test_registry.py` — mirror anchors; remove pamer_bp.
17. `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py` — ADD 3 DDR rows + register.
18. `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.md` — mirror rows + pamer decommission note.
19. `apps/api-gateway/src/domain/proto-types.ts` — ADD result interfaces + 3 port methods.
20. `apps/api-gateway/src/domain/registry-mapper.ts` — ADD MARKETING_DEFINITION_IDS + assert fn; remove pamer_bp refs.
21. `apps/api-gateway/src/infrastructure/loopback-data-plane.ts` — extend seed; implement 3 methods.
22. `apps/api-gateway/src/application/router.ts` — ADD marketingRouter; mount under `marketing`.
23. `apps/web/src/app/(shell)/acquisition/page.tsx` — swap ScaffoldPage → AcquisitionContent.
24. `apps/web/src/app/(shell)/distributions/page.tsx` — swap ScaffoldPage → DistributionsContent.

## Over-engineering self-check (7/7)

- No new primitive: reuses query gateway, DataPlanePort, format-money, registry, parity harness, DDR, requireRole, ratioToBasisPoints. New defs are the minimal marketing econ set.
- Existing defs reconciled/reused, not duplicated; `pamer_bp` REMOVED (anti-bloat — deletes a dead def rather than adding more).
- No new dependency (no npm/pip/uv add).
- No new runtime, no @paradigm LLM decorator.
- No speculative abstraction: acquisition trend/composition + payback + Woo path are explicit non-goals.
- Single-Primitive Rule: ONE def per concept; aMER denominator is its own def (`acquisition_ad_spend_mu`), not a fork of total spend.
- Reversible additive; legacy untouched.

## Handoff to Stage 3

- **Maya:** reconcile amer_bp/mer_bp/cac_mu (TS+PY byte-identical) + decommission pamer_bp + 4 new defs + non-vacuous anchors (aMER 15000bp w/ classification split, MER 12000bp, CAC ₹500) + 4 DDR rows + 3 analytics use-cases + Python tests. Owns parity-green-AND-non-vacuous + the legacy-faithful aMER denominator.
- **Vikram:** proto-types result rows + 3 port methods + StubDataPlane seed (MER numerator == /store net revenue; aMER classification split; CAC ₹500) + registry-mapper MARKETING ids (+ remove pamer_bp) + marketingRouter + router tests. Owns the BFF contract + tenancy choke + traceability.
- **Ananya:** 2 page contents wired to `trpc.marketing.*`, render-only, formatMoney + scale, reusing the shell. Owns the 2 live pages.

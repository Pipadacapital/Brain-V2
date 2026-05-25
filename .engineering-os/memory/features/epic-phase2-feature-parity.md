# Feature journal — epic-phase2-feature-parity

> Phase 2 = the BREADTH phase of `chore-migrate-legacy-to-brain`. The migration epic decomposed by architectural LAYER (depth); this epic decomposes the SAME program by FEATURE (breadth) on top of those layers. Reuses the Child-0 A1.2 capability map.

## 2026-05-25T13:22:45Z — Stage 1 (intake / EPIC decomposition) — Rohan

**Founder directive:** "Start Phase 2. Check the legacy backend — same functionalities on Brain. Convert Brain's old backend (legacy folder) to Brain's new architecture." Asked for a ratified decomposition + the first slice's requirement; build HELD for Founder visibility.

**Verified ground truth (live tree, not prose):**
- Legacy: 40 workspace route files + matching `lib/<feature>` modules; money Decimal/Float; FX poison `pnl.ts:42-56`; zero RLS.
- Brain analytics-service: ZERO application/domain use-cases (only bootstrap + query_gateway). The 40 feature computations DO NOT exist Brain-native.
- api-gateway: 9 live tRPC procedures.
- metric registry: ~12-17 defs.
- web: 31 routes, /dashboard wired to metrics.kpiSummary, 30 pages = scaffolds.
- All 7 layer-children HELD at cutover; legacy still authoritative.

**Decision:** ADVANCE as ratified EPIC + slice-1 spec; BUILD HELD for Founder ratification. Lane high-stakes (inherited). 1 persona requested (`ai-cost-realist:sonnet`).

**Reuse audit:** ~90% plumbing reused, ~90% feature surface net-new. Foundations (RLS/money/connectors/metric-registry/OLAP-gateway/AI-gateway/frontend-shell) reused wholesale; the analytics application layer + the ~40 feature computations + their metric defs + tRPC procedures + page wiring are net-new.

**9-slice decomposition (foundation-first, dependency-ordered):**
1. `feat-store-order-fact-layer` — shared store/order fact layer + revenue ladder (FORCED foundation; all analytics read from it). → /store, /dashboard. SQL.
2. `feat-pnl-cm-waterfall` — honest P&L + CM waterfall. → /pnl, /waterfall. SQL. (CM2 def-delta check.)
3. `feat-rto-cod-economics` — RTO + COD/prepaid + pincode (highest honest-CM2 value). → /rto-analytics, /cod-prepaid, /logistics, /pincode-intelligence. SQL.
4. `feat-marketing-acquisition` — MER/aMER/CAC + acquisition + distributions. → /acquisition, /distributions. SQL (scheduled rollup).
5. `feat-cohorts-ltv` — cohorts + LTV. → /cohorts, /lifetime-value. SQL (ML only if proven).
6. `feat-catalog-inventory` — catalog/inventory + first-product cascade. → /products, /inventory, /first-product-cascade. SQL.
7. `feat-finance-settings-goals` — COGS/costs/goals/festivals/calendar. → /costs, /settings/goals, /settings/festivals, /calendar, /settings/ad-campaigns. SQL.
8. `feat-lifecycle-timings-email` — lifecycle states + timings + email/SMS performance. → /customer-lifecycle, /timings, /email-sms. SQL.
9. `feat-ai-insight-narration` — page-level AI narration (LAST, cost-gated). → overlay all. small_llm; signals are SQL/ML; NEVER frontier-LLM per page.

**Slice 1 spec (ready for Aryan):** canonical CH facts (orders/line_items/order_costs) for the Sugandh Lok anchor brand from the connector framework; revenue-ladder metric defs (per-SKU GST 2.0 slab via India RegionAdapter, realized = honest billing base) TS<->Python parity-green; first analytics use-case (StoreSummaryQuery) through the query gateway; tRPC store.revenueLadder/store.summary; wire /store live. Additive/reversible; @paradigm("sql"); RLS proven; exact minor units; real-network smoke PASS.

**Cadence:** assembly-line, one slice at a time, full high-stakes pipeline (Rohan S1 -> Aryan S2 -> Maya/Vikram S3 -> Shreya S4 -> Tanvi S5 -> Rohan S6 -> Founder S7), each ending in a real data-backed page; nothing committed without Founder "commit it"; no slice starts until its data-dependency slice ships. On all 9 done -> Brain at functional parity -> Child-7 HELD cutovers become flippable.

**Open for cost-realist / Aryan:** ML-vs-SQL ruling per feature (slice 9 + ltv/rto/response); slice-9 narration cost ceiling; join-heavy metric rollup-vs-MV; CM2 definitional-delta at slice 2.

## 2026-05-25T15:22:00Z — Slice 4 SHIPPED (Stage 6 PASS) — feat-marketing-acquisition — Rohan

**MER/aMER/CAC + acquisition + distributions** on 2 real pages (`/acquisition`, `/distributions`). Full high-stakes pipeline (Rohan S1 → Aryan S2 → Maya/Vikram/Ananya S3 → Shreya S4 → Tanvi S5 → Rohan S6), signed under standing delegation. Stage-8 readiness; nothing committed (pending-founder-commit.md).

**The slice-2/3 lesson applied again — and it bit:** reading the actual legacy formulas at Stage 1 found (a) the ratified slice-table shorthand WRONG (paMER has NO legacy comparand; payback + placed→realized→incremental are slice-5 cohort concepts, not slice-4); (b) Child-4 had SPECULATIVELY PRE-BUILT marketing defs diverging from legacy behind the parity gate's "shadow-phase" carve. **Reconciled, not wired:**
- `amer_bp` REDEFINED to legacy: `nc_revenue / acquisition-classified spend` (was `true_cm2/total_spend`). The denominator is its own def (`acquisition_ad_spend_mu`), NOT total spend — the load-bearing correction.
- `pamer_bp` DECOMMISSIONED (phantom; no legacy comparand) — removed from both registries, barrels, DDR, and all locked-canon tests; parity gate's non-vacuity mutant retargeted to `amer_bp`.
- `mer_bp` (numerator reconciled net_sales→net_revenue for /store cross-surface consistency) + `cac_mu` brought into BOTH registries (closed the uneven TS/PY split).
- 4 new defs: `new_customer_revenue_mu`, `nc_cm2_mu`, `cm2_per_nc_mu`, `acquisition_ad_spend_mu`.

**Bar met:** TS↔Python parity-green + NON-VACUOUS (aMER 15000bp on a classification split; "use total spend" mutant killed in gate + unit + router tests); 3 fail-closed analytics use-cases; `marketing.*` tRPC (workspaceProc/ANALYST/bigint); RLS fail-closed proven at the wire (foreign workspace → UnscopedQueryError); per-SKU GST never blended; ROAS/ACOS display-only; @paradigm sql, zero LLM; real-network smoke PASS (mer 29384, amer 30000, cac 16250, dist-mode 48000); typecheck 0. DDR: 10 SIGNED, 3 UNSIGNED-PENDING child-3, 1 DECOMMISSIONED.

**Tests:** 142 TS lib-metrics + 73 api-gateway + 299 brain_metrics + 136 analytics (29+11 net-new), all green.

**Candidate rule generated** (≥3-run recurring root cause): `verify-legacy-formula-at-stage1-not-slice-table` — human-gated, awaiting Founder /adopt-rule.

**Deferred (non-goals):** acquisition trend/composition; WooCommerce path; campaign-classification CRUD (slice 7); goals overlay (slice 7); payback + cohort/LTV attribution ladder (slice 5).

**Progress: slices 1-4 done (4/9).** Next: slice 5 `feat-cohorts-ltv` (cohorts + LTV; payback + placed→realized→incremental ladder live HERE). Do NOT auto-start — orchestrator drives the loop + commits.

## 2026-05-25T15:42:00Z — Slice 5 SHIPPED (Stage 6 PASS) — feat-cohorts-ltv — Rohan

**Cohorts + LTV** on 2 real pages (`/cohorts`, `/lifetime-value`). Full high-stakes pipeline (Rohan S1 → Aryan S2 → Maya/Vikram/Ananya S3 → Shreya S4 → Tanvi S5 → Rohan S6), signed under standing delegation. Stage-8 readiness; nothing committed (pending-founder-commit.md).

**The standing lesson bit a 4th time — read the actual legacy formulas:** found 5 divergences from the ratified slice-table, all reconciled:
- **Cohorts use CM3** (cm2 − misc), NOT the slice-table's `cohort_cumulative_cm2_mu`. `cohort_ltv_mu` accumulates realized CM3.
- **LTV uses CM2** with NO CAC/payback/LTV:CAC — those are COHORT concepts (same misattribution class as slice-4's payback). The LTV row has no cac field.
- **`cac_payback_months` (CAC/MonthlyCM2) DECOMMISSIONED** — a 3rd speculative phantom that diverges from the legacy cumulative bucket-walk + interpolation. Real payback computed in `CohortMatrixQuery` as centi-months (×100 integer interpolation); DDR `_ROW_CAC_PAYBACK`.
- **`ltv_cac_bp` comment fixed** (input rung is cumulative CM3, not CM2); ratio reused unchanged.
- **FX poison killed** (legacy static EXCHANGE_RATES in both modules).

**Bar met:** 2 new defs (cohort_ltv_mu correctness_fixture, repeat_rate_bp shadow_compare) TS↔Python byte-identical + NON-VACUOUS (CF-S5-LTV-CUM-1 cumulative-vs-incremental mutant killed; CF-S5-RR90-1 wrong-denominator mutant killed; CF-S5-COHORT-PAYBACK-1 flat-ratio mutant killed at gate+unit+router+wire); 2 fail-closed use-cases; cohorts.matrix + ltv.summary tRPC (workspaceProc/ANALYST/bigint); RLS fail-closed proven at the wire (foreign workspace → UnscopedQueryError); per-SKU GST untouched; @paradigm sql (ML ruled out — legacy has no model); ZERO new deps; typecheck 0. DDR: cohort_ltv_mu + cohort_cac_payback SIGNABLE (parity_gap, child_dependency None), repeat_rate_bp shadow SIGNABLE.

**Tests:** 146 TS lib-metrics + 87 api-gateway + 299 brain_metrics + 165 analytics (29+14+4 net-new), all green. Live smoke (real network): cohorts payback 1.0mo/0.33mo, ltv_cac 12000/15000bp, ltv cumulative CM2 1500000/1800000.

**Candidate rule:** evidence #5 appended to `verify-legacy-formula-at-stage1-not-slice-table` (human-gated; ≥4 runs).

**Deferred (non-goals):** WooCommerce cohort/LTV path; customer-lifecycle/RFM (slice 8); AI narration (slice 9); collection/discount_codes real compute.

**Progress: slices 1-5 done (5/9).** Next: slice 6 `feat-catalog-inventory` (catalog/inventory + first-product cascade). Do NOT auto-start — orchestrator drives the loop + commits.

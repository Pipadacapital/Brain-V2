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

## 2026-05-25T16:02:00Z — Slice 6 SHIPPED (Stage 6 PASS) — feat-catalog-inventory — Rohan

**Catalog/products + inventory + first-product cascade** on 3 real pages (`/products`, `/inventory`, `/first-product-cascade`). Full high-stakes pipeline (Rohan S1 → Aryan S2 → Maya/Vikram/Ananya S3 → Shreya S4 → Tanvi S5 → Rohan S6), signed under standing delegation. Stage-8 readiness; nothing committed (pending-founder-commit.md).

**The standing lesson bit a 6th time — read the actual legacy formulas:** the slice-table was WRONG on ALL THREE features; reconciled, not rebuilt:
- **Products is CM1, NOT per-SKU CM2** (Finding 1). `cm1 = (sales−refunds) − cogs − variableCost` — algebraically byte-identical to the existing `cm1_mu`, so **REUSED cm1_mu** (and `aov_mu`); did NOT build phantom `product_cm1_mu`/`sku_cm2_mu` (Single-Primitive Rule). There is no SKU-grain CM2 (no per-SKU ad allocation in legacy).
- **Pareto grade is a cumulative-CM1 walk** over positive-cm1 rows (≤80%→A, ≤95%→B, else C; neg→F) — integer-exact (cum×100 ≤ total×80), anchored at the boundary.
- **Inventory has sellThrough + daysLeft, NO turnover** (Finding 3). `inventory_days_left` = velocity cascade L30→L90→L180→L360 (999999 INFINITE sentinel); `inventory_sell_through_bp` = sales365/(sales365+inv). The slice-table's "inventory turnover"/"cover_days" don't exist in legacy.
- **Cascade second-order-rate is per-first-product, observation-windowed — NOT slice-5 rr90** (Finding 4). De-conflated: `first_product_second_order_rate_bp` (≥2 lifetime orders / cohort) is a SEPARATE def; did NOT reuse `repeat_rate_bp`. Cascade LTV is REVENUE (totalPrice), not CM — DDR-noted.

**Bar met:** 3 new defs (inventory_sell_through_bp shadow + DDR scale-delta, inventory_days_left correctness_fixture + DDR, first_product_second_order_rate_bp shadow + DDR scale-delta) TS↔Python byte-identical + NON-VACUOUS (CF-S6-INV-SELLTHRU-1 ÷-inv-only mutant killed; CF-S6-INV-DAYSLEFT-1 always-L360 mutant killed + INF sentinel anchor; CF-S6-FP-2ND-1 ÷-orders mutant killed; pareto boundary anchored). 3 fail-closed use-cases; catalog.products/inventory/firstProductCascade tRPC (workspaceProc/ANALYST/bigint); RLS fail-closed proven at the wire (foreign workspace header → UnscopedQueryError); per-SKU GST untouched (sits on slice-1/2 honest base); @paradigm sql (ML ruled out); ZERO new deps; typecheck 0 (lib-metrics/api-gateway/web).

**Tests:** 152 TS lib-metrics (+6) + 104 api-gateway (+17) + 317 brain_metrics (+18) + 208 analytics (+43), all green. Parity gate PASS (36 shared metrics, DDR coverage, killed-mutant non-vacuous). Live smoke (real network): products CM1 500000/grade A/total 650000; inventory ROSE 10d/Restock Soon, MUSK 30d cascade/Healthy, OUD 300d/Overstocked, SND-BAR 999999/Severely Overstocked; cascade p_oud 2nd=3750bp/3rd=2500bp/4th+=1250bp/extra=75/ltv=1000000/days2nd=300. 3 pages HTTP 200.

**Candidate rule:** evidence #6 for `verify-legacy-formula-at-stage1-not-slice-table` (human-gated; ≥5 runs).

**Deferred (non-goals):** WooCommerce products/cascade path; products CRUD/settings (slice 7); collections/vendor/tags real grouping compute (scaffolded enums, product-grain seeded); AI narration (slice 9); inventory reorder-recommendation ML (none proven).

**Progress: slices 1-6 done (6/9).** Next: slice 7 `feat-finance-settings-goals`. Do NOT auto-start — orchestrator drives the loop + commits.

## 2026-05-25T16:30:00Z — Slice 7 SHIPPED (Stage 6 PASS) — feat-finance-settings-goals — Rohan

**COGS/costs + goals + festivals + calendar** on 4 real pages (`/costs`, `/settings/goals`, `/settings/festivals`, `/calendar`). Full high-stakes pipeline (Rohan S1 → Aryan S2 → Maya/Vikram/Ananya S3 → Shreya S4 extra write-path scrutiny → Tanvi S5 → Rohan S6), signed under standing delegation. Stage-8 readiness; nothing committed (pending-founder-commit.md).

**The standing lesson bit a 7th time — read the actual legacy formulas; the slice-table was wrong on the two headline features:**
- **Goal RAG is DIRECTIONAL, not flat** (Finding 1). Legacy `computeGoalRag`: higher-better `≥0.95→green/≥0.80→amber`; **lower-better `≤1.05→green/≤1.20→amber` (INVERTED)**. Direction via `higherBetterForGoal` (MIN→hb, MAX→lb, TARGET→metric default; cac/acos lower-better). The slice-table's AND the pre-existing `rag-badge.tsx`'s flat "≥95% green" is ONLY the higher-better case — it would paint an over-budget CAC GREEN. Implemented `computeGoalRag`/`compute_goal_rag` in BOTH registries; proven at the wire (CAC@120% = amber, not green).
- **Festival "learned lift" is a PHANTOM** (Finding 2). Legacy festivals carry only a stored `expected_multiplier` template default (1.3 Makar Sankranti … 4.0 Diwali) — NO learned-lift compute anywhere. DECOMMISSIONED before birth (4th decommission: pamer_bp/cac_payback_months/product_cm1_mu lineage). NOT added to either registry.
- **Calendar report = period grid + marketing-action overlays** (Finding 3), NOT a festival surface. Reuses slice-1/2/4 primitives (net_revenue/cm3/mer/amer/cac/aov) with per-cell directional RAG + manual/Klaviyo overlays — no new metric. De-conflated "festivals" (settings template) from "calendar" (overlay grid).
- **COGS resolve feeds the EXISTING cm1_mu** (Finding 4): override% → product coq → fallback% → 0, then markup. One source of truth — /costs reads the resolved stack + CM landing; does NOT recompute COGS.

**Scope decision:** goal upsert (the one write surface) SHIPPED — idempotent (Redis dedup, proven replay at the wire), MANAGER-gated, RLS-scoped-on-write (foreign-ws → UnscopedQueryError at the wire), Zod-validated. Costs/festivals/marketing-action CRUD DEFERRED (pages stay real READ views, not stubs).

**Bar met:** 1 new def (`goal_attainment_bp`) TS↔Python byte-identical + NON-VACUOUS (CF-S7-GOAL-ATTAIN-1: 9200/10000→9200bp; "÷ actual" mutant→10000 KILLED; directional band: "all-higher-better" mutant flips CAC red→green KILLED at gate+unit+router+wire); 4 fail-closed use-cases; `settings.*` + `calendar.report` tRPC (workspaceProc/ANALYST/bigint) + `settings.upsertGoal` (MANAGER/idempotent/Zod); RLS fail-closed at the wire; per-SKU GST untouched (sits on slice-1/2 honest base); @paradigm sql; ZERO LLM/ML; ZERO new deps; typecheck 0 (lib-metrics/api-gateway/web). DDR: `goal_attainment_bp` SIGNED (shadow_compare, child_dependency None); `festival_lift` DECOMMISSIONED.

**Tests:** 159 TS lib-metrics (+7) + 120 api-gateway (+16) + 326 brain_metrics (+9) + 244 analytics (+36), all green. Parity gate PASS (37 shared metrics, DDR coverage, killed-mutant non-vacuous). Live smoke (real network :3001): goals CAC amber/revenue amber/cm3 green/mer green; costs CM1 17.8M (=30M−9M−3.2M); festivals Diwali 40000bp/peak; calendar day-2 CAC red (164%); upsert replay idempotent; foreign-ws rejected. 4 pages HTTP 200 (real client components).

**Candidate rule:** evidence #7 appended to `verify-legacy-formula-at-stage1-not-slice-table` (human-gated; now bitten EVERY analytics slice 2-7 — recommend `/adopt-rule`).

**Deferred (non-goals):** festival CRUD; cost-row CRUD + cogsSettings.patch; marketing-action CRUD; inline goal editor (the mutation IS shipped + wired).

**Progress: slices 1-7 done (7/9).** Next: slice 8 `feat-lifecycle-timings-email`. Do NOT auto-start — orchestrator drives the loop + commits.

## 2026-05-25T16:45:00Z — Slice 8 SHIPPED (Stage 6 PASS) — feat-lifecycle-timings-email — Rohan

**Customer lifecycle + order timings + email/SMS performance** on 3 real pages (`/customer-lifecycle`, `/timings`, `/email-sms`). Full high-stakes pipeline (Rohan S1 → Aryan S2 → Maya/Vikram/Ananya S3 → Shreya S4 EXTRA outbound-surface scrutiny → Tanvi S5 → Rohan S6), signed under standing delegation. Stage-8 readiness; nothing committed (pending-founder-commit.md).

**🚨 HARD COMPLIANCE BOUNDARY HELD — READ/ANALYTICS ONLY (Shreya S4 confirmed ZERO outbound surface):** the legacy slice-8 code is itself pure read (the only "send" tokens are `sendDate`, a READ column on already-sent Klaviyo rows). NO outbound send (WhatsApp/SMS/email/call), NO audience-to-channel dispatch, NO write to lifecycle-service outbound was added. Email/SMS = REPORTING on past performance; RFM = analytics scoring, not a campaign trigger; reactivation window = a RECOMMENDATION, not a send. Proven at the wire: `lifecycle.send` → HTTP 404; the lifecycle router exposes ONLY 3 `.query` procedures (structural test asserts no `.mutation`/send/dispatch). The compliance-review-retrigger boundary (DLT/NCPR/9am-9pm/consent) was NOT crossed.

**The standing lesson bit an 8th time — read the actual legacy formulas; the slice-table was WRONG on every headline:**
- **F1: Lifecycle is recency-vs-empirical-percentile, NOT classic RFM.** Legacy `classifyCustomerLifecycle` buckets new/active/at_risk/churned from days-since-last-order vs the workspace's empirical repeat-gap p40/p80 (fallback 45/120 when <20 gaps). NO recency/frequency/monetary quintile SCORING anywhere — "RFM scores/segments" is a phantom. The classifier + percentile are use-case logic (`LifecycleStatesQuery`), like `compute_goal_rag`, NOT registry scalars. Frequency enters only as orderCount==1 (new) vs ≥2 (active); monetary = revenue-by-bucket attribution.
- **F2: Timings is inter-order gaps, NOT "best hours/days".** Legacy `computeTimings` = gap medians (1→2, 2→3, 3→4) + 2nd/3rd/4th repeat % + reactivationDays = 0.8×median(1→2). NO hour/day-of-week analysis. **`best_send_time` DECOMMISSIONED before birth** (5th decommission-before-birth: pamer_bp/cac_payback_months/product_cm1_mu/festival_lift lineage).
- **F3: Timings 2nd-order% is a WINDOWED first-order cohort (all-product), DISTINCT from slice-6 `first_product_second_order_rate_bp`** (lifetime ≥2 / per-first-product cohort). De-conflated — NOT reused.
- **F4: `email_cm2_mu` is a PHANTOM (6th decommission-before-birth).** Legacy email-performance has NO CM2/margin attribution to email — only revenue + open/click/rev-per-recipient/rev-per-open/unsub/spam rates. Ported revenue + rates only.

**Bar met:** 4 new defs — `reactivation_window_days` (correctness_fixture + DDR `_ROW_REACTIVATION_WINDOW`, Brain-native integerized 0.8 factor), `email_open_rate_bp` / `email_click_rate_bp` / `email_revenue_per_recipient_mu` (shadow_compare, Klaviyo comparand) — TS↔Python byte-identical + NON-VACUOUS (CF-S8-REACT-1: round(0.8×30)=24, "drop 0.8" mutant→30 KILLED; CF-S8-EMAIL-OPEN/CLICK/RPR-1: "÷ unique_opens not delivered" mutants KILLED at gate+unit+router+wire). 3 fail-closed use-cases; `lifecycle.states/timings/emailSms` tRPC (workspaceProc/ANALYST/bigint; READ `.query` only); RLS fail-closed proven at the wire (foreign workspace → UnscopedQueryError); per-SKU GST untouched (sits on slice-1/2 honest base); @paradigm sql (RFM is SQL scoring — ML/LLM ruled out per CRITICAL PARADIGM); ZERO new deps; typecheck 0 (lib-metrics/api-gateway/web). DDR: `reactivation_window_days` SIGNABLE (parity_gap correctness_fixture, child_dependency None); `best_send_time` + `email_cm2_mu` DECOMMISSIONED before birth (no DDRRow; audit in journal).

**Tests:** 166 TS lib-metrics (+7) + 134 api-gateway (+14) + 339 brain_metrics (+13) + 273 analytics (+29), all green. Parity gate PASS (41 shared metrics, DDR coverage, killed-mutant non-vacuous). Live smoke (real network :3001): lifecycle.states net_active 460/p40 30/p80 75; timings first_orders 700/2nd 44.00%/days_1to2 32/reactivation 26; emailSms diwali 4500bp open/1200bp click/800µ rpr, sms-flash 0 open/500bp click, dow sorted; foreign-ws rejected; lifecycle.send HTTP 404. 3 pages HTTP 200 (real client components, not scaffold).

**Candidate rule:** evidence #8 for `verify-legacy-formula-at-stage1-not-slice-table` (human-gated; bitten EVERY analytics slice 2-8 — recommend `/adopt-rule`).

**Deferred (non-goals):** WooCommerce lifecycle/timings path; any actual outbound send / audience dispatch (OUT OF Phase-2 scope — re-triggers full compliance review); revenue_per_unique_open + unsub/spam-rate display columns (rev/rate primitives shipped; thin display add); AI narration (slice 9).

**Progress: slices 1-8 done (8/9).** Next: slice 9 `feat-ai-insight-narration` (the LAST, cost-gated cluster). Do NOT auto-start — orchestrator drives the loop + commits.

## 2026-05-25T17:55:00Z — Slice 9 SHIPPED (Stage 6 PASS) — feat-ai-insight-narration — Rohan — EPIC FUNCTIONALLY COMPLETE (9/9)

**Grounded, cost-gated AI insight narration** on `/pnl` (the one non-SQL slice). Full high-stakes pipeline (Rohan S1 → Aryan S2 → Maya/Vikram/Ananya S3 → Shreya S4 → Tanvi S5 faithfulness VETO → Rohan S6), signed under standing delegation. Stage-8 readiness; nothing committed (pending-founder-commit.md).

**The standing lesson applied (read the ACTUAL legacy AI surface, not the slice table):** `module/ai-engine` (page insights) is a FULL impl with **hardcoded Opus/Sonnet via direct SDK + an Ollama path** — the exact paradigm-break Child-0 flagged; NOT ported. `lib/insights/insight-builder.ts` lets the LLM INVENT insight_type/recommendation/confidence — the anti-pattern slice 9 must NOT replicate. `lib/insights/anomalies.ts` is pure rule-based statistical signals (the correct grounded layer). CLAUDE.md's "legacy module/ai is dead" confirmed (that's the CHAT path). **Ruling: build the Brain-native minimal grounded narrator — which Child-5 (`feat-ai-engine-intelligence`) already built ~90% of (PnlInsightAgent + gateway + faithfulness validator + injection preprocessor + golden-set eval + 5 VETO gates).** Slice 9 is NOT a rebuild — it EXPOSES that vertical through the serving stack so it renders on a page (the only deliverable-bar gap).

**The 4 non-negotiable gates — all met as real load-bearing code:**
- **cost-routing-paradigms:** `@paradigm small_llm` (Haiku), narration ONLY; signals deterministic sql; NEVER frontier per page; filtersHash 6h cache. Cost audit Q1-Q4 PASS (per-decision ~0.5 paise uncached / zero cached; well within %-of-GMV; Child-5 ~₹440/mo/brand at full load).
- **llm-evals / "LLMs NEVER invent numbers":** faithfulness gate set-compares every narrated number against the deterministic signal set, at the intelligence-service gateway AND re-asserted at the BFF (`assertInsightFaithfulness`, defense-in-depth). Golden-set eval 13/13 PASS (10 Child-5 + 3 NEW slice-9: 2 grounded-pass + 1 killed mutant ₹4.0L hallucination → RED); retry_rate 0.0%; inverse vacuous-validator mutant caught.
- **prompt-injection-defense:** untrusted commerce text fenced `<data trusted="false">` + sentinel-escaped + fail-closed (Child-5 preprocessor); BFF output gate rejects any surviving fence/role-control sequence; output-schema validated.
- **decision-log:** narration READ-ONLY (recommendation-only-until-graduated); gateway writes one Decision-Log row per synthesis; NO execute path.

**Bar met (Single-Primitive Rule — narration over slices 1-8 numbers, ZERO new metric def):** `insights.forPage` tRPC (workspaceProc/ANALYST/**READ `.query` ONLY** — structural test asserts NO `.mutation`; `insights.submit`→NOT_FOUND at the wire); `DataPlanePort.getPageInsights` additive on the SAME port; canonical-unit convention LOCKED (rupee/bp grounding mirrors Child-5 golden set); `PageInsightSeverity` a DISTINCT type from Morning-Brief `InsightSeverity` (not overloaded); RLS fail-closed at the wire (cross-ws → UnscopedQueryError); per-SKU GST untouched; @paradigm small_llm; ZERO new deps; typecheck 0 (api-gateway/web). LOCAL no-key path = deterministic grounded narrator behind the gateway contract (prod flips to Haiku by config) — stated explicitly.

**verify-the-verifier (Stage 6, killed mutant on disk):** injected a hallucinated ₹9.9L (990000) into the narration → the BFF faithfulness gate REJECTED the whole response at the wire (`CF-S9-FAITHFULNESS-1 VIOLATION ... 990000 NOT in the deterministic signal set`); reverted byte-clean. The faithfulness gate caught a real phrasing bug during build too ("CM3 lands"/"CM2 line" → phantom lakh matches; regex hardened + narration rephrased). Gates are real, not no-ops.

**Tests:** api-gateway 151 (+17 net-new insights) + web 41 + lib-metrics 166 (no regression — parity surface untouched) + faithfulness golden-set 13 (+3), all green. Live smoke (real network :3009/:3001): insights.forPage → paradigm small_llm, faithfulness_ok true, 3 grounded narrations (₹3.2L CM2 / ₹6.5L ad spend / ₹18.5L realized / 18% RTO); /pnl HTTP 200; client bundle contains InsightStrip + insights.forPage query.

**Pre-existing harness quirk (NOT a slice-9 defect, flagged for Founder):** the intelligence-service `pnl_eval.py` imports via `src.domain.*`; under a monorepo-wide pytest the `src` namespace collides with analytics-service/src. The eval LOGIC is proven green (ran with the collision excluded). Recommend a follow-up to normalize the eval's import path to `domain.*` (matching the rest of the service) — tracked, non-blocking.

**Deferred (non-goals):** narration on other pages beyond /pnl (the seam is page-parameterized — store/dashboard enumerated, /pnl wired); chat (5b); Morning-Brief Pattern-B fan-out (5b); real Haiku live call (config flip at Stage 8 cutover); action graduation (recommendation-only held).

**Progress: slices 1-9 DONE (9/9). 🎉 epic-phase2-feature-parity is FUNCTIONALLY COMPLETE — Brain is at functional parity with the legacy backend. The HELD Child-7 layer-cutovers are now flippable.** Nothing committed; Founder commits via pending-founder-commit.md, then drives the cutover sequence.

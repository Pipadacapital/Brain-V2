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

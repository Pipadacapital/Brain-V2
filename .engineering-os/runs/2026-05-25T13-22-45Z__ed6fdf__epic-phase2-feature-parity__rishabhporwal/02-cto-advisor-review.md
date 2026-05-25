# CTO Advisor Review — Stage 1 intake (EPIC decomposition)

| Field | Value |
|-------|-------|
| **req_id** | `epic-phase2-feature-parity` |
| **Stage** | 1 (intake / brainstorm) |
| **Timestamp** | 2026-05-25T13:22:45Z |
| **Decision** | **ADVANCE (as a ratified EPIC; first slice filed; build held for Founder visibility)** |

> The Founder asked for a ratified decomposition + the first slice's requirement, NOT a build hand-off. So the operative verdict is: **ADVANCE the epic frame + slice-1 spec to the Founder for ratification.** No persona round-trip blocks this (1 persona requested for the cost-paradigm dimension; synthesis below is provisional and re-affirmed at the orchestrator re-invoke). I do NOT spawn build.

---

## Framing & challenge (deliverable #1)

### Is "port all ~40 endpoints" the right Phase-2 scope? — PARTIALLY. Reframed, not rejected.

The Founder's instinct (breadth parity with legacy) is **correct and necessary** — the 30 scaffolded pages are dead until their backends exist, and the HELD layer-cutovers can't flip until Brain is at functional parity. But "port all 40 endpoints" as a *unit of work* is the canon's #1 anti-pattern (big-bang) in disguise. Three reframes:

1. **This is not a new epic — it is the BREADTH phase of the existing migration epic.** `chore-migrate-legacy-to-brain` decomposed by *architectural layer* (depth): each of the 7 children proved one layer (RLS, money, connectors, metric-engine/OLAP, AI, frontend) works end-to-end for a thin vertical slice. Phase 2 decomposes the SAME program by *feature* (breadth) on top of those layers. I am filing `epic-phase2-feature-parity` as a child-epic of `chore-migrate-legacy-to-brain`, and **reusing the Child-0 A1.2 capability map** (which already routes every legacy route-group → target Brain service) rather than re-deriving it. This is a deliberate anti-rework decision.

2. **The 40 endpoints are not 40 independent slices — they are ~9 dependency-ordered feature clusters sitting on ONE shared fact layer.** pnl, waterfall, cohorts, ltv, acquisition, rto, cod, pincode, distributions, timings, products all read from the same canonical `orders / line_items / order_costs / shipments` ClickHouse facts derived from the Shopify+Shiprocket+ads connectors. **Slice 1 MUST be that shared fact layer** — building any analytics feature before it would mean building the fact layer 9 times or coupling features to legacy reads. Foundation-first is not a preference here; it is forced by the data dependency.

3. **The dominant epic risk is NOT "can we port the SQL" — it is paradigm discipline at breadth.** Child-0 already answered (M-A1-Q1) that the daily-metrics rollup needs **zero ML — pure SQL**. The unit-economics threat is the **AI/insights surface**: the legacy AI engine narrates ~13 page-level "insights" via a direct LLM SDK (Opus/Sonnet hardcoded + an Ollama path). If Phase 2 ports those naively, the %-of-GMV pricing model breaks. The discipline rule for the epic: **every ported feature is SQL unless a persona-tested case proves ML/LLM is genuinely required**, and the "insight narration" surface is the LAST cluster, gated by the cost persona. (See the ai-cost-realist persona, requested below.)

### The real risks (named, with where each is owned)

| Risk | Severity | Owner / mitigation |
|---|---|---|
| **Paradigm drift at breadth** — porting LLM-narrated legacy insights as frontier-LLM, blowing %-of-GMV economics | HIGH | ai-cost-realist persona (Stage 1) + `@paradigm` CI gate per feature + insight cluster sequenced LAST |
| **Metric-engine TS↔Python parity at breadth** — ~40 features add many metric defs; each is a parity gate; legacy CM2 may be *definitionally* different from Brain's canonical | HIGH | Definitional-Delta Register (built Child 4) is reused; **definitional parity ≠ float equality** — any def-delta gets a registered sign-off, not a silent pass. Owned by Aryan (Stage 2 per slice) + Maya |
| **RLS on every new query** — legacy had ZERO RLS; every ported read must carry `workspace_id` + pass the ClickHouse query-gateway un-scoped-query rejection | HIGH | Foundation (Child 1) reused; per-slice Shreya VETO confirms 4-layer isolation on the new queries |
| **Money: Decimal/Float → BIGINT minor units** across ~85 legacy columns; FX poison (`pnl.ts:42-56` static EXCHANGE_RATES) | HIGH | Foundation (Child 2) reused; FX killed; parity compares primary-currency at fixed snapshot, exact-integer equality |
| **Per-service DB ownership / OLTP→OLAP** — features are analytical reads → ClickHouse, NOT new Postgres tables; join-heavy metrics (MER/aMER/CM2) = scheduled Python rollups, not MVs | MED | Aryan Stage-2 per slice; analytics-service owns CH; gateway → analytics via gRPC; no shared DB |
| **Legacy correctness assumed** — re-implementing a wrong legacy formula | MED | Read the lib module per slice; Maya numeric shadow-compare; def-delta register catches divergence |
| **Scope creep into Phase 3 (auto-execute) / Phase 4 (UAE)** | LOW | Explicit non-goals; recommend-only; India adapter only |

This is **not** a CHALLENGE-BACK (the requirement is sound, planable, and the Founder explicitly asked for a decomposition). It is an **ADVANCE with a reframe**: file as breadth-phase child-epic, foundation-first slice order, paradigm discipline as the governing constraint.

---

## Reuse audit (deliverable #2) — what Phase 1 already covers vs. net-new

Verified against the live tree, not prose. **The honest finding: Phase 1 built the *machinery* for all of this, but almost none of the *feature breadth*.**

| Capability | Phase-1 state (verified) | Phase-2 status |
|---|---|---|
| **Tenancy / RLS / auth** (4-layer) | Built Brain-native (Child 1/1a-1b) — RLS live+verified pattern, 5-role claim map, SET-LOCAL-under-txn-pool | **REUSE wholesale.** Every Phase-2 query inherits it. Net-new = applying it to each new query (Shreya per-slice). |
| **Money minor-units + parity harness** | Built (Child 2) — BIGINT MU, shared ROUND_HALF_EVEN TS↔Python, FX poison killed | **REUSE.** Net-new = converting each ported feature's money columns. |
| **Connector framework + cutover** | Built (Child 3) — 1 Connector interface, idempotent, raw→CH→Kafka fan-out, HELD at cutover | **REUSE the framework.** The fact-layer slice depends on connectors producing canonical facts. |
| **Metric registry + TS↔Python parity CI** | Built (Child 4) — ~12–17 defs, parity-gated, Definitional-Delta Register | **REUSE + EXTEND.** Net-new = the bulk of the ~40-feature metric defs land here. This is where most Phase-2 weight goes. |
| **OLTP/OLAP split + ClickHouse query gateway** | Built (Child 4) — query gateway rejects un-scoped queries; 2 migrations (`base_workspace_daily_metrics`, `mv_computed_ratios`) | **REUSE gateway.** Net-new = the canonical fact tables (orders/line_items/order_costs/shipments) + per-feature rollups/MVs. |
| **AI engine / LLM gateway / @paradigm / Decision Log** | Built (Child 5) — gateway client, @paradigm decorator runtime, 5 VETO gates, 1 agent path | **REUSE gateway + decorator.** Net-new = the page-level insight narration surface (sequenced LAST, cost-gated). |
| **Frontend shell + 30 pages** | Built (Child 6) — shadcn shell, 31 routes, `/dashboard` wired to `metrics.kpiSummary`; 30 pages are scaffolds | **REUSE shell.** Net-new = wiring each page to its real tRPC procedure as its slice ships. |
| **tRPC BFF** | 9 live procedures (auth/workspace/metrics/morningBrief/device) | **EXTEND.** Net-new = ~one procedure-group per feature cluster. |
| **analytics-service application/domain layer** | **EMPTY** — only bootstrap + query_gateway; NO use-cases | **NET-NEW — the bulk of Phase 2.** Every feature query is a new use-case here. |
| **The ~40 feature computations themselves** (pnl/cohorts/ltv/rto/cod/acquisition/…) | **NONE exist Brain-native** (the `metrics.pnlWaterfall` procedure is a thin slice, not the full pnl feature) | **NET-NEW — the entire point of Phase 2.** |

**Net:** ~90% of the *plumbing* is reused; ~90% of the *feature surface* is net-new. Do NOT rebuild any foundation. Do build all the use-cases + metric defs + tRPC procedures + page wiring.

---

## Foundation-first decomposition (deliverable #3) — prioritized slice sequence

The FOUNDATIONAL data layer everything depends on is **Slice 1**. After it, slices are ordered by (a) dependency, (b) honest-CM2 business value, (c) what unblocks the most pages.

| # | Slice | Legacy endpoint(s) + lib module | Target Brain service | Metric-registry entries (TS↔Python parity) | tRPC procedure(s) | Frontend page(s) lit | Dominant @paradigm |
|---|---|---|---|---|---|---|---|
| **1** | **Shared store/order fact layer + revenue ladder** (the foundation) | `routes/workspaces/{store,shopify-analytics,bootstrap,context}` + `lib/shopify`, `lib/workspace-metrics/compute-daily.ts` | ingestion (canonical facts) → analytics (registry+CH) | revenue ladder: gross_sales_mu, net_sales_mu, net_sales_net_tax_mu (per-SKU GST slab), net_revenue_mu, realized_revenue_mu; order_count, aov_mu | `store.summary`, `store.revenueLadder` | `/store` (+ feeds `/dashboard`) | **SQL** |
| **2** | **Honest P&L + CM waterfall** | `routes/workspaces/{pnl,waterfall}` + `lib/pnl`, `lib/cogs` | analytics | cm1_mu, cm2_mu, cm3_mu (+ RTO/refund provisions), cogs_mu, marketing_spend_mu; **CM2 def-delta check vs legacy** | `pnl.waterfall`, `pnl.summary` | `/pnl`, `/waterfall` | **SQL** |
| **3** | **RTO + COD/prepaid economics** | `routes/workspaces/{rto-analytics,cod-prepaid-analytics,logistics,pincode-intelligence}` + `lib/workspace-metrics/{rto-*,cod-prepaid-*,logistics-*,pincode-*}` | analytics | rto_rate_bp, rto_cost_mu, cod_realization, breakeven_cod_rto_rate (r*=M/(M+C)), pincode_reliability | `logistics.rto`, `logistics.codPrepaid`, `logistics.pincode` | `/rto-analytics`, `/cod-prepaid`, `/logistics`, `/pincode-intelligence` | **SQL** (pincode reliability ≥5 shipments = SQL; risk-scoring is later ML if proven) |
| **4** | **Marketing efficiency: MER/aMER/CAC + acquisition** | `routes/workspaces/{acquisition,distributions}` + `lib/acquisition`, `lib/metrics` | analytics (scheduled rollup — join-heavy) | mer, amer, pamer, cac_mu, cac_payback, new_customer_revenue_mu | `marketing.acquisition`, `marketing.distributions` | `/acquisition`, `/distributions` | **SQL** (scheduled Python rollup, not MV) |
| **5** | **Cohorts + LTV** | `routes/workspaces/{cohorts,lifetime-value}` + `lib/cohorts`, `lib/ltv` | analytics | cohort_retention, cohort_cumulative_cm2_mu, ltv_mu, ltv_cac_ratio | `cohorts.matrix`, `ltv.summary` | `/cohorts`, `/lifetime-value` | **SQL** (LTV projection = ML only if persona-proven; default SQL cumulative) |
| **6** | **Catalog/inventory + first-product cascade** | `routes/workspaces/{products,inventory,first-product-cascade}` + `lib/products` | analytics | product_revenue_mu, sku_cogs_coverage, first_product_repeat_rate, inventory_cover_days | `catalog.products`, `catalog.inventory`, `catalog.firstProductCascade` | `/products`, `/inventory`, `/first-product-cascade` | **SQL** |
| **7** | **Finance settings: COGS/costs/goals/festivals/calendar** | `routes/workspaces/{cogs-settings,costs,misc-expenses,founder-salary,goals,festivals,campaign-classifications,marketing-actions,order-tags,calendar-report}` + `lib/festivals`, `lib/cogs` | core (settings/goals) + analytics (festival lift, calendar) | goal RAG status, festival_lift_factor; settings are CRUD not metrics | `settings.cogs`, `settings.costs`, `goals.*`, `festivals.*`, `calendar.report` | `/costs`, `/settings/goals`, `/settings/festivals`, `/calendar`, `/settings/ad-campaigns` | **SQL** (festival learned lift = SQL/statistical; ML only if proven) |
| **8** | **Lifecycle + timings + email/SMS performance** | `routes/workspaces/{customer-lifecycle,timings,email-sms-report}` + `lib/timings`, `lib/email-performance` | analytics | customer_state (RFM), best_send_time, email_revenue_mu, email_cm2_mu | `lifecycle.states`, `lifecycle.timings`, `lifecycle.emailSms` | `/customer-lifecycle`, `/timings`, `/email-sms` | **SQL** (RFM = SQL; response modeling = ML only if proven) |
| **9** | **Page-level AI insight narration** (the cost-gated cluster) | `module/ai-engine/{pipeline,context-adapters×13,prompts/page×13}` + `lib/{insights,ai-calc}` | intelligence | none — narration over already-computed metrics; signals (anomaly/spike/trend) = SQL/statistical per Child-0 M-A1-Q3 | `insights.forPage` (SSE) | overlays on all pages | **small_llm** for narration; **SQL/ML** for the signals it narrates — NEVER frontier-LLM per page (cost-realist gates this) |

**Sequencing rationale:** Slice 1 is forced (shared fact layer). Slices 2–3 deliver the highest honest-CM2 value (P&L truth + RTO/COD — the single largest controllable Indian-D2C margin leak). 4–5 are the marketing/retention economics. 6–8 round out the workbench. 9 is LAST and cost-gated because it's the only paradigm-risk cluster and depends on everything above being computed deterministically first.

**Each slice runs the FULL high-stakes pipeline** (Aryan plan → Maya/Vikram build → Shreya security → Tanvi QA → my Stage 6 → Founder gate) and ends in a real data-backed page. Each slice files as its own `/requirement` (child of this epic) when the prior slice's foundation it depends on is shipped — same dependency discipline as the layer-children.

---

## Slice 1 spec (deliverable #4) — ready for Aryan's Stage 2

**req_id (to file):** `feat-store-order-fact-layer` (child of `epic-phase2-feature-parity`; blocks: the Phase-1 foundations Child 1/2/3/4, all shipped/held)

**Problem:** No canonical order/store fact layer exists Brain-native; the `/store` page is a scaffold and `/dashboard` reads a thin `metrics.kpiSummary` slice. Every downstream analytics feature (pnl, cohorts, ltv, rto, cod, acquisition) needs this shared fact layer first.

**Smallest safe reversible thing that ships a real page end-to-end:**
- **Ingestion → canonical facts:** materialize canonical ClickHouse facts (`orders`, `line_items`, `order_costs`) for ONE workspace (the Sugandh Lok anchor brand) from the already-built connector framework's raw Shopify facts — additive, read-only, reversible (drop the derived tables).
- **Metric registry (TS↔Python parity):** add the **revenue ladder** defs — `gross_sales_mu`, `net_sales_mu`, `net_sales_net_tax_mu` (per-SKU GST 2.0 slab via the India RegionAdapter — never blended), `net_revenue_mu`, `realized_revenue_mu` (survives cancel/RTO/refund — the honest billing base), plus `order_count`, `aov_mu`. Each computed identically TS/Python, CI parity-green. Run the legacy `compute-daily.ts` revenue numbers through the Definitional-Delta Register — if any def differs, register the delta (don't silently match floats).
- **analytics-service use-case:** first real application-layer query (`StoreSummaryQuery`) reading CH through the query gateway with a mandatory `workspace_id` predicate.
- **tRPC:** `store.revenueLadder` + `store.summary` (workspaceProcedure; minor-units bigint over superjson; cursor pagination).
- **Frontend:** wire `/store` to render the live revenue-quality strip (Gross → Net → Net-of-tax → Realized) for the anchor brand, with data-freshness label.

**Acceptance bar (binding inputs for Aryan/Shreya/Tanvi):**
- RLS proven: un-scoped query rejected by the gateway; context-less = ZERO rows; cross-workspace isolation tested.
- Money exact-integer minor units; per-SKU GST extraction (not blended); FX poison absent.
- Metric registry TS↔Python parity CI green; any legacy def-delta registered.
- `@paradigm("sql")` on the query; zero LLM/ML in this slice.
- Real-network smoke PASS: `/store` renders real anchor-brand data end-to-end.
- Reversible: derived CH tables droppable; no legacy edit; zero behavior change to legacy.
- Correlation-ID 4-tuple end-to-end; Decision Log N/A (read-only analytics, no recommendation/action this slice).

---

## Recommended build cadence (deliverable #5)

**Assembly-line, one slice at a time, through the full high-stakes pipeline.** For each slice:

1. Founder files (or I file on ratification) the slice as a `/requirement` child of this epic.
2. Rohan Stage 1 (lane = high-stakes inherited; 0–1 persona — most slices are SQL-only so likely 0; slice 9 gets ai-cost-realist).
3. Aryan Stage 2 binding plan (reusing the A1.2 mapping + the relevant foundation child).
4. Maya/Vikram Stage 3 build (analytics use-case + metric defs + tRPC + page wiring), trace-instrumented.
5. Shreya Stage 4 (RLS/4-layer isolation + PII + compliance VETO).
6. Tanvi Stage 5 (real-network smoke + TS↔Python parity + trace IDs).
7. Rohan Stage 6 (drift + paradigm audit + over-engineering + independent gate re-run; VETO).
8. Founder gate Stage 7 (`/approve`; I sign on delegation where no hard-rule deviation) → Stage 8 readiness; **nothing committed without Founder "commit it".**

**Each slice ends in a real, data-backed, live page.** No slice starts until its data-dependency slice is shipped. This protects the no-big-bang guarantee and gives every slice an honest parity gate — exactly the discipline the layer-children used, now applied to breadth.

**On completion of all 9 slices:** Brain is at functional parity → the HELD layer-cutovers (Child 7 decommission) become flippable.

---

## Made requirements less dumb first

**Could delete:**
- The notion of a *separate* Phase-2 epic — folded into the existing migration epic as its breadth phase (no duplicate decomposition, reuse A1.2).
- Re-deriving the legacy→Brain capability map — Child-0 A1.2 already did it authoritatively.

**Could simplify:**
- 40 endpoints → 9 dependency-ordered feature clusters on 1 shared fact layer.
- Slice 1 scoped to ONE anchor workspace (Sugandh Lok), additive/reversible, not all-tenants.

**Could defer:**
- The AI insight-narration cluster (slice 9) — the only paradigm-risk surface — deferred to LAST and cost-gated.
- LTV projection / RFM response-modeling ML — default to SQL; graduate to ML only when a persona proves rules don't suffice.
- The HELD cutovers/decommission (Child 7) — gated on parity, not part of this build.

---

## Persona-count decision

**Count chosen: 1.** Rationale: per the complexity classifier, a single risk dimension dominates this EPIC's net-new surface — **cost/paradigm discipline at breadth** (the one dimension that can break %-of-GMV unit economics and that Child-0 explicitly deferred for the AI/insight surface). The other big dimensions (RLS, money, metric parity) are NOT net-decided here — they were resolved by the layer-children and are reused; re-spawning personas for them would duplicate settled work. I declined a 2nd persona (a generic migration/architecture persona) because the strangler sequence + A1 mapping is already bound by Child-0's two personas, and structure-correctness is Aryan's Stage-2 job.

**Persona spawned:** `ai-cost-realist:sonnet` — reasoning-heavy (paradigm mix + unit economics across a ~40-feature surface; the legacy LLM-narration port; whether any ported metric/insight genuinely needs ML/LLM vs SQL). Tagged `:sonnet` (not `:haiku`) because it is multi-step unit-economics reasoning, not a bounded checklist.

> Within the high-stakes cap (2). One persona, one dominant net-new dimension. If I wanted a 2nd, the epic would be too broad — but it isn't; it's the well-understood breadth of an already-decomposed program.

---

## Paradigm recommendation

**Recommended paradigm:** `sql` (epic-dominant)

**Why:** Per Child-0 M-A1-Q1, every metric in the daily-metrics surface is deterministic SQL — no ML required. The 40 features are overwhelmingly deterministic aggregations over structured facts. ML enters only where a pattern exists but rules don't (LTV projection, RTO risk-scoring, response modeling) — and only when a persona proves it; default SQL. small_llm enters ONLY at the human-language boundary (slice-9 insight narration). frontier_llm appears NOWHERE in Phase 2 except the existing Morning-Brief synthesis step (already built, not re-touched). **Target mix holds: ~85% SQL.**

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | Slice 3 core — RTO rate/cost/break-even r*=M/(M+C); honest CM2 must subtract RTO provision. The single largest controllable Indian-D2C margin leak. |
| **COD** | Slice 3 — COD vs prepaid realization + RTO economics; COD RTO 20–35% vs prepaid ~2–8%. |
| **GST** | Slice 1 + 2 — Net-of-tax extracted **per line item by SKU GST 2.0 slab (0/5/18/40)** via the India RegionAdapter, NEVER blended. Anti-pattern guard. |
| **Festival seasonality** | Slice 7 — festival lift factors (learned, SQL/statistical not ML by default). |
| **Pincode reliability** | Slice 3 — pincode scoring ≥5 shipments, SQL. |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | Not triggered by Phase-2 read/analytics surface (no outbound channel). Slice 9 narration is in-app, not a channel send. Lifecycle SENDS (WhatsApp/SMS) are a future phase, not this breadth port — flagged so no slice silently adds an outbound channel without re-triggering compliance review. |

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T13:22:45Z",
  "actor": "cto-advisor",
  "type": "epic-decomposition",
  "req_id": "epic-phase2-feature-parity",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "needs_personas": ["ai-cost-realist:sonnet"],
  "rationale": "Phase 2 = the breadth phase of the migration epic; reframe 40 endpoints into 9 dependency-ordered clusters on 1 shared fact layer; foundation-first slice-1 = store/order fact layer + revenue ladder; reuse all Phase-1 plumbing, build the feature surface; paradigm discipline (SQL-dominant) is the governing constraint; assembly-line cadence; build held for Founder ratification."
}
```

# CTO Advisor Review — Stage 1 (Phase 2, slice 6) — feat-catalog-inventory

| Field | Value |
|-------|-------|
| **req_id** | `feat-catalog-inventory` |
| **parent_epic** | `epic-phase2-feature-parity` (slice 6 of 9) |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-25T15:46:22Z |
| **Decision** | **ADVANCE → Stage 2 (Aryan)** with a binding reconciliation mandate + slice-table correction |
| **feature_class** | high-stakes (inherited from epic; trigger surfaces below) |
| **Dependency** | blocks `feat-store-order-fact-layer` (slice 1) — verified `approved`/stage-8. PRE-FLIGHT PASS. |

---

## Lane decision

- **feature_class:** `high-stakes` (inherited from the ratified epic, re-confirmed by trigger-surface scan).
- **feature_class_rationale:** trigger surfaces touched → `money` (per-SKU CM1, COGS, refunds, AOV in BIGINT minor units), `multi-tenancy` (every CH read carries `workspace_id`; gateway rejects unscoped), `schema-proto` (new tRPC procedures + new DataPlanePort methods + new registry defs). On any of these the lane is high-stakes; conservative tie-break never applies (multiple hard surfaces present).
- **trigger_surfaces_touched:** `["money","multi-tenancy","schema-proto"]`
- **Stages that run:** full high-stakes pipeline — S1 (me) → S2 (Aryan) → S3 (Maya+Vikram+Ananya) → S4 (Shreya) → S5 (Tanvi) → S6 (me, VETO) → S7 Founder gate (signed under standing delegation absent a hard-rule deviation).

---

## The standing lesson applied a 6th time — I READ THE ACTUAL LEGACY FORMULAS

Per the candidate rule `verify-legacy-formula-at-stage1-not-slice-table` (now 5 catches; this is #6), I read the real legacy modules at Stage 1, NOT the slice-table shorthand. **The slice-table row for slice 6 is WRONG on all three features.** The corrections below are BINDING inputs for Aryan — build to the legacy formula, not the slice-table label.

### Legacy sources read (reference-only; never edited/imported)
- `legacy project/backend/src/routes/workspaces/products.ts` + `src/lib/products/compute.ts` (52KB) + `src/lib/products/types.ts`
- `legacy project/backend/src/routes/workspaces/first-product-cascade.ts` + `src/lib/metrics/first-product-cascade.ts`
- `legacy project/backend/src/routes/workspaces/inventory.ts` (55KB) + `src/lib/inventory-constants.ts`

### Finding 1 — Products is CM1, NOT "per-SKU CM2"
The slice-table says "per-SKU contribution/CM" / `product_revenue_mu` / `sku_cogs_coverage`. **The legacy product-level metric is CM1, and there is NO per-SKU CM2.**
```
revenue = sales − refunds
cm1     = revenue − cogs − variableCost          (compute.ts:696)
cm1Pct  = revenue>0 ? cm1/revenue × 100 : 0
cm1Total= totalCm1≠0 ? cm1/totalCm1 × 100 : 0
```
- `variableCost` = per-order shipping/packaging/website/custom (daily-derived), allocated to the line by `lineSales/orderSales` (compute.ts:485). COGS allocated the same way.
- There is **no marketing/ad-spend allocation per SKU** → no CM2 at SKU grain. Anyone who builds `sku_cm2_mu` is building a phantom. **DECOMMISSION on sight** if Child-4 pre-built one.
- Refund source-of-truth: `shopify_refund_line_items` (exact qty + amount per line); daily `total_returns` allocation is the FALLBACK only.
- New-customer (`nc`) vs existing (`ec`) split is per-order, tracked as `Set<orderId>`; `ncRevenue`/`ecRevenue` decrement by refund.

### Finding 2 — Pareto grade is a CUMULATIVE-CM1 walk, not a naive top-N
```
F = cm1 < 0
else rank by CM1 desc among POSITIVE-cm1 rows; cumPct = runningCumPositiveCm1 / totalPositiveCm1 at this row's rank:
  cumPct ≤ 0.80 → A ;  ≤ 0.95 → B ;  else C        (compute.ts:165-180)
totalPositive ≤ 0 → C
```
This is a non-trivial ordering-dependent classifier. **Parity must anchor the boundary** (a row that lands exactly at 0.80 / 0.95) — a mutant that uses simple percentile ranking must be KILLED.

### Finding 3 — Inventory: legacy has sellThrough + daysLeft, NOT "turnover" + "days-of-cover"
The slice-table says `inventory turnover / days-of-cover / inventory_cover_days`. **Legacy has NO turnover ratio (COGS/avg-inventory).** It has two distinct primitives (`inventory-constants.ts`):
```
daysLeft (days of cover) — velocity-window CASCADE, first non-zero wins:
  currentInventory ≤ 0 → 0
  avgDailySales = qtyL30/30 (if >0) else qtyL90/90 else qtyL180/180 else qtyL360/360
  avgDailySales ≤ 0 → 999999 (INFINITE sentinel: stock but no recent velocity)
  else → round(currentInventory / avgDailySales)

sellThrough (%) = round( sales365 / (sales365 + currentInventory) × 1000 ) / 10   (1-decimal)
  denom ≤ 0 → 0

status (classifyInventoryStatus, priority order):
  qty ≤ 0            → Out of stock
  daysOfStock < 21   → Restock Soon
  daysOfStock ≥ 365  → Severely Overstocked
  daysOfStock ≥ 180  → Overstocked
  else               → Healthy
```
The L30→L90→L180→L360 cascade is the load-bearing subtlety. **Parity anchors must include (a) a SKU where L30=0 but L90>0 (cascade falls through), and (b) a SKU with stock and zero velocity → 999999.** A "always use L360" mutant must be KILLED.

### Finding 4 — First-product cascade LTV is REVENUE, NOT CM2/CM3
The slice-table says `first_product_repeat_rate`. Legacy (`first-product-cascade.ts`):
```
cohort = customer whose FIRST included order processedAt ∈ [from,to]
primary first product = top line by: lineRevenue (price×qty) DESC,
                        then productShopifyId ASC (null-last sentinel ￿),
                        then lineItemId ASC   (deterministic tie-break)
observationEnd = endOfDay(to) + observationDaysAfterTo (default 365)
orderCount = included orders from firstOrder onward through observationEnd
secondOrderRate  = 100 × (#cust ≥2 orders) / cohortSize     (PERCENT 0-100)
thirdOrderRate   = 100 × (#cust ≥3) / cohort
fourthPlusRate   = 100 × (#cust ≥4) / cohort
additionalOrderRate = sum(max(0, orderCount−1)) / cohortSize   (mean EXTRA orders)
averageLtv = mean over cohort of sum(totalPrice) across orders   ← REVENUE ONLY, NO CM
averageDaysToSecondOrder = mean calendar days first→second (≥2-order custs), else null
```
**Critical de-conflation:** this `secondOrderRate` is NOT the slice-5 `repeat_rate_bp` (which is rr90 = repeat-within-90d / new-customers). The cascade repeat is "≥N lifetime orders within a long observation window, bucketed by FIRST PRODUCT." Do NOT reuse `repeat_rate_bp` for it — that conflation would silently wrong-window the metric. The cascade is a per-first-product cohort table with its own deterministic primary-product tie-break.
- LTV here is **revenue (totalPrice sum)**, not CM2/CM3 — register the DDR delta vs Brain's honest-CM convention (legacy's v1 cascade LTV is admittedly revenue-only per its own module doc).

---

## Slice-table correction (binding)

| Slice-table label | Legacy reality (build THIS) |
|---|---|
| per-SKU CM2 / `sku_cogs_coverage` | **CM1** = (sales−refunds) − cogs − variableCost; `cm1_pct`, `cm1_total`; NO SKU-grain CM2 |
| `inventory turnover` | **does not exist** — drop. Real: `inventory_sell_through_bp` |
| `inventory_cover_days` / days-of-cover | **`inventory_days_left`** — velocity-cascade L30→L90→L180→L360, 999999 sentinel |
| `cascade repeat-rate` (≈ `first_product_repeat_rate`) | **`first_product_second_order_rate_bp`** (≥2 lifetime orders / cohort, observation-windowed, per-first-product) — NOT slice-5 rr90 |

---

## Net-new metric-registry defs (TS↔Python byte-identical, parity-green, NON-VACUOUS anchors)

**REUSE-FIRST (Single-Primitive Rule):** product CM1 = `(sales−refunds) − cogs − variableCost`. At product grain, `revenue = sales − refunds` IS the net-revenue rung, so this is **algebraically byte-identical to the existing `cm1_mu`** (`net_revenue_mu − cogs_mu − variable_costs_mu`, definitions.ts:166). I **REUSE `cm1_mu`** for product CM1 — building a `product_cm1_mu` would be a phantom duplicate. `aov_mu` is likewise REUSED for the product/nc/ec AOV columns. Net-new is therefore **3 defs** (not 4):

1. **`inventory_sell_through_bp`** (ratio, bp, scale 10000) — `if (sales365+inv)>0, intDiv(sales365×10000, sales365+inv), NULL`. NOTE: legacy returns 1-decimal percent; Brain canonical is **bp** (×100 of legacy) → register the **scale DDR delta** (no silent float match). Anchor: sales365=300, inv=100 → 7500bp; a "÷inv only" mutant KILLED.
3. **`inventory_days_left`** (scalar days) — the velocity-cascade. parity_class `correctness_fixture`. Anchor A: L30=0,L90=90,inv=30 → avgDaily=1 → 30; Anchor B: inv=50, all windows 0 → 999999. "always L360" mutant KILLED on Anchor A.
4. **`first_product_second_order_rate_bp`** (ratio, bp, scale 10000) — `if cohort>0, intDiv(custWith2plus×10000, cohort), NULL`. parity_class `shadow_compare` (legacy emits percent 0-100; Brain bp; register DDR scale delta). Anchor: 3 of 8 cohort have ≥2 → 3750bp; a "÷ orders not customers" mutant KILLED.

`pareto_grade` (Finding 2) is a **classifier over the cm1 set**, not a single-row formula → I recommend it live as a registry-traceable function in the analytics use-case with its OWN locked-canon anchor (boundary at 0.80/0.95), not as a scalar `MetricDefinition`. Aryan to rule.

> All money exact-integer BIGINT minor units (paise). No FX poison (legacy products/inventory don't carry static EXCHANGE_RATES, but Aryan must confirm none sneaks in via a currency join). per-SKU GST stays per-SKU — these features do NOT blend tax; they sit on the slice-1/2 honest revenue base.

## Analytics-service use-cases (net-new, fail-closed)
- `ProductPerformanceQuery` (CM1 table + pareto + nc/ec return rates + AOV; groupBy product/variant/collection/vendor/type/tags; search; sort; cursor/offset pagination — mirror legacy column set).
- `InventoryLevelsQuery` (per-SKU on-hand, daysLeft, sellThrough, status; variant + product grain).
- `FirstProductCascadeQuery` (cohort by deterministic primary first product; observation window param 30–730 default 365; second/third/fourth+ rates, additionalOrderRate, averageLtv revenue, avgDaysToSecond).
- Each: `query_metrics(workspace_id, …)` choke; falsy workspace_id → `UnscopedQueryError`. @paradigm("sql"). Integer-only math.

## tRPC (extend `router.ts`, new `catalog` router group)
- `catalog.products` (workspaceProc, requireRole ANALYST, dateInput + groupBy/sort/dir/search/page/pageSize).
- `catalog.inventory` (workspaceProc, ANALYST, optional grain=product|variant, sort, status filter).
- `catalog.firstProductCascade` (workspaceProc, ANALYST, dateInput + observationDays).
- New `DataPlanePort` methods `getProductPerformance` / `getInventoryLevels` / `getFirstProductCascade` (additive on the SAME port — CF-C6-DATA-SEAM-1) + `StubDataPlane`/loopback impls with `buildSugandhlok*` fixtures, workspace_id-gated (foreign workspace → UnscopedQueryError). New `assertCatalogDefinitionId` in `registry-mapper.ts`. bigint minor units over superjson.

## Frontend (wire 3 scaffold pages live)
- `/products` → CM1 product-performance table (pareto grade chip, cm1/cm1%/return-rate columns, sort, search, AOV), data-freshness label.
- `/inventory` → levels table (on-hand, days-left, sell-through%, status badge), reuse the legacy column semantics.
- `/first-product-cascade` → **reuse the legacy First Product Cascade table pattern** (rows = first product; second/third/fourth+ rate, additional-order rate, avg LTV, avg days-to-second), observation-window control.

## Acceptance bar (binding for Aryan/Shreya/Tanvi)
- TS↔Python parity CI green AND **NON-VACUOUS** (every anchor above kills a named mutant; no all-zero anchors).
- RLS fail-closed proven AT THE WIRE: foreign workspace → `UnscopedQueryError`; context-less = ZERO rows; cross-workspace isolation tested on all 3 new queries.
- Money exact-integer minor units; per-SKU GST never blended; FX poison absent.
- DDR deltas registered for the bp-vs-percent scale (sell-through, second-order-rate) and the revenue-only cascade LTV.
- `@paradigm("sql")` on every new query; ZERO LLM/ML this slice; ZERO new runtime deps unless Aryan justifies.
- Real-network smoke PASS: all 3 pages render real anchor-brand data; procedures return correct values; typecheck 0.
- Reversible/additive; no legacy edit; scope strictly slice 6 (NO settings/COGS CRUD — that's slice 7; NO WooCommerce path — defer).

---

## Persona-count decision

**Count chosen: 1.** Rationale (complexity classifier): a single risk dimension dominates the net-new surface — **numeric parity against a slice-table that is wrong on all three features** (CM1-not-CM2, sellThrough/daysLeft-not-turnover, observation-windowed cascade-rate-not-rr90, plus the ordering-dependent pareto classifier). This is the exact failure mode the standing lesson catches; it warrants an adversarial numeric persona to stress the anchors. The other big dimensions (RLS, money, tenancy) are RESOLVED foundations reused wholesale from the layer-children — re-spawning for them duplicates settled work. No second dimension is net-new here, so a 2nd persona would overshoot.

**Persona requested:** `catalog-inventory-numeric-parity-realist:sonnet` — reasoning-heavy (the pareto cumulative-walk boundary, the velocity-cascade fall-through, the cohort-windowed second-order-rate vs slice-5 rr90 de-conflation, the bp-vs-percent scale deltas). Tagged `:sonnet` not `:haiku` because it is multi-step numeric reasoning across 4 formulas + a classifier, not a bounded checklist.

> Within the high-stakes cap (2). One persona, one dominant net-new dimension. I do NOT spawn — I return `needs_personas` in the HANDOFF; the orchestrator spawns and re-invokes me to synthesize.

---

## Paradigm recommendation

**`sql`** (epic-dominant, confirmed). All four metrics + the pareto classifier + the cascade cohort walk are deterministic integer aggregations over structured facts. No pattern that rules can't express → no ML. No human-language boundary → no LLM. Mix holds.

---

## India context check

| Lens | Impact |
|------|--------|
| **GST** | Products/inventory sit on the slice-1/2 honest revenue base; tax stays per-SKU GST 2.0 (0/5/18/40), NEVER blended. These features add no tax blending. |
| **RTO/COD** | Not re-computed here (slice 3 owns it); but cascade LTV uses `totalPrice` (revenue) — flagged as a DDR delta vs honest-CM convention so it's not mistaken for margin. |
| **Telecom (DLT/NCPR/calling-hours)** | Not triggered — read/analytics only, no outbound channel. No slice-6 surface sends. |
| **Festival seasonality** | Inventory velocity windows (L30–L360) will be festival-skewed; that's legacy-faithful behavior, not a slice-6 correction. Noted for slice-7 festival lift. |

---

## Made requirements less dumb first
- **Delete** the phantom `sku_cm2_mu` / `inventory turnover` notions from the slice-table (no legacy comparand).
- **Simplify**: reuse slice-1..5 plumbing wholesale (query gateway, RLS, money harness, registry pattern, tRPC `workspaceProc`/ANALYST, DataPlanePort seam, scaffold-page shell). Net-new = 3 use-cases + 4 defs + 1 classifier + 1 router group + 3 page wirings.
- **Defer**: WooCommerce products/cascade path; products CRUD/settings (slice 7); AI narration (slice 9); risk-scoring ML (none proven).

---

## Decision

**ADVANCE** → Stage 2 (Aryan), pending the 1-persona synthesis round-trip (orchestrator spawns `catalog-inventory-numeric-parity-realist:sonnet`, then re-invokes me to synthesize before Aryan).

## Decision log entry (mirrored)
```json
{
  "ts": "2026-05-25T15:46:22Z",
  "actor": "cto-advisor",
  "type": "stage1-intake",
  "req_id": "feat-catalog-inventory",
  "parent_epic": "epic-phase2-feature-parity",
  "slice": 6,
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "trigger_surfaces_touched": ["money","multi-tenancy","schema-proto"],
  "needs_personas": ["catalog-inventory-numeric-parity-realist:sonnet"],
  "dependency_preflight": "feat-store-order-fact-layer approved/stage-8 — PASS",
  "rationale": "Slice 6 catalog/inventory/first-product-cascade. Standing lesson #6: read legacy formulas — slice-table wrong on all 3 (CM1 not per-SKU CM2; sellThrough+daysLeft not turnover; observation-windowed second-order-rate not slice-5 rr90; pareto cumulative-walk classifier). Reconcile not rebuild. SQL; reuse all foundations; 4 net-new defs + classifier + catalog tRPC group + 3 page wirings; NON-VACUOUS anchors; DDR scale + cascade-LTV-revenue deltas; RLS fail-closed."
}
```

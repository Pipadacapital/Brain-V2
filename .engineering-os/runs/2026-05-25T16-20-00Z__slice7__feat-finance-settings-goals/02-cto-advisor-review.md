# CTO Advisor Review — Stage 1 (Phase 2, slice 7) — feat-finance-settings-goals

| Field | Value |
|-------|-------|
| **req_id** | `feat-finance-settings-goals` (child of `epic-phase2-feature-parity`) |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-25T16:20:00Z |
| **Decision** | **ADVANCE** (full high-stakes pipeline on the current branch) |
| **feature_class** | high-stakes (inherited; write surfaces add money + role-gated mutation triggers) |
| **Lane** | high-stakes → Aryan S2 → Maya/Vikram/Ananya S3 → Shreya S4 (write-path scrutiny) → Tanvi S5 → Rohan S6 |

## Pre-flight dependency check
`blocks: [feat-store-order-fact-layer]` → status `approved`/stage 8 (shipped on branch). Also reuses slice-2 (cm1/cm2/cm3 + cogs), slice-4 (mer/amer/cac/new_customer_revenue). All shipped. **Dependency satisfied — proceed.**

## Persona-count decision
**Count: 0.** Rationale (classifier): this is a clear repeat of the prior 6 slice patterns (analytics use-case + registry def + tRPC + page wiring) on a settled foundation; the one *new* dimension — idempotent write surfaces — is already a solved pattern in-repo (`morningBrief.submitResponse`: Redis dedup + MANAGER gate + append-only). No single net-new risk dimension dominates that my own skills + canon don't cover. The compliance lens (telecom/PII) is NOT triggered (no outbound channel; settings are operator-edited config). I synthesize Stage 1 directly.

---

## STANDING LESSON APPLIED — read the ACTUAL legacy formulas (bit a 7th time)

I read `lib/metrics/goals.ts`, `lib/metrics/goal-metrics-registry.ts`, `lib/cogs/resolve.ts`, `lib/festivals/india-festival-calendar.ts`, `routes/workspaces/{costs,cogs-settings,goals,festivals,calendar-report}.ts`, and `lib/metrics/calendar-report.ts`. The slice-table shorthand was WRONG on the two headline features. Reconciled, not rebuilt:

### Finding 1 — Goal RAG is **DIRECTIONAL**, not the flat "≥95% green / 80-95% amber / <80% red"
Legacy `computeGoalRag(actual, goal, higherBetter)`:
- **higher-is-better:** `actual ≥ goal*0.95 → green ; ≥ goal*0.80 → amber ; else red` (the slice-table case).
- **lower-is-better:** `actual ≤ goal*1.05 → green ; ≤ goal*1.20 → amber ; else red` (INVERTED — the slice-table omits this entirely).

Direction resolved by `higherBetterForGoal(metricId, goalType)`: `MINIMUM → higher-better`, `MAXIMUM → lower-better`, `TARGET → GOAL_METRIC_REGISTRY[metricId].higherBetter`. CAC/ACOS are `higherBetter:false`. **A CAC at 120% of its goal is RED, not GREEN.** Shipping the flat rule would mislabel every lower-is-better goal — a correctness defect, not cosmetic.

**Existing `apps/web/src/interfaces/components/shared/rag-badge.tsx` carries the WRONG (flat) rule** in `getRagBand` and in its header comment. It is also colour+text but **icon-less** (slice prompt: "never colour-only — icon+label"). This is a slice-7 fix target: the RAG band must be computed server-side (BFF render-only rule already holds) using the directional formula and the badge must carry an icon + text label, not just colour.

### Finding 2 — Festival "learned lift" is a **PHANTOM** — DO NOT BUILD IT
Legacy festivals carry only a stored **`expectedMultiplier`** template default (1.3 Makar Sankranti … 4.0 Diwali) in `INDIA_FESTIVAL_TEMPLATES` + the `WorkspaceFestival` row. There is **NO learned-lift computation** anywhere in `lib/festivals` or the routes. The slice-table's and the task's "festival calendar + learned lift" describes a feature that does not exist in legacy. Per the decommission-phantoms rule (slices 4/5/6 precedent: pamer_bp, cac_payback_months, product_cm1_mu), **I will NOT introduce a `festival_lift_factor` metric def.** The festival surface = the India template calendar + the operator-editable `expectedMultiplier`/dates/regions/categories (display + CRUD), nothing learned.

### Finding 3 — Calendar Report is a **period grid with overlays**, NOT a festival surface
`computeCalendarReport` (+ the route's Woo branch) builds day/week/month rows of `{revenue, cm3, totalSpend, mer, amer, cac, aov, newCustomers}` **per period** with **marketing-action overlays** (manual `MarketingAction` rows + Klaviyo campaign sends) and per-cell goal RAG (`{actual, goal, rag}`). It composes the slice-1 revenue, slice-2 CM3, slice-4 MER/aMER/CAC primitives over calendar buckets. **No new metric def** — it reuses the canonical registry shapes. The "festival calendar" and the "calendar report" are two different pages (festivals = settings template; calendar = the marketing-action overlay grid).

### Finding 4 — COGS resolve is the **CM input** with a precise precedence
`resolveLineItemCogs`: if `overridePct>0` → `revenue*override/100`; else product `coq*qty` if `coq>0`; else `fallbackPct/100*revenue` if `fallbackPct>0`; else `0`; THEN `*(1+markup/100)` if `markup>0`. This is the SAME COGS that slice-2's `cm1_mu/cm2_mu/cm3_mu` already consume — so the settings write must flow into the **existing** CM path (Single source of truth), NOT a second compute. In this slice the settings are stored/echoed; the metric engine already reads them — we must NOT fork a parallel COGS calc.

---

## Scope decision (the write-vs-read call the task asked for explicitly)

The four pages split cleanly into **READ/report** and **WRITE/settings**. I am scoping this slice as follows, and stating the deferral explicitly per the task's permission:

**SHIP this slice (real, data-backed):**
1. `/costs` — READ: the resolved cost stack the operator sees (COGS settings echo: override/fallback/markup %, + the active `WorkspaceCost` rows: fixed/per-order/percent costs with effective windows) feeding CM. Display the COGS-precedence-resolved view + how it lands in CM1→CM2→CM3.
2. `/settings/goals` — READ + idempotent WRITE: list goals with **directional Goal RAG** (actual vs goal, correct band) AND `goals.upsert` (idempotent, MANAGER-gated, Zod-validated). Goal upsert is the highest-value write and is a small, well-bounded mutation — it ships here.
3. `/settings/festivals` — READ: the India festival template calendar + per-workspace festivals (name/window/expectedMultiplier/regions/categories), display-only this slice. The festival **seed/CRUD** write defers (see below).
4. `/calendar` — READ: the period grid (day/week/month) of revenue/cm3/spend/mer/amer/cac/aov with marketing-action overlays + per-cell directional RAG.

**DEFER (explicit, with reason):**
- **Festival CRUD** (`festivals.create/update/delete/resetDefaults`) — the festival surface is a large multi-field CRUD with a template-protection rule (`isTemplate` rows can't be deleted) and a 50+ row India seed. The READ/template-calendar view is the operator-visible value; the edit path is a follow-up. The page is REAL (renders the seeded India calendar + expected multipliers), not a scaffold.
- **Costs CRUD** (`costs.create/delete`, `cogsSettings.patch`) — the cost-stack EDIT (effective-window close-out + percent/fixed/per-order cost rows; ADMIN-gated) is a follow-up. `/costs` renders the REAL resolved cost stack + COGS settings the metric engine consumes; only the editor defers.
- **Marketing-action CRUD** — the calendar overlays are displayed (manual + Klaviyo); creating actions defers.

**Why this split:** Goal upsert is one bounded idempotent write that proves the write-path discipline (idempotency + RLS-on-write + role-gate + Zod) end-to-end this slice. The remaining CRUD (costs, festivals, marketing-actions) is broad surface that doesn't change a metric *correctness* contract and is honest to defer — the pages stay real (the READ views are data-backed, not stubs). This keeps the slice small/reversible while still lighting all four pages with real data.

---

## New registry definition — exactly ONE (directional, NON-VACUOUS)

Per the slice prompt ("new registry defs (goal attainment %, festival lift)") reconciled to legacy reality:
- **`festival_lift` → DECOMMISSIONED before birth** (Finding 2 — no legacy comparand; phantom). NOT added.
- **`goal_attainment_bp`** → ADD. Attainment of actual vs goal in basis points = `intDiv(actual*10000, goal)` (guard goal==0 → NULL). This is the magnitude the RAG band reads. The **direction-aware band** (`goal_rag` green/amber/red) is a classification computed in the use-case from `goal_attainment_bp` + the metric's `higher_better` flag + the goal's `goal_type` — it is a CLASSIFICATION, not a numeric metric def (same shape as inventory `status` / pareto `grade` in slice 6, which live in the use-case, not the registry). The numeric `goal_attainment_bp` carries the parity gate; the band logic carries NON-VACUOUS anchors at the boundary.

**NON-VACUOUS anchors (the killed-mutant the parity gate enforces):**
- `goal_attainment_bp`: actual=9200, goal=10000 → `intDiv(9200*10000,10000)=9200bp` (92.00%). A "wrong-denominator (÷actual)" mutant → 10000bp — KILLED.
- Directional band anchors (use-case, not registry): higher-better @ 9200bp/goal → **amber** (≥8000 <9500); lower-better (CAC) actual=12000 goal=10000 → 12000bp → **red** (>12000 boundary is `≤1.20*goal`=amber, so 12001 is red; 12000 is amber — anchor the boundary). A "treat-all-as-higher-better" mutant flips CAC@120% from red→green — KILLED at the band anchor.

DDR: `goal_attainment_bp` SIGNABLE (parity_gap:false, shadow_compare vs legacy `variancePct`-equivalent; child_dependency:None). The band classification is registered as a DDR note (classification, not a delta).

---

## Paradigm
`@paradigm("sql")` — deterministic integer aggregation + boolean classification. ZERO LLM/ML. ZERO new deps.

## India context
- **GST**: untouched — sits on slice-1/2 honest per-SKU base; COGS settings feed CM without re-blending tax.
- **Festival seasonality**: the India template calendar (Diwali 4.0× … Makar Sankranti 1.3×) is the real domain asset and is surfaced; expected multipliers are operator config, not a learned model.
- **Telecom/DPDP**: NOT triggered (no outbound channel, no new PII; goals/costs are workspace config).

## Acceptance bar (binding for Aryan/Maya/Shreya/Tanvi)
- `goal_attainment_bp` TS↔Python byte-identical, parity-green, NON-VACUOUS (killed wrong-denominator mutant). Directional band anchors (higher- AND lower-better) at the boundary — killed "all-higher-better" mutant.
- `goals.upsert` mutation: **idempotent** (idempotency_key + dedup like `morningBrief.submitResponse`), **RLS-scoped on write** (workspace_id from claim, fail-closed), **MANAGER role-gated**, **Zod-validated** (period/goalType/metricId enums; defense-in-depth).
- Settings writes flow into the EXISTING CM path — no second COGS source of truth.
- `/costs`, `/settings/goals`, `/settings/festivals`, `/calendar` render REAL Sugandh-Lok data (not scaffolds).
- Goal RAG badge: **icon + text label**, directional band, server-computed (a11y: aria-label, WCAG AA).
- RLS fail-closed proven at the wire (foreign workspace header → UnscopedQueryError) on every new read AND the write.
- per-SKU GST never blended; money exact integer minor units; typecheck 0; real-network smoke PASS.
- Deferred CRUD documented; deferred surfaces are real READ views, not stubs.

## Decision log (mirrored)
```json
{"ts":"2026-05-25T16:20:00Z","actor":"cto-advisor","type":"slice-intake","req_id":"feat-finance-settings-goals","parent_epic":"epic-phase2-feature-parity","stage":1,"decision":"ADVANCE","feature_class":"high-stakes","needs_personas":[],"slice":7,"rationale":"Goal RAG is DIRECTIONAL not flat (higher-better 0.95/0.8; lower-better 1.05/1.2) — slice-table wrong (7th catch); festival learned-lift is a PHANTOM (no legacy comparand) — NOT built; calendar = period grid w/ marketing-action overlays reusing slice-1/2/4 primitives; COGS resolve feeds the EXISTING CM path (one source of truth). Add goal_attainment_bp (NON-VACUOUS); goals.upsert idempotent+RLS+MANAGER+Zod write ships; costs/festivals/marketing-action CRUD deferred (pages stay real READ views)."}
```

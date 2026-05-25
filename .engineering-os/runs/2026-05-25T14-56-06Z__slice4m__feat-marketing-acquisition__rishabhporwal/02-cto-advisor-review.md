# CTO Advisor Review — Stage 1 (feat-marketing-acquisition, Phase 2 slice 4)

| Field | Value |
|-------|-------|
| **req_id** | `feat-marketing-acquisition` |
| **parent_epic** | `epic-phase2-feature-parity` |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-25T14:56:06Z |
| **Decision** | **ADVANCE** (to Stage 2, Aryan) — with a reconciliation mandate + slice-table correction |

## Lane decision

- **feature_class:** `high-stakes` (inherited from epic + independently triggered).
- **feature_class_rationale:** trigger-surface scan fires on **money** (new-customer revenue, CAC, ad spend in minor units), **multi-tenancy** (`workspace_id` RLS on every new query), **schema/registry change** (new + reconciled metric defs across two registries, new tRPC procedures). Conservative tie-break N/A — unambiguously high-stakes.
- **trigger_surfaces_touched:** `["money","multi-tenancy","schema-proto-registry"]`.
- **Stages that run:** 1 (me) → 2 (Aryan) → 3 (Maya + Vikram + Ananya) → 4 (Shreya) → 5 (Tanvi) → 6 (me) → 7 (Founder gate, signed on standing delegation).

## Made the requirement less dumb first

- **Deleted from scope** (slice-table shorthand that has NO legacy basis): `paMER` (invented, no comparand — recommend DECOMMISSIONING the dead `pamer_bp` def), `payback`/`cac_payback_months` (cohort concept → slice 5), the placed→realized→incremental attribution ladder (LTV/cohort → slice 5). Building these here would be re-implementing a non-existent or mis-placed legacy formula — the exact MED risk named in the epic review, now concrete.
- **Simplified:** anchor = Sugandh Lok (Shopify) only; WooCommerce acquisition path deferred (legacy has a parallel Woo branch — not needed for the anchor and not parity-critical now).
- **Deferred:** campaign-classification CRUD UI (settings, slice 7), goals overlay (slice 7) — acquisition consumes the classification map read-only here.

## The finding that justifies this stage (slice-2/3 lesson applied)

Reading the ACTUAL legacy formulas (not the slice table) surfaced a real, decision-changing problem:

**Child-4 speculatively pre-built marketing defs that diverge from legacy ground truth and are split unevenly across the TS/Python registries behind the parity gate's "shadow phase" carve.** Verified live:
- Parity gate is GREEN, but only because it carves `mer_bp`, `cac_mu`, `cac_payback_months`, `cogs_mu`, `total_ad_spend_mu` as "Python-only (expected during shadow phase)". They have **no TS twin** → no cross-language parity actually enforced on them.
- `amer_bp` (TS) computes **true_cm2 / total_ad_spend**. Legacy aMER = **newCustomerRevenue / acquisition-classified spend**. Same name, different metric — a silent correctness landmine if `/acquisition` wires to it.
- `pamer_bp` = cm2 / total_ad_spend — **no legacy equivalent exists.** Dead, unvalidated, `parity_gap:true`.
- `mer_bp` numerator (`net_sales_mu`) ≠ legacy MER numerator (store net-revenue ex-tax minus refund share). Needs a registered DDR reconciliation, not a silent match.

If slice 4 had naively wired these (as the slice table implied), `/acquisition` would show numbers that were never validated against the legacy behavior the Founder asked to preserve. **This is precisely why the Founder said "READ the actual legacy formulas — don't trust the slice-table shorthand."** Caught at intake; bound into the plan below.

### Why ADVANCE, not CHALLENGE-BACK or KILL

The Founder's directive is sound, planable, and dependency-satisfiable (slices 1–3 shipped). The divergence is **internal technical debt from a prior over-build**, which is within my authority to resolve by scoping a reconciliation into slice 4 — not a strategic ambiguity requiring Founder escalation, and not a flaw in the requirement. So: ADVANCE with a binding reconciliation mandate.

## Binding scope for Aryan (Stage 2)

1. **Reconcile the marketing registry to legacy semantics, TS↔Python byte-identical:**
   - `mer_bp`: define in BOTH registries; numerator = the slice-1 store net-revenue basis (net of tax, minus refund share) the legacy MER uses; register a DDR row reconciling `net_sales_mu` vs the legacy basis if they differ.
   - `amer_bp`: **REDEFINE to legacy** = new_customer_revenue_mu / acquisition_classified_spend_mu (NOT true_cm2/total_spend). Both registries. correctness_fixture + DDR row documenting the change from the Child-4 placeholder + worked anchor. The aMER denominator is **acquisition-classified spend only** — model it explicitly as a distinct input from total ad spend.
   - `cac_mu`: define in TS too (currently PY-only) = total_ad_spend_mu / new_customers_count (= legacy blendedCac). Byte-identical.
   - `acos_bp` / `blended_roas_x100`: keep `display_only:true` (already). Confirm not wired as decision metrics.
   - **Decommission `pamer_bp`** (no legacy basis) OR, if retained for a future Brain-native view, mark `display_only:true` + DDR "Brain-native, no legacy comparand, NOT a parity target" — but NOT consumed by `/acquisition`. Recommend decommission to avoid a dead landmine.
   - `cac_payback_months` is OUT of slice-4 scope (slice 5) — leave untouched; do not wire.
2. **New metric defs (if not already present):** `new_customer_revenue_mu`, `nc_cm2_mu` (new-customer CM2), `new_customers_count`, `cm2_per_nc_mu`, `acquisition_ad_spend_mu`. Reuse `cm2_mu`/`cm1_mu`/`total_ad_spend_mu` where they already exist — do NOT re-add.
3. **Analytics use-cases** (`apps/analytics-service/src/application/marketing/`): `AcquisitionSummaryQuery`, `MarketingEfficiencyQuery`, `DistributionsQuery` — frozen-dataclass honest-input pattern (ad-spend-by-classification, first-order facts, refund share as explicit workspace-scoped inputs, exactly like slice-3 `RtoFacts`). `@paradigm: sql`. Scheduled-rollup shape for join-heavy MER per the slice-table note. Zero float in money paths.
4. **tRPC `marketing.*`** group: `marketing.acquisition`, `marketing.efficiency`, `marketing.distributions` — workspaceProc + requireRole(ANALYST), bigint over superjson, registry traceability (`MARKETING_DEFINITION_IDS` + assert fns), data_epoch + request_id.
5. **DataPlanePort** additive methods + StubDataPlane seed extension consistent with the slice-1 store-net-revenue and slice-2/3 CM2 seeds (cross-surface consistency — MER numerator must equal the /store net revenue for the same range).
6. **Page wiring (Ananya):** `/acquisition` (MER/aMER/ACOS strip, CAC, NC-CM2, meta/google split, daily table) + `/distributions` (per-product histogram: mode/mean/diff + density, filter/sort/paginate) — render-only, formatMoney + scale, freshness label, RLS-safe.
7. **Distributions:** port `lib/distributions/compute.ts` (per-order per-product sales/CM1 → mode/mean/diff + buckets). This is statistical SQL, not attribution — keep it deterministic; histogram bucketing in the use-case, not the registry.

## Reuse mandate (anti-rework)

REUSE wholesale (do NOT rebuild): query gateway + `UnscopedQueryError`, DataPlanePort seam + StubDataPlane + `SUGANDH_LOK_CANONICAL` seed, registry + parity harness + DDR machinery, `formatMoney` / `requireRole` / `workspaceProc` / superjson bigint, `ratioToBasisPoints` / `_ratio_bp`, the slice-1 store-net-revenue + slice-2 CM2/true_cm2 + slice-3 RTO defs. EXTEND only: the registry (reconciled marketing defs), the DataPlane seed, the router (marketing group), the two scaffold pages.

## Persona-count decision

- **Count chosen: 1.**
- **Rationale (classifier):** a single net-new risk dimension dominates — **numeric/definitional parity** of the marketing metrics against legacy. This is exactly the dimension where I just found a live divergence (the Child-4 pre-build). The other big dimensions (RLS, money minor-units, GST per-SKU) are settled foundations reused from prior slices — re-spawning personas for them would duplicate settled work. Cost/paradigm is `sql` with no LLM, so the ai-cost-realist dimension is not net-new here. One dominant dimension → 1 persona (within the high-stakes cap of 2; a 2nd would overshoot).
- **Persona requested:** `marketing-efficiency-numeric-parity-realist:sonnet` — reasoning-heavy (aMER denominator semantics = acquisition-classified spend only; the `amer_bp`/`pamer_bp` reconciliation/decommission call; MER numerator-basis DDR; new-customer-revenue RTO/refund-share/tax handling; distributions mode/mean determinism). Tagged `:sonnet` because it is multi-step numeric-correctness reasoning across divergent definitions, not a bounded checklist.

## Paradigm recommendation

`@paradigm("sql")` — epic-dominant, confirmed. Join-heavy MER/aMER/CAC = scheduled Python rollup (per slice-table), NOT a materialized view, NOT ML. Zero LLM/ML in slice 4. ROAS/ACOS display-only. Holds the ~85% SQL target.

## India context check

| Lens | Impact |
|------|--------|
| **GST (per-SKU)** | newCustomerRevenue uses per-order `totalTax` which flows from per-SKU 0/5/18/40 slabs upstream (slice 1) — confirm NO blended-tax shortcut is introduced in the NC-revenue computation. |
| **RTO** | NC-CM2 and NC-revenue exclude RTO orders (→0), reusing slice-3 RTO identification — honest CM2 preserved; do not double-count RTO provision. |
| **CM2-first** | aMER/CAC privilege CM2 economics; ROAS is display-only. Aligns with the canon (vanity-ROAS is never a decision metric). |
| **Telecom (DLT/NCPR/calling-hours)** | NOT triggered — read-only analytics, no outbound channel. Campaign-classification is a settings read, not a send. |
| **Data residency** | ap-south-1 carried; no new region. |

## Decision

**ADVANCE → Stage 2 (Aryan).** No CHALLENGE-BACK (requirement sound), no KILL. The reconciliation mandate + slice-table correction are binding inputs. 1 persona requested → orchestrator round-trip → my synthesis re-affirms before Aryan plans.

## Decision log (mirrored)

```json
{
  "ts": "2026-05-25T14:56:06Z",
  "actor": "cto-advisor",
  "type": "stage1-intake",
  "req_id": "feat-marketing-acquisition",
  "parent_epic": "epic-phase2-feature-parity",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "trigger_surfaces_touched": ["money","multi-tenancy","schema-proto-registry"],
  "needs_personas": ["marketing-efficiency-numeric-parity-realist:sonnet"],
  "rationale": "Slice 4 = MER/aMER/CAC + acquisition + distributions ported to legacy semantics. Caught Child-4 pre-built marketing defs diverging from legacy (amer_bp=true_cm2/spend vs legacy NCrev/acq-spend; pamer_bp has no legacy basis; uneven TS/PY split behind shadow carve). Bound a reconciliation mandate + corrected the slice-table shorthand (paMER/payback/attribution-ladder are not slice-4). SQL paradigm, no LLM."
}
```

# CTO Advisor Review — Stage 1 intake (slice 2: feat-pnl-cm-waterfall)

| Field | Value |
|-------|-------|
| **req_id** | `feat-pnl-cm-waterfall` |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-25T14:06:44Z |
| **Decision** | **ADVANCE** to Stage 2 (Aryan) |

## Lane decision

- **feature_class:** `high-stakes` (inherited from `epic-phase2-feature-parity`).
- **feature_class_rationale:** Trigger-surface scan fires on multi-tenancy (`workspace_id`
  on every new query), money/financial impact (the entire CM ladder), schema/registry
  change (new metric defs), and india-compliance-sensitive computation (per-SKU GST 2.0
  must never blend). ≥1 trigger surface ⇒ high-stakes. No carve-out applies (this is live
  business logic, not empty scaffolding).
- **trigger_surfaces_touched:** `multi-tenancy`, `money`, `schema-proto` (registry/proto-types),
  `india-compliance` (per-SKU GST honesty).
- **Stages that run:** 1 (me) → 2 (Aryan) → 3 (Maya/Vikram/Ananya) → 4 (Shreya) → 5 (Tanvi) → 6 (me) → 7 (Founder gate, delegated).

## Semantic-recall finding (decisive, drove the binding instruction below)

Recall over prior runs surfaced `feat-metric-engine-olap-split` Stage-3 **Shreya H-1 bounce**:
*"TS↔Python↔DDR formula divergence on 4 correctness_fixture metrics; vacuous registry-parity gate."*
That lesson is directly live here. I verified the current tree against it and found a **real,
shipped divergence** the slice must close (see Risk 1). This is why I am not treating "parity
green" as sufficient evidence — the gate is structurally vacuous for `shadow_compare` formula text.

## Framing & "make the requirement less dumb first"

- **Could delete:** a *new* `metrics.pnlWaterfall` procedure. Child-6 already shipped one
  (router.ts:143). But it is a thin seed-stub returning a COGS-only ladder. Slice 2's
  `pnl.cmWaterfall` is the honest Brain-native use-case; the Child-6 `metrics.pnlWaterfall`
  should be **superseded/re-pointed**, not duplicated (Single-Primitive Rule — one CM-waterfall
  source of truth). Aryan must decide: re-point the existing procedure to the new use-case OR
  add `pnl.*` and deprecate the metrics one. Do NOT ship two CM-waterfall code paths.
- **Could simplify:** reuse the existing web components (`cm-waterfall-chart.tsx`,
  `pnl-waterfall-panel.tsx`) verbatim — they already render registry-traced bigint steps.
  Ananya wires `/pnl` + `/waterfall` to the new procedures; no new chart primitive.
- **Could defer:** the customer-segment filter (new/returning) and the founder-salary /
  net-profit rungs are legacy waterfall features that depend on cohort + settings facts
  (slices 5/7). Slice 2 ships the CM1→CM2→CM3→True-CM2 honest ladder; founder-salary and
  segment proration are explicit non-goals this slice (note them, don't build them).

## The real risks (named, with owner)

| # | Risk | Severity | Owner / mitigation |
|---|------|----------|--------------------|
| **1** | **TS↔Python `cm1_mu` formula divergence (SHIPPED BUG).** Python `cm1_mu = net_revenue − cogs − variable_costs` (definitions.py:285, honest, matches legacy compute-daily.ts:187 + the waterfall page). **TS `cm1_mu = net_revenue − cogs` (definitions.ts:147 — COGS-only, WRONG).** TS has **no `variable_costs_mu`** def at all; Python has it (definitions.py:273). The `shadow_compare` parity gate checks structural fields, NOT formula text — so this passed silently (exactly the H-1 lesson). | **CRITICAL** | **BINDING on Aryan/Maya:** add `variable_costs_mu` to the TS registry (byte-identical structural fields to Python), correct TS `cm1_mu` to `net_revenue − cogs − variable_costs`, cascade cm2/cm3/true_cm2. The slice's parity gate must be made NON-vacuous for these (a correctness fixture proving the formula, not just structural match). Shreya VETO if it ships divergent. |
| **2** | **Two divergent legacy CM ladders.** `pnl.ts` CM1 = netSales − cogs − variableCosts (no tax/refund/shipping/RTO in base). `waterfall.ts` CM1 = (gross − disc − refunds − tax − shipping) − cogs − varCosts − **RTO**. Same data → different CM1/CM2/CM3. Porting either naively re-implements a definitional inconsistency. | **HIGH** | The existing `_ROW_CM2` DDR row documents the pnl.ts-vs-compute-daily divergence; Aryan must **add/extend a DDR row** documenting the waterfall-page ladder (variable costs + RTO in CM1) vs the registry ladder, and canonicalize Brain on ONE honest ladder. RTO-in-CM1 is the True-CM2 path (already a DDR row). Register, don't reconcile-silently. |
| **3** | **FX poison.** `pnl.ts:42-56`, `waterfall.ts:27-41`, `workspace-costs.ts:9-23` all carry static `EXCHANGE_RATES` (INR:83.5). | **HIGH** | NOT ported. Money is exact-integer minor units, primary currency. The `_ROW_FX` DDR row already pins the shadow rate + holds live-rate for Child-3; slice 2 carries no convertCurrency. |
| **4** | **Per-SKU GST blending.** Legacy reads day-level ShopifyQL `totalTax`. | **HIGH** | Reuse slice-1's India GST adapter; `total_tax_mu` stays the per-SKU def with `_ROW_TOTAL_TAX` child_dependency on Child-3. Never blend. Tax flows net_revenue → CM1. |
| **5** | **RLS on the new queries.** | **HIGH** | Reuse query gateway; `workspace_id` first positional non-optional; fail-closed `UnscopedQueryError`. Shreya per-slice VETO. |
| **6** | **Duplicate CM-waterfall code path** (see "could delete"). | **MED** | Aryan re-points or deprecates `metrics.pnlWaterfall`; one source of truth. |
| **7** | **Over-engineering** — speculative segment/founder-salary build. | **LOW** | Explicit non-goals this slice. |

This is an **ADVANCE**, not CHALLENGE-BACK: the requirement is sound, planable on a shipped
foundation, and dependency-satisfied (slice 1 approved at Stage 8). Risk 1 is a concrete binding
instruction, not an open question — I found it by reading the code, so it does not need a persona.

## Persona-count decision

**Count chosen: 0.** Rationale (classifier rule fired): *clear repeat of a prior shipped pattern
in the lessons registry* — slice 2 is the same registry-def + analytics-use-case + tRPC + page-wiring
vertical that slice 1 shipped end-to-end, on the same reused foundations. The dominant risk dimensions
are already resolved: paradigm (SQL — Child-0 M-A1-Q1), RLS (Child-1), money/minor-units (Child-2),
metric parity harness (Child-4). The ONE net-new concern (the `cm1_mu` TS↔Python divergence) is a
concrete correctness finding I surfaced directly from the code + semantic recall — it is a binding
instruction for Aryan, not a question requiring adversarial stress-testing. Spawning a persona would
duplicate settled work and burn tokens for no marginal signal. Within the high-stakes cap (≤2);
0 is correct here.

> If a reasoning-heavy unknown had remained (e.g. "does True-CM2 need ML?"), I would have spawned
> `ai-cost-realist:sonnet`. It does not — True-CM2 is deterministic SQL with a pinned DDR formula.

## Paradigm recommendation

`@paradigm("sql")` — confirmed. The full CM ladder is deterministic integer arithmetic over
structured facts. Zero inference path. No LLM/ML. (Aryan may refine but this is locked by the canon.)

## India context check

| Lens | Impact |
|------|--------|
| **GST 2.0** | Per-SKU line tax via the India RegionAdapter (slice-1), never blended; feeds net_revenue → CM1. `_ROW_TOTAL_TAX` DDR governs the shadow vs per-SKU delta (child_dependency Child-3). |
| **RTO** | True-CM2 = CM2 − RTO provision (cost-base-proportional). Already a Brain-native DDR row (`_ROW_TRUE_CM2`, parity_gap:true). The single largest controllable Indian-D2C margin leak, made visible at CM2. |
| **COD** | Not this slice (slice 3). No COD/prepaid split here. |
| **Telecom (DLT/NCPR/calling-hours)** | Not triggered — read-only analytics, no outbound channel. |

No compliance ambiguity ⇒ no `/escalate`.

## Decision

**ADVANCE** → Stage 2 (Aryan). `needs_personas: []`. Next agent: architect.

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T14:06:44Z",
  "actor": "cto-advisor",
  "type": "stage-1-intake",
  "req_id": "feat-pnl-cm-waterfall",
  "parent_epic": "epic-phase2-feature-parity",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "trigger_surfaces_touched": ["multi-tenancy", "money", "schema-proto", "india-compliance"],
  "needs_personas": [],
  "binding_findings": [
    "CRITICAL: TS cm1_mu (net_revenue-cogs) diverges from Python cm1_mu (net_revenue-cogs-variable_costs); TS missing variable_costs_mu; shadow_compare gate is vacuous on formula text — CLOSE it, do not pass silently",
    "Two divergent legacy CM ladders (pnl.ts vs waterfall.ts) — register the delta, canonicalize one honest ladder",
    "Do not duplicate the Child-6 metrics.pnlWaterfall — re-point or deprecate (Single-Primitive Rule)",
    "FX poison not ported; per-SKU GST never blended; RLS fail-closed on every new query"
  ],
  "rationale": "Slice 2 honest P&L + CM waterfall on slice-1 foundation; SQL; 0 personas (clear repeat pattern, dominant risks pre-resolved); the cm1_mu TS<->Python divergence is the binding net-new finding."
}
```

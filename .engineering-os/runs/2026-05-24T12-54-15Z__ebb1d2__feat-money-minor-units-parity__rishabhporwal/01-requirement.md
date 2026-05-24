# Requirement: Money / minor-units / numeric-type foundation — Brain-native (Child 2)

> Filled out by `/requirement <text>` automatically. Founder can edit afterward.

| Field | Value |
|-------|-------|
| **req_id** | `feat-money-minor-units-parity` |
| **Title** | Money / minor-units / numeric-type foundation — Brain-native (Child 2) |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-24T12:54:15Z |
| **Tier impact** | all (foundational — every metric & money number depends on it) |
| **Region impact** | in (multi-currency seam must not block ae/sa later) |

---

## Lane *(set by Rohan at Stage 1)*

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** *(set by Rohan, Stage 1, 2026-05-24)* |
| **trigger_surfaces_touched** | `money`, `schema-proto` *(money: canonical minor-units Money type + conversion + exact-equality billing-base parity; schema-proto: shared cross-language Money value-object contract + goalType enum split)* |
| **feature_class_rationale** | Trigger scan fires on money + schema-proto ⇒ high-stakes; foundational-scaffolding carve-out inapplicable (money is an explicit money surface). See `02-cto-advisor-review.md` → Lane decision. |
| **persona_count** | 1 — `money-finance-parity-realist:sonnet` (one dominant numeric-parity dimension) |
| **maya_co_owns_stage2** | true (numeric mechanics; Maya authored the binding Child-0 §A5.2 design) |
| **paradigm (first-pass)** | `sql` (deterministic value object + integer comparator; no ML/LLM) |

---

## Raw text (from Founder)

> Continue the legacy→Brain migration. After Child 1 (RLS, Brain-native), proceed through the remaining strangler-fig children without pausing. Child 2 = the money / numeric-type foundation. (Founder directive 2026-05-24: "go ahead with all childs without asking, i will approve at last.")

---

## Problem statement

Legacy stores money as Postgres `Decimal` and computes metrics in TS float (`compute-daily.ts`), with ROAS-centric, lossy arithmetic. Brain's locked paradigm is **money = integer minor units**; LLMs never produce a metric number; every KPI is deterministic SQL with TS↔Python parity. Before any Brain metric or OLAP materialization can land (Child 4), Brain needs the canonical numeric-type foundation + a parity harness that PROVES Brain's integer money equals the legacy Decimal money exactly.

This is the **C7 money-parity gate** of the binding Child-0 architecture.

## Target user

Foundational/internal — guarantees every downstream money/metric number is exact and reconcilable. Beneficiary: the realized-GMV billing base, the P&L, the CM waterfall, and every brand operator who trusts Brain's numbers.

## Success metric

- Canonical **Money value object** (BIGINT minor-units + `currency_code`) in `packages/lib-metrics` (TS) and `pylibs/brain_metrics` (Python), CI-enforced parity.
- Conversion rules established: money → BIGINT minor-units via `ROUND_HALF_EVEN ×100`; ratio/percent → INT32 scaled ×10,000 (4 implied decimals); count → INT64.
- **Exact-integer-equality parity harness:** `SUM(legacy Decimal ×100 via ROUND_HALF_EVEN) == SUM(Brain BIGINT)` per workspace-date, **zero tolerance band** (design + harness; live reconciliation deferred/gated like Child 1).
- `WorkspaceMetricGoal.goalValue` typing split: `goalType` → `money | ratio` (resolves Child-0 A1 open Q).
- Positive AND negative tests (rounding edges, currency mismatch, overflow, negative amounts) per the coverage standard.

## Constraints

- Legacy is reference-only — migrate the *logic* (the legacy Decimal columns + compute-daily formulas as reference), import/edit nothing under `legacy project/`.
- TS↔Python numeric parity is CI-enforced (the metric-engine parity discipline); a single divergence fails the gate.
- No live data conversion/backfill in this child (design + primitive + parity harness only; live migration is a gated rollout like Child 1's HOLD-AT-FORCE).
- Respects the strangler-fig facade/ACL + per-slice reversibility; no big-bang.
- LLMs never produce a metric number (the Money type + arithmetic are deterministic).
- No commit without explicit Founder "commit it"; feature-branch only.

## Non-goals

- Metric definitions / CM waterfall / OLAP materializations (Child 4).
- Connectors (Child 3), AI (Child 5), frontend (Child 6), decommission (Child 7).
- The actual live column migration + backfill (gated future rollout).
- The Definitional-Delta Register population (Child 4; the discipline is referenced, not executed here).

## Linked prior runs

- `.engineering-os/runs/2026-05-24T00-58-39Z__a49c05__spike-legacy-migration-architecture__rishabhporwal` (Child 0 — binding architecture; money rules in §A5, M-A1-Q1/Q2, A1 #8)
- `.engineering-os/runs/2026-05-24T09-57-25Z__245326__feat-tenancy-rls-brain-native__rishabhporwal` (Child 1 — the C5 gate; establishes the HOLD-AT-FORCE rollout discipline this child mirrors)

## Notes

Mine the Child-0 plan's §A5 numeric-type dispositions (money → BIGINT MU `_mu` suffix; ratio → scaled INT ×10,000; count → INT64) and M-A1-Q1 ruling (every legacy metric is deterministic SQL, no ML). The Money primitive is the Single-Primitive foundation consumed by the metric engine (Child 4). Use the `metric-engine` + `india-commerce-economics` (GST per-SKU, COD/RTO) skills for the currency/rounding rules; this child builds the *type + parity foundation*, not the metrics themselves.

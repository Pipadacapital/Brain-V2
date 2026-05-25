# Requirement: Phase 2 — feature-breadth parity (port the ~40 legacy workspace features onto the Brain foundations)

> Filed by Rohan (cto-advisor) on the Founder's 2026-05-25 directive. This is an EPIC. The Founder asked for a ratified decomposition + the first slice's requirement, NOT a build hand-off.

| Field | Value |
|-------|-------|
| **req_id** | `epic-phase2-feature-parity` |
| **Title** | Phase 2 — feature-breadth parity: port the ~40 legacy workspace feature endpoints onto the Brain architecture |
| **parent_epic** | `chore-migrate-legacy-to-brain` (this is the **breadth phase** of that migration; the 7 layer-children built the depth/foundations) |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-25T13:22:00Z |
| **Tier impact** | all (the operator workbench is the product surface for every tier) |
| **Region impact** | in (ap-south-1; India adapter; UAE/GCC remains Phase 4) |

---

## Lane *(set by Rohan at Stage 1)*

| Field | Value |
|-------|-------|
| **feature_class** | high-stakes |
| **feature_class_rationale** | Inherits the migration epic's maximal trigger-surface set; every slice touches live data, multi-tenancy/RLS, money (minor-units), the metric registry (TS↔Python parity), and most touch connectors/PII/india-compliance. No carve-out; conservative tie-break forbids downgrade. Applies to the EPIC and every child slice. |
| **trigger_surfaces_touched** | multi-tenancy, money, schema-proto, connectors, pii, india-compliance (+ mcp-tools/outbound-channels on the AI/lifecycle slices) |

---

## Raw text (from Founder)

> "Start Phase 2. Check the backend of the legacy application — we need the same functionalities on Brain. Convert Brain's old backend (in the legacy folder) to Brain's new architecture." (Follows Phase 1: web frontend shell + dashboard + 30 scaffolded pages — DONE, awaiting review.)

---

## Problem statement

Phase 1 (the 7 layer-children of `chore-migrate-legacy-to-brain`) proved each Brain architectural layer works **end-to-end for a thin vertical slice**: tenancy/RLS, minor-units money, the connector framework, the metric-engine + OLTP/OLAP split, the AI engine (1 agent path), and the frontend shell (1 live page — `/dashboard` wired to `metrics.kpiSummary`). All seven are HELD at their cutover gates; nothing live has been cut over, and the legacy `looqus` stack is still authoritative.

What is **missing** is the **breadth**: the legacy backend exposes ~40 workspace feature endpoints (`pnl`, `waterfall`, `cohorts`, `lifetime-value`, `acquisition`, `rto-analytics`, `cod-prepaid-analytics`, `pincode-intelligence`, `distributions`, `timings`, `products`, `inventory`, `first-product-cascade`, `cogs-settings`, `costs`, `goals`, `festivals`, `email-sms-report`, `customer-lifecycle`, …), each backed by a real computation module in `legacy project/backend/src/lib/<feature>`. Brain today has:

- **analytics-service**: DDD scaffold + 2 ClickHouse migrations + 3 pattern tests. **No application/domain use-cases** — none of the 40 feature queries exist.
- **api-gateway**: tRPC BFF with **9 live procedures** (auth.session; workspace.list/switch; metrics.kpiSummary/pnlWaterfall/queryRange; morningBrief.get/submitResponse; device.*).
- **metric registry**: ~12–17 metric defs (CI parity-gated). **Not** the full set powering 40 pages.
- **Frontend**: 31 routes; `/dashboard` wired; **30 pages are on-theme scaffolds awaiting backend.**

So the 30 scaffolded pages have no data, and the HELD cutovers can't flip because Brain isn't yet at functional parity with legacy. Phase 2 closes that breadth gap — slice by slice, each slice lighting up one real, data-backed page end-to-end (legacy lib → Brain service → metric registry → tRPC → live frontend page), behind the foundations Phase 1 built.

---

## Target user

Every Brain operator persona (Founder/Owner, Operator/COO, Growth, Retention, Finance/CFO, Ops/Logistics) on the operator workbench — but the FIRST slice's user is the **Founder/Owner of a T1–T2 India D2C brain** opening the Store-Analytics / honest-P&L surface to answer "are we making high-quality money today?" with real, auditable numbers (not a scaffold).

---

## Success metric

- **Epic:** Brain reaches functional parity with the legacy backend for the workspace feature surface — every one of the 30 scaffolded pages is backed by a real, deterministic, RLS-safe, minor-units, parity-gated Brain query; the HELD layer-cutovers become flippable because Brain can serve what legacy serves.
- **Per slice (the real bar):** one live frontend page renders real tenant data, end-to-end through Brain (legacy lib logic → Brain service → metric registry → tRPC → page), with: zero cross-workspace leakage (RLS proven), exact minor-units money, TS↔Python metric parity green, the dominant paradigm at or below SQL/ML (no frontier-LLM where SQL/ML suffices), and a real-network smoke PASS.
- **Slice 1 specifically:** the foundational store/order analytics page (Store Analytics / revenue-quality strip) renders live, with the honest revenue ladder (Gross → Net → Net-of-tax per-SKU slab → Realized/Delivered) computed in the registry — proving the shared order/store fact layer that pnl/cohorts/ltv/rto/cod/acquisition all depend on.

---

## Constraints

- **Cost-routing paradigm discipline is the #1 epic constraint.** 85% SQL / 12% ML / 2.5% small-LLM / 0.5% frontier-LLM target. The legacy AI engine narrates many "insights" with a direct LLM SDK; porting that naively would blow the %-of-GMV unit economics. Every ported feature declares `@paradigm`; metrics are SQL, never LLM. (Child-0 M-A1-Q1 already established the daily-metrics rollup needs **zero ML** — pure SQL.)
- **Metric-engine TS↔Python parity** on every new metric def (CI-enforced). Some legacy definitions may differ from Brain's canonical (e.g. CM2) — those route through the **Definitional-Delta Register** (built in Child 4), not silent float equality.
- **Money = BIGINT minor units + currency_code** everywhere. Legacy money is `Decimal`/`Float` across ~85 columns; the FX poison (`pnl.ts:42-56` static `EXCHANGE_RATES`) is killed (C4). Compare primary-currency at a fixed snapshot for parity.
- **RLS / 4-layer multi-tenancy on every new query.** `workspace_id` predicate mandatory; ClickHouse query gateway rejects un-scoped queries. Legacy had **zero** RLS.
- **OLTP→OLAP split:** the 40 features are analytical reads → ClickHouse via the query gateway + scheduled rollups for join-heavy metrics; Postgres 90-day hot mirror for fast joins/webhook reconciliation.
- **Per-service DB ownership** — services never share a DB; frontend → api-gateway (tRPC) only; gateway → analytics via gRPC.
- **Data residency ap-south-1**; India adapter (per-SKU GST 2.0 slabs 0/5/18/40, COD/RTO economics). UAE/GCC = Phase 4 (adapter only, no fork).
- **Reference-only legacy:** never edit/import `legacy project/`; read the lib module to learn the logic, re-implement Brain-native. Assume nothing about legacy correctness without reading the module.
- **Standing commit rule:** feature-branch only; nothing committed without Founder "commit it".

---

## Non-goals

- NOT executing the HELD cutovers / decommission (that is Child 7, gated on parity + Founder-at-console).
- NOT building UAE/GCC features (Phase 4 adapter only).
- NOT Phase 3 auto-execute (recommend-only; Decision Log writes where applicable).
- NOT re-litigating the Phase-1 layer foundations (RLS, money, connector framework, OLAP split, AI gateway) — Phase 2 BUILDS ON them; a foundation gap found mid-slice routes back through the relevant layer-child, not re-decided here.
- NOT a big-bang port of all 40 endpoints in one pipeline run (the canon's #1 anti-pattern). Assembly-line, one slice at a time.

---

## Linked prior runs

- `chore-migrate-legacy-to-brain` (parent epic — layer decomposition)
- `spike-legacy-migration-architecture` (Child 0 — the binding A1 capability map; A1.2 already maps every legacy route-group → target Brain service)
- `feat-metric-engine-olap-split` (Child 4 — the metric registry + ClickHouse + Definitional-Delta Register this epic extends)
- `feat-frontend-dashboard-morningbrief` (Child 6 — the frontend shell + 30 pages this epic lights up)
- `feat-tenancy-rls-brain-native`, `feat-money-minor-units-parity`, `feat-connector-framework-cutover`, `feat-ai-engine-intelligence` (the other foundations)

---

## Notes

The Founder's directive and the existing migration epic are the **same program seen from two angles**: the migration epic decomposed by *architectural layer* (depth); Phase 2 decomposes by *feature* (breadth) on top of those layers. The Child-0 A1.2 capability map is the authoritative legacy→Brain routing and is reused, not re-derived. The first slice must be the **foundational shared fact layer** (orders/store/shopify-analytics) because pnl, cohorts, ltv, rto, cod, acquisition all read from it.

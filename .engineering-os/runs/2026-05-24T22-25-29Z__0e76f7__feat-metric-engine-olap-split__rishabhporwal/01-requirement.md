# Requirement: Metric engine + OLTP/OLAP split — Brain-native (Child 4)

> Drafted from the binding Child-0 architecture (Child-4 row + M-A1-1 rollup→metric-registry mapping + M-A1-Q2 Definitional-Delta Register + ClickHouse single-writer C2 + the canonical revenue/CM ladder). Rohan/Founder edit at Stage 1.

| Field | Value |
|-------|-------|
| **req_id** | `feat-metric-engine-olap-split` |
| **Title** | Metric engine + OLTP/OLAP split — Brain-native (Child 4) |
| **parent_epic** | `chore-migrate-legacy-to-brain` |
| **epic_child_id** | `child-4-metric-engine-olap` |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-24T22:25:00Z |
| **Tier impact** | all (every KPI/dashboard/AI-input depends on the metric registry) |
| **Region impact** | in (India metric semantics via RegionAdapter; ap-south-1) |

---

## Lane *(set by Rohan at Stage 1)*

| Field | Value |
|-------|-------|
| **feature_class** | *(set by Rohan)* — expected **high-stakes** |
| **trigger_surfaces_touched (first-pass)** | `money` (metric values in MU), `schema-proto` (ClickHouse MV schema + metric-registry contract), `multi-tenancy` (workspace-scoped MVs/queries), `india-compliance` (residency of OLAP store) |
| **paradigm (first-pass)** | `sql` exclusively (M-A1-Q1 ruling: NO metric requires ML; deterministic SQL aggregation; LLMs never produce a number) |
| **maya_co_owns** | YES (expected — Maya authored the Child-0 metric mappings M-A1-1..3 + owns the metric registry + ClickHouse) |

---

## Raw text (from Founder)

> Complete the application migration as per Brain's Architecture — runnable application with UI. (Standing directive: complete all epic children end-to-end; Founder checks at the end.)

---

## Problem statement

Child 4 of the strangler-fig migration. The legacy app computes rollups in **TS float** (`compute-daily.ts`) and stores them in Postgres rollup tables (`WorkspaceDailyMetrics`, `ProductDailyAggregate`, `ShopifyAnalyticsDaily`, `meta_ads_daily_metrics`, `google_ads_daily_metrics`, etc.). Brain's locked paradigm: every KPI is a **deterministic SQL definition in the metric registry**, computed identically in TS (`packages/lib-metrics`) and Python (`pylibs/brain_metrics`) with CI-enforced parity, money in integer minor-units, materialized in **ClickHouse** (OLAP) — never dual-written to the legacy Postgres rollup (single-writer, C2).

This child builds the **metric registry + the canonical metric definitions + the ClickHouse materializations** that the dashboard, P&L, CM waterfall, and AI inputs all read. It is the data engine behind the runnable UI.

## Scope (from Child-0 architecture — Rohan to confirm/split at Stage 1)

**In scope:**
- **Metric registry** (canon/TECH/03 Formula Book): the full revenue ladder (Gross→Net→Net-Net-Tax per-SKU→Net Revenue→Realized/Delivered), the CM waterfall (CM1/CM2/CM3 + True CM2), marketing metrics (MER/aMER/paMER/CAC/payback/LTV:CAC; ROAS display-only), COD/RTO metrics, Goal RAG — each as ONE definition computed identically TS↔Python (extends the Child-2 parity gate).
- **M-A1-1 rollup→metric-registry mapping** made concrete: for each legacy computed column, its target canonical registry definition vs ClickHouse base/MV column.
- **ClickHouse materializations** (analytics-service owns): raw event store (Postgres, from Child 3) → ClickHouse Materialized Views; workspace-scoped; query-gateway rejects un-scoped queries.
- **Single-writer (C2):** Brain shadows metrics into ClickHouse; the legacy Postgres rollup keeps exactly ONE writer (legacy) until the named ownership gate flips read source to Brain. NEVER dual-write the Postgres rollup.
- **M-A1-Q2 Definitional-Delta Register:** one row per metric+source where `legacy_formula != brain_formula` (e.g. CM2-first inversion; ROAS display-only); the shadow-compare classifies these as `expected_definitional_delta`, NOT blocking bugs; signed by Rohan before any cutover.
- **goalType storage** (money→BIGINT MU; ratio→scaled INT ×10,000), consuming the Child-2 enum.
- **Parity:** exact-integer-equality shadow-compare vs legacy rollups (extends Child-2 harness; ratio metrics same zero-tolerance rule).

**Out of scope (deferred):**
- AI surface (Child 5) — but the ClickHouse MVs are the hard dependency Child 5 reads.
- Frontend rendering (Child 6).
- The live read-source flip to Brain (HOLD — named ownership gate at Stage 8; legacy stays authoritative until parity signed).

## Dependencies
- **Child 2 (money parity): committed** (MU foundation + parity harness). REQUIRED.
- **Child 1 (RLS gate): SATISFIABLE** (committed). REQUIRED.
- **Child 3 (connectors): in pipeline** — provides the raw event store the MVs read; Child 4 can shadow on legacy-sourced data if a connector hasn't cut over (no hard block per architecture DAG line 515).
- ClickHouse Cloud (ap-south-1) available for materializations.

## Constraints carried forward (Rohan to bind)
- `CF-BN-NOLEGACY-1`, `CF-RES-1` (OLAP residency ap-south-1), money=MU (no float in metric path), TS↔Python parity (CI gate), single-writer C2, `CF-MAYA-1` (Definitional-Delta Register pre-condition), `CF-MAYA-2`.

## Notes for Stage 1 (Rohan)
- Likely Shape boundary (mirror Child-1/2/3): build registry + definitions + ClickHouse MV DDL + shadow-compare harness Brain-native; the live read-source flip is HELD (named ownership gate, Stage-8) — no live cutover this child.
- Definitional-Delta Register sign-off (CF-MAYA-1) is the headline governance gate.
- Maya co-owns by default (metric registry is her lane). Persona candidate: a metric-parity / OLAP-correctness realist.

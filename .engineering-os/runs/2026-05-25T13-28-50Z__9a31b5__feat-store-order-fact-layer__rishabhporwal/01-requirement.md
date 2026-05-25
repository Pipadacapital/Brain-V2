# Requirement — feat-store-order-fact-layer (Phase 2, slice #1)

| Field | Value |
|-------|-------|
| **req_id** | `feat-store-order-fact-layer` |
| **parent_epic** | `epic-phase2-feature-parity` (breadth phase of `chore-migrate-legacy-to-brain`) |
| **slice** | #1 of 9 (the FORCED foundation — shared store/order fact layer + revenue ladder) |
| **submitted_by** | rishabhporwal (Founder) |
| **submitted_at** | 2026-05-25T13:28:50Z |
| **lane** | high-stakes (inherited from epic; conservative tie-break forbids downgrade) |
| **guardrails** | NO git commit. legacy = reference-only. Reuse Phase-1 plumbing wholesale. Build + verify it runs. |

## Problem

No canonical order/store fact layer exists Brain-native. The `/store` page is a scaffold
(`ScaffoldPage`), and `/dashboard` reads a thin seed stub (`metrics.kpiSummary` → `SUGANDH_LOK_KPI`
hardcoded). Every downstream Phase-2 analytics feature (pnl, cohorts, ltv, rto, cod, acquisition)
needs this shared fact layer first. This slice is the dependency root.

## Deliverable bar (from the ratified epic slice-1 spec, 02-cto-advisor-review of the epic)

A REAL, data-backed `/store` page (and the dashboard reading the same canonical facts instead of
the seed stub):

- Legacy `lib/workspace-metrics/compute-daily.ts` revenue-ladder logic ported into Brain-native
  analytics-service through the existing connector framework + OLAP query gateway.
- Revenue-ladder metric defs added with TS↔Python parity GREEN.
- `store.revenueLadder` / `store.summary` tRPC procedures added to api-gateway.
- `/store` frontend page wired (hand the new procedures to Ananya).
- Money in BIGINT minor units; per-SKU GST 2.0 via the India RegionAdapter (never blended).
- RLS proven on every new query; `@paradigm("sql")`; real-network smoke PASS.
- Any CM2/legacy definition-delta registered in the DDR, not silently float-matched.

## Acceptance bar (binding inputs for Aryan/Shreya/Tanvi)

- RLS proven: un-scoped query rejected by the query gateway; context-less = ZERO rows;
  cross-workspace isolation tested.
- Money exact-integer minor units; per-SKU GST extraction (not blended); FX poison absent.
- Metric registry TS↔Python parity CI green; any legacy def-delta registered.
- `@paradigm("sql")` on the query; zero LLM/ML in this slice.
- Real-network smoke PASS: `/store` renders real anchor-brand (Sugandh Lok) data end-to-end.
- Reversible: derived facts droppable; no legacy edit; zero behavior change to legacy.
- Correlation-ID 4-tuple end-to-end; Decision Log N/A (read-only analytics; no recommendation/action).

## Verify-before-report (Founder directive)

- api-gateway runs on :3001; web runs via `pnpm exec next dev --webpack` on :3000 (NOT --turbopack).
- `/store` renders real ported data inside the shell.
- New tRPC procedures return correct minor-unit values.
- TS↔Python metric parity green; typecheck passes.

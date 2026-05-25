# Requirement — feat-pnl-cm-waterfall (Phase-2 slice 2)

| Field | Value |
|-------|-------|
| **req_id** | `feat-pnl-cm-waterfall` |
| **parent_epic** | `epic-phase2-feature-parity` |
| **blocks** | `feat-store-order-fact-layer` (slice 1 — shipped/approved at Stage 8) |
| **filed_by** | Rohan (CTO Advisor), on epic ratification |
| **lane** | high-stakes (inherited from epic) |
| **paradigm** | `@paradigm("sql")` (epic-dominant) |

## Problem

The `/pnl` and `/waterfall` pages are scaffolds. The honest P&L ladder and the
CM waterfall (CM1/CM2/CM3 + True-CM2) do not exist as Brain-native analytics
use-cases. Legacy authoritative computations live in `src/routes/workspaces/pnl.ts`
+ `waterfall.ts` and `src/lib/pnl`, `src/lib/cogs`, `src/lib/workspace-costs.ts`.

## Smallest safe reversible thing that ships two real pages

Build, on top of slice-1's foundation (revenue ladder, India GST adapter,
StoreSummaryQuery use-case, query gateway, DataPlanePort, registry+parity harness):

1. **Honest CM ladder, correct in BOTH registries.** Fix the existing TS↔Python
   `cm1_mu` divergence (TS = COGS-only; Python = COGS + variable costs). The honest
   CM1 subtracts variable costs. Add `variable_costs_mu` to the TS registry (Python
   already has it) and correct TS `cm1_mu` to match. CM2/CM3/True-CM2 cascade.
2. **A new analytics use-case** (`PnlStatementQuery` / `CmWaterfallQuery`) reading
   through the query gateway with a mandatory `workspace_id` predicate.
3. **New tRPC procedures** `pnl.statement` + `pnl.cmWaterfall` (workspaceProc, ANALYST,
   money as bigint minor units over superjson) on the api-gateway.
4. **Wire `/pnl` and `/waterfall`** to render real ported data inside the shell,
   reusing the existing `cm-waterfall-chart.tsx` + `pnl-waterfall-panel.tsx`.
5. **Register the CM definitional deltas in the DDR** — the legacy waterfall CM
   ladder (variable costs + RTO in CM1) vs the registry CM ladder; True-CM2 already
   has a DDR row (reuse).

## Acceptance bar (binding inputs for Aryan/Shreya/Tanvi)

- RLS proven: un-scoped query rejected; context-less = ZERO rows; cross-workspace isolation tested on every new query.
- Money exact-integer minor units; per-SKU GST never blended; FX poison absent (legacy `EXCHANGE_RATES` NOT ported).
- TS↔Python registry parity CI green — and NON-vacuous: the `cm1_mu` formula divergence must be CLOSED, not silently passed.
- Any CM/legacy definition-delta registered in the DDR as a correctness-fixture or signed shadow row; never silently float-matched.
- `@paradigm("sql")`; zero LLM/ML this slice.
- Real-network smoke PASS: `/pnl` and `/waterfall` render real anchor-brand data end-to-end; new procedures return correct minor-unit CM values.
- Reversible/additive; legacy untouched; no commit without Founder "commit it".

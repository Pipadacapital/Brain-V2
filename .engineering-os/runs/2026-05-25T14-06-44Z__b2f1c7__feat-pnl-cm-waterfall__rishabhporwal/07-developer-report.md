# Developer Report — feat-pnl-cm-waterfall (Stage 3)

| Field | Value |
|-------|-------|
| **req_id** | `feat-pnl-cm-waterfall` |
| **Stage** | 3 (build) |
| **Builders** | Maya (registry/DDR/use-cases), Vikram (BFF/contract/tenancy/re-point), Ananya (frontend) |
| **Paradigm** | `@paradigm("sql")` — held; zero LLM/ML; zero new runtime; zero new dependency |

## What was built (maps 1:1 to the plan's file list)

### Maya — metrics engine + DDR + analytics use-cases
- `packages/lib-metrics/src/registry/definitions.ts` — **CRITICAL FIX**: ADDED `VARIABLE_COSTS_MU`
  (was Python-only); CORRECTED `CM1_MU` from the COGS-only 2-arg form to the honest 3-arg
  `net_revenue − cogs − variable_costs`, byte-identical to Python (definitions.py:285/298). Registered
  `variable_costs_mu` in `METRIC_REGISTRY` + both index.ts barrels.
- `packages/lib-metrics/src/registry/registry.test.ts` — added `variable_costs_mu` to completeness +
  shadow-metric lists; added the **non-vacuous CM-ladder cross-language anchor** (4 fixtures) that
  pin `cm1_mu(779000,200000,50000)=529000` and `variable_costs_mu(30000,12000,8000)=50000` — the SAME
  numeric anchors as Python `test_registry.py`. These FAIL against the old COGS-only formula and PASS
  after the fix → the gate now bites the divergence class that the structural gate missed.
- `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py` — ADDED `_ROW_CM1`
  (parity_gap:false, EXPECTED_DEFINITIONAL_DELTA): documents the canonical CM1, the legacy
  waterfall-page divergence (RTO/tax/shipping folded into CM1), why Brain does NOT fold RTO into CM1
  (double-count → True-CM2 is the honest place), and the historical TS COGS-only correction.
- `apps/analytics-service/src/application/pnl/pnl_statement_query.py` — `PnlStatementQuery` (2nd
  application-layer occupant). Reads via `query_metrics(workspace_id,...)` (fail-closed). Honest CM
  ladder from registry formulas; variable costs + RTO accepted as EXPLICIT workspace-scoped inputs
  (no hidden defaults); RTO at CM2 (true_cm2), never in CM1.
- `apps/analytics-service/src/application/pnl/cm_waterfall_query.py` — `CmWaterfallQuery` (3rd
  occupant). WRAPS PnlStatementQuery — ONE ladder math, signed cumulative steps; the cumulative at
  each CM subtotal equals that subtotal (chart invariant).
- Tests: `tests/test_pnl_statement_query.py` (13), `tests/test_cm_waterfall_query.py` (8) — positive
  honest-ladder + True-CM2 worked example + multi-day SUM; negative fail-closed tenancy + cross-ws
  isolation + the COGS-only regression mutant killed.

### Vikram — BFF contract + tenancy + Single-Primitive re-point
- `apps/api-gateway/src/domain/proto-types.ts` — ADDED `PnlStatementRow` (all `_mu` bigint; true_cm2
  nullable) + `getCmWaterfall` + `getPnlStatement` on `DataPlanePort` (additive; same seam).
- `apps/api-gateway/src/domain/registry-mapper.ts` — EXTENDED `PNL_WATERFALL_DEFINITION_IDS`
  (variable_costs_mu + true_cm2_mu); ADDED `PNL_STATEMENT_DEFINITION_IDS` + `assertPnlStatementTraceability`.
- `apps/api-gateway/src/infrastructure/loopback-data-plane.ts` — EXTENDED `SUGANDH_LOK_CANONICAL`
  with cogs/variable_costs/ad_spend/misc/rto_orders chosen so the honest re-derivation yields the
  EXISTING dashboard KPI cm2=₹3.2L/cm3=₹2.8L (cross-surface consistency preserved); REPLACED the
  COGS-only `buildSugandhlokWaterfall` with the honest `buildSugandhlokCmWaterfall`; ADDED
  `buildSugandhlokPnlStatement`; RE-POINTED `getPnlWaterfall` → `getCmWaterfall` (ONE source of truth).
- `apps/api-gateway/src/application/router.ts` — ADDED `pnlRouter` (`pnl.statement`, `pnl.cmWaterfall`;
  workspaceProc + requireRole(ANALYST); bigint over superjson; registry-traced); re-pointed
  `metrics.pnlWaterfall` (now the honest data, kept as the Child-6 alias).
- Tests: `src/application/router.pnl.test.ts` (12) — positive honest ladder/cumulative invariant +
  metrics.pnlWaterfall==pnl.cmWaterfall + dashboard-KPI==statement-cm2; negative role/cross-ws/orphan.

### Ananya — frontend (/pnl + /waterfall wiring)
- `apps/web/src/interfaces/components/pnl/pnl-statement-table.tsx` — render-only P&L ladder via
  `trpc.pnl.statement.useQuery`; every money value through `formatMoney`; deductions shown negative;
  request_id sr-only; loading + error states; zero arithmetic.
- `apps/web/src/interfaces/components/pnl/pnl-content.tsx` — `/pnl` shell: statement table + reused
  `PnlWaterfallPanel`.
- `apps/web/src/interfaces/components/waterfall/waterfall-content.tsx` — `/waterfall` shell: reused
  `PnlWaterfallPanel` (→ existing `CmWaterfallChart`).
- `apps/web/src/app/(shell)/pnl/page.tsx` + `waterfall/page.tsx` — swapped `ScaffoldPage` → the new content.

### Toolchain (prep fix)
- `apps/intelligence-service/pyproject.toml` — added `[tool.uv.sources] brain-cost-router = { workspace = true }`.
  `uv run` now builds the whole workspace; Python parity tests run without an ephemeral venv.

## Verification captured at build time

- TS↔Python registry parity gate (`tools/check-metrics-parity.sh`): **PASS** — 21 shared metrics
  structural-match (was 20; +variable_costs_mu, +cm1 still shared); correctness_fixture SQL + DDR
  coverage PASS; killed-mutant sub-step PASS (gate non-vacuous).
- brain_metrics: **291 passed**. analytics-service: **76 passed** (61 baseline + 15 new).
- api-gateway: **52 passed** (40 baseline + 12 new); tsc **exit 0**.
- lib-metrics vitest: **130 passed** (incl. 4 new CM-ladder anchors); build/tsc **exit 0**.
- web tsc: **exit 0** (`trpc.pnl.*` resolves through the typed BrainRouter).

## Over-engineering self-audit
- Zero new dependency (no npm/pip/uv add); the uv sources entry is a toolchain repair, not a dep.
- Zero new runtime. Zero @paradigm LLM decorator.
- ONE CM-waterfall source of truth (re-point, not a 2nd path) — Single-Primitive Rule honored.
- `variable_costs_mu` is a correctness ADD to match Python — not speculative.
- Segment proration / founder-salary rungs are explicit non-goals — NOT built.
- Reused the existing chart components verbatim; no new chart primitive.
- Reversible additive; legacy untouched; FX poison not ported; per-SKU GST never blended.

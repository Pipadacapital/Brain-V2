# Developer Report — feat-store-order-fact-layer (Stage 3)

| Field | Value |
|-------|-------|
| **req_id** | `feat-store-order-fact-layer` |
| **Stage** | 3 (build) |
| **Builders** | Maya (registry/DDR/GST/use-case), Vikram (BFF/contract/tenancy), Ananya (frontend, consulted) |
| **Paradigm** | `@paradigm("sql")` — held; zero LLM/ML; zero new runtime; zero new dependency |

## What was built (maps 1:1 to the plan's file list)

### Maya — metrics engine + analytics use-case
- `packages/lib-metrics/src/registry/definitions.ts` — ADDED `gross_sales_mu`, `total_discount_mu`,
  `total_tax_mu` (were Python-only; now byte-identical structural-field pairs) + `realized_revenue_mu`
  (Brain-native correctness_fixture, parity_gap:true). Registered all four in `METRIC_REGISTRY`.
- `pylibs/brain_metrics/brain_metrics/registry/definitions.py` — ADDED `realized_revenue_mu` with a
  worked example; registered.
- `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py` — ADDED
  `_ROW_REALIZED_REVENUE` (parity_gap:True, pinned formula_snapshot, worked example, honest-billing-base
  business impact). Mandatory: the parity gate requires a DDR formula_snapshot for every
  correctness_fixture metric.
- `apps/analytics-service/src/domain/region/india_gst.py` — per-SKU GST 2.0 adapter (pure fn).
  `gst_line_tax_mu(price, slab_bp)` = `intDiv(price*slab_bp, 10000)`; `total_tax_mu_per_sku(items)` SUMs
  per-SKU — NEVER blended. Slabs `{0,500,1800,4000}` bp. Fails closed on an invalid slab (never silent 0%).
- `apps/analytics-service/src/application/store/store_summary_query.py` — `StoreSummaryQuery`, the FIRST
  occupant of the analytics application layer. Reads via `query_gateway.query_metrics(workspace_id,...)`
  (fail-closed tenancy, workspace_id first positional non-optional). Assembles the ladder with registry
  formulas; realized subtracts reversal facts (explicit input — not a hidden default).
- Tests: `tests/test_india_gst.py` (19+ assertions across positive/negative), `tests/test_store_summary_query.py`
  (positive ladder assembly + negative fail-closed tenancy + cross-workspace isolation).

### Vikram — BFF contract + tenancy + router
- `apps/api-gateway/src/domain/proto-types.ts` — ADDED `StoreSummaryRow`, `StoreRevenueLadderStep`
  (all `_mu` bigint) + `getStoreSummary` on `DataPlanePort` (additive method, same seam — no second path).
- `apps/api-gateway/src/domain/registry-mapper.ts` — ADDED `STORE_LADDER_DEFINITION_IDS` +
  `assertLadderDefinitionId` (G-REGISTRY-ONLY for the ladder; reuses the registry, no fork).
- `apps/api-gateway/src/infrastructure/loopback-data-plane.ts` — `SUGANDH_LOK_CANONICAL` single seed
  source; `getKpiSummary` net_revenue now DERIVES from the canonical realized revenue; `getStoreSummary`
  implemented (fail-closed tenancy). Dashboard + /store now provably share the SAME canonical facts.
- `apps/api-gateway/src/application/router.ts` — ADDED `storeRouter` (`store.summary`, `store.revenueLadder`,
  both `workspaceProc` + `requireRole('ANALYST')`, bigint over superjson, ladder registry-traced).
- Tests: `src/application/router.store.test.ts` (8 tests — positive values/ordering/consistency +
  negative role/cross-workspace/orphan-rung).

### Ananya — frontend (/store wiring)
- `apps/web/src/interfaces/components/store/revenue-ladder-strip.tsx` — renders the 5 ladder rungs via
  `trpc.store.revenueLadder.useQuery`; every money value through `formatMoney`; request_id sr-only;
  loading + error states. Render-only, zero arithmetic.
- `apps/web/src/interfaces/components/store/store-content.tsx` — auth guard, date range (nuqs),
  freshness label from `store.summary.data_epoch`, the ladder, and an honesty note.
- `apps/web/src/app/(shell)/store/page.tsx` — swapped `ScaffoldPage` → `StoreContent`.

## Verification captured at build time

- TS↔Python registry parity gate: **exit 0** (20 shared metrics structural-match; `realized_revenue_mu`
  correctness_fixture SQL match + DDR coverage; 2 mutants killed).
- analytics-service tests: **61 passed** (incl. 20 new); brain_metrics: **291 passed**.
- api-gateway tests: **40 passed** (32 baseline + 8 new); tsc **exit 0**.
- web tsc: **exit 0** (`trpc.store.*` resolves through the typed BrainRouter).

## Over-engineering self-audit
- Zero new dependency (no npm/pip/uv add). Zero new runtime. Zero @paradigm LLM decorator.
- India GST adapter is a single pure function + slab constant — NOT a multi-region framework (Phase 4).
- `realized_revenue_mu` is the only net-new metric; gross/discount/tax are passthrough TS additions to
  match the existing Python defs.
- No speculative abstraction. Reversible additive. Legacy untouched.

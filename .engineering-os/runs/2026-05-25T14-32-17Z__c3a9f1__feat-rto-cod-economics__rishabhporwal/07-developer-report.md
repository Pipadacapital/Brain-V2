# Developer Report — feat-rto-cod-economics (Stage 3)

| Field | Value |
|-------|-------|
| **req_id** | `feat-rto-cod-economics` |
| **Stage** | 3 (build) |
| **Builders** | Maya (registry/DDR/use-cases), Vikram (BFF/contract/tenancy), Ananya (frontend) |
| **Paradigm** | `@paradigm("sql")` — held; zero LLM/ML; zero new runtime; zero new dependency |

## What was built (maps 1:1 to the plan's file list)

### Maya — metric registry + DDR + analytics use-cases

- `packages/lib-metrics/src/registry/definitions.ts` — ADDED 5 defs: `rto_cost_mu`,
  `rto_revenue_lost_mu` (passthrough money aggregates, shadow_compare), `cod_realization_rate_bp`
  (delivered/COD-orders, shadow_compare, legacy comparand), `breakeven_cod_rto_rate_bp`
  (correctness_fixture — the FULL legacy formula, NOT naive M/(M+C); single final FLOOR-to-bp),
  `pincode_reliability_score` (correctness_fixture — integerized centi-points, clamped [0,10000]).
  `rto_rate_bp`/`prepaid_rate_bp`/`aov_mu` REUSED from Child-4 (not re-added). Registered + barrelled.
- `pylibs/.../registry/definitions.py` — same 5 defs, byte-identical (clickhouse_sql whitespace-identity
  enforced by the parity gate for the 2 correctness_fixture ids). Registered in METRIC_REGISTRY.
- `packages/lib-metrics/src/registry/registry.test.ts` — completeness + correctness-fixture lists +
  11 NON-VACUOUS cross-language anchors: break-even = 500bp (and `!= 9493` = the naive M/(M+C) — the
  anchor BITES), pincode = 5900 centi-points, cod-realization, plus moves-with-each-input mutant-kills.
- `pylibs/brain_metrics/tests/test_registry.py` — the SAME anchors mirrored byte-identically (9 tests).
- `pylibs/.../parity/definitional_delta_register.py` (+ `.md`) — ADDED 3 DDR rows:
  `_ROW_BREAKEVEN_COD_RTO` (parity_gap:true, full-formula + anchor 500bp, kills naive),
  `_ROW_PINCODE_RELIABILITY` (parity_gap:true, integerized centi-points + anchor 5900),
  `_ROW_RTO_COST_VALUE` (parity_gap:false, **child_dependency child-3-shopify-connector** — mirrors
  `_ROW_TOTAL_TAX`; covers rto_cost_mu + rto_revenue_lost_mu; NOT signable pre-cutover).
- `apps/analytics-service/src/application/logistics/` — 4 use-cases (occupants 4–7) +
  `city_tiers.py` + `__init__.py`. Each reads via `query_metrics(workspace_id,...)` (fail-closed);
  shipment-level operational facts are EXPLICIT workspace-scoped inputs (the slice-1/2 honest-input
  pattern, NOT gateway columns); money BIGINT; registry formulas only. `@paradigm: sql`.
- Tests: `tests/test_{rto_analytics,cod_prepaid,logistics,pincode_intelligence}_query.py` (31) —
  positive worked examples (incl. break-even 500bp, pincode anchor, naive-form kill) + negative
  fail-closed tenancy + cross-workspace isolation + zero-denominator guards.

### Vikram — BFF contract + tenancy + registry traceability

- `apps/api-gateway/src/domain/proto-types.ts` — ADDED result row interfaces (`RtoAnalyticsResult`,
  `CodPrepaidResult`+segment, `LogisticsResult`+courier, `PincodeIntelligenceResult`+`PincodeRow`,
  `PincodeFilterInput`; all `_mu` bigint, `_bp` number|null) + 4 additive `DataPlanePort` methods
  (`getRtoAnalytics`, `getCodPrepaid`, `getLogistics`, `getPincodeIntelligence`) — same seam, no 2nd path.
- `apps/api-gateway/src/domain/registry-mapper.ts` — ADDED `LOGISTICS_DEFINITION_IDS` +
  `assertLogisticsDefinitionId` (G-REGISTRY-ONLY: every logistics metric field traces the registry).
- `apps/api-gateway/src/infrastructure/loopback-data-plane.ts` — EXTENDED `SUGANDH_LOK_CANONICAL` with
  slice-3 operational facts (chosen so derived rto_rate ≈ 1796bp consistent with the dashboard seed,
  AOV = 150000p → break-even reproduces 500bp); ADDED 4 builders + 4 fail-closed stub methods.
- `apps/api-gateway/src/application/router.ts` — ADDED `logisticsRouter` (`logistics.rto`,
  `logistics.codPrepaid`, `logistics.summary`, `logistics.pincode` — workspaceProc + requireRole(ANALYST);
  bigint over superjson; registry-traced) mounted under `logistics`.
- Tests: `src/application/router.logistics.test.ts` (10) — positive values/break-even-500bp/kills-naive/
  filters + negative VIEWER-rejected + cross-workspace fail-closed on every procedure.

### Ananya — frontend (4 pages wired)

- `apps/web/src/interfaces/components/logistics/format-bp.ts` — ONE shared display helper (bp→%, centi→score).
- `rto-analytics-content.tsx`, `cod-prepaid-content.tsx`, `logistics-content.tsx`,
  `pincode-intelligence-content.tsx` — render-only client components via `trpc.logistics.*`; every money
  through `formatMoney`, every bp through the shared helper; request_id sr-only; loading + error states;
  zero arithmetic. Pincode page is filterable (search + high-RTO) and sorted by reliability.
- `apps/web/src/app/(shell)/{rto-analytics,cod-prepaid,logistics,pincode-intelligence}/page.tsx` —
  swapped `ScaffoldPage` → the new content components.

## Verification captured at build time

- TS↔Python parity gate: **PASS** — `breakeven_cod_rto_rate_bp` + `pincode_reliability_score`
  correctness_fixture SQL byte-identical + DDR formula_snapshot present; killed-mutant sub-step PASS (non-vacuous).
- brain_metrics: **299 passed** (was 291; +8 slice-3 registry anchors).
- analytics-service: **107 passed** (76 baseline + 31 new use-case tests).
- lib-metrics vitest: **139 passed** (incl. 11 new slice-3 anchors); tsc **exit 0**.
- api-gateway: **62 passed** (52 baseline + 10 logistics router tests); tsc **exit 0**.
- web tsc: **exit 0** (`trpc.logistics.*` resolves through the typed BrainRouter).

## Build-time finding (fixed)

The first router test run caught a real seed inconsistency: the RTO-analytics by-payment counts
(180 COD + 10 prepaid = 190) didn't reconcile to `rto_orders=224`. Fixed the loopback seed so the RTO
surface's by-payment split (180 + 44 = 224) reconciles to its own total. (The /cod-prepaid surface
legitimately uses its own mapped denominators — a real legacy distinction, preserved.)

## Over-engineering self-audit

- Zero new dependency (no npm/pip/uv add).
- Zero new runtime, zero @paradigm LLM decorator.
- `rto_rate_bp`/`prepaid_rate_bp`/`aov_mu` REUSED, not re-added (Single-Primitive Rule).
- ONE shared bp formatter for the 4 pages (no per-component bp math).
- NDR metric, RTO risk-ML, pincode predictive model are explicit non-goals — NOT built.
- Reversible additive; legacy untouched; FX poison not ported; per-SKU GST never blended; no outbound channel.

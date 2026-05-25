# Developer Report — feat-marketing-acquisition (Stage 3)

@paradigm: sql · slice 4 of `epic-phase2-feature-parity`. Built per the Stage-2 plan; all reuse mandates honored.

## Maya (registry + analytics use-cases)

**Registry reconciliation (the slice-1/finding fix), TS↔Python byte-identical:**
- `amer_bp` REDEFINED: `new_customer_revenue_mu / acquisition_ad_spend_mu` (was Child-4 `true_cm2/total_spend`). correctness_fixture + DDR `_ROW_AMER_REDEF`.
- `pamer_bp` DECOMMISSIONED (no legacy comparand) — removed from both registries, barrels, METRIC_REGISTRY, DDR map, and all locked-canon tests; the parity gate's mutant-1 retargeted to `amer_bp`.
- `mer_bp` defined in BOTH registries, numerator reconciled `net_sales_mu`→`net_revenue_mu` (cross-surface with /store); DDR `_ROW_MER_BASIS`.
- `cac_mu` defined in TS too (was PY-only) = `total_ad_spend_mu / new_customers_count`.
- New defs: `new_customer_revenue_mu`, `nc_cm2_mu`, `cm2_per_nc_mu`, `acquisition_ad_spend_mu`. DDR `_ROW_NC_REVENUE_CM2` (child-3-pending).
- Non-vacuous anchors added to both registries' tests (aMER classification-split 15000bp + "use total spend" KILL; MER 12000bp; CAC ₹500; CM2-per-NC ₹100).

**Analytics use-cases** (`apps/analytics-service/src/application/marketing/`): `MarketingEfficiencyQuery`, `AcquisitionSummaryQuery`, `DistributionsQuery` — frozen-dataclass honest-input pattern (slice-3 style), `@paradigm: sql`, fail-closed `workspace_id`, registry-formula-only money paths, NULL guards. 29 tests (positive + negative incl. RTO-NC-order=0, tenancy isolation, mode tie-break).

## Vikram (BFF)

- `proto-types.ts`: `MarketingEfficiencyResult`, `AcquisitionSummaryResult` (+`AcquisitionDailyRow`), `DistributionsResult` (+rows/points/filter) + 3 `DataPlanePort` methods (additive seam, no second path).
- `registry-mapper.ts`: `MARKETING_DEFINITION_IDS` + `assertMarketingDefinitionId` (pamer_bp NOT included — decommissioned).
- `loopback-data-plane.ts`: seed extended (MER numerator == /store net_revenue 191M; aMER classification split acq 26M < total 65M; CAC ₹162.50) + 3 builders + 3 methods (fail-closed).
- `router.ts`: `marketingRouter` (efficiency/acquisition/distributions), workspaceProc + requireRole(ANALYST), bigint superjson, registry traceability; mounted as `marketing`. 11 router tests (positive + VIEWER-reject + cross-workspace fail-closed + aMER mutant kill at the wire).

## Ananya (web)

- `acquisition-content.tsx`: MER/aMER/ACOS strip (aMER+CAC green/privileged; ROAS/ACOS muted display-only) + CAC + CM2-per-NC + new-customers + NC-revenue + meta/google split + daily table. Render-only, `formatMoney` + bp/x100 multiple helpers, freshness sr-only, loading/error states.
- `distributions-content.tsx`: sales/CM1 toggle + search + per-product mode/mean/diff table + density histogram. Render-only.
- `format-ratio.ts`: ONE display helper (bp→×, x100→×, bp→%).
- `/acquisition` + `/distributions` pages swapped `ScaffoldPage` → content components.

## Reuse honored / no over-engineering

No new deps; no new runtime; no new primitive (reused query gateway, DataPlanePort, registry, parity harness, DDR, formatMoney, ratioToBasisPoints, requireRole). `pamer_bp` REMOVED (net negative LOC on the dead def). Acquisition trend/composition + payback + Woo path NOT built (explicit non-goals).

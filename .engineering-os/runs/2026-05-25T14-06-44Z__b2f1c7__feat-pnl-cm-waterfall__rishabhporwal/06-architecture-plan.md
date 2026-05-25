# Architecture Plan — feat-pnl-cm-waterfall (Stage 2, Aryan)

| Field | Value |
|-------|-------|
| **req_id** | `feat-pnl-cm-waterfall` |
| **Stage** | 2 (binding plan) |
| **Architect** | Aryan |
| **Paradigm** | `@paradigm("sql")` — confirmed; zero inference path |
| **Shape** | feature-vertical on the slice-1 foundation: 1 registry correctness fix (TS `cm1_mu` + new TS `variable_costs_mu`) + 2 DDR rows + 2 analytics use-cases + 2 DataPlanePort methods + a `pnl.*` tRPC group + `/pnl` & `/waterfall` page wiring + re-point of the Child-6 `metrics.pnlWaterfall`. Additive + reversible. Legacy untouched. |

## Binding decisions

### D1 — CLOSE the TS↔Python `cm1_mu` divergence (Rohan CRITICAL finding — non-negotiable)

Verified ground truth:
- **Python** `cm1_mu` = `net_revenue_mu − cogs_mu − variable_costs_mu` (definitions.py:285);
  Python HAS `variable_costs_mu` (definitions.py:273) = `shipping_mu + packaging_mu + website_charges_mu`.
- **TS** `cm1_mu` = `net_revenue_mu − cogs_mu` (definitions.ts:147, COGS-only — WRONG);
  TS has **no** `variable_costs_mu`.
- The `shadow_compare` parity gate compares *structural fields* (id/kind/unit/scale/parity_class) and
  the *golden-fixture decimal→minor-unit* vectors — NOT the formula text. So the divergence shipped
  silently. This is the exact root cause of the `feat-metric-engine-olap-split` Shreya H-1 bounce.

**Binding fix (Maya):**
1. ADD `VARIABLE_COSTS_MU` to the TS registry, byte-identical structural fields to Python
   (`kind:money, unit:mu, scale:1, display_only:false, parity_class:shadow_compare`),
   `formula_ts: (shipping_mu, packaging_mu, website_charges_mu) => shipping_mu + packaging_mu + website_charges_mu`,
   `clickhouse_sql: 'toInt64(shipping_mu + packaging_mu + website_charges_mu)'` (byte-identical to Python).
   Register in `METRIC_REGISTRY` and add to the completeness list in `registry.test.ts`.
2. CORRECT TS `CM1_MU.formula_ts` to the 3-arg honest form
   `(net_revenue_mu, cogs_mu, variable_costs_mu) => net_revenue_mu - cogs_mu - variable_costs_mu`
   and `clickhouse_sql: 'toInt64(net_revenue_mu - cogs_mu - variable_costs_mu)'` — byte-identical to Python (definitions.py:298).
   `cm2_mu`/`cm3_mu` formulas are unchanged in shape (they consume `cm1_mu`/`cm2_mu`), but their
   *values* now cascade from the corrected CM1.

### D2 — Make the gate NON-VACUOUS: a cross-language formula correctness fixture

The structural gate is insufficient. ADD a **registry formula parity fixture** that exercises the
ACTUAL `cm1_mu`, `variable_costs_mu`, `cm2_mu`, `cm3_mu`, `true_cm2_mu` formulas on BOTH sides with the
SAME integer inputs and asserts byte-identical output:
- TS: extend `registry.test.ts` with a `cm1_mu: net_revenue − cogs − variable_costs` worked-example
  assertion (e.g. `CM1_MU.formula_ts(779000n, 200000n, 50000n) === 529000n`) — this **mirrors**
  Python `test_registry.py:144` (`f(net_revenue_mu=779000, cogs_mu=200000, variable_costs_mu=50000) == 529000`),
  so the two sides now share a pinned numeric anchor. This assertion FAILS against today's TS `cm1_mu`
  (it would return `579000n`) and PASSES after D1 — proving the gate now bites.
- Add a shared golden vector group `cm_ladder_formula` to `golden_fixtures.json` covering the CM
  ladder inputs→outputs, so `check-metrics-parity.sh` carries a formula-level anchor, not only
  decimal-conversion vectors. (Single anchor table; both runners read it.)

### D3 — Register the CM definitional deltas in the DDR (don't reconcile silently)

Two legacy CM ladders exist and they disagree:
- `pnl.ts`: CM1 = netSales − cogs − variableCosts (no tax/refund/shipping/RTO in base).
- `waterfall.ts`: CM1 = (gross − disc − refunds − tax − shipping) − cogs − varCosts − **RTO**.

The existing `_ROW_CM2` documents the pnl.ts-vs-compute-daily divergence. ADD ONE new DDR row,
`_ROW_CM1` (brain_formula `cm1_mu`), documenting:
- legacy_formula: `compute-daily.ts:187 (cm1 = netSales − cogs − shipping − packaging − website)` and the
  divergent `waterfall.ts:987 (cm1 = revenueAfterTaxShipping − cogs − varCosts − rto)`.
- reason: Brain canonicalizes CM1 on the compute-daily daily path = `net_revenue − cogs − variable_costs`.
  The waterfall page's RTO-in-CM1 is captured SEPARATELY by the Brain-native `true_cm2_mu` (RTO
  provision applied at CM2, the honest place), already a `parity_gap:true` DDR row (`_ROW_TRUE_CM2`).
  Brain does NOT fold RTO into CM1 (double-count risk); the honest RTO adjustment is True-CM2.
- shadow_compare_classification: `EXPECTED_DEFINITIONAL_DELTA`; parity_gap:false; child_dependency:null;
  formula_snapshot: `cm1_mu = net_revenue_mu − cogs_mu − variable_costs_mu (integer paise)`.

No new DDR row needed for True-CM2 / paMER / aMER — they already exist and are reused.

### D4 — Two analytics use-cases (the application layer, 2nd & 3rd occupants)

New `apps/analytics-service/src/application/pnl/`:
- `pnl_statement_query.py` — `PnlStatementQuery.execute(workspace_id, date_range)` reads through the
  EXISTING `query_gateway.query_metrics(workspace_id, ...)` (workspace_id first positional non-optional;
  inherits `UnscopedQueryError` fail-closed). Assembles the P&L ladder rows (net_revenue → cogs →
  variable_costs → cm1 → ad_spend → cm2 → misc → cm3) from registry MetricRows. Returns a frozen
  `PnlStatement` value object, all `_mu` int.
- `cm_waterfall_query.py` — `CmWaterfallQuery.execute(workspace_id, date_range)` builds the signed,
  cumulative waterfall steps (the chart contract): each step `{definition_id, label, value_mu (signed),
  cumulative_mu, currency_code}`. Includes the True-CM2 rung. Uses registry defs ONLY — zero ad-hoc
  arithmetic outside registry formulas.
- Both carry `@paradigm: sql`. Zero float, zero LLM.
- Tests: `tests/test_pnl_statement_query.py`, `tests/test_cm_waterfall_query.py` — positive ladder
  assembly + negative fail-closed tenancy + cross-workspace isolation + True-CM2 worked example.

### D5 — DataPlanePort additive methods (the BFF seam)

`apps/api-gateway/src/domain/proto-types.ts`:
- ADD `PnlStatementRow` (all `_mu` bigint: net_revenue, cogs, variable_costs, cm1, total_ad_spend, cm2,
  misc_expenses_prorated, cm3, true_cm2; plus currency_code, period, data_epoch) and reuse the
  existing `PnlWaterfallRow` for the waterfall steps.
- ADD two additive methods on `DataPlanePort`:
  `getPnlStatement({workspace_id, date_range}) → { statement, data_epoch }` and
  `getCmWaterfall({workspace_id, date_range}) → { steps: PnlWaterfallRow[], data_epoch }`.
  Same seam, no second code path (CF-C6-DATA-SEAM-1). `StubDataPlane` implements both from the
  EXISTING `SUGANDH_LOK_CANONICAL` single seed (extend it with cogs/variable_costs/ad_spend/misc/
  rto_orders so the waterfall is internally consistent with the dashboard + /store ladder).

### D6 — tRPC `pnl.*` group + re-point the Child-6 `metrics.pnlWaterfall` (Single-Primitive Rule)

`apps/api-gateway/src/application/router.ts`:
- NEW `pnlRouter`:
  - `pnl.statement` — `workspaceProc`, `requireRole('ANALYST')`, input `{date_start, date_end}` (ISO),
    returns `{ statement, data_epoch, request_id }`. `_mu` bigint (superjson).
  - `pnl.cmWaterfall` — `workspaceProc`, `requireRole('ANALYST')`, returns `{ steps, data_epoch,
    request_id }`. Every step `definition_id` traces the registry via `assertWaterfallDefinitionId`
    (EXTEND `PNL_WATERFALL_DEFINITION_IDS` to include `variable_costs_mu` + `true_cm2_mu`).
  - Mounted under root as `pnl`.
- **Re-point**: the existing `metrics.pnlWaterfall` (Child-6, router.ts:143) now delegates to the SAME
  `dataPlane.getCmWaterfall` (the honest use-case) — ONE CM-waterfall source of truth. No second
  computation path. (Keeping the `metrics.pnlWaterfall` name preserves the Child-6 web component's
  query key; the panel `pnl-waterfall-panel.tsx` keeps working. The new `pnl.cmWaterfall` is the
  canonical name; `metrics.pnlWaterfall` is a thin alias slated for removal in a later slice — note,
  don't fork the computation.)

### D7 — `/pnl` and `/waterfall` page wiring (Ananya) — REUSE existing components

- `apps/web/src/app/(shell)/waterfall/page.tsx`: replace `ScaffoldPage` with a `WaterfallContent`
  client component that renders the EXISTING `pnl-waterfall-panel.tsx` (which already calls
  `trpc.metrics.pnlWaterfall` → now the honest re-pointed procedure). Auth guard + date range (nuqs) +
  freshness label. Zero new chart primitive.
- `apps/web/src/app/(shell)/pnl/page.tsx`: replace `ScaffoldPage` with a `PnlContent` client component
  rendering: (a) the same `PnlWaterfallPanel`, and (b) a new render-only `pnl-statement-table.tsx` that
  lists the P&L ladder rows via `trpc.pnl.statement.useQuery`, each money value through `formatMoney`
  (the ONE canonical formatter), request_id sr-only (CF-SEC-5), loading + error states. Render-only;
  zero arithmetic.
- The True-CM2 rung gets a tooltip/label noting it is the RTO-honest CM2 (Brain-native, no legacy
  comparand) — surfaces the honesty delta to the Founder.

### D8 — Reversibility, residency, FX, GST

- All additive: new registry def (`variable_costs_mu`), corrected `cm1_mu` formula, new DDR row, new
  use-cases, new port methods, new tRPC group, page swaps. No migration of existing data, no live DDL.
  Reversal = revert the registry edits + drop the new files + restore the `metrics.pnlWaterfall` body.
- **FX poison NOT ported** — no `EXCHANGE_RATES`/`convertCurrency`. Money is primary-currency integer
  paise. The `_ROW_FX` DDR row already governs the shadow rate (held for Child-3).
- **Per-SKU GST never blended** — `total_tax_mu` stays the slice-1 per-SKU def; `_ROW_TOTAL_TAX`
  carries the Child-3 child_dependency. Tax flows net_revenue → CM1.
- ap-south-1 residency carried (CF-RES-1).
- Non-goals this slice (explicit): customer-segment (new/returning) proration; founder-salary &
  net-profit rungs; live per-SKU connector data (HELD at Child-3 cutover). Do NOT build them.

## Files to create / change (the ONLY staged paths)

**Create:**
1. `apps/analytics-service/src/application/pnl/__init__.py`
2. `apps/analytics-service/src/application/pnl/pnl_statement_query.py`
3. `apps/analytics-service/src/application/pnl/cm_waterfall_query.py`
4. `apps/analytics-service/tests/test_pnl_statement_query.py`
5. `apps/analytics-service/tests/test_cm_waterfall_query.py`
6. `apps/web/src/interfaces/components/pnl/pnl-content.tsx`
7. `apps/web/src/interfaces/components/pnl/pnl-statement-table.tsx`
8. `apps/web/src/interfaces/components/waterfall/waterfall-content.tsx`

**Change:**
9. `packages/lib-metrics/src/registry/definitions.ts` — ADD `VARIABLE_COSTS_MU`; CORRECT `CM1_MU` (3-arg honest); register both.
10. `packages/lib-metrics/src/registry/registry.test.ts` — add `variable_costs_mu` to completeness; add the cm1 formula correctness fixture (mirrors Python).
11. `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py` — ADD `_ROW_CM1`.
12. `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.md` — mirror the `_ROW_CM1` human row.
13. `pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json` — ADD `cm_ladder_formula` anchor group (optional but recommended for the non-vacuous gate).
14. `apps/api-gateway/src/domain/proto-types.ts` — ADD `PnlStatementRow`; `getPnlStatement` + `getCmWaterfall` on the port.
15. `apps/api-gateway/src/domain/registry-mapper.ts` — EXTEND `PNL_WATERFALL_DEFINITION_IDS` (variable_costs_mu, true_cm2_mu); add a P&L-statement field map.
16. `apps/api-gateway/src/infrastructure/loopback-data-plane.ts` — extend `SUGANDH_LOK_CANONICAL`; implement `getPnlStatement` + `getCmWaterfall`; re-point `getPnlWaterfall` to the honest builder.
17. `apps/api-gateway/src/application/router.ts` — ADD `pnlRouter` (pnl.statement, pnl.cmWaterfall); re-point `metrics.pnlWaterfall` to `getCmWaterfall`.
18. `apps/api-gateway/src/application/router.pnl.test.ts` (new) — positive values/ordering/cumulative + negative role/cross-workspace/orphan-rung.
19. `apps/web/src/app/(shell)/pnl/page.tsx` — swap ScaffoldPage → PnlContent.
20. `apps/web/src/app/(shell)/waterfall/page.tsx` — swap ScaffoldPage → WaterfallContent.

## Over-engineering self-check (7/7)

- No new primitive: reuses query gateway, DataPlanePort, format-money, registry, parity harness,
  requireRole, the EXISTING chart components.
- `variable_costs_mu` is a correctness ADD to match Python — not speculative.
- No new dependency (no npm/pip/uv add). The uv `tool.uv.sources` fix is a toolchain repair, not a dep add.
- No new runtime, no @paradigm LLM decorator.
- No speculative abstraction for future slices — segment/founder-salary are explicit non-goals.
- ONE CM-waterfall source of truth (re-point, not a 2nd path) — Single-Primitive Rule honored.
- Reversible additive; legacy untouched.

## Handoff to Stage 3

- **Maya:** registry fix (TS `variable_costs_mu` + corrected `cm1_mu` byte-identical to Python) +
  non-vacuous formula fixture + `_ROW_CM1` DDR row + the two analytics use-cases + Python tests.
  Owns parity-gate-green-AND-non-vacuous.
- **Vikram:** proto-types additions + StubDataPlane (extend canonical seed; implement both methods;
  re-point getPnlWaterfall) + registry-mapper extension + `pnlRouter` + re-point metrics.pnlWaterfall +
  router tests. Owns the BFF contract + tenancy choke + Single-Primitive re-point.
- **Ananya (consulted):** `/pnl` + `/waterfall` pages reusing the existing panel/chart + the new
  statement table, wired to the new procedures.

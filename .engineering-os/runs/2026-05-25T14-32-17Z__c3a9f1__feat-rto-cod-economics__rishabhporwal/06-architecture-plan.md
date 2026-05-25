# Architecture Plan — feat-rto-cod-economics (Stage 2, Aryan)

| Field | Value |
|-------|-------|
| **req_id** | `feat-rto-cod-economics` |
| **Stage** | 2 (binding plan) |
| **Architect** | Aryan |
| **Paradigm** | `@paradigm("sql")` — confirmed; zero inference path |
| **Shape** | feature-vertical on the slice-1/2 foundation: 5 new registry defs (TS+Python, parity-green, non-vacuous anchors) + 3 new DDR rows + 4 analytics use-cases + 4 DataPlanePort methods + a `logistics.*` tRPC group + 4 page wirings. Additive + reversible. Legacy untouched. Reuse Child-4 `rto_rate_bp`/`prepaid_rate_bp`, slice-1/2 query gateway, DataPlanePort, registry+parity harness, DDR, format-money. |

## Binding decisions

### D1 — Reuse, don't rebuild (anti-rework)

- `rto_rate_bp`, `prepaid_rate_bp`, `aov_mu` already in BOTH registries (Child-4) — REUSE, do NOT re-add.
- Query gateway (`query_metrics`, `UnscopedQueryError`, `MetricRow`, `DateRange`) — REUSE.
- `DataPlanePort` seam + `StubDataPlane` + `SUGANDH_LOK_CANONICAL` single seed — EXTEND, no second path.
- DDR machinery (`DDRRow`, `assert_signable`, Rules 1/2) — REUSE; add rows only.
- Parity gate `tools/check-metrics-parity.sh` + registry-dump/ddr-dump — REUSE; new defs flow through it.
- `formatMoney`, `requireRole`, `workspaceProc`, superjson bigint — REUSE.
- **Honest-input pattern (slice-1/2):** shipment-level operational facts are NOT gateway columns; they
  are EXPLICIT workspace-scoped use-case inputs (frozen dataclasses), exactly like `ReversalFacts` /
  `VariableCostFacts` / `RtoProvisionFacts`. They arrive live at the held Child-3 cutover.

### D2 — Five new metric definitions (TS↔Python byte-identical)

All added to BOTH `packages/lib-metrics/src/registry/definitions.ts` and
`pylibs/brain_metrics/brain_metrics/registry/definitions.py`, registered in both `METRIC_REGISTRY` maps.

1. **`rto_cost_mu`** (money/mu, scale=1) — passthrough aggregate: SUM of per-RTO-shipment charges.
   `formula = (rto_cost_mu) => rto_cost_mu`; `clickhouse_sql: toInt64(rto_cost_mu)`.
   parity_class=`shadow_compare`, **child_dependency `child-3-shopify-connector`** via DDR row (connector-sourced; unmeasurable pre-cutover — mirrors `_ROW_TOTAL_TAX`).
2. **`rto_revenue_lost_mu`** (money/mu, scale=1) — passthrough aggregate: SUM of RTO order/COD value.
   `formula = (rto_revenue_lost_mu) => rto_revenue_lost_mu`; `clickhouse_sql: toInt64(rto_revenue_lost_mu)`.
   parity_class=`shadow_compare`, child_dependency `child-3-shopify-connector` via DDR row.
3. **`cod_realization_rate_bp`** (ratio/bp, scale=10000) — `cod_delivered / cod_orders` in bp.
   `formula_ts: (cod_delivered, cod_orders) => ratioToBasisPoints(cod_delivered, cod_orders)`;
   `formula_py: _ratio_bp(cod_delivered, cod_orders)`;
   `clickhouse_sql: if(cod_orders > 0, intDiv(cod_delivered * 10000, cod_orders), NULL)`.
   parity_class=`shadow_compare` (legacy comparand exists: codDelivered/codOrders). NULL-guard on zero COD orders.
4. **`breakeven_cod_rto_rate_bp`** (ratio/bp, scale=10000) — the FULL legacy formula (Rohan/persona Concern 1).
   Inputs (integer paise / bp): `aov_mu` (V), `prepaid_rto_rate_bp` (P, in bp), `cod_fee_mu` (COD_fee),
   `gateway_fee_bp` (gateway %, in bp), `return_shipping_mu` (S), `restocking_mu` (RS).
   Computed with a SINGLE final FLOOR-to-bp (no chained float):
   ```
   pg_fee_mu   = intDiv(aov_mu * gateway_fee_bp, 10000)            # V·gatewayPct
   num_scaled  = aov_mu * prepaid_rto_rate_bp                       # V·P·10000  (P is bp)
               + (cod_fee_mu - pg_fee_mu) * 10000                   # (COD_fee − PG_fee)·10000
               + intDiv(prepaid_rto_rate_bp * (return_shipping_mu + restocking_mu) * 10000, 10000)  # P·(S+RS)·10000
   denom       = aov_mu + return_shipping_mu + restocking_mu
   breakeven_cod_rto_rate_bp = (denom > 0) ? intDiv(num_scaled, denom) : NULL   # already ×10000 ⇒ bp
   ```
   (Note: `num_scaled` carries the ×10000 because P is already in bp; dividing by `denom` yields bp directly.
   The `P·(S+RS)` term: `prepaid_rto_rate_bp·(S+RS)` is already ×10000, so it is added as-is.)
   parity_class=`correctness_fixture` (Brain-native canonical; legacy float is not a byte comparand) — DDR row + anchor.
   **Range note:** when result < 0 or > 10000, the use-case surfaces the legacy `breakEvenNote` instead of a rate; the registry value is the raw bp (use-case clamps/annotates for display).
5. **`pincode_reliability_score`** (count, unit=`count`, scale=1) — Brain-native integerized score in
   **centi-points** (0..10000, i.e. ×100 of the legacy 0..100). Inputs in bp/paise:
   ```
   raw = 10000
       - rto_bp * 2                                  # rtoRate(pp)·2 → rto_bp·2/100·100 = rto_bp·2 (centi-pts)
       - intDiv(cod_bp, 2)                           # codRate(pp)·0.5 → cod_bp/2 (centi-pts)
       + intDiv(repeat_bp, 2)                        # repeatRate(pp)·0.5 → repeat_bp/2
       + intDiv(aov_mu * 10 * 100, 1000 * 100)       # (aov/1000)·10 in centi-pts = intDiv(aov_mu, 1000) [paise→pts] ... see snapshot
   pincode_reliability_score = clamp(0, 10000, raw)
   ```
   The EXACT integer form is pinned in the DDR `_ROW_PINCODE_RELIABILITY.formula_snapshot` and mirrored
   byte-identically TS/Python. parity_class=`correctness_fixture`. Worked anchor distinguishes it from a
   naive float port. (Rates are bp = pp×100, so legacy `rtoRate·2` [pp] = `rto_bp·2/100` [pts] = `rto_bp·2` [centi-pts]; the snapshot fixes every coefficient.)

`rto_rate_bp` is REUSED (already shipped) for the /rto-analytics + /logistics + /pincode rate display.

### D3 — Make every new gate NON-VACUOUS (the slice-2 lesson)

Add cross-language formula anchors that FAIL the wrong formula and PASS the right one:
- **TS** (`registry.test.ts`): worked-example assertions for `breakeven_cod_rto_rate_bp` (=500bp on the
  Concern-1 inputs — fails the naive `M/(M+C)`), `pincode_reliability_score` (a pinned anchor), and
  `cod_realization_rate_bp`. Add the 5 ids to the completeness + correctness-fixture lists.
- **Python** (`test_registry.py`): the SAME numeric anchors (byte-identical inputs → byte-identical outputs).
- The registry-parity gate already enforces (a) structural fields for all shared ids, (b) clickhouse_sql
  whitespace-identity for correctness_fixture ids, (c) DDR formula_snapshot presence for every
  correctness_fixture id. The two new correctness_fixture ids
  (`breakeven_cod_rto_rate_bp`, `pincode_reliability_score`) therefore force matching SQL + DDR coverage —
  the gate bites automatically.

### D4 — Three new DDR rows (don't reconcile silently)

In `definitional_delta_register.py` (+ mirror `.md`):
1. **`_ROW_BREAKEVEN_COD_RTO`** (`brain_formula="breakeven_cod_rto_rate_bp"`, parity_gap=True,
   classification=CORRECTNESS_FIXTURE): legacy_formula `cod-prepaid-analytics.ts:218-231` (the FULL
   formula text); reason = Brain canonicalizes the full legacy break-even (NOT the naive M/(M+C)); the
   integer single-FLOOR-to-bp form; worked anchor (500bp). business_impact: COD-vs-prepaid policy is a
   top India-D2C margin lever; the naive form would mis-advise.
2. **`_ROW_PINCODE_RELIABILITY`** (`brain_formula="pincode_reliability_score"`, parity_gap=True,
   CORRECTNESS_FIXTURE): legacy_formula `pincode-intelligence.ts:60-66 (calcProfitabilityScore float)`;
   reason = Brain integerizes the float score to centi-points, deterministic, clamped [0,10000];
   formula_snapshot pins every integer coefficient; worked anchor.
3. **`_ROW_RTO_COST_VALUE`** (covers `rto_cost_mu` + `rto_revenue_lost_mu`; parity_gap=False,
   **child_dependency="child-3-shopify-connector"**, EXPECTED_DEFINITIONAL_DELTA): legacy_formula
   `shiprocket-charges.ts (rtoChargesFromRaw / shiprocketRtoRevenueLost)`; reason = connector-sourced
   per-shipment charges/value; unmeasurable pre-Child-3 (mirrors `_ROW_TOTAL_TAX`); not signable until
   the connector gate is GREEN (Rule 2). Register ONE row keyed `rto_cost_mu` documenting both (note the
   sibling `rto_revenue_lost_mu` in the reason), or two rows — implementer's choice, both covered.

No new DDR row for `cod_realization_rate_bp` (legacy comparand exists; shadow_compare, no delta).

### D5 — Four analytics use-cases (the application layer, occupants 4–7)

New `apps/analytics-service/src/application/logistics/`:
- `rto_analytics_query.py` — `RtoAnalyticsQuery.execute(workspace_id, date_range, rto_facts, *, _client)`.
  `RtoFacts` (frozen): total_shipments, rto_orders, rto_cost_mu, rto_revenue_lost_mu,
  cod_rto_orders, prepaid_rto_orders, by_courier (list of {courier, rto_count, rto_cost_mu, revenue_lost_mu}).
  Reads via `query_metrics(workspace_id, "rto_rate_bp", ...)` (fail-closed). Returns `RtoAnalytics`
  (rto_rate_bp from registry, totals, by-payment-method, by-courier). Money BIGINT.
- `cod_prepaid_query.py` — `CodPrepaidQuery.execute(workspace_id, date_range, cod_facts, fees, *, _client)`.
  `CodPrepaidFacts`: cod_orders, prepaid_orders, cod_delivered, cod_rto, prepaid_rto,
  gross_revenue_cod_mu, gross_revenue_prepaid_mu, rto_cost_cod_mu, rto_cost_prepaid_mu.
  `FeeInputs`: cod_fee_mu, gateway_fee_bp, return_shipping_mu, restocking_mu (=0).
  Computes `cod_realization_rate_bp`, `cod_rto_rate_bp`/`prepaid_rto_rate_bp` (reuse `rto_rate_bp` def
  on the COD/prepaid sub-denominators), effective revenue per segment, `breakeven_cod_rto_rate_bp` (full
  formula) + the `breakEvenNote` when out of [0,10000]. AOV from delivered/orders. All registry-formula.
- `logistics_query.py` — `LogisticsQuery.execute(workspace_id, date_range, log_facts, *, _client)`.
  `LogisticsFacts`: total_shipments, delivered_count, rto_count, cod_count, prepaid_count,
  forward_charges_mu, cod_charges_mu, rto_charges_mu, by_courier. Returns delivered%/rto% (reuse
  `rto_rate_bp`), charge breakdown (forward+cod+rto), avg shipping charge, by-courier.
- `pincode_intelligence_query.py` — `PincodeIntelligenceQuery.execute(workspace_id, date_range,
  pincode_facts, *, _client)`. `PincodeFacts`: list of per-pincode rows {pincode, city, state, tier,
  shipment_count, rto_count, cod_count, delivered_count, revenue_mu, unique_customers, repeat_customers}.
  Computes per-row `rto_bp`, `cod_bp`, `delivered_bp`, `repeat_bp`, `aov_mu`, and
  `pincode_reliability_score` (integer formula). Tier classification ported from legacy T1/T2 city sets
  (a small constant module). Filters (high-RTO ≥2000bp, high-COD ≥5000bp, min-orders, search/state) +
  sort live in the use-case/query params, NOT the registry.
- Each carries `@paradigm: sql`. Zero float in money/score paths. Zero LLM.
- `__init__.py` for the package.
- Tests: `tests/test_rto_analytics_query.py`, `tests/test_cod_prepaid_query.py`,
  `tests/test_logistics_query.py`, `tests/test_pincode_intelligence_query.py` — POSITIVE (worked
  examples incl. break-even 500bp + pincode anchor) + NEGATIVE (falsy workspace_id → UnscopedQueryError;
  cross-workspace isolation; naive-break-even regression mutant killed; zero-denominator NULL guards).

### D6 — Four DataPlanePort additive methods (the BFF seam)

`apps/api-gateway/src/domain/proto-types.ts` — ADD result row interfaces (all `_mu` bigint, `_bp`
number|null): `RtoAnalyticsResult`, `CodPrepaidResult` (+ `CodPrepaidSegmentRow`), `LogisticsResult`
(+ `LogisticsCourierRow`), `PincodeIntelligenceResult` (+ `PincodeRow`). ADD four methods on
`DataPlanePort`: `getRtoAnalytics`, `getCodPrepaid`, `getLogistics`, `getPincodeIntelligence` — same
seam, no second code path (CF-C6-DATA-SEAM-1). `StubDataPlane` implements all four from the EXISTING
`SUGANDH_LOK_CANONICAL` seed, EXTENDED with slice-3 operational facts
(shipments, rto/cod/prepaid/delivered counts, courier rows, fee inputs, pincode rows) chosen so:
- `rto_rate_bp` derived from (rto_orders/total_shipments) == the existing seed `1800` (cross-surface consistency),
- the break-even worked example reproduces 500bp,
- the pincode anchor reproduces its pinned score.

### D7 — tRPC `logistics.*` group

`apps/api-gateway/src/application/router.ts` — NEW `logisticsRouter`:
- `logistics.rto` — workspaceProc, requireRole(ANALYST), input {date_start,date_end}, returns
  {analytics, data_epoch, request_id}.
- `logistics.codPrepaid` — same guard; returns {result, data_epoch, request_id}.
- `logistics.summary` — same guard; returns {result, data_epoch, request_id}.
- `logistics.pincode` — same guard + optional filter inputs (search?, state?, min_orders?, high_rto?,
  high_cod?, sort?, order?); returns {rows, total_shipments, shipments_with_pincode, data_epoch, request_id}.
- Every money field bigint over superjson; every metric field traces the registry via a new
  `assertLogisticsDefinitionId` / extended traceability (registry-mapper). Mounted under root as `logistics`.

`apps/api-gateway/src/domain/registry-mapper.ts` — ADD `LOGISTICS_DEFINITION_IDS`
(`rto_rate_bp, rto_cost_mu, rto_revenue_lost_mu, cod_realization_rate_bp, prepaid_rate_bp,
breakeven_cod_rto_rate_bp, pincode_reliability_score, aov_mu`) + assert fns.

### D8 — Four page wirings (Ananya) — render-only, reuse shell

- `/rto-analytics`, `/cod-prepaid`, `/logistics`, `/pincode-intelligence`: replace `ScaffoldPage` with
  client content components calling the new `trpc.logistics.*` procedures. Every money value through
  `formatMoney`; every bp through the registry scale (/10000). request_id sr-only (CF-SEC-5); loading +
  error states; freshness label (data_epoch). ZERO arithmetic in the components (render-only). The
  break-even card shows the rate OR the note. The pincode page is a filterable/sortable table.

### D9 — Reversibility, residency, FX, GST, compliance

- All additive: 5 registry defs, 3 DDR rows, 4 use-cases, 4 port methods, 1 tRPC group, 4 page swaps.
  No migration of existing data, no live DDL. Reversal = revert the registry/DDR edits + drop new files
  + restore the 4 scaffold pages + remove the logistics router.
- FX poison NOT ported (these modules don't use it; confirm none introduced).
- Per-SKU GST untouched (`total_tax_mu` unchanged; `_ROW_TOTAL_TAX` child_dependency intact).
- ap-south-1 residency carried.
- No outbound channel — no DLT/NCPR/calling-hours trigger. Read-only analytics; no Decision-Log write.
- Non-goals (explicit, DO NOT build): NDR metric (no honest pre-Child-3 source); RTO risk-scoring ML;
  pincode predictive model; multi-tenant rollout beyond anchor; live per-courier/per-SKU connector data.

## Files to create / change (the ONLY staged paths)

**Create:**
1. `apps/analytics-service/src/application/logistics/__init__.py`
2. `apps/analytics-service/src/application/logistics/rto_analytics_query.py`
3. `apps/analytics-service/src/application/logistics/cod_prepaid_query.py`
4. `apps/analytics-service/src/application/logistics/logistics_query.py`
5. `apps/analytics-service/src/application/logistics/pincode_intelligence_query.py`
6. `apps/analytics-service/src/application/logistics/city_tiers.py` (T1/T2 city constant sets — ported)
7. `apps/analytics-service/tests/test_rto_analytics_query.py`
8. `apps/analytics-service/tests/test_cod_prepaid_query.py`
9. `apps/analytics-service/tests/test_logistics_query.py`
10. `apps/analytics-service/tests/test_pincode_intelligence_query.py`
11. `apps/api-gateway/src/application/router.logistics.test.ts`
12. `apps/web/src/interfaces/components/logistics/rto-analytics-content.tsx`
13. `apps/web/src/interfaces/components/logistics/cod-prepaid-content.tsx`
14. `apps/web/src/interfaces/components/logistics/logistics-content.tsx`
15. `apps/web/src/interfaces/components/logistics/pincode-intelligence-content.tsx`

**Change:**
16. `packages/lib-metrics/src/registry/definitions.ts` — ADD 5 defs; register in METRIC_REGISTRY; export.
17. `packages/lib-metrics/src/registry/index.ts` — export the 5 new defs (barrel).
18. `packages/lib-metrics/src/registry/registry.test.ts` — completeness + correctness-fixture lists + non-vacuous anchors.
19. `pylibs/brain_metrics/brain_metrics/registry/definitions.py` — ADD 5 defs; register in METRIC_REGISTRY.
20. `pylibs/brain_metrics/brain_metrics/registry/__init__.py` — export if barrelled.
21. `pylibs/brain_metrics/tests/test_registry.py` — mirror the non-vacuous anchors.
22. `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py` — ADD 3 DDR rows + register.
23. `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.md` — mirror the 3 human rows.
24. `apps/api-gateway/src/domain/proto-types.ts` — ADD result row interfaces + 4 port methods.
25. `apps/api-gateway/src/domain/registry-mapper.ts` — ADD LOGISTICS_DEFINITION_IDS + assert fns.
26. `apps/api-gateway/src/infrastructure/loopback-data-plane.ts` — extend canonical seed; implement 4 methods.
27. `apps/api-gateway/src/application/router.ts` — ADD logisticsRouter; mount under `logistics`.
28. `apps/web/src/app/(shell)/rto-analytics/page.tsx` — swap ScaffoldPage → RtoAnalyticsContent.
29. `apps/web/src/app/(shell)/cod-prepaid/page.tsx` — swap ScaffoldPage → CodPrepaidContent.
30. `apps/web/src/app/(shell)/logistics/page.tsx` — swap ScaffoldPage → LogisticsContent.
31. `apps/web/src/app/(shell)/pincode-intelligence/page.tsx` — swap ScaffoldPage → PincodeIntelligenceContent.

## Over-engineering self-check (7/7)

- No new primitive: reuses query gateway, DataPlanePort, format-money, registry, parity harness, DDR,
  requireRole, `_ratio_bp`/`ratioToBasisPoints`. New defs are the minimal econ set, not speculative.
- `rto_rate_bp`/`prepaid_rate_bp`/`aov_mu` reused, NOT re-added.
- No new dependency (no npm/pip/uv add).
- No new runtime, no @paradigm LLM decorator.
- No speculative abstraction: NDR / risk-ML / predictive model are explicit non-goals.
- Single-Primitive Rule: ONE def per concept; the use-cases assemble, the registry owns formulas.
- Reversible additive; legacy untouched.

## Handoff to Stage 3

- **Maya:** 5 registry defs (TS+Python byte-identical) + non-vacuous anchors (break-even 500bp, pincode
  anchor, cod-realization) + 3 DDR rows + the 4 analytics use-cases + city_tiers + Python tests. Owns
  parity-gate-green-AND-non-vacuous + the full-legacy break-even formula correctness.
- **Vikram:** proto-types result rows + 4 port methods + StubDataPlane seed extension (consistent with
  the existing rto_rate_bp=1800 seed + break-even/pincode anchors) + registry-mapper LOGISTICS ids +
  logisticsRouter + router tests. Owns the BFF contract + tenancy choke + registry traceability.
- **Ananya:** the 4 page contents wired to `trpc.logistics.*`, render-only, formatMoney + scale, reusing
  the shell. Owns the 4 live pages.

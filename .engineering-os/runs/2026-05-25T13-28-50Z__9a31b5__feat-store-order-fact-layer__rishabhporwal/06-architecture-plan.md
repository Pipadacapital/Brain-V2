# Architecture Plan — feat-store-order-fact-layer (Stage 2, Aryan)

| Field | Value |
|-------|-------|
| **req_id** | `feat-store-order-fact-layer` |
| **Stage** | 2 (binding plan) |
| **Architect** | Aryan |
| **Paradigm** | `@paradigm("sql")` — confirmed; zero inference path |
| **Shape** | feature-vertical: registry defs + analytics use-case + DataPlanePort method + 2 tRPC procedures + `/store` page wiring + dashboard re-point. Additive + reversible. Legacy untouched. |

## Binding decisions

### D1 — Revenue ladder, defined honestly, registered in BOTH registries

The slice's revenue ladder, Gross → Net → Net-of-tax → **Realized**:

| Metric | Formula (integer, paise) | parity_class | Notes |
|---|---|---|---|
| `gross_sales_mu` | `SUM(line_item.price_mu × qty)` | shadow_compare | EXISTS in Python registry; **ADD to TS registry** (passthrough) |
| `total_discount_mu` | `SUM(line_item.discount_mu)` | shadow_compare | EXISTS in Python; **ADD to TS** |
| `total_tax_mu` | `SUM(per-SKU GST line tax via RegionAdapter India)` | shadow_compare | EXISTS in Python; **ADD to TS**; DDR row already present (child-3 dep) |
| `net_sales_mu` | `gross_sales_mu − total_discount_mu` | shadow_compare | reconcile TS↔Py shape (see D2) |
| `net_sales_net_tax_mu` | `net_sales_mu − total_tax_mu` | shadow_compare | the GST-honest line; TS currently calls this `net_net_tax_mu` (see D2) |
| `net_revenue_mu` | `net_sales_net_tax_mu + shipping_revenue_mu` | shadow_compare | EXISTS both sides |
| `realized_revenue_mu` | `net_revenue_mu − cancelled_revenue_mu − rto_reversed_revenue_mu − refunded_revenue_mu` | **correctness_fixture (parity_gap:true)** | **NET-NEW; NO legacy comparand → new DDR row** |
| `order_count` | `COUNT(orders)` | (count; no registry formula) | passthrough |
| `aov_mu` | `intDiv(net_sales_mu, order_count)` | shadow_compare | EXISTS both sides |

### D2 — Registry asymmetry reconciliation (CRITICAL — do not break the parity gate)

The TS registry (Child-6 line) and Python registry (Child-4 line) drifted on the early ladder:
- TS `net_sales_mu` = `gross − returns − discounts`; Python `net_sales_mu` = `gross − total_discount`.
- TS has `net_net_tax_mu`; Python has none (uses `net_revenue_mu = net_sales − total_tax`).

The parity gate treats a metric present in BOTH as requiring structural-field equality, and SQL
equality only for `correctness_fixture`. `net_sales_mu` is `shadow_compare` on both sides, so the gate
checks `id/kind/unit/scale/display_only/parity_class` (which ALREADY match) — NOT the formula text for
shadow_compare. **Binding rule:** the new defs I add MUST keep `id/kind/unit/scale/display_only/
parity_class` byte-identical across TS↔Py. The formula *shapes* may differ where a DDR row documents
the divergence; for genuinely Brain-native metrics (`realized_revenue_mu`) the SQL text MUST match
(correctness_fixture gate) and a DDR formula_snapshot MUST be present.

- **ADD to TS registry** (to match Python, structural fields identical): `gross_sales_mu`,
  `total_discount_mu`, `total_tax_mu` (passthrough defs). These reduce the "Python-only" asymmetry and
  light up the `/store` ladder end-to-end. Keep `scale:1`, `kind:money`, `unit:mu`,
  `display_only:false`, `parity_class:shadow_compare` — byte-identical to Python.
- **ADD to BOTH registries**: `realized_revenue_mu` (correctness_fixture, parity_gap:true) with a
  byte-identical `clickhouse_sql`, plus a new DDR row `_ROW_REALIZED_REVENUE` with `parity_gap=True`
  and a pinned `formula_snapshot`. The parity gate's Phase-3 check REQUIRES every
  correctness_fixture metric to have a DDR formula_snapshot — so the DDR row is mandatory, not optional.
- **DO NOT** rename `net_net_tax_mu`. Renaming would break Child-6's KPI strip + waterfall. The
  `/store` page uses `net_net_tax_mu` as the "Net of tax" rung label; the slice spec's
  `net_sales_net_tax_mu` is the *concept*, satisfied by the existing `net_net_tax_mu` def. Add a code
  comment mapping the spec name → existing id. (Single-Primitive Rule: ONE def for the concept.)

### D3 — Per-SKU GST 2.0 via the India RegionAdapter — NEVER blended

There is NO RegionAdapter in Brain code yet (verified). This slice introduces the **minimal** India
GST adapter as a pure function home (NOT a speculative multi-region framework — that is Phase 4):
- New file `apps/analytics-service/src/domain/region/india_gst.py` — a pure function
  `gst_line_tax_mu(line_price_mu: int, gst_slab_bp: int) -> int` returning
  `intDiv(line_price_mu * gst_slab_bp, 10000)` (integer, FLOOR), plus the canonical GST 2.0 slab set
  `{0, 500, 1800, 4000}` bp (0/5/18/40%). `total_tax_mu = SUM(gst_line_tax_mu(...))` over line items —
  **per-SKU, never a day-level blended rate.**
- **Honesty constraint:** live per-SKU line-item tax data flows from the Child-3 connector, which is
  HELD at cutover. So for the runnable smoke, the anchor-workspace facts are seeded per-SKU (the
  StubDataPlane already feeds per-day facts; the store ladder is fed the SAME way through the
  DataPlanePort). The `total_tax_mu` DDR row stays `child_dependency: child-3-shopify-connector` —
  **the blended legacy value is NOT silently matched.** The adapter proves the per-SKU mechanism; the
  cutover wires live per-SKU data. This is the same "prove the mechanism, hold the cutover" discipline
  every layer-child used.

### D4 — analytics-service use-case (the EMPTY application layer, first occupant)

New `apps/analytics-service/src/application/store/store_summary_query.py`:
- `StoreSummaryQuery.execute(workspace_id, date_range)` reads through the EXISTING
  `query_gateway.query_metrics(workspace_id, definition_id, date_range)` — workspace_id is the first
  positional, non-optional param (inherits `UnscopedQueryError` fail-closed). NO new DB access path.
- Assembles the revenue-ladder rungs from the returned `MetricRow`s using registry defs (no ad-hoc
  arithmetic outside the registry formulas). Returns a `StoreSummary` value object (frozen dataclass,
  all `_mu` int).
- `@paradigm: sql` header. Zero float, zero LLM.

### D5 — DataPlanePort additive method (the BFF data seam)

`apps/api-gateway/src/domain/proto-types.ts`: add `StoreSummaryRow` + `StoreRevenueLadderStep`
interfaces (all `_mu` bigint) and ONE additive method on `DataPlanePort`:
`getStoreSummary({workspace_id, date_range}) → { summary, ladder, data_epoch }`. This mirrors the
Child-6 hand-authored proto-types pattern (the in-process contract until buf generate). The
`StubDataPlane` (and the real `LoopbackDataPlane` later) implement it through the SAME contract — no
second code path (CF-C6-DATA-SEAM-1). The stub derives the ladder from the existing seeded
`SUGANDH_LOK_KPI` + per-day rows so the numbers are internally consistent with the dashboard.

### D6 — tRPC procedures (the handshake for Ananya)

`apps/api-gateway/src/application/router.ts`: new `storeRouter`:
- `store.summary` — `workspaceProc`, `requireRole('ANALYST')`, input `{date_start, date_end}` (ISO),
  returns `{ summary, ladder, data_epoch, request_id }`. `summary._mu` are bigint (superjson).
- `store.revenueLadder` — `workspaceProc`, `requireRole('ANALYST')`, returns `{ ladder, data_epoch,
  request_id }` where each step `{ definition_id, label, value_mu, currency_code }`. Every
  `definition_id` MUST trace to the registry (extend `assertWaterfallDefinitionId` coverage OR add a
  `assertLadderDefinitionId` using the registry — reuse, don't fork).
- Mounted under the root router as `store`.

### D7 — Frontend `/store` page wiring (Ananya)

- `apps/web/src/app/(shell)/store/page.tsx`: replace `ScaffoldPage` with a `StoreContent` client
  component (same shape as `DashboardContent`).
- New `apps/web/src/interfaces/components/store/revenue-ladder-strip.tsx`: renders the
  Gross→Net→Net-of-tax→Realized rungs via `trpc.store.revenueLadder.useQuery`, each rung through
  `formatMoney` (the ONE canonical formatter). `@paradigm: sql` render-only; zero arithmetic;
  data-freshness label from `data_epoch`; request_id in an sr-only node (CF-SEC-5).
- **Dashboard re-point:** the dashboard's revenue rung should read the SAME canonical ladder. Minimal,
  safe re-point: the KPI strip's `net_revenue_mu` already comes from `kpiSummary` which is registry-
  derived from the same seed; to satisfy "dashboard reading the same canonical facts instead of the
  seed stub" WITHOUT a risky rewrite, the StubDataPlane's `getKpiSummary` and `getStoreSummary` MUST
  derive from ONE shared seed source (single source of truth in the stub), so the `/store` ladder and
  the dashboard KPI are provably the same numbers. Document this as the canonical-fact-source unifying
  step. (A full dashboard rewrite to call `store.summary` is deferred — out of slice-1 scope; the
  unifying-seed step delivers the "same canonical facts" guarantee reversibly.)

### D8 — Reversibility + residency

- All new facts are ADDITIVE derived defs + a seed-fed read path. No migration of existing data, no
  live DDL executed (the CH base table migration stays runbook-gated as Child-4 left it). Dropping the
  new files + reverting the 3 registry additions fully reverses the slice.
- ap-south-1 residency carried (CF-RES-1); no out-of-region read.

## Files to create / change (the ONLY staged paths)

**Create:**
1. `apps/analytics-service/src/domain/region/__init__.py`
2. `apps/analytics-service/src/domain/region/india_gst.py` — per-SKU GST adapter (pure fn)
3. `apps/analytics-service/src/application/store/__init__.py`
4. `apps/analytics-service/src/application/store/store_summary_query.py` — use-case
5. `apps/analytics-service/tests/test_india_gst.py`
6. `apps/analytics-service/tests/test_store_summary_query.py`
7. `apps/web/src/interfaces/components/store/revenue-ladder-strip.tsx`
8. `apps/web/src/interfaces/components/store/store-content.tsx`

**Change:**
9. `packages/lib-metrics/src/registry/definitions.ts` — ADD `gross_sales_mu`, `total_discount_mu`, `total_tax_mu`, `realized_revenue_mu`
10. `pylibs/brain_metrics/brain_metrics/registry/definitions.py` — ADD `realized_revenue_mu`
11. `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py` — ADD `_ROW_REALIZED_REVENUE`
12. `apps/api-gateway/src/domain/proto-types.ts` — ADD `StoreSummaryRow`, `StoreRevenueLadderStep`, `getStoreSummary` on the port
13. `apps/api-gateway/src/domain/registry-mapper.ts` — ADD store-ladder definition-id assertion (reuse registry)
14. `apps/api-gateway/src/infrastructure/loopback-data-plane.ts` — implement `getStoreSummary` on StubDataPlane from a UNIFIED seed source
15. `apps/api-gateway/src/application/router.ts` — ADD `storeRouter` (store.summary, store.revenueLadder)
16. `apps/web/src/app/(shell)/store/page.tsx` — swap ScaffoldPage → StoreContent
17. Tests: `apps/api-gateway/src/application/router.store.test.ts` (new), extend parity fixtures if needed

## Over-engineering self-check (7/7)

- No new primitive: reuses query gateway, DataPlanePort, format-money, registry, parity harness, requireRole.
- India GST adapter is a single pure function + slab constant — NOT a multi-region framework (Phase 4).
- No new dependency (no npm/pip/uv add).
- No new runtime, no @paradigm LLM decorator.
- No speculative abstraction for "future slices" — only what slice 1 lights up.
- realized_revenue_mu is the ONLY net-new metric; everything else is reuse/passthrough.
- Reversible additive; legacy untouched.

## Handoff to Stage 3

- **Maya (intelligence/metrics engineer):** registry defs (TS+Py) + DDR row + the India GST adapter +
  analytics use-case + Python tests. Owns the parity-gate-green guarantee.
- **Vikram (backend):** DataPlanePort method + StubDataPlane unified-seed impl + registry-mapper
  assertion + storeRouter + router tests. Owns the BFF contract + tenancy choke.
- **Ananya (frontend, consulted):** `/store` page + revenue-ladder strip wired to the new procedures.

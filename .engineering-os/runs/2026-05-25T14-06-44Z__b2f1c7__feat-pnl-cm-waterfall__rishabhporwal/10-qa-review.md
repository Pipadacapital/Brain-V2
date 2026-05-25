# QA Review — feat-pnl-cm-waterfall (Stage 5, Tanvi)

| Field | Value |
|-------|-------|
| **req_id** | `feat-pnl-cm-waterfall` |
| **Stage** | 5 (QA / real-network smoke / parity / trace) |
| **Verdict** | **PASS** (advances to Stage 6) |

## Test runs (captured)

| Suite | Result |
|-------|--------|
| TS↔Python registry parity gate (`tools/check-metrics-parity.sh`) | **PASS** — non-vacuous (killed-mutant sub-step PASS); 21 shared structural-match; correctness_fixture SQL + DDR coverage PASS |
| brain_metrics (Python) | **291 passed** |
| analytics-service (Python) | **76 passed** (61 baseline + 15 new pnl use-case tests) |
| api-gateway (TS, vitest) | **52 passed** (40 baseline + 12 new pnl router tests) |
| lib-metrics (TS, vitest) | **130 passed** (incl. 4 new CM-ladder cross-language anchors) |
| web (TS, vitest) | **42 passed** |
| typecheck lib-metrics / api-gateway / web | **exit 0 / 0 / 0** |

## Real-network smoke (api-gateway :3001, fresh boot on slice-2 code)

A stale gateway (pre-slice-2) was found on :3001 returning `NOT_FOUND` for `pnl.statement`;
killed and rebooted on the slice-2 build. Captured wire results (superjson, bigint as string):

**`pnl.statement`** — honest CM ladder:
```
net_revenue_mu=185000000  cogs_mu=82000000  variable_costs_mu=6000000
cm1_mu=97000000   (= net_revenue − cogs − variable_costs; NOT the old COGS-only 103000000)
total_ad_spend_mu=65000000  cm2_mu=32000000  misc_expenses_prorated_mu=4000000  cm3_mu=28000000
true_cm2_mu=4516440  order_count=1247
```
True-CM2 independently re-derived: cost_base=153000000, rto_provision=intDiv(224×153000000,1247)=27483560,
true_cm2=32000000−27483560=4516440 ✓ (matches the wire). True-CM2 < CM2 (RTO bites).

**`pnl.cmWaterfall`** — signed cumulative steps; cumulative invariant holds at every CM subtotal:
```
net_revenue_mu  +185000000 | cum 185000000
cogs_mu          -82000000 | cum 103000000
variable_costs_mu -6000000 | cum  97000000
cm1_mu           +97000000 | cum  97000000   ✓ invariant
total_ad_spend_mu -65000000 | cum 32000000
cm2_mu           +32000000 | cum  32000000   ✓ invariant
misc_expenses_…   -4000000 | cum 28000000
cm3_mu           +28000000 | cum  28000000   ✓ invariant
```

**`metrics.pnlWaterfall`** (re-pointed Child-6 alias) returns IDENTICAL steps with cm1=97000000 —
ONE CM-waterfall source of truth confirmed (the pre-slice-2 alias would have shown cm1=103000000).

**Tenancy fail-closed (wire):** a foreign `x-workspace-id` → `UnscopedQueryError ... not authorized`
(no data leak). Orphan path → `NOT_FOUND`. VIEWER → FORBIDDEN (unit). Cross-ws (unit) → fail-closed.

## Web smoke (web :3000, webpack — NOT turbopack, per the brief)

A stale web process on :3000 was killed; rebooted with `next dev --webpack`. Captured:
- `GET /pnl` → **HTTP 200**; ScaffoldPage GONE (0 occurrences); renders the slice-2 P&L shell.
- `GET /waterfall` → **HTTP 200**; ScaffoldPage GONE (0 occurrences); renders the slice-2 waterfall shell.
- web→gateway data path verified with web-origin CORS (`pnl.cmWaterfall` cm3 cum = 28000000).
- The SSR HTML shows the client auth-guard ("Not signed in") — expected (session is client-hydrated
  post-login, identical to slice-1's `/store`). The data render happens client-side via the BFF, which
  the wire smoke + BFF contract tests prove correct.

## Trace / correlation
- `request_id` is returned on every new procedure and surfaced sr-only in the P&L table (CF-SEC-5).
- The gateway logs the 4-tuple (requestId/traceId/workspaceId/userId) per request.

## Negative-scenario coverage (per the code-clarity + coverage standard)
- analytics use-cases: empty/whitespace workspace_id → UnscopedQueryError; cross-ws isolation (no 3×
  leak); context-less → zero ladder; the COGS-only cm1 regression mutant killed.
- api-gateway: VIEWER → FORBIDDEN (both procedures); cross-ws → fail-closed; orphan P&L line → G-REGISTRY-ONLY throws.
- registry: the cm1 cross-language anchor fails the old COGS-only formula and passes the honest one.

## Verdict
**PASS.** All suites green, parity non-vacuous, live smoke confirms honest minor-unit CM values on the
wire, both pages serve real slice-2 content, tenancy fail-closed end-to-end. Advances to Stage 6.

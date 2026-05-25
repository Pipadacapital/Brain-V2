# Requirement — feat-rto-cod-economics (Phase-2 slice 3)

| Field | Value |
|-------|-------|
| **req_id** | `feat-rto-cod-economics` |
| **parent_epic** | `epic-phase2-feature-parity` (child of `chore-migrate-legacy-to-brain`) |
| **slice** | 3 of 9 |
| **blocks** | `feat-store-order-fact-layer` (slice 1 — status: approved/shipped ✓) |
| **filed_by** | Rohan (CTO Advisor) on standing Founder delegation |

## Problem

The `/rto-analytics`, `/cod-prepaid`, `/logistics`, and `/pincode-intelligence` pages are
dead scaffolds. The single largest controllable Indian-D2C margin leak — RTO + COD economics
+ pincode reliability — has NO Brain-native computation. Legacy
`lib/workspace-metrics/{rto-analytics,cod-prepaid-analytics,logistics-summary,pincode-intelligence}.ts`
own these computations; they are Shiprocket-first, money in `Number` (float, `Math.round(x*100)/100`),
zero RLS, zero registry traceability.

## Smallest safe reversible thing that ships 4 real pages end-to-end

Map the four legacy lib modules into Brain-native analytics use-cases on slice-1's foundation:

1. **Metric registry (TS↔Python parity):** add the operational/economics defs —
   `rto_cost_mu`, `rto_revenue_lost_mu`, `cod_realization_rate_bp`,
   `breakeven_cod_rto_rate_bp`, `pincode_reliability_score`. Each byte-identical TS/Python,
   CI parity-green, with a **non-vacuous cross-language formula anchor** (the slice-2 lesson).
   Reuse the already-shipped `rto_rate_bp` / `prepaid_rate_bp` (Child-4) — do NOT re-add.
2. **DDR rows** for every Brain-native econ metric (no legacy comparand → correctness_fixture)
   and for any legacy formula Brain canonicalizes differently. In particular the legacy
   break-even formula is NOT the slice-table's naive `r*=M/(M+C)` — register the full legacy
   formula vs Brain's canonical form as a definitional delta. **Read the legacy formula; do not assume.**
3. **analytics-service use-cases:** `RtoAnalyticsQuery`, `CodPrepaidQuery`, `LogisticsQuery`,
   `PincodeIntelligenceQuery` — each reads workspace-scoped facts through the query gateway
   (fail-closed `workspace_id`), accepts shipment-level operational facts (status/payment/
   courier/pincode counts, RTO charges, fees) as EXPLICIT workspace-scoped inputs (the slice-2
   honest-input pattern; these arrive live at the held Child-3 connector cutover, NOT as gateway
   columns). Money BIGINT paise. `@paradigm("sql")`.
4. **tRPC `logistics.*` group:** `logistics.rto`, `logistics.codPrepaid`, `logistics.summary`,
   `logistics.pincode` — workspaceProc, requireRole(ANALYST), `_mu` bigint over superjson,
   registry-traced.
5. **Frontend:** wire all four pages to render the live ported data inside the shell.

## Acceptance bar (binding inputs for Aryan/Shreya/Tanvi)

- RLS proven fail-closed on every new query (foreign workspace_id → UnscopedQueryError, no leak).
- Money exact-integer minor units; per-SKU GST never blended; FX poison absent.
- New registry defs TS↔Python parity CI green; every new gate NON-VACUOUS (formula anchor that
  fails the wrong formula, passes the right one).
- Any CM2/legacy definitional delta REGISTERED in the DDR (correctness-fixture, not silently float-matched).
- `@paradigm("sql")` on every new file; zero LLM/ML this slice (pincode reliability ≥ threshold = SQL;
  risk-scoring ML is a later slice only if persona-proven — NOT built here).
- Real-network smoke PASS: all 4 pages render real anchor-brand (Sugandh Lok) data end-to-end.
- Reversible additive; legacy untouched; zero behavior change to other slices/Phase-1.
- Scope strictly slice-3 pages + backend. No outbound channel (no DLT/NCPR trigger).

## Non-goals (explicit)

- Per-SKU/per-courier live connector data (HELD at Child-3 cutover).
- RTO risk-scoring ML / pincode predictive model (later slice; SQL reliability score only).
- Multi-tenant rollout beyond the anchor workspace.
- Any write/recommendation/Decision-Log action (read-only analytics).

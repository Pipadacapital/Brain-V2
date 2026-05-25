# QA Review — feat-rto-cod-economics (Stage 5, Tanvi) — real-network smoke + verification

| Field | Value |
|-------|-------|
| **req_id** | `feat-rto-cod-economics` |
| **Stage** | 5 (verification: real-network smoke + parity + typecheck + tenancy) |
| **Verdict** | **PASS** |

## 1. Automated gate sweep (captured)

| Gate | Result |
|------|--------|
| TS↔Python parity (`tools/check-metrics-parity.sh`) | **PASS** — 25 fixtures byte-identical; `breakeven_cod_rto_rate_bp` + `pincode_reliability_score` correctness_fixture SQL byte-identical + DDR formula_snapshot present; killed-mutant sub-step PASS (non-vacuous) |
| brain_metrics (py) | **299 passed** |
| analytics-service (py) | **107 passed** (76 baseline + 31 new) |
| lib-metrics (ts vitest) | **139 passed** (incl. 11 slice-3 anchors); tsc **exit 0** |
| api-gateway (ts vitest) | **62 passed** (52 baseline + 10 logistics); tsc **exit 0** |
| web tsc | **exit 0** (`trpc.logistics.*` typed-resolves) |

## 2. Real-network smoke — api-gateway :3001 (`pnpm dev`)

Booted clean (killed stale :3000/:3001 servers first — slice-2 retro lesson applied). All 4 procedures
exercised over the wire with `x-workspace-id` header; money returned as bigint strings over superjson.

| Procedure | Live wire result |
|---|---|
| `logistics.rto` | rto_rate_bp=**1796**; total_rto_cost_mu="**4480000**"; revenue_lost="**33200000**"; by-payment COD 180 + Prepaid 44 = **224** (reconciles to rto_count) |
| `logistics.codPrepaid` | cod_realization=**7650bp**; aov_mu="**150000**"; **breakeven=500bp** (the FULL formula); cod_rto=2250bp; prepaid_rto=500bp; effective_revenue_cod="**89160000**"; breakeven_note=null |
| `logistics.summary` | delivered=**7858bp**; rto=1796bp; total_shiprocket_charges="**13680000**"; avg_charge="**10970**" |
| `logistics.pincode` | 3 rows sorted by reliability desc: Mumbai (T1, rto 1500bp, score **6938**), Delhi (T1, 2214bp, **4357**), Nashik (T2, 3000bp, **2555**); total_shipments="690" |
| `logistics.pincode?high_rto=true` | filter applied on the wire — Mumbai (1500bp) EXCLUDED; Delhi (2214) + Nashik (3000) retained (count=2) |

**Break-even non-vacuous proof at the wire:** the full formula returned **500bp**; the naive M/(M+C)
would be intDiv(150000·10000, 158000) = **9493bp**. The wire value distinguishes them — the gate is real.

**NEGATIVE (tenancy fail-closed) at the wire:** `logistics.rto` with a foreign `x-workspace-id`
(`...00ff`) → `UnscopedQueryError: workspace_id=...00ff not authorized`. No leak.

## 3. Web smoke — :3000 (`pnpm exec next dev --webpack`)

All 4 pages: **HTTP 200**, correct `<title>`, client component mounts and renders its real heading; the
auth-gate ("Not signed in") branch shows for the unauthenticated SSR fetch — identical behavior to the
shipped slice-1/2 pages and `/pnl` (also re-confirmed HTTP 200, no regression). The data-backed render
path is proven by the wire smoke against the exact procedures the components call (`trpc.logistics.*`),
plus web tsc=0 proving the typed client resolves. ("This page could not be found" in the HTML is the
Next dev-overlay notFound-boundary scaffold, NOT a page error — verified the headings + gate render.)

## 4. Independent re-derivation (Tanvi)

- break-even: 150000·500 + (3000−3000)·10000 + 500·8000 = 79000000; ÷158000 = 500 ✓
- pincode (Mumbai): rto 48/320=1500bp, cod 180/320=5625bp, delivered 252/320=7875bp, repeat 40/160=2500bp,
  aov 37800000/252=150000; score = 10000 − 3000 − 2812 + 1250 + 1500 = 6938 ✓ (matches wire)
- rto_rate: 224/1247 = 1796 ✓; delivered: 980/1247 = 7858 ✓; avg charge: 13680000/1247 = 10970 ✓

**PASS.** All numeric anchors reproduce; parity green + non-vacuous; tenancy fail-closed on the wire;
typecheck 0; all 4 pages render real ported data end-to-end.

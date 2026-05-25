# QA Review — feat-marketing-acquisition (Stage 5, Tanvi)

@paradigm: sql · slice 4 of `epic-phase2-feature-parity`

All gates run with captured output. POSITIVE + NEGATIVE per the code-clarity + coverage standard.

## 1. Parity gate (TS↔Python byte-identity, non-vacuous)

`bash tools/check-metrics-parity.sh` → **PASS**
- 25 golden fixture vectors byte-identical.
- 31 shared metrics structural-match. PY-only (shadow): `cac_payback_months` (slice-5), `cogs_mu`, `total_ad_spend_mu`. TS-only: `net_net_tax_mu`. (No marketing def is unevenly split anymore — `mer_bp`/`cac_mu` now shared; `pamer_bp` removed.)
- Killed-mutant 1: `amer_bp` "use total spend" SQL → detected (gate retargeted from decommissioned `pamer_bp`). Killed-mutant 2: `ltv_cac_bp` rename → detected. **Non-vacuous.**
- correctness_fixture SQL + DDR snapshot coverage: PASS (`amer_bp` snapshot now = `intDiv(new_customer_revenue_mu * 10000, acquisition_ad_spend_mu)`).

## 2. Unit / formula tests

| Suite | Result |
|---|---|
| `packages/lib-metrics` (TS registry + canon) | **142 passed** |
| `pylibs/brain_metrics` (registry + locked-canon + DDR) | **299 passed** |
| `apps/analytics-service` (full) | **136 passed** (29 net-new marketing use-case tests) |
| `apps/api-gateway` (full) | **73 passed** (11 net-new marketing router tests) |

Net-new non-vacuous anchors: aMER 15000bp on a **classification split** (acq ₹40k < total ₹100k) with a "use total spend"→6000bp KILL; MER 12000bp; CAC ₹500; CM2-per-NC ₹100; distributions mode tie-break = lowest value; RTO new-customer order → 0 revenue + 0 CM2.

## 3. Real-network smoke — api-gateway :3001 (`pnpm dev`)

Booted clean (killed stale :3000/:3001 first — slice-2 retro lesson). `/health` → ok. All 3 procedures over the wire (superjson; money as bigint strings):

| Procedure | Wire result |
|---|---|
| `marketing.efficiency` | `mer_bp=29384` (191M/65M), `amer_bp=30000` (78M/26M — **acquisition spend, not total**), `acos_bp=3403`, `blended_roas_x100=293`; net_revenue_mu=`"191000000"` (bigint). MER numerator == /store net revenue (cross-surface consistent). |
| `marketing.acquisition` | `cac_mu=16250` (₹162.50 = 65M/4000), `cm2_per_nc_mu=3250`, `amer_bp=30000`, meta `39000000` / google `26000000`, 2 daily rows sorted ascending (CAC 16250, aMER 30000 each). |
| `marketing.distributions` (cm1) | 3 products; Oud mode=48000 mean=72000 diff=-24000; 60 histogram buckets; global_mode=48000 global_mean=45000. |
| **NEGATIVE** `marketing.efficiency` w/ foreign `x-workspace-id` | **`UnscopedQueryError: workspace_id=…00ff not authorized`** — RLS fail-closed at the wire. |

Gateway log error scan: the ONLY level-50 entry is the deliberate negative tenancy test.

## 4. Web smoke — :3000 (`pnpm exec next dev --webpack`)

- `GET /acquisition` → HTTP 200 (compiled, heading "Acquisition" in SSR HTML).
- `GET /distributions` → HTTP 200 (compiled, heading "Distributions" in SSR HTML).
- Zero web runtime errors in the log. Client components render the loading shell then hydrate from `trpc.marketing.*` (data path proven in §3).

## 5. Typecheck

`tsc --noEmit` → **0 errors** for `@brain/lib-metrics`, `@brain/api-gateway`, `@brain/web`.

## 6. India / honesty checks

- aMER denominator = acquisition-classified spend ONLY (legacy-faithful; not total).
- ROAS/ACOS `display_only:true` (CM2-first); aMER/CAC privileged.
- new_customer_revenue uses per-order tax (per-SKU GST upstream); RTO new-customer orders → 0 (DDR-documented, child-3-pending).
- No outbound channel; read-only analytics; no Decision-Log write; ap-south-1.

## Verdict: **PASS** → Rohan Stage 6.

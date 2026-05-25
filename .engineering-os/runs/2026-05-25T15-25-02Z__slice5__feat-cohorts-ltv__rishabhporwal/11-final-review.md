# Stage 6 — Final Review — feat-cohorts-ltv (Phase 2, slice 5) — Rohan

| Field | Value |
|-------|-------|
| **req_id** | `feat-cohorts-ltv` |
| **Decision** | **PASS** → APPROVE under standing delegation (no hard-rule deviation); Stage-8 readiness only (no commit, no deploy) |
| **Lane** | high-stakes; full pipeline run end-to-end (S1 me → S2 Aryan → S3 build → S4 security → S5 QA → S6 me) |

## Drift check (requirement → plan → build)
Requirement: light up `/cohorts` + `/lifetime-value` on real anchor data, port legacy cohorts/LTV Brain-native, @paradigm SQL, non-vacuous parity. **No drift.** Every deliverable-bar item met (see below). No scope creep: WooCommerce path, customer-lifecycle/RFM (slice 8), AI narration (slice 9), exotic LTV dims all correctly deferred as non-goals.

## The Stage-1 findings drove the slice (the standing lesson bit a 4th time)
Reading the ACTUAL legacy formulas (not the slice-table shorthand) found 5 divergences, all RESOLVED in the build:
1. **Cohorts use CM3, not CM2** — `cohort_ltv_mu` accumulates realized CM3; slice-table's `cohort_cumulative_cm2_mu` was the wrong rung. Bound.
2. **LTV uses CM2 with NO CAC/payback/LTV:CAC** — those are cohort concepts. The LTV row has no cac field (router test asserts it). Bound.
3. **Phantom `cac_payback_months` (CAC/MonthlyCM2) DECOMMISSIONED** — it diverges from the legacy cumulative bucket-walk + interpolation. The real payback (centi-months, interpolated) lives in `CohortMatrixQuery` with DDR `_ROW_CAC_PAYBACK` + non-vacuous anchor. Same decommission class as slice-4's `pamer_bp`.
4. **`ltv_cac_bp` comment fixed** — input rung is cumulative CM3, not CM2; ratio formula unchanged/reused.
5. **FX poison killed** — no static EXCHANGE_RATES; single-currency.

## Paradigm audit — SQL, zero LLM/ML (PASS)
Read both legacy compute modules: neither uses a model. Cohorts/LTV are deterministic group-by + 30-day bucket + cumulative integer sums + integer ratios. The epic's "LTV projection" ML candidate does not exist in legacy (observed cumulative to 360d, not fitted). ML correctly ruled OUT — no %-of-GMV threat. `@paradigm("sql")` on both use-cases.

## Multi-tenancy (4-layer) — PASS, wire-proven
workspaceProc tenancy + ANALYST role gate + use-case `UnscopedQueryError` on falsy workspace_id + `query_metrics` scoped read. **Live wire**: foreign `x-workspace-id` → `UnscopedQueryError ... not authorized` (no rows leaked). customer_id LTV dimension stays workspace-scoped.

## Money / India canon — PASS
bigint paise throughout; FX absent; per-SKU GST untouched (cm2/cm3 are post-COGS contribution, GST handled upstream in the slice-1 ladder). RTO zeroes realized value (honest CM3/CM2).

## Independent gate re-run (Stage-6 mandatory — I re-ran, captured output)
1. **Registry parity gate** (`tools/check-metrics-parity.sh`): PASS — `cohort_ltv_mu` correctness_fixture SQL matched both sides; DDR formula_snapshot present; 33 shared metrics structural-match; **both verifier kill-mutants fire** (non-vacuous).
2. **TS lib-metrics**: 146 passed (incl. 4 slice-5: CF-S5-LTV-CUM-1 + CF-S5-RR90-1 kill-mutants, decommission guard).
3. **api-gateway**: 87 passed (incl. 14 slice-5 cohorts/ltv router tests; payback bucket-walk KILLS flat-ratio mutant at the wire; ltv has no cac field).
4. **brain_metrics**: 299 passed. **analytics-service**: 165 passed (incl. 29 net-new cohort+ltv use-case tests).
5. **Live re-smoke** (real network, captured): cohorts.matrix Jan payback=100 centi-mo (1.0mo, NOT flat 200), Feb payback=33 centi-mo (genuine interpolation), ltv_cac 12000/15000bp; ltv.summary Oud m1=1500000/m2=1800000 cumulative CM2; avg_payback=70; tenancy fail-closed. **Replicated every Stage-5 PASS.**
6. **typecheck**: lib-metrics 0, api-gateway 0, web 0.

## Over-engineering audit (7/7 PASS)
- No files beyond plan — every change maps to plan §1-§6.
- **Zero new dependencies** (no package.json/pyproject/lock changes).
- No speculative abstractions; the ONE net-new component (CohortHeatmap) is a required deliverable.
- Phantom `cac_payback_months` REMOVED (net-negative dead code — the right direction).
- No over-long WHAT comments; comments explain WHY (the findings).
- Plan length proportionate (5th repeat of a proven pattern; novelty = the 5 findings).

## Hard-rule deviation scan (step 9) — NONE
No dependency violation; no Single-Primitive violation (3 net-new ids, reused ratio/CAC/CM ladder; phantom removed); no compliance gap (read-only, no channel); no paradigm escalation; no gate-skip. **Eligible for delegated auto-approve.**

## DDR status
- `cohort_ltv_mu` — SIGNABLE (parity_gap, child_dependency None; Shopify facts present for anchor).
- `cohort_cac_payback` (documentary) — SIGNABLE (use-case computed; phantom decommissioned).
- `repeat_rate_bp` — shadow_compare, SIGNABLE (legacy comparand exists, zero delta).
- `ltv_cac_bp` — existing row, note amended (input rung CM3).

## Decision: PASS
Signed under standing delegation. Stage-8 readiness only — nothing committed, nothing deployed. Founder gives "commit it" to commit the slice-scoped paths in `pending-founder-commit.md`.

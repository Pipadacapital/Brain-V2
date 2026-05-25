# Architecture Plan — Stage 2 — feat-cohorts-ltv (Aryan)

Binds Rohan's Stage-1 reconciliation mandate (Findings 1-5) into a build plan. Reuses the slices 1-4 pattern wholesale: registry def (TS+PY byte-identical) → analytics use-case (honest-input, fail-closed via `query_metrics`) → DataPlanePort method → tRPC procedure (workspaceProc, ANALYST, bigint) → web content component. @paradigm sql, zero LLM/ML.

## §1 Registry changes (packages/lib-metrics + pylibs/brain_metrics)

| Def | Action | Formula (bound) | parity_class | Anchor |
|-----|--------|-----------------|--------------|--------|
| `cac_payback_months` | **REDEFINE** (Finding 3) | cumulative bucket-walk: cum=foR−cac; walk M1..M12 adding incr cm3; first k where cum≥0; cm3+post interpolates `(k-1)+(0-prevCum)/incrVal`; null if never. Returns months ×100 (centi-months) for integer interpolation. | correctness_fixture (parity_gap:true) | CF-S5-COHORT-PAYBACK-1: foR=30000µ, cac=50000µ, incr=[20000µ…] → 100 centi-months (1.0mo). Mutant CAC/MonthlyCM2=250 → KILLED |
| `repeat_rate_bp` | NEW | distinct-repeat-customers ÷ new-customers in bp (rr90 + bucketed) | shadow_compare | CF-S5-RR90-1: 3 of 10 repeat in 90d → intDiv(3×10000,10)=3000bp. Mutant ÷total-orders → KILLED |
| `cohort_ltv_mu` | NEW | cohort cumulative realized CM3 at horizon H = firstOrderR + Σ(incr cm3, 1..H) | correctness_fixture (parity_gap:true) | CF-S5-LTV-CUM-1: foR=1000µ, incr=[500,300] → m2=1800µ. Mutant incremental→500 KILLED |
| `ltv_cac_bp` | REUSE + fix comment (Finding 4) | unchanged `intDiv(ltv_mu×10000,cac_mu)`; input ltv_mu = cohort_ltv_mu (CM3, not CM2) | correctness_fixture | existing CF: ltv=300000,cac=100000→30000bp |
| `cm1/cm2/cm3_mu`, `cac_mu`, `aov_mu`, `realized_revenue_mu` | REUSE unchanged | — | — | — |

Centi-months rationale: payback needs sub-month interpolation; integer paise discipline forbids float. Store ×100 (centi-months), display /100. `kind=count, unit=count, scale=100`. (If a count metric scale=100 trips a registry invariant, fall back to `payback_centimonths` id — Maya checks the registry.test.ts scale invariant.)

Single-Primitive Rule: 3 net-new ids (`repeat_rate_bp`, `cohort_ltv_mu`, redefine `cac_payback_months`). No 2nd id per concept. NO per-metric-family forks.

## §2 DDR deltas (pylibs/.../definitional_delta_register.py)
- `_ROW_CAC_PAYBACK` (NEW): brain=cac_payback_months cumulative bucket-walk; legacy=cohorts/compute.ts:610-652 float; parity_gap:true; child_dependency:None (Shopify facts present for anchor brand); formula_snapshot the full bucket-walk.
- `_ROW_COHORT_LTV` (NEW): brain=cohort_ltv_mu cumulative realized CM3; legacy=cohorts/compute.ts cumulative mode; parity_gap:true; child_dependency:None.
- `_ROW_REPEAT_RATE` (NEW): shadow_compare (legacy rr90 comparand exists, cohorts/compute.ts:589-608); no delta, signable.
- `_ROW_LTV_CAC` (EXISTING): amend note — input rung is cohort cumulative CM3 (not CM2). Comment-only.

## §3 Analytics use-cases (apps/analytics-service/src/application/cohorts/ + ltv/)
- `CohortMatrixQuery.execute(workspace_id, date_range, facts, metric, mode)` — fail-closed: empty workspace_id → UnscopedQueryError; `query_metrics(workspace_id,"cac_mu",...)` choke. Honest-input: facts carry per-cohort firstOrderR/incr-cm3/repeat-counts/monthSpend/newCustomers (RTO/refund already applied upstream). Applies registry formula_py for cac/payback/ltv_cac; mode transforms.
- `LtvSummaryQuery.execute(workspace_id, date_range, facts, metric, mode, dimension, page, page_size, search)` — same fail-closed choke; honest-input per-dim aggregates; applyMode; pagination/search/sort.
- Mirrors `AcquisitionSummaryQuery` exactly (frozen dataclasses, sorted output, currency_code).

## §4 DataPlanePort + StubDataPlane (apps/api-gateway/src/...)
- Add `getCohortMatrix(params)` + `getLtvSummary(params)` to DataPlanePort (proto-types.ts) + StubDataPlane (loopback-data-plane.ts) with anchor-brand seed values matching the worked anchors.

## §5 tRPC (router.ts) — new `cohorts` + `ltv` routers
- `cohorts.matrix`: workspaceProc, requireRole ANALYST, input dateInput.extend({metric, mode}). assert def ids cac_payback_months, repeat_rate_bp, ltv_cac_bp.
- `ltv.summary`: workspaceProc, ANALYST, dateInput.extend({metric, mode, dimension, page, page_size, search}). assert def ids cohort_ltv_mu, ltv_cac_bp.
- Wire both into the root router export.

## §6 Web (apps/web)
- `cohorts/page.tsx` → `<CohortsContent/>`; `lifetime-value/page.tsx` → `<LtvContent/>`.
- New components: `interfaces/components/cohorts/cohorts-content.tsx` + a fresh `cohort-heatmap.tsx` (color-graded M1..M12 grid; no existing component to reuse — confirmed) + `interfaces/components/ltv/ltv-content.tsx`. Reuse slice-4 `format-ratio.ts` + `formatMoney`/scale display contract.

## §7 Tenancy / money / compliance gates (binding for Shreya/Tanvi)
- 4-layer: workspaceProc tenancy + ANALYST role + use-case UnscopedQueryError + query_gateway scoped read. Foreign workspace → UnscopedQueryError at the wire.
- Money: bigint paise throughout; FX poison absent (no EXCHANGE_RATES); per-SKU GST untouched (upstream).
- customer_id LTV dimension: workspace-scoped only (Shreya confirms no cross-tenant leak).
- @paradigm sql decorator on use-cases; zero LLM/ML; no outbound channel; no new dependency.

## §8 Non-goals
WooCommerce path; customer-lifecycle/RFM (slice 8); AI narration (slice 9); collection/discount_codes real compute; legacy edits.

**Plan length is proportionate** (slice-5 is the 5th repeat of a proven pattern; the load-bearing novelty is the 5 findings, fully specified). ADVANCE to Stage 3.

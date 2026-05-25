# Requirement — feat-cohorts-ltv (Phase 2, slice 5 of 9)

**req_id:** `feat-cohorts-ltv`
**parent_epic:** `epic-phase2-feature-parity`
**blocks:** feat-store-order-fact-layer (S1), feat-pnl-cm-waterfall (S2), feat-rto-cod-economics (S3), feat-marketing-acquisition (S4) — all SHIPPED through Stage 6 / Stage-8 readiness.
**Founder directive (slice cadence):** assembly-line slice 5 — Cohorts + LTV. Light up `/cohorts` + `/lifetime-value` on real anchor-brand data. Port legacy `routes/workspaces/{cohorts,lifetime-value}` + `lib/{cohorts,ltv}` Brain-native. @paradigm SQL (deterministic cohort SQL); ML only if legacy genuinely used a model AND SQL cannot express it.

## Problem
`/cohorts` and `/lifetime-value` are 8-line scaffolds. The retention heatmap, repeat-rate, LTV curve, LTV:CAC, and payback economics — the retention half of the honest-CM workbench — do not exist Brain-native. Slice 4 shipped CAC (`cac_mu`); slice 5 is the first surface to CONSUME it for a payback/LTV:CAC decision metric.

## Smallest safe reversible thing that ships two real pages
- Cohort retention/repeat heatmap by first-order MONTH (cohort) × 30-day bucket (M1..M12), 4 metric families × 5 modes; per-cohort CAC, rr90, payback, firstOrder/firstOrderR.
- LTV curve by DIMENSION (product/variant/vendor/type/tags/customer/discount_pct) × 30-day bucket, 3 metric families × 3 modes, weighted line-item attribution, paginated.
- New registry defs (parity-green TS↔Python) + DDR deltas; new analytics use-cases (fail-closed); `cohorts.*` + `ltv.*` tRPC (workspaceProc, ANALYST, bigint minor units); 2 live pages with a fresh cohort-heatmap web component.

## Acceptance bar (binding)
- TS↔Python parity GREEN + NON-VACUOUS for every new def (kill-mutant per def).
- RLS fail-closed proven at the wire (foreign workspace → UnscopedQueryError).
- Money exact-integer minor units (bigint); FX poison ABSENT (legacy static EXCHANGE_RATES killed); per-SKU GST never blended.
- @paradigm("sql"); zero LLM/ML.
- Real-network smoke PASS on anchor brand; typecheck 0; reversible (additive; no legacy edit).
- DDR deltas registered for every parity_gap def.

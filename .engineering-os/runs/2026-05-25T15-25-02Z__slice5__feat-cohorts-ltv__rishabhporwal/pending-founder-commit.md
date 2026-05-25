# Pending Founder Commit — feat-cohorts-ltv (Phase 2, slice 5)

Stage 6 PASS (signed under standing delegation). Nothing committed. The Founder gives free-text
"commit it" to commit the slice-scoped paths below. **Explicit paths only — NO `git add -A`.**
Excludes `.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts`, and unrelated working-tree changes
(`apps/web/next.config.ts`, `apps/web/src/interfaces/components/auth/login-form.tsx` — not slice-5).

Branch: `feature/feat-store-order-fact-layer` (the Phase-2 assembly-line branch; slices 1-4 committed here).

## Mechanical commit command (slice-5 scope)

```bash
cd /Users/rishabhporwal/Desktop/Brain
git add \
  packages/lib-metrics/src/registry/definitions.ts \
  packages/lib-metrics/src/registry/index.ts \
  packages/lib-metrics/src/registry/registry.test.ts \
  pylibs/brain_metrics/brain_metrics/registry/definitions.py \
  pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py \
  apps/analytics-service/src/application/cohorts/ \
  apps/analytics-service/src/application/ltv/ \
  apps/analytics-service/tests/test_cohort_matrix_query.py \
  apps/analytics-service/tests/test_ltv_summary_query.py \
  apps/api-gateway/src/domain/proto-types.ts \
  apps/api-gateway/src/domain/registry-mapper.ts \
  apps/api-gateway/src/infrastructure/loopback-data-plane.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/application/router.cohorts-ltv.test.ts \
  'apps/web/src/app/(shell)/cohorts/page.tsx' \
  'apps/web/src/app/(shell)/lifetime-value/page.tsx' \
  apps/web/src/interfaces/components/cohorts/ \
  apps/web/src/interfaces/components/ltv/ \
  .engineering-os/runs/2026-05-25T15-25-02Z__slice5__feat-cohorts-ltv__rishabhporwal/ \
  .engineering-os/rule-proposals/2026-05-25__verify-legacy-formula-at-stage1-not-slice-table.md \
  .engineering-os/memory/features/epic-phase2-feature-parity.md \
  .engineering-os/memory/agents/cto-advisor.journal.md \
  .engineering-os/state/active.json

git commit -m "feat(slice-5-cohorts-ltv): /cohorts + /lifetime-value Brain-native

Port legacy cohorts + LTV onto the slice-1..4 foundation. @paradigm sql.
- Cohorts use CM3 (not CM2); LTV uses CM2 with no CAC/payback (cohort concepts).
- DECOMMISSION phantom cac_payback_months (CAC/MonthlyCM2) — real payback is the
  legacy cumulative bucket-walk + interpolation in CohortMatrixQuery (centi-months).
- New defs cohort_ltv_mu (correctness_fixture) + repeat_rate_bp (shadow_compare),
  TS<->Python byte-identical + non-vacuous anchors; reuse ltv_cac_bp (comment fixed).
- 2 fail-closed analytics use-cases; cohorts.* + ltv.* tRPC (workspaceProc/ANALYST/bigint);
  RLS fail-closed proven at the wire; per-SKU GST untouched; FX poison absent.
- 2 live pages + fresh CohortHeatmap component.
- DDR: cohort_ltv_mu + cohort_cac_payback (parity_gap) + repeat_rate_bp (shadow).
- Tests: 146 TS lib-metrics + 87 api-gateway + 299 brain_metrics + 165 analytics; typecheck 0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## DO NOT include
- `.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts` (generated/local).
- `apps/web/next.config.ts`, `apps/web/src/interfaces/components/auth/login-form.tsx` (pre-existing working-tree changes, not slice-5).
- `.engineering-os/decision-log/2026/05/2026-05-25.jsonl` is appended by the pipeline; include it only if your flow commits the decision log with each slice (slices 1-4 convention).

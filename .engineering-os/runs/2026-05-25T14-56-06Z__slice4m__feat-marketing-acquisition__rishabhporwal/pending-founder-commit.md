# Pending Founder Commit — feat-marketing-acquisition (Phase 2, slice 4)

> Stage 6 PASS (Rohan, signed under standing delegation). NOTHING is committed.
> The Founder commits the reviewed slice-4 code at the Stage-7 gate, on a feature branch only.
> EXPLICIT product-code paths only — NO `git add -A`. Excludes `.claude/`, `CLAUDE.md`, `next-env.d.ts`.

## Branch

Current branch: `feature/feat-store-order-fact-layer` (the Phase-2 assembly-line branch where slices 1-3 are committed). Slice 4 commits here.

## Mechanical commit command (copy-paste)

```bash
cd /Users/rishabhporwal/Desktop/Brain

git add \
  packages/lib-metrics/src/registry/definitions.ts \
  packages/lib-metrics/src/registry/index.ts \
  packages/lib-metrics/src/index.ts \
  packages/lib-metrics/src/registry/registry.test.ts \
  pylibs/brain_metrics/brain_metrics/registry/definitions.py \
  pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py \
  pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.md \
  pylibs/brain_metrics/tests/test_registry.py \
  pylibs/brain_metrics/tests/test_locked_canon.py \
  pylibs/brain_metrics/tests/test_definitional_delta_register.py \
  tools/check-metrics-parity.sh \
  apps/analytics-service/src/application/marketing/__init__.py \
  apps/analytics-service/src/application/marketing/marketing_efficiency_query.py \
  apps/analytics-service/src/application/marketing/acquisition_summary_query.py \
  apps/analytics-service/src/application/marketing/distributions_query.py \
  apps/analytics-service/tests/test_marketing_efficiency_query.py \
  apps/analytics-service/tests/test_acquisition_summary_query.py \
  apps/analytics-service/tests/test_distributions_query.py \
  apps/api-gateway/src/domain/proto-types.ts \
  apps/api-gateway/src/domain/registry-mapper.ts \
  apps/api-gateway/src/infrastructure/loopback-data-plane.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/application/router.marketing.test.ts \
  apps/web/src/interfaces/components/marketing/format-ratio.ts \
  apps/web/src/interfaces/components/marketing/acquisition-content.tsx \
  apps/web/src/interfaces/components/marketing/distributions-content.tsx \
  "apps/web/src/app/(shell)/acquisition/page.tsx" \
  "apps/web/src/app/(shell)/distributions/page.tsx" \
  .engineering-os/runs/2026-05-25T14-56-06Z__slice4m__feat-marketing-acquisition__rishabhporwal/ \
  .engineering-os/rule-proposals/2026-05-25__verify-legacy-formula-at-stage1-not-slice-table.md \
  .engineering-os/memory/agents/cto-advisor.journal.md \
  .engineering-os/memory/features/epic-phase2-feature-parity.md \
  .engineering-os/pending-founder-attention.md \
  .engineering-os/state/active.json \
  .engineering-os/decision-log/2026/05/2026-05-25.jsonl

git commit -m "feat(slice-4-marketing-acquisition): MER/aMER/CAC + acquisition + distributions on /acquisition + /distributions

Port legacy marketing-efficiency + acquisition + distributions Brain-native (slice 4 of
epic-phase2-feature-parity). RECONCILED the Child-4 pre-built marketing defs to legacy:
- amer_bp REDEFINED to legacy (nc_revenue / acquisition-classified spend, NOT true_cm2/total_spend)
- pamer_bp DECOMMISSIONED (no legacy comparand)
- mer_bp + cac_mu brought into BOTH registries (closed the uneven TS/PY shadow-carve split)
4 new defs (new_customer_revenue_mu, nc_cm2_mu, cm2_per_nc_mu, acquisition_ad_spend_mu) TS<->Python
parity-green + non-vacuous anchors (aMER 15000bp on a classification split; 'use total spend' mutant
killed). 3 analytics use-cases (fail-closed RLS), marketing.* tRPC group (workspaceProc/ANALYST/bigint),
2 real data-backed pages. @paradigm sql; per-SKU GST honest; ROAS/ACOS display-only; typecheck 0;
parity + real-network smoke PASS. DDR rows registered (child-3-pending for connector facts).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Excluded (do NOT commit)

- `.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts` (per Founder instruction).
- `apps/web/next.config.ts`, `apps/web/src/interfaces/components/auth/login-form.tsx` — pre-existing uncommitted changes NOT part of slice 4 (leave for the Founder to handle separately).

## Verification reproduced at Stage 6 (all PASS)

- `bash tools/check-metrics-parity.sh` → PASS (non-vacuous; both kill-mutants fire)
- `pnpm --filter @brain/lib-metrics test` → 142 · `pnpm --filter @brain/api-gateway test` → 73
- analytics-service pytest → 136 · brain_metrics pytest → 299
- `tsc --noEmit` (lib-metrics, api-gateway, web) → 0 errors
- Live wire: mer 29384, amer 30000 (acquisition spend), cac 16250, distributions mode 48000; foreign workspace → UnscopedQueryError
- `/acquisition` + `/distributions` → HTTP 200, no runtime errors

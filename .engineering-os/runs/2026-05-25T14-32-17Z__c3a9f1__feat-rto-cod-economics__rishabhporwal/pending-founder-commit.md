# Pending Founder Commit — feat-rto-cod-economics (Phase-2 slice 3)

> Stage-6 PASS (signed under standing delegation). **Nothing is committed.** The ORCHESTRATOR commits
> after Rohan returns, on the current branch `feature/feat-store-order-fact-layer`. Explicit
> slice-scoped paths ONLY — NO `git add -A`. Excludes `.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts`,
> and all EOS audit artifacts (decision-log / runs / memory / state are committed separately as the
> pipeline audit trail, not as product code).

## Mechanical commit command (slice-3 product code)

```bash
cd /Users/rishabhporwal/Desktop/Brain
git add \
  packages/lib-metrics/src/registry/definitions.ts \
  packages/lib-metrics/src/registry/index.ts \
  packages/lib-metrics/src/registry/registry.test.ts \
  pylibs/brain_metrics/brain_metrics/registry/definitions.py \
  pylibs/brain_metrics/tests/test_registry.py \
  pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py \
  pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.md \
  apps/analytics-service/src/application/logistics/ \
  apps/analytics-service/tests/test_rto_analytics_query.py \
  apps/analytics-service/tests/test_cod_prepaid_query.py \
  apps/analytics-service/tests/test_logistics_query.py \
  apps/analytics-service/tests/test_pincode_intelligence_query.py \
  apps/api-gateway/src/domain/proto-types.ts \
  apps/api-gateway/src/domain/registry-mapper.ts \
  apps/api-gateway/src/infrastructure/loopback-data-plane.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/application/router.logistics.test.ts \
  apps/web/src/interfaces/components/logistics/ \
  'apps/web/src/app/(shell)/rto-analytics/page.tsx' \
  'apps/web/src/app/(shell)/cod-prepaid/page.tsx' \
  'apps/web/src/app/(shell)/logistics/page.tsx' \
  'apps/web/src/app/(shell)/pincode-intelligence/page.tsx'

git commit -m "feat(slice-3-rto-cod-economics): RTO + COD/prepaid + logistics + pincode on 4 real pages

- 5 metric defs (rto_cost, rto_revenue_lost, cod_realization, breakeven_cod_rto_rate, pincode_reliability)
  TS<->Python byte-identical; break-even ports the FULL legacy formula (NOT naive M/(M+C)); non-vacuous anchors
- 3 DDR rows (breakeven + pincode correctness-fixture; rto_cost/value child-3-held)
- 4 analytics use-cases (fail-closed tenancy; honest-input pattern) + 4 tRPC logistics procedures
- /rto-analytics /cod-prepaid /logistics /pincode-intelligence render real ported data
- @paradigm(sql); zero new dep; per-SKU GST untouched; FX poison absent; no outbound channel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Staged paths (15 modified + dirs of new files)

**Registry / DDR (parity-green, non-vacuous):**
- `packages/lib-metrics/src/registry/{definitions.ts,index.ts,registry.test.ts}`
- `pylibs/brain_metrics/brain_metrics/registry/definitions.py`
- `pylibs/brain_metrics/tests/test_registry.py`
- `pylibs/brain_metrics/brain_metrics/parity/{definitional_delta_register.py,definitional_delta_register.md}`

**Analytics use-cases (new):**
- `apps/analytics-service/src/application/logistics/` (`__init__.py`, `city_tiers.py`,
  `rto_analytics_query.py`, `cod_prepaid_query.py`, `logistics_query.py`, `pincode_intelligence_query.py`)
- `apps/analytics-service/tests/test_{rto_analytics,cod_prepaid,logistics,pincode_intelligence}_query.py`

**BFF / gateway:**
- `apps/api-gateway/src/domain/{proto-types.ts,registry-mapper.ts}`
- `apps/api-gateway/src/infrastructure/loopback-data-plane.ts`
- `apps/api-gateway/src/application/{router.ts,router.logistics.test.ts}`

**Frontend:**
- `apps/web/src/interfaces/components/logistics/` (`format-bp.ts` + 4 `*-content.tsx`)
- `apps/web/src/app/(shell)/{rto-analytics,cod-prepaid,logistics,pincode-intelligence}/page.tsx`

## Explicitly EXCLUDED (do NOT commit with this change)

- `.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts` (Next auto-gen)
- Phase-1 auth files (`apps/web/src/interfaces/components/auth/login-form.tsx`, `apps/web/next.config.ts`) —
  not in this change set
- EOS audit artifacts (`.engineering-os/decision-log/`, `runs/`, `memory/`, `state/`) — committed
  separately as the pipeline audit trail, not as product code
- Zero dependency/lockfile changes (no `package.json`/`pnpm-lock.yaml`/`uv.lock`/`pyproject.toml`)

## Verification snapshot (Stage-6, captured)

- TS↔Python parity gate: PASS (break-even + pincode correctness_fixture SQL byte-identical + DDR snapshot; killed-mutant PASS)
- brain_metrics 299 · analytics-service 107 · lib-metrics 139 (tsc 0) · api-gateway 62 (tsc 0) · web tsc 0
- Live wire: all 4 logistics procedures return correct minor-unit values; break-even=500 (≠ naive 9493); cross-workspace → UnscopedQueryError
- All 4 pages HTTP 200, client components mount + render

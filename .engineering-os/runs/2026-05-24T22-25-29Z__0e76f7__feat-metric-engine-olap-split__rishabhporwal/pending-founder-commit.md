# Pending Founder Commit — feat-metric-engine-olap-split (Child 4)

> **Stage 6 PASS. Founder gate SIGNED under standing delegation (`12-founder-decision.json`).**
> No commit has been performed — the Founder commits at end-review (standing rule: agents commit to feature branches only; Founder reviews + merges). This file gives the **mechanical commit command** with **explicit Child-4 product-code paths** so the commit does NOT carry the co-staged Child-3 (`feat-connector-framework-cutover`, run `c7fed9`) files.

---

## IMPORTANT — do NOT `git add -A`

Both Security (`09b`) and QA (`10b`) flagged that the working tree **co-mingles Child-3 files** (`apps/ingestion-service/**`, `protos/`) with Child-4. A `git add -A` or `git commit -a` would bundle Child-3 code into the Child-4 PR. Use the explicit paths below.

Current branch: `feature/feat-tenancy-auth-rls-hardening` (the Child-1/2/3/4 build base, per plan §16). This is a feature branch — correct per the feature-branch-only commit rule.

---

## Mechanical commit command (explicit Child-4 paths)

```bash
cd /Users/rishabhporwal/Desktop/Brain

# Child-4 product code — analytics-service (OLAP plumbing, query-gateway, single-writer, residency)
git add apps/analytics-service/migrations/clickhouse/_divop_template.sql \
        apps/analytics-service/migrations/clickhouse/0001_base_workspace_daily_metrics.sql \
        apps/analytics-service/migrations/clickhouse/0002_mv_computed_ratios.sql \
        apps/analytics-service/migrations/clickhouse/README.md \
        apps/analytics-service/pyproject.toml \
        apps/analytics-service/src/__init__.py \
        apps/analytics-service/src/bootstrap/analytics_service_startup.py \
        apps/analytics-service/src/infrastructure/__init__.py \
        apps/analytics-service/src/infrastructure/clickhouse/__init__.py \
        apps/analytics-service/src/infrastructure/clickhouse/query_gateway.py \
        apps/analytics-service/tests/__init__.py \
        apps/analytics-service/tests/test_query_gateway_isolation.py \
        apps/analytics-service/tests/test_single_writer_grep.py \
        apps/analytics-service/tests/test_startup_assertions.py

# Child-4 product code — TS metric registry (lib-metrics)
git add packages/lib-metrics/src/index.ts \
        packages/lib-metrics/src/parity-runner.ts \
        packages/lib-metrics/src/registry-dump.ts \
        packages/lib-metrics/src/registry/definitions.ts \
        packages/lib-metrics/src/registry/index.ts \
        packages/lib-metrics/src/registry/registry.test.ts \
        packages/lib-metrics/src/registry/types.ts

# Child-4 product code — Python metric registry + DDR + parity harness (brain_metrics)
git add pylibs/brain_metrics/brain_metrics/registry/ \
        pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py \
        pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.md \
        pylibs/brain_metrics/brain_metrics/parity/taxonomy.py \
        pylibs/brain_metrics/brain_metrics/parity/harness.py \
        pylibs/brain_metrics/brain_metrics/parity/fixtures/clickhouse_roundtrip_fixtures.json \
        pylibs/brain_metrics/brain_metrics/ratio.py \
        pylibs/brain_metrics/tests/test_registry.py \
        pylibs/brain_metrics/tests/test_definitional_delta_register.py \
        pylibs/brain_metrics/tests/test_clickhouse_roundtrip.py \
        pylibs/brain_metrics/tests/test_locked_canon.py

# Child-4 product code — parity gate tooling
git add tools/check-metrics-parity.sh \
        tools/parity-runner.py \
        tools/registry-dump.py \
        tools/ddr-dump.py

# EOS audit trail for this run
git add .engineering-os/runs/2026-05-24T22-25-29Z__0e76f7__feat-metric-engine-olap-split__rishabhporwal/ \
        .engineering-os/memory/ \
        .engineering-os/decision-log/ \
        .engineering-os/state/active.json \
        .engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md \
        .engineering-os/pending-founder-attention.md

# Sanity: confirm NO Child-3 files staged before committing
git diff --cached --name-only | grep -E 'apps/ingestion-service/|protos/' && echo ">>> STOP: Child-3 files staged — unstage them <<<" || echo "OK: no Child-3 files staged"

git commit -m "feat(child-4-metric-engine): Brain-native metric registry + OLAP split + 9-field DDR

- Metric registry TS<->Python byte-identity pair (extends Child-2); 4 Brain-native
  decision metrics (true_cm2_mu, pamer_bp, amer_bp, ltv_cac_bp) aligned to ONE
  canonical formula across TS == Python == DDR (fixes round-1 H-1).
- ClickHouse base/MV DDL (runbook-gated, NOT applied); intDiv + null-guard on every
  division; cogs_mu full-recompute (not incremental MV).
- Workspace-scoped fail-closed query-gateway (UnscopedQueryError; bound-param predicate).
- Single-writer 3-pattern static gate + Postgres read-only-role startup assert;
  ap-south-1 residency startup assert (refuse-to-start on mismatch).
- 9-field Definitional-Delta Register (parity_gap + child_dependency + formula_snapshot)
  with code-enforced sign-off rules; registry-parity gate rebuilt non-vacuous (killed mutants).
- 434 tests pass (41 analytics + 291 brain_metrics + 102 lib-metrics); paradigm sql-exclusive.
- HOLD-AT-READ-FLIP: zero live DDL, zero read-flip, zero legacy edit. Single-writer C2 intact.

Stage-6 PASS (Rohan). DDR partially signed (9/11; total_tax_mu + fx_restatement
UNSIGNED-PENDING-child-3). Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Notes
- The `pylibs/brain_metrics/brain_metrics/registry/` directory is added whole (it is all new Child-4 code).
- If `git status` shows other modified `brain_metrics` files that pre-date Child-4, review them before adding — only Child-4-touched files belong in this commit.
- Do NOT push/merge to `development`/`release`/`master` — that is a separate Founder-driven PR hop.
- After commit, the run advances to **Stage-8 readiness** (no deploy yet; ClickHouse DDL stays runbook-gated and the live read-source flip stays HELD).

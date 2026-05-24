# Pending Founder commit authorization — feat-money-minor-units-parity (Child 2)

> Stage-6 PASS (Rohan) + Stage-7 APPROVE (Rohan, on the Founder's behalf via standing delegation). **This is the commit gate.**
> Per the feature-branch-only rule + the harness commit guard: **nothing is staged or committed until the Founder types the free-text words `commit it`.** AskUserQuestion / agent approval is NOT sufficient.

## What is being committed

The Child-2 money / minor-units / numeric-type foundation: the canonical `Money` value object + exact decimal-string conversion primitive + ratio/subunit logic + the golden-fixture parity harness + the real CI byte-identity gate + the HOLD-AT-LIVE-RECON runbook skeleton. **Zero live DB read. Zero legacy edit. Migration NOT applied.**

## IMPORTANT — do NOT use `git add -A`

Two untracked test byproducts exist and must NOT be committed:
- `packages/lib-metrics/coverage/`
- `pylibs/brain_metrics/.coverage`

They are not gitignored. Use the explicit product-path command below (no `-A`). (Optionally add those two paths to `.gitignore` in the same commit.)

## Mechanical commit command (explicit product paths only)

```bash
cd "/Users/rishabhporwal/Desktop/Brain"

# 1. Branch off development for this child (Founder decides the exact name/base):
#    git checkout development && git pull && git checkout -b feature/feat-money-minor-units-parity

# 2. Stage ONLY the reviewed product code + the EOS audit trail (NO git add -A):
git add \
  packages/lib-metrics/package.json \
  packages/lib-metrics/tsconfig.json \
  packages/lib-metrics/vitest.config.ts \
  packages/lib-metrics/src/money.ts \
  packages/lib-metrics/src/convert.ts \
  packages/lib-metrics/src/ratio.ts \
  packages/lib-metrics/src/subunits.ts \
  packages/lib-metrics/src/goal-type.ts \
  packages/lib-metrics/src/index.ts \
  packages/lib-metrics/src/parity-runner.ts \
  packages/lib-metrics/src/money.test.ts \
  pylibs/brain_metrics/brain_metrics/__init__.py \
  pylibs/brain_metrics/brain_metrics/convert.py \
  pylibs/brain_metrics/brain_metrics/money.py \
  pylibs/brain_metrics/brain_metrics/ratio.py \
  pylibs/brain_metrics/brain_metrics/subunits.py \
  pylibs/brain_metrics/brain_metrics/goal_type.py \
  pylibs/brain_metrics/brain_metrics/parity/__init__.py \
  pylibs/brain_metrics/brain_metrics/parity/harness.py \
  pylibs/brain_metrics/brain_metrics/parity/taxonomy.py \
  pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json \
  pylibs/brain_metrics/brain_metrics/parity/runbook/README.md \
  pylibs/brain_metrics/brain_metrics/parity/runbook/live-reconciliation-runbook.md \
  pylibs/brain_metrics/brain_metrics/parity/runbook/column-migration-skeleton.sql \
  pylibs/brain_metrics/tests/__init__.py \
  pylibs/brain_metrics/tests/test_convert.py \
  pylibs/brain_metrics/tests/test_money.py \
  pylibs/brain_metrics/tests/test_ratio.py \
  pylibs/brain_metrics/tests/test_subunits.py \
  pylibs/brain_metrics/tests/test_goal_type.py \
  pylibs/brain_metrics/tests/test_harness.py \
  tools/check-metrics-parity.sh \
  tools/parity-runner.py \
  .engineering-os/

# 3. Sanity: confirm the two coverage byproducts are NOT staged:
git status --short | grep -iE "lib-metrics/coverage|\.coverage" && echo "STOP: coverage artifact staged — unstage it" || echo "OK: no coverage artifact staged"

# 4. Commit (Founder runs this only after deciding to commit):
git commit -m "feat(child-2-money): canonical Money primitive + byte-identity parity gate (C7 gate)

Canonical Money value object + exact decimal-string conversion (string-in,
BigInt, ROUND_HALF_EVEN, no Number()*100, no epsilon) + ratio/subunit logic +
golden-fixture parity harness (5-category taxonomy incl. ROUNDING_MODE_MISMATCH)
+ real TS<->Python byte-identity CI gate (25/25) + goalType money|ratio split +
HOLD-AT-LIVE-RECON runbook skeleton. Zero live read, zero legacy edit, migration
NOT applied. Stage-6 PASS (Rohan) + Stage-7 APPROVE (delegated)."

# 5. Push the feature branch (Founder opens the PR; never push to development/release/master):
#    git push -u origin feature/feat-money-minor-units-parity
```

## Pre-commit gate state (all replicated by Rohan at Stage 6)
- byte-identity parity gate: 25/25, exit 0 (drift-injection => exit 1, restored => exit 0)
- Python 125 passed; TS 62 passed; tsc --noEmit exit 0
- single canonical golden_fixtures.json; zero legacy diff; zero new runtime deps; secrets clean

**Awaiting the Founder's free-text `commit it`.**
</content>

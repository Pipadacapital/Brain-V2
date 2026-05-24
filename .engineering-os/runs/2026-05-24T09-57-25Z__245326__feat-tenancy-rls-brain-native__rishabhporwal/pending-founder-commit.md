# Pending Founder commit — feat-tenancy-rls-brain-native

> Stage 6 PASS (Rohan, 2026-05-24T17:10:00Z). Recommendation: **APPROVE**.
> The Founder owns commit. Agents do NOT commit. This is the mechanical command for the Founder to run at the Stage-7 gate.
> Explicit product-code paths only — **no `git add -A`** (the untracked `apps/core-service/coverage/` build artifact must NOT be committed).

## Branch

Current: `feature/feat-tenancy-auth-rls-hardening` (the epic feature branch). Feature-branch only — no push/merge to development/release/master.

## Mechanical commit command (product code + audit trail)

```bash
cd /Users/rishabhporwal/Desktop/Brain

# --- product code (apps/core-service) ---
git add \
  apps/core-service/package.json \
  apps/core-service/tsconfig.json \
  apps/core-service/vitest.config.ts \
  apps/core-service/docker-compose.test.yml \
  apps/core-service/docker/initdb/01-create-rls-app-role.sql \
  apps/core-service/migrations/manual/rls/README.md \
  apps/core-service/migrations/manual/rls/step-a-enable-create.sql \
  apps/core-service/migrations/manual/rls/step-b-force.sql \
  apps/core-service/migrations/manual/rls/down.sql \
  apps/core-service/migrations/manual/rls/rollout-runbook.sh \
  apps/core-service/src/infrastructure/db/workspace-context.ts \
  apps/core-service/src/infrastructure/db/rls-probe.ts \
  apps/core-service/src/infrastructure/db/index.ts \
  apps/core-service/src/domain/auth/brain-claim.ts \
  apps/core-service/src/application/cron/session-scoped-fanout.ts \
  apps/core-service/src/__tests__/workspace-context.test.ts \
  apps/core-service/src/__tests__/rls-probe-verdict.test.ts 2>/dev/null; \
git add \
  apps/core-service/src/__tests__/probe-verdict.test.ts \
  apps/core-service/src/__tests__/brain-claim.test.ts \
  apps/core-service/src/__tests__/session-scoped-fanout.test.ts \
  apps/core-service/src/__tests__/rls-ddl-static.test.ts \
  apps/core-service/src/__tests__/integration/pool-isolation.test.ts

# --- gate amendment to the binding Child-0 spike + EOS audit trail ---
git add \
  .engineering-os/runs/2026-05-24T00-58-39Z__a49c05__spike-legacy-migration-architecture__rishabhporwal/06-architecture-plan.md \
  .engineering-os/runs/2026-05-24T09-57-25Z__245326__feat-tenancy-rls-brain-native__rishabhporwal/ \
  .engineering-os/decision-log/2026/05/2026-05-24.jsonl \
  .engineering-os/state/active.json \
  .engineering-os/state/registry.json \
  .engineering-os/memory/agents/cto-advisor.journal.md \
  .engineering-os/memory/agents/architect.journal.md \
  .engineering-os/memory/agents/qa.journal.md \
  .engineering-os/memory/features/feat-tenancy-rls-brain-native.md \
  .engineering-os/memory/features/feat-tenancy-auth-rls-hardening.md \
  .engineering-os/pending-founder-attention.md \
  .engineering-os/usage.jsonl

# --- explicitly EXCLUDE the coverage build artifact (do not commit) ---
#     apps/core-service/coverage/   <-- NOT added on purpose

git commit -m "feat(core-service): Brain-native tenant isolation / RLS / auth-claim (Child 1, Shape A)

Universal C5 hard gate, Brain-native rebuild. Ships the session-context
primitive (withWorkspace/withSuperadmin, pg session-mode, tx-local set_config
bind-param), the 43-table fail-closed RLS DDL (runbook-gated/manual, NOT applied),
the CF-SEC-1 fail-closed probe (genuine non-bypass contextless arm), the cron
session-scoped fan-out, the Supabase-JWT->WorkspaceRole auth-claim (requireRole),
and the 6-step rollout runbook. FORCE is DEFERRED to Stage-8 per the named
HOLD-AT-FORCE state — no live DDL applied this run; legacy keeps working unchanged.

Includes the decision-logged Child-0 gate-language amendment (RLS 'live' ->
'satisfiable Brain-native + FORCE deferred'), so Child-2's dependency check reads
the real criterion. Mines proven legacy logic; zero legacy code imported/edited.

Stage-6 PASS (Rohan). Security (Shreya) + QA (Tanvi) PASS on re-review after one
bounce (probe contextless arm was inert / integration test ran on a BYPASSRLS
role — both fixed and independently mutation-verified).

158 unit + 9 integration tests pass; tsc clean; coverage 90.71/71.42/94.11/90.57.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Notes for the Founder

- **Verify the test filenames first.** The probe-verdict test is at `src/__tests__/probe-verdict.test.ts` (the `2>/dev/null` line above guards a stale alternate name); confirm with `git status apps/core-service` before committing if any `git add` warns about a missing path.
- **`apps/core-service/coverage/` is intentionally excluded** — it is a regenerated build artifact, not source.
- The **live RLS FORCE is NOT in this commit** and will NOT happen by merging it. FORCE is a Stage-8 runbook step, HELD behind your explicit sign-off (HOLD-AT-FORCE). Merging this PR ships Brain code only; the production DB is untouched.
- After commit, this advances to **Stage 7 (your gate)**: `/approve feat-tenancy-rls-brain-native` or `/reject feat-tenancy-rls-brain-native <reason>`.

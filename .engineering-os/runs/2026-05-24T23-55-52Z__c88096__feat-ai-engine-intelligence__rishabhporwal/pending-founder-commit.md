# Pending Founder Commit — feat-ai-engine-intelligence (Child 5, 5a vertical slice)

> Stage-6 PASS (APPROVE-WITH-CAVEATS), Founder gate SIGNED under standing delegation.
> **NO commit performed by any agent.** The Founder commits the reviewed code at the Stage-7 gate.
> Branch: `feature/feat-tenancy-auth-rls-hardening` (carries Children 1/2/3/4; Child-3/4/5 co-staged — do NOT use `git add -A`).
> Feature-branch only — do NOT push/merge to development/release/master (Founder-driven PRs).

---

## IMPORTANT — two manifest corrections before commit

1. **Stage the untracked Track-M source + tests.** The staged set alone will NOT import (the pnl agent imports signals/context_builders/evals/prompts/telemetry). These are load-bearing and currently untracked.
2. **EXCLUDE the duplicate divergent migration** `apps/intelligence-service/src/infrastructure/db/migrations/` (C5-SEC-007). The canonical migration is `apps/intelligence-service/migrations/postgres/`. Do NOT stage the `src/infrastructure/db/migrations/` copy — it diverges and would create a split-schema source. (Recommend `git rm`/delete it in the polish pass.)

---

## Mechanical commit command (explicit paths — NO `git add -A`)

```bash
cd /Users/rishabhporwal/Desktop/Brain

# --- brain_cost_router (Track V1 — @paradigm Gate-1) ---
git add \
  pylibs/brain_cost_router/brain_cost_router/__init__.py \
  pylibs/brain_cost_router/brain_cost_router/paradigm.py \
  pylibs/brain_cost_router/brain_cost_router/errors.py \
  pylibs/brain_cost_router/brain_cost_router/telemetry.py \
  pylibs/brain_cost_router/pyproject.toml \
  pylibs/brain_cost_router/tests/__init__.py \
  pylibs/brain_cost_router/tests/test_paradigm.py

# --- intelligence-service: package config + canonical migrations ---
git add \
  apps/intelligence-service/pyproject.toml \
  apps/intelligence-service/migrations/postgres/up.sql \
  apps/intelligence-service/migrations/postgres/down.sql

# --- intelligence-service: Track V source (gateway / gates / executor / schema) ---
git add \
  apps/intelligence-service/src/application/__init__.py \
  apps/intelligence-service/src/application/gateway/__init__.py \
  apps/intelligence-service/src/application/gateway/client.py \
  apps/intelligence-service/src/application/gateway/graduation_middleware.py \
  apps/intelligence-service/src/bootstrap/__init__.py \
  apps/intelligence-service/src/domain/__init__.py \
  apps/intelligence-service/src/domain/agents/__init__.py \
  apps/intelligence-service/src/domain/agents/base.py \
  apps/intelligence-service/src/domain/agents/pnl_insight_agent.py \
  apps/intelligence-service/src/domain/faithfulness/__init__.py \
  apps/intelligence-service/src/domain/faithfulness/extraction.py \
  apps/intelligence-service/src/domain/faithfulness/validator.py \
  apps/intelligence-service/src/domain/tools/__init__.py \
  apps/intelligence-service/src/domain/tools/tool_contract.py \
  apps/intelligence-service/src/domain/tools/executor.py \
  apps/intelligence-service/src/domain/tools/recommendation.py \
  apps/intelligence-service/src/domain/memory/query.py \
  apps/intelligence-service/src/domain/injection/preprocessor.py \
  apps/intelligence-service/src/infrastructure/__init__.py \
  apps/intelligence-service/src/infrastructure/db/__init__.py \
  apps/intelligence-service/src/infrastructure/db/cache_purge.py

# --- intelligence-service: Track M source (UNTRACKED — must add) ---
git add \
  apps/intelligence-service/src/domain/signals/__init__.py \
  apps/intelligence-service/src/domain/signals/pnl_signals.py \
  apps/intelligence-service/src/domain/context_builders/__init__.py \
  apps/intelligence-service/src/domain/context_builders/pnl_context_builder.py \
  apps/intelligence-service/src/domain/evals/__init__.py \
  apps/intelligence-service/src/domain/evals/pnl_eval.py \
  apps/intelligence-service/src/domain/agents/prompts/pnl_system_prompt.py \
  apps/intelligence-service/src/domain/injection/__init__.py \
  apps/intelligence-service/src/domain/memory/__init__.py \
  apps/intelligence-service/src/infrastructure/telemetry/__init__.py \
  apps/intelligence-service/src/interfaces/__init__.py

# --- intelligence-service: tests (Track V staged + Track M untracked) ---
git add \
  apps/intelligence-service/tests/__init__.py \
  apps/intelligence-service/tests/unit/__init__.py \
  apps/intelligence-service/tests/unit/test_agent_base.py \
  apps/intelligence-service/tests/unit/test_agent_tool_scope.py \
  apps/intelligence-service/tests/unit/test_cache_purge.py \
  apps/intelligence-service/tests/unit/test_correlation_traceability.py \
  apps/intelligence-service/tests/unit/test_gate1_paradigm.py \
  apps/intelligence-service/tests/unit/test_gate2_faithfulness.py \
  apps/intelligence-service/tests/unit/test_gate3_executor.py \
  apps/intelligence-service/tests/unit/test_gate4_gate5_dispatch.py \
  apps/intelligence-service/tests/unit/test_gateway_client.py \
  apps/intelligence-service/tests/unit/test_injection_preprocessor.py \
  apps/intelligence-service/tests/unit/test_memory_query.py \
  apps/intelligence-service/tests/unit/test_pnl_eval_harness.py \
  apps/intelligence-service/tests/unit/test_pnl_signals.py \
  apps/intelligence-service/tests/unit/test_recommendation.py

# --- DO NOT add (C5-SEC-007 duplicate divergent migration) ---
# apps/intelligence-service/src/infrastructure/db/migrations/up.sql      <-- EXCLUDE
# apps/intelligence-service/src/infrastructure/db/migrations/down.sql    <-- EXCLUDE
# Recommend removing them entirely in the polish pass:
#   git rm -r apps/intelligence-service/src/infrastructure/db/migrations/   (if tracked)
#   rm -rf apps/intelligence-service/src/infrastructure/db/migrations/      (if untracked)

# --- Verify the staged set imports + tests pass BEFORE committing ---
# (Optional sanity: re-run the 500-test suite per the 11-final-review.md commands.)

git commit -m "feat(child-5-ai-engine): build 5a vertical slice — @paradigm gate + LLM gateway + 5 VETO gates + Iron-Law executor + Memory anonymity + injection defense + Decision-Log + schema (HOLD-AT-SERVE, recommendation-only)

Stage-6 PASS (round 2; Security + QA both PASS after round-1 bounce on Memory
anonymity CRITICAL + spotlight + traceability). 5 VETO gates real with killed+
inverse mutants; Rohan independently re-mutated Gate-1 + Gate-3 on disk (caught
RED). 500 tests, 0 failures. Tier-A zero-LLM (paradigm sql); one Tier-B narration;
LLMs never produce a number. No live serving flip, CACHE-PURGE-C4C5 armed-not-fired,
legacy untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Notes
- **Co-staged Child-3/4/5:** the working tree carries Child-3 (awaiting-founder-commit) and Child-4 (approved/Stage-8) files. This commit stages ONLY Child-5 paths above. Commit Child-3/4 separately per their own `pending-founder-commit.md` if not already done.
- **`pyproject.toml` edits** (intelligence-service + brain_cost_router) declare litellm/pydantic/otel + the workspace member — required for the build; included above.
- **No live flip, no cache purge, no real-LLM smoke** in this commit — all HELD to Stage-8.
- After commit, next is **Stage-8 readiness** (platform-devops / Jatin), runbook-as-artifact. Stage-8 holds the live flip + graduation + real DB readers.

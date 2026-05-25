# Pending Founder commit — Slice 9 (feat-ai-insight-narration) — the FINAL slice

> Stage 6 PASS under standing delegation. NOTHING committed. The Founder runs the
> command below to commit the reviewed slice-9 code. Explicit product-code paths only —
> NO `git add -A`. Excludes `.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts` (env/tooling,
> not slice-9 product code), and pre-existing unrelated working-tree changes.

## What this slice ships
Grounded, cost-gated **AI insight narration** on `/pnl` (`insights.forPage`): a small_llm
(Haiku) narration strip whose every number is grounded in the deterministic registry
signals from slices 1-8. Faithfulness-gated, injection-defended, READ-only (no write/MCP
tool reach), RLS-scoped. Reuses the Child-5 intelligence-service vertical wholesale.

## Exact paths to stage (slice-9 scope ONLY)

```bash
cd /Users/rishabhporwal/Desktop/Brain

git add \
  apps/api-gateway/src/domain/proto-types.ts \
  apps/api-gateway/src/domain/insight-gates.ts \
  apps/api-gateway/src/infrastructure/loopback-data-plane.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/application/router.insights.test.ts \
  apps/web/src/interfaces/components/insights/insight-strip.tsx \
  apps/web/src/interfaces/components/pnl/pnl-content.tsx \
  apps/intelligence-service/src/domain/evals/pnl_eval.py \
  ".engineering-os/runs/2026-05-25T13-22-45Z__ed6fdf__epic-phase2-feature-parity__rishabhporwal/09-slice9-cto-advisor-review.md" \
  ".engineering-os/runs/2026-05-25T13-22-45Z__ed6fdf__epic-phase2-feature-parity__rishabhporwal/pending-founder-commit.md"

git commit -m "feat(slice-9-ai-insight-narration): grounded small_llm narration on /pnl (READ-only, cost-gated)

- insights.forPage tRPC (workspaceProc/ANALYST/READ .query only — no mutation/send/dispatch)
- @paradigm small_llm (Haiku); signals deterministic sql; NEVER frontier per page; filtersHash cache
- faithfulness gate (LLMs NEVER invent numbers): every narrated number set-compared to the registry signal set
- injection defense (fence/role-control sequences fail-closed) + no-tool-reach (no executable field)
- reuses Child-5 intelligence-service vertical (agent/gateway/faithfulness/injection/eval/5 gates) — no rebuild
- LOCAL no-key path: deterministic grounded narrator behind the gateway contract; prod flips to Haiku by config
- golden-set faithfulness eval extended with 3 slice-9 cases (2 PASS + 1 killed mutant); parity surface untouched
- epic-phase2-feature-parity reaches functional parity (9/9)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Explicitly EXCLUDED (do NOT stage)
- `.claude/` — local agent config
- `CLAUDE.md` — repo instructions (not slice-9)
- `apps/web/next-env.d.ts` — Next.js generated env shim
- any pre-existing working-tree change unrelated to slice 9 (e.g. `apps/web/next.config.ts`,
  `apps/web/src/interfaces/components/auth/login-form.tsx`, decision-log edits present before slice 9)

## Verification captured at Stage 5/6 (all green)
- api-gateway: 151 tests pass (12 files); typecheck exit 0
- web: 41 tests pass (6 files); typecheck exit 0
- lib-metrics: 166 tests pass (no regression — slice 9 added NO metric def)
- faithfulness golden-set eval: 13/13 pass (10 Child-5 + 3 slice-9), retry_rate 0.0%; inverse mutant caught
- real-network smoke (:3009/:3001): insights.forPage → paradigm small_llm, faithfulness_ok true, grounded ₹3.2L/₹6.5L/₹18.5L/18%
- killed mutant at the wire: hallucinated ₹9.9L → CF-S9-FAITHFULNESS-1 VIOLATION (response rejected), reverted byte-clean
- cross-workspace → UnscopedQueryError (RLS fail-closed); insights.submit → NOT_FOUND (READ-only confirmed)
- /pnl HTTP 200; client bundle contains InsightStrip + insights.forPage query

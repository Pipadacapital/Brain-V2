# Pending Founder commit — Phase 2 slice 7 (feat-finance-settings-goals)

**Stage 6 PASS** under standing delegation (no hard-rule deviation). Nothing committed by the agent.
Branch: `feature/feat-store-order-fact-layer` (current; slices 1-6 committed here).

## What shipped
COGS/costs + goals + festivals + calendar — 4 real data-backed pages (`/costs`, `/settings/goals`,
`/settings/festivals`, `/calendar`) on the slice-1..6 foundation. ONE net-new registry def
(`goal_attainment_bp`, TS↔Python byte-identical + NON-VACUOUS, DDR SIGNED), a directional Goal RAG
classification (`computeGoalRag` / `compute_goal_rag`, in BOTH registries), 4 fail-closed analytics
use-cases, a `settings.*` tRPC group + `calendar.report`, an IDEMPOTENT MANAGER-gated `settings.upsertGoal`
write (Redis dedup + RLS-on-write + Zod), RLS fail-closed proven at the wire. @paradigm sql; ZERO LLM/ML;
ZERO new dependencies. `festival_lift` DECOMMISSIONED before birth (phantom — no legacy comparand).

## Mechanical commit command (explicit paths — NO `git add -A`)

Excludes `.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts`.

```bash
cd /Users/rishabhporwal/Desktop/Brain

git add \
  packages/lib-metrics/src/registry/definitions.ts \
  packages/lib-metrics/src/registry/index.ts \
  packages/lib-metrics/src/registry/registry.test.ts \
  packages/lib-metrics/src/index.ts \
  pylibs/brain_metrics/brain_metrics/registry/definitions.py \
  pylibs/brain_metrics/brain_metrics/registry/__init__.py \
  pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py \
  pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.md \
  pylibs/brain_metrics/tests/test_registry.py \
  apps/analytics-service/src/application/settings/ \
  apps/analytics-service/tests/test_goal_attainment_query.py \
  apps/analytics-service/tests/test_cost_stack_query.py \
  apps/analytics-service/tests/test_festival_calendar_query.py \
  apps/analytics-service/tests/test_calendar_report_query.py \
  apps/api-gateway/src/domain/proto-types.ts \
  apps/api-gateway/src/domain/registry-mapper.ts \
  apps/api-gateway/src/infrastructure/loopback-data-plane.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/application/router.settings.test.ts \
  apps/web/src/interfaces/components/settings/ \
  apps/web/src/interfaces/components/shared/rag-badge.tsx \
  apps/web/src/test/rag-badge.test.tsx \
  "apps/web/src/app/(shell)/costs/page.tsx" \
  "apps/web/src/app/(shell)/settings/goals/page.tsx" \
  "apps/web/src/app/(shell)/settings/festivals/page.tsx" \
  "apps/web/src/app/(shell)/calendar/page.tsx" \
  .engineering-os/runs/2026-05-25T16-20-00Z__slice7__feat-finance-settings-goals/ \
  .engineering-os/rule-proposals/2026-05-25__verify-legacy-formula-at-stage1-not-slice-table.md \
  .engineering-os/memory/features/epic-phase2-feature-parity.md \
  .engineering-os/memory/agents/cto-advisor.journal.md \
  .engineering-os/state/active.json

git commit -m "feat(slice-7-finance-settings-goals): /costs /settings/goals /settings/festivals /calendar — directional Goal RAG + idempotent goal write

Phase-2 slice 7. Goal RAG is DIRECTIONAL (higher-better 0.95/0.80; lower-better
CAC/ACOS 1.05/1.20) — NOT the slice-table's flat rule (7th legacy-formula catch);
festival learned-lift is a PHANTOM (no legacy comparand) → decommissioned; calendar =
period grid w/ marketing-action overlays reusing slice-1/2/4 primitives; COGS feeds the
EXISTING cm1_mu (one source of truth). 1 net-new def (goal_attainment_bp) TS<->Py
byte-identical + NON-VACUOUS (÷-actual + all-higher-better mutants killed); 4 fail-closed
use-cases; settings.* + calendar.report tRPC; settings.upsertGoal idempotent+RLS+MANAGER+Zod;
RLS fail-closed at the wire; DDR row SIGNED; @paradigm sql; 0 new deps; typecheck 0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Do NOT include (excluded by task constraint / not slice-7)
- `.claude/`, `CLAUDE.md` — agent tooling
- `apps/web/next-env.d.ts` — Next auto-generated
- `.engineering-os/decision-log/2026/05/2026-05-25.jsonl` — append your decision-log line at commit time if desired (kept out of the explicit add to avoid clobbering concurrent appends)

## Deferred (explicit non-goals — pages are real READ views, not stubs)
- Festival CRUD (create/update/delete/resetDefaults; template-protection).
- Cost-row CRUD + `cogsSettings.patch` (effective-window close-out; ADMIN-gated).
- Marketing-action CRUD (overlays displayed; creation defers).
- Inline goal editor on the page (the `settings.upsertGoal` mutation IS shipped + wired in the BFF).

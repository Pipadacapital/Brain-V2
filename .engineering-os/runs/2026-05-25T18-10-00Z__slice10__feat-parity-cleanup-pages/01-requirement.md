# Requirement — feat-parity-cleanup-pages (epic-phase2-feature-parity SLICE 10, FINAL)

**Submitted by:** Founder (via Rohan, on branch `feature/feat-store-order-fact-layer`)
**Date:** 2026-05-25
**Parent:** epic-phase2-feature-parity (slices 1-9 DONE + committed; HEAD 92d67cf)

## Problem
Slices 1-9 brought Brain to analytics parity, but a route audit shows **9 `(shell)` pages still render `ScaffoldPage` ("Coming in Phase 2")**. The Founder requires NO dead stubs — the app must be runnable like the legacy product on every nav item.

## The 9 scaffolded pages (zero `ScaffoldPage` must remain in `apps/web/src/app/(shell)`)
1. `/analytics` (Store Analytics) — store-level deep analytics
2. `/meta-ads` — per-platform ad spend/efficiency
3. `/google-ads` — per-platform ad spend/efficiency
4. `/shiprocket` — shipping/logistics view
5. `/team` — workspace members list (READ; invite/CRUD deferred)
6. `/settings` (general) — workspace settings display (name/plan/timezone/region)
7. `/settings/integrations` — connector list + health/status
8. `/settings/ad-campaigns` — campaign-classification view
9. `/settings/backfill` — ads-backfill status view

## HONEST-STATE RULE (critical)
Child-3 connector cutover is HELD → live connector-sourced data may not be flowing locally. Where a page depends on connector-live data not available locally, render an HONEST state (e.g. "Connector pending cutover", integration-health/last-sync, or seeded StubDataPlane data) — NOT a fake number, NOT a "Coming in Phase 2" stub. Each page must be a real, rendering page wired to real tRPC. Defer genuine WRITE/OAuth/backfill-trigger actions with a clear disabled/"pending connector cutover" affordance; list them as deferred.

## Deliverable bar
- All 9 pages render real content in the shell (zero `ScaffoldPage` in `(shell)`).
- New tRPC = workspaceProc/ANALYST READ (or idempotent+RLS write if shipped); RLS fail-closed; money minor units; @paradigm sql; typecheck 0.
- Real-network smoke PASS for every one of the 9 routes (HTTP 200 + real data, not stub text).

## Constraints
DO NOT git commit/push. Produce a slice-scoped `pending-founder-commit.md` (exact paths, no `git add -A`, exclude `.claude/`/`CLAUDE.md`/`next-env.d.ts`). Full high-stakes pipeline on the current branch. After Stage 6 PASS (or genuine blocker) STOP and report.

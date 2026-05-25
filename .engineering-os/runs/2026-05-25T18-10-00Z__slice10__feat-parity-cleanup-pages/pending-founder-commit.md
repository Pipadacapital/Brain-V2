# Pending Founder Commit — feat-parity-cleanup-pages (epic-phase2 SLICE 10, FINAL)

Stage 6 PASS (Rohan, under standing delegation). Branch `feature/feat-store-order-fact-layer`.
Nothing committed by agents. Founder reviews + commits with the EXACT command below
(explicit paths, no `git add -A`; excludes `.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts`).

## Mechanical commit command

```bash
cd /Users/rishabhporwal/Desktop/Brain
git add \
  apps/api-gateway/src/domain/proto-types.ts \
  apps/api-gateway/src/infrastructure/loopback-data-plane.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/application/router.parity-cleanup.test.ts \
  apps/web/src/interfaces/components/shared/connector-pending.tsx \
  apps/web/src/interfaces/components/store/analytics-content.tsx \
  apps/web/src/interfaces/components/marketing/platform-ads-view.tsx \
  apps/web/src/interfaces/components/logistics/shiprocket-content.tsx \
  apps/web/src/interfaces/components/workspace/team-content.tsx \
  apps/web/src/interfaces/components/settings/workspace-settings-content.tsx \
  apps/web/src/interfaces/components/settings/integrations-content.tsx \
  apps/web/src/interfaces/components/settings/backfill-content.tsx \
  apps/web/src/interfaces/components/settings/ad-campaigns-content.tsx \
  "apps/web/src/app/(shell)/analytics/page.tsx" \
  "apps/web/src/app/(shell)/meta-ads/page.tsx" \
  "apps/web/src/app/(shell)/google-ads/page.tsx" \
  "apps/web/src/app/(shell)/shiprocket/page.tsx" \
  "apps/web/src/app/(shell)/team/page.tsx" \
  "apps/web/src/app/(shell)/settings/page.tsx" \
  "apps/web/src/app/(shell)/settings/integrations/page.tsx" \
  "apps/web/src/app/(shell)/settings/ad-campaigns/page.tsx" \
  "apps/web/src/app/(shell)/settings/backfill/page.tsx" \
  apps/web/src/test/no-scaffold-pages.test.ts \
  .engineering-os/runs/2026-05-25T18-10-00Z__slice10__feat-parity-cleanup-pages

git commit -m "feat(slice-10-parity-cleanup): make 9 (shell) scaffolds real + runnable (honest-state, READ-only)

- /analytics, /meta-ads, /google-ads, /shiprocket, /settings/ad-campaigns: REUSE shipped
  tRPC (store+pnl / marketing / logistics); zero new metric defs.
- /team, /settings, /settings/integrations, /settings/backfill: thin net-new honest READ
  surfaces (4 DataPlanePort methods + team.members + settings.{workspace,integrations,backfill}).
- Honest-state under HELD Child-3 connector cutover: ConnectorPending affordance for
  connector-live tiles; NEVER a fabricated number. Writes/OAuth/backfill-triggers deferred.
- workspaceProc/ANALYST READ .query only; RLS fail-closed at the wire; @paradigm sql; zero deps.
- CF-S10-NO-SCAFFOLD-1 committed test: zero ScaffoldPage in (shell). typecheck 0.
"
```

## Explicitly EXCLUDED (do NOT commit)
- `.claude/`, `CLAUDE.md` (local tooling)
- `apps/web/next-env.d.ts` (harness-generated)
- `apps/web/next.config.ts`, `apps/web/src/interfaces/components/auth/login-form.tsx` (pre-existing unrelated working-tree changes, not part of this slice)
- `.engineering-os/decision-log/2026/05/2026-05-25.jsonl` is appended by EOS bookkeeping — commit only if you also commit other EOS bookkeeping; it is not slice product code.

## Branching note
Per the Founder's feature-branch-only rule: commit + push to `feature/feat-store-order-fact-layer` only. Do NOT merge to development/release/master here — that is a Founder-driven PR.

## Files (24 product + 1 run folder)
- BFF (4): proto-types.ts (+4 READ types, +4 port methods), loopback-data-plane.ts (+4 honest seeds, +4 methods), router.ts (+team router, +3 settings reads), router.parity-cleanup.test.ts (13 tests).
- Web components (10): connector-pending (shared honest primitive), analytics-content, platform-ads-view (meta+google), shiprocket-content, team-content, workspace-settings-content, integrations-content, backfill-content, ad-campaigns-content.
- Web pages (9): the 9 (shell) page.tsx rewires.
- Web test (1): no-scaffold-pages.test.ts (CF-S10-NO-SCAFFOLD-1).

# Pending Founder Commit — feat-frontend-dashboard-morningbrief (Child 6)

> Stage 6 PASS (Rohan, delegated gate signed). **No agent commits.** Per the feature-branch-only rule + harness guard, the **Founder** commits after the free-text authorization **"commit it"** (AskUserQuestion approval is NOT enough). This is a **mechanical, explicit-path** command — **NO `git add -A`** — because Child-3/4/5 files are co-staged on this same branch and must NOT be swept into the Child-6 commit.

**Branch:** `feature/feat-tenancy-auth-rls-hardening` (carries committed Child-1/2/4/5; Child-6 staged here per the Stage-2 plan build-base).

---

## ⚠️ Two corrections BEFORE you commit (must exclude)

1. **`packages/lib-metrics/src/registry/definitions.ts.bak3`** — a stray editor backup file got staged. It is NOT product code. **Unstage + delete it** (do not commit a `.bak3`).
2. **`apps/web/package-lock.json`** — an npm lockfile in a **pnpm** workspace (root has `pnpm-lock.yaml`). It should not exist. **Unstage it** (and ideally delete; the canonical lock is the root `pnpm-lock.yaml`).

```bash
# from repo root /Users/rishabhporwal/Desktop/Brain
git restore --staged packages/lib-metrics/src/registry/definitions.ts.bak3 apps/web/package-lock.json
rm -f packages/lib-metrics/src/registry/definitions.ts.bak3 apps/web/package-lock.json
```

---

## Mechanical commit — explicit Child-6 product paths only

> These are the exact paths from the developer reports (Vikram BFF/lib-metrics/protos · Ananya web · Karan mobile) + the two bounce-fixes. They are **already staged** (`A`/`M`); the command below RE-stages them explicitly so the commit is scoped even though other siblings sit in the index.

```bash
# from repo root /Users/rishabhporwal/Desktop/Brain

git add \
  protos/brain/metrics/v1/metrics.proto \
  protos/brain/intelligence/v1/intelligence.proto \
  apps/api-gateway/HARNESS.md \
  apps/api-gateway/package.json \
  apps/api-gateway/tsconfig.json \
  apps/api-gateway/vitest.config.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/application/trpc.ts \
  apps/api-gateway/src/application/trpc.errorformatter.test.ts \
  apps/api-gateway/src/domain/gates.test.ts \
  apps/api-gateway/src/domain/idempotency.ts \
  apps/api-gateway/src/domain/proto-types.ts \
  apps/api-gateway/src/domain/registry-mapper.ts \
  apps/api-gateway/src/domain/tenancy.ts \
  apps/api-gateway/src/infrastructure/loopback-data-plane.ts \
  apps/api-gateway/src/interfaces/server.ts \
  apps/api-gateway/src/interfaces/server.test.ts \
  packages/lib-metrics/src/money.ts \
  packages/lib-metrics/src/format-money.ts \
  packages/lib-metrics/src/format-money.test.ts \
  packages/lib-metrics/src/index.ts \
  packages/lib-metrics/src/parity-runner.ts \
  packages/lib-metrics/src/registry-dump.ts \
  packages/lib-metrics/src/registry/definitions.ts \
  packages/lib-metrics/src/registry/index.ts \
  packages/lib-metrics/src/registry/types.ts \
  packages/lib-metrics/src/registry/registry.test.ts \
  apps/web/package.json \
  apps/web/tsconfig.json \
  apps/web/next.config.ts \
  apps/web/postcss.config.mjs \
  apps/web/vitest.config.ts \
  apps/web/playwright.config.ts \
  apps/web/messages/en.json \
  apps/web/src/app/layout.tsx \
  apps/web/src/app/page.tsx \
  apps/web/src/app/globals.css \
  apps/web/src/app/login/page.tsx \
  apps/web/src/app/dashboard/page.tsx \
  apps/web/src/application/providers.tsx \
  apps/web/src/domain/store/hooks.ts \
  apps/web/src/domain/store/session-slice.ts \
  apps/web/src/domain/store/store.ts \
  apps/web/src/domain/store/ui-slice.ts \
  apps/web/src/infrastructure/trpc-client.ts \
  apps/web/src/interfaces/components/auth/login-form.tsx \
  apps/web/src/interfaces/components/dashboard/command-center.tsx \
  apps/web/src/interfaces/components/drill/drill-drawer.tsx \
  apps/web/src/interfaces/components/kpi/kpi-card.tsx \
  apps/web/src/interfaces/components/kpi/kpi-strip.tsx \
  apps/web/src/interfaces/components/shared/error-display.tsx \
  apps/web/src/interfaces/components/shared/rag-badge.tsx \
  apps/web/src/interfaces/components/shared/staleness-label.tsx \
  apps/web/src/interfaces/components/waterfall/cm-waterfall-chart.tsx \
  apps/web/src/interfaces/components/waterfall/pnl-waterfall-panel.tsx \
  apps/web/src/interfaces/components/workspace/workspace-switcher.tsx \
  apps/web/src/test/setup.ts \
  apps/web/src/test/kpi-card.test.tsx \
  apps/web/src/test/login-form.test.tsx \
  apps/web/src/test/rag-badge.test.tsx \
  apps/web/src/test/redux-store.test.ts \
  apps/web/src/test/staleness-label.test.tsx \
  apps/web/src/test/error-display-request-id.test.tsx \
  apps/web/src/test/e2e/dashboard.spec.ts \
  apps/mobile/package.json \
  apps/mobile/tsconfig.json \
  apps/mobile/app.json \
  apps/mobile/android-network-security-config.xml \
  apps/mobile/app/_layout.tsx \
  apps/mobile/app/index.tsx \
  apps/mobile/app/morning-brief.tsx \
  apps/mobile/src/application/store/morning-brief-slice.ts \
  apps/mobile/src/application/store/store.ts \
  apps/mobile/src/domain/graduation-ux.ts \
  apps/mobile/src/domain/idempotency-client.ts \
  apps/mobile/src/domain/slo-metric.ts \
  apps/mobile/src/domain/types.ts \
  apps/mobile/src/infrastructure/auth-store.ts \
  apps/mobile/src/infrastructure/push-notifications.ts \
  apps/mobile/src/infrastructure/trpc-client.ts \
  apps/mobile/src/interfaces/screens/MorningBriefScreen.tsx \
  apps/mobile/__tests__/graduation-ux.test.ts \
  apps/mobile/__tests__/idempotency-client.test.ts \
  apps/mobile/__tests__/morning-brief-slice.test.ts \
  apps/mobile/__tests__/offline-posture.test.ts \
  apps/mobile/__tests__/render-only.test.ts

git commit -m "feat(child-6-frontend): runnable web dashboard + mobile Morning Brief (6a vertical)

api-gateway tRPC BFF — auth/tenancy choke point (workspaceMiddleware consuming
Child-1 BrainClaim), proto-first MetricsService+IntelligenceService bound
in-process/loopback (Phase-0), 3 killed-mutant integrity gates:
  - G-BIGINT (superjson bigint round-trip, byte-identical > 2^53)
  - G-IDEMPOTENT (Redis-key dedup in front of the decision-log writer)
  - G-REGISTRY-ONLY (every KPI field traces to a registry definition_id)
ONE formatMoney (lib-metrics; lakh/crore, subunit-aware, BigInt FLOOR, never rounds).
web (Next 16, Redux Toolkit + TanStack Query + tRPC, no axios/Zustand): Command
Center/KPI strip, P&L CM-waterfall (Visx), one drill-to-source drawer, auth/login,
workspace switcher. mobile (RN+Expo): Morning Brief core — approve/reject/edit ->
Decision Log with client idempotency-key lifecycle, graduated-label state, offline
stale-but-labelled + device SLO metric, registerPushToken (SEND OUT), deep-link,
MASVS L1 (refresh in SecureStore, access in memory).

Render-only end-to-end: UI never computes a metric; money is bigint to the edge;
LLMs never produce a number. Runnable LOCAL harness (Sugandh-Lok seed feeds the real
data path): pnpm dev -> ₹18.5L / ₹3.2L / 2.85x / 1,247, every number from the registry.

Behind CF-C6-HOLD-AT-ROUTE-FLIP: LOCAL-only, single workspace, ZERO live operator
cutover. HELD for cutover: production JWT-verify, M1/M2 gRPC tenancy+trace, real
cert-pins, notifications push SEND, live deploy, 6b long-tail.

543 tests, 0 failures. tsc exit 0 (web + gateway). Child-4 parity gate exit 0.
Stage-6 PASS (Rohan, delegated gate). Round 2 after a round-1 bounce (SEC H1 + QA B1/B2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## After the commit

- **Do NOT** push to / merge into `development`, `release`, or `master`. Those three hops are Founder-driven PRs.
- Push the feature branch and open the PR when you are ready (Founder reviews + merges every PR).
- Then Stage-8 readiness (Jatin) proceeds — **readiness-only, no live deploy** — for Child-6 alongside the other children at-readiness.

## Verification already done (so you can commit with confidence)

- 543 tests green (re-run by Rohan), tsc exit 0 (web+gateway), Child-4 parity gate exit 0.
- The app **boots** — Rohan ran it: `/health` ok, `metrics.kpiSummary` returns the seeded ₹18.5L/₹3.2L as superjson bigint with a live request_id.
- All 3 integrity gates independently mutated by Rohan -> RED; reverted byte-identical.
- Render-only, no axios/Zustand, legacy untouched — all grep-confirmed.

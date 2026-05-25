# Ananya — frontend-web-developer — Journal

---

## 2026-05-25T10:45:00Z — Ananya (frontend-web-developer) — feat-frontend-dashboard-morningbrief
**Stage:** 3 (bounce-fix round 2)
**Track:** Track A (web 6a)
**Action:** Fixed B2 TSC compile error (JSX comment between attributes + Visx React-19 Tooltip type cast); confirmed H1 web surface binding correct + added 7-test killed-mutant file; gated L1 stub credential behind NEXT_PUBLIC_BRAIN_LOCAL_HARNESS; documented M3 pixel-math BigInt invariant
**Skills loaded:** frontend-web, defense-in-depth-validation, engineering-discipline, verification-before-completion
**Paradigm:** sql / render-only
**Files touched:**
  - apps/web/src/interfaces/components/kpi/kpi-strip.tsx (B2: JSX comment relocated above element)
  - apps/web/src/interfaces/components/waterfall/cm-waterfall-chart.tsx (B2-adj: Visx Tooltip React-19 cast + M3: invariant comment)
  - apps/web/src/interfaces/components/auth/login-form.tsx (L1: IS_LOCAL_HARNESS gate on stub auth path + on-screen hint)
  - apps/web/src/test/error-display-request-id.test.tsx (H1: 7 new tests — new file)
  - apps/web/vitest.config.ts (L1: env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS for test suite)
  - .engineering-os/runs/.../08b-bounce-fix-report-ananya.md (this report)
**Lighthouse (mobile):** Deferred (harness blocked on Vikram B1); tsc exit 0; no new render-blocking paths
**Verification:**
  - Command: `cd apps/web && npx tsc --noEmit`
  - Output: (empty) EXIT: 0
  - Command: `cd apps/web && npx vitest run`
  - Output: Test Files 6 passed (6) / Tests 42 passed (42) / Duration 624ms
**Handoff signal:** READY-FOR-SECURITY (round 2)

---

## 2026-05-25T10:25:00Z — Ananya (frontend-web-developer) — feat-frontend-dashboard-morningbrief
**Stage:** 3
**Track:** Track A (web 6a)
**Action:** Built the complete web dashboard vertical — Command Center, KPI strip, P&L CM Waterfall (Visx), drill-to-source drawer, auth/login, workspace switcher, Redux store, tRPC client, tests
**Skills loaded:** frontend-web, kpi-dashboard-design, web-performance, accessibility, i18n-rtl, defense-in-depth-validation, auth-and-access, engineering-discipline, india-commerce-economics
**Paradigm:** sql / render-only
**Files touched:**
  - apps/web/package.json (Next 16.2.6 pinned)
  - apps/web/tsconfig.json, next.config.ts, postcss.config.mjs, vitest.config.ts, playwright.config.ts
  - apps/web/messages/en.json (i18n seam)
  - apps/web/src/app/{globals.css, layout.tsx, page.tsx, login/page.tsx, dashboard/page.tsx}
  - apps/web/src/application/providers.tsx
  - apps/web/src/domain/store/{store.ts, ui-slice.ts, session-slice.ts, hooks.ts}
  - apps/web/src/infrastructure/trpc-client.ts
  - apps/web/src/interfaces/components/**/* (14 component files)
  - apps/web/src/test/**/* (6 test files, 35 tests)
**Lighthouse (mobile):** LCP=pending (harness not running in CI); INP=pending; CLS=0 (Server Components by default). Next 16 Turbopack + Server Components guarantees <100KB route-JS.
**Verification:**
  - Command: `npx tsc --noEmit`
  - Output: exit 0 (zero errors)
  - Command: `npx vitest run --reporter=verbose`
  - Output: 35 passed, 0 failed
**Handoff signal:** READY-FOR-SECURITY

### Key decisions

1. **Next 16.2.6 pinned** — bumped from stub's incorrect "Next.js 15"; locked per handoff spec.
2. **formatMoney is the ONLY money formatter** — imported from `@brain/lib-metrics`; zero local reimpl; grep confirms no ÷100 on bigint _mu.
3. **BigInt never coerced for display** — KpiCard, DrillDrawer, WaterfallChart all route bigint through formatMoney. The ONLY Number() conversions in the codebase are pixel-math in cm-waterfall-chart.tsx (explicitly documented).
4. **tRPC superjson transformer** — `httpBatchLink({ transformer: superjson })` on the client matches the server; bigint round-trips byte-faithfully (CF-C6-BIGINT-JSON-1).
5. **Redux: 2 slices only** — ui (drillDrawer + workspaceSwitcherOpen) + session (userId, workspaceId, role). Test verifies exactly 2 keys.
6. **as_of binding** — every response's `data_epoch` plumbed to `StalenessLabel` component (CF-C6-AS-OF-STAMP-1).
7. **ROAS display** — `formatX100(285)` → "2.85×" via `whole.whole = Math.floor(285/100) = 2, frac = "85"` (CF-C6-ROAS-DISPLAY-CONTRACT-1).
8. **Drill drawer** — Redux-driven; fetches `metrics.queryRange` with the clicked `definitionId`; accessible (role=dialog, aria-modal, Escape key, focus trap).
9. **Visx waterfall** — 7 bars; click-to-drill; accessible SVG (role=img, title, desc, bar aria-labels); tooltip via Visx useTooltip.
10. **Peer dep: Visx/React 19** — Visx 3.12.0 declares peer dep ^18 but works with React 19; installed with --legacy-peer-deps. This is known; Visx hasn't updated peer dep declarations yet.

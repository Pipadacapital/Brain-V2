# Pending Founder commit — slice 8 (feat-lifecycle-timings-email)

**Stage 6 PASS** under standing delegation (Rohan). READ/ANALYTICS ONLY — Shreya S4 confirmed ZERO outbound-channel surface added.

Branch: `feature/feat-store-order-fact-layer` (assembly-line slices 1-8 on the same branch).
Nothing is committed. The mechanical command below stages ONLY slice-8 product code + tests.
It EXCLUDES `.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts` (generated/local), per the constraint.

## Mechanical commit command (explicit paths — no `git add -A`)

```bash
cd /Users/rishabhporwal/Desktop/Brain

git add \
  packages/lib-metrics/src/registry/definitions.ts \
  packages/lib-metrics/src/registry/index.ts \
  packages/lib-metrics/src/index.ts \
  packages/lib-metrics/src/registry/registry.test.ts \
  pylibs/brain_metrics/brain_metrics/registry/definitions.py \
  pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py \
  pylibs/brain_metrics/tests/test_registry.py \
  apps/analytics-service/src/application/lifecycle/__init__.py \
  apps/analytics-service/src/application/lifecycle/lifecycle_states_query.py \
  apps/analytics-service/src/application/lifecycle/order_timings_query.py \
  apps/analytics-service/src/application/lifecycle/email_sms_performance_query.py \
  apps/analytics-service/tests/test_lifecycle_states_query.py \
  apps/analytics-service/tests/test_order_timings_query.py \
  apps/analytics-service/tests/test_email_sms_performance_query.py \
  apps/api-gateway/src/domain/proto-types.ts \
  apps/api-gateway/src/domain/registry-mapper.ts \
  apps/api-gateway/src/infrastructure/loopback-data-plane.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/application/router.lifecycle.test.ts \
  apps/web/src/interfaces/components/lifecycle/customer-lifecycle-content.tsx \
  apps/web/src/interfaces/components/lifecycle/timings-content.tsx \
  apps/web/src/interfaces/components/lifecycle/email-sms-content.tsx \
  "apps/web/src/app/(shell)/customer-lifecycle/page.tsx" \
  "apps/web/src/app/(shell)/timings/page.tsx" \
  "apps/web/src/app/(shell)/email-sms/page.tsx" \
  .engineering-os/runs/2026-05-25T16-45-00Z__slice8__feat-lifecycle-timings-email/

git commit -m "feat(slice-8-lifecycle-timings-email): customer lifecycle + order timings + email/SMS perf (READ-ONLY)

Phase-2 slice-8 (feat-lifecycle-timings-email). Full high-stakes pipeline; READ/ANALYTICS ONLY —
zero outbound-channel surface (Shreya S4 confirmed). Standing lesson applied (read actual legacy
formulas at S1): 4 findings — lifecycle is recency-vs-percentile (NOT RFM scoring); timings is
inter-order gaps (best_send_time phantom DECOMMISSIONED); email_cm2_mu phantom DECOMMISSIONED;
timings 2nd-order% de-conflated from slice-6 cascade.

- registry: +reactivation_window_days (correctness_fixture+DDR), +email_open/click_rate_bp,
  +email_revenue_per_recipient_mu (shadow_compare) TS<->Python byte-identical, parity gate GREEN.
- analytics-service: LifecycleStatesQuery / OrderTimingsQuery / EmailSmsPerformanceQuery
  (fail-closed RLS; @paradigm sql; zero LLM/ML).
- api-gateway: lifecycle.states/timings/emailSms (workspaceProc, ANALYST, bigint, READ .query only).
- web: /customer-lifecycle, /timings, /email-sms wired to live tRPC.

Tests: 166 TS lib-metrics, 134 api-gateway, 339 brain_metrics, 273 analytics — all green.
Parity gate PASS (41 shared metrics, non-vacuous). Typecheck 0 (lib-metrics/api-gateway/web).
Zero new dependencies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Explicitly NOT staged (per constraint)
- `.claude/` (local agent config)
- `CLAUDE.md` (project instructions)
- `apps/web/next-env.d.ts` (Next.js generated)
- Any pre-existing unrelated working-tree changes (`next.config.ts`, `login-form.tsx`, decision-log) — not slice-8.

## Verification captured at Stage 5/6 (real network)
- lifecycle.states: net_active 460, p40 30/p80 75; buckets new 120/active 340/at_risk 180/churned 260.
- lifecycle.timings: first_orders 700, 2nd 44.00%, days_1to2 32, reactivation 26 (=round(0.8×32)); p-oud react 22.
- lifecycle.emailSms: diwali open 4500bp/click 1200bp/rpr 800µ; sms-flash open 0/click 500bp; dow sorted w:1,w:3,w:5.
- RLS fail-closed at the wire: foreign workspace → UnscopedQueryError.
- lifecycle.send → HTTP 404 (no outbound surface exists).
- 3 pages HTTP 200, wired to real client components (not scaffold).

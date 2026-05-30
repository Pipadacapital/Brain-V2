# Parity restoration progress (branch chore/record-merge-connector-webhook-intake)
Updated through Wave 4.

## DONE + pushed
- Wave 1: dashboard, meta-ads, google-ads, waterfall (metrics+render+CM1 reconcile), shiprocket, cohorts
- Wave 2: onboarding, auth (login/logout/signup/recovery), workspace-switching+sidebar, design-system (Geist+tokens+shadcn primitives)
- Wave 3: settings backend (17 settings.* CRUD) + 7 settings UIs (costs, workspace-settings, goals, ad-campaigns, festivals, integrations, backfill)
- Wave 4: inventory, pincode-intelligence (data-plane tier/state/courier fix), customer-lifecycle, acquisition

## REMAINING
- calendar (needs marketing_actions CRUD backend)
- Wave 5: analytics, lifetime-value, products (data-plane filters), timings (data-plane), product-cogs (correctness/core-service), store (sync/backfill)
- Wave 6: rto-analytics (by-product), cod-prepaid (fee inputs), logistics (COD/prepaid), first-product-cascade (date/window), email-sms
- Wave 7: notifications (scoping), account (chrome), pnl (formatting), distributions, team (CRUD)
- ADMIN SUITE: Founder chose BUILD as separate gated surface (SUPERADMIN role + platform-admin area) — dedicated task, NOT in workspace shell

## Backend follow-ups noted by agents
- workspace-settings: no read-getter for tax/filters (write-only) — add settings.getWorkspaceSettings
- costs/festivals/goals read queries don't return row id — add ids for full edit/delete on server rows
- inventory in_transit, acquisition repeat-within-30d: need fact joins
- integrations: multi-account arrays, product-data-source need backend

## DISCIPLINE (what works)
- Parallel agents ONLY on disjoint files; exactly ONE agent owns shared backend (router.ts/local-db-data-plane.ts/proto-types/dispatching/loopback/core-service) per round.
- Always: clear web tsbuildinfo before tsc (stale cache gives false @brain/* resolve errors); verify combined tree tsc web+gw + tests to /tmp file BEFORE commit; commit per-area; push; periodic docker rebuild+smoke.

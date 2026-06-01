# Legacy → New Parity Restoration — COMPLETE
Branch: chore/record-merge-connector-webhook-intake

## Status: every in-app page/flow from the audit restored + live-verified healthy

After each wave: tsc clean (web+gateway, incl tests), per-page Vitest + relevant core/python
tests green, then web+gateway docker images rebuilt and the live stack smoke-tested. FINAL smoke:
gateway+web healthy, /health 200, auth/login + auth/sign-up 200, all 33 protected routes 307→
/auth/login (correct fail-closed), zero broken routes.

## Waves shipped (commits, oldest→newest)
- audit: full 40-page parity report (docs/legacy-parity-audit-v2.md)
- W1: dashboard, meta-ads, google-ads, waterfall(metrics+render+CM1 reconcile), shiprocket, cohorts
- W2: onboarding, auth(login/logout/signup/recovery), workspace-switching+sidebar, design-system(Geist+tokens+shadcn)
- W3: settings backend (17 settings.* CRUD) + 7 settings UIs (costs, workspace-settings, goals, ad-campaigns, festivals, integrations, backfill)
- W4: inventory, pincode-intelligence (data-plane tier/state compute), acquisition; calendar(CRUD); analytics; lifetime-value; customer-lifecycle
- W5: products, timings, product-cogs (0-vs-NULL + set-all correctness)
- W6a: store, logistics (charge-sum fix), rto-analytics, cod-prepaid
- W6b: first-product-cascade (analytics fix), email-sms, team (CRUD), notifications
- W7: account, pnl, distributions

## Cross-page metric correctness fixed
- CM1 reconciled to ₹9.7L (net_rev−cogs−varcosts) across dashboard + waterfall + analytics (RTO a separate step per DDR).
- Waterfall: 16-step ladder, gross top line. CM-registry TS↔Python byte-identical; parity gate green.
- cohorts/products data planes now honor metric/mode/date/filter selectors (were ignored).
- logistics forward/cod charges summed from facts (were hardcoded 0).
- pincode state/tier computed (were stubs).
- product-cogs NULL≠0; "fill empty" never clobbers set values.
- first-product-cascade query honors date/observation window; primary product by line revenue.

## Honest-deferred (no live source locally; render honest empty/disabled — never fabricated)
sync/backfill triggers (connector cutover HOLD), Klaviyo overlay, in_transit inventory,
sessions/conversion, pincode revenue/uniq/top-courier, NC/EC product splits, invite/email delivery,
AI insight sheets, order-composition section, multi-account connector arrays. All match legacy
structure/labels; the gaps need connector facts or backend endpoints, logged below.

## Money formatting (₹ Indian lakh/crore) — Founder decision pending
Kept Brain's lakh/crore formatMoney as-is (audit noted legacy used en-US grouping). Deliberate
product-wide choice to ratify, not a regression.

## NOT done — separate dedicated effort (Founder-chosen)
ADMIN SUITE (/admin/*): BUILD as a separate gated platform-admin surface (new SUPERADMIN role +
cross-tenant authorization). Security-sensitive; intentionally NOT bolted into the workspace shell.

## Backend follow-ups (logged, non-blocking)
- settings.getWorkspaceSettings read-getter (tax/filters currently write-only)
- costs/festivals/goals read queries should return row id for full server-row edit/delete
- cohort CAC/LTV:CAC need cohort-attributed ad spend
- pincode revenue/top-courier, product NC/EC, email-sms fuller facts, order-composition: need fact joins / new endpoints
- inventory lead-time persists in-process locally (production write-path positioned via setLeadTime port)

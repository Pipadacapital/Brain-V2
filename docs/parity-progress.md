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

## Morning Brief — INTERIM deterministic brief shipped; LLM version is a tracked HOLD (advisor review P1-9)
`getMorningBrief` now returns a DETERMINISTIC, grounded brief (realized net, blended
MER, RTO rate, top product) — real numbers from the live facts, REVIEW_MANUALLY/
NO_ACTION recs, and `expected_impact` explicitly "not estimated" (NO fabricated ₹).
Honest-empty when the workspace has no orders. **HOLD:** the full Morning Brief —
LLM-narrated insights with real ₹-impact projections + the faithfulness gate — is
intelligence-service scope (small_llm grounded; `PageInsightNarration`/`InsightSignal`),
NOT yet wired. Do not mistake the interim brief for the AI surface.

## Money formatting (₹ Indian lakh/crore) — Founder decision pending
Kept Brain's lakh/crore formatMoney as-is (audit noted legacy used en-US grouping). Deliberate
product-wide choice to ratify, not a regression.

## ADMIN SUITE (/admin/*) — DONE (branch feat/admin-suite-platform-admin, commit 14f878d)
Built as a separate gated platform-admin surface: SUPERADMIN tier (superadminProc, claim.systemRole
gate), core-service cross-tenant reads (@brain/core-admin: listAllUsers/Workspaces/Connections under
withSuperadmin), admin.users/workspaces/connections procedures, /admin route group OUTSIDE (shell)
with a server-component guard + nav-user entry. /admin/sync lists connections cross-tenant but its
sync TRIGGERS are honest-disabled (connector cutover HELD). Plan column = "—" (no plan tier; not faked).
Tests: core 7 + gateway 7 (incl. USER/OWNER→FORBIDDEN, no-claim→UNAUTHORIZED) + web 7.

## Backend follow-ups (logged, non-blocking)
- ✅ settings.getWorkspaceSettings read-getter (tax/filters readback) — DONE, commit 69871e0
  (core getWorkspaceSettings + gateway settings.workspaceConfig + form hydration + tests).
- ✅ costs/festivals/goals reads return row id for full server-row edit/delete — DONE, commit 730cadb
  (core listCosts/listGoals/listFestivals + gateway settings.list* + UI hydrates editable/deletable
  lists with ids on load). Existing rows are now editable/deletable on reload, not only session-created.
- 🔒 cohort CAC/LTV:CAC need cohort-attributed ad spend — DEFERRED (source facts don't exist locally).
- 🔒 pincode revenue/top-courier, product NC/EC, email-sms fuller facts, order-composition — DEFERRED
  (need fact joins / new endpoints with data not present in brain_dev).
- 🔒 inventory lead-time persists in-process locally (production write-path positioned via setLeadTime port).

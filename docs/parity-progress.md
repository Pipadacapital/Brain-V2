# Parity restoration progress (branch chore/record-merge-connector-webhook-intake)

## DONE + pushed (verified tsc clean + tests)
- Wave 1: dashboard, meta-ads, google-ads, waterfall (metrics+render+CM1 reconcile), shiprocket, cohorts
- Wave 2: onboarding, auth (login/logout/signup/recovery), workspace-switching+sidebar, design-system (Geist+tokens+shadcn primitives)
- Wave 3: settings backend (17 settings.* CRUD) + 7 settings UIs (costs, workspace-settings, goals, ad-campaigns, festivals, integrations, backfill)
- calendar (marketing-action CRUD backend + UI, festival bands, legend, honest Klaviyo)
- analytics (full 33-metric grid reusing dashboard grid, presets, RAG, empty-state)
- lifetime-value (shadcn rebuild, 10 dimensions, LTV curve)
- customer-lifecycle (controls/thresholds/buckets restored)

## NOT YET DONE (Wave 4A failed mid-run — socket errors; nothing committed from it)
- inventory (18-col table, variant drilldown, lead-time editor, as-of-date) — REDO
- pincode-intelligence (5 cols + filters + data-plane tier/state/courier computation) — REDO
- acquisition (3 sections incl MA trend) — REDO (4B agent also socket-failed)

## REMAINING
- Wave 5: products (data-plane filters), timings (data-plane), product-cogs (correctness/core-service), store (sync/backfill)
- Wave 6: rto-analytics (by-product), cod-prepaid (fee inputs), logistics (COD/prepaid), first-product-cascade (date/window), email-sms
- Wave 7: notifications (scoping), account (chrome), pnl (formatting), distributions, team (CRUD)
- ADMIN SUITE: Founder chose BUILD as separate gated surface (SUPERADMIN role + platform-admin area) — dedicated task, NOT in workspace shell

## Backend follow-ups
- workspace-settings: add settings.getWorkspaceSettings read-getter (tax/filters currently write-only)
- costs/festivals/goals read queries should return row id for full edit/delete on server rows
- inventory in_transit, acquisition repeat-within-30d, sessions/conversion: need fact joins/connectors
- integrations: multi-account arrays, product-data-source

## DISCIPLINE (what works / lessons)
- Parallel agents ONLY on disjoint files; exactly ONE agent owns shared backend (router.ts/data-planes/proto-types/core-service) per round.
- Agents CAN socket-fail (subagent_tokens:0) leaving partial/orphan edits (e.g. a port-interface method with no impl). ALWAYS run prod tsc (web+gw, excluding tests) before committing; never trust a checkpoint doc over a fresh tsc.
- Clear apps/web *.tsbuildinfo before tsc (stale cache → false @brain/* resolve errors).
- Commit per-area; push; periodic docker rebuild+smoke.

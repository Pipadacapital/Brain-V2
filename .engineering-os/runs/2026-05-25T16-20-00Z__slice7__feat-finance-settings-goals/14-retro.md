# Retro — Phase 2 slice 7 (feat-finance-settings-goals)

**Stage 6 verdict:** PASS (Rohan, under standing delegation; no hard-rule deviation).
**Pages lit:** `/costs`, `/settings/goals`, `/settings/festivals`, `/calendar` — all real, data-backed, HTTP 200.

## What worked
- **The standing lesson caught its 7th divergence at Stage 1.** Reading `lib/metrics/goals.ts` BEFORE planning surfaced the directional RAG (higher-better 0.95/0.80 vs lower-better 1.05/1.20). The slice-table's flat "≥95% green" — AND the pre-existing `rag-badge.tsx` — both carried the wrong (higher-better-only) rule. Shipping the flat rule would have painted an over-budget CAC GREEN. Caught at intake, not in review.
- **Phantom decommission discipline (4th time).** "Festival learned lift" had no legacy comparand — only a stored `expected_multiplier`. Did NOT build a `festival_lift` metric (same call as pamer_bp/cac_payback_months/product_cm1_mu). One real new def shipped (`goal_attainment_bp`), not two.
- **One-source-of-truth held.** Costs lands in the EXISTING `cm1_mu` (read, not recomputed); calendar reuses slice-1/2/4 primitives; idempotency reused the existing `checkIdempotency` primitive. Zero new abstractions, zero new deps.
- **The write path proved itself end-to-end.** `settings.upsertGoal` is idempotent (replay returned `idempotent_replay=true`, same goal_id, no 2nd write — proven at the wire), MANAGER-gated, RLS-scoped on write (foreign-ws → UnscopedQueryError at the wire), Zod-validated. The slice's one write surface validated the whole defense-in-depth pattern.
- **NON-VACUOUS parity.** `goal_attainment_bp` killed a "÷ actual" mutant; the directional band killed a "treat-all-as-higher-better" mutant (CAC@120% amber, not green) — verified in TS, Python, router, AND at the live wire.

## What didn't / friction
- **Python 3.13 vs 3.12.** First test run used `--python 3.12` and the project pins `==3.13.*`. Lost one cycle. (Known from prior slices but easy to forget — the memory_search/uv default is 3.12.)
- **An old gateway instance on :3001** was serving pre-slice-7 code; the first live smoke 404'd on `settings.goals`. Had to kill + restart with the new build. Reminder: the dev server isn't hot-reloading the router factory in the running process.
- **`formatMoney` signature.** Wrote object-form `formatMoney({minorUnits,currencyCode})` from muscle memory; it's positional `(mu, code)`. Caught by typecheck (10 errors), fixed mechanically. Cheap because the gate caught it.

## What surprised us
- **The calendar report is NOT a festival surface at all** — it's a period grid with marketing-action (manual + Klaviyo) overlays + per-cell directional RAG, reusing the revenue/cm3/marketing primitives. The slice-table conflated "festivals" and "calendar" into one idea; legacy has them as two distinct pages. De-conflated cleanly.
- **The pre-existing `rag-badge.tsx` was already wrong** (flat rule, colour+text but no icon). Slice 7's accessibility requirement ("never colour-only") forced a rewrite that ALSO fixed the directional-correctness bug — two birds.

## Test deltas
- analytics: 208 → 244 (+36); brain_metrics: 317 → 326 (+9); lib-metrics TS: 152 → 159 (+7); api-gateway: 104 → 120 (+16); web: 41 (rag-badge rewritten in place).
- Parity gate: 36 → 37 shared metrics; PASS + non-vacuous.

## Deferred (explicit non-goals — pages are real READ views, not stubs)
- Festival CRUD (create/update/delete/resetDefaults; template-protection rule).
- Cost-row CRUD + `cogsSettings.patch` (effective-window close-out; ADMIN-gated).
- Marketing-action CRUD (overlays are displayed; creating them defers).
- Inline goal editor on the page (the `goals.upsert` mutation IS shipped + wired in the BFF; the on-page form is a follow-up).

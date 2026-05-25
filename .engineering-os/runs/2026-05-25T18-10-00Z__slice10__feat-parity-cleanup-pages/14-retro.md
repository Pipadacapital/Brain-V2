# Retro — feat-parity-cleanup-pages (epic-phase2 SLICE 10, FINAL)

## What worked
- **Reuse audit at Stage 1 paid off again.** 5 of 9 pages needed ZERO new BFF code — pure client wiring to shipped tRPC. Reading `router.ts` + `proto-types.ts` first (not assuming) found `marketing.efficiency` already carried meta/google spend split and `marketing.acquisition` already had the acquisition classification — so /meta-ads, /google-ads, /ad-campaigns were reuse, not rebuild.
- **The honest-state ruling, made load-bearing.** The persona's "developers will fabricate a number" risk was turned into a real test (`CF-S10-HONEST-STATE-1`: no held connector carries a last_sync_at) + a shared `ConnectorPending` primitive. The truth ("pending cutover") renders instead of a lie.
- **Single-Primitive Rule held cleanly.** Zero new metric defs; one `platform-ads-view` for both ad platforms; registry + parity gate untouched (lib-metrics 166 unchanged).
- **Committed no-scaffold test.** The Founder's "no dead stubs" bar is now CI-enforced, not a one-time grep.

## What didn't (friction)
- **:3001 was occupied by a process I didn't own.** The auto-guard (correctly) blocked me from killing it. I booted on alt ports (:3051/:3050) and smoked there — proved the code works, but a clean environment would have been simpler. Lesson: a slice should not assume :3001/:3000 are free; the smoke harness should pick a free port or the orchestrator should ensure a clean port.
- **Raw-curl SSR smoke can't see client-rendered data.** These `'use client'` data components render the headings/tiles after hydration, so the SSR markup shows partial text (e.g. "Backfill" not "Ads Backfill"). I compensated by smoking the exact browser-style tRPC batch call against the gateway — but a true headless-browser smoke would be a stronger gate for client-rendered pages.

## What surprised us
- **The standing "verify-legacy-formula-at-stage1" lesson applied to a UI slice, not a formula slice — and still bit.** The slice-table said `/analytics` = "sessions/conversion/funnel". Legacy reality: those are nullable Shopify-sync fields; the real deep analytics is the store/CM breakdown. Same class of error (slice-table shorthand ≠ legacy behavior), different surface. Reading `shopify-analytics.ts` saved us from building a fake session funnel.
- **Legacy already does honest-state.** `meta-ads.ts`/`google-ads.ts` return "No Meta/Google account linked" at HTTP 200 when unconnected — the legacy product itself never faked campaigns. Our honest affordance is faithful to legacy, not a Brain invention.

## Recurring-pattern check (auto-candidate rule detection)
The root cause this slice (slice-table shorthand diverging from actual legacy behavior) is the SAME cause behind `verify-legacy-formula-at-stage1-not-slice-table` (evidence in slices 2-8). This is now the 9th occurrence. Already a human-gated candidate rule awaiting `/adopt-rule` — appending this as further evidence (a UI-surface instance of the same class). No NEW rule proposed; the existing candidate is strengthened.

# Retro — Slice D (live integrations OAuth + token custody)

## What worked
- **Reuse paid off hard.** Slice-C `withWorkspace`/`withSuperadmin` + the FORCE-RLS ws_isolation pattern
  dropped straight onto 3 new connector tables; the legacy oauth-state (hashed state, TTL, one-time
  consume) and per-provider auth-URL/exchange logic ported almost verbatim. The Child-3 custody Protocol
  gave a ready-made get/put/seal shape to mirror in TS.
- **The ProviderHttp injectable seam** is the unlock for the Founder's "build now, configure later"
  directive: the full callback flow (exchange→custody→UPSERT→idempotent→RLS) is mechanically proven with a
  fixture token-exchange, with real `fetch` in production and no code change at cutover.
- **AEAD chosen up front** (the custody persona's TC-001): the tamper-reject test is a real security
  property, not a checkbox — a flipped ciphertext byte throws, proven at rest against the live DB.

## What didn't / surprised us
- **Three alias maps, not one.** Adding `@brain/core-connectors` required editing tsconfig (gateway + web)
  AND vitest.config (gateway) separately — the alias is duplicated across build + test + the web consumer.
  A repeated cost (same as core-onboarding in slice C). Candidate for a shared path-config.
- **Integration-test DB races under parallelism.** The slice-C and slice-D integration files share one dev
  DB and truncate the same tables; run in parallel they race and false-fail. They pass cleanly serially
  (`--no-file-parallelism`). This is the 2nd+ occurrence of a shared-dev-DB test-isolation issue.
- **pool-isolation.test.ts (Child-1) fails its beforeAll** locally (`ECONNREFUSED :5433`) — it needs a
  pgbouncer container not in the local dev compose. Pre-existing, slice-D-unrelated, but it makes a naive
  "run all integration tests" go red and obscures real signal.

## Carried for the next intake (lessons)
- Integration tests over a shared dev DB need either per-file schema/namespace isolation or a documented
  serial run mode. (Recurring — see auto-candidate note below.)
- The `@brain/*` alias triplication (tsconfig×N + vitest.config) is a small but repeated tax.

## Auto-candidate rule check (≥3 distinct runs?)
- "Shared local dev DB causes integration-test cross-file races / requires serial run" — appears in slice C
  (truncate-based cleanup) and now slice D (2 occurrences in THIS epic). Plus the broader
  "uncommitted/shared-state contaminates verification" family already PROPOSED in
  feat-store-order-fact-layer (rule-proposals/2026-05-25__pre-stage-working-tree-baseline.md). The DB-race
  variant is related but distinct. NOT yet ≥3 distinct runs for the DB-isolation-specific cause → remains a
  lesson, not a new proposal. Will codify if it recurs a 3rd distinct time.

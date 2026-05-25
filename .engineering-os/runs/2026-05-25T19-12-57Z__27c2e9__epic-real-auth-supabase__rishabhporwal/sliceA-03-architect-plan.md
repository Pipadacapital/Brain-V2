# Architect Plan — Slice A (feat-auth-supabase-identity)

**Stage:** 2 (binding plan) · **Architect:** Aryan · **Paradigm:** `sql` (deterministic JWT verify + role map; zero ML/LLM)
**Frame:** CUTOVER, not rebuild. Child-1 shipped `BrainClaim`/`assembleClaim`/`requireRole` + the gateway tenancy middleware. Slice A fills the documented JWT seam in `server.ts` and adds the Supabase identity front-end. Reuse, do not re-derive.

## Binding mandates carried from Stage 1
1. Reuse `assembleClaim` from `@brain/core-auth` — NO second claim shape.
2. Only 3 new deps: `jose` (gateway), `@supabase/ssr` + `@supabase/supabase-js` (web). Any 4th dep = Stage-6 over-engineering bounce.
3. `workspace_id` derives ONLY from the resolver keyed on verified `sub` on the authed path; `x-workspace-id` is harness-only.
4. Legacy role map: `EDITOR → MANAGER`, rest 1:1. No 6th role.
5. Canonical unauth redirect target: `/auth/login`.

## Persona findings → implementation contract (each item = a task + a test)

### BLOCKING
- **B1 server-side flag, fail-closed.** New gateway env `BRAIN_GATEWAY_LOCAL_HARNESS` (default FALSE). `createContext`: if real-auth active (flag absent/false) and no verified Bearer JWT → throw `UNAUTHORIZED`; NEVER fall back to stub. Stub path reachable ONLY when flag explicitly `'true'`. Boot assertion: `NODE_ENV==='production'` AND stub/local path selectable → fatal `process.exit(1)`.
  - Tests: (i) flag off + no token → UNAUTHORIZED; (ii) flag off + valid token → context built from claim; (iii) flag on + no token → stub context; (iv) prod + flag on → boot assertion throws.
- **B2 JWKS hardening.** `jwtVerify` pins `algorithms:['RS256']`; JWKS URL `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`; issuer `${SUPABASE_URL}/auth/v1`; audience `authenticated`; assert `SUPABASE_URL` non-empty at boot (fatal if absent).
  - Tests: wrong-alg token → UNAUTHORIZED; wrong-iss → UNAUTHORIZED; wrong-aud → UNAUTHORIZED; missing SUPABASE_URL at boot → fatal.
- **B3 x-workspace-id neutralized on authed path.** Once a verified claim exists, `x-workspace-id` is IGNORED unconditionally — no `??`/`||` fallback. `workspace_id` comes ONLY from `MembershipResolver(sub)`. Hard conditional on the flag, not a fallback chain.
  - Test: authed request + wrong `x-workspace-id` header → `ctx.workspaceId === resolver output` (header ignored).
- **B4 workspace.switch spoof.** `workspace.switch` must assert `input.workspaceId === ctx.claim.workspaceId` and throw `FORBIDDEN` otherwise (until slice C's DbMembershipResolver). Remove the false "tenancy enforced at callers" comment.
  - Test: switch to a different workspaceId → FORBIDDEN; switch to own → returns claim workspaceId.

### SHOULD-FIX
- **S1 JWKS failure mapping.** Wrap `jwtVerify`; map ALL failure modes (fetch fail, key mismatch, expired, wrong aud/iss) → single generic `UNAUTHORIZED` `TRPCError`; never surface jose error class/message in the response body; log `error class + requestId` at `warn` (never token/email); `createRemoteJWKSet` with explicit `cacheMaxAge: 600_000`.
  - Test: forged token → generic UNAUTHORIZED message (no jose class leak).
- **S2 no email in claim/logs.** `assembleClaim` from `payload.sub` ONLY. `BrainClaim` has no email field — keep it. Never add email to claim/log/error body.
  - Test: a failed-auth `warn` log event contains no `'@'`.
- **S3 .env.example (names only).** Create committed `apps/web/.env.example` + `apps/api-gateway/.env.example` (KEY NAMES ONLY, zero values). Gateway example MUST include `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BRAIN_GATEWAY_LOCAL_HARNESS`; MUST NOT include `SUPABASE_SERVICE_ROLE_KEY`.
- **S4 push-token user_id.** `device.registerPushToken` drops `user_id` from input schema; derive from `ctx.claim.userId`.
  - Test: data-plane call uses `claim.userId`, not client input.
- **S5 resolver fail-closed.** `LocalSeedMembershipResolver` selected ONLY when local-harness flag affirmatively `'true'`; absent/false → fail-closed `UNAUTHORIZED` (DbMembershipResolver is slice C). NEVER default to granting OWNER. Prod-boot assertion throws if local resolver would be selected.

### NOTE
- **N1.** Document in `providers.tsx` that the tRPC client's `x-workspace-id` is harness-only and the server ignores it on the authed path.

## File plan (exhaustive — anything beyond this is over-engineering)

### Gateway (`apps/api-gateway`)
- `package.json` — add `jose` dependency (only new dep).
- `src/infrastructure/supabase-jwt-verifier.ts` — NEW. `createRemoteJWKSet` (cacheMaxAge 600s) + `verifySupabaseJwt(token, {supabaseUrl})` → `{ sub }`; maps every failure to a thrown sentinel `AuthVerifyError` (caller turns into TRPCError UNAUTHORIZED). RS256/iss/aud pinned. (B2, S1)
- `src/domain/membership-resolver.ts` — NEW. `MembershipResolver` interface `{ resolve(sub): { workspaceId, workspaceRole, systemRole } | null }`; `LocalSeedMembershipResolver` → maps ANY authed sub to `SUGANDH_LOK_WORKSPACE_ID` as OWNER (single seeded workspace). (B3, S5)
- `src/domain/role-map.ts` — NEW. `legacyRoleToBrain(legacy)` : `EDITOR→MANAGER`, rest 1:1; throws on unknown. (Reconciliation #1)
- `src/interfaces/server.ts` — EDIT. New env reads (`SUPABASE_URL`, `BRAIN_GATEWAY_LOCAL_HARNESS`); boot assertions (B1/B2/S5); `createContext` rewritten: real-auth path verifies Bearer → resolver → assembleClaim; harness path flag-gated. `x-workspace-id` ignored on authed path (B3). Stub log line keeps `userId` only (S2).
- `src/application/router.ts` — EDIT. `workspace.switch` FORBIDDEN assertion + comment removal (B4); `device.registerPushToken` drops `user_id` from schema, derives from claim (S4).
- `apps/api-gateway/.env.example` — NEW (names only). (S3)
- Tests: `src/infrastructure/supabase-jwt-verifier.test.ts`, `src/domain/membership-resolver.test.ts`, `src/domain/role-map.test.ts`, `src/interfaces/server.test.ts` (extend: context fail-closed + header-ignore), `src/application/router.ts` switch/push tests (extend existing router tests).

### Web (`apps/web`)
- `package.json` — add `@supabase/ssr`, `@supabase/supabase-js` (only new deps).
- `src/infrastructure/supabase/client.ts` — NEW. `createBrowserClient` (browser).
- `src/infrastructure/supabase/server.ts` — NEW. `createServerClient` (cookies, for middleware + callback + RSC).
- `src/infrastructure/supabase/middleware.ts` — NEW. `updateSession(request)` helper (refresh + return user) per @supabase/ssr SSR guide.
- `src/middleware.ts` — NEW. Next middleware: protect `(shell)` routes; redirect unauthenticated → `/auth/login`. Harness bypass when `NEXT_PUBLIC_BRAIN_LOCAL_HARNESS==='true'`.
- `src/app/auth/login/page.tsx` — NEW. Real login page (email/pw + Google button). Canonical target.
- `src/app/auth/callback/route.ts` — NEW. `exchangeCodeForSession` → redirect `/dashboard`.
- `src/app/auth/auth-code-error/page.tsx` — NEW. Error landing.
- `src/app/login/page.tsx` — EDIT → redirect to `/auth/login` (alias preserved).
- `src/interfaces/components/auth/login-form.tsx` — EDIT. Real Supabase email/pw `signInWithPassword` + Google `signInWithOAuth`; harness stub path flag-gated (kept as offline fallback). PII never logged.
- `src/infrastructure/trpc-client.ts` — EDIT. Attach `Authorization: Bearer <access_token>` from Supabase session on every call; keep `x-workspace-id` ONLY under harness flag (N1).
- `src/application/providers.tsx` — EDIT. N1 doc comment.
- `apps/web/.env.example` — NEW (names only). (S3)
- Tests: `src/test/login-form.test.tsx` (extend), `src/infrastructure/supabase/*.test.ts` as feasible (jsdom).

## Boundaries / non-goals (slice A)
- No signup/recovery (B), no onboarding/DB membership (C), no live connectors (D).
- Gateway stays DB-less; `LocalSeedMembershipResolver` is the Phase-0 seam; interface shaped so slice C's `DbMembershipResolver` calls core-service.
- StubDataPlane stays keyed to `SUGANDH_LOK_WORKSPACE_ID`; resolver maps authed users to it so 31 routes keep rendering.

## Acceptance (binds Stage 5)
- Real email/pw login against real Supabase issues a real session; tRPC sends `Authorization: Bearer`.
- Gateway JWKS-verifies → assembleClaim → BrainClaim; unauth/forged → UNAUTHORIZED; wrong `x-workspace-id` ignored on authed path; `workspace.switch` spoof → FORBIDDEN.
- `typecheck` 0 (both apps).
- Real `.env`/`.env.local` git-ignored (proven); only `.env.example` committable.
- Google path: if Supabase dashboard not configured, state precisely + prove email/pw as acceptance. Do not fake Google.

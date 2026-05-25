# Stage 6 — Final Review (VETO) — Slice A (feat-auth-supabase-identity)

**Reviewer:** Rohan (CTO Advisor) · **Date:** 2026-05-25 · **Decision: PASS** (one Founder dashboard action item, not a code defect)

This is a CUTOVER that fills the documented JWT seam in `api-gateway/server.ts` and adds the Supabase identity front-end. Child-1's BrainClaim/RBAC/tenancy contract was reused, not rebuilt.

## Persona findings — disposition (each implemented + tested)

| ID | Finding | Resolution | Test |
|----|---------|-----------|------|
| **B1** | server-side flag, fail-closed | `BRAIN_GATEWAY_LOCAL_HARNESS` (default false). Real-auth path throws UNAUTHORIZED with no token; stub only when flag === 'true'. Prod+harness → fatal boot. | `server.auth-context.test.ts` (B1/boot) + runtime proof |
| **B2** | JWKS hardening | Asymmetric algs pinned, exact JWKS URL, issuer `${URL}/auth/v1`, aud `authenticated`, SUPABASE_URL fatal-if-absent. **Amended at Stage 5: RS256→{RS256,ES256}** — live project signs ES256. | `supabase-jwt-verifier.test.ts` (RS256+ES256 happy, HS256 rejected, iss/aud/exp/key fail) |
| **B3** | x-workspace-id neutralized on authed path | `buildRealAuthContext` has no header param; workspace_id is resolver-only. | `server.auth-context.test.ts` "B3 …header never passed in" |
| **B4** | workspace.switch spoof | Asserts `input.workspaceId === ctx.claim.workspaceId` → FORBIDDEN; false comment removed. | `router.auth-sliceA.test.ts` "spoof denied" |
| **S1** | JWKS failure mapping | All jose failures → one `AuthVerifyError`/generic UNAUTHORIZED; cacheMaxAge 600s; warn logs class+requestId only. | verifier test "never leaks jose message" |
| **S2** | no email in claim/logs | claim from `sub` only; BrainClaim has no email; failed-auth log has no '@'. | verifier "sub ONLY" + context "no email" |
| **S3** | .env.example (names only) | Both created; gateway example has SUPABASE_URL/ANON/HARNESS, NO service-role. | Shreya scan |
| **S4** | push-token user_id | dropped from input schema; derived from `ctx.claim.userId`. | `router.auth-sliceA.test.ts` S4 |
| **S5** | resolver fail-closed | local resolver harness-gated; null resolve → UNAUTHORIZED; prod+harness fatal. | membership + context tests |
| **N1** | doc header is harness-only | documented in `providers.tsx` + `trpc-client.ts`. | n/a (doc) |

## B2 amendment (Stage-5 plan deviation — recorded)
The plan bound `algorithms: ['RS256']`. Live verification found the project's JWKS publishes a single **ES256 (EC P-256)** key — a real RS256-only verifier would reject every real token. Fix: pin `['RS256','ES256']` (both asymmetric). The security property B2 protects is unchanged: HS* (symmetric, forgeable with the public anon key) and `none` are still rejected — proven by an explicit HS256-rejection test. This is the correct kind of deviation (Stage-5 caught a reality the plan's assumption missed); it does not weaken the control.

## Audits
- **Over-engineering:** PASS. Exactly the planned files; exactly 3 new deps (jose, @supabase/ssr, @supabase/supabase-js); no new abstractions for "future use" (the MembershipResolver interface is the slice-C seam the plan mandated, not speculative); no WHAT-comments. The one infra change beyond app code — `pnpm-workspace.yaml` `@types/react` override — was forced by the new deps re-hoisting `@types/react@18` and breaking the web compile; it is the minimal fix and mobile still typechecks.
- **@paradigm:** PASS. All 10 new files `@paradigm sql`; zero LLM/ML in the auth path.
- **Multi-tenancy (4 layers):** PASS. (1) claim from JWKS→sub→resolver; (2) `workspaceId === claim.workspaceId` middleware preserved; (3) `requireRole` per-procedure preserved; (4) data-plane workspace scoping intact — 196 gateway tests green.
- **Secrets/PII:** PASS. Real `.env`/`.env.local` git-ignored (proven) + no secret VALUE anywhere outside them; gateway holds anon (not service-role); token only ever a Bearer header, never logged; no email in claim/real-auth logs.

## Independent re-run of Stage-5 gates (Stage-6 mandatory)
- GATE 1 (B3 header-ignored): 4 passed — re-run captured.
- GATE 2 (B4 switch FORBIDDEN): 1 passed — re-run captured.
- GATE 3 (ES256 happy + HS256 reject): 2 passed — re-run captured.
- Live: gateway boots `authMode: real-supabase-jwt`; unauth / forged / forged+spoofed-header all → UNAUTHORIZED (401); live JWKS reachable at the verifier URL; alg matches.

## Acceptance vs deliverable bar
- Real local login surface against real Supabase: email/pw + Google button wired; **email/pw to a confirmed session is blocked ONLY by a Founder dashboard action** (project has `mailer_autoconfirm:false`; no confirmed test user exists; service-role correctly excluded). Google requires provider config too.
- @supabase/ssr browser+server client + Next middleware route-protection → `/auth/login`: DONE + live-proven.
- `/auth/callback` exchangeCodeForSession: DONE.
- tRPC `Authorization: Bearer`: DONE.
- Gateway JWKS-verify → assembleClaim → BrainClaim (Child-1 reused): DONE.
- Role map EDITOR→MANAGER (rest 1:1), requireRole ordering preserved + tested: DONE.
- 31 routes keep rendering via LocalSeedMembershipResolver: DONE (seed served in both modes).
- RLS fail-closed; typecheck 0: DONE (4 apps typecheck clean).
- LOCAL_HARNESS stub kept behind the server flag: DONE + live-proven offline.

## Verdict: **PASS** → Founder gate (signed under standing delegation).
No hard-rule deviation that blocks auto-approve: the B2 amendment is a Stage-5 correctness fix within the security envelope, fully tested. Nothing committed; no secret leaked.

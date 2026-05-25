# Stage 6 — Final Review (VETO) — Slice C (onboarding + membership + invitations, DB-backed)

**Reviewer:** Rohan (CTO Advisor) · **Date:** 2026-05-26 · **Decision: PASS** (Supabase dashboard items carried from A/B; not code defects)

Slice C adds DB-backed onboarding/membership/invitations to the new Brain. Per the Founder-binding
decision: data persists in a **LOCAL Postgres (docker, dev-only)** with the Brain-native RLS schema;
auth still uses real Supabase for IDENTITY only (slice A); the live/legacy production DB (zero-RLS P0)
is untouched. Run as a single-operator pass of the high-stakes pipeline (Stage 2→6) — the Agent tool
was unavailable in this subagent context, so I played each stage's role and held each gate to its real
bar (as recorded for slice B). This limitation is stated honestly.

## Pipeline trace

| Stage | Role | Result |
|-------|------|--------|
| 2 | Architect (Aryan) | Plan: reuse Child-1 RLS DDL + withWorkspace/withSuperadmin (Single-Primitive); membership/onboarding in core-service; gateway thin tRPC pass-through; new identity tier; DATABASE_URL alias. |
| 3 | Build (Vikram/Ananya/Jatin) | Local Postgres (compose + schema + RLS + dev role); core-service use-cases; gateway DbMembershipResolver + tRPC procedures; web onboarding/invite/empty-state. |
| 4 | Security VETO (Shreya) | PASS — RLS fail-closed at the wire, PII minimized + never logged, no secret VALUES, .env git-ignored. |
| 5 | Verification VETO (Tanvi) | PASS — typecheck 0×3, core-service 182u+8 integ, gateway 215, web 77; live gateway boot + fail-closed + DbMembershipResolver proof. |
| 6 | Final review (me) | PASS. |

## What was built (per directive item)

1. **Local Postgres** — `docker-compose.dev.yml` (postgres:16, :5432, brain_dev) + auto-created NON-BYPASSRLS
   `rls_app` role (`docker/initdb-dev/`). Brain-native schema for users/workspaces/workspace_members/invitations
   (`migrations/local-dev/01-schema-onboarding.sql`) + ENABLE+**FORCE** RLS with Child-1's fail-closed
   `ws_isolation` shape + superadmin policies (`02-enable-rls-onboarding.sql`) + symmetric `down.sql`.
   **Docker WAS available** — the DB was stood up, migrations applied, and all assertions run live.
   `DATABASE_URL` → git-ignored `.env`; key name added to both `.env.example`s (proven via `check-ignore`).
2. **DbMembershipResolver** — replaces LocalSeed on the real-auth path; delegates to core-service
   `resolveMembership(sub)`. No membership → null → routed to `/onboarding` (NO auto-OWNER grant). DB error →
   propagates → UNAUTHORIZED (fail-closed). LocalSeed kept behind `BRAIN_GATEWAY_LOCAL_HARNESS` (offline). Slice-A
   invariants carried: workspace_id from resolver/verified sub; `x-workspace-id` ignored on authed path;
   `workspace.switch` now validates **REAL DB membership** (multi-workspace), FORBIDDEN for non-member workspaces.
3. **Onboarding** — `/onboarding` page + multi-step form (profile/brand/platform) → tRPC `onboarding.complete` →
   core-service ONE-transaction upsert User (id=sub, email=verified JWT) + create Workspace + WorkspaceMember(OWNER)
   in the local DB → redirect `/dashboard`. Slug validation (lowercase alnum+hyphen, uniqueness inside the tx).
   Shopify/Woo live connect DEFERRED to slice D (handle captured; connect affordance disabled).
4. **/me + ensure-user** — tRPC `user.me` (identity tier) upserts the user + returns memberships + `needsOnboarding`;
   `user.ensure` idempotent upsert. `/auth/callback` + `/auth/confirm` route via this `/me` gate
   (no-membership → /onboarding; member → /dashboard).
5. **Invitations** — `/invite/[token]` accept flow + core-service `acceptInvitation` (idempotent, RLS-scoped,
   role-mapped EDITOR→MANAGER). Member-invite SENDING (email) DEFERRED (honest affordance) — accept-by-token only.
6. **Data reconciliation** — decided + implemented: a fresh workspace (new UUID, no analytics) shows the honest
   "no data yet — connect a store (coming in integrations)" empty-state via `workspace.dataAvailability`; the
   seeded Sugandh-Lok workspace keeps its demo data. **No fabricated data for a new workspace.**

## Audits

- **Over-engineering:** PASS. New deps = exactly `pg` + `@types/pg` (gateway), both REQUIRED for DB access
  (the canon mandates the gateway use the Child-1 session-context primitive, which uses pg). No second pool /
  transaction primitive (Single-Primitive Rule — DATABASE_URL is an alias of DIRECT_URL). No speculative
  abstractions; the identity tier is the minimal addition needed for a no-membership user. No WHAT-comments.
- **@paradigm:** PASS. All new code `@paradigm sql` (deterministic DB transactions + JWT-claim mapping); zero LLM/ML.
- **Multi-tenancy (4 layers):** PASS. (1) claim from JWKS→sub→DbMembershipResolver; (2) `workspaceId === claim
  .workspaceId` middleware preserved; (3) requireRole per-procedure preserved; (4) DB-layer FORCE RLS proven
  fail-closed at the wire. The cross-workspace read/write isolation is enforced by Postgres RLS, not app code.
- **Secrets/PII (Shreya VETO):** PASS. Real `.env`/`.env.local`/`.env` git-ignored (check-ignore exit 0);
  `.env.example` committable (exit 1); no secret VALUE in any committed/staged file (only the documented
  local-dev `rls_app_pw`, which lives in the committed compose/initdb by design). PII minimization (DPDP):
  schema stores ONLY email + name + minimal profile — no card/bank/Aadhaar. Email carried in the verified
  identity for the onboarding user-row ONLY — never logged, never in the BrainClaim (proven: failed-auth/
  no-membership warn logs contain no '@'; claim serialization contains no '@').
- **Drift vs requirement:** PASS. All six directive items delivered; deferrals (Shopify/Woo connect, invite
  email) are exactly the directive's stated deferrals, named as honest affordances.
- **Hard-rule deviation check:** NONE. No dependency violation, no Single-Primitive violation, no compliance gap,
  no paradigm escalation, no gate-skip.

## Independent re-run of Stage-5 gates (Stage-6 mandatory — captured)

- GATE 1 — RLS state: all 4 tables `relrowsecurity=true relforcerowsecurity=true`; `rls_app rolbypassrls=false`.
- GATE 2 — fail-closed at the wire: context-less app-role READ = 0 rows on users/workspaces/workspace_members;
  context-less WRITE (INSERT users) = rejected by RLS policy.
- GATE 3 — cross-workspace isolation: workspace-A context sees 0 of workspace-B's member rows (even with an
  explicit `WHERE workspace_id = B`).
- GATE 4 — DbMembershipResolver against the live local DB: member sub → `{workspaceId, OWNER}`; non-member sub →
  `null` (→ /onboarding).
- GATE 5 — gateway boot (real Supabase JWT mode) + HTTP: `/health` authMode `real-supabase-jwt`; no Bearer →
  UNAUTHORIZED for `user.me` + `onboarding.complete`; forged Bearer → `verify_failed` → UNAUTHORIZED; warn logs
  carry only requestId/errorClass/traceId — no email, no token.
- GATE 6 — typecheck 0 (core-service, api-gateway, web); full suites green (core-service 182u + 8 integ,
  gateway 215, web 77).

## Verifiable now vs carried-over Supabase dashboard items

- **Verifiable now (done + proven):** local DB + migrations + FORCE RLS; onboarding/membership/invitation
  use-cases against real RLS; DbMembershipResolver routing; gateway boot + HTTP fail-closed; web pages render +
  call the correct procedures; empty-state; typecheck 0; all suites green.
- **Carried over (Supabase dashboard / mailer — NOT code gaps, same as slices A/B):** a full browser e2e
  (real signup → confirm → onboarding → dashboard) needs the Supabase project's allowed redirect URLs + Site URL
  + email delivery. Stated precisely in `sliceC-pending-founder-commit.md`. The DB/RLS/resolver/onboarding paths
  are all proven by integration + runtime tests.

## Verdict: **PASS** → Founder gate (signed under standing delegation).

No hard-rule deviation that blocks auto-approve. Nothing committed (feature-branch rule + commit-authorization
guard); no secret leaked. Slice D (live integration/connector cutover) NOT started, per directive. Founder
commits via `sliceC-pending-founder-commit.md` (explicit paths, no `git add -A`).

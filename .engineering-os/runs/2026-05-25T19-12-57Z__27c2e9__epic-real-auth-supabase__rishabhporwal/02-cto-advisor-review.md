# CTO Advisor Review — Stage 1 (intake / epic frame + slice A scoping)

| Field | Value |
|-------|-------|
| **req_id** | `epic-real-auth-supabase` |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-25T19:13:00Z |
| **Decision** | **ADVANCE** (epic ratified as a frame; slice A advances to Stage 2 / Aryan) |

---

## Epic frame — what this actually is

This is **the last unbuilt layer of the legacy→Brain migration**: real identity. Phase-2 parity
shipped 31 routes on real data, but every one of them runs under a **hardcoded stub claim**
(`founder@sugandhlok.com` / workspace `00000000-…-001`) injected in `api-gateway/src/interfaces/server.ts`
and a Redux-dispatched stub session in `apps/web/.../auth/login-form.tsx`. There is **no real
authentication, no route protection, and no session→claim derivation** in the new app today.

The good news (verified by code-read, not assumption): **Child-1 already built the destination
contract.** `apps/core-service/src/domain/auth/brain-claim.ts` is the canonical `BrainClaim` +
`assembleClaim()` + `requireRole()` (>= role gate). The gateway's `trpc.ts` middleware tiers
(`authedProc`/`workspaceProc`) and `tenancy.ts` (`assertWorkspaceClaim`) already consume it and
already assert `workspaceId === claim.workspaceId`. `server.ts` even documents the exact Phase-2
cutover seam: *"Verify JWT from `Authorization: Bearer`. Derive workspace_id from the verified
claim (not from a header the client can spoof)."* **Slice A fills that seam — it does not rebuild
the auth model.** That is the single most important framing: this is a cutover, not a green-field.

## Made requirements less dumb first

**Could delete:**
- **Do NOT rebuild the BrainClaim / RBAC / RLS model.** Child-1 already shipped it (`brain-claim.ts`,
  `workspace-context.ts`, RLS DDL, fail-closed policies). Slice A only adds the *front* of the pipe
  (Supabase identity + JWT verify) and wires it to the *existing* claim. Rebuilding any of it = waste +
  divergence risk.
- **Do NOT build a custom session store.** `@supabase/ssr` owns cookie session lifecycle (this is what
  legacy used and what the directive specifies). We attach the Supabase access token as a Bearer; we do
  not invent our own JWT.

**Could simplify:**
- **Slice A is identity-only.** It does NOT need signup, email-confirm, password-reset, onboarding,
  invitations, or any live connector. Those are slices B/C/D. Slice A = login (email/pw + Google) +
  session→BrainClaim + route protection + tRPC Bearer. Keeping it that tight is what makes a clean
  Shreya VETO pass tractable.
- **Membership resolution can be deferred-but-bridged.** Legacy resolved workspace by `:slug` route
  param + a Prisma membership lookup. The current gateway is **DB-less** (pure StubDataPlane, no Prisma).
  Slice A does NOT need to stand up Prisma in the gateway. The cheapest honest bridge: verify the
  Supabase JWT → `sub` (real userId) and, for the **single seeded Sugandh-Lok workspace**, map the
  authenticated user to that workspace+OWNER via a **LOCAL membership resolver** (a named, flag-aware
  seam), so analytics keep rendering. Real multi-workspace membership lookup (DB-backed) is slice C.
  This is the (b)-risk reconciliation — answered below.

**Could defer:**
- Signup + email confirm + forgot/update password → **slice B**.
- Onboarding (create workspace + OWNER membership) + invitations → **slice C** (this is where DB-backed
  membership resolution lands).
- Live integration / connector cutover (Shopify/Meta/Google Ads on real data) → **slice D**
  (explicitly out of scope per the directive; touches live data + needs Founder go + dashboard OAuth config).

---

## Lane decision

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Trigger-surface scan fires on **5** surfaces (≥1 ⇒ high-stakes, no carve-out applies — this is live auth with real consumers, not foundational scaffolding). |
| **trigger_surfaces_touched** | `["auth", "multi-tenancy", "pii", "secrets-env", "connectors"]` |

- **auth** — the entire change IS authentication (Supabase JWT verify, session, route protection).
- **multi-tenancy** — session→`workspace_id` derivation; the load-bearing `workspaceId === claim.workspaceId`
  gate; RLS fail-closed must survive the real-claim path.
- **pii** — real user email + Supabase access token; must never hit logs/Sentry/decision-log (TECH/16).
- **secrets-env** — real local-dev Supabase keys copied into untracked `.env`/`.env.local`; secret-leak
  blast radius. (Counted as a trigger surface under the "in doubt → treat as trigger" rule.)
- **connectors** — listed because the deferred slice D touches live connector OAuth; slice A itself
  does NOT touch connectors, but the epic does, so it's recorded at the epic level.

Conservative tie-break N/A — this is unambiguously high-stakes.

**Stages that will run (high-stakes lane):** 1 (me) → 2 (Aryan, binding plan) → 3 (Vikram backend +
Ananya web; Maya/mobile only if slice A touches the RN app — it does not, mobile auth is a later slice) →
4 (Shreya — **auth/PII/secret VETO**, the gating stage) → 5 (Tanvi — real-network verification VETO) →
6 (me — final-review VETO) → 7 (Founder gate, signed under standing delegation) → 8 (Jatin readiness, HOLD).

---

## Persona-count decision

**Count chosen: 2** (the high-stakes cap).

**Rationale:** two *distinct* dominant risk dimensions intersect, neither reducible to the other:

1. **Security / secret-handling / PII** — real Supabase keys in env, the Bearer token on the wire, the
   "stub removed or flag-gated" requirement (a prod build must NOT be able to stub-auth), JWKS verify
   correctness (issuer/audience/`sub`), and route-protection fail-closed. This is the Shreya-VETO axis;
   getting the *plan* wrong here is a production identity incident. → `auth-secret-leak-realist:sonnet`
   (reasoning-heavy: secret-flow + prod-vs-local gating + JWKS edge cases is multi-step adversarial).

2. **Tenancy-mapping architecture** — the gateway is DB-less; the real `sub` must map to a `workspace_id`
   without spoofable headers, while keeping the StubDataPlane analytics keyed to `00000000-…-001`
   coherent, AND preserving the existing `workspaceId === claim.workspaceId` + RLS fail-closed
   invariants. Get this wrong and either analytics break or tenancy leaks. → `session-to-claim-tenancy-realist:sonnet`
   (reasoning-heavy: membership-resolution seam + legacy 4-role vs Brain 5-role reconciliation +
   StubDataPlane workspace coherence is genuine multi-step design).

Both tagged `:sonnet` — each is reasoning-heavy, not a bounded checklist. This is within the
high-stakes cap (2). I am NOT spawning a 3rd (e.g. a compliance-only persona) because the DPDP/PII
angle is fully inside persona 1's secret/PII scope and the canon is unambiguous here (hash/redact PII,
in-region by default) — no compliance *ambiguity* that would warrant `/escalate` or a dedicated persona.

**Personas requested (NOT spawned by me — returned in HANDOFF for the orchestrator):**
1. `auth-secret-leak-realist:sonnet`
2. `session-to-claim-tenancy-realist:sonnet`

---

## The four Founder-flagged risks — my disposition

### (a) OPEN P0 — live Supabase Postgres has ZERO RLS. Connect real auth only, or reuse legacy DB?

**Ruling: slice A connects real Supabase *Auth identity only* (the JWKS-verified JWT). It does NOT
connect to the live Supabase Postgres data plane at all.** Workspace/membership stays Brain-native,
behind the Child-1 RLS contract. Concretely:
- We use Supabase **Auth** (`/auth/v1/.well-known/jwks.json`, `signInWithPassword`, `signInWithOAuth`)
  to establish *who the user is* (`sub`, email).
- We do **NOT** query the live `auth.*` or any legacy table from the gateway. The analytics data plane
  stays the StubDataPlane (slice A) → Brain-native RLS-backed plane (later).
- This is the *only* safe option: pointing slice A at the live RLS-less Postgres would be wiring a
  fully-authenticated path into a tenant-unsafe store — a cross-brand-leak risk and a direct violation
  of the canon's `workspace_id`-is-law invariant. **The OPEN P0 (live DB zero RLS) is NOT in scope for
  slice A and slice A must not depend on it.** Identity from Supabase Auth; data from Brain-native.

### (b) StubDataPlane is keyed to workspace `00000…01` — how does a real authenticated workspace map to data?

**Ruling: keep a LOCAL-harness seed mapping, behind a named resolver seam.** The real Supabase user has
a real `sub` (their auth UUID) but the seeded analytics belong to `SUGANDH_LOK_WORKSPACE_ID`
(`00000…01`). Slice A introduces a **membership resolver** with two implementations behind one interface:
- **LocalSeedMembershipResolver** (slice A, harness-aware): any successfully-authenticated user is
  mapped to the single seeded Sugandh-Lok workspace as OWNER, so the 31 routes keep rendering. This is
  honest because there is exactly one seeded workspace and no real multi-tenant data yet.
- **DbMembershipResolver** (slice C, deferred): real `WorkspaceMember` lookup by `userId` → workspace(s).

The invariant that MUST hold either way (binding mandate to Aryan): **`workspace_id` is derived from the
resolver output keyed on the verified `sub`, NEVER from a client-supplied `x-workspace-id` header.** The
existing `x-workspace-id` header path in `server.ts`/`trpc-client.ts` is **spoofable and must be removed
from the trust boundary** when the real claim is present (it may remain ONLY as the local-harness fallback,
flag-gated). The `workspaceId === claim.workspaceId` middleware assertion then continues to bite.

### (c) Supabase dashboard prerequisites (cannot be done in code) — Founder/dashboard action items

These are **Founder action items in the Supabase dashboard** (I/the agents cannot do them). Slice A's
email/password path works without them; the Google path requires #2–#3:
1. **Allowed Redirect URLs:** add `http://localhost:3000/auth/callback` (and the chosen final path) to
   the project's Auth → URL Configuration allow-list. Without this, `exchangeCodeForSession` rejects.
2. **Google provider enabled:** Auth → Providers → Google = ON, with a Google Cloud OAuth client
   (Client ID + Secret) configured, and `…/auth/v1/callback` (the Supabase callback) registered as an
   authorized redirect URI in Google Cloud Console.
3. **Site URL** set to `http://localhost:3000` for local dev.

If #1–#3 are not set, **email/password login will still prove the full real-auth path** (JWT issued by
real Supabase → JWKS verify → BrainClaim → tRPC under real claim). The build will state this precisely
and not fake the Google path. **This is the single most likely partial-blocker** and is called out now so
it is not a surprise at Stage 5.

### (d) PII + secret handling — Shreya VETO

This is the gating axis. Non-negotiables the plan must bind (Shreya enforces at Stage 4):
- Real `.env` (`apps/web/.env.local`, `apps/api-gateway/.env`) **untracked + proven git-ignored**;
  only `.env.example` (KEY NAMES, zero values) committed. Verified at Stage 1: root `.gitignore` already
  ignores `.env`/`**/.env.*` and `git check-ignore` confirms both target files are ignored while
  `.env.example` is committable.
- **Secret VALUES never** echoed into report/journal/decision-log/committed file. Key NAMES only.
- **PII never logged:** email + access token must not reach pino logs, Sentry, PostHog, or the decision
  log. The gateway's request-log line currently logs `userId` — acceptable (correlation UUID, not PII),
  but it must NOT start logging `email` or the token.
- **Prod build cannot stub-auth:** the LOCAL harness path must be hard-gated behind
  `NEXT_PUBLIC_BRAIN_LOCAL_HARNESS` (web) and an equivalent server flag (gateway). When the flag is
  absent/false, the stub claim builder must be unreachable — a real JWT verify is the only path.

---

## Slice decomposition (epic plan)

| Slice | Scope | Depends on | Status |
|-------|-------|-----------|--------|
| **A — real auth (identity)** | Supabase email/pw + Google OAuth + `/auth/callback`; api-gateway JWKS verify of the real Supabase JWT → BrainClaim (reusing Child-1); session→claim replacing the stub (flag-gated fallback kept); Next middleware route protection → redirect unauthenticated → `/auth/login`; tRPC `Authorization: Bearer`; RLS fail-closed under the real claim. | Child-1 (shipped) | **BUILD NOW** |
| **B — signup + account recovery** | `supabase.auth.signUp` + email verify (`/auth/confirm` verifyOtp); `/auth/sign-up-success`; forgot/update password (`resetPasswordForEmail`/`updateUser`). | A | deferred |
| **C — onboarding + membership + invitations** | `POST /api/user/ensure`; onboarding (create Workspace + WorkspaceMember OWNER + seed festivals); invitation accept; **DB-backed membership resolution** (DbMembershipResolver) — real multi-workspace mapping. | A, B | deferred |
| **D — live integration / connector cutover** | Shopify/Meta/Google Ads on real data; dashboard OAuth redirect config; live-data go. **Out of scope; next decision; needs Founder go.** | A, C | deferred — Founder-gated |

**Path-naming reconciliation (binding to Aryan):** legacy used `/auth/login`, `/auth/callback`,
`/auth/confirm`, `/auth/error`; current Brain uses `/login` and `/dashboard`. The Founder's deliverable
bar explicitly says *"redirect unauthenticated users to /auth/login."* → **Adopt the legacy `/auth/*`
namespace** for auth routes (login/callback/error), and keep `/dashboard` as the post-login landing.
Either keep `/login` as a redirect alias to `/auth/login` or move it; Aryan decides the mechanics, but
the canonical unauthenticated redirect target is **`/auth/login`** per the Founder bar.

---

## Reconciliations the build MUST honor (binding mandates — standing legacy-formula lesson applied)

I read the **actual** legacy auth code, not the directive's shorthand. Findings:

1. **Role-name mismatch (legacy DB vs Brain claim).** Legacy `WorkspaceRole = OWNER/ADMIN/EDITOR/VIEWER`
   (4 roles). Child-1 `BrainClaim` = `OWNER/ADMIN/MANAGER/ANALYST/VIEWER` (5 canonical Brain roles).
   The session→claim mapping must define the legacy→Brain role map (most likely `EDITOR → MANAGER`,
   the rest 1:1). For slice A this is trivial (the seeded user is OWNER), but the resolver interface
   must carry a `WorkspaceRoleString` from the **Brain** enum, and the map must be explicit + tested so
   slice C doesn't silently mis-grant. **Do NOT invent a 6th role.**
2. **`@brain/core-auth` is a tsconfig path alias**, not an npm package — it points at
   `apps/core-service/src/domain/auth/brain-claim.ts`. The gateway already imports `assembleClaim` from
   it. The new JWKS verifier must call this SAME `assembleClaim` (no second claim shape).
3. **`jose` is a NEW gateway dependency** (legacy used it for JWKS verify). `@supabase/ssr` +
   `@supabase/supabase-js` are NEW web dependencies. These are the ONLY new deps slice A should add —
   Aryan must list them explicitly; any dep beyond these three is an over-engineering flag at Stage 6.
4. **Membership lookup belongs to core-service, not the gateway** (per the canon: gateway has *no
   business logic*; core-service owns orgs/workspaces/users/roles). For slice A the LocalSeedMembershipResolver
   is a thin gateway-side seam (no DB), which is acceptable Phase-0; but the *interface* must be shaped so
   slice C's real implementation lives in / calls core-service, not the gateway. Aryan binds this boundary.
5. **The `x-workspace-id` header is a spoof vector once real auth exists.** When a verified claim is
   present, `workspace_id` MUST come from the resolver (keyed on `sub`), and the header path must be
   demoted to harness-only/flag-gated. This is the single highest-leverage tenancy correctness point.

---

## Paradigm recommendation

**Recommended paradigm:** `sql`

**Why:** Auth is deterministic JWT verification + DB/seed membership lookup + role comparison. **Zero ML,
zero LLM.** JWKS verify (jose), claim assembly, `requireRole(>=)`, RLS context — all `@paradigm sql`.
There is no NL boundary anywhere in the auth flow. Any LLM here would be a paradigm-bypass anti-pattern.

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | None — auth does not touch order/logistics economics. |
| **COD** | None. |
| **GST** | None — no money/tax surface in auth. |
| **Festival seasonality** | None for slice A. (Legacy onboarding seeds festivals — that's slice C.) |
| **Pincode reliability** | None. |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | None for slice A — auth has no outbound channel. Email-confirm (slice B) uses Supabase transactional email (not a marketing/A2P channel), so DLT/NCPR do not bite; still, slice B must keep it strictly transactional. |
| **DPDP / PII (the relevant lens here)** | **HIGH.** Real user email + Supabase access token are PII/secret. Must hash/redact in logs, never persist plaintext beyond the session, in-region by default (Supabase project region is a Founder dashboard fact to confirm at slice D, not slice A). No compliance *ambiguity* → no `/escalate`. |

---

## Decision

**ADVANCE.** The epic is well-framed and lands squarely on a pre-built seam (Child-1). Slice A is
correctly scoped to identity-only and is buildable through the full high-stakes pipeline. No
CHALLENGE-BACK (the directive is sound and the risks are addressable with the bindings above). No KILL.

The persona round-trip runs first (2 personas requested); after synthesis, slice A advances to Aryan
(Stage 2) with the binding mandates above.

---

## Dependency pre-flight

Slice A's only hard dependency is **Child-1 (`feat-tenancy-rls-brain-native`)** = status
`committed-on-feature-branch` (shipped to the feature branch; its contract is in-tree and imported).
The BrainClaim/RLS/auth-claim contract is present and consumed in-repo today. Pre-flight: **PASS** —
no unshipped blocker. (Child-3 connector cutover is a slice-D dependency, not slice A.)

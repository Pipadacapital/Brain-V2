# Requirement — Real authentication (Supabase) for Brain-native app

**req_id:** epic-real-auth-supabase
**submitted_by:** rishabhporwal (Founder)
**date:** 2026-05-25
**parent_epic:** (new epic — successor to epic-phase2-feature-parity, which is 100% complete)
**type:** EPIC (decompose into slices; build slice A through the full high-stakes pipeline, then STOP)

## Raw directive

Replicate the legacy Brain's REAL authentication into the new Brain — login, signup,
customer onboarding, AND Google Authentication (via Supabase's Google OAuth provider) —
using Brain's new architecture. Make the new Brain a fully working product at feature
parity, using the real local-dev keys in the legacy `.env` files (Supabase, Shopify,
Google Ads, Meta Ads, Anthropic).

Run Stage 1 intake to scope + decompose this as an EPIC, then build slice A (real auth)
through the full pipeline. Stop after slice A and report.

## Slice-A deliverable bar (Founder-stated)

A REAL login works locally against real Supabase — email/password AND "Sign in with
Google" — issuing a real session; the api-gateway validates the real Supabase JWT (JWKS)
→ BrainClaim (stub removed or flag-gated behind NEXT_PUBLIC_BRAIN_LOCAL_HARNESS); tRPC
procedures run under the real claim; route protection redirects unauthenticated users to
/auth/login; RLS fail-closed; typecheck 0; real verification. Keep the LOCAL_HARNESS stub
path working behind the flag as a fallback so the app still boots without network.

## Constraints

- DO NOT git commit/push. Produce a slice-scoped `pending-founder-commit.md`. Real
  `.env`/`.env.local` MUST be excluded + proven git-ignored; commit only `.env.example`
  (key names only).
- NEVER echo secret VALUES anywhere.
- Do NOT attempt the live integration/connector-cutover slice (D).

## Ground truth (gathered)

Legacy auth map + current Brain state + env/secret handling captured in the directive;
verified against the codebase at Stage 1 (see 02-cto-advisor-review.md).

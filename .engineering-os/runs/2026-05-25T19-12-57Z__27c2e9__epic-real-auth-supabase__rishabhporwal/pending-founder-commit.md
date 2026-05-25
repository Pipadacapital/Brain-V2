# Pending Founder Commit — Slice A (feat-auth-supabase-identity)

Stage 6 PASS (signed under standing delegation). Nothing has been committed or pushed.
Working-tree branch at build time: `feature/feat-store-order-fact-layer` (HEAD `daa369c`,
unchanged this session — all slice-A changes are uncommitted in the working tree).
Per the feature-branch rule, the Founder should commit slice A on a dedicated
`feature/feat-auth-supabase-identity` branch (cut from `development`) before review.
Slice A is identity-only.

## Commit ONLY these paths (explicit — NO `git add -A`)

Real `.env` / `.env.local` are git-ignored and MUST NOT be committed (proven below).
`.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts` are pre-existing/generated and are NOT slice A.

```bash
git add \
  apps/api-gateway/package.json \
  apps/api-gateway/src/interfaces/server.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/infrastructure/supabase-jwt-verifier.ts \
  apps/api-gateway/src/infrastructure/supabase-jwt-verifier.test.ts \
  apps/api-gateway/src/domain/membership-resolver.ts \
  apps/api-gateway/src/domain/membership-resolver.test.ts \
  apps/api-gateway/src/domain/role-map.ts \
  apps/api-gateway/src/domain/role-map.test.ts \
  apps/api-gateway/src/interfaces/server.auth-context.test.ts \
  apps/api-gateway/src/application/router.auth-sliceA.test.ts \
  apps/api-gateway/.env.example \
  apps/web/package.json \
  apps/web/src/middleware.ts \
  apps/web/src/infrastructure/supabase/client.ts \
  apps/web/src/infrastructure/supabase/server.ts \
  apps/web/src/infrastructure/supabase/middleware.ts \
  apps/web/src/infrastructure/trpc-client.ts \
  apps/web/src/application/providers.tsx \
  apps/web/src/interfaces/components/auth/login-form.tsx \
  apps/web/src/test/login-form.test.tsx \
  apps/web/src/app/auth/login/page.tsx \
  apps/web/src/app/auth/callback/route.ts \
  apps/web/src/app/auth/auth-code-error/page.tsx \
  apps/web/src/app/login/page.tsx \
  apps/web/.env.example \
  apps/mobile/src/infrastructure/push-notifications.ts \
  pnpm-workspace.yaml \
  pnpm-lock.yaml

# (EOS audit-trail files — optional, commit with the EOS housekeeping commit:)
#   .engineering-os/state/active.json
#   .engineering-os/decision-log/2026/05/2026-05-25.jsonl
#   .engineering-os/memory/agents/cto-advisor.journal.md
#   .engineering-os/runs/2026-05-25T19-12-57Z__27c2e9__epic-real-auth-supabase__rishabhporwal/

git commit -m "feat(slice-A-auth): real Supabase identity — JWKS verify → BrainClaim, email/pw + Google, route protection

Fills the documented JWT seam in api-gateway/server.ts (cutover, not rebuild).
- Gateway: server-side BRAIN_GATEWAY_LOCAL_HARNESS flag (fail-closed); JWKS verify
  (RS256+ES256, iss/aud pinned); MembershipResolver (workspace_id from verified sub,
  x-workspace-id ignored on authed path); workspace.switch spoof → FORBIDDEN;
  push-token user_id from claim; boot assertions (prod+harness fatal, SUPABASE_URL fatal).
- Web: @supabase/ssr browser+server client + Next middleware route-protection → /auth/login;
  /auth/callback exchangeCodeForSession; real email/pw + Google login; tRPC Bearer.
- Only 3 new deps: jose, @supabase/ssr, @supabase/supabase-js. typecheck 0 (4 apps).
- Persona findings B1-B4 + S1-S5 + N1 all implemented + tested.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Secret-safety proof (run before committing)
```bash
git check-ignore apps/web/.env.local apps/api-gateway/.env   # → both printed (ignored)
git status --porcelain | grep -E '\.env(\.local)?$'          # → empty (not tracked)
```
Both verified PASS at Stage 6. The two `.env.example` files contain KEY NAMES ONLY (zero values)
and exclude any service-role key.

## Founder action items (cannot be done in code — Supabase dashboard)
1. **Email/password live login** is blocked only because the project has email-confirmation ON
   (`mailer_autoconfirm: false`) and no confirmed test user exists. To prove it end-to-end:
   confirm a user (or temporarily enable autoconfirm in dev), then sign in at
   `http://localhost:3000/auth/login`. The gateway path is already proven (live JWKS reachable,
   alg matched, forgeries rejected).
2. **Google sign-in** requires: Auth → Providers → Google = ON (with a Google Cloud OAuth client),
   and `http://localhost:3000/auth/callback` added to Auth → URL Configuration → Redirect URLs,
   and Site URL = `http://localhost:3000`. The Google provider is already enabled at the API level;
   confirm the redirect URL is allow-listed.

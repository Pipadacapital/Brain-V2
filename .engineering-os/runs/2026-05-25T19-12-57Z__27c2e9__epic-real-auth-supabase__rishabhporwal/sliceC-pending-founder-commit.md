# Pending Founder Commit — Slice C (onboarding + membership + invitations, DB-backed)

Stage 6 PASS (signed under standing delegation). **Nothing has been committed or pushed.**

Slice C adds DB-backed onboarding/membership to the new Brain. Per the Founder-binding
decision (2026-05-25): onboarding/membership data persists in a **LOCAL Postgres (docker,
dev-only)** with the Brain-native RLS schema — NOT the live shared Supabase production DB.
Auth still uses real Supabase for IDENTITY only (slice A). The live/legacy production DB
(the zero-RLS P0) is untouched.

Per the feature-branch rule, commit slice C on a dedicated branch (e.g.
`feature/feat-onboarding-membership-db`) cut from `development` before review.

## Commit ONLY these paths (explicit — NO `git add -A`)

Real `.env` / `.env.local` are git-ignored and MUST NOT be committed (verified via
`git check-ignore`: exit 0 for the real files; `.env.example` files are committable).
EXCLUDE (pre-existing / not slice C): `.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts`,
`apps/web/next.config.ts`, `.engineering-os/decision-log/...` (audit trail, committed separately).

```bash
git add \
  apps/core-service/docker-compose.dev.yml \
  apps/core-service/docker/initdb-dev/01-create-rls-app-role.sql \
  apps/core-service/migrations/local-dev/01-schema-onboarding.sql \
  apps/core-service/migrations/local-dev/02-enable-rls-onboarding.sql \
  apps/core-service/migrations/local-dev/down.sql \
  apps/core-service/.env.example \
  apps/core-service/src/domain/onboarding/membership.ts \
  apps/core-service/src/application/onboarding/onboarding-use-cases.ts \
  apps/core-service/src/application/onboarding/index.ts \
  apps/core-service/src/infrastructure/db/workspace-context.ts \
  apps/core-service/src/__tests__/onboarding-membership.test.ts \
  apps/core-service/src/__tests__/integration/onboarding-rls.integration.test.ts \
  apps/core-service/src/__tests__/workspace-context.test.ts \
  apps/core-service/src/__tests__/probe-verdict.test.ts \
  apps/api-gateway/package.json \
  apps/api-gateway/tsconfig.json \
  apps/api-gateway/vitest.config.ts \
  apps/api-gateway/.env.example \
  apps/api-gateway/src/application/trpc.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/domain/membership-resolver.ts \
  apps/api-gateway/src/infrastructure/supabase-jwt-verifier.ts \
  apps/api-gateway/src/interfaces/server.ts \
  apps/api-gateway/src/application/router.onboarding-sliceC.test.ts \
  apps/api-gateway/src/application/router.auth-sliceA.test.ts \
  apps/api-gateway/src/domain/membership-resolver.test.ts \
  apps/api-gateway/src/infrastructure/supabase-jwt-verifier.test.ts \
  apps/api-gateway/src/interfaces/server.auth-context.test.ts \
  apps/api-gateway/src/interfaces/server.test.ts \
  apps/api-gateway/src/application/trpc.errorformatter.test.ts \
  apps/api-gateway/src/domain/gates.test.ts \
  apps/api-gateway/src/application/router.catalog.test.ts \
  apps/api-gateway/src/application/router.cohorts-ltv.test.ts \
  apps/api-gateway/src/application/router.insights.test.ts \
  apps/api-gateway/src/application/router.lifecycle.test.ts \
  apps/api-gateway/src/application/router.logistics.test.ts \
  apps/api-gateway/src/application/router.marketing.test.ts \
  apps/api-gateway/src/application/router.parity-cleanup.test.ts \
  apps/api-gateway/src/application/router.pnl.test.ts \
  apps/api-gateway/src/application/router.settings.test.ts \
  apps/api-gateway/src/application/router.store.test.ts \
  apps/web/tsconfig.json \
  apps/web/src/infrastructure/post-auth-routing.ts \
  apps/web/src/app/onboarding/page.tsx \
  apps/web/src/app/invite/[token]/page.tsx \
  apps/web/src/app/auth/callback/route.ts \
  apps/web/src/app/auth/confirm/route.ts \
  apps/web/src/interfaces/components/onboarding/onboarding-form.tsx \
  apps/web/src/interfaces/components/invitation/invitation-accept.tsx \
  apps/web/src/interfaces/components/dashboard/dashboard-content.tsx \
  apps/web/src/interfaces/components/dashboard/empty-workspace-state.tsx \
  apps/web/src/test/onboarding-form.test.tsx \
  apps/web/src/test/invitation-accept.test.tsx \
  apps/web/src/test/confirm-route.test.ts \
  pnpm-lock.yaml
```

Suggested commit message:

```
feat(slice-C-onboarding): DB-backed onboarding + membership + invitations (local dev Postgres, Brain-native RLS)

- LOCAL dev Postgres (docker-compose.dev.yml, :5432 brain_dev) + Brain-native RLS
  schema for users/workspaces/workspace_members/invitations (FORCE RLS, fail-closed)
- core-service onboarding use-cases (ensureUser/resolveMembership/listWorkspaces/
  completeOnboarding/acceptInvitation) on the Child-1 withWorkspace/withSuperadmin primitive
- gateway DbMembershipResolver → core-service resolveMembership (real-auth path);
  no-membership → /onboarding (no auto-grant); DB error → UNAUTHORIZED (fail-closed)
- identity tier (verified sub+email, no workspace) for onboarding/user.me/invite;
  workspace.switch/list now validate REAL DB membership (multi-workspace)
- web: /onboarding multi-step form, /invite/[token] accept, dashboard honest empty-state
  for a fresh workspace; /auth/callback + /auth/confirm route via the /me gate
- DATABASE_URL accepted as a session-mode alias of DIRECT_URL (Single-Primitive: one pool)
- Deferred to slice D: live Shopify/Woo OAuth connect (handle captured, connect disabled);
  member-invite SENDING (email). No live production DB touched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Founder run instructions (local dev)

```bash
# 1. Local dev Postgres
docker compose -f apps/core-service/docker-compose.dev.yml up -d
# wait ~10s until healthy, then apply the Brain-native schema (as the superuser):
docker exec -i brain-postgres-dev psql -U postgres -d brain_dev \
  -v ON_ERROR_STOP=1 < apps/core-service/migrations/local-dev/01-schema-onboarding.sql
docker exec -i brain-postgres-dev psql -U postgres -d brain_dev \
  -v ON_ERROR_STOP=1 < apps/core-service/migrations/local-dev/02-enable-rls-onboarding.sql

# 2. Gateway .env (git-ignored) — add the local DB connection (non-BYPASSRLS app role):
#   DATABASE_URL=postgresql://rls_app:rls_app_pw@localhost:5432/brain_dev
#   (SUPABASE_URL / SUPABASE_ANON_KEY already present from slice A)

# 3. Run both services
pnpm --filter @brain/api-gateway dev          # :3001 (auth: real Supabase JWT)
cd apps/web && pnpm exec next dev --webpack    # :3000

# 4. (optional) teardown the dev DB
docker compose -f apps/core-service/docker-compose.dev.yml down -v
```

## Supabase dashboard action items (carried from slices A/B — required for the full e2e)
Real signup → confirm → onboarding still needs the Supabase project to allow
`http://localhost:3000/auth/callback` (Auth → URL Configuration) + Site URL
`http://localhost:3000` + email delivery (`mailer_autoconfirm:false`). These are
dashboard facts, not code gaps — every code path is proven by unit + integration tests.

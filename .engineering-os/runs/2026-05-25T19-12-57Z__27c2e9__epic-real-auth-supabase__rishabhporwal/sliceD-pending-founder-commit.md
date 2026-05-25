# Pending Founder Commit — Slice D (live integrations OAuth + token custody)

Stage 6 PASS (signed under standing delegation). **Nothing has been committed or pushed.**

Slice D adds Shopify/Meta/Google OAuth connect/callback + token custody to the new Brain. Tokens persist
ENCRYPTED-AT-REST (AES-256-GCM, RLS-scoped) in the **LOCAL dev Postgres** (docker, dev-only) — NOT the
live shared Supabase production DB. The production seal() (CF-C7-CUSTODY-PROOF-1) remains HELD.

Per the feature-branch rule, commit slice D on a dedicated branch (e.g.
`feature/feat-live-integrations-oauth`) cut from `development` before review.

## SECRETS — git-ignore PROVEN (do NOT commit real .env)

- `git check-ignore apps/api-gateway/.env apps/core-service/.env` → exit 0 (IGNORED) ✓
- `git check-ignore apps/api-gateway/.env.example` → exit 1 (committable) ✓
- Real OAuth client ids/secrets + the AES custody key live ONLY in the git-ignored
  `apps/api-gateway/.env`. NO secret VALUE is in any tracked file. Commit ONLY `.env.example`.

## Commit ONLY these paths (explicit — NO `git add -A`)

EXCLUDE (pre-existing / not slice D): `apps/web/next.config.ts`, `apps/web/next-env.d.ts`,
`apps/web/src/interfaces/components/auth/login-form.tsx`, `.claude/`, `CLAUDE.md`,
`.engineering-os/decision-log/...` (audit trail, committed separately).

```bash
git add \
  apps/core-service/migrations/local-dev/03-schema-connectors.sql \
  apps/core-service/migrations/local-dev/04-enable-rls-connectors.sql \
  apps/core-service/migrations/local-dev/down-connectors.sql \
  apps/core-service/src/infrastructure/secrets/credential-custody.ts \
  apps/core-service/src/infrastructure/secrets/local-aesgcm-custody.ts \
  apps/core-service/src/infrastructure/secrets/production-custody.ts \
  apps/core-service/src/infrastructure/secrets/custody-factory.ts \
  apps/core-service/src/application/connectors/oauth-state.ts \
  apps/core-service/src/application/connectors/provider-config.ts \
  apps/core-service/src/application/connectors/connector-use-cases.ts \
  apps/core-service/src/application/connectors/index.ts \
  apps/core-service/src/__tests__/custody-local-aesgcm.test.ts \
  apps/core-service/src/__tests__/provider-config.test.ts \
  apps/core-service/src/__tests__/connector-use-cases.test.ts \
  apps/core-service/src/__tests__/integration/connectors-rls.integration.test.ts \
  apps/core-service/src/__tests__/integration/connectors-mechanical-proof.integration.test.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/application/router.connectors-sliceD.test.ts \
  apps/api-gateway/tsconfig.json \
  apps/api-gateway/vitest.config.ts \
  apps/api-gateway/.env.example \
  apps/web/tsconfig.json \
  apps/web/src/app/api/integrations/shopify/callback/route.ts \
  apps/web/src/app/api/integrations/meta/callback/route.ts \
  apps/web/src/app/api/integrations/google/callback/route.ts \
  apps/web/src/infrastructure/connector-callback.ts \
  apps/web/src/infrastructure/connector-callback-handler.ts \
  apps/web/src/interfaces/components/settings/integrations-content.tsx \
  apps/web/src/test/connector-callback.test.ts \
  apps/web/src/test/integrations-content.test.tsx
```

Suggested commit message:

```
feat(slice-D-integrations): Shopify/Meta/Google OAuth connect + callback + encrypted token custody (local dev)

- OAuth connect/callback for Shopify (per-store), Meta Ads, Google Ads: initiate (CSRF
  state + provider consent URL) -> /api/integrations/{vendor}/callback -> gateway
  connectors.completeCallback -> core-service validate state (+ Shopify HMAC) -> exchange
  code -> persist token ENCRYPTED. Scopes/versions carried verbatim from legacy (read-only).
- Token custody: TS CredentialCustody Protocol (mirrors the Child-3 Python contract);
  LocalAesGcmCustody (real AES-256-GCM, key from git-ignored .env, iv||tag||ciphertext in
  connector_credentials.bytea, no plaintext column); HeldProductionCustody throws
  NotImplementedError (production seal() HELD: CF-C7-CUSTODY-PROOF-1); custody-factory flag swap.
- 3 connector tables on the LOCAL dev Postgres with ENABLE+FORCE RLS (slice-C ws_isolation
  shape): connector_connections, connector_credentials (custody), connector_oauth_states (CSRF).
- gateway connectorsRouter: initiate/disconnect (MANAGER), list (ANALYST, no token),
  completeCallback (identity tier; workspace from the consumed state). Idempotent callback.
- web: real Connect/Disconnect buttons on /settings/integrations + per-vendor status
  (connected / not-connected / token-expired); Shopify domain prompt.
- Deferred: data-ingestion/backfill (status "connected, sync pending"; Child-3 framework owns it);
  production seal() (Founder-gated). No live production DB touched; tokens never logged/returned.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Founder run instructions (local dev)

```bash
# 1. Local dev Postgres (if not already up) + apply ALL migrations (slice C then D):
docker compose -f apps/core-service/docker-compose.dev.yml up -d
for f in 01-schema-onboarding 02-enable-rls-onboarding 03-schema-connectors 04-enable-rls-connectors; do
  docker exec -i brain-postgres-dev psql -U postgres -d brain_dev -v ON_ERROR_STOP=1 \
    < apps/core-service/migrations/local-dev/$f.sql
done

# 2. apps/api-gateway/.env (git-ignored) — already populated this slice with the real OAuth
#    client ids/secrets (copied from legacy) + a generated CONNECTOR_CUSTODY_KEY + redirect URIs:
#      CONNECTOR_CUSTODY_BACKING=local-aesgcm
#      CONNECTOR_CUSTODY_KEY=<32-byte base64>   (generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
#      SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_REDIRECT_URI
#      META_APP_ID / META_APP_SECRET / META_CONFIG_ID / META_API_VERSION / META_REDIRECT_URI
#      GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN /
#      GOOGLE_ADS_LOGIN_CUSTOMER_ID / GOOGLE_ADS_API_VERSION / GOOGLE_ADS_REDIRECT_URI

# 3. Run both services
pnpm --filter @brain/api-gateway dev          # :3001 (auth: real Supabase JWT)
cd apps/web && pnpm exec next dev --webpack    # :3000

# 4. (Stage-5) integration tests — run SERIALLY (shared dev DB):
DATABASE_URL=postgresql://rls_app:rls_app_pw@localhost:5432/brain_dev INTEGRATION_TEST=true \
  pnpm --filter @brain/core-service exec vitest run src/__tests__/integration/connectors-rls.integration.test.ts \
    src/__tests__/integration/connectors-mechanical-proof.integration.test.ts --no-file-parallelism
```

## Provider dashboard action items (REQUIRED for live e2e — the key handoff)

Register these EXACT redirect URIs (local-dev):
- **Shopify** (Partner → App setup → Allowed redirection URL(s)):
  `http://localhost:3000/api/integrations/shopify/callback`
- **Meta** (App → Facebook Login → Valid OAuth Redirect URIs):
  `http://localhost:3000/api/integrations/meta/callback`
- **Google** (Cloud Console → Credentials → OAuth client → Authorized redirect URIs):
  `http://localhost:3000/api/integrations/google/callback`

Once registered, a real browser Connect → consent → callback exchanges + persists the live token (the
exchange uses real `fetch` in production; the test fixture is test-only — no code change needed).
```

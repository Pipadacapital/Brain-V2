# Stage 2 — Architect Plan (Aryan) — Slice D: OAuth connect/callback + token custody

**Paradigm:** sql/io (OAuth handshake + DB persistence + AEAD crypto; NO LLM/ML).
**Reuses:** slice-C `withWorkspace`/`withSuperadmin` Single-Primitive; slice-C local Postgres + FORCE-RLS
pattern; slice-A identity (verified sub+email); Child-3 custody Protocol shape (get/put/seal; Credential
never logged; production backings held); legacy oauth-state (hashed state, TTL, one-time consume) + the
legacy per-provider auth-URL/exchange logic; the existing `/settings/integrations` page.

## Token-custody persona synthesis (token-custody-at-rest-realist:sonnet — 5 concerns, all ACCEPTED)

1. **TC-001 (HIGH) — AEAD, not raw cipher.** Local custody MUST use authenticated encryption
   (AES-256-GCM) so a tampered ciphertext is *rejected on decrypt*, not silently decrypted to garbage.
   → Plan: `node:crypto` `createCipheriv('aes-256-gcm')`; store `iv || authTag || ciphertext`; decrypt
   verifies the tag → throws on tamper. Acceptance: a tamper test (flip one ciphertext byte) MUST throw.
2. **TC-002 (HIGH) — key never in repo; fail-closed if absent.** The 32-byte key comes from a git-ignored
   `.env` (`CONNECTOR_CUSTODY_KEY`, base64). If missing/short → throw at use (NOT a silent default key).
   → Acceptance: unset key → custody `put`/`get` throw a clear error; key length validated to 32 bytes.
3. **TC-003 (HIGH) — never log/serialize the token.** `Credential.content` (and the encrypted column)
   never appear in logs, errors, tRPC responses, or the integrations status payload. Status returns
   only: vendor, status enum, scopes, account ids, expiry, last_sync — NEVER the token.
   → Acceptance: a grep gate over slice-D files for token field names in any `console.*`/return; a test
   asserting the status payload + error messages contain no token substring.
4. **TC-004 (MED) — local backing is the TEMPLATE, not production.** The local backing is flag-gated
   (`CONNECTOR_CUSTODY_BACKING=local-aesgcm`) and clearly marked local-dev-only; the production seal()
   (CF-C7-CUSTODY-PROOF-1) stays a held NotImplementedError stub in BOTH the TS mirror and the Python
   framework. `seal()` in the local backing = delete-the-row (revoke), which is the local analogue.
   → Acceptance: the production-backing selector raises NotImplementedError; only `local-aesgcm` works.
5. **TC-005 (MED) — RLS-scope the custody write/read.** Connector credential + connection rows are
   workspace-scoped under FORCE RLS via `withWorkspace(workspaceId)` — a context-less or cross-workspace
   read returns 0 rows. The token write happens under the connecting workspace's context.
   → Acceptance: cross-workspace read of `connector_credentials` returns 0 rows at the wire.

## Data model (LOCAL dev Postgres — new migrations, additive)

`migrations/local-dev/03-schema-connectors.sql` + `04-enable-rls-connectors.sql` + extend `down.sql`:

- **`connector_connections`** (one row per workspace+vendor): `id uuid pk`, `workspace_id uuid NOT NULL
  REFERENCES workspaces(id) ON DELETE CASCADE`, `vendor connector_vendor NOT NULL`, `status
  connector_status NOT NULL DEFAULT 'NOT_CONNECTED'`, `scopes text[]`, `account_ref text` (shop domain /
  ad-account id / customer id — NON-secret), `external_metadata jsonb` (NON-secret: currency, account
  names), `token_expires_at timestamptz`, `last_sync_at timestamptz`, `last_sync_error text`,
  `connected_at timestamptz`, `created_at/updated_at`. `UNIQUE (workspace_id, vendor)`.
  - ENUM `connector_vendor AS ENUM ('SHOPIFY','META','GOOGLE')`.
  - ENUM `connector_status AS ENUM ('NOT_CONNECTED','CONNECTED','TOKEN_EXPIRED','ERROR')`.
- **`connector_credentials`** (the custody store — SECRET): `workspace_id uuid NOT NULL REFERENCES
  workspaces(id) ON DELETE CASCADE`, `vendor connector_vendor NOT NULL`, `credential_enc bytea NOT NULL`
  (iv||tag||ciphertext of the token JSON), `updated_at timestamptz`. `PRIMARY KEY (workspace_id, vendor)`.
  - **No plaintext token column ever.** The encrypted blob is the only at-rest form.
- **`connector_oauth_states`** (CSRF): `state_hash text PRIMARY KEY` (sha256 of the nonce), `workspace_id
  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`, `vendor connector_vendor NOT NULL`,
  `user_id uuid NOT NULL`, `shop_domain text` (Shopify only), `expires_at timestamptz NOT NULL`,
  `created_at`. 10-minute TTL; one-time consume (deleted on validate).
- **RLS:** all three tables ENABLE + FORCE RLS with the slice-C `ws_isolation` shape
  (`workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid`) + a `superadmin_rows`
  policy (oauth-state create/validate at callback time runs under `withSuperadmin` keyed by state_hash,
  same sanctioned no-context pattern as invitation accept). GRANT DML to `rls_app`.

## Custody (TS mirror of the Child-3 Protocol) — `apps/core-service/src/infrastructure/secrets/`

- `credential-custody.ts` — the TS Protocol: `interface CredentialCustody { get(ws,vendor),
  put(ws,vendor,content), seal(ws,vendor) }` + `Credential` type (content never logged). Mirrors
  `custody.py` signature 1:1.
- `local-aesgcm-custody.ts` — **real local backing.** AES-256-GCM via `node:crypto`; key from
  `CONNECTOR_CUSTODY_KEY` (base64, 32 bytes, validated, fail-closed if absent). `put` encrypts the token
  JSON and UPSERTs `connector_credentials` under `withWorkspace`; `get` reads under `withWorkspace`,
  decrypts (tag-verified). `seal` = DELETE the row (local revoke analogue). Clearly marked LOCAL-DEV-ONLY.
- `production-custody.ts` — held stub: selecting a production backing raises NotImplementedError citing
  CF-C7-CUSTODY-PROOF-1 (AWS Secrets Manager ap-south-1 vs Supabase encrypt-in-place — Founder-gated).
- `custody-factory.ts` — selects by `CONNECTOR_CUSTODY_BACKING` (`local-aesgcm` works; anything else →
  the held production stub → NotImplementedError).

## OAuth use-cases (core-service) — `apps/core-service/src/application/connectors/`

- `oauth-state.ts` — `generateNonce()` (32 random bytes hex), `createOAuthState(...)` (UPSERT hashed
  state, 10-min TTL, prune expired), `validateAndConsumeOAuthState(state, vendor)` (lookup by sha256,
  match vendor, check expiry, **delete = one-time consume**). Ported from legacy oauth-state.ts, on the
  local DB via `withSuperadmin` (state rows are pre-membership-context, keyed by the unguessable hash).
- `provider-config.ts` — per-vendor PURE config + URL builders (NO secret values inlined; reads
  client-id/secret/redirect from env at call time): `buildAuthUrl(vendor, state, opts)`,
  `tokenExchange(vendor, code, opts)` behind an injectable `ProviderHttp` seam (real `fetch` in prod;
  a fixture in tests — this is the mock seam for mechanical verification without live creds). Carries the
  legacy scopes/versions/endpoints verbatim:
  - **Shopify:** auth `https://{shop}/admin/oauth/authorize`, scopes `read_orders,read_all_orders,
    read_products,read_customers,read_analytics,read_inventory,read_reports`, exchange
    `POST https://{shop}/admin/oauth/access_token`, **HMAC-validate** the callback query (timing-safe).
  - **Meta:** auth `https://www.facebook.com/v21.0/dialog/oauth`, scopes `ads_management,ads_read,
    business_management,read_insights`, exchange `GET graph.facebook.com/v21.0/oauth/access_token` then
    long-lived `fb_exchange_token`.
  - **Google:** auth `https://accounts.google.com/o/oauth2/v2/auth?...access_type=offline&prompt=consent`,
    scope `https://www.googleapis.com/auth/adwords`, exchange `POST oauth2.googleapis.com/token`
    (`grant_type=authorization_code`) → REQUIRES `refresh_token` (offline).
- `connector-use-cases.ts`:
  - `initiateConnect({vendor, workspaceId, userId, shopDomain?})` → assert workspace context, create
    oauth-state, return `{ authUrl }` (state nonce embedded; redirect_uri from env).
  - `completeCallback({vendor, code, state, query})` → validate+consume state (CSRF), [Shopify only]
    validate HMAC, exchange code (via ProviderHttp), `custody.put(ws, vendor, tokenContent)`, UPSERT
    `connector_connections` (status CONNECTED, scopes, account_ref, expiry) under `withWorkspace`.
    **IDEMPOTENT:** the UPSERT is keyed `(workspace_id, vendor)` → a replayed callback re-writes the same
    row, never duplicates; custody.put is also an UPSERT. Returns a redirect target (no token).
  - `listConnectors(workspaceId)` → per-vendor status (NOT_CONNECTED / CONNECTED / TOKEN_EXPIRED via
    `token_expires_at < now()` / ERROR), scopes, account_ref, last_sync — **NEVER the token.**
  - `disconnect({vendor, workspaceId})` → `custody.seal` (delete credential) + status DISCONNECTED.

## Gateway (api-gateway) — new `connectorsRouter` (workspace tier, requireRole(ADMIN) for connect/disconnect)

- `connectors.initiate` (mutation, requireRole **MANAGER**+ — connecting a store is a managerial config
  change, mirrors legacy `requireWorkspaceAdmin`) → `{ authUrl }`.
- `connectors.list` (query, requireRole ANALYST) → per-vendor status rows (no token).
- `connectors.disconnect` (mutation, requireRole MANAGER) → seal + status.
- Callback is NOT a tRPC procedure (it is a provider GET redirect) — see web route handler. The gateway
  exposes `connectors.completeCallback` as an **internal** mutation the web route handler calls with the
  verified session, OR the web route handler calls core-service directly. **Chosen:** web route handler
  validates the Supabase session (slice-A pattern) then calls the gateway `connectors.completeCallback`
  (identity tier) so all tenancy/role/custody logic stays in core-service (canon: gateway carries no
  business logic; core-service owns it).

## Web (Next.js) — callback route handlers + real Connect buttons

- **Callback route handlers** (browser redirect target; these are the URLs the Founder registers):
  - `apps/web/src/app/api/integrations/shopify/callback/route.ts`
  - `apps/web/src/app/api/integrations/meta/callback/route.ts`
  - `apps/web/src/app/api/integrations/google/callback/route.ts`
  Each: read `code`/`state`/`error`/`hmac`(shopify)/`shop`(shopify) from query → call the gateway
  `connectors.completeCallback` (with the user's Supabase session cookie → verified identity) → redirect
  to `/settings/integrations?connected={vendor}` or `?error=...`. NEVER logs the code/token.
- **`/settings/integrations`** — replace the disabled affordances with real Connect/Disconnect buttons.
  Connect → `connectors.initiate` mutation → `window.location.assign(authUrl)`. Shopify Connect prompts
  for the `*.myshopify.com` domain (per-store OAuth). Per-vendor live status from `connectors.list`
  (connected / not-connected / token-expired). Reuse the existing IntegrationsContent shell.

## Redirect URIs the Founder must register (KEY HANDOFF)

Local-dev (web on :3000), Brain-native paths:
- **Shopify** (Partner dashboard → App setup → Allowed redirection URL(s)):
  `http://localhost:3000/api/integrations/shopify/callback`
- **Meta** (App dashboard → Facebook Login → Valid OAuth Redirect URIs):
  `http://localhost:3000/api/integrations/meta/callback`
- **Google** (Cloud Console → Credentials → OAuth client → Authorized redirect URIs):
  `http://localhost:3000/api/integrations/google/callback`
(These intentionally MATCH the legacy `.env` `META_REDIRECT_URI`/`GOOGLE_ADS_REDIRECT_URI` path shape so
the existing dashboard registrations may already cover Meta/Google; Shopify legacy used
`brain.pipadacapital.com/api/shopify/callback` — the local-dev path above must be added for local testing.)

## Mechanical verification seam (no live creds required)

- `ProviderHttp` is injectable: tests pass a fixture that returns a canned token-exchange response;
  prod passes real `fetch`. This lets Stage-5 prove exchange→persist→idempotent→RLS WITHOUT live consent.
- Initiate is verified by asserting the built auth URL string (client_id reference present but NOT
  asserted by value, correct host/path, scopes, redirect_uri, `state` nonce, Google `access_type=offline`
  & `prompt=consent`).

## Deferrals (named)

- **Data ingestion/backfill** → DEFERRED. `connector_connections.last_sync_at` stays null; status reads
  "Connected · sync pending". The Child-3 Python framework (held) owns ingestion. No fake sync.
- **Production seal()** (CF-C7-CUSTODY-PROOF-1) → HELD, unchanged.
- **Meta/Google account-selection** (multi-ad-account / MCC child) → minimal: store discovered
  account_ref; the legacy multi-select UI is out of slice-D scope (connect + custody is the deliverable).

## Over-engineering guard (Single-Primitive)

- ONE custody seam (TS), ONE DB primitive (`withWorkspace`), ONE oauth-state shape, ONE generic
  per-vendor config table (NOT three bespoke connect paths — vendor differences are CONFIG behind
  `provider-config.ts`, matching Child-3 CF-C3-SINGLE-PRIMITIVE-1). No new runtime, no new pool, no LLM.
- New deps: NONE (node:crypto is built-in; pg already present). If any dep is added → BOUNCE.

# Stage 6 — Final Review (VETO) — Slice D: live integrations OAuth + token custody

**Reviewer:** Rohan (CTO Advisor) · **Date:** 2026-05-26 · **Decision: PASS**
**Epic:** epic-real-auth-supabase · **Slice:** D (FINAL — live integrations: Shopify, Meta, Google)

Slice D builds the OAuth connect/callback code + token custody for Shopify, Meta Ads, Google Ads on
the Brain-native TS runtime (web → api-gateway → core-service), BUILT and MECHANICALLY VERIFIED per the
Founder-binding decision ("build the OAuth code now; I'll configure the provider dashboards"). Tokens
persist ENCRYPTED-AT-REST, RLS-scoped, in the LOCAL dev Postgres. The production seal() (CF-C7-CUSTODY-
PROOF-1) remains HELD. Data-ingestion/backfill is DEFERRED (honest "connected · sync pending" status).
Run as a single-operator high-stakes pass (Stage 2→6) — the Agent tool was unavailable, so I played each
role and held every gate to its real bar (as for slices B/C). This is stated honestly.

## Pipeline trace

| Stage | Role | Result |
|-------|------|--------|
| 1 | CTO intake (me) | high-stakes; @paradigm sql/io; 1 persona (token-custody-at-rest-realist:sonnet); ADVANCE. |
| 2 | Architect (Aryan) | Plan: TS custody mirror of Child-3 Protocol + real local AES-256-GCM backing; ONE generic provider-config; reuse withWorkspace/withSuperadmin + slice-C RLS pattern + legacy oauth-state. |
| 3 | Build | 3 connector tables (FORCE RLS) + custody (interface/local/held/factory) + oauth-state + provider-config + use-cases + gateway connectorsRouter + 3 web callback routes + real Connect buttons. |
| 4 | Security VETO (Shreya) | PASS — tokens encrypted at rest (AEAD), never logged/returned; .env git-ignored; RLS fail-closed at the wire; least-privilege read-only scopes; NO outbound/DLT surface. |
| 5 | Verification VETO (Tanvi) | PASS — typecheck 0×3; 42 new unit + 7 integration tests; live mechanical proof captured. |
| 6 | Final review (me) | PASS (independent re-verification below). |

## What was built (per directive item)

1. **OAuth connect/callback for Shopify, Meta, Google.** `initiateConnect` (CSRF state + provider consent
   URL) → provider consent → `/api/integrations/{vendor}/callback` (web route handler validates the
   Supabase session) → gateway `connectors.completeCallback` → core-service validates state (CSRF) +
   [Shopify] HMAC → exchanges the code (via an injectable ProviderHttp seam) → persists the token. Scopes/
   versions/endpoints carried VERBATIM from legacy (read-only families). **Exact redirect URIs handed off
   below.**
2. **Token custody (Shreya VETO surface).** TS `CredentialCustody` Protocol (mirrors the Child-3 Python
   contract get/put/seal 1:1). `LocalAesGcmCustody` — REAL AES-256-GCM (node:crypto), key from the
   git-ignored `CONNECTOR_CUSTODY_KEY`, iv||tag||ciphertext blob in `connector_credentials.credential_enc`
   (bytea); no plaintext column ever. `HeldProductionCustody` — selecting a production backing throws
   NotImplementedError (production seal() REMAINS HELD: CF-C7-CUSTODY-PROOF-1). `custody-factory` is the
   one-line flag swap (`CONNECTOR_CUSTODY_BACKING`). Tokens NEVER logged/echoed/returned.
3. **OAuth state/CSRF + idempotent callback + RLS + least-privilege.** `connector_oauth_states`: sha256-
   hashed nonce, 10-min TTL, one-time consume. Callback UPSERTs `(workspace_id, vendor)` for both the
   connection row and custody → idempotent (replay = same row). All 3 connector tables ENABLE+FORCE RLS
   (slice-C ws_isolation shape). Read-only scopes only.
4. **`/settings/integrations` real Connect/Disconnect buttons + per-connector status** (connected /
   not-connected / token-expired) from `connectors.list`. Shopify prompts for the *.myshopify.com domain.
5. **Data ingestion/backfill — DEFERRED (honest).** `last_sync_at` stays null; status = "Connected · sync
   pending". The Child-3 Python framework (held) owns ingestion. NO fake sync.

## Audits

- **Over-engineering:** PASS. ZERO new runtime deps (node:crypto built-in; pg already present — git diff
  of all package.json = empty for slice D). ONE custody seam, ONE DB primitive (withWorkspace) reused,
  ONE generic provider-config (vendor = CONFIG behind one interface, not 3 bespoke paths — mirrors
  CF-C3-SINGLE-PRIMITIVE-1), ONE oauth-state shape. No speculative abstraction. No WHAT-comments.
- **@paradigm:** PASS. All slice-D files `@paradigm sql`/`io`; ZERO LLM/ML — defends the %-of-GMV cost
  model (no per-call inference on the connect path).
- **Multi-tenancy (4 layers):** PASS. (1) verified sub from JWKS; (2) workspaceProc asserts workspaceId
  === claim.workspaceId before any call; (3) requireRole per-procedure (MANAGER for initiate/disconnect,
  ANALYST for list); (4) Postgres FORCE RLS on all 3 connector tables — cross-workspace read of the token
  blob returns 0 rows, proven at the wire.
- **Secrets/PII (Shreya VETO):** PASS. Real OAuth client ids/secrets + custody key live ONLY in the
  git-ignored `apps/api-gateway/.env` (check-ignore exit 0). Committed: only `.env.example` (key names,
  zero values). NO secret VALUE in any tracked file (grep gates clean; the one console.log match is a
  key-GENERATION help string, not a value emit). Tokens encrypted at rest; never logged/returned.
- **Compliance:** PASS. These are READ integrations (pull store/ad data) — NO outbound send, NO
  DLT/NCPR/9am-9pm/WhatsApp surface. DPDP: connector tables hold tokens + minimal non-PII metadata;
  the PII-bearing ingestion is deferred (Child-3 PiiManifest gate owns it).
- **Drift vs requirement:** PASS. All 5 directive items delivered; the two deferrals (data-ingestion;
  production seal()) are exactly the directive's stated deferrals, named honestly.
- **Hard-rule deviation check (§9):** NONE. No dependency violation (builds on committed contracts +
  slice-C local DB), no Single-Primitive violation, no compliance gap, no paradigm escalation, no
  gate-skip. Delegation is exercisable.

## Independent re-run of Stage-5 gates (Stage-6 mandatory — captured live)

- **GATE A — RLS state:** `connector_connections / connector_credentials / connector_oauth_states` all
  `relrowsecurity=t relforcerowsecurity=t`.
- **GATE B — role:** `rls_app rolbypassrls=f` (fail-closed is meaningful).
- **GATE C — fail-closed READ:** a seeded credential row, read context-less as rls_app → **0 rows**.
- **GATE D — cross-workspace isolation:** wrong workspace context → 0 rows; correct context → 1 row.
- **GATE E — fail-closed WRITE:** context-less INSERT into connector_credentials →
  `new row violates row-level security policy`.
- **GATE F — mechanical flow proof (live DB + real client config, token-exchange via fixture):**
  - initiate auth URLs correct per vendor (client_id present-but-redacted; Shopify 7 read scopes +
    /admin/oauth/authorize; Meta /v21.0/dialog/oauth + response_type=code; Google adwords scope +
    access_type=offline + prompt=consent).
  - callback: exchange → custody.put → UPSERT; at rest `credential_enc` is ciphertext (plaintext-token-
    present=FALSE for all 3); decrypt round-trip recovers the exact token keys; list returns no token +
    syncPending=true.
  - AEAD tamper test: a flipped ciphertext byte → decrypt REJECTS (no silent garbage).
  - idempotency: a replayed callback → exactly 1 connection row + 1 credential row.
  - one-time state: a replayed state → null (rejected).
- **GATE G — gateway boot + wire fail-closed:** `/health authMode=real-supabase-jwt`; connectors.list/
  initiate/completeCallback/disconnect with NO Bearer → UNAUTHORIZED; forged Bearer → UNAUTHORIZED;
  error bodies carry only requestId (no token/secret).
- **GATE H — typecheck 0×3 + suites:** core-service 224u (+42), api-gateway 225 (+10), web 87 (+10);
  slice-D integration 7 passed (isolated/serial).

## Carried non-blocking (NOT slice-D defects)

- **B0 (pre-existing):** `apps/web/next.config.ts`, `apps/web/next-env.d.ts`, `apps/web/.../login-form.tsx`
  were modified at session start (carried from slices A-C) — EXCLUDED from the slice-D commit manifest.
- **B1 (pre-existing, env gap):** `pool-isolation.test.ts` (Child-1 commit 860aeee) FAILs its `beforeAll`
  with `ECONNREFUSED :5433` — it requires a pgbouncer transaction-mode container not in the local dev
  setup. Its 10 tests are skipped (↓). Slice D does not touch this file. Not a code defect.
- **B2 (test-harness):** running ALL integration files in parallel causes cross-file DB-truncation races
  (shared dev DB). Run integration tests with `--no-file-parallelism` (or per-file) — all pass serially.
  A test-isolation concern (per-file schema/cleanup), not a code defect; noted for the retro.

## Founder handoff — EXACT redirect URIs to register (KEY DELIVERABLE)

Local-dev (web on :3000), Brain-native callback paths:

| Provider | Dashboard location | Redirect URI to register |
|----------|--------------------|--------------------------|
| **Shopify** | Partner dashboard → App setup → Allowed redirection URL(s) | `http://localhost:3000/api/integrations/shopify/callback` |
| **Meta Ads** | App dashboard → Facebook Login → Settings → Valid OAuth Redirect URIs | `http://localhost:3000/api/integrations/meta/callback` |
| **Google Ads** | Cloud Console → APIs & Services → Credentials → OAuth client → Authorized redirect URIs | `http://localhost:3000/api/integrations/google/callback` |

Meta/Google paths MATCH the legacy `.env` `META_REDIRECT_URI`/`GOOGLE_ADS_REDIRECT_URI` shape (existing
registrations may already cover them). Shopify legacy used `brain.pipadacapital.com/api/shopify/callback`
— the local-dev path above must be ADDED for local testing.

## Verified mechanically vs what needs live provider config

- **Verified now (mechanical, captured):** auth-URL build per vendor; CSRF state create+consume (one-time);
  Shopify HMAC validate; code-exchange→custody(encrypted)→UPSERT (idempotent, RLS-scoped) via a fixture
  token-exchange; AES-256-GCM round-trip + tamper-reject; fail-closed RLS at the wire; gateway boot + wire
  auth; typecheck 0; all suites green.
- **Needs the Founder (live e2e):** registering the 3 redirect URIs above in the provider dashboards, then
  a real browser consent → real provider token exchange. The exchange seam is real `fetch` in production
  (the fixture is test-only); no code change is needed once the dashboards are configured.

## Production seal() — HELD (unchanged)

The production at-rest custody decision (AWS Secrets Manager ap-south-1 vs Supabase encrypt-in-place) is
Founder-gated (CF-C7-CUSTODY-PROOF-1). The local-aesgcm backing is the dev template; the production
backings throw NotImplementedError. Slice D does NOT make or fake this decision.

## Verdict: **PASS** → Founder gate (signed under standing delegation).

No hard-rule deviation that blocks auto-approve (§9 clean). Nothing committed (feature-branch rule +
commit-authorization guard); no secret leaked (git-ignore proven; grep gates clean). Founder commits via
`sliceD-pending-founder-commit.md` (explicit paths, no `git add -A`; real `.env` excluded + check-ignore-
proven). Slice D closes epic-real-auth-supabase (A identity / B signup-recovery / C onboarding+RLS / D
live integrations) — all built + mechanically verified locally; live provider config is the Founder step.

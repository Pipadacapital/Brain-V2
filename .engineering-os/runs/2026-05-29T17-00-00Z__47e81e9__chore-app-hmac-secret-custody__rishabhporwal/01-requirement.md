# 01 — Requirement — chore-app-hmac-secret-custody

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **CF-ref** | `CF-CC-SHOPIFY-HMAC-1` |
| **Parent** | `feat-credential-custody-aws-sm` (ruling §17 Track C; parent at Stage 8 readiness-held on development) |
| **Filed by** | Maya (Stage 3, Track C, 2026-05-29); intaken by Rohan (CTO Advisor) 2026-05-29 |
| **Branch (intake)** | `chore/intake-chore-app-hmac-secret-custody` (off development) |

## Goal

Give the Shopify Partner-app HMAC secret (`SHOPIFY_CLIENT_SECRET`, config `shopify.app_hmac_secret`)
a proper custody home and a clean retrieval path, replacing the current plaintext-in-`.env` posture.

## Ground truth (verified in code at intake — corrects the stub + grounding note)

`SHOPIFY_CLIENT_SECRET` has **THREE consumers today**, not one, and the webhook
verifier is NOT in api-gateway and NOT (only) in core-service:

| # | Consumer | File | Shape | Workspace context |
|---|----------|------|-------|-------------------|
| C1 | **OAuth-callback HMAC** (TS) | `apps/core-service/src/application/connectors/provider-config.ts:153` `validateShopifyHmac()` | hex digest of the sorted query string; reads via `requireEnv('SHOPIFY_CLIENT_SECRET')` | **Workspace context EXISTS** — user is interactively connecting a store. |
| C2 | **OAuth token exchange** (TS) | same file `exchangeShopify()` `:210` | uses the secret as `client_secret` in the POST to `/admin/oauth/access_token` | Workspace context exists (same flow as C1). |
| C3 | **Inbound-webhook HMAC** (Python) | `apps/ingestion-service/src/interfaces/adapters/shopify_adapter.py:81` `verify_shopify_hmac(data, hmac_header, client_secret)` | base64 digest of the **raw body** (`X-Shopify-Hmac-SHA256`); takes `client_secret` as a **parameter** (injected) | **NO workspace context** — webhook arrives before routing. **This function has NO caller / no webhook ingress route yet** — it is a pure function awaiting wiring. |

**Key correction:** the canon (technical-context §3) makes **`ingestion-service` the webhook owner**
("Connector framework, sync, webhooks, canonicalization"). So the webhook leg (C3) is Python/ingestion,
NOT api-gateway (grounding-note guess) and NOT TS core-service (stub guess). The OAuth legs (C1/C2)
are TS/core-service and DO have workspace context. The stub's premise ("consumed BEFORE any workspace
context") is true ONLY of the C3 webhook leg, not the C1/C2 OAuth legs.

## Current posture

- Plaintext in `apps/api-gateway/.env:27` (`SHOPIFY_CLIENT_SECRET=shpss_<REDACTED-compromised-rotate-at-Stage-8>`)
  and an empty key in `apps/api-gateway/.env.example:49`. `.env` is git-ignored (dev only). The live
  `shpss_…` value is the plaintext-vault posture being closed.
- All three consumers read the SAME secret value.

## In scope (this requirement)
- A custody/retrieval design for the **app-level (singleton, no `workspace_id`)** Shopify HMAC secret.
- The TS retrieval seam (C1/C2) + the Python retrieval seam (C3) that feed the secret to the verifiers.
- HMAC verification correctness for the webhook leg (constant-time, fail-closed) — verify-the-verifier kill-test.
- Rotation policy for the app secret.
- Code + CDK (authored-not-deployed) + tests with NO real AWS, no live secret value committed/logged.

## Explicitly OUT of scope / HELD
- Real Secrets Manager provisioning + rotating the live `shpss_…` value into it (Founder/Jatin at console).
- Building the inbound-webhook ingress route itself (that is the connector-webhook-intake feature, not
  this custody slice — but this slice MUST leave a clean retrieval seam for it).
- Any commit (Founder "commit it" required).

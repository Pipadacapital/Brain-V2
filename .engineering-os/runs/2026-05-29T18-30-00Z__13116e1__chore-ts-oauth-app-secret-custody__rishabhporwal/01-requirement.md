# 01 — Requirement — chore-ts-oauth-app-secret-custody

| Field | Value |
|-------|-------|
| **req_id** | `chore-ts-oauth-app-secret-custody` |
| **CF-ref** | `CF-HMAC-TS-VS-PY-OWNER-1` (the parent ruling that NAMED this follow-on) |
| **Parent** | `chore-app-hmac-secret-custody` (Stage 8 readiness-held) → grandparent `feat-credential-custody-aws-sm` |
| **Named-by** | Aryan, parent Stage-2 plan §3 + active.json `named_follow_on` |
| **Filed by / intaken by** | Rohan (CTO Advisor), Stage 1, 2026-05-29 |
| **Branch (intake)** | `chore/intake-chore-ts-oauth-app-secret-custody` (off development) |

## Goal

Bring the **TS (core-service) Shopify OAuth consumers** of `SHOPIFY_CLIENT_SECRET` onto a proper
custody source, closing the env-injected interim that the HMAC slice (`chore-app-hmac-secret-custody`)
**deliberately left** under ruling `CF-HMAC-TS-VS-PY-OWNER-1`.

## Ground truth (verified in code at intake)

Two TS consumers, both in `apps/core-service/src/application/connectors/provider-config.ts`:

| # | Consumer | Location | Shape | Workspace ctx |
|---|----------|----------|-------|---------------|
| C1 | `validateShopifyHmac()` | `:153` (secret read `:156`) | **hex** digest of the **sorted query string**; `requireEnv('SHOPIFY_CLIENT_SECRET')`; `timingSafeEqual` `:166` | EXISTS (interactive connect) |
| C2 | `exchangeShopify()` | `:199`, secret at `:210` | `client_secret` in the form-body POST to `/admin/oauth/access_token` | EXISTS (same flow) |

- `requireEnv` helper: `:76` — reads `process.env[name]`, throws if unset, **never logs the value**.
- core-service today: **no `Dockerfile`, no `bootstrap/` entrypoint** — it runs in-process via the
  gateway locally. There is **no deployed task-def yet** → the live container injection wiring is a
  Stage-8 concern, not buildable runtime this slice.

## The custody machinery this builds on (from the parent slices — DO NOT rebuild)

- Per-workspace `AwsSecretsManagerCustody` (Python, ingestion-service) + the **app-singleton provider**
  reading `brain/_app/shopify/hmac_secret` (Python).
- The CDK `CredentialCustodyStack` **already provisions** `appShopifyHmacSecret` at
  `brain/_app/shopify/hmac_secret`, **CMK-encrypted, ap-south-1**, IAM `secret:brain/*` prefix
  (no real `SecretString` — authored-not-provisioned; value injection is the Stage-8 ceremony).
- **CF-CC-OWNER-1: core-service (TS/Node) is deliberately AWS-free** — `custody-factory.ts` returns
  `LocalAesGcmCustody`/`HeldProductionCustody`, never an AWS client. This is the boundary this slice
  must NOT break.

## The crux to rule (the whole reason this slice exists)

How does TS obtain the app secret from custody **without growing a Node AWS Secrets Manager client**
(which would contradict CF-CC-OWNER-1)?

## Out of scope / HELD for Stage 8

- Real injection wiring in the **live task role / task-def** (no deployed core-service container exists).
- The **rotated** `SHOPIFY_CLIENT_SECRET` value provisioned into Secrets Manager (compromised value —
  rotation is the grandparent's HELD ceremony). Never printed in any artifact.

## Dependency

- The rotated `SHOPIFY_CLIENT_SECRET` + the SM secret `brain/_app/shopify/hmac_secret` are provided by
  the parent/grandparent slices (HELD for Stage-8 provisioning). This slice's BUILD does not block on
  them (env-injection keeps TS unchanged at runtime); only the **live cutover** does.

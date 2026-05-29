# Requirement Stub — chore-app-hmac-secret-custody

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **CF-ref** | `CF-CC-SHOPIFY-HMAC-1` |
| **Status** | DRAFT — separate tracked follow-up (NOT folded into feat-credential-custody-aws-sm) |
| **Filed by** | Maya (Stage 3, Track C, 2026-05-29) |
| **Parent** | `feat-credential-custody-aws-sm` ruling §17 Track C |

---

## Problem

`SHOPIFY_CLIENT_SECRET` (config key `shopify.app_hmac_secret`, referenced in
`custody.py` line-note) is a Shopify Partner-app HMAC secret. It is:

- **App-level, not per-workspace** — there is no `workspace_id` associated with it.
- **Consumed by the TS webhook verifier** — before any inbound Shopify webhook is
  dispatched, the TS `core-service` verifies the HMAC signature using this secret.
- **Consumed BEFORE any workspace context is available** — the webhook arrives before
  workspace routing, so the per-workspace `CredentialCustody` primitive (Option A)
  cannot be used.

This is a fundamentally different shape from the per-workspace connector credentials.
Folding it into the `AwsSecretsManagerCustody` per-workspace model would be
architecturally incorrect.

## Proposed clean home

- **Secret path:** `brain/_app/shopify/hmac_secret` in AWS Secrets Manager (ap-south-1),
  OR a dedicated environment variable with a clear custody model.
- **Runtime owner:** TS `core-service` webhook verifier.
- **No `workspace_id` path component** — it is a singleton app-level secret.

## Scope of THIS stub

This stub is a parking ticket only. It does NOT:
- Design the custody model for the HMAC secret.
- Implement the TS consumer change.
- Define rotation policy.

Those are Stage-2 decisions for the follow-up feature intake.

## Do not fold

Per `CF-CC-SHOPIFY-HMAC-1` and the architecture ruling: this requirement must NOT be
folded into the per-workspace `feat-credential-custody-aws-sm` build. It is a separate
requirement with a separate intake.

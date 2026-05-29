# Requirement — feat-credential-custody-aws-sm

| Field | Value |
|-------|-------|
| **req_id** | `feat-credential-custody-aws-sm` |
| **Title** | Real AWS Secrets Manager credential custody (Option A) — replace the `NotImplementedError` stubs with a production custody backing |
| **Parent epic** | `chore-security-governance-hardening-phase` (WS-1) — this is the activation of that deferred phase |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-29T16:00:00Z |
| **Branch** | `chore/intake-feat-credential-custody-aws-sm` (off development) |

## Founder decision on record (DO NOT re-litigate)

`CF-C3-SECRETS-INTERIM-1` = **Option A — AWS Secrets Manager (ap-south-1)**, decided 2026-05-29
(decision-log `.engineering-os/decision-log/2026/05/2026-05-29.jsonl`; supersedes the 2026-05-25
interim "LOCAL .env for now" decision). This build makes Option A real and is the path to
satisfying `CF-C7-CUSTODY-PROOF-1`.

## Problem statement

The connector-cutover (`feat-connector-framework-cutover`, Child 3) shipped a `CredentialCustody`
Protocol with TWO backings — `aws_secrets_manager_custody.py` (Option A) and
`supabase_column_custody.py` (Option B) — both as `NotImplementedError` stubs, plus a TS mirror
(`HeldProductionCustody`). The FIRED escalation `CF-C7-CUSTODY-PROOF-1` blocks the per-connector
legacy-plaintext-DELETE point-of-no-return until `seal()`/`get()` are a REAL (non-NotImplementedError)
implementation, a Brain call via the PRODUCTION custody path returns a vendor 200, and parity is GREEN
— all signed per-connector before any DELETE, Shiprocket last (no replay).

A Founder Option-A/B choice "as a config swap" was always impossible between two stubs. The Founder
has now chosen Option A. This requirement builds the real backing so the gate becomes satisfiable.

## Target user / success metric

- **User:** the connector-cutover Stage-8 ceremony (Founder/Jatin-at-console) + ingestion-service runtime.
- **Success metric:** `AwsSecretsManagerCustody.get/put/seal` (and the TS production path, if in scope)
  are a real boto3-backed implementation, proven by **mocked-boto3 (`moto`) tests** for the happy path,
  the not-found path, the residency (ap-south-1) assertion, and the 7-day-recovery-window `seal`; the
  factory selection is **activation-gated** (opt-in env flag; local-dev stays `local-aesgcm`/`local`);
  ZERO real AWS calls in CI or local. `CF-C7-CUSTODY-PROOF-1`'s "real seal()/get() non-NotImplementedError"
  leg becomes satisfiable. The remaining legs (vendor-200 over the prod path + parity GREEN) stay HELD
  for the Stage-8 ceremony against real AWS.

## Code reality (verified at intake)

- `apps/ingestion-service/src/infrastructure/secrets/aws_secrets_manager_custody.py` — `get/put/seal`
  are `NotImplementedError` stubs; secret-name shape `brain/{workspace_id}/{vendor}/credential`; IAM
  policy sketched in comments (`GetSecretValue` on `arn:aws:secretsmanager:ap-south-1:*:secret:brain/*`);
  boto3 deliberately NOT imported in the stub. `assert isinstance(..., CredentialCustody)` at module load.
- `apps/ingestion-service/src/infrastructure/secrets/supabase_column_custody.py` — the rejected Option B stub.
- `apps/ingestion-service/src/infrastructure/secrets/custody.py` — `CredentialCustody` Protocol (get/put/seal);
  also names the **app-level Shopify HMAC secret** (`SHOPIFY_CLIENT_SECRET`, config key `shopify.app_hmac_secret`)
  as a separate custody line under whichever option.
- **No Python factory/selector exists yet** — the Python side has the two stubs + Protocol but no env-driven
  backing selection. The TS side DOES: `apps/core-service/src/infrastructure/secrets/custody-factory.ts`
  (`CONNECTOR_CUSTODY_BACKING`: `local-aesgcm` default → real `LocalAesGcmCustody`; anything else →
  `HeldProductionCustody` → throws). `local-aesgcm-custody.ts` is a REAL AES-256-GCM backing
  (the template the production `seal()` must satisfy).
- `boto3`/`moto` are NOT yet dependencies of `apps/ingestion-service`.

## What stays HELD (Founder / Jatin-at-console — out of scope for this build)

- Real AWS Secrets Manager provisioning in ap-south-1; IAM role/policy creation; the AWS account + credentials.
- Rotating the LIVE connector tokens into Secrets Manager (real put against real AWS, real cost).
- The legacy-plaintext DELETE PoNR (still gated on the full `CF-C7-CUSTODY-PROOF-1` including vendor-200 + parity).

This build ships **code + IaC (CDK) + mocked-boto3 tests** only. NO real AWS calls, NO live rotation,
NO commit without the Founder's free-text "commit it".

## Dependencies

- `feat-connector-framework-cutover` (Child 3) — shipped the custody Protocol + stubs this replaces.
  Status: awaiting-founder-commit / Stage-8 readiness behind named holds.
- `chore-security-governance-hardening-phase` (WS-1) — this requirement IS its activation.
- Unblocks: `CF-C7-CUSTODY-PROOF-1` → the per-connector legacy-plaintext-DELETE PoNR.

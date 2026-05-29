# pending-founder-commit.md — chore-app-hmac-secret-custody (CDK Track T3)

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **Track** | T3 — CDK IAM/secret delta (Jatin, platform-devops) |
| **Status** | AUTHORED, NOT DEPLOYED. `cdk synth` PASS. Assertions tests 35/35 PASS. |
| **Timestamp** | 2026-05-29T18:00:00Z |

---

## Explicit file paths staged for Founder commit

```
infra/cdk/lib/credential-custody-stack.ts
infra/cdk/test/credential-custody-stack.test.ts
```

No other files were modified by Track T3.

---

## What changed

### `infra/cdk/lib/credential-custody-stack.ts`

- Added `public readonly appShopifyHmacSecret: secretsmanager.Secret` (field declaration + construct instantiation).
- Construct id: `AppShopifyHmacSecret`; secret name: `brain/_app/shopify/hmac_secret`.
- `encryptionKey: this.credentialCmk` — reuses the EXISTING `CredentialCustodyCmk`, no new key.
- `removalPolicy: cdk.RemovalPolicy.RETAIN`.
- No `SecretString` / no real value (authored-not-deployed posture, CF-CC-NO-LIVE-1).
- Doc comment block: IAM-not-widened proof + auto-rotation FORBIDDEN note (CF-HMAC-ROTATION-MANUAL-1).
- Added `AppShopifyHmacSecretArn` CfnOutput (consistent with stack output pattern).
- **Zero changes to `SECRETSMANAGER_ACTIONS`, `KMS_ACTIONS`, or the IAM ManagedPolicy.**

### `infra/cdk/test/credential-custody-stack.test.ts`

- Updated SM resource count assertion: 1 → 2 (posture sentinel + app-level singleton).
- Added `describe` block: "App-level singleton secret (CF-HMAC-RESIDENCY-1, T3)" — 8 tests:
  - name prefixed with `brain/_app/`
  - exact name `brain/_app/shopify/hmac_secret`
  - CMK-encrypted (not aws/secretsmanager default)
  - same CMK (no new key, still 1 `AWS::KMS::Key`)
  - all secrets have DeletionPolicy Retain
  - description contains `FORBIDDEN` (rotation guard)
  - `appShopifyHmacSecret` construct accessible on stack
  - `AppShopifyHmacSecretArn` output emitted
- Added `describe` block: "IAM NOT widened by T3 (CF-CC-IAM-LEASTPRIV-1 regression)" — 5 tests:
  - still exactly 1 ManagedPolicy
  - still exactly 2 IAM statements
  - SM `brain/*` resource prefix-covers `brain/_app/shopify/hmac_secret` (mechanically verified)
  - NEGATIVE: no `*` resource widening
  - NEGATIVE: SM action set still exactly 6 actions (not expanded)

---

## Verification results (REAL output)

### `npm test` (35/35 PASS)

```
Tests:       35 passed, 35 total
Test Suites: 1 passed, 1 total
Time:        1.826 s
```

All pre-existing tests still PASS. No regressions.

### `cdk synth` (PASS, clean)

New resource in synthesized template:
```yaml
AppShopifyHmacSecret8772AA04:
  Type: AWS::SecretsManager::Secret
  Properties:
    Name: brain/_app/shopify/hmac_secret
    KmsKeyId:
      Fn::GetAtt: [CredentialCustodyCmk0D701516, Arn]
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
```

IAM ManagedPolicy (UNCHANGED — IAM-not-widened proof):
```yaml
BrainSecretsManagerCustody:
  Resource: arn:aws:secretsmanager:ap-south-1:*:secret:brain/*
  Action: [6 enumerated SM actions, unchanged]
BrainCustodyCmkAccess:
  Resource: Fn::GetAtt: [CredentialCustodyCmk0D701516, Arn]
  Action: [kms:Decrypt, kms:GenerateDataKey, unchanged]
```

Still exactly 1 `AWS::KMS::Key`, 1 `AWS::IAM::ManagedPolicy`, 2 IAM statements.

---

## CF gates cleared (CDK track)

| CF | Status |
|----|--------|
| CF-HMAC-RESIDENCY-1 | PASS — CMK-encrypted (`Fn::GetAtt` to `CredentialCustodyCmk`), ap-south-1, `DeletionPolicy: Retain`. |
| CF-CC-IAM-LEASTPRIV-1 | PASS — no widening; regression asserted (5 tests). SM resource still `brain/*`; actions still 6; statements still 2. |
| CF-CC-NO-LIVE-1 | PASS — no `SecretString`; authored-not-deployed. No `cdk deploy` was run. |
| CF-HMAC-ROTATION-MANUAL-1 | PASS — no rotation schedule on the construct; description + doc comment flag FORBIDDEN. |

---

## Proposed commit message (for Founder to use)

```
feat(cdk): add app-level Shopify HMAC singleton secret to CredentialCustodyStack

Track T3 (chore-app-hmac-secret-custody): adds the representative
brain/_app/shopify/hmac_secret resource (CMK-encrypted, RemovalPolicy.RETAIN,
no real SecretString — authored-not-deployed). Reuses existing CredentialCustodyCmk
and existing IAM brain/* scope (no widening). Extends assertions test to 35 tests
including IAM-not-widened regression block. cdk synth + npm test both PASS.

CF-HMAC-RESIDENCY-1 / CF-CC-IAM-LEASTPRIV-1 / CF-CC-NO-LIVE-1 / CF-HMAC-ROTATION-MANUAL-1.
```

---

## HELD for Stage-8 console (NOT this commit)

- Real Secrets Manager provisioning of `brain/_app/shopify/hmac_secret`
- Put + rotate the live `shpss_…` value (compromised-by-exposure)
- IAM role attachment to the ingestion-service task role
- Festival-safe window selection
- No `cdk deploy` without explicit Founder authorization

---

## Python track files (Maya; completed by orchestrator post-500) — add to the commit

- `apps/ingestion-service/src/infrastructure/secrets/app_secret_provider.py` (NEW)
- `apps/ingestion-service/src/infrastructure/secrets/app_secret_factory.py` (NEW)
- `apps/ingestion-service/tests/unit/test_app_secret_provider.py` (NEW)

263 passed / 14 skipped. NEVERLOG botocore-DEBUG defense-in-depth + CF-HMAC-VERIFY-THE-VERIFIER-1 (3-case + 2 mutations, both proven RED-and-reverted) included. No commit until Founder "commit it".

---

## Stage-6 sign-off (Rohan, 2026-05-29T18:45:00Z) — APPROVED, commit authorized on Founder "commit it"

Final review PASS (`11-final-review.md`). Both CRITICAL gates re-mutated by Rohan on disk (RED / byte-identical revert / GREEN). 11/11 CFs MET. 0 CRITICAL/HIGH at S4/S5/S6. Over-engineering audit PASS. Hard-rule scan clean.

### Mechanical commit command (explicit product-code paths — NO `git add -A`)

> Branch: a fresh feature branch off `development` (e.g. `feat/chore-app-hmac-secret-custody`). Do NOT push to development/release/master. No `cdk deploy`.

```sh
git add \
  apps/ingestion-service/src/infrastructure/secrets/app_secret_provider.py \
  apps/ingestion-service/src/infrastructure/secrets/app_secret_factory.py \
  apps/ingestion-service/tests/unit/test_app_secret_provider.py \
  infra/cdk/lib/credential-custody-stack.ts \
  infra/cdk/test/credential-custody-stack.test.ts

git commit -m "feat(ingestion,cdk): app-level Shopify HMAC secret custody seam (chore-app-hmac-secret-custody)

App-level singleton secret provider (AppSecretsManagerProvider + factory + dev/held
fallbacks) feeding the UNCHANGED verify_shopify_hmac() — fail-closed, ap-south-1
residency-asserted, ids-only never-log (botocore-DEBUG suppression), boot/cached (<=1 SM
call). Verify-the-verifier kill-test + 2 mutation tests (compare_digest, fail-closed),
both proven non-vacuous at S4/S5/S6. CDK adds the representative brain/_app/shopify/hmac_secret
(CMK-encrypted, RETAIN, no real value, authored-not-deployed) with IAM-not-widened proof.
TS OAuth (C1/C2) stays env-injected; follow-on chore-ts-oauth-app-secret-custody named.
Seam only — inbound-webhook ingress route + live provisioning HELD for Stage-8.

263 passed/14 skipped (Python) + 35 passed (CDK). @paradigm sql, Rs0/mo.
CF-HMAC-FAILCLOSED-1/VERIFY-THE-VERIFIER-1/RETRIEVAL-SHAPE-1/TS-VS-PY-OWNER-1/
SINGLE-PRIMITIVE-1/ALGO-DISTINCT-1/CONSTTIME-1/HOTPATH-CACHE-1/ROTATION-MANUAL-1/
RESIDENCY-1/NEVERLOG-1/EXPOSED-VALUE-ROTATE-1.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**5 product files only.** EOS bookkeeping (run folder, journals, decision-log, state, pending-* docs) is a separate housekeeping commit at Founder discretion. `apps/api-gateway/.env` deliberately UNTOUCHED (its `shpss_…` is rotated at the Stage-8 ceremony, not in this commit). `apps/web/next-env.d.ts` is unrelated noise — do NOT include.

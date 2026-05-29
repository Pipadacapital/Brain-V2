# Pending Founder Commit — feat-credential-custody-aws-sm

> Files awaiting Founder `git commit` (CF-CC-NO-LIVE-1; Jatin stages, Founder commits).

## Track B — CDK stack (authored, NOT deployed)

Status: **STAGED FOR FOUNDER COMMIT — no git add or git commit run by Jatin**

### Files to stage (explicit paths — no `-A` / `.`)

```
infra/cdk/bin/app.ts
infra/cdk/lib/credential-custody-stack.ts
infra/cdk/test/credential-custody-stack.test.ts
infra/cdk/package.json
infra/cdk/package-lock.json
infra/cdk/tsconfig.json
infra/cdk/cdk.json
infra/cdk/jest.config.js
infra/cdk/README.md
infra/cdk/.gitignore
```

### Proposed commit message (Track B)

```
feat(infra/cdk): author CredentialCustodyStack — KMS CMK + Secrets Manager posture + least-priv IAM

First CDK app in repo (infra/cdk/). Synthesizes a CredentialCustodyStack with:
- Customer-managed KMS CMK in ap-south-1, rotation enabled (CF-CC-RESIDENCY-1)
- Secrets Manager encrypted with the CMK; brain/* namespace (CF-CC-RESIDENCY-1)
- Least-privilege IAM managed policy: exactly Get/Create/Put/Describe/Delete/Tag
  on secret:brain/* + Decrypt/GenerateDataKey on the CMK ARN only; no "*" resource
  (CF-CC-IAM-LEASTPRIV-1)
- Constructor-time residency guard: throws at synth if region != ap-south-1
- 22/22 assertions tests pass; cdk synth passes; ZERO real AWS calls (CF-CC-NO-LIVE-1)

AUTHORED NOT DEPLOYED. Provisioning is the HELD Stage-8 Founder/Jatin-at-console
ceremony. DO NOT cdk deploy without Founder authorization.
```

### Integrity gates (Track B)

| Gate | Result |
|------|--------|
| `cdk synth --no-version-reporting` | PASS |
| `npx jest --passWithNoTests` (22 tests) | PASS (22/22) |
| ZERO real AWS calls | CONFIRMED (synth + jest are pure local operations) |
| `cdk deploy` NOT run | CONFIRMED |
| `git commit` NOT run by Jatin | CONFIRMED |

### Reversibility recipe

This entire track is reversible by deleting `infra/cdk/` and reverting this commit.
No runtime dependency on the CDK stack exists until the Stage-8 ceremony provisions real AWS resources.
The Python ingestion-service (Track A) uses the CDK stack only when the Founder explicitly deploys it
and rotates the env flag to `aws-secrets-manager` — neither has happened.

---

## Track A + C — Python custody (Maya — 2026-05-29T18:30:00Z)

Status: **STAGED FOR FOUNDER COMMIT — git add run, NO git commit**

### Files staged (exact paths)

```
apps/ingestion-service/src/infrastructure/secrets/held_custody.py           (NEW)
apps/ingestion-service/src/infrastructure/secrets/custody_factory.py        (NEW)
apps/ingestion-service/src/infrastructure/secrets/aws_secrets_manager_custody.py  (MODIFIED)
apps/ingestion-service/src/infrastructure/secrets/custody.py                (MODIFIED — HMAC note)
apps/ingestion-service/tests/unit/test_aws_secrets_manager_custody.py       (NEW)
apps/ingestion-service/tests/unit/test_custody_stubs.py                     (MODIFIED)
apps/ingestion-service/pyproject.toml                                        (MODIFIED — boto3 + moto)
uv.lock                                                                      (MODIFIED — new deps locked)
.engineering-os/requirements-draft/chore-app-hmac-secret-custody.md         (NEW — Track C)
```

### Proposed commit message (Track A + C)

```
feat(ingestion-service): real boto3 AwsSecretsManagerCustody + fail-closed factory (CF-C7-CUSTODY-PROOF-1)

Satisfies CF-C7-CUSTODY-PROOF-1 real-get/seal leg. Zero real AWS calls (moto only).

- held_custody.py: HeldProductionCustody fail-closed default; DPDP erasure path docs (CF-CC-ERASURE-PATH-1)
- custody_factory.py: mirrors custody-factory.ts; unknown/unset → held, never AWS (CF-CC-GATE-1)
- aws_secrets_manager_custody.py: real boto3 get/put/seal; lazy _client() (CF-CC-LAZY-1);
  ap-south-1 residency assert (CF-CC-RESIDENCY-1); _secret_name input validation (CF-CC-WS-ISOLATION-1);
  RecoveryWindowInDays=7 seal, ForceDeleteWithoutRecovery forbidden (CF-CC-SEAL-RECOVERY-1);
  ids-only logs/errors (CF-CC-NEVERLOG-1)
- 45/45 tests pass: moto @mock_aws matrix, 3 gate-mutation tests, residency, factory matrix, never-log
- Shopify HMAC follow-up stub filed (CF-CC-SHOPIFY-HMAC-1)
- boto3 1.43.17 + moto 5.2.1 added to pyproject.toml + uv.lock

HELD (Stage-8 Founder ceremony, CF-CC-NO-LIVE-1): real AWS provisioning, live rotation,
CDK deploy, legacy-plaintext DELETE.
```

### Integrity gates (Track A + C)

| Gate | Result |
|------|--------|
| `uv run pytest apps/ingestion-service/tests/ -q` | 226 passed, 14 skipped |
| 45 new tests (moto + gate-mutation + residency + factory) | PASS |
| 3 gate-mutation tests (CF-CC-NOREAL-AWS-1) | PASS |
| `@paradigm ml/small_llm/frontier_llm` anywhere | NONE — sql only |
| ForceDeleteWithoutRecovery in aws_secrets_manager_custody.py | ABSENT (grep confirmed) |
| Real AWS call during test run | ZERO (moto BotocoreStubber intercepts all) |
| `git commit` run by Maya | NONE |

---

## Stage-6 augmentation — Rohan (CTO Advisor), 2026-05-29 — APPROVED, ready for Founder "commit it"

**Stage-6 verdict: PASS → APPROVE (delegated gate).** Verify-the-verifier re-mutation done on disk (3 gates RED→reverted clean); over-engineering audit PASS; @paradigm sql; ₹0/mo recurring.

### CRITICAL staging note — re-stage the working-tree fixes FIRST

`git status` shows `MM`/`AM` on two files: the **BOUNCE-1 test fix and the LOW-2 doc fix live in the working tree on top of a stale index.** A commit of the *staged* tree would commit the PRE-FIX test + stale doc pointer. Re-`git add` these two so the committed tree == the reviewed tree:

```
git add apps/ingestion-service/tests/unit/test_aws_secrets_manager_custody.py \
        apps/ingestion-service/src/infrastructure/secrets/custody.py
```

### Mechanical commit command for the Founder (explicit product paths — NO `git add -A`)

```
git add \
  apps/ingestion-service/src/infrastructure/secrets/held_custody.py \
  apps/ingestion-service/src/infrastructure/secrets/custody_factory.py \
  apps/ingestion-service/src/infrastructure/secrets/aws_secrets_manager_custody.py \
  apps/ingestion-service/src/infrastructure/secrets/custody.py \
  apps/ingestion-service/tests/unit/test_aws_secrets_manager_custody.py \
  apps/ingestion-service/tests/unit/test_custody_stubs.py \
  apps/ingestion-service/pyproject.toml \
  uv.lock \
  .engineering-os/requirements-draft/chore-app-hmac-secret-custody.md \
  infra/cdk/bin/app.ts \
  infra/cdk/lib/credential-custody-stack.ts \
  infra/cdk/test/credential-custody-stack.test.ts \
  infra/cdk/package.json \
  infra/cdk/package-lock.json \
  infra/cdk/tsconfig.json \
  infra/cdk/cdk.json \
  infra/cdk/jest.config.js \
  infra/cdk/README.md \
  infra/cdk/.gitignore
```

(Track A+C and Track B may be committed as the two messages already drafted above, or as one combined commit — Founder's choice. Feature-branch only; do NOT push to development/release/master.)

### Gate at commit time
- [x] Stage-6 PASS / delegated APPROVE
- [x] Working-tree fixes re-staged (BOUNCE-1 + LOW-2)
- [x] ZERO real AWS, no `cdk deploy`, no live rotation, no DELETE
- [ ] Founder free-text "commit it" — REQUIRED before any `git commit`

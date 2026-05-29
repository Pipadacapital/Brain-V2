# Feature Journal — feat-credential-custody-aws-sm

> Real AWS Secrets Manager credential custody (Option A). Activates WS-1 (chore-security-governance-hardening-phase).
> Founder decision on record (do-not-relitigate): CF-C3-SECRETS-INTERIM-1 = Option A, AWS Secrets Manager ap-south-1 (2026-05-29).
> Unblocks CF-C7-CUSTODY-PROOF-1 (real seal()/get() leg) → the per-connector legacy-plaintext-DELETE PoNR (Shiprocket last).

## Stage 1 — Rohan (cto-advisor) — 2026-05-29T16:00:00Z — ADVANCE
- **Lane:** high-stakes (auth/secrets, multi-tenancy, pii, india-compliance, connectors).
- **Paradigm:** sql (infra; ₹0; zero inference). Maya co-own: NO.
- **Personas (2, both :sonnet, both accepted):** aws-secrets-least-privilege-realist (activation-gating fail-closed, lazy boto3, recovery-window seal, mocked-vs-real false-GREEN) + dpdp-residency-custody-compliance-officer (ap-south-1 secret+CMK, workspace isolation, DPDP erasure, Shopify HMAC line). 10 concerns folded.
- **Scope IS:** real boto3 AwsSecretsManagerCustody (Python ingestion-service) behind an activation-gated factory + CDK (TS, authored-not-deployed) + moto mocked-boto3 tests; ap-south-1 + CMK; least-priv IAM; 7-day-recovery seal; never-log.
- **Scope IS NOT (HELD Stage-8 ceremony):** real AWS provisioning, IAM role creation, account/creds, live token rotation, legacy-plaintext DELETE, CF-C7 vendor-200/parity legs.
- **Boundary rulings:** Q1 Python-only backing (CF-CC-OWNER-1); Q2 fail-closed gating + lazy boto3 (CF-CC-GATE-1/LAZY-1); Q3 Shopify HMAC = separate tracked follow-up (CF-CC-SHOPIFY-HMAC-1).
- **CF contract:** 13 (CF-CC-OWNER-1, GATE-1, LAZY-1, NOREAL-AWS-1, IAM-LEASTPRIV-1, SEAL-RECOVERY-1, RESIDENCY-1, WS-ISOLATION-1, NEVERLOG-1, ERASURE-PATH-1, SHOPIFY-HMAC-1, C7-LEG-1, NO-LIVE-1).
- **Escalation:** none fired; one non-blocking Founder readiness item (Stage-8 AWS account/ap-south-1/CMK/creds provisioning) mirrored to pending-founder-attention.md.
- **Next:** Architect (Aryan) Stage 2 — binding plan per run-folder 05-stage1-synthesis.md.

## Stage 3 Track A + C — Maya (intelligence-engineer) — 2026-05-29T18:30:00Z — COMPLETE

**Stage:** 3
**Track:** A (Python custody backing + factory + moto matrix) + C (rulings + docs)
**Action:** Replace 3 NotImplementedError stubs with real boto3; add fail-closed factory and held default; full moto test matrix + 3 gate-mutation tests; Shopify HMAC follow-up filed; DPDP erasure path documented.
**Skills loaded:** python-services, integration-connectors, oauth-implementation, engineering-discipline, verification-before-completion, prompt-injection-defense (input validation)
**Paradigm:** sql — infra/deterministic, zero LLM, zero ML; ₹0 inference. No @paradigm ml/small_llm/frontier_llm anywhere.
**Prompt caching:** N/A (no LLM calls)
**Daily-tick simulation:** N/A (no analytics path)

**Files touched:**
- `apps/ingestion-service/pyproject.toml` — added `boto3>=1.38.0` (runtime dep), `moto[secretsmanager]>=5.1.0` (dev dep). Resolved: boto3 1.43.17, moto 5.2.1.
- `apps/ingestion-service/src/infrastructure/secrets/held_custody.py` (NEW) — HeldProductionCustody analogue; raises HeldCustodyError on every method; DPDP erasure path docstring; zero AWS calls.
- `apps/ingestion-service/src/infrastructure/secrets/custody_factory.py` (NEW) — mirrors custody-factory.ts; unset/empty/local → HeldProductionCustody; 'aws-secrets-manager' → AwsSecretsManagerCustody; UNKNOWN → HeldProductionCustody (CF-CC-GATE-1); lazy import (CF-CC-LAZY-1).
- `apps/ingestion-service/src/infrastructure/secrets/aws_secrets_manager_custody.py` (replaced 3 stubs) — real boto3 get/put/seal; lazy _client(); ap-south-1 residency assert; _secret_name validation; never-log discipline; seal RecoveryWindowInDays=7 / ForceDeleteWithoutRecovery forbidden.
- `apps/ingestion-service/src/infrastructure/secrets/custody.py` (modified) — added CF-CC-SHOPIFY-HMAC-1 follow-up pointer note.
- `apps/ingestion-service/tests/unit/test_aws_secrets_manager_custody.py` (NEW) — 45 tests: protocol, validate_id matrix, factory selection matrix, held custody, moto @mock_aws integration matrix (10 tests), residency assert, 3 gate-mutation tests.
- `apps/ingestion-service/tests/unit/test_custody_stubs.py` (updated) — removed now-invalid AWS stub tests (those tested NotImplementedError which is gone); kept SupabaseColumnCustody (still stubbed) + new HeldProductionCustody basic tests; redirects to new test file.
- `.engineering-os/requirements-draft/chore-app-hmac-secret-custody.md` (NEW) — Shopify HMAC follow-up stub (CF-CC-SHOPIFY-HMAC-1 / Track C).
- `uv.lock` (updated) — boto3 1.43.17 + moto 5.2.1 + transitive deps locked.

**Verification:**
- Command: `uv run pytest apps/ingestion-service/tests/ -q`
- Output: 226 passed, 14 skipped (14 skips = pre-existing live Postgres/Kafka integration tests; not new regressions)
- New tests: 45 passed, 0 failed (test_aws_secrets_manager_custody.py) + 11 passed (test_custody_stubs.py)
- Gate mutation tests: all 3 PASS (test_1_import_time_zero_aws_call, test_2_fail_closed_default_no_aws_call, test_3_wrong_region_kill)
- Zero real AWS calls confirmed: all moto tests intercepted by BotocoreStubber (no network)

**Handoff signal:** READY-FOR-SECURITY (Shreya VETO @ Stage 4 parallel with Tanvi QA @ Stage 5)

## Stage 3 Track B — Jatin (platform-devops) — 2026-05-29T00:00:00Z — COMPLETE
- **Track:** B (CDK stack — parallel with Track A / Maya).
- **Scope:** Minimal first CDK app in repo at `infra/cdk/`. Single stack `CredentialCustodyStack`.
- **CMK:** `AWS::KMS::Key` in ap-south-1, `EnableKeyRotation: true`, `DeletionPolicy: Retain`, 30-day pending window, alias `brain/credential-custody` (CF-CC-RESIDENCY-1).
- **Secrets Manager:** `AWS::SecretsManager::Secret` encrypted with the CMK (not the default AWS-managed key), name `brain/custody-posture` (IaC posture sentinel; no real SecretString), `DeletionPolicy: Retain`. (CF-CC-RESIDENCY-1)
- **IAM managed policy:** `brain-ingestion-credential-custody` — two statements. SM statement: exactly `GetSecretValue, CreateSecret, PutSecretValue, DescribeSecret, DeleteSecret, TagResource` on `arn:aws:secretsmanager:ap-south-1:*:secret:brain/*` (no `*` resource, no wildcard action). KMS statement: exactly `Decrypt, GenerateDataKey` on the CMK ARN only (no `*`). (CF-CC-IAM-LEASTPRIV-1)
- **Residency guard:** constructor throws at synth time if `this.region != "ap-south-1"` (CF-CC-RESIDENCY-1).
- **Tests:** 22/22 pass (`aws-cdk-lib/assertions` — CMK exists + rotation + alias, secret CMK-encrypted, IAM exact action set, no `*` resource, no wildcard action, exactly 2 statements, no ForceDeleteWithoutRecovery wildcard, wrong-region throw, outputs present).
- **cdk synth:** PASS (no real AWS creds; ZERO AWS calls).
- **NOT deployed:** CF-CC-NO-LIVE-1 — authored only. No `cdk deploy`, no commit.
- **pnpm-workspace.yaml:** `infra/cdk` NOT added — it uses a standalone `package.json` + npm lockfile (enumerated-members rule; adding it would require explicit listing, which is fine, but the plan notes "else keep it a standalone npm project with its own lockfile" — chosen here to avoid touching the pnpm workspace boundary).
- **Files created:** `infra/cdk/bin/app.ts`, `infra/cdk/lib/credential-custody-stack.ts`, `infra/cdk/test/credential-custody-stack.test.ts`, `infra/cdk/package.json`, `infra/cdk/tsconfig.json`, `infra/cdk/cdk.json`, `infra/cdk/jest.config.js`, `infra/cdk/README.md`.
- **Next:** Track A (Maya) to complete; then Stage 4 Shreya VETO review.

## 2026-05-29 — Shreya (security-reviewer) — feat-credential-custody-aws-sm
**Stage:** 4 (VETO gate G4)
**Action:** Security review PASS
**Findings (CRITICAL):** 0
**Findings (HIGH):** 0
**Findings (MED):** 0
**Findings (LOW):** 2 — (1) `uv sync` hatchling wheel-build config gap (tests pass with `--no-sync`); (2) stale HMAC follow-up path in `custody.py:30` (requirements/ vs requirements-draft/). Both tech debt, non-blocking.
**Compliance gates (DPDP/PDPL/DLT/NCPR/calling-hours/recording-consent):** DPDP residency (ap-south-1 Python+CDK) + erasure path PASS; telecom/WhatsApp/AI-voice/recording N/A (no outbound surface).
**Traceability:** PASS — N/A as endpoint/consumer/LLM (internal AWS adapter); caller workspace-scoped upstream at ingest.py:418; ids-only structured logs carry (workspace_id, vendor, secret_name, op, outcome).
**Re-mutation (durable rule, performed by me):** fail-closed-default mutation → 2 tests FAILED; residency mutation → 2 tests FAILED. Both real negative controls; tree reverted clean.
**Verification:** Python 56 passed (--no-sync); CDK 22 passed; legacy guard 0; grep NEVERLOG + IAM-wildcard clean; boto3 1.43.17 / moto 5.2.1 pinned.
**NEVERLOG-1 judgment:** our-logger scoping is honest+correct; botocore DEBUG wire-trace is a Stage-8 ceremony logging-config precondition (loggers not at DEBUG on live activation), flagged for Rohan S6 + runbook — not a Stage-4 blocker (no real AWS this build).
**Bounced to:** NONE
**Rationale:** All 14 ACs/CFs PASS; IAM least-priv + NEVERLOG (my VETO surfaces) verified with file:line + grep + re-mutation; zero CRITICAL/HIGH/compliance/traceability findings.

## 2026-05-29T00:00:00Z — Tanvi (qa-agent) — Stage-5 BOUNCE (original)
**Stage:** 5
**Action:** QA FAIL — BOUNCE to Maya (backend-developer)
**Test runs:** 226 unit / 14 skipped / 22 CDK assertions
**Real-network smoke:** HELD-Stage-8 (declared, not faked)
**Metric registry parity (TS↔Python):** N/A (no new metrics)
**Trace IDs end-to-end:** N/A (paradigm sql, no gRPC/Kafka/LLM surface)
**Operational-readiness:** PASS
**Mutation tests on high-stakes:** FAIL — gate test #2 vacuous against mutation 2 (`case _:` branch)
**Coverage:** all 45 new tests pass
**Bounced to:** Maya (backend-developer)
**Findings:** 1 must-fix-now (BOUNCE-1: test_2_fail_closed_default_no_aws_call exercises only case None branch, not case _: — gate test and mutation target do not intersect)

## 2026-05-29T00:00:01Z — Tanvi (qa-agent) — Stage-5 RE-VERIFY
**Stage:** 5
**Action:** QA PASS
**Test runs:** 226 unit / 14 skipped (baseline + post-revert both confirmed)
**Real-network smoke:** HELD-Stage-8 (declared, not faked; no fake output)
**Metric registry parity (TS↔Python):** N/A (no new metrics; paradigm sql)
**Trace IDs end-to-end:** N/A (paradigm sql; no gRPC/Kafka/LLM surface in scope)
**Operational-readiness:** PASS (boto3 + moto importable; env vars documented)
**Mutation tests on high-stakes (BOTH branches re-mutated independently):**
  - Re-mutation A: `case None | "" | "local":` (line 71) → AwsSecretsManagerCustody() — test_2 RED (assertion i: Got AwsSecretsManagerCustody, expected HeldProductionCustody). Reverted. git diff == 0.
  - Re-mutation B: `case _:` (line 99) → AwsSecretsManagerCustody() — test_2 RED (assertion ii: Got AwsSecretsManagerCustody, expected HeldProductionCustody). Reverted. git diff == 0.
  - Gate test #1 (import-time zero-call) and #3 (wrong-region kill): GREEN on live tree — previously verified non-vacuous per original QA; re-confirmed passing in isolation.
**Coverage:** 226 passed, 14 skipped; all 45 new custody tests pass; all 22 CDK assertions pass
**Bounced to:** NONE
**Findings:** 0 must-fix-now. LOW-1 (hatchling uv sync gap) and LOW-2 (custody.py:30 path pointer) remain carried-forward tech debt from Shreya S4 — non-blocking.

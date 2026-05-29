# Feature journal — feat-credential-custody-aws-sm

> Real AWS Secrets Manager credential custody (Option A) — replace the `NotImplementedError` stubs with a production custody backing. Parent epic: `chore-security-governance-hardening-phase` (WS-1). Unblocks `CF-C7-CUSTODY-PROOF-1` (real seal()/get() leg).

## Stage 1 — intake (Rohan / cto-advisor) — 2026-05-29T16:00:00Z
- ADVANCE. high-stakes. paradigm `sql` (ZERO LLM/ML). 2 personas (aws-secrets-least-privilege-realist:sonnet + dpdp-residency-custody-compliance-officer:sonnet), 10 concerns folded into the 13-CF contract (`05-stage1-synthesis.md §3`). No escalation; one non-blocking Founder readiness item (Stage-8 AWS account/ap-south-1/CMK/creds).
- Founder decision on record: Option A (AWS Secrets Manager, ap-south-1), `CF-C3-SECRETS-INTERIM-1`, 2026-05-29. Do-not-relitigate.

## Stage 2 — binding plan (Aryan / architect) — 2026-05-29T17:10:00Z
**Artifact:** `06-architecture-plan.md` (folded handoff — no separate 07; prescriptive depth).

**Architecture shape:**
- **Factory (NEW):** `apps/ingestion-service/src/infrastructure/secrets/custody_factory.py` mirroring `core-service/.../custody-factory.ts:21` — env `CONNECTOR_CUSTODY_BACKING`: unset/`''`/`local`→held(non-AWS), `aws-secrets-manager`→AWS opt-in, unknown→held. **FAIL-CLOSED, never AWS by default** (`CF-CC-GATE-1`).
- **Held default (NEW):** `held_custody.py` — Python `HeldProductionCustody`-analogue (mirrors `production-custody.ts:35`), raises clear `NotImplementedError` on use. NOT a new Python crypto backing (out of scope).
- **AWS backing (replace stub):** `aws_secrets_manager_custody.py` — real boto3. LAZY `_client()` (first-use only, `region_name="ap-south-1"` + refuse-to-start residency assert; NEVER in `__init__`/module scope) (`CF-CC-LAZY-1`/`CF-CC-RESIDENCY-1`). `get`→`KeyError` on `ResourceNotFoundException`; `put`→upsert; `seal`→`delete_secret(RecoveryWindowInDays=7)`, `ForceDeleteWithoutRecovery` FORBIDDEN (`CF-CC-SEAL-RECOVERY-1`); `_secret_name` input validation (`CF-CC-WS-ISOLATION-1`); ids-only never-log (`CF-CC-NEVERLOG-1`, Shreya VETO).
- **CDK (NEW, first CDK app in repo):** `infra/cdk/` `CredentialCustodyStack` (TS) — KMS CMK ap-south-1 + Secrets Manager CMK-encrypted region-pinned + least-priv IAM (Get/Create/Put/Describe/Delete + TagResource on `secret:brain/*` only, KMS on CMK only, no `*`/wildcard) (`CF-CC-IAM-LEASTPRIV-1`/`CF-CC-RESIDENCY-1`). **AUTHORED-NOT-DEPLOYED** — `cdk synth` + `aws-cdk-lib/assertions` test only (`CF-CC-NO-LIVE-1`).

**Test strategy:** `moto` `@mock_aws` matrix (real boto3 path, zero real AWS) + 3 verify-the-verifier mutations (import-time zero-call / fail-closed default / wrong-region kill, with `# MUTATION:` notes for Tanvi+Shreya) + CDK assertions template test. Real-network smoke = HELD Stage-8 (stated to prevent a Tanvi bounce on its absence).

**Builder split (Stage 3, PARALLEL):** Track A+C (Python) → @maya (backend-developer, owns ingestion-service per TECH/18 §3.3, critical path); Track B (CDK) → @jatin (platform-devops), parallel-safe.

**Rulings:**
- `CF-CC-SHOPIFY-HMAC-1`: SEPARATE tracked follow-up `chore-app-hmac-secret-custody` (under WS-1, `brain/_app/shopify/hmac_secret`, TS consumer). NOT folded into the per-workspace model, NOT dropped.
- `CF-CC-ERASURE-PATH-1`: documented — workspace erasure = `seal()` across the workspace's vendors; 7-day recovery window = bounded retention tail. No new bulk API.

**New deps (declared):** `boto3` (runtime), `moto` (test-only dev), `aws-cdk-lib`+`constructs` (CDK). All "resolve+pin latest-stable" — no invented versions.

**Acceptance contract:** 14 rows (`§17b`), each CF ↔ verifiable artifact ↔ S4/S5/S6 bounce condition. Over-engineering self-check PASS 7/7.

**Open questions for Founder:** NONE blocking. Non-blocking Stage-8 readiness item already mirrored.

**HELD for Stage-8:** real AWS provisioning/calls/rotation/DELETE; CF-C7 vendor-200 + parity legs + plaintext-DELETE PoNR. No commit without Founder "commit it".

**Next:** Stage 3 — @maya (backend-developer) + @jatin (platform-devops) in parallel.

---

## 2026-05-29 — Stage 6 (final review + delegated Founder gate) — Rohan (cto-advisor)

**Verdict: PASS → APPROVE** (delegated Founder gate; decided_by rishabhporwal via Rohan standing delegation).

**Drift:** none — requirement→plan→code aligned; no public surface, no migration, TS untouched (CF-CC-OWNER-1 honored).

**Over-engineering audit: PASS** — staged set == plan §17 exactly; only 3 justified deps (boto3/moto/aws-cdk-lib); no speculative abstractions (factory mirrors existing TS primitive; Option-B stays a stub; no TS AWS backing; no bulk-erasure API; one ids-only log line, zero new metrics).

**Verify-the-verifier (durable rule 2026-05-26 sub-rule 7 — 11th occurrence; the vacuous test was the gate-mutation test ITSELF).** I re-mutated all 3 load-bearing gates on disk, captured RED, reverted clean (git diff == 0 each):
- A. custody_factory `case None | "" | "local":` → AWS  ⇒ test_2 RED (assertion i)
- B. custody_factory `case _:` → AWS                    ⇒ test_2 RED (assertion ii)
- C. aws_secrets_manager_custody `_client()` residency assert removed ⇒ test_3 RED (DID NOT RAISE AwsRegionMismatchError)
Full suite on reverted tree: 226 passed, 14 skipped. Replicates Tanvi's RE-VERIFY exactly. BOUNCE-1 fix is REAL on disk (test_2 drives both fail-closed branches under one boto3 spy). Runnable here (moto) — no deferral.

**Paradigm/cost:** @paradigm sql everywhere; zero ml/llm; ₹0/mo recurring (HELD live cost ~$0.40/secret/mo + ~$1/mo CMK — Founder awareness only).

**Security/IAM spot-check (mine):** IAM exact 6 SM actions + Tag, 2 KMS, secret:brain/* + CMK ARN, no wildcard. NEVERLOG grep clean (no content/SecretString/token in any logger call). ForceDeleteWithoutRecovery comments-only.

**HELD for Stage 8:** real AWS provisioning + KMS CMK + IAM role creation + live token rotation; CF-C7 vendor-200 + parity-GREEN legs; legacy-plaintext DELETE PoNR (Shiprocket last); botocore-DEBUG-off precondition; festival-freeze. CDK authored-NOT-deployed.

**Carry-forward LOW:** LOW-1 hatchling uv-sync build-target (non-blocking, Maya/WS-1); LOW-2 resolved on disk.

**Commit:** NOT GRANTED — pending Founder free-text "commit it". Commit MUST capture WORKING-TREE versions of test_aws_secrets_manager_custody.py + custody.py (the BOUNCE-1 + LOW-2 fixes sit unstaged on top of a stale index).

**Next:** Stage 8 readiness (Jatin) — everything live HELD behind ceremony gates.

# 10 — QA Review (Stage 5, Tanvi — VETO) — feat-credential-custody-aws-sm

| Field | Value |
|-------|-------|
| **req_id** | `feat-credential-custody-aws-sm` |
| **Actor** | qa-agent (Tanvi) |
| **Stage** | 5 (VETO gate G5) |
| **Lane** | high-stakes |
| **Timestamp** | 2026-05-29 |
| **Verdict** | **FAIL — BOUNCE to backend-developer (Maya)** |

---

## Stage 4 skip acknowledgment (mandatory re-check)

Stage 4 (Shreya) was not skipped — it is a PASS. Re-running the secrets grep on the staged diff per operating-loop step 3:

```
git diff HEAD -- apps/ingestion-service/ infra/cdk/ | grep -iE 'password|secret|api[_-]?key|bearer|aws_access_key_id|aws_secret_access_key|sk-[a-zA-Z0-9]+|ghp_'
```

Hits:
```
+        secret_string = json.dumps(content)
+                "SecretString": secret_string,
+                        SecretString=secret_string,
+    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
+    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
```

Verdict: these are (a) the boto3 API parameter name `SecretString` — a string variable name, not a credential value; (b) moto test fixture values set to the literal string `"testing"` — the standard moto setup pattern, not real credentials. No real secrets present.

---

## Test run results (verbatim command output)

### Python — baseline (uv run --no-sync pytest)

```
uv run --no-sync pytest tests/unit/test_aws_secrets_manager_custody.py tests/unit/test_custody_stubs.py -v
============================= test session starts ==============================
platform darwin -- Python 3.13.7, pytest-9.0.2, pluggy-1.6.0
...
============================== 56 passed in 0.46s ==============================
```

56 tests passed. 0 failures. 0 skipped.

### CDK assertions (npm test)

```
npm test
> @brain/infra-cdk@0.0.0 test
> jest --passWithNoTests

PASS test/credential-custody-stack.test.ts
  CredentialCustodyStack — KMS CMK (CF-CC-RESIDENCY-1)
    ✓ has exactly one customer-managed KMS Key resource
    ✓ CMK has EnableKeyRotation = true
    ✓ CMK has a DeletionPolicy of Retain
    ✓ CMK description references Brain credential custody and ap-south-1
    ✓ CMK alias is 'alias/brain/credential-custody'
  CredentialCustodyStack — Secrets Manager posture (CF-CC-RESIDENCY-1)
    ✓ has exactly one Secrets Manager secret
    ✓ secret name is prefixed with 'brain/'
    ✓ secret is encrypted with the CMK (NOT the default AWS-managed key)
    ✓ secret has DeletionPolicy Retain
  CredentialCustodyStack — Least-privilege IAM policy (CF-CC-IAM-LEASTPRIV-1)
    ✓ has exactly one ManagedPolicy resource
    ✓ Secrets Manager statement has the EXACT enumerated action set
    ✓ Secrets Manager statement resource is scoped to brain/* — NOT a '*' wildcard
    ✓ Secrets Manager statement does NOT use a wildcard action
    ✓ KMS statement has EXACTLY Decrypt + GenerateDataKey
    ✓ KMS statement resource is the CMK ARN — NOT a '*' wildcard
    ✓ policy has exactly two statements
    ✓ NEGATIVE: no ForceDeleteWithoutRecovery-enabling wildcard
  CredentialCustodyStack — Residency guard (CF-CC-RESIDENCY-1)
    ✓ stack constructor throws if region is not ap-south-1
    ✓ stack in ap-south-1 synthesizes without error
    ✓ synthesized template region is ap-south-1
  CredentialCustodyStack — CloudFormation outputs
    ✓ emits CredentialCmkArn output
    ✓ emits CustodyPolicyArn output

Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
Time:        1.422 s
```

### cdk synth

```
npx cdk synth
[outputs CredentialCmkArn, CustodyPolicyArn — full YAML emitted]
Synthesis complete. No errors.
```

### Flakiness check (3 runs)

```
Run 1: 56 passed in 0.45s
Run 2: 56 passed in 0.45s
Run 3: 56 passed in 0.46s
```

Zero flaky tests across 3 runs.

---

## Gate mutation re-runs (TANVI INDEPENDENT — the verify-the-verifier control)

Each mutation was applied to disk, the named gate test was run, output was captured verbatim, then reverted. `git diff` after revert confirmed clean.

### Mutation 1 — Import-time zero-call (CF-CC-LAZY-1)

**Mutation applied:** `__init__` changed from `self._boto3_client = None` to eagerly calling `boto3.client("secretsmanager", region_name=_REQUIRED_REGION)`.

**Gate test run:** `pytest tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_1_import_time_zero_aws_call`

**Result: RED (exit code 1)**

```
FAILED tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_1_import_time_zero_aws_call

AssertionError: boto3.client was called at import time — CF-CC-LAZY-1 VIOLATION. 
The client must be constructed lazily in _client(), not at import or __init__.
```

**Verdict: RED confirmed. Gate is non-vacuous for mutation 1.**

Reverted. `git diff` == 0.

---

### Mutation 2 — Fail-closed default (CF-CC-GATE-1)

**Mutation applied:** `case _:` branch in `custody_factory.py` changed to return `AwsSecretsManagerCustody()` instead of `HeldProductionCustody()`.

**Gate test run:** `pytest tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_2_fail_closed_default_no_aws_call`

**Result: GREEN (exit code 0) — VACUOUS GATE FINDING**

```
tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_2_fail_closed_default_no_aws_call PASSED
1 passed in 0.07s
```

**Root cause:** The test calls `select_custody()` with no argument, which resolves to `effective = None`. That hits `case None | "" | "local":` — the unmutated branch — not `case _:`. The mutation is invisible to the test's execution path. The named gate-mutation test #2 does NOT detect its own named mutation.

**Compensating coverage (not the gate test):** `TestCustodyFactory::test_unknown_value_returns_held_not_aws` and `test_env_var_unknown_selects_held` DO catch this mutation (both fail RED with the mutation applied). However, those are factory selection tests, not the designated gate-mutation test.

**Bounce condition triggered:** Plan §17b AC-4 / §10 "Mutation testing targets" / Stage-5 bounce conditions state: "If any expected-RED mutation stays GREEN (vacuous gate) → BOUNCE." Gate mutation test #2 stays GREEN under mutation 2. This is a BOUNCE.

**Severity:** must-fix-now (per rubric: a vacuously green gate test on a security-critical path is equivalent to a missing test; the purpose of the gate-mutation test is specifically to catch this class of failure, and it does not).

**Required fix:** `test_2_fail_closed_default_no_aws_call` must be strengthened so that the mutation (default branch returns AWS) causes the test to FAIL. Two valid approaches:
  - Option A: Also mutate the `case None | "" | "local":` branch (the actual default-path branch) in addition to `case _:`, OR
  - Option B: Restructure the test to call `select_custody()` with an explicitly unknown backing value (e.g., `backing="some-unknown-value"`) to exercise the `case _:` branch, OR
  - Option C (preferred): Mutate `case None | "" | "local":` → return `AwsSecretsManagerCustody()` in the mutation annotation, and assert that `select_custody()` (no arg, effective=None) returns `HeldProductionCustody` — this directly tests the default path under the correct mutation.

Reverted. `git diff` == 0.

---

### Mutation 3 — Wrong-region kill (CF-CC-RESIDENCY-1)

**Mutation applied:** Residency assert block removed from `_client()` — after client construction, `self._boto3_client = client` directly, with no effective-region check.

**Gate test run:** `pytest tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_3_wrong_region_kill`

**Result: RED (exit code 1)**

```
FAILED tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_3_wrong_region_kill

Failed: DID NOT RAISE <class '...AwsRegionMismatchError'>
```

**Verdict: RED confirmed. Gate is non-vacuous for mutation 3.**

Reverted. `git diff` == 0.

---

## moto matrix (CF-CC-NOREAL-AWS-1)

All 10 moto-backed tests in `TestAwsSecretsManagerCustodyMoto` passed:
- `test_put_get_round_trip` — PASS
- `test_get_missing_secret_raises_key_error` — PASS (KeyError per Protocol contract)
- `test_put_is_idempotent` — PASS
- `test_seal_schedules_deletion_with_recovery_window` — PASS (RecoveryWindowInDays=7 asserted; ForceDeleteWithoutRecovery absent from captured kwargs)
- `test_seal_idempotent_already_scheduled` — PASS
- `test_force_delete_never_called` — PASS
- `test_get_key_error_does_not_leak_token` — PASS
- `test_log_on_put_does_not_include_content` — PASS
- `test_log_on_get_does_not_include_content` — PASS
- `test_multiple_workspaces_isolated` — PASS

ZERO real AWS calls (all moto-intercepted). Confirmed.

---

## Real-network smoke

**HELD — Stage-8 ceremony.** Honestly marked in plan §10: "HELD (Stage-8 ceremony, Founder-gated, CF-CC-NO-LIVE-1)." Not bouncing on absence. Confirmed: no fake real-AWS output, no fabricated smoke pass.

---

## CDK assertions (22 tests, cdk synth)

All 22 CDK assertion tests PASSED. `cdk synth` succeeded cleanly (template emits CredentialCmkArn + CustodyPolicyArn outputs). IAM least-privilege assertions confirmed:
- Exact SM action set (6 actions, no wildcard, no extra)
- SM resource scoped to `arn:aws:secretsmanager:ap-south-1:*:secret:brain/*` — no bare `*`
- KMS exactly `Decrypt + GenerateDataKey` on CMK ARN — no `*`
- Exactly 2 policy statements — no silent extras
- No `secretsmanager:*` or `*` action anywhere

---

## AC-row classification (14 rows)

| AC | CF | Status | Notes |
|----|----|--------|-------|
| AC-1 | CF-CC-OWNER-1 | MET | Real backing only in Python. No TS core-service AWS backing. |
| AC-2 | CF-CC-GATE-1 | **DEFECT** | Gate-mutation test #2 is vacuous (stays GREEN under its own mutation). Functional factory correctness is covered by TestCustodyFactory, but the named gate-mutation test fails the verify-the-verifier standard. Must fix. |
| AC-3 | CF-CC-LAZY-1 | MET | _client() lazy. Import-time zero-call gate test #1 RED under mutation (non-vacuous). |
| AC-4 | CF-CC-NOREAL-AWS-1 | PARTIAL | moto matrix all pass. Gate tests #1 and #3 are non-vacuous RED. Gate test #2 is vacuous (see AC-2). |
| AC-5 | CF-CC-IAM-LEASTPRIV-1 | MET | CDK assertions 22/22 pass. Exact action sets, brain/* scoping, CMK-scoped KMS. |
| AC-6 | CF-CC-SEAL-RECOVERY-1 | MET | RecoveryWindowInDays=7 asserted. ForceDeleteWithoutRecovery absent from code (only in comments). |
| AC-7 | CF-CC-RESIDENCY-1 | MET | Python client region=ap-south-1 + refuse-to-start. CDK region pin. CMK ap-south-1. Gate test #3 non-vacuous. |
| AC-8 | CF-CC-WS-ISOLATION-1 | MET | _validate_id blocks all traversal chars. Test matrix complete. |
| AC-9 | CF-CC-NEVERLOG-1 | MET | ids-only in all error/log paths. Negative tests pass. botocore scope judgment inherited from Shreya (correct; not our logger). |
| AC-10 | CF-CC-ERASURE-PATH-1 | MET | held_custody.py:20-31 documents seal-across-vendors + 7-day retention tail. |
| AC-11 | CF-CC-SHOPIFY-HMAC-1 | MET (w/ LOW-2) | Follow-up at requirements-draft/. custody.py pointer references wrong path (requirements/ vs requirements-draft/). Non-blocking carry-forward from Shreya's LOW-2. |
| AC-12 | CF-CC-C7-LEG-1 | HELD-Stage-8 | Only real seal()/get() leg satisfied. Remaining legs HELD. |
| AC-13 | CF-CC-NO-LIVE-1 | MET | Zero real AWS. CDK synth-only. No commit (staged). |
| AC-14 | paradigm | MET | @paradigm: sql on all 7 touched files. No ml/small_llm/frontier_llm. |

---

## Bounce-condition checks

- [x] Re-network smoke: HELD-Stage-8 (honestly marked) — NOT a bounce
- [x] Mutation #1 RED: PASS
- **[ ] Mutation #2 RED: FAIL — gate test stays GREEN under mutation — BOUNCE**
- [x] Mutation #3 RED: PASS
- [x] CDK assertions 22/22: PASS
- [x] Legacy guard `git diff --stat -- "legacy project/"` == 0: PASS
- [x] moto matrix full pass + zero real AWS: PASS
- [x] No `cdk deploy` run: PASS
- [x] No secrets in diff: PASS

---

## Findings

**CRITICAL: 0 · HIGH: 0 · MED: 0**

### BOUNCE-1 (must-fix-now) — Gate mutation test #2 is vacuous (AC-2, AC-4, CF-CC-GATE-1)

**Severity:** must-fix-now per finding-severity rubric. A vacuous gate test on a security-critical path — the fail-closed default for AWS credentials — is a test that does not verify what it claims to verify. This is the durable rule 2026-05-26: "the 3 gate-mutation tests are the verify-the-verifier control; bounce if any expected-RED mutation stays GREEN."

**Finding:** `TestGateMutations::test_2_fail_closed_default_no_aws_call` calls `select_custody()` with no argument, resolving `effective = None`. `None` hits the `case None | "" | "local":` branch — which was NOT mutated. The mutation targeted `case _:`. The named gate test is completely invisible to the mutation's effect path and passes GREEN.

**Required fix (Maya):** Align the mutation and the test so the gate test actually exercises the mutated code path. See Mutation 2 section above for three valid options. The simplest correct fix: change the `# MUTATION:` comment to target `case None | "" | "local":` → return `AwsSecretsManagerCustody()`, and verify the test (which calls `select_custody()` with no arg → `effective = None`) correctly goes RED under that mutation. The test body itself may not need to change; only the mutation target must be corrected.

**Carry-forward LOW (not blocking):**
- LOW-1 (from Shreya): hatchling `uv sync` packaging gap in `pyproject.toml` (missing `[tool.hatch.build.targets.wheel] packages` entry). Tests run clean with `--no-sync`. Non-blocking; log for Maya.
- LOW-2 (from Shreya): `custody.py:30` references `.engineering-os/requirements/chore-app-hmac-secret-custody.md` but file is at `.engineering-os/requirements-draft/`. Stale path pointer; non-blocking.

---

## Gate G5 result

- [x] All unit + CDK tests green (56 + 22)
- [x] moto matrix PASS
- [x] cdk synth PASS
- [x] Real-network smoke: HELD-Stage-8 (declared, not faked)
- [x] Mutation #1 RED confirmed (non-vacuous)
- **[ ] Mutation #2 RED NOT confirmed (gate stays GREEN — vacuous)**
- [x] Mutation #3 RED confirmed (non-vacuous)
- [x] Legacy guard == 0
- [x] No secrets in diff
- [x] Flakiness: 0 (3 runs clean)
- [x] No real AWS / no cdk deploy

**VERDICT: FAIL (BOUNCE) — Gate mutation test #2 is vacuous. Bounce to Maya (backend-developer). All other gates PASS.**

---

## Trace IDs end-to-end

N/A — paradigm `sql`/infra; no gRPC/Kafka/LLM path in scope for this build. No new inbound request surface. Custody is an in-process call.

## Metric registry TS↔Python parity

N/A — no new metrics defined (per plan §9: zero new metrics). Paradigm `sql`; not a metric-registry change.

## Operational-readiness checklist

- Root handler: N/A (no new service entrypoint)
- Health check: N/A (internal adapter)
- Port: N/A
- Env vars: `CONNECTOR_CUSTODY_BACKING` (optional, defaults to held), `BRAIN_CUSTODY_KMS_KEY_ID` (HELD Stage-8) — documented in code. PASS.
- Native deps: boto3 + moto importable. PASS.

---

## RE-VERIFY ADDENDUM — 2026-05-29 — Tanvi (qa-agent)

**Trigger:** BOUNCE-1 fix applied by orchestrator per Tanvi's direction. test_2_fail_closed_default_no_aws_call now drives BOTH fail-closed branches under a single boto3 spy.

### Full suite re-run (post-fix, pre-mutation)

```
uv run --no-sync pytest tests/ -q
ssssssssssssss..................................................... [ 30%]
........................................................................ [ 60%]
........................................................................ [ 90%]
........................                                                 [100%]
226 passed, 14 skipped in 0.51s
```

Baseline confirmed. 226 passed, 14 skipped. Zero regressions.

### Independent re-mutation A — `case None | "" | "local":` (line 71)

**Mutation applied:** Line 71 `return HeldProductionCustody()` replaced with local import of AwsSecretsManagerCustody + `return _ASM()`.

**Test run:** `pytest tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_2_fail_closed_default_no_aws_call -v`

**Result: RED (exit code 1)**

```
FAILED tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_2_fail_closed_default_no_aws_call

AssertionError: Got AwsSecretsManagerCustody, expected HeldProductionCustody. CF-CC-GATE-1: unset/default backing must be held, not AWS. MUTATION: `case None | "" | "local":` -> AwsSecretsManagerCustody -> this FAILS.
assert False
 +  where False = isinstance(<src.infrastructure.secrets.aws_secrets_manager_custody.AwsSecretsManagerCustody object at 0x109f36990>, HeldProductionCustody)
```

**Assertion (i) caught it.** Gate is non-vacuous against the `case None` branch.

Reverted. `git diff` == 0 (empty output).

### Independent re-mutation B — `case _:` (line 99)

**Mutation applied:** Line 99 `return HeldProductionCustody()` replaced with local import of AwsSecretsManagerCustody + `return _ASM()`.

**Test run:** `pytest tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_2_fail_closed_default_no_aws_call -v`

**Result: RED (exit code 1)**

```
FAILED tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_2_fail_closed_default_no_aws_call

AssertionError: Got AwsSecretsManagerCustody, expected HeldProductionCustody. CF-CC-GATE-1: unknown backing must fail closed to held, not AWS. MUTATION: `case _:` -> AwsSecretsManagerCustody -> this FAILS.
assert False
 +  where False = isinstance(<src.infrastructure.secrets.aws_secrets_manager_custody.AwsSecretsManagerCustody object at 0x10a2c2ad0>, HeldProductionCustody)
```

**Assertion (ii) caught it.** Gate is non-vacuous against the `case _:` branch.

Reverted. `git diff` == 0 (empty output).

### Gate tests #1 and #3 — re-confirmed in isolation

```
pytest tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations -v
tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_1_import_time_zero_aws_call PASSED
tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_2_fail_closed_default_no_aws_call PASSED
tests/unit/test_aws_secrets_manager_custody.py::TestGateMutations::test_3_wrong_region_kill PASSED

3 passed in 0.06s
```

All three gate tests GREEN on the reverted (live) tree.

### Full suite re-run (post-revert confirmation)

```
uv run --no-sync pytest tests/ -q
226 passed, 14 skipped in 0.51s
```

### Legacy guard

```
git diff --stat -- "legacy project/"
(empty — no output)
```

Zero.

### Re-verify bounce-condition table

| Condition | Result |
|-----------|--------|
| Full suite green (226 passed, 14 skipped) | PASS |
| Mutation A: `case None` → AWS — test_2 RED | PASS (non-vacuous) |
| Mutation B: `case _:` → AWS — test_2 RED | PASS (non-vacuous) |
| Revert A: git diff == 0 | PASS |
| Revert B: git diff == 0 | PASS |
| Gate tests #1 and #3 still GREEN | PASS |
| Legacy guard == 0 | PASS |
| Previously passing gates (moto, CDK, no-real-AWS, no-cdk-deploy) | Unchanged |

### RE-VERIFY VERDICT: PASS

All gate conditions satisfied. BOUNCE-1 is resolved. Both fail-closed branches now have non-vacuous coverage under `test_2_fail_closed_default_no_aws_call`. Carry-forward LOW-1 and LOW-2 remain tech debt, non-blocking.

**Routing: PASS — high-stakes lane — advance to Stage 6 (Rohan / CTO Advisor).**

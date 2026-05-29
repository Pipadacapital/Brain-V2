# 10 — QA Review (Stage 5, VETO) — chore-app-hmac-secret-custody

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **Stage** | 5 — QA (Tanvi) |
| **Reviewer** | Tanvi (qa-agent) |
| **Timestamp** | 2026-05-29T18:30:00Z |
| **Verdict** | **PASS** |
| **Lane** | high-stakes → Stage 6 (Rohan) |

---

## Stage 4 skip acknowledgment

Stage 4 was NOT skipped. Shreya ran sequential security review and produced `09-security-review.md` (PASS, 0 findings). Mandatory secrets grep on staged diff run independently below.

**Staged diff secrets grep:**
Command: `git diff --cached | grep -iE 'password|secret|api[_-]?key|bearer|aws_|sk-[a-zA-Z0-9]+|ghp_'`
Output: (empty — 0 hits)

**shpss_ live value grep:**
Command: `git diff --cached | grep -iE 'shpss_'`
Output: exit code 1 (no match — 0 hits)

No live secrets in the staged diff.

---

## Test suite results (independently re-run)

### Python — ingestion-service

Command: `uv run --no-sync pytest apps/ingestion-service/tests/ -q`

```
ssssssssssssss..........................................................[ 25%]
.......................................................................[ 51%]
.......................................................................[ 77%]
.............................................................           [100%]
263 passed, 14 skipped in 0.90s
```

Result: **263 passed, 14 skipped** — matches the Shreya-reported count exactly.

### TypeScript — CDK

Command: `cd infra/cdk && npm test`

```
PASS test/credential-custody-stack.test.ts
  CredentialCustodyStack — KMS CMK (CF-CC-RESIDENCY-1)
    ✓ has exactly one customer-managed KMS Key resource (1 ms)
    ✓ CMK has EnableKeyRotation = true (CF-CC-RESIDENCY-1 + DPDP) (1 ms)
    ✓ CMK has a DeletionPolicy of Retain (no accidental deletion)
    ✓ CMK description references Brain credential custody and ap-south-1
    ✓ CMK alias is 'alias/brain/credential-custody'
  CredentialCustodyStack — Secrets Manager posture (CF-CC-RESIDENCY-1)
    ✓ has exactly two Secrets Manager secrets (posture sentinel + app-level singleton)
    ✓ secret name is prefixed with 'brain/'
    ✓ secret is encrypted with the CMK (NOT the default AWS-managed key) (CF-CC-RESIDENCY-1) (1 ms)
    ✓ secret has DeletionPolicy Retain (no auto-delete)
  CredentialCustodyStack — App-level singleton secret (CF-HMAC-RESIDENCY-1, T3)
    ✓ app-level singleton secret name is prefixed with 'brain/_app/'
    ✓ app-level singleton secret name is 'brain/_app/shopify/hmac_secret'
    ✓ app-level singleton secret is CMK-encrypted (NOT the default aws/secretsmanager key)
    ✓ app-level singleton secret uses the SAME CMK as the posture sentinel (no new key)
    ✓ app-level singleton secret has DeletionPolicy Retain (CF-HMAC-RESIDENCY-1 / no auto-delete)
    ✓ app-level singleton secret description references auto-rotation FORBIDDEN (CF-HMAC-ROTATION-MANUAL-1)
    ✓ appShopifyHmacSecret construct property is accessible on the stack
    ✓ emits AppShopifyHmacSecretArn CloudFormation output (1 ms)
  CredentialCustodyStack — IAM NOT widened by T3 (CF-CC-IAM-LEASTPRIV-1 regression)
    ✓ STILL exactly one ManagedPolicy — no new policy was added for brain/_app/*
    ✓ STILL exactly two IAM statements (SM + KMS) — no new statement was added
    ✓ SM resource 'brain/*' prefix-covers 'brain/_app/shopify/hmac_secret' (IAM-not-widened proof) (1 ms)
    ✓ NEGATIVE: SM resource scope was NOT widened to '*' by the T3 delta
    ✓ NEGATIVE: SM action set was NOT expanded beyond the original 6 actions by T3
  CredentialCustodyStack — Least-privilege IAM policy (CF-CC-IAM-LEASTPRIV-1)
    ✓ has exactly one ManagedPolicy resource
    ✓ Secrets Manager statement has the EXACT enumerated action set — no more, no fewer
    ✓ Secrets Manager statement resource is scoped to brain/* — NOT a '*' wildcard
    ✓ Secrets Manager statement does NOT use a wildcard action (no 'secretsmanager:*')
    ✓ KMS statement has EXACTLY Decrypt + GenerateDataKey — no other KMS actions
    ✓ KMS statement resource is the CMK ARN — NOT a '*' wildcard (CF-CC-IAM-LEASTPRIV-1) (1 ms)
    ✓ policy has exactly two statements (SM and KMS) — no silent extras
    ✓ NEGATIVE: no ForceDeleteWithoutRecovery-enabling wildcard anywhere in the policy
  CredentialCustodyStack — Residency guard (CF-CC-RESIDENCY-1)
    ✓ stack constructor throws if region is not ap-south-1
    ✓ stack in ap-south-1 synthesizes without error (1 ms)
    ✓ synthesized template region is ap-south-1 (via stack metadata) (1 ms)
  CredentialCustodyStack — CloudFormation outputs
    ✓ emits CredentialCmkArn output
    ✓ emits CustodyPolicyArn output

Test Suites: 1 passed, 1 total
Tests:       35 passed, 35 total
```

Result: **35 passed** — matches Shreya's count exactly.

---

## Re-mutation results (Tanvi, independent — durable rule 2026-05-26)

### Mutation #1 — CF-HMAC-CONSTTIME-1: `compare_digest` → `==`

**Target:** `apps/ingestion-service/src/interfaces/adapters/shopify_adapter.py:107`
**Before:** `return hmac.compare_digest(computed, hmac_header)`
**After (mutated):** `return computed == hmac_header`
**Method:** `sed -i '' 's/return hmac\.compare_digest(computed, hmac_header)/return computed == hmac_header/'`; confirmed with grep (line 107 reads `return computed == hmac_header`).

**Test run under mutation:**
```
FAILED apps/ingestion-service/tests/unit/test_app_secret_provider.py::TestVerifyTheVerifier::test_mutation_constant_time_compare
AssertionError: CF-HMAC-CONSTTIME-1: verify_shopify_hmac MUST use hmac.compare_digest (constant-time), not ==.
MUTATION compare_digest→== makes this FAIL.
assert 'compare_digest' in '...return computed == hmac_header\n'
```
Result: **FAILED (RED)** — gate is non-vacuous.

**Revert:** `cp /tmp/shopify_adapter.py.bak shopify_adapter.py`; confirmed line 107 reads `return hmac.compare_digest(computed, hmac_header)`.

**Post-revert test:**
```
PASSED apps/ingestion-service/tests/unit/test_app_secret_provider.py::TestVerifyTheVerifier::test_mutation_constant_time_compare
1 passed in 0.06s
```
Result: **GREEN** — byte-identical revert confirmed.

**Verdict: Mutation #1 RED/revert/GREEN — CF-HMAC-CONSTTIME-1 NON-VACUOUS.**

---

### Mutation #2 — CF-HMAC-FAILCLOSED-1: `raise AppSecretUnavailableError(...)` → `return ""`

**Target:** `apps/ingestion-service/src/infrastructure/secrets/app_secret_provider.py:242–247` (ResourceNotFoundException branch)
**Before:** 6-line `raise AppSecretUnavailableError(...)` block
**After (mutated):** single `return ""`
**Method:** Python script replacing lines 241–246 (0-indexed) with `return ""\n`; confirmed line 242 reads `return ""`.

**Test run under mutation:**
```
FAILED tests/unit/test_app_secret_provider.py::TestVerifyTheVerifier::test_mutation_fail_closed_not_fall_open
    Failed: DID NOT RAISE <class 'src.infrastructure.secrets.app_secret_provider.AppSecretUnavailableError'>

FAILED tests/unit/test_app_secret_provider.py::TestAppSecretsManagerProvider::test_resource_not_found_raises_unavailable
    Failed: DID NOT RAISE <class 'src.infrastructure.secrets.app_secret_provider.AppSecretUnavailableError'>

FAILED tests/unit/test_app_secret_provider.py::TestVerifyTheVerifier::test_case3_unretrievable_secret_fails_closed
    Failed: DID NOT RAISE <class 'src.infrastructure.secrets.app_secret_provider.AppSecretUnavailableError'>

3 failed in 0.22s
```
Result: **3 tests FAILED (RED)** — gate is non-vacuous and corroborated by 3 independent assertions.

**Belt-and-suspenders confirmation:** `test_mutation_fail_closed_not_fall_open` also proves that `verify_shopify_hmac(body, forged_with_empty_key, "")` returns `True` — confirming that a fall-open provider creates a forgeable auth bypass path (an attacker can compute the empty-key HMAC). This is exactly why fail-closed is a CRIT requirement.

**Revert:** `cp /tmp/app_secret_provider.py.bak app_secret_provider.py`; grep confirms all 4 `raise AppSecretUnavailableError` lines restored.

**Post-revert full suite:**
```
263 passed, 14 skipped in 0.90s
```
Result: **GREEN** — byte-identical revert confirmed.

**Verdict: Mutation #2 RED×3/revert/GREEN — CF-HMAC-FAILCLOSED-1 NON-VACUOUS.**

---

## 3-case kill-test verification (CF-HMAC-VERIFY-THE-VERIFIER-1)

Verified that `TestVerifyTheVerifier` calls the **real** `verify_shopify_hmac` (imported directly at line 473: `from src.interfaces.adapters.shopify_adapter import verify_shopify_hmac`). No mock/patch on `verify_shopify_hmac` in the class — confirmed by grepping for `patch|Mock` in proximity to `verify_shopify_hmac`. The 3-case kill-test genuinely exercises the real function:

- **Case 1 (`test_case1_valid_signature_passes`):** Provider-supplied secret from moto SM + correct base64 HMAC-SHA256 of `_BODY` → `verify_shopify_hmac()` returns `True`. Real crypto round-trip.
- **Case 2 (`test_case2_tampered_body_rejected`):** Valid sig for original body + body mutated by replacing `"499.00"` with `"0.00"` → `verify_shopify_hmac()` returns `False`. Real digest mismatch.
- **Case 3 (`test_case3_unretrievable_secret_fails_closed`):** Secret not provisioned in moto SM → `provider.get_shopify_hmac_secret()` raises `AppSecretUnavailableError` before `verify_shopify_hmac` is ever called. Fail-closed path. `test_mutation_fail_closed_not_fall_open` separately proves the empty-key fallback would be forgeable (belt-and-suspenders).

3-case kill-test exercises the REAL verifier with no stub or double. Confirmed.

---

## Additional gate checks

### Cache (CF-HMAC-HOTPATH-CACHE-1)

`get_shopify_hmac_secret()` lines 200–205: cache short-circuit at `if self._cached_secret is not None: return self._cached_secret`. `_fetch()` is called only on first use. `test_cache_at_most_one_sm_call` spy-asserts ≤1 `get_secret_value` across 5 reads. No per-webhook SM call path exists.

### Residency (CF-HMAC-RESIDENCY-1)

`_client()` hard-codes `region_name="ap-south-1"` (line 163); refuses to start with `AwsRegionMismatchError` if effective region differs (lines 167–174). Tested by `test_residency_wrong_region_raises`. CDK: CMK + both SM secrets have `DeletionPolicy: Retain`; KmsKeyId is the CMK Fn::GetAtt (not the default aws/secretsmanager key). CDK tests cover all three.

### Never-log (CF-HMAC-NEVERLOG-1)

`botocore` logger level saved (line 227), set to WARNING (line 228), restored in `finally` (line 260) on both success and exception paths. `TestNeverLog` class (5 tests) negatively asserts secret value + full HMAC absent from all log records at DEBUG level. Live `shpss_…` absent from staged diff (grep confirmed).

### botocore-DEBUG defense-in-depth

`finally:` at line 258 restores `_prev_botocore_level` in both the success and exception path — confirmed by reading lines 226–260. Shreya's independent proof (level restored even through ResourceNotFoundException path) is accepted; the code structure confirms it.

### No ingress route (HELD boundary)

`git status --short | grep -E "shopify|webhook|ingress|route|endpoint"` → no output. Only `app_secret_provider.py`, `app_secret_factory.py`, `test_app_secret_provider.py`, CDK files modified. The seam is documented in the module docstring (lines 37–49) with an explicit `# SEAM:` comment. No endpoint was built.

### TS owner boundary (CF-HMAC-TS-VS-PY-OWNER-1)

`git status --short | grep -E "core-service|api-gateway"` → no output (exit 1). No TS/core-service files touched. C1/C2 stay `requireEnv`-injected. Follow-on `chore-ts-oauth-app-secret-custody` is named in the plan.

### Legacy project unchanged

`git diff --stat -- "legacy project/"` → empty (0 changes). Confirmed.

### 3× flake check on TestVerifyTheVerifier

```
Run 1: 5 passed in 0.22s
Run 2: 5 passed in 0.22s
Run 3: 5 passed in 0.22s
```
No flakiness. Confirmed stable.

---

## Acceptance contract (11 CFs) — row-by-row classification

| CF | Sev | Status | Evidence |
|----|-----|--------|----------|
| **CF-HMAC-FAILCLOSED-1** | CRIT | **MET** | All raise paths confirmed in source; mutation #2 RED×3 / revert GREEN. |
| **CF-HMAC-VERIFY-THE-VERIFIER-1** | CRIT | **MET** | 3-case kill-test exercises REAL verifier; both mutation tests non-vacuous (Tanvi re-mutated). |
| **CF-HMAC-RETRIEVAL-SHAPE-1** | HIGH | **MET** | Factory matrix in `app_secret_factory.py:62–98`: aws-sm→SM; None/""/local→Env; `case _:`→Held. |
| **CF-HMAC-TS-VS-PY-OWNER-1** | HIGH | **MET** | No TS AWS client; only Python + CDK files touched; follow-on named. |
| **CF-HMAC-SINGLE-PRIMITIVE-1** | HIGH | **MET** | `verify_shopify_hmac` at `:81–107` UNCHANGED; provider reuses parent lazy-boto3/residency. |
| **CF-HMAC-ALGO-DISTINCT-1** | HIGH | **MET** | C3 base64/raw-body `compare_digest` (line 107) unchanged; C1 hex/sorted-query untouched. |
| **CF-HMAC-CONSTTIME-1** | HIGH | **MET** | `compare_digest` at line 107; mutation #1 RED / revert GREEN. |
| **CF-HMAC-HOTPATH-CACHE-1** | MED | **MET** | Cache short-circuit lines 200–201; spy test ≤1 call across 5 reads. |
| **CF-HMAC-ROTATION-MANUAL-1** | MED | **MET** | Module docstring runbook lines 51–79; CDK construct has no rotation schedule; RETAIN. |
| **CF-HMAC-RESIDENCY-1** | HIGH | **MET** | Provider `region_name="ap-south-1"` + refuse-to-start assert; CDK CMK+secret ap-south-1+RETAIN. |
| **CF-HMAC-NEVERLOG-1** | HIGH (VETO) | **MET** | ids-only logs; botocore suppression scoped+restored in `finally`; negative-assertion tests GREEN; shpss_… absent from diff. |
| **CF-HMAC-EXPOSED-VALUE-ROTATE-1** | MED | **MET** | Runbook lines 74–79 flag `.env:27` compromised → rotate at Stage-8 STEP 1. |

**HELD CFs (not bounce conditions for this build):** real SM provisioning + CMK association; put + rotate live `shpss_…`; IAM role creation; inbound-webhook ingress route (separate HELD feature).

---

## Bounce-condition check (§17b table)

| Bounce condition | Status |
|-----------------|--------|
| Mutation #1 (`compare_digest`→`==`) stays GREEN → BOUNCE | **CLEAR — mutation was RED** |
| Mutation #2 (fall-open) stays GREEN → BOUNCE | **CLEAR — mutation was RED×3** |
| Fall-open path for unretrievable secret → BOUNCE | **CLEAR — all paths raise** |
| Per-webhook SM call exists → BOUNCE | **CLEAR — cache + spy-asserted** |
| TS AWS client appears this slice → BOUNCE | **CLEAR — no TS files touched** |
| Provider folded into per-workspace shape → BOUNCE | **CLEAR — singleton `_app/` namespace** |
| Secret or full HMAC in logs → VETO/BOUNCE | **CLEAR — negative assertions GREEN; shpss_… absent from diff** |
| Region assert missing → BOUNCE | **CLEAR — `_client()` refuses non-ap-south-1** |
| Auto-rotation configured → BOUNCE | **CLEAR — no rotation schedule in CDK** |
| Ingress route built this slice → BOUNCE | **CLEAR — no endpoint files** |
| Legacy project modified → BOUNCE | **CLEAR — diff 0** |

All bounce conditions clear.

---

## Findings

**CRITICAL:** 0
**HIGH:** 0
**MEDIUM:** 0
**LOW:** 0
**Notes/carry-forward (non-blocking, inherited from S4):**
- N1: when the inbound-webhook ingress route is built (separate HELD feature), it MUST carry the correlation ID end-to-end and implement the seam contract exactly as documented in `app_secret_provider.py:37–49`. Traceability re-checked at that feature's Stage 4.
- N2: rotate the exposed `.env:27` `shpss_…` value at Stage-8 ceremony; ensure botocore/urllib3 not at DEBUG in live ingestion-service. Already documented.

---

## Real-network smoke

**N/A (declared, not silently skipped).** Live AWS + the inbound-webhook ingress route are both HELD for Stage-8. This slice ships only the retrieval seam + the moto-backed kill-test + CDK authored-not-deployed. The Stage-8 ceremony runbook owns the live get-secret-value round-trip smoke (documented in `app_secret_provider.py` rotation runbook STEP 4).

---

## Metric registry parity (TS ↔ Python)

**N/A.** Paradigm `sql`/infra — no metric definitions emitted in this slice.

---

## Trace IDs end-to-end

**N/A this slice.** No endpoint, no consumer, no agent invocation exists (seam only). The traceability obligation bites when the HELD inbound-webhook ingress route is built. Flagged as N1 carry-forward (consistent with Shreya's N1).

---

## Operational-readiness checklist

| Item | Status |
|------|--------|
| Root handler | N/A — no new endpoint |
| Health check | N/A — no new service |
| Port / env vars | N/A — CONNECTOR_CUSTODY_BACKING already defined; no new vars |
| Native deps | No new pip deps — boto3/moto/pytest already pinned |
| Lazy-client (no AWS at import) | PASS — `test_import_makes_no_boto3_call` GREEN |
| CDK authored-not-deployed | PASS — no `cdk deploy`; tests only |

---

## G5 gate checklist

- [x] Unit + integration + contract + E2E (applicable scope) GREEN
- [x] Real-network smoke N/A declared (no live AWS, no ingress route — HELD Stage-8)
- [x] Metric registry parity N/A declared (paradigm sql/infra)
- [x] Trace IDs N/A declared (seam only, no endpoint)
- [x] Operational-readiness checklist all green
- [x] Mutation tests on high-stakes paths: both mutations RED → reverted → GREEN
- [x] No flaky tests (3× confirmed)
- [x] Legacy project diff 0
- [x] No live secret in staged diff

---

## Decision

**PASS → Stage 6 (Rohan, CTO Advisor).**

Zero CRITICAL/HIGH findings. Both CRITICAL mutation gates independently re-mutated by Tanvi (RED / revert / GREEN). 3-case kill-test confirmed to exercise the real `verify_shopify_hmac` with no stub. All 11 CFs MET. All bounce conditions clear. No ingress route built (seam only — HELD boundary respected). NEVERLOG confirmed at source + test + diff level. CDK 35/35 GREEN.

Rohan MUST re-mutate at least one of the two gate mutations at Stage 6 per the §17b contract (CF-HMAC-VERIFY-THE-VERIFIER-1).

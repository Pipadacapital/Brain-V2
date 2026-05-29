# Persona — aws-secrets-least-privilege-realist (`:sonnet`)

> Adversarial brief (Rohan, Stage 1). Mandate: prove the real Option-A backing can be built so it is
> (a) genuinely activation-gated — ZERO AWS calls in CI/local, (b) IAM least-privilege and residency-pinned,
> (c) tested without real AWS (mocked-boto3), and (d) a real `seal()`/`get()` that actually satisfies the
> `CF-C7-CUSTODY-PROOF-1` "non-NotImplementedError" leg without smuggling in the held parts. Name the one
> thing most likely to either (i) accidentally hit real AWS, or (ii) produce a false-GREEN "real impl" that
> still can't be proven. ≥1 concern mandatory; a "looks good" pass is rejected.

## Concerns

### C1 (CRITICAL) — activation-gating must fail CLOSED, and the module-load `assert isinstance` must not import boto3 eagerly
The stub deliberately does NOT import boto3 to avoid an undeclared dependency, and the module ends with
`assert isinstance(AwsSecretsManagerCustody(), CredentialCustody)` — which runs at **import time**. If the
real impl constructs a boto3 client in `__init__`, that assert (and any import of the module) will try to
create an AWS session at import. In CI/local with no creds that either errors or, worse, with ambient creds
(a dev's `~/.aws`, `AWS_PROFILE`, or an EC2/role on a runner) **silently reaches real AWS**.
- **Bind:** the boto3 client MUST be lazily constructed (first-use, not `__init__`), and the module-load
  `isinstance` check must NOT trigger any network/session creation. The backing is reachable ONLY through an
  **activation-gated factory** (mirror the TS `CONNECTOR_CUSTODY_BACKING`: default = local; `aws-secrets-manager`
  is opt-in). Default/unset MUST select a non-AWS backing. There is no Python factory yet — Aryan must add one
  that mirrors `custody-factory.ts` and fails closed (unknown/unset → local or held, never AWS).
- **False-GREEN trap:** a test that "passes" only because boto3 wasn't installed proves nothing. Tests must run
  against `moto` (mocked AWS) so the real boto3 code path executes — but the gating must guarantee that the
  SAME code, unconfigured, makes ZERO real calls. Verify-the-verifier: a mutation that removes the gate must
  make a test FAIL (an attempted real call / wrong-region call is detected), not silently pass.

### C2 (HIGH) — IAM least-privilege must cover the WRITE + DELETE actions, not just `GetSecretValue`
The stub's IAM sketch only allows `GetSecretValue` on `brain/*`. But the real backing also does `put`
(`CreateSecret`/`PutSecretValue`) at ceremony STEP 1 and `seal` (`DeleteSecret` with 7-day recovery) at STEP 6.
A read-only policy makes `put`/`seal` fail at the worst possible moment (mid-ceremony, live tokens half-rotated).
- **Bind:** the CDK/IaC IAM policy must enumerate exactly the actions used: `GetSecretValue`, `CreateSecret`,
  `PutSecretValue`, `DescribeSecret`, `DeleteSecret` (and `TagResource` if tagging) — resource-scoped to
  `arn:aws:secretsmanager:ap-south-1:<acct>:secret:brain/*`, region-pinned, no `*` resource, no wildcard action.
  KMS: `kms:Decrypt`/`kms:GenerateDataKey` on the specific per-region CMK only. Least-privilege is a Shreya gate.

### C3 (HIGH) — `seal()` 7-day recovery window must be EXPLICIT and the sequence must be honoured
`DeleteSecret` defaults to a 7–30 day recovery window; `ForceDeleteWithoutRecovery=true` is irreversible and
MUST be forbidden in code. The Protocol docstring already orders `seal` as STEP 6, after vendor-200 + parity.
But "real seal()" must not mean "deletes now" — for the `CF-C7-CUSTODY-PROOF-1` leg, `seal()` schedules deletion
with `RecoveryWindowInDays=7` so a botched cutover is recoverable.
- **Bind:** `seal()` calls `delete_secret(RecoveryWindowInDays=7)`, NEVER `ForceDeleteWithoutRecovery`. A test
  asserts the recovery-window arg and asserts force-delete is never passed. This is the difference between a
  reversible custody op and a dead-connector incident (Shiprocket has no replay).

### C4 (MEDIUM) — region pinning must be asserted at the CLIENT, not just hoped for from env
ap-south-1 residency is a DPDP requirement (see the compliance persona). The stub takes `region="ap-south-1"`
as a default param, but a boto3 client also honours `AWS_REGION`/`AWS_DEFAULT_REGION`/profile config, which
could override to a non-Indian region.
- **Bind:** construct the client with an explicit `region_name="ap-south-1"` and assert at construction that
  the effective region == ap-south-1 (refuse-to-start otherwise), mirroring the Child-4 ClickHouse
  refuse-to-start residency pattern. Belt-and-suspenders with the CDK IaC region.

### C5 (MEDIUM) — never-log / never-serialize must survive the real impl (error paths included)
The stubs are careful never to log `Credential.content`. The real boto3 path adds `ClientError`/`ParamValidationError`
exceptions whose `str()` can echo request params. A naive `except Exception as e: log.error(e)` could leak the
SecretString.
- **Bind:** error handling carries only `(workspace_id, vendor, secret_name)` ids — never the response body or
  `SecretString`. `get` raises `KeyError` on `ResourceNotFoundException` per the Protocol contract. A test asserts
  no plaintext token appears in any log/exception string on the not-found and the success path.

## Escalate? No — these are all architecture/build-level binds for Aryan (Stage 2) + Shreya (Stage 4).
The only Founder-prerequisite is whether a real AWS account/region/credentials EXIST to provision against —
but that is explicitly HELD (Stage-8 ceremony), so it does not block THIS build. (Rohan: flagged as a
non-blocking Founder readiness item, not an escalation.)

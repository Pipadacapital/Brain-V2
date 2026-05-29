# Architecture Plan — feat-credential-custody-aws-sm

> Filled by Aryan (Architect) in Stage 2. BINDING for Stages 3–8. Any required deviation routes back to Aryan for a revision (no freelancing).

| Field | Value |
|-------|-------|
| **req_id** | `feat-credential-custody-aws-sm` |
| **Actor** | architect (Aryan) |
| **Timestamp** | 2026-05-29T17:10:00Z |
| **Lane** | high-stakes (Shreya VETO @ Stage 4, Tanvi QA @ Stage 5, Rohan VETO @ Stage 6) |
| **Binds** | the 13-CF contract from `05-stage1-synthesis.md §3` (`CF-CC-*`) |

---

## 1. Context

The connector-cutover (Child 3) shipped a `CredentialCustody` Protocol (`apps/ingestion-service/src/infrastructure/secrets/custody.py:35`) with two `NotImplementedError` backings — `aws_secrets_manager_custody.py` (Option A) and `supabase_column_custody.py` (Option B, rejected) — plus a TS mirror (`HeldProductionCustody`, `apps/core-service/src/infrastructure/secrets/production-custody.ts:35`). The FIRED escalation `CF-C7-CUSTODY-PROOF-1` blocks the per-connector legacy-plaintext-DELETE point-of-no-return until `seal()`/`get()` become a REAL (non-`NotImplementedError`) implementation.

The Founder has chosen **Option A — AWS Secrets Manager (ap-south-1)** in writing (`CF-C3-SECRETS-INTERIM-1`, decided 2026-05-29; decision-log `2026/05/2026-05-29.jsonl`). This build makes Option A real: a real boto3-backed `AwsSecretsManagerCustody` in the Python `ingestion-service`, behind an **activation-gated, fail-closed factory** (which does NOT exist today — the Python side has the two stubs + Protocol but no selector), with **ap-south-1 + customer-managed KMS CMK** residency, **least-privilege IAM** expressed in **AWS CDK (TypeScript)**, and **`moto`-mocked tests** proving the real boto3 path with ZERO real AWS calls in CI/local.

This build satisfies ONLY the `CF-C7-CUSTODY-PROOF-1` "real `seal()`/`get()` non-`NotImplementedError`" leg. Everything live — real AWS provisioning, IAM role creation, the AWS account/credentials, live token rotation into Secrets Manager, the legacy-plaintext DELETE PoNR, and the remaining `CF-C7` legs (vendor-200 over the production path + parity GREEN) — stays HELD for the Stage-8 Founder/Jatin-at-console ceremony (`CF-CC-C7-LEG-1`, `CF-CC-NO-LIVE-1`). CDK is **authored, NOT deployed**.

This plan is at the **prescriptive** handoff depth: high-stakes, security-critical, live-credential blast radius, a known false-GREEN trap (ambient AWS creds reaching real AWS at import), and a Shreya VETO surface. Prescriptive depth is the correct band here — a terse handoff would risk exactly the activation-gate / lazy-client / never-log failures the personas named.

---

## 2. Proposed solution

Add a **Python custody factory** (`custody_factory.py`) that mirrors the TS `custody-factory.ts:21` exactly: an env flag `CONNECTOR_CUSTODY_BACKING` where unset / `''` / `local` selects a **non-AWS local backing**, `aws-secrets-manager` is the explicit opt-in for the real AWS backing, and **any unknown value fails closed to the non-AWS backing — NEVER AWS** (`CF-CC-GATE-1`). The real AWS backing is reachable ONLY through this factory with the explicit opt-in.

Replace the three `NotImplementedError` bodies in `aws_secrets_manager_custody.py` with a real boto3 implementation: `get` → `get_secret_value` (JSON-decode `SecretString` into `Credential.content`; `ResourceNotFoundException` → `KeyError` per the Protocol contract); `put` → `create_secret`-or-`put_secret_value` upsert; `seal` → `delete_secret(RecoveryWindowInDays=7)` with `ForceDeleteWithoutRecovery` FORBIDDEN in code (`CF-CC-SEAL-RECOVERY-1`). The **boto3 client is lazily constructed at first use** via a private `_client()` accessor (NOT in `__init__`, NOT at module import) so the module-load `assert isinstance(...)` and any plain import make ZERO AWS session/network calls (`CF-CC-LAZY-1`). The client is built with an explicit `region_name="ap-south-1"` and a **construction-time residency assert** that refuses to start if the effective region != ap-south-1 (`CF-CC-RESIDENCY-1`, mirroring the analytics-service `assert_clickhouse_residency` pattern at `apps/analytics-service/src/bootstrap/analytics_service_startup.py:49`). `_secret_name` gains input validation rejecting empty/None/`*`/`/`-containing `workspace_id`/`vendor` so a malformed id cannot escape `brain/{ws}/{vendor}/credential` (`CF-CC-WS-ISOLATION-1`). All error/exception/log paths carry only `(workspace_id, vendor, secret_name)` ids — never `SecretString`/`Credential.content`/token text (`CF-CC-NEVERLOG-1`, Shreya VETO).

A new **CDK app** (no CDK app exists in the repo today — this is the minimal first stack) under `infra/cdk/` authors a single `CredentialCustodyStack` (TypeScript): a customer-managed KMS CMK in ap-south-1, the Secrets Manager residency posture (CMK-encrypted, region-pinned), and a least-privilege IAM policy enumerating exactly `GetSecretValue, CreateSecret, PutSecretValue, DescribeSecret, DeleteSecret` (+`TagResource`) on `arn:aws:secretsmanager:ap-south-1:<acct>:secret:brain/*` only, plus KMS `Decrypt`/`GenerateDataKey` on the CMK only (`CF-CC-IAM-LEASTPRIV-1`, `CF-CC-RESIDENCY-1`). The stack is **synthesized + asserted in CI (`cdk synth` + a fine-grained `aws-cdk-lib/assertions` test), NOT deployed** (`CF-CC-NO-LIVE-1`).

Tests run against **`moto`** so the real boto3 code path executes with zero real AWS, plus a **verify-the-verifier mutation**: deleting/neutering the activation gate must make a test FAIL (an attempted real / wrong-region call is detected), not silently pass (`CF-CC-NOREAL-AWS-1`). The Shopify HMAC line is ruled a **separate tracked follow-up** (`CF-CC-SHOPIFY-HMAC-1`) and the DPDP erasure path is documented (`CF-CC-ERASURE-PATH-1`).

### Diagram

```mermaid
flowchart TD
  subgraph py["ingestion-service (Python) — REAL Option-A backing"]
    F["custody_factory.select_custody()\nenv CONNECTOR_CUSTODY_BACKING\n(NEW — mirrors custody-factory.ts)"]
    F -->|unset / '' / local| L["Local/Held non-AWS backing\n(DEFAULT — fail-closed)"]
    F -->|'aws-secrets-manager' (opt-in only)| A["AwsSecretsManagerCustody\nget/put/seal — REAL boto3"]
    F -->|UNKNOWN value| L
    A -.->|lazy first-use only| C["_client(): boto3 client\nregion_name='ap-south-1'\n+ residency assert"]
    C -->|moto in CI/local| M["mocked AWS — ZERO real calls"]
  end
  subgraph ts["core-service (TS) — UNCHANGED this build"]
    TF["custody-factory.ts\nlocal-aesgcm default | HeldProductionCustody"]
  end
  subgraph cdk["infra/cdk (TS CDK) — AUTHORED, NOT DEPLOYED"]
    K["KMS CMK ap-south-1"]
    SM["Secrets Manager posture\nCMK-encrypted, region-pinned"]
    IAM["least-priv IAM policy\nGet/Create/Put/Describe/Delete\nbrain/* only + KMS on CMK"]
    K --> SM
    IAM -.scopes.-> SM
  end
  A -. ceremony reads/writes (HELD Stage-8) .-> SM
```

---

## 3. Paradigm

**Declared paradigm:** `sql` *(infra / deterministic — ZERO LLM, ZERO ML)*

**Justification (≥20 words):** Credential custody is deterministic AWS-API I/O + JSON (de)serialization + input validation + IAM/KMS IaC. There is no inference, no ranking, no natural-language generation, no numeric model output anywhere on this path. Any `@paradigm ml/small_llm/frontier_llm` decorator appearing in this build at Stage 6 is a paradigm violation → BOUNCE. Matches the Child-3 custody annotation `@paradigm: sql` already on every touched file. ₹0 inference cost.

> SQL > ML > small_llm >> frontier_llm. No gateway routing involved.

---

## 4. API design

### gRPC protos added or changed
- **None.** Custody is an internal infrastructure adapter behind the `CredentialCustody` Protocol; no cross-service contract changes. The Protocol signature (`custody.py:35`) is LOCKED and unchanged.

### tRPC procedures added or changed
- **None.**

### MCP tools added or changed
- **None.**

### REST endpoints added or changed
- **None.** No public surface. (No new ingress; the backing is consumed by the in-process ingest primitive `ingest.py:428`.)

### Breaking changes
- **None.** The `CredentialCustody` Protocol (get/put/seal signatures) is unchanged. `get` still raises `KeyError` on not-found per the Protocol docstring (`custody.py:48`) — the boto3 `ResourceNotFoundException` is mapped to `KeyError`, preserving the contract. No CTOA/api-versioning trigger.

### Versioning strategy
N/A — no public surface changes. The internal factory env flag is additive (default preserves today's behavior: no AWS).

---

## 5. Data model changes

### Postgres
- **Tables added:** None.
- **Tables changed:** None. (The local non-AWS backing reuses the existing `connector_credentials` table via `LocalAesGcmCustody` analogue — see §16; no schema change.)
- **Indexes:** None.
- **RLS policies:** None changed. (Workspace isolation for the AWS backing is enforced by the secret-name path + `_secret_name` input validation + the IAM resource scope — `CF-CC-WS-ISOLATION-1` — not by Postgres RLS, since AWS-SM is not a Postgres store.)

### ClickHouse
- **Tables added:** None.
- **Materialized views added:** None.

### Migration plan
No DB migration. The only state surfaces are AWS Secrets Manager secrets (provisioned HELD, Stage-8) and the env flag `CONNECTOR_CUSTODY_BACKING`. **Reversibility:** the entire change is reversible by deleting the new files + reverting `aws_secrets_manager_custody.py` to the stub; the env flag defaults to the non-AWS backing so a rollback is a no-op at runtime (nothing selects AWS unless explicitly opted in). `seal()`'s 7-day recovery window makes even a (HELD) live delete reversible for 7 days.

---

## 6. Event model

- **Topics added:** None.
- **Topics changed:** None.
- **Partition key:** N/A (no Kafka surface in this build).
- **Exactly-once strategy:** N/A. (Idempotency note: `put` is a create-or-update upsert — calling it twice with the same content is idempotent; `seal` is idempotent under the recovery window — a second `delete_secret` on an already-scheduled secret is a no-op / handled, asserted in the moto matrix.)

---

## 7. Single-Primitive sweep

> The relevant cross-cutting primitive here is **credential custody**, not the marketing primitives below. The sweep confirms we are extending the ONE existing custody primitive, not forking.

| Primitive | Status |
|-----------|--------|
| Audience Builder | reused (untouched) |
| Consent | reused (untouched) |
| Decision Log | reused (untouched) |
| Notifications | reused (untouched) |
| Attribution | reused (untouched) |
| Identity | reused (untouched) |
| **Credential custody (the relevant primitive)** | **extended — ONE real production backing.** We replace the existing `AwsSecretsManagerCustody` stub in place (not a new class), add the missing factory mirroring the EXISTING TS `custody-factory.ts` (not a new gating mechanism), and DO NOT build the rejected Option-B backing (`supabase_column_custody.py` stays a stub — building it now would be speculative dead code; Single-Primitive: ONE real backing where credentials are actually consumed). The TS `core-service` gets NO parallel AWS backing this build (`CF-CC-OWNER-1`) — giving it one now is speculative duplication. |

**Sweep result: clean. No per-channel/per-vendor fork. No new primitive introduced.** The factory is a mirror of an existing primitive, not a new abstraction.

---

## 8. Multi-tenancy enforcement (4 layers)

Workspace isolation for AWS-SM custody is enforced at the layers that apply to a secret store (not all 4 canonical layers map — AWS-SM is not Postgres/Kafka):

- [x] **JWT** — N/A at this layer; the caller (ingest primitive) is already workspace-scoped upstream (`ingest.py:418` checks the workspace allow-list BEFORE `custody.get`). No change.
- [x] **Service-side** — `_secret_name(workspace_id, vendor)` validates inputs (reject empty/None/`*`/`/`) so a malformed/crafted `workspace_id` cannot widen the read or escape `brain/{ws}/{vendor}/credential` (`CF-CC-WS-ISOLATION-1`). This is the isolation primitive for AWS-SM.
- [x] **DB RLS** — N/A (AWS-SM is not a Postgres store). The IAM resource scope `secret:brain/*` is the single shared ingestion-runtime identity (legitimate — one runtime syncs all workspaces); the path + input validation is what stands between workspace A and B (persona-2 C2, accepted).
- [x] **Kafka envelope** — N/A (no Kafka surface).

---

## 9. Observability plan

> Proportionate to the requirement — no observability beyond what custody correctness + the never-log VETO require. No new dashboards/metrics invented.

| Pillar | Items |
|--------|-------|
| **Metrics** | None new. (Sync-level metrics already exist on the ingest primitive; custody is a sub-call. Adding custody-specific metrics now is over-engineering — not required and a metric label could itself become a leak surface.) |
| **Logs** | Structured log on get/put/seal carrying ONLY `(workspace_id, vendor, secret_name, op, outcome)` — NEVER `SecretString`/`content`/token text (`CF-CC-NEVERLOG-1`). Not-found logs at debug with ids only. |
| **Traces** | None new (custody is an in-process call within the existing sync span). |
| **Alarms** | None new this build (no live AWS to alarm on; CDK authored-not-deployed). The Stage-8 ceremony runbook will add deploy-time alarms — HELD. |
| **Dashboards** | None new. |

---

## 10. Test strategy

> All tests run against `moto` (mocked AWS) — the real boto3 code path executes with ZERO real AWS calls (`CF-CC-NOREAL-AWS-1`). No real-network smoke against AWS this build (that is the HELD Stage-8 ceremony); the "real-network" equivalent here is the moto-backed full path.

| Layer | Plan |
|-------|------|
| **Unit** | `_secret_name` validation matrix (empty/None/`*`/`/`/whitespace → reject; valid uuid+vendor → correct path) — `CF-CC-WS-ISOLATION-1`. Factory selection matrix: unset/`''`/`local`→non-AWS; `aws-secrets-manager`→AWS class; `unknown`/`UNKNOWN`/`Aws-Secrets-Manager`→non-AWS (fail-closed) — `CF-CC-GATE-1`. Residency assert: client built with non-`ap-south-1` effective region → refuse-to-start raise — `CF-CC-RESIDENCY-1`. |
| **Integration** | `moto` `@mock_aws` matrix on the REAL backing: (1) happy `put`→`get` round-trip returns the same content; (2) `get` on a never-stored secret → `ResourceNotFoundException` → `KeyError` (Protocol contract); (3) `put` upsert (twice) is idempotent; (4) `seal` calls `delete_secret` with `RecoveryWindowInDays=7` and `ForceDeleteWithoutRecovery` is NEVER passed (assert kwargs) — `CF-CC-SEAL-RECOVERY-1`; (5) `seal` then `get` behaves per recovery semantics. |
| **Contract** | `assert isinstance(AwsSecretsManagerCustody(), CredentialCustody)` still holds at module load AND makes ZERO AWS calls (assert no boto3 session created at import — `CF-CC-LAZY-1`, see Mutation). CDK: `aws-cdk-lib/assertions` fine-grained template test asserts the IAM policy actions == the exact enumerated set, resource == `secret:brain/*` (no `*`, no wildcard action), KMS actions scoped to the CMK, region == ap-south-1 — `CF-CC-IAM-LEASTPRIV-1`/`CF-CC-RESIDENCY-1`. `cdk synth` must succeed in CI. |
| **E2E (web)** | N/A (no web surface). |
| **E2E (mobile)** | N/A. |
| **Load** | N/A. |
| **Real-network smoke** | **HELD (Stage-8 ceremony).** The moto-backed integration matrix IS the proof-of-real-path for this build; a real AWS call is explicitly forbidden (`CF-CC-NO-LIVE-1`). State this clearly so Tanvi does not bounce on a "missing real smoke" — the real smoke is a named Stage-8 artifact, not this build's gate. |
| **Mutation testing targets** | **THE GATE (verify-the-verifier, `CF-CC-NOREAL-AWS-1`).** Exact kill-test shape below. |

### The verify-the-verifier gate mutation (exact shape for Tanvi/Shreya)

The activation gate is non-vacuous IFF a mutation that removes it makes a test FAIL. Provide a test that, with NO env opt-in and NO real creds, asserts the SAME real code makes ZERO real AWS calls — and that neutering the gate is detected:

1. **Import-time zero-call assert (`CF-CC-LAZY-1`):** patch `boto3.client`/`boto3.session.Session` with a spy that raises on call; `import aws_secrets_manager_custody` (which runs the module-load `assert isinstance`). Assert the spy was NEVER called. **Mutation:** move client construction into `__init__` (or to module scope) → this test FAILS (spy raises at import). If it still passes, the gate is vacuous → BOUNCE.
2. **Fail-closed default assert (`CF-CC-GATE-1`):** with `CONNECTOR_CUSTODY_BACKING` unset and a `boto3.client` spy that raises, call `select_custody()` and exercise a `get`. Assert the returned backing is the non-AWS backing and the spy was NEVER called. **Mutation:** change the factory `default:` branch to return `AwsSecretsManagerCustody()` (auto-activate) → this test FAILS (spy raises / wrong class). If it still passes, fail-closed is vacuous → BOUNCE.
3. **Wrong-region kill (`CF-CC-RESIDENCY-1`):** force the effective region to `us-east-1` (env/param) under the AWS backing; assert construction raises the residency error BEFORE any network call. **Mutation:** remove the residency assert → this test FAILS only if it also detects an attempted wrong-region call; pair with a moto spy on the wrong region so removal is detected.

Tanvi runs these AND independently re-mutates (Stage 5); Shreya treats #1/#2 as VETO surfaces (Stage 4).

---

## 11. Security considerations (forwarded to Shreya — VETO @ Stage 4)

- **IAM least-privilege (`CF-CC-IAM-LEASTPRIV-1`, Shreya gate):** CDK policy MUST enumerate exactly `GetSecretValue, CreateSecret, PutSecretValue, DescribeSecret, DeleteSecret` (+`TagResource` if the secret is tagged) on `arn:aws:secretsmanager:ap-south-1:<acct>:secret:brain/*` ONLY — NO `*` resource, NO wildcard action. KMS: `kms:Decrypt` + `kms:GenerateDataKey` on the specific ap-south-1 CMK ARN only. Asserted by the CDK template test. Read-only is INSUFFICIENT (the ceremony does `put` at STEP 1 and `seal` at STEP 6) — persona-1 C2.
- **Residency (`CF-CC-RESIDENCY-1`):** secret AND CMK both ap-south-1; secret encrypted with the customer-managed ap-south-1 CMK (NOT the default `aws/secretsmanager` key); client `region_name="ap-south-1"` + refuse-to-start if effective region != ap-south-1. Belt-and-suspenders IaC region pin. (DPDP in-region — `CF-RES-1` lineage.)
- **Never-log VETO (`CF-CC-NEVERLOG-1`):** boto3 `ClientError`/`ParamValidationError` `str()` can echo request params — a naive `except Exception as e: log.error(e)` could leak `SecretString`. Error handling carries only ids. Negative-assertion test on success + not-found paths (no token text in any log/exception string). This is a Shreya VETO surface — persona-1 C5 + persona-2 C5.
- **Fail-closed gate (`CF-CC-GATE-1`/`CF-CC-LAZY-1`):** ambient AWS creds (a dev `~/.aws`, `AWS_PROFILE`, an EC2/runner role) could let an eager client silently reach real AWS at import. Lazy construction + fail-closed factory + the import-time zero-call mutation test close this — persona-1 C1. Shreya VETO surface.
- **Workspace isolation (`CF-CC-WS-ISOLATION-1`):** `_secret_name` input validation prevents path-traversal / wildcard widening of the read — persona-2 C2.

---

## 12. India context

| Lens | Impact |
|------|--------|
| RTO / COD / GST / Festival / Pincode / Telecom | None directly (no commerce logic). |
| **DPDP / residency** | **PRIMARY.** Credentials-at-rest in ap-south-1 with an ap-south-1 customer-managed KMS CMK; never-log discipline is a reportable-exposure surface; workspace-erasure path documented (`CF-CC-ERASURE-PATH-1`). **Process note:** any LIVE rotation/provisioning in the HELD Stage-8 ceremony must respect the festival-freeze discipline (no Diwali/Republic-Day/EOSS window) — flagged for the ceremony, not this build. |

### Erasure path (`CF-CC-ERASURE-PATH-1`) — documented, no new bulk API

DPDP erasure / retention-limit obligation for a workspace's stored credentials: **workspace off-boarding erasure = `seal()` invoked across each of that workspace's vendor secrets** (`brain/{ws}/{vendor}/credential` for each on-record vendor). The **7-day recovery window** (`RecoveryWindowInDays=7`) is the **bounded retention tail** — "sealed" ≠ "irrecoverable" for 7 days; this is acceptable under DPDP as a recoverability safeguard but MUST be stated in the erasure runbook so it is not a surprise compliance gap. **No new bulk "delete all secrets for a workspace" API is built this child** (over-engineering) — the path is named and composable from `seal()`. Persona-2 C3.

---

## 13. Region adapter impact

No `RegionAdapter` interface change. Residency (ap-south-1) is enforced at the AWS client + IaC level, consistent with the India-first single-region posture and the analytics-service `assert_clickhouse_residency` precedent. If a future region needs a non-ap-south-1 secret store, that is its own scoped requirement (do not generalize now).

---

## 14. Cost estimate

| Item | Value |
|------|-------|
| **Expected daily volume** | 0 (this build makes ZERO real AWS calls; CI runs against moto). |
| **LLM tokens / day** | 0 (paradigm `sql`, no inference). |
| **₹ / month at expected load** | **₹0 this build.** (HELD Stage-8 live cost, for reference only: AWS Secrets Manager ~$0.40/secret/month + ~$0.05/10k API calls + 1 KMS CMK ~$1/month — order ₹100s/month at small connector counts; NOT incurred until live provisioning, which is Founder-gated.) |

---

## 15. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Eager boto3 client at import reaches real AWS via ambient creds (false-GREEN / live exposure) | HIGH | Lazy `_client()` + fail-closed factory + import-time zero-call mutation test (`CF-CC-LAZY-1`/`CF-CC-NOREAL-AWS-1`); Shreya VETO. |
| `seal()` force-deletes irreversibly (Shiprocket has no replay) | HIGH | `RecoveryWindowInDays=7`; `ForceDeleteWithoutRecovery` forbidden in code; test asserts kwargs (`CF-CC-SEAL-RECOVERY-1`). |
| Secret/CMK in wrong region → DPDP residency breach | HIGH | ap-south-1 pin in IaC + client refuse-to-start + CDK assertion test (`CF-CC-RESIDENCY-1`). |
| Token plaintext leaks via boto3 exception string in a log | HIGH | ids-only error handling + negative-assertion test (`CF-CC-NEVERLOG-1`); Shreya VETO. |
| Read-only IAM breaks `put`/`seal` mid-ceremony | HIGH | Full enumerated action set in CDK policy + assertion test (`CF-CC-IAM-LEASTPRIV-1`). |
| Crafted `workspace_id` widens/escapes the secret read | MEDIUM | `_secret_name` input validation + test (`CF-CC-WS-ISOLATION-1`). |
| First CDK app in repo — pattern drift | LOW | Minimal single stack under `infra/cdk/`; pinned `aws-cdk-lib` (resolve latest-stable, do NOT invent a version); `cdk synth` + assertions test in CI; Jatin owns. |
| New deps (`boto3`/`moto`) widen the dep surface | LOW | `boto3` is required for any real AWS backing (the stub deliberately deferred it); `moto` is test-only (`dev` group). Both justified in §17b. |

---

## 16. Alternatives considered (≥1)

| Alternative | Why rejected |
|-------------|--------------|
| Also build a real AWS backing on the TS `core-service` side now | Speculative duplication. The live credential read path the cutover exercises is Python (`ingest.py:428`); TS keeps `local-aesgcm` + `HeldProductionCustody`. Single-Primitive: ONE real backing where credentials are consumed (`CF-CC-OWNER-1`). A future TS-runtime-reads-AWS need is its own scoped requirement. |
| Construct the boto3 client in `__init__` (simpler) | False-GREEN / live-exposure trap: import-time / ambient-creds path can reach real AWS. Lazy `_client()` is mandatory (`CF-CC-LAZY-1`, persona-1 C1). |
| Build the Option-B (`supabase_column_custody.py`) backing too "in case" | Founder chose Option A; building the rejected backing is dead code. Stays a stub. |
| For the non-AWS factory default, reuse the Python side's existing local backing vs add a thin "held" non-AWS stub | **Decision for the builder:** the Python side has NO `LocalAesGcmCustody` equivalent (that is TS-only). The factory's non-AWS default should return a **non-AWS held backing** (a small Python `HeldProductionCustody`-analogue that raises a clear `NotImplementedError` on use, mirroring `production-custody.ts:35`) — NOT a half-built local crypto backing (out of scope, over-engineering). Local-dev that needs real credentials continues to use the TS path; the Python ingest path in local-dev runs `dry_run`/seeded. This keeps the default fail-closed AND avoids building a new Python crypto backing this child. |
| `mock`/handwritten stubs instead of `moto` | A test that "passes" only because boto3 wasn't installed proves nothing (persona-1 C1). `moto` runs the REAL boto3 path with zero real AWS — the only way to prove the real impl. |
| `CloudFormation`/Terraform instead of CDK | Synthesis + canon name CDK (TS) as the IaC standard (Jatin owns AWS CDK); no reason to introduce a second IaC tool. |

---

## 17. Tracks (work decomposition for Stage 3)

> Two tracks, two owners. **Maya** (backend-developer agent) owns the Python ingestion-service backing + factory + tests — she owns `ingestion-service` per TECH/18 §3.3. **Jatin** (platform-devops agent) owns the CDK stack + its assertion test. Track B has no runtime dependency on Track A (separate languages/dirs) and can run in parallel; Track A is the critical path for the `CF-C7` leg.

### Track A — Python custody backing + fail-closed factory + moto matrix  *(owner: @maya / backend-developer)*

Dependencies: none (replaces existing stub in place).

Tasks (2–5 min each):
1. In `apps/ingestion-service/pyproject.toml`: add `boto3` to `[project].dependencies` and `moto` to `[dependency-groups].dev`. **Resolve + pin latest-stable** for both (do NOT invent a version number; run `uv add` and let it resolve). Run `uv sync`.
2. Create `apps/ingestion-service/src/infrastructure/secrets/held_custody.py` — a Python `HeldProductionCustody`-analogue (get/put/seal raise a clear `NotImplementedError` naming the gate), mirroring `core-service/.../production-custody.ts:35`. `assert isinstance(..., CredentialCustody)` at module load (zero AWS).
3. Create `apps/ingestion-service/src/infrastructure/secrets/custody_factory.py` mirroring `core-service/.../custody-factory.ts:21`: `select_custody(backing: str | None = os.environ.get("CONNECTOR_CUSTODY_BACKING")) -> CredentialCustody`. Branches: `None`/`''`/`'local'` → `HeldProductionCustody`; `'aws-secrets-manager'` → `AwsSecretsManagerCustody`; **default (unknown) → `HeldProductionCustody` (fail-closed, never AWS)**. NO boto3 import at module top — import the AWS class lazily inside the branch or at module top WITHOUT constructing a client (`CF-CC-GATE-1`).
4. In `aws_secrets_manager_custody.py`: add a private `_client()` that lazily constructs `boto3.client("secretsmanager", region_name="ap-south-1")` on first use, caches it, and asserts the effective region == `ap-south-1` (refuse-to-start raise otherwise) — `CF-CC-LAZY-1`/`CF-CC-RESIDENCY-1`. NOT in `__init__`, NOT at module scope.
5. Add `_secret_name` input validation: reject empty/None/`*`/`/`/whitespace `workspace_id` or `vendor` (raise `ValueError` with ids only). Keep the `brain/{ws}/{vendor}/credential` shape — `CF-CC-WS-ISOLATION-1`.
6. Implement `get`: `_client().get_secret_value(SecretId=_secret_name(...), VersionStage="AWSCURRENT")`; JSON-decode `SecretString` into `Credential.content`; map `ResourceNotFoundException` → `KeyError` (Protocol contract); catch boto3 errors and re-raise carrying ONLY ids — never the response/`SecretString` (`CF-CC-NEVERLOG-1`).
7. Implement `put`: create-or-update upsert (`create_secret` with the CMK, falling back to `put_secret_value` on `ResourceExistsException`), `SecretString=json.dumps(content)`; idempotent; ids-only errors.
8. Implement `seal`: `_client().delete_secret(SecretId=..., RecoveryWindowInDays=7)`. `ForceDeleteWithoutRecovery` MUST NOT appear anywhere in the file. ids-only errors — `CF-CC-SEAL-RECOVERY-1`.
9. Keep the module-load `assert isinstance(AwsSecretsManagerCustody(), CredentialCustody)` — verify it constructs NO client (lazy) — `CF-CC-LAZY-1`.
10. Rewrite `apps/ingestion-service/tests/unit/test_custody_stubs.py` (or add `test_aws_secrets_manager_custody.py` + `test_custody_factory.py`): the full §10 unit + `@mock_aws` integration matrix.
11. Add the THREE verify-the-verifier mutation tests exactly per §10 (import-time zero-call, fail-closed default, wrong-region kill). Leave a `# MUTATION:` comment on each describing the mutation that must make it fail (for Tanvi/Shreya).
12. Add a structured-log line on get/put/seal carrying ONLY `(workspace_id, vendor, secret_name, op, outcome)` — `CF-CC-NEVERLOG-1`. Run `uv run pytest`; all green, ZERO real AWS.

### Track B — AWS CDK stack (authored, NOT deployed)  *(owner: @jatin / platform-devops)*

Dependencies: none (parallel with Track A).

Tasks (2–5 min each):
1. Confirm no CDK app exists (grep `aws-cdk-lib` — none today). Create the minimal first CDK app at `infra/cdk/`: `cdk.json`, `package.json` (pin `aws-cdk-lib` + `constructs` to **resolved latest-stable** — do NOT invent a version), `tsconfig.json`, `bin/app.ts`, `lib/credential-custody-stack.ts`. Add `infra/cdk` to the pnpm workspace ONLY if it cleanly fits the enumerated-members rule in `pnpm-workspace.yaml` (it lists explicit members; add `infra/cdk` there); else keep it a standalone npm project with its own lockfile and note why.
2. In `credential-custody-stack.ts`: pin the stack `env.region = "ap-south-1"`. Create a customer-managed `kms.Key` (CMK) with rotation enabled.
3. Define the Secrets Manager residency posture: secrets encrypted with the CMK (NOT the default AWS-managed key), region-pinned. (Do NOT create real secret values — provisioning is HELD; author the construct/policy only, or a representative secret resource for the policy scope.)
4. Author the least-privilege IAM policy (a `iam.PolicyDocument`/managed policy for the ingestion-service role): actions exactly `secretsmanager:GetSecretValue, CreateSecret, PutSecretValue, DescribeSecret, DeleteSecret` (+`TagResource`) on `arn:aws:secretsmanager:ap-south-1:<acct>:secret:brain/*`; KMS `Decrypt`+`GenerateDataKey` on the CMK ARN only. NO `*` resource, NO wildcard action — `CF-CC-IAM-LEASTPRIV-1`.
5. Add a `aws-cdk-lib/assertions` fine-grained template test (`test/credential-custody-stack.test.ts`): assert the IAM policy actions == the exact enumerated set, resource matches `secret:brain/*` (no `*`/wildcard), KMS scoped to the CMK, stack region == ap-south-1 — `CF-CC-IAM-LEASTPRIV-1`/`CF-CC-RESIDENCY-1`.
6. Verify `cdk synth` succeeds locally and the assertions test passes. **DO NOT `cdk deploy`** (`CF-CC-NO-LIVE-1`). Add a one-line README in `infra/cdk/` stating "authored, NOT deployed; deployment is the HELD Stage-8 ceremony."

### Track C — Rulings + docs (Aryan-authored here; builder files the follow-up)  *(owner: @maya, mechanical)*

Dependencies: none.

Tasks:
1. **Shopify HMAC ruling (`CF-CC-SHOPIFY-HMAC-1`) — SEPARATE tracked follow-up.** The app-level `SHOPIFY_CLIENT_SECRET` (config key `shopify.app_hmac_secret`, named in `custody.py:23`) is a Partner-app secret with NO `workspace_id`, consumed by TS webhook verification BEFORE any webhook arrives. It does NOT share this build's per-workspace primitive (different shape, different runtime owner). File a tracked follow-up `chore-app-hmac-secret-custody` under WS-1: clean home `brain/_app/shopify/hmac_secret`, TS consumer. Builder adds a one-line stub note in `custody.py` pointing to the follow-up. **Do NOT fold into the per-workspace model; do NOT drop.**
2. **Erasure path doc (`CF-CC-ERASURE-PATH-1`):** add the §12 erasure-path paragraph (workspace erasure = `seal()` across the workspace's vendors; 7-day recovery window = bounded retention tail) as a docstring/runbook note in `held_custody.py` or `custody.py`. No new bulk API.

### Over-engineering self-check

| Item | Verdict |
|------|---------|
| Plan length matches prescriptive band (high-stakes, security-critical, false-GREEN trap) | PASS — prescriptive is the correct band; depth is load-bearing, not padding. |
| Every §17 file required by the requirement | PASS — `aws_secrets_manager_custody.py` (replace stub), `custody_factory.py` + `held_custody.py` (the missing gate, mandated by `CF-CC-GATE-1`), tests, CDK stack + test. No "while we're in there" files. |
| No new deps unless justified | PASS — `boto3` (runtime, required for ANY real AWS backing; stub deliberately deferred it) + `moto` (test-only, the only way to prove the real path with zero AWS) + `aws-cdk-lib`/`constructs` (the IaC, no CDK app existed). Each justified. |
| No new abstractions for hypothetical future use | PASS — factory MIRRORS the existing TS primitive (not new); no TS AWS backing, no Option-B build, no bulk-erasure API, no extra metrics. |
| No observability beyond what the requirement names | PASS — one ids-only log line (never-log VETO); no new metrics/dashboards/alarms. |
| No tests for trivial getters; tests target behavior at integration points | PASS — tests target the moto round-trip, the gate mutation, residency, never-log, IAM template. |
| Test strategy proportionate to risk | PASS — high-stakes security; the matrix + 3 mutations are proportionate, not excessive. |

**Over-engineering self-check: PASS (all 7).**

---

## 17b. Acceptance contract (AC ↔ CF ↔ verifiable artifact ↔ bounce conditions)

> Every one of the 13 CFs maps to a verifiable artifact and a named bounce condition. Builders treat each `must-fix` as a **pass-1** item (shift-left self-review per system-prompt §11) — NOT something for Shreya/Tanvi/Rohan to first catch.

| AC | CF | Owner | Verifiable artifact | Bounce condition (Stage 4 Shreya / 5 Tanvi / 6 Rohan) |
|----|----|-------|---------------------|--------------------------------------------------------|
| AC-1 | CF-CC-OWNER-1 | Maya | Real backing ONLY in Python `aws_secrets_manager_custody.py`; TS `core-service` untouched (no AWS backing) | S6: any TS AWS backing added → BOUNCE |
| AC-2 | CF-CC-GATE-1 | Maya | `custody_factory.py` mirrors `custody-factory.ts`; unset/`''`/`local`→held; `aws-secrets-manager`→AWS; unknown→held; unit matrix green | S4/S5: default/unknown selects AWS, or no factory → BOUNCE |
| AC-3 | CF-CC-LAZY-1 | Maya | `_client()` lazy; import-time zero-call mutation test passes (spy never called at import) | S4/S5: client in `__init__`/module scope, or import makes an AWS call → BOUNCE |
| AC-4 | CF-CC-NOREAL-AWS-1 | Tanvi | `@mock_aws` matrix runs the real boto3 path; 3 mutation tests present with `# MUTATION:` notes; ZERO real AWS in CI | S5: a mutation passes when it should fail (vacuous gate), or any real AWS call → BOUNCE |
| AC-5 | CF-CC-IAM-LEASTPRIV-1 | Jatin/Shreya | CDK assertions test: exact action set on `secret:brain/*`, KMS on CMK only, no `*`/wildcard | S4: `*` resource, wildcard action, or read-only (missing put/seal) → BOUNCE |
| AC-6 | CF-CC-SEAL-RECOVERY-1 | Maya | `seal` test asserts `RecoveryWindowInDays=7`; `ForceDeleteWithoutRecovery` absent from the file | S4/S5: force-delete present, or recovery window != 7 → BOUNCE |
| AC-7 | CF-CC-RESIDENCY-1 | Maya/Jatin | Client `region_name="ap-south-1"` + refuse-to-start assert; CDK region pin + CMK ap-south-1; wrong-region kill test | S4: wrong region accepted, default AWS-managed key, or CMK not ap-south-1 → BOUNCE |
| AC-8 | CF-CC-WS-ISOLATION-1 | Maya | `_secret_name` validation rejects empty/None/`*`/`/`; escape-attempt test | S4/S5: crafted id escapes `brain/{ws}/{vendor}/credential` → BOUNCE |
| AC-9 | CF-CC-NEVERLOG-1 | Shreya (VETO) | ids-only error/log paths; negative-assertion test (no token in any log/exception) on success + not-found | S4: any path where `SecretString`/`content`/token can reach a sink → VETO BOUNCE |
| AC-10 | CF-CC-ERASURE-PATH-1 | Maya | §12 erasure paragraph present as docstring/runbook note (seal-across-vendors + 7-day tail) | S6: erasure path undocumented → BOUNCE |
| AC-11 | CF-CC-SHOPIFY-HMAC-1 | Maya | `chore-app-hmac-secret-custody` follow-up filed; one-line pointer note in `custody.py`; NOT folded in | S6: HMAC folded into per-workspace model, or silently dropped → BOUNCE |
| AC-12 | CF-CC-C7-LEG-1 | Rohan (S6) | Only the real-`seal()`/`get()` leg satisfied; vendor-200 + parity legs + DELETE PoNR remain HELD | S6: any HELD leg executed/claimed-done → BOUNCE |
| AC-13 | CF-CC-NO-LIVE-1 | Tanvi/Rohan | ZERO real AWS provisioning/calls/rotation/DELETE; CDK `synth`-only; no commit without Founder "commit it" | S5/S6: any real AWS call, `cdk deploy`, or unauthorized commit → BOUNCE |
| AC-14 | (paradigm) | Rohan (S6) | No `@paradigm ml/small_llm/frontier_llm` decorator anywhere | S6: any non-`sql` paradigm decorator → BOUNCE |

---

## 18. CTO Advisor paradigm sign-off

> Rohan's Stage-1 review (`02-cto-advisor-review.md` "Paradigm recommendation") already records: `sql` (infra/deterministic — ZERO LLM/ZERO ML); any LLM/ML decorator at Stage 6 = BOUNCE. This plan adopts that paradigm unchanged.

**Confirmed by CTO Advisor:** 2026-05-29T16:00:00Z (Stage-1 review; re-affirm at Stage-6 final review).

---

## Handoff (folded — no separate 07)

Per the handoff-depth calibration: this is a single binding plan with a fully prescriptive §17 Tracks + §17b acceptance contract. A separate `07-handoff-to-developer.md` is NOT warranted — the work is two clean tracks (Python / CDK), already prescriptive at the task level with file paths, and a separate handoff file would duplicate §17/§17b. **Fold into this plan.** (A separate 07 is reserved for multi-track scope-creep-prone work that needs a distinct cross-builder sequencing doc; this does not.)

**Stage-3 spawn:** TWO builders in parallel — `backend-developer` (Maya — Track A + C, Python ingestion-service, the critical path) and `platform-devops` (Jatin — Track B, CDK). Track B is parallel-safe (separate dir/language, no runtime dep on A).

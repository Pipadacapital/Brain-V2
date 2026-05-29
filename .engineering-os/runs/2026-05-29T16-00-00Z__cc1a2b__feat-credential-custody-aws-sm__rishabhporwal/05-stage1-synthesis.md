# Stage 1 Synthesis — feat-credential-custody-aws-sm

**Rohan (cto-advisor) · 2026-05-29T16:00:00Z · Decision: ADVANCE → Architect (Aryan), Stage 2**

Both personas ACCEPTED (5 concerns each, 10 total, 0 dropped, 0 "looks good"). Folded into the CF contract below.

---

## 1. What this build IS (and is NOT)

**IS:** Replace the `NotImplementedError` stubs with a REAL boto3-backed `AwsSecretsManagerCustody` (get/put/seal)
in the Python `ingestion-service`, behind an **activation-gated factory**, with **ap-south-1 + KMS CMK** residency,
**least-privilege IAM** expressed in **AWS CDK (TypeScript)**, and **mocked-boto3 (`moto`) tests** proving the happy
path / not-found / region-assert / 7-day-recovery `seal` / never-log — with **ZERO real AWS calls in CI or local**.

**IS NOT (HELD for Stage-8 Founder/Jatin-at-console ceremony):** real AWS provisioning, IAM role creation, the AWS
account/credentials, live token rotation into Secrets Manager, the legacy-plaintext DELETE PoNR, and the remaining
`CF-C7-CUSTODY-PROOF-1` legs (a Brain call via the PRODUCTION custody path returning vendor 200 + parity GREEN).
This build makes ONLY the "real `seal()`/`get()` non-NotImplementedError" leg satisfiable.

---

## 2. The two Founder-flagged boundary questions — RULED

### Q1. Python vs TS custody ownership — where does the real Option-A backing live?
**Ruling (binding for Aryan): the real Option-A backing is ONLY the Python `aws_secrets_manager_custody` in
`ingestion-service`.** The connector credentials are read by ingestion-service (Python) per the Child-3 escalation
(`R-CRED-01` destination, the sync runtime). The TS `core-service` side keeps `local-aesgcm-custody` for its own
local-dev purpose and KEEPS `HeldProductionCustody` as the held production stub — it does NOT get an AWS backing in
this build. Rationale: the live credential read path that the cutover ceremony exercises is Python; giving the TS
side a parallel AWS backing now is speculative duplication (Single-Primitive — one real production backing, where the
credentials are actually consumed). If a future requirement needs core-service to read vendor secrets at runtime from
AWS, that is its own scoped requirement. **Aryan names this boundary explicitly in the plan** (`CF-CC-OWNER-1`).

### Q2. Activation gating — the real backing must NOT auto-activate
**Ruling: bind a Founder-gated factory selection that mirrors the TS `custody-factory.ts`.** There is NO Python
factory today — Aryan must add one. Contract: an env flag (e.g. `CONNECTOR_CUSTODY_BACKING`) where unset/`local`
selects a non-AWS backing and `aws-secrets-manager` is opt-in; default/unknown **fails closed to a non-AWS backing
(never AWS)**. Local-dev stays on the local backing. The boto3 client is **lazily constructed at first use** (NOT in
`__init__`, NOT at module import) so the module-load `assert isinstance(...)` and any plain import make ZERO AWS
calls. `CF-CC-GATE-1` + `CF-CC-LAZY-1`.

### Q3. The app-level Shopify HMAC secret (`SHOPIFY_CLIENT_SECRET`) — in-scope or separate?
**Ruling: SEPARATE tracked follow-up, NOT folded into the per-workspace model.** It is a Partner-app secret with
NO `workspace_id`, needed to verify Shopify webhooks before any webhook arrives — storing it in
`brain/{workspace_id}/{vendor}/credential` is a category error (persona-2 C4). The CLEAN home is a distinct
non-workspace-scoped path (e.g. `brain/_app/shopify/hmac_secret`). It is cheap, but it is a DIFFERENT custody
shape and a different consumer (TS webhook verification, not Python sync). To keep this build a single coherent
primitive, **Aryan MAY include it as a small explicit addendum IF it does not expand the runtime/owner boundary
(it does — it's a TS-side concern); otherwise file `chore-app-hmac-secret-custody` as a tracked follow-up under
WS-1.** Default ruling: **separate tracked item** (`CF-CC-SHOPIFY-HMAC-1` — name it, do not silently drop it).
Aryan may collapse it in with a one-line rationale only if the shape genuinely shares this build's primitive.

---

## 3. CF contract bound to Stage 2 (Aryan)

| CF id | Severity | Owner | Binding |
|-------|----------|-------|---------|
| **CF-CC-OWNER-1** | HIGH | Aryan | Real Option-A backing is ONLY the Python `ingestion-service` `aws_secrets_manager_custody`. TS stays local-aesgcm + HeldProductionCustody (no AWS backing this build). Name the boundary. |
| **CF-CC-GATE-1** | CRITICAL | Aryan | Add a Python custody factory mirroring `custody-factory.ts`: unset/`local`→non-AWS backing; `aws-secrets-manager`→opt-in; unknown→fail closed to non-AWS. Default/CI/local NEVER selects AWS. |
| **CF-CC-LAZY-1** | CRITICAL | Aryan/dev | boto3 client constructed LAZILY at first use — not in `__init__`, not at module import. Module-load `assert isinstance` + plain import make ZERO AWS session/network calls. (Persona-1 C1.) |
| **CF-CC-NOREAL-AWS-1** | CRITICAL | Tanvi (gate) | Tests run against `moto` (mocked AWS) so the real boto3 path executes; CI/local make ZERO real AWS calls. Mutation: removing the gate makes a test FAIL (attempted real/wrong-region call detected), not silently pass. (Persona-1 C1 verify-the-verifier.) |
| **CF-CC-IAM-LEASTPRIV-1** | HIGH | Aryan/Shreya | CDK IAM policy enumerates exactly: `GetSecretValue, CreateSecret, PutSecretValue, DescribeSecret, DeleteSecret` (+`TagResource` if tagging) + KMS `Decrypt`/`GenerateDataKey` on the CMK only; resource-scoped to `arn:aws:secretsmanager:ap-south-1:<acct>:secret:brain/*`; NO `*` resource, NO wildcard action. (Persona-1 C2.) |
| **CF-CC-SEAL-RECOVERY-1** | HIGH | Aryan/dev | `seal()` = `delete_secret(RecoveryWindowInDays=7)`; `ForceDeleteWithoutRecovery` FORBIDDEN in code; test asserts the recovery-window arg + that force-delete is never passed. (Persona-1 C3.) |
| **CF-CC-RESIDENCY-1** | HIGH | Aryan/Shreya | Secret AND its KMS CMK BOTH provisioned in ap-south-1 (CDK region-pinned); secret encrypted with the ap-south-1 customer-managed CMK (not the default AWS-managed key); client constructed with explicit `region_name="ap-south-1"` + refuse-to-start if effective region != ap-south-1. (Persona-1 C4 + Persona-2 C1; CF-RES-1 lineage.) |
| **CF-CC-WS-ISOLATION-1** | HIGH | Aryan/dev | `_secret_name` validates `workspace_id`/`vendor` — reject empty/None/`*`/`/`-containing inputs (no path traversal, no wildcard widening). Test asserts a crafted id cannot escape `brain/{ws}/{vendor}/credential`. (Persona-2 C2.) |
| **CF-CC-NEVERLOG-1** | HIGH | Shreya (VETO) | No `Credential.content`/`SecretString`/token text in any log/exception/return — error paths carry only `(workspace_id, vendor, secret_name)` ids. `get` raises `KeyError` on `ResourceNotFoundException`. Negative-assertion test on success + not-found. (Persona-1 C5 + Persona-2 C5.) |
| **CF-CC-ERASURE-PATH-1** | MEDIUM | Aryan | Document workspace-erasure = `seal()` across the workspace's vendor secrets; document the 7-day recovery window as the bounded retention tail in the erasure runbook. No new bulk-delete API this child. (Persona-2 C3.) |
| **CF-CC-SHOPIFY-HMAC-1** | MEDIUM | Aryan | Rule the app-level `SHOPIFY_CLIENT_SECRET` custody line: default = SEPARATE tracked follow-up under WS-1 (non-workspace-scoped path `brain/_app/shopify/hmac_secret`, TS consumer). May collapse into this build only with a one-line rationale if it genuinely shares the primitive. Do NOT fold into the per-workspace model; do NOT silently drop. (Persona-2 C4.) |
| **CF-CC-C7-LEG-1** | HIGH | Rohan (Stage 6) | This build satisfies ONLY the `CF-C7-CUSTODY-PROOF-1` "real seal()/get() non-NotImplementedError" leg. The vendor-200-over-prod-path + parity-GREEN legs stay HELD for the Stage-8 ceremony. The DELETE PoNR remains gated on ALL legs. (Inherited from connector-cutover state.) |
| **CF-CC-NO-LIVE-1** | HIGH | Tanvi/Rohan | ZERO real AWS provisioning/calls/rotation/DELETE this build. CDK is authored, NOT deployed. No commit without Founder "commit it". |

---

## 4. Paradigm + cost
`sql` (infra). ZERO LLM, ZERO ML, ₹0 inference. Any LLM/ML decorator at Stage 6 = BOUNCE.

## 5. Headline Stage-2 obligations for Aryan
1. Author the Python custody factory (mirror `custody-factory.ts`); name the Python↔TS ownership boundary (Q1/`CF-CC-OWNER-1`).
2. Bind lazy boto3 construction + activation gating that fails closed (`CF-CC-GATE-1`/`CF-CC-LAZY-1`).
3. Author the CDK (TS) stack: Secrets Manager + ap-south-1 CMK + least-privilege IAM (`CF-CC-IAM-LEASTPRIV-1`/`CF-CC-RESIDENCY-1`) — authored, NOT deployed.
4. Specify `seal()` 7-day recovery + force-delete prohibition (`CF-CC-SEAL-RECOVERY-1`).
5. Specify the `moto`-based test matrix + the verify-the-verifier mutation on the gate (`CF-CC-NOREAL-AWS-1`) for Tanvi.
6. Rule the Shopify HMAC line (`CF-CC-SHOPIFY-HMAC-1`) + document the erasure path (`CF-CC-ERASURE-PATH-1`).
7. Add `boto3` + `moto` (test-only) to `apps/ingestion-service/pyproject.toml` — declare them (the stub deliberately avoided boto3; the real impl needs it).

## 6. Escalation
**NONE fired.** Option A is decided (no compliance ambiguity, residency unambiguous, no cost-model threat — pure
infra/sql, no moat change, build is additive/reversible). One **non-blocking Founder READINESS item** (not an
escalation): the Stage-8 ceremony needs a real AWS account with ap-south-1 enabled + the CMK + connector-cutover
credentials available to rotate — that is the HELD provisioning prerequisite, surfaced to
`pending-founder-attention.md` so it can be lined up ahead of the Stage-8 cutover, not as a blocker on THIS build.

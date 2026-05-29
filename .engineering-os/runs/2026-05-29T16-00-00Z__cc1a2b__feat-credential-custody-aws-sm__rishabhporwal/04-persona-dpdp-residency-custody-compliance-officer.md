# Persona — dpdp-residency-custody-compliance-officer (`:sonnet`)

> Adversarial brief (Rohan, Stage 1). Mandate: the real Option-A backing stores LIVE vendor credentials
> (OAuth tokens / API keys) — these are confidential commerce credentials, and the secret path is keyed by
> `workspace_id`. Pressure-test: (a) DPDP/residency for credentials-at-rest in AWS Secrets Manager, (b) the
> KMS envelope-encryption + per-region CMK posture vs the canon's "per-workspace KMS / India in-region",
> (c) workspace isolation in the secret-name + IAM scope, (d) erasure/rotation under DPDP when a workspace
> off-boards, (e) the app-level Shopify HMAC secret custody line. ≥1 concern mandatory.

## Concerns

### C1 (HIGH) — ap-south-1 residency must hold for BOTH the secret AND its KMS CMK
Canon (technical-context §13 + §6): India data in-region by default (ap-south-1); OAuth tokens via KMS
envelope encryption. Secrets Manager stores ciphertext in-region, but a secret encrypted with a CMK in a
different region (or the AWS-managed `aws/secretsmanager` key without region intent) muddies the residency
story and the per-workspace KMS posture.
- **Bind:** the CDK provisions the Secrets Manager secrets AND a customer-managed KMS CMK BOTH in ap-south-1;
  the secret is encrypted with the ap-south-1 CMK (not the default AWS-managed key). Residency is asserted in
  IaC (region-pinned) and at the client (persona-1 C4). This is the `CF-RES-1` lineage carried forward.

### C2 (HIGH) — workspace isolation must be enforced in IAM/path, not just convention
The secret name `brain/{workspace_id}/{vendor}/credential` embeds `workspace_id`, and the IAM scope is
`secret:brain/*` — i.e. ONE ingestion-service identity can read ALL workspaces' secrets. That is acceptable for
a single shared ingestion runtime (it already legitimately reads every workspace's tokens to sync), BUT it means
the secret-name construction is the ONLY thing standing between workspace A's sync and workspace B's credential.
- **Bind:** `_secret_name` must reject an empty/None/`*`/`/`-containing `workspace_id` or `vendor` (no path
  traversal, no wildcard injection) — a malformed id must NOT widen the read. A test asserts a crafted
  `workspace_id` cannot escape the `brain/{ws}/{vendor}/credential` shape. (Cross-workspace RLS is enforced
  elsewhere; here the isolation primitive is the path + the input validation.)

### C3 (MEDIUM) — DPDP erasure: off-boarding a workspace must be able to destroy its credentials
DPDP erasure / retention-limit obligations mean a workspace's stored credentials must be deletable on
off-boarding. `seal(workspace_id, vendor)` does this per-vendor, but there is no "delete ALL secrets for a
workspace" affordance, and the 7-day recovery window means "deleted" ≠ "gone" for a week.
- **Bind:** document (this child) that workspace-erasure = `seal()` across all that workspace's vendor secrets,
  and that the 7-day recovery window is the bounded retention tail (acceptable under DPDP as a recoverability
  safeguard, but it MUST be documented in the erasure runbook so it isn't a surprise compliance gap). No new
  bulk-delete API needs building this child — but the erasure path must be named, not silently absent.

### C4 (MEDIUM) — the app-level Shopify HMAC secret (`SHOPIFY_CLIENT_SECRET`) needs an explicit ruling, not silence
`custody.py` already flags `shopify.app_hmac_secret` as a SEPARATE custody line — it is the Partner-app secret
(NOT a per-brand OAuth token), not keyed by `workspace_id`, and Brain must hold it to verify Shopify webhooks
BEFORE any webhook arrives. Storing it in the per-workspace `brain/{ws}/{vendor}/credential` shape is a category
error (it has no workspace).
- **Bind:** Rohan/Aryan must rule whether this is IN scope here (as a distinct, non-workspace-scoped secret
  path, e.g. `brain/_app/shopify/hmac_secret`) or a SEPARATE tracked item. Either is fine — but it must not be
  silently folded into the per-workspace model or silently dropped. (Rohan's call below: name it, scope it as a
  small in-scope addendum if cheap, else a tracked follow-up — do not leave it ambiguous.)

### C5 (LOW) — never-log discipline is a compliance requirement, not just hygiene
PII-in-logs is a canon "never store" item; a leaked OAuth token in a log is a reportable secret exposure.
Reinforces persona-1 C5 from the compliance side: the never-log/never-serialize contract is a Shreya VETO surface,
and the mocked-boto3 tests must include a negative assertion that no token text reaches any sink.

## Escalate? No canon AMBIGUITY here — residency is unambiguous (ap-south-1, DPDP §16/in-region), Option A is
decided, and the secret store is in-region. The ONLY Founder prerequisite is the existence of the real AWS
account + ap-south-1 enablement + the KMS CMK — which is the HELD Stage-8 provisioning, not a build blocker and
not a compliance ambiguity. So: no `/escalate`; flag the AWS-account existence as a non-blocking Founder
readiness item (Rohan mirrors it, does not escalate).

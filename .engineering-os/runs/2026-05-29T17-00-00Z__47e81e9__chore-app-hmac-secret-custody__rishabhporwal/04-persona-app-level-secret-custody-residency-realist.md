# Dynamic Persona Review — app-level-secret-custody-residency-realist

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **Persona** | app-level-secret-custody-residency-realist (`:sonnet` — reasoning over retrieval-shape trade-off + residency + Single-Primitive reuse vs the merged per-workspace custody) |
| **Timestamp** | 2026-05-29T17:04:00Z |

---

## What this lens sees

The merged `feat-credential-custody-aws-sm` built a **per-workspace** `AwsSecretsManagerCustody`
in the **Python ingestion-service** (lazy boto3, ap-south-1 residency assert, fail-closed factory
gate, never-log, recovery-window seal, least-priv CDK). This secret is a different SHAPE — app-level,
singleton, no `workspace_id`, and (for the webhook leg) read before any workspace exists. The
temptation is to either (a) jam it through the per-workspace primitive (architecturally wrong — the
parent explicitly forbade folding), or (b) leave it as a plaintext env var forever. The honest middle
is a small app-level retrieval seam that REUSES the parent's lazy-client/residency/never-log
machinery but with a singleton key, no workspace path component, and a boot-time/cached read.

The subtle trap: there are now potentially **two** retrieval homes for the same secret value — the
**TS** core-service (C1/C2 OAuth) and the **Python** ingestion-service (C3 webhook). A naive design
provisions one Secrets Manager key but writes two unrelated retrieval clients, doubling the residency/
IAM/never-log surface and risking drift.

---

## Concerns

### Concern 1
- **Severity:** high
- **Concern:** Retrieval-shape decision (Secrets Manager singleton `brain/_app/shopify/hmac_secret` vs a custody-modelled env var) is unresolved and has real trade-offs. Secrets Manager gives rotation + audit + residency-consistency with the per-workspace creds, but adds a boot-time AWS dependency + a fail-closed cold-start path. An env var is simpler/faster but is exactly the plaintext-vault posture being closed (and "env var with a custody plan" is a euphemism unless the plan names WHO injects it from WHERE).
- **Rationale:** Picking "env var" silently re-opens the posture this requirement exists to close. Default should be the Secrets Manager singleton, reading at boot into a cached value — but Aryan must name the cold-start fail-closed behavior and the dev/local fallback (local-aesgcm-style: env var allowed in dev, AWS required in prod, gated by the same factory flag as the parent).

### Concern 2
- **Severity:** high
- **Concern:** Two retrieval clients (TS for C1/C2, Python for C3) for one secret. This violates the spirit of Single-Primitive and doubles the residency/IAM/never-log audit surface. But the secret IS read from two runtimes (TS OAuth flow + Python webhook). The design must decide: one provisioned key, two thin runtime readers that each carry the residency-assert + never-log discipline — and that duplication must be explicit and individually tested, not accidental.
- **Rationale:** The parent built ONLY the Python custody backing (TS kept local-aesgcm + HeldProductionCustody, no AWS — CF-CC-OWNER-1). This slice forces the question of whether TS now ALSO needs an app-level Secrets Manager reader, or whether C1/C2 stay env-var-injected in TS while only C3 (Python) reads from Secrets Manager. That boundary call is the architectural crux for Aryan.

### Concern 3
- **Severity:** high
- **Concern:** Residency — the singleton secret + its CMK MUST be ap-south-1, and any new retrieval client MUST carry the same region-assert/refuse-to-start guard the parent shipped (CF-CC-RESIDENCY-1). An app-level key is easy to provision in a default (us-east-1) region by reflex.
- **Rationale:** DPDP in-region-by-default (TECH/16). The Shopify HMAC secret is not customer PII, but consistency with the residency posture + the CMK home matters for the IAM/KMS story and avoids a cross-region data-plane call.

### Concern 4
- **Severity:** medium
- **Concern:** Rotation policy is undefined and app-level rotation is OPERATIONALLY HARD — rotating a Shopify Partner-app secret means rotating it in the Shopify Partner dashboard AND in custody in lock-step, or in-flight webhooks/OAuth break. This is NOT auto-rotatable by Secrets Manager alone (it can't talk to Shopify's dashboard).
- **Rationale:** A naive "enable Secrets Manager auto-rotation" would generate a new value Shopify doesn't know about and break every signature. Rotation must be a documented manual/console ceremony (Founder/Jatin): set new secret in Shopify Partner dashboard → put-secret-value in custody → cache refresh. Define it; don't auto-rotate.

### Concern 5
- **Severity:** medium
- **Concern:** The live `shpss_…` value is sitting in `apps/api-gateway/.env:27` in plaintext and was visible at grounding. The build must (a) never print/commit it, (b) leave the env value untouched for dev but route prod through custody, and (c) the value in `.env` should be treated as COMPROMISED-by-exposure and rotated at the Stage-8 console ceremony (it appeared in tool output / journals).
- **Rationale:** Never-log discipline (Shreya VETO). A secret that has been pasted into a working tree + observed should be rotated on cutover regardless of git-ignore status.

---

## Recommendations

1. Default the retrieval shape to a Secrets Manager **singleton** `brain/_app/shopify/hmac_secret` (ap-south-1, app CMK), read at boot/cached, with a dev fallback to env var gated by the SAME factory flag the parent shipped (local → env; aws-secrets-manager → custody; unknown → fail-closed-to-non-AWS). Name the cold-start fail-closed behavior.
2. Reuse the parent's lazy-client + region-assert + never-log + recovery-window primitives; do NOT invent a parallel custody class. Decide explicitly whether TS (C1/C2) also reads from Secrets Manager or stays env-injected while only Python (C3) reads from custody — bind the answer as a CF.
3. Bind ap-south-1 residency + region-assert on every new retrieval client (CF, inherited from CF-CC-RESIDENCY-1).
4. Document rotation as a MANUAL two-place ceremony (Shopify Partner dashboard + custody put-value + cache refresh); FORBID Secrets Manager auto-rotation for this key.
5. Treat the exposed `.env` `shpss_…` value as compromised → rotate at the Stage-8 console ceremony; build never prints/commits it.

---

## Skills consulted
- `llm-gateway` (custody/secrets posture reference — N/A inference)
- `india-commerce-economics` (DPDP residency)
- `architecture-patterns`
- `code-review`

---

## One line for the CTO Advisor synthesis

**Default to a Secrets Manager ap-south-1 singleton read at boot/cached (env fallback gated by the parent's factory flag), reuse the parent's lazy/residency/never-log primitives without a parallel class, decide explicitly whether TS-OAuth also reads custody or stays env-injected, document rotation as a manual two-place ceremony (NO auto-rotation), and rotate the exposed `.env` value at cutover.**

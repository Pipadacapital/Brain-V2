# 02 — CTO Advisor Review (Stage 1) — chore-ts-oauth-app-secret-custody

**Reviewer:** Rohan (CTO Advisor) · **Stage:** 1 (intake + brainstorm) · **2026-05-29T18:30:00Z**

## Decision: ADVANCE → Stage 2 (Aryan)

Sound, planable, dependency-satisfied, scope-bounded. Not a CHALLENGE-BACK (the parent already
ruled the shape and named this slice) and not a KILL (closing a deliberately-left interim on a
security-load-bearing auth secret is real, scoped work).

## Lane decision

- **`feature_class`: high-stakes.**
- **Rationale:** trigger surfaces touched = **auth** (Shopify OAuth-callback HMAC gate + token
  exchange), **secrets-custody** (`SHOPIFY_CLIENT_SECRET`), **connectors** (Shopify OAuth path),
  **india-compliance** (DPDP residency — secret stays ap-south-1, never-log). Foundational-scaffolding
  carve-out is **barred** (live-credential auth surface + a compliance/secrets surface). Conservative
  tie-break is moot — the high-stakes surfaces are unambiguous. Identical posture to the parent.
- `trigger_surfaces_touched`: `["auth","secrets-custody","connectors","india-compliance"]`.
- **Stages that run:** 1 (this) → 2 Architect (Aryan) → 3 build → 4 Security (Shreya VETO) →
  5 QA (Tanvi VETO) → 6 Final review (Rohan VETO) → 7 Founder gate (delegated to Rohan) → 8 deploy
  (HELD behind the live-injection ceremony).

## Paradigm (first-pass)

**`sql`** — config/crypto/infra I/O only: HMAC-SHA256 (unchanged), a defensive env presence assert,
and CDK task-def secret mapping. **Zero ML, zero LLM, zero inference.** Identical to the parent
(`sql`, ₹0/mo). Any `@paradigm` LLM/ML decorator or new inference runtime appearing in this slice is
an immediate paradigm-bypass **BOUNCE** at Stage 6.

## Persona-count decision

- **Count: 1.** (Lane cap for high-stakes is 2; I am choosing 1 deliberately, within the cap.)
- **Rationale (classifier rule fired = "a single risk dimension dominates"):** the entire slice is one
  fault line — *does the chosen mechanism deliver the secret to TS while keeping core-service AWS-free
  AND fail fast on a missing secret.* "Injection-correctness" and "boundary-preservation" are not two
  distinct dimensions; they are the same question asked from the mechanism side and the architecture
  side. A second persona would duplicate, not add signal. Compliance is already a SETTLED inherited
  constraint (residency ap-south-1 + never-log, ruled in the parent) — no live ambiguity, so no
  separate compliance persona. No compute path, so no cost persona.
- **Persona spawned:** `secret-injection-boundary-realist:haiku` — bounded, checklist/mechanism angle
  (task-def `secrets:` vs entrypoint fetch vs a Node SDK; fail-fast presence assert; no AWS SDK import;
  never-log preserved; rotation-without-redeploy behavior). `:haiku` because it is a bounded
  mechanism/checklist stress-test, not multi-step reasoning — ~6× cheaper, sufficient signal.
- **Depth tag rationale:** the parent ran two `:sonnet` personas because it was deciding the custody
  *paradigm* (Option A AWS SM) and the residency model from scratch. Here the paradigm is inherited;
  only the mechanism on a known boundary is in question — `:haiku` is the right tier.

## The crux — THE INJECTION RULING (CF-HMAC-TS-OWNER-INJECT-1)

**RULED: platform env-injection. TS keeps `requireEnv('SHOPIFY_CLIENT_SECRET')` unchanged and NEVER
imports an AWS SDK.** At deploy, the container/task injects the secret value from Secrets Manager
(`brain/_app/shopify/hmac_secret`) into the `SHOPIFY_CLIENT_SECRET` env var via the ECS/EKS task-def
`secrets:` mapping (CDK). core-service reads it exactly as today.

**Why this and not "TS reads SM directly":**

1. **Preserves CF-CC-OWNER-1.** A Node AWS Secrets Manager client in core-service would re-introduce a
   SECOND AWS retrieval client in a SECOND runtime that the parent *deliberately* kept AWS-free. That
   doubles the residency/IAM/never-log audit surface for zero marginal security. The parent named THIS
   follow-on precisely to do the move *without* that — flipping to a direct SM read would silently
   reverse the parent's binding ruling.
2. **It is the canon/stack-native pattern.** Secrets = AWS Secrets Manager + KMS (technical-context §2);
   platform secret-injection at the task boundary is the standard way a non-AWS-SDK service consumes a
   managed secret. The CDK stack ALREADY provisions the secret + the IAM `secret:brain/*` prefix — the
   task role just needs the `secrets:` mapping, not application code.
3. **Reversible + mechanical.** No application rework; rotation is a value-update in SM + task restart
   (or refresh), not a code change.

**If a future builder argues TS SHOULD read SM directly** → that **RE-OPENS CF-CC-OWNER-1** and is a
**Founder-decision escalation**, NOT a silent flip. Do not implement a Node AWS client without a
Founder ruling. (Not escalating now — the default preserves the boundary, so there is no live
ambiguity to escalate. See escalation section.)

## Bound CF contract (acceptance inputs for Aryan — Stage 2)

| CF | Sev | Contract | BOUNCE trigger |
|----|-----|----------|----------------|
| **CF-HMAC-TS-OWNER-INJECT-1** | HIGH | TS obtains the secret via platform env-injection (task-def `secrets:` mapping, CDK); `requireEnv` unchanged. | A Node `@aws-sdk/client-secrets-manager`/boto3-equivalent import appears in core-service. |
| **CF-TS-NO-AWS-CLIENT-1** (= CF-CC-OWNER-1 held) | HIGH | core-service stays AWS-free; `custody-factory.ts` posture unchanged; no AWS dep added to `apps/core-service`. | Any AWS SDK in core-service `package.json` or import graph. |
| **CF-TS-FAILFAST-1** | HIGH | A **boot-time presence assert** so a missing `SHOPIFY_CLIENT_SECRET` fails fast at startup, NOT at the first OAuth callback/exchange. Assert references the var by name only. | Service boots with the secret absent and only errors at first OAuth use. |
| **CF-TS-HMAC-CONST-1** | HIGH | `validateShopifyHmac` stays **constant-time** (`timingSafeEqual`), hex digest of the sorted query string, the **existing** HMAC routine reused — **no duplication**, no second verifier. | HMAC compare becomes non-constant-time, or a duplicate HMAC routine is introduced. |
| **CF-TS-NEVERLOG-1** | HIGH | The secret VALUE is never logged, inlined, echoed, or returned; assert/error messages name the var, never its value. | Any log/error path that could surface the value. |
| **CF-TS-RESIDENCY-1** (inherited CF-CC-RESIDENCY-1) | HIGH | The injected value originates from the ap-south-1 CMK-encrypted SM secret; the task-def `secrets:` ARN is ap-south-1. No cross-region read. | Any non-ap-south-1 secret ARN in the task-def mapping. |
| **CF-TS-SAME-KEY-1** | MED | The injection sources the SAME provisioned key `brain/_app/shopify/hmac_secret` the parent established — one VALUE, not a new secret. | A new/duplicate secret path is introduced. |

## HELD for Stage 8 (do NOT build live this slice)

- Real injection wiring in the **live core-service task role / deployed task-def** (no core-service
  container is deployed today; CDK authored, not `cdk deploy`d).
- The **rotated** `SHOPIFY_CLIENT_SECRET` value provisioned into SM (grandparent's ceremony).
- No commit without Founder "commit it"; no live cutover.

## Dependency note

- Blocks on the rotated secret value + the SM secret from the parent slices for the **live cutover**
  only. The **build** (CDK task-def mapping authored + the TS fail-fast assert) does not require them —
  env-injection keeps the runtime path byte-identical. So no pre-flight dependency violation: the build
  is independently planable; the cutover is the Stage-8 held leg.

## Escalation

**None fired.** The default ruling (platform env-injection) preserves CF-CC-OWNER-1, so there is no
canon ambiguity, cost-model threat, or moat-change to escalate. The escalation TRIGGER is armed but
not pulled: *if* Stage 2/3 proposes a Node AWS SM client, that re-opens CF-CC-OWNER-1 and Aryan/any
builder must route it to Rohan → Founder, not implement it. (Optionally mirrored as a non-blocking
note; no Founder action requested at intake.)

## Persona-count decision (recorded)

Count = **1**; rationale = single dominant risk dimension (injection-mechanism ⇔ boundary-preservation
are the same fault line); persona = `secret-injection-boundary-realist:haiku`.

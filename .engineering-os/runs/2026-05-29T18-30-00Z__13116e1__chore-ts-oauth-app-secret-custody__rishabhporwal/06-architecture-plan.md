# 06 — Architecture Plan (Stage 2) — chore-ts-oauth-app-secret-custody

**Author:** Aryan (Architect) · **Stage:** 2 (binding plan) · **2026-05-29**
**Paradigm:** `sql` (config / crypto / infra I/O only — zero ML, zero LLM, zero inference)
**Lane:** high-stakes · **Persona input accepted:** `secret-injection-boundary-realist:haiku` (synthesis `05`)
**Handoff:** FOLDED into §17/§17b (work is small + single-file-pair + one CDK construct; a separate 07 would be ceremony). Depth = prescriptive *inside* this plan per the high-stakes band.

---

## 0. THE BOUNDARY ONE-LINER (state it first, it governs everything)

> **In core-service, the TS reader of `SHOPIFY_CLIENT_SECRET` is `process.env`. Full stop. Zero AWS SDK in `apps/core-service/src`. The CDK task-def `secrets:` mapping (ap-south-1 SM `brain/_app/shopify/hmac_secret` → `SHOPIFY_CLIENT_SECRET`) is what puts the value into the env var at container start; TS reads it exactly as today.**

A Node AWS Secrets Manager client in core-service **re-opens CF-CC-OWNER-1** and is a **Founder-decision escalation** (route to Rohan), never a silent flip. This plan does not, and may not, introduce one.

---

## 1. Context & problem

The HMAC slice (`chore-app-hmac-secret-custody`) deliberately left the TS Shopify-OAuth consumers of `SHOPIFY_CLIENT_SECRET` on env-injection under ruling `CF-HMAC-TS-VS-PY-OWNER-1`, and **named this follow-on** to close the interim. Stage 1 (Rohan) ADVANCED with the injection mechanism already **RULED** (`CF-HMAC-TS-OWNER-INJECT-1`): platform env-injection, TS stays AWS-free. The persona shifted the risk from *which mechanism* to *how it is proven without a running container* → new gate `CF-TS-INJECT-SYNTH-1` (synth-level assertion, not a `cdk deploy`).

**Ground truth (verified in code):**

| # | Fact | Evidence |
|---|------|----------|
| G1 | Two TS consumers, both `process.env`-backed via `requireEnv`. | `apps/core-service/src/application/connectors/provider-config.ts`: `validateShopifyHmac` reads at `:156`, `exchangeShopify` reads at `:210`; `requireEnv` helper `:76` (reads `process.env[name]`, throws if unset, never logs the value). |
| G2 | HMAC compare is already constant-time + hex digest of the sorted query. | `provider-config.ts:162` `createHmac('sha256', secret).update(message).digest('hex')`; `:166` `timingSafeEqual`; sort `:159`. |
| G3 | **core-service has zero AWS SDK today** — boundary holds. | `apps/core-service/package.json` deps = `@brain/lib-clickhouse-ts`, `@brain/lib-logger`, `pg`. `grep @aws-sdk apps/core-service/src` → empty. |
| G4 | The SM secret already exists in CDK (CMK-encrypted, ap-south-1, RETAIN, rotation-forbidden). | `infra/cdk/lib/credential-custody-stack.ts:195-208` `appShopifyHmacSecret` (`brain/_app/shopify/hmac_secret`); ARN output `:295`. |
| G5 | **No ECS / task-def / `secrets:` construct exists anywhere** in `infra/cdk` (grep empty). The CDK stack is secrets+IAM only; `bin/app.ts` registers one stack. core-service has **no Dockerfile, no deployed container** (`src/bootstrap/` is an empty `.gitkeep`). | `infra/cdk/lib/`, `infra/cdk/bin/app.ts:17-33`. |
| G6 | core-service runs **in-process via the api-gateway** (Phase-0); the gateway imports the connectors barrel `@brain/core-connectors`. | `apps/core-service/src/application/connectors/index.ts` header; barrel re-exports `validateShopifyHmac`/`exchangeCode`. |
| G7 | An exact **boot-assert precedent** exists in the gateway: a pure `read*Config()` + `assertBootable*(): string \| null` pair, `process.exit(1)` on a fatal string. | `apps/api-gateway/src/interfaces/server.ts:60-76` (`readAuthConfig` / `assertBootableAuthConfig`), invoked at boot `:346-351`. |

**Why the build does not block on the held value:** env-injection keeps the TS runtime byte-identical whether the value is present or not. The BUILD ships (a) a CDK task-def `secrets:` mapping authored-not-deployed, (b) a TS boot-time presence assert, (c) the grep + never-log tests. The **live cutover** (rotated value into SM + the live core-service task role) is the Stage-8 held leg. No pre-flight dependency violation.

---

## 2. Single-Primitive sweep

| Candidate primitive | Decision |
|---|---|
| `requireEnv` (`provider-config.ts:76`) — call-time env reader. | **REUSE, untouched.** It stays the call-time reader (G1). It does NOT satisfy CF-TS-FAILFAST-1 (it only fires at first OAuth use). The boot assert is a *distinct* concern. |
| Gateway boot-assert pattern `readAuthConfig`/`assertBootableAuthConfig` (`server.ts:60-76`). | **MIRROR, do not import.** Same shape: a pure function returning a fatal `string \| null`, caller decides to exit. This is the Single-Primitive home for the new boot assert — no config framework, no DI container, no new abstraction. |
| `validateShopifyHmac` HMAC routine. | **REUSE, untouched** (CF-TS-HMAC-CONST-1). No second verifier, no duplication. |
| CDK `CredentialCustodyStack` / `appShopifyHmacSecret` + ARN output. | **REUSE the secret + ARN** (CF-TS-SAME-KEY-1). The task-def mapping references the SAME secret — one value, two readers. |
| A new config-validation library / `convict` / `zod`-env. | **REJECTED** (over-build; Single-Primitive). One presence check does not need a framework. |

**Sweep result:** clean. One mirrored micro-pattern (boot assert), all else reuse-untouched.

---

## 3. The injection ruling (restated as the binding contract)

`CF-HMAC-TS-OWNER-INJECT-1` (HIGH): TS obtains the secret via the platform env-injection at the task boundary; `requireEnv` unchanged. The CDK ECS task definition declares a `secrets:` entry that resolves the ap-south-1 SM secret `brain/_app/shopify/hmac_secret` → the container env var `SHOPIFY_CLIENT_SECRET`. ECS pulls + decrypts at container start (the task execution role holds the SM/KMS grant — already authored in `custodyPolicy`, `credential-custody-stack.ts:239`). core-service then reads `process.env['SHOPIFY_CLIENT_SECRET']` exactly as it does today.

**Live wiring is HELD for Stage 8** (no deployed core-service container; CDK authored-not-deployed). The BUILD gate is **synth-level**: the synthesized CloudFormation contains the `secrets:` mapping resolving the ap-south-1 ARN → `SHOPIFY_CLIENT_SECRET`.

---

## 4. Design — Part A: CDK task-def `secrets:` mapping (Track J — Jatin)

### A.1 Where it lives
Because **no ECS construct exists yet** (G5), the build authors the **minimal representative ECS task definition** for core-service that carries exactly the one `secrets:` mapping this slice requires. To preserve `credential-custody-stack.ts` as a focused secrets+IAM stack (and avoid coupling the held custody stack to a compute stack), author a **new file**: `infra/cdk/lib/core-service-task-def-stack.ts` registered in `bin/app.ts`. It **imports the SM secret by ARN** from the existing stack (cross-stack ref to `appShopifyHmacSecret`, NOT a re-declaration — CF-TS-SAME-KEY-1: one value, no duplicate secret path).

> **HELD scope note (do not over-build):** this is the *representative* task-def carrying ONLY the Shopify secret mapping + the minimal scaffold a `Ec2/FargateTaskDefinition` needs to synthesize (a single container definition with an image placeholder). It is NOT the full core-service Fargate service (networking, ALB, autoscaling, ECR image) — that is Phase-1/Stage-8 infra. Live task-role wiring + the deployed service are HELD-for-Stage-8. The construct exists so the `secrets:` mapping is **mechanically verifiable at synth** today (CF-TS-INJECT-SYNTH-1).

### A.2 Construct shape (design — builder authors the code)
- `aws-cdk-lib/aws-ecs` (already available via `aws-cdk-lib` 2.257.0 — **no new dependency**).
- `secretsmanager.Secret.fromSecretCompleteArn(this, 'AppShopifyHmacSecret', <ap-south-1 ARN>)` OR a cross-stack `props` reference to the existing `appShopifyHmacSecret` construct. **Prefer the cross-stack construct reference** so synth proves it is the SAME secret resource, not a string that could drift.
- A `FargateTaskDefinition` (Fargate matches the Phase-0/1 deployable target per Brain canon — Fargate, not EKS, pre-Phase-2).
- `taskDef.addContainer('core-service', { image: <placeholder/named image>, secrets: { SHOPIFY_CLIENT_SECRET: ecs.Secret.fromSecretsManager(appShopifyHmacSecret) } })`.
- The task **execution role** must hold the SM `GetSecretValue` + KMS `Decrypt` on this secret/CMK. The existing `custodyPolicy` (`credential-custody-stack.ts:239`) enumerates exactly these on `secret:brain/*` + the CMK ARN — **attach/reference it; do NOT widen** (CF-TS-RESIDENCY-1 + least-priv preserved). If a cross-stack attach is awkward at synth, author an equivalent least-priv inline grant scoped to THIS secret ARN + the CMK only (no `*`), and add a regression assert that the action/resource set is unchanged.
- The stack region is pinned `ap-south-1` (mirror the residency guard at `credential-custody-stack.ts:112`), so the resolved secret ARN is ap-south-1 (CF-TS-RESIDENCY-1).
- Header banner: `AUTHORED, NOT DEPLOYED` + `@paradigm sql` (mirror `bin/app.ts:1-12`).

### A.3 Synth-level assertion shape (for Tanvi — CF-TS-INJECT-SYNTH-1)
New test `infra/cdk/test/core-service-task-def-stack.test.ts`, using `Template.fromStack` (zero real AWS calls, mirror the existing test harness `credential-custody-stack.test.ts:21-28`). Assertions:
1. `AWS::ECS::TaskDefinition` resource count is 1.
2. The container definition's `Secrets` array contains an entry with `Name: "SHOPIFY_CLIENT_SECRET"` and a `ValueFrom` that **resolves the `brain/_app/shopify/hmac_secret` secret ARN** (assert the `ValueFrom` references the secret — via `Match.objectLike`/`Ref`/`Fn::Join` on the secret logical id or the literal `brain/_app/shopify/hmac_secret` name).
3. **Residency:** the resolved ARN region segment is `ap-south-1` (assert no other region string appears in any `ValueFrom`). NEGATIVE: no `us-`/`eu-` region in the mapping.
4. **SAME-KEY:** assert there is **no NEW `AWS::SecretsManager::Secret`** created by this stack (count 0 in this stack — it references, never declares). The secret is owned by `CredentialCustodyStack`.
5. **No env literal:** NEGATIVE — assert the container `Environment` (plaintext) array does NOT contain a `SHOPIFY_CLIENT_SECRET` entry (it must be under `Secrets`, never `Environment`; a plaintext env would defeat custody). Also assert no `shpss_`-shaped literal anywhere in the template.
6. Wrong-region constructor throws (mirror `credential-custody-stack.test.ts:528-535`).

---

## 5. Design — Part B: the boot-time presence assert (Track V — Vikram)

### B.1 Where it lives
A new file `apps/core-service/src/application/connectors/boot-assert.ts` (co-located with `provider-config.ts`, the owner of the consumers), re-exported from the connectors barrel `index.ts` so the gateway composition root can call it at startup (G6 — core-service boots in-process via the gateway).

### B.2 Shape (mirror the gateway precedent G7 — pure, returns `string | null`)
```
// boot-assert.ts  (DESIGN — builder authors)
export function assertShopifyOAuthSecretsPresent(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  // presence/non-empty ONLY; names the var, NEVER reads/echoes/returns the value
  const name = 'SHOPIFY_CLIENT_SECRET'
  const v = (env[name] ?? '').trim()
  if (!v) return `${name} is not set — core-service Shopify OAuth cannot start. ` +
                 `(injected from SM brain/_app/shopify/hmac_secret at the task boundary).`
  return null
}
```
- **Pure** (env injected as a param) so it is unit-testable without boot side effects (mirror `readAuthConfig(env = process.env)`).
- **Boot-time invocation:** the gateway calls it in its boot sequence alongside `assertBootableAuthConfig` (`server.ts:346`), `process.exit(1)` on a non-null fatal string. **This satisfies CF-TS-FAILFAST-1** — a missing secret fails the service at startup, NOT at the first OAuth callback/exchange. (Builder adds the one call + exit at the gateway boot block; the assert function is owned by core-service.)
- **CF-TS-NEVERLOG-1:** the message names the var only; presence/non-empty check; the value is never read into the message, logged, or returned. The function returns either the var NAME-bearing message or `null` — never the value.
- **Single-Primitive:** no config framework; one function; mirrors an existing pattern. Scope is exactly `SHOPIFY_CLIENT_SECRET` (the secret this slice closes). Do NOT expand to assert every OAuth env (that is scope creep beyond the requirement).

### B.3 `requireEnv`, `validateShopifyHmac`, `exchangeShopify` — UNTOUCHED
CF-TS-HMAC-CONST-1 + CF-TS-NO-AWS-CLIENT-1: no edits to `provider-config.ts` HMAC/exchange logic, no second verifier, no AWS import. The boot assert is purely additive.

---

## 6. Design — Part C: the AWS-import hard-gate test (Track V — Vikram; enforced by Shreya/Tanvi at Stage 4/5)

A test `apps/core-service/src/__tests__/no-aws-sdk-boundary.test.ts` (vitest, mirrors the existing `__tests__` layout) that:
1. Greps the `apps/core-service/src` tree for any `@aws-sdk` / `aws-sdk` / `boto3`-equivalent import → asserts **zero matches** (hard BOUNCE on presence — CF-TS-NO-AWS-CLIENT-1).
2. Asserts `apps/core-service/package.json` dependencies + devDependencies contain **no** `@aws-sdk/*` / `aws-sdk` key.
3. NEGATIVE never-log test for `assertShopifyOAuthSecretsPresent`: call with `{ SHOPIFY_CLIENT_SECRET: 'shpss_FAKE_TEST_VALUE_NOT_REAL' }` set → returns `null` and produces no log; call with it UNSET → returns a string that **contains `SHOPIFY_CLIENT_SECRET` and does NOT contain the value** (CF-TS-NEVERLOG-1).

---

## 7. Multi-tenancy (4 layers)

Not a data path — this slice touches no workspace-scoped read/write. The `brain/_app/shopify/hmac_secret` is an **app-level singleton** (`_app/` namespace, deliberately not `brain/{workspace_id}/`; `credential-custody-stack.ts:175-208`). No RLS / query-gateway / Kafka-envelope / JWT surface changes. Layer integrity preserved by *not touching* tenanted code. **N/A by construction, documented.**

## 8. Observability

No new metrics/dashboards/traces (over-build guard). The only new signal is the boot-fail path: on a non-null fatal string the gateway logs the var-name message (never the value) and `process.exit(1)` — reusing the existing gateway fatal-boot log line (`server.ts:349-351`). Nothing else added.

## 9. Region adapter

No region-varying behavior. Residency is enforced at the infra layer (ap-south-1 SM ARN in the mapping, CF-TS-RESIDENCY-1). No RegionAdapter change.

## 10. Cost

₹0/month. Zero compute, zero inference, zero new managed resource (the SM secret + CMK already exist; the task-def is authored-not-deployed). Token cost: 0 tokens/day (no LLM).

## 11. Alternatives considered

| Alt | Rejected because |
|---|---|
| **TS reads SM directly via `@aws-sdk/client-secrets-manager`.** | RE-OPENS CF-CC-OWNER-1 — a second AWS retrieval client in a second runtime the parent deliberately kept AWS-free; doubles the residency/IAM/never-log audit surface for zero marginal security. **Founder-escalation, not a Stage-2 decision.** Barred by the ruling. |
| **Entrypoint shell script fetches the secret + exports the env var.** | Adds an AWS CLI/shell fetch surface + a non-CDK secret-handling path outside IaC; the ECS-native `secrets:` mapping is the canon/stack pattern (technical-context §2) and is fully synth-verifiable. Rejected. |
| **Keep call-time `requireEnv` only, no boot assert.** | Fails CF-TS-FAILFAST-1 — a missing secret would only surface at the first OAuth callback, in production, mid-flow. The boot assert is the whole point of the persona's C2. Rejected. |
| **Put the `secrets:` mapping into `CredentialCustodyStack`.** | Couples the focused secrets/IAM stack to a compute construct; the secret should be *referenced*, not co-located with its consumer's task-def. New focused stack is cleaner + keeps the held custody stack untouched. |

## 12. Migration / reversibility

Fully reversible. The boot assert is additive (delete the call + file to revert). The CDK task-def stack is authored-not-deployed (no live resource; remove the file + `bin/app.ts` registration to revert). No schema, no data, no live cutover. `requireEnv` + HMAC paths are byte-identical.

## 13. Test strategy

- **CDK synth assertions** (Track J): the 6 assertions in §4.3 — zero real AWS calls, `Template.fromStack`.
- **TS unit** (Track V): boot-assert present/absent/never-log (§6.3); the AWS-import + package.json grep gate (§6.1-6.2).
- **Real-network smoke:** N/A this slice — core-service has no deployed container (G5); the persona's C1 explicitly substitutes the synth-level assertion for a live smoke. Documented, not skipped.
- **HMAC regression:** the existing `provider-config` tests must stay green (proves CF-TS-HMAC-CONST-1 untouched).

## 14. Risks

| Risk | Mitigation |
|---|---|
| Builder reaches for an AWS SDK to "read the secret in TS." | §6.1 hard-gate test BOUNCES it; §0 + §11 state the escalation path. |
| `secrets:` mapping accidentally lands as a plaintext `Environment` entry. | §4.3 #5 NEGATIVE assert (no `SHOPIFY_CLIENT_SECRET` under `Environment`). |
| Boot assert leaks the value in its message. | §5.2 + §6.3 negative test. |
| Cross-stack secret reference drifts to a string literal / new secret. | §4.3 #4 (no new `AWS::SecretsManager::Secret` in this stack) + prefer construct reference. |

## 15. Open questions

**None blocking.** One non-blocking note carried to Stage 8: the representative task-def is a scaffold; the full core-service Fargate service (networking/ALB/ECR image/task-role attach) is Phase-1/Stage-8 infra and is explicitly out of this slice. The synth gate proves the `secrets:` mapping shape today.

## 16. HELD-for-Stage-8 (do NOT build/deploy/commit this slice without Founder authorization)

- Live core-service task-role injection wiring + a deployed core-service container/service.
- The **rotated** `SHOPIFY_CLIENT_SECRET` value provisioned into SM (grandparent ceremony). **Never printed** — refer only as `SHOPIFY_CLIENT_SECRET` / `shpss_<REDACTED>`.
- Rotation runbook note (inherited): core-service picks up a rotated value on **task restart**, not live (acceptable; rotation is rare + Founder-driven).
- No `cdk deploy`. No git commit without Founder "commit it".

---

## 17. Tracks (work decomposition) — FOLDED HANDOFF

### Track V — TS core-service (@vikram / backend-developer)
| # | Task (2–5 min) | File | CF |
|---|---|---|---|
| V1 | Author `assertShopifyOAuthSecretsPresent(env=process.env): string \| null` — pure, presence/non-empty, names var only, never reads value. Mirror `server.ts:60-76`. | `apps/core-service/src/application/connectors/boot-assert.ts` (new) | FAILFAST-1, NEVERLOG-1 |
| V2 | Re-export it from the connectors barrel. | `apps/core-service/src/application/connectors/index.ts` | FAILFAST-1 |
| V3 | Wire the boot call: in the gateway boot block (after `assertBootableAuthConfig`, `server.ts:346`), call the assert; `process.exit(1)` on non-null fatal. | `apps/api-gateway/src/interfaces/server.ts` (boot block ~346-351) | FAILFAST-1 |
| V4 | Unit tests: present → null+no log; unset → message contains var-name, NOT value (use `shpss_FAKE_TEST_VALUE_NOT_REAL`, never a real value). | `apps/core-service/src/__tests__/boot-assert.test.ts` (new) | FAILFAST-1, NEVERLOG-1 |
| V5 | AWS-import hard-gate test: grep `apps/core-service/src` for `@aws-sdk`/`aws-sdk` → 0; assert `package.json` has no AWS dep. | `apps/core-service/src/__tests__/no-aws-sdk-boundary.test.ts` (new) | NO-AWS-CLIENT-1 |
| V6 | Confirm `provider-config.ts` (`requireEnv`, `validateShopifyHmac`, `exchangeShopify`) is UNTOUCHED; existing provider tests stay green. | `apps/core-service/src/application/connectors/provider-config.ts` (read-only) | HMAC-CONST-1, NO-AWS-CLIENT-1 |

### Track J — CDK task-def `secrets:` mapping (@jatin / platform-devops) *(Stage-1 obligation tagged Jatin; note: the run brief says "CDK = Jatin")*
| # | Task | File | CF |
|---|---|---|---|
| J1 | Author the representative core-service Fargate task-def stack: ONE container, ONE `secrets:` entry `SHOPIFY_CLIENT_SECRET ← ecs.Secret.fromSecretsManager(appShopifyHmacSecret)` via cross-stack reference (SAME secret, no re-declare). Region pinned ap-south-1 + residency guard. Header `AUTHORED NOT DEPLOYED`, `@paradigm sql`. Use `aws-cdk-lib/aws-ecs` (no new dep). | `infra/cdk/lib/core-service-task-def-stack.ts` (new) | OWNER-INJECT-1, SAME-KEY-1, RESIDENCY-1 |
| J2 | Register the stack in the CDK app (ap-south-1, account token). | `infra/cdk/bin/app.ts` | OWNER-INJECT-1 |
| J3 | Task execution role: reference/attach the existing least-priv `custodyPolicy` (or equivalent inline grant scoped to THIS secret ARN + the CMK only, no `*`); add a regression assert the action/resource set is unchanged. | task-def stack | RESIDENCY-1, least-priv |
| J4 | Synth assertions (the 6 in §4.3): taskdef count=1; `Secrets[SHOPIFY_CLIENT_SECRET].ValueFrom` resolves `brain/_app/shopify/hmac_secret`; ap-south-1 (no us-/eu-); NO new `AWS::SecretsManager::Secret`; NEGATIVE no plaintext `Environment` entry + no `shpss_` literal; wrong-region throws. `Template.fromStack`, zero AWS calls. | `infra/cdk/test/core-service-task-def-stack.test.ts` (new) | INJECT-SYNTH-1, RESIDENCY-1, SAME-KEY-1, NEVERLOG-1 |

> **Note on Track J ownership:** the run brief assigns CDK to "Jatin" (platform-devops); my Stage-1 inputs reference the CDK assertion owner as Tanvi at *verification* (Stage 5). Build = Jatin authors the construct + synth test; **Tanvi (Stage 5) independently re-asserts** the synth output. No conflict — author vs verifier.

### §17b — Acceptance contract (all 8 CFs → verifiable artifact → bounce condition)
| CF | Sev | Verifiable artifact (pass) | Stage-4/5/6 BOUNCE condition |
|---|---|---|---|
| **CF-HMAC-TS-OWNER-INJECT-1** | HIGH | J4 #2: synth `Secrets[].ValueFrom` resolves `brain/_app/shopify/hmac_secret`→`SHOPIFY_CLIENT_SECRET`; V6: `requireEnv` unchanged. | A `@aws-sdk`/SM-client import appears in core-service; OR no `secrets:` mapping in synth. |
| **CF-TS-NO-AWS-CLIENT-1** (=CF-CC-OWNER-1) | HIGH | V5: grep+package.json gate → 0 AWS. | Any AWS SDK in `apps/core-service` import graph or `package.json`. **→ also re-opens CF-CC-OWNER-1 = Founder escalation.** |
| **CF-TS-FAILFAST-1** | HIGH | V1+V3+V4: boot-time assert wired at gateway boot; unset → fatal exit, not first-OAuth. | Service boots with secret absent + only errors at first OAuth use. |
| **CF-TS-HMAC-CONST-1** | HIGH | V6: `validateShopifyHmac` byte-unchanged (`timingSafeEqual`, hex, sorted query); existing tests green; no second verifier. | HMAC compare non-constant-time, or a duplicate HMAC routine introduced. |
| **CF-TS-NEVERLOG-1** | HIGH | V4 negative test: error string contains var-name, NOT value; J4 #5: no `shpss_` literal / plaintext env in synth. | Any log/error/synth path that could surface the value. |
| **CF-TS-RESIDENCY-1** | HIGH | J4 #3: resolved ARN region = ap-south-1; wrong-region throws; least-priv unchanged. | Any non-ap-south-1 ARN in the mapping; any IAM widening. |
| **CF-TS-SAME-KEY-1** | MED | J4 #4: NO new `AWS::SecretsManager::Secret`; cross-stack ref to existing `appShopifyHmacSecret`. | A new/duplicate secret path introduced. |
| **CF-TS-INJECT-SYNTH-1** | HIGH | J4 (all): assertions on `Template.fromStack`, zero live container. | "It'll work when deployed" hand-wave with no synth assertion; OR a `cdk deploy` attempted. |

**Escalation trigger (armed, carried to builders):** any proposal that TS reads SM directly via an AWS client → STOP, route to Rohan → Founder. Do not implement.

### Over-engineering self-check (mandatory)
- [PASS] Plan length matches high-stakes band; every section load-bearing for an 8-CF security contract.
- [PASS] Every file in §17 is required: 1 boot-assert + barrel re-export + 1 gateway boot call + 2 TS tests + 1 CDK stack + 1 CDK test. No "while we're in there."
- [PASS] No new npm/pip deps. `aws-cdk-lib/aws-ecs` ships in the pinned `aws-cdk-lib` 2.257.0 (verified in `infra/cdk/package.json`); no `@aws-sdk` added to core-service (forbidden).
- [PASS] No new abstraction for hypothetical future use — boot assert mirrors an existing pattern; task-def is the minimal representative scaffold, full service HELD.
- [PASS] No observability beyond the existing fatal-boot log line.
- [PASS] No tests for trivial getters; tests target the boundary (no-AWS gate), fail-fast, never-log, and synth mapping — the actual risk surfaces.
- [PASS] Test strategy proportionate: ~6 synth asserts + ~3 TS asserts for an 8-CF security slice. Not padded.

**All PASS.** No FAIL to justify.

### Version reality check
- `aws-cdk-lib` `2.257.0` + `constructs` `10.6.0` — real, pinned, present (`infra/cdk/package.json`). `aws-ecs` / `aws-secretsmanager` are sub-paths of `aws-cdk-lib` (no separate install). No invented versions.

### Sign-off
- Paradigm: **`sql`**, justified (config/crypto/infra I/O, zero inference) — matches Rohan's first-pass; recorded.
- Single-Primitive sweep: clean (one mirrored micro-pattern, all else reuse).
- 4-layer multi-tenancy: N/A by construction (app-level singleton secret), documented.
- All 8 CFs mapped to verifiable artifacts + bounce conditions (§17b).
- Reversible; ₹0/mo; HELD-for-Stage-8 explicit (§16).

---

## Handoff (folded)

**Stage 3 builders:** `backend-developer (@vikram)` for Track V + `platform-devops (@jatin)` for Track J — parallel (independent files; only V3 touches the gateway boot block, J touches infra/cdk).
**Binding inputs:** this plan (§0 boundary, §4 CDK design, §5 boot assert, §6 gate test) + §17b acceptance contract (the 8-CF→artifact→bounce table is the build contract).
**Do NOT:** add any AWS SDK to core-service; touch `validateShopifyHmac`/`exchangeShopify`/`requireEnv` logic; `cdk deploy`; commit without Founder "commit it"; print the live `shpss_…` value.

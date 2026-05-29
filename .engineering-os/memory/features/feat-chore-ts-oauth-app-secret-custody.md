# feat-chore-ts-oauth-app-secret-custody — per-feature journal

**Goal:** Close the env-injected interim left by `chore-app-hmac-secret-custody` — bring the TS (core-service) Shopify-OAuth consumers of `SHOPIFY_CLIENT_SECRET` onto proper custody WITHOUT growing a Node AWS SDK. Ruling: platform env-injection (TS stays AWS-free).
**Lane:** high-stakes · **Paradigm:** sql · **8-CF contract.**
**Run folder:** `.engineering-os/runs/2026-05-29T18-30-00Z__13116e1__chore-ts-oauth-app-secret-custody__rishabhporwal/`

---

## Stage 2 — Architecture plan (Aryan) — 2026-05-29

**Boundary one-liner:** TS reader of `SHOPIFY_CLIENT_SECRET` = `process.env`; ZERO AWS SDK in `apps/core-service/src`. The CDK ECS task-def `secrets:` mapping (ap-south-1 SM `brain/_app/shopify/hmac_secret` → `SHOPIFY_CLIENT_SECRET`) injects the value at container start; TS reads it as today.

**Key design decisions:**
- **Boot assert (Track V):** new `apps/core-service/src/application/connectors/boot-assert.ts` — pure `assertShopifyOAuthSecretsPresent(env): string | null`, mirrors the gateway `assertBootableAuthConfig` pattern (`server.ts:60-76`). Wired at gateway boot (`server.ts:346`), `process.exit(1)` on fatal. Satisfies CF-TS-FAILFAST-1; never-logs the value (CF-TS-NEVERLOG-1). `requireEnv`/`validateShopifyHmac`/`exchangeShopify` UNTOUCHED.
- **CDK task-def (Track J):** new `infra/cdk/lib/core-service-task-def-stack.ts` — representative Fargate task-def carrying ONE `secrets:` mapping via cross-stack reference to the existing `appShopifyHmacSecret` (`credential-custody-stack.ts:195`), NOT a new secret (CF-TS-SAME-KEY-1). Region ap-south-1 (CF-TS-RESIDENCY-1). Least-priv via existing `custodyPolicy`. `aws-cdk-lib/aws-ecs` — no new dep.
- **Hard gate (Track V):** `no-aws-sdk-boundary.test.ts` greps `apps/core-service/src` + `package.json` for any AWS SDK → 0 (CF-TS-NO-AWS-CLIENT-1).
- **Synth gate (Track J, CF-TS-INJECT-SYNTH-1):** `Template.fromStack` assertions (no live container — persona C1): taskdef count, ValueFrom resolves `brain/_app/shopify/hmac_secret`, ap-south-1, no new secret, no plaintext env / `shpss_` literal, wrong-region throws.

**Handoff:** folded into 06 §17/§17b. Acceptance contract = 8-CF→artifact→bounce table.
**HELD-Stage-8:** live task-role wiring + deployed container + rotated `SHOPIFY_CLIENT_SECRET` value into SM. No `cdk deploy`, no commit without Founder "commit it", never print the live `shpss_…` value.
**Escalation armed:** any "TS reads SM directly via AWS client" proposal → STOP → Rohan → Founder (re-opens CF-CC-OWNER-1).

**Next:** Stage 3 — @vikram (Track V) + @jatin (Track J) in parallel.
EOF

---

## 2026-05-29T14:12:00Z — Vikram (backend-developer) — chore-ts-oauth-app-secret-custody

**Stage:** 3
**Track:** V (TS core-service boot-assert + AWS-SDK hard gate)
**Action:** Authored boot-assert.ts, barrel re-export, gateway boot wiring, and two test files (boot-assert.test.ts + no-aws-sdk-boundary.test.ts). All 262 core-service tests pass; 0 typecheck errors on core-service and api-gateway.
**Skills loaded:** backend-fastify-trpc-grpc, defense-in-depth-validation, verification-before-completion, engineering-discipline
**Paradigm:** sql (config/crypto/infra I/O only — zero ML, zero LLM)
**Decisions:**
- Mirrored `assertBootableAuthConfig` shape exactly (pure, `string | null`, env injected as param).
- `containsAwsSdk` in the boundary test uses runtime-concatenated strings (`'aws' + '-sdk'`) to avoid the test file matching itself during the production-source grep. Test files excluded from the scan via `__tests__` directory skip.
- Gateway import uses `@brain/core-connectors` (already mapped in gateway tsconfig to connectors/index.ts).
- `requireEnv` / `validateShopifyHmac` / `exchangeShopify` in `provider-config.ts` left byte-identical (CF-TS-HMAC-CONST-1).
**Files touched:**
- `apps/core-service/src/application/connectors/boot-assert.ts` (new)
- `apps/core-service/src/application/connectors/index.ts` (barrel re-export added)
- `apps/api-gateway/src/interfaces/server.ts` (import + boot call wired in main())
- `apps/core-service/src/__tests__/boot-assert.test.ts` (new — 11 tests)
- `apps/core-service/src/__tests__/no-aws-sdk-boundary.test.ts` (new — 6 tests)
**Verification:**
- Command: `pnpm --filter @brain/core-service test`
- Output: `Test Files  13 passed | 4 skipped (17) / Tests  262 passed | 30 skipped (292)`
- Passed: TRUE
- Command: `pnpm --filter @brain/core-service typecheck`
- Output: (empty — zero errors)
- Passed: TRUE
- Command: `pnpm --filter @brain/api-gateway typecheck`
- Output: (empty — zero errors)
- Passed: TRUE
- Command: `grep -r "@aws-sdk|aws-sdk" apps/core-service/src --exclude-dir=__tests__ -l`
- Output: (empty — exit 1 = zero matches in production source)
- Passed: TRUE
- Command: `git diff --stat -- "legacy project/"`
- Output: (empty — zero legacy changes)
- Passed: TRUE
**Open questions:** None. Track J (CDK task-def) is a parallel track for Jatin.
**Handoff signal:** READY-FOR-SECURITY (standard lane → parallel Shreya + Tanvi)

---

## 2026-05-29T18-30-00Z — Jatin (platform-devops) — chore-ts-oauth-app-secret-custody

**Stage:** 3
**Track:** J (CDK task-def `secrets:` mapping)
**Action:** Authored `infra/cdk/lib/core-service-task-def-stack.ts` (new representative Fargate task-def) + `infra/cdk/bin/app.ts` (stack registered) + `infra/cdk/test/core-service-task-def-stack.test.ts` (6-assertion synth test). `cdk synth` PASS + `npm test` PASS (49/49).
**Skills loaded:** devops-aws, engineering-discipline, verification-before-completion
**Paradigm:** sql (infra I/O only — zero ML, zero LLM, zero inference)

**Key design decisions:**
- Used `cdk.Fn.importValue("brain-app-shopify-hmac-secret-arn")` instead of a direct cross-stack construct reference to avoid a CDK circular dependency: `CredentialCustodyStack` must NOT generate a `DependsOn` edge back to this stack. The `Fn::ImportValue` pattern is CDK-canonical for consumer stacks that need secret ARNs from an upstream stack.
- Execution role: own least-priv inline grant (`secretsmanager:GetSecretValue` + `kms:Decrypt`) scoped to THIS secret ARN + THIS CMK ARN only via imported CF values — NOT the broader `custodyPolicy` (which grants put/seal/create on `brain/*`, over-broad for a read-only ECS task). CDK also auto-adds `secretsmanager:DescribeSecret` via the `ecs.Secret.fromSecretsManager()` construct — this is required by ECS and confirmed scoped to the same secret ARN.
- `aws-cdk-lib/aws-ecs` sub-path used — no new dependency (already in `aws-cdk-lib@2.257.0`).
- No `cdk deploy`, no Founder gate breached, no `shpss_` value ever printed.

**Synthesized CF proof (from `cdk.out/CoreServiceTaskDefStack.template.json`):**
```json
"Secrets": [
  {
    "Name": "SHOPIFY_CLIENT_SECRET",
    "ValueFrom": { "Fn::ImportValue": "brain-app-shopify-hmac-secret-arn" }
  }
],
"Environment": []
```
- `AWS::SecretsManager::Secret` count in this stack: **0** (CF-TS-SAME-KEY-1 PASS)
- `AWS::ECS::TaskDefinition` count: **1** (CF-TS-INJECT-SYNTH-1 PASS)
- `shpss_` in template: **false** (CF-TS-NEVERLOG-1 PASS)
- Region guard throws on `us-east-1` (CF-TS-RESIDENCY-1 PASS)

**Files authored:**
- `infra/cdk/lib/core-service-task-def-stack.ts` (new)
- `infra/cdk/bin/app.ts` (updated — stack registered, variable declaration reverted to `new`)
- `infra/cdk/test/core-service-task-def-stack.test.ts` (new — 16 tests across 6 assertion groups)

**Verification:**
- Command: `npx cdk synth` (in `infra/cdk`)
- Output: `Successfully synthesized to /…/infra/cdk/cdk.out` — both stacks
- Passed: TRUE
- Command: `npm test` (in `infra/cdk`)
- Output: `Tests: 49 passed, 49 total` (credential-custody-stack + core-service-task-def-stack both suites)
- Passed: TRUE
- No `cdk deploy` run. No real AWS. No git commit. AUTHORED-NOT-DEPLOYED.

**HELD-Stage-8 (unchanged):** live task-role wiring, deployed core-service container, rotated SM value.
**Handoff signal:** Track J COMPLETE. Both tracks (V + J) authored. Ready for Stage 4 (Shreya) + Stage 5 (Tanvi) parallel review.

---

## 2026-05-29 — Shreya (security-reviewer) — chore-ts-oauth-app-secret-custody
**Stage:** 4 (PARALLEL REVIEW mode — Shreya ∥ Tanvi)
**Action:** Security review **PASS**
**Findings (CRITICAL):** 0
**Findings (HIGH):** 0
**Findings (MED):** 0
**Findings (LOW):** 1 — L1: two fatal-boot `console.error` lines reuse the existing gateway boot-fail pattern (consistent, no security delta); fold into structured boot logger later. Tech-debt note, non-blocking.
**Compliance gates (DPDP/PDPL/DLT/NCPR/calling-hours/recording-consent):** DPDP data-residency PASS (ap-south-1 pin + synth guard, zero foreign-region string, IAM ARN-scoped no-wildcard). All telecom/WhatsApp/consent/recording dimensions N/A — out of scope (no outbound/PII surface).
**8-CF verdict:** all 8 PASS — NO-AWS-CLIENT-1 (grep+pkg clean, boundary test real/re-run), NEVERLOG-1 (var-name-only, no log of value, no shpss_ in synth), FAILFAST-1 (boot assert precedes buildServer/listen, exit(1)), HMAC-CONST-1 (provider-config diff==0), OWNER-INJECT-1 (Fn::ImportValue secrets mapping), RESIDENCY-1 (ap-south-1 guard + least-priv ARN-scoped IAM), SAME-KEY-1 (0 new Secret resource), INJECT-SYNTH-1 (Template.fromStack, 1 taskdef, no deploy).
**Traceability:** PASS — no endpoint/consumer/frontend/LLM path introduced; boot-time assert has no request context.
**Verification:** core-service 262 pass + targeted 17 pass; CDK 49 pass; `cdk synth` inspected (secrets via Fn::ImportValue, IAM no-`*`, 0 SecretsManager::Secret, 1 ECS::TaskDefinition, no foreign region, no shpss_, empty Environment). provider-config & legacy diff == 0.
**Bounced to:** NONE
**Rationale:** All 8 CFs map to passing artifacts; the AWS-free boundary genuinely holds; the secret is never logged or duplicated; residency + least-priv enforced at synth. PASS to Stage 5 (Tanvi).
**Note (non-security):** CDK files authored in worktree but not yet staged at review time — reviewed as-authored; must be added to the staging set before Founder commit so CDK + TS ship together.

---

## 2026-05-29T18:22:00Z — Tanvi (qa-agent) — chore-ts-oauth-app-secret-custody
**Stage:** 5 (parallel review reconciled)
**Action:** QA PASS
**Test runs:** 262 unit / 0 integration (pre-existing skip, no live DB) / 49 CDK contract / 0 e2e / 0 load
**Real-network smoke:** N/A (no deployed container; synth-level gate is architect-ruled substitute — documented not silently skipped)
**Metric registry parity (TS↔Python):** N/A (zero new metrics)
**Trace IDs end-to-end:** N/A (no new endpoint/consumer/LLM path; boot-time assert precedes request handling)
**Operational-readiness:** PASS
**Mutation tests on high-stakes:** PASS (both branches of assertShopifyOAuthSecretsPresent exercised; trim + never-value invariant tested; proportionate for a 13-line one-predicate function)
**Coverage:** ~100% on change set (all logic branches in new code covered)
**Bounced to:** NONE
**Findings:** 0 CRITICAL / 0 HIGH / 0 MED / 1 LOW (pre-existing, carried from Stage 4 — console.error style note)

**Boundary gate non-vacuity (CF-TS-NO-AWS-CLIENT-1 — load-bearing control):**
- Injected `// import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'` into `boot-assert.ts` production file.
- `no-aws-sdk-boundary.test.ts` went RED: "AWS SDK imports found in: .../boot-assert.ts: expected [ Array(1) ] to have a length of +0 but got 1"
- Removed injection. Test returned GREEN: 6/6 PASS.
- Non-vacuity PROVEN. The gate genuinely catches an AWS import — it is not a tautology.

**8-CF summary:** all 8 MET. Synth: `Secrets[{Name: SHOPIFY_CLIENT_SECRET, ValueFrom: {Fn::ImportValue: brain-app-shopify-hmac-secret-arn}}]`; no new `AWS::SecretsManager::Secret`; no IAM `*`; no foreign-region string; `provider-config.ts` diff == 0; legacy diff == 0; no real `shpss_` in staged diff.

**Flaky re-runs:** 3/3 consistent.

**Staging note:** CDK files (core-service-task-def-stack.ts, its test, updated bin/app.ts) are in the worktree but not staged — must be added before Founder commit.

**Next:** Stage 6 — Rohan (CTO Advisor Final-Review). Spot-re-runs ≥3 gates + writes 14-retro.md.

---

## 2026-05-29 — Stage 6 (Final Review + delegated Founder gate) — Rohan (CTO Advisor)

**Verdict:** APPROVE-WITH-CAVEATS — signed on Founder's behalf under standing delegation. Hard-rule deviation check = ZERO deviations, so delegation applies cleanly.

**Verify-the-verifier (load-bearing, re-run by Rohan):** Injected an `@aws-sdk/client-secrets-manager` import into `boot-assert.ts` → `no-aws-sdk-boundary.test.ts` RED (named exact file) → `git checkout` → hash byte-identical (`ddf80bcf1c6dd7d221b6eb8643311a0603b4387b` before AND after) → GREEN 6/6. Non-vacuity confirmed; not a tautology.

**Other gates re-run (5):** provider-config.ts diff == 0 (staged+worktree); core-service 262 passed/30 skipped; boot-assert.test 11/11; infra/cdk 49/49; `cdk synth CoreServiceTaskDefStack` → secrets via `Fn::ImportValue brain-app-shopify-hmac-secret-arn`, 0 foreign-region, 0 `shpss_`, 0 new `AWS::SecretsManager::Secret`, 1 `AWS::ECS::TaskDefinition`, IAM all-ARN-scoped (no `*`; the auto-added `DescribeSecret` is scoped to the same secret ARN — no widening). All match Tanvi's PASS.

**8 CFs:** all MET. **Paradigm:** sql, ₹0/mo, zero LLM/ML. **Drift:** none. **Over-engineering:** none (8 files == plan §17; no extra deps/abstractions/observability). **Multi-tenancy:** N/A (app-level singleton secret).

**Staging finding (not a bounce):** the 3 CDK files were unstaged at review (Shreya + Tanvi flagged; Rohan re-confirmed). Augmented `pending-founder-commit.md` to stage ALL 8 files in one commit. TS gate + CDK mapping must ship together.

**Parent closure:** closes the named TS follow-on of chore-app-hmac-secret-custody at BUILD level. CF-CC-OWNER-1 preserved (no Node AWS client).

**HELD-for-Stage-8:** full Fargate service + live task-role wiring + deployed container + rotated SHOPIFY_CLIENT_SECRET value into SM (never printed) + live smoke. No cdk deploy. No commit without Founder "commit it".

**Carry-forward LOW:** L1 console.error fatal-boot style (consistent with existing pattern; fold into structured boot logger later).

**Next:** Stage 7 delegated auto-approve → Stage 8 readiness (HELD; owner platform-devops/Jatin). Founder personally authorizes the actual `git commit` + the Stage-8 live cutover.

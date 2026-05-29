# pending-founder-commit — chore-ts-oauth-app-secret-custody (Track V + Track J)

**Stage:** 3 (authored) · **Stage 6 augmentation:** Rohan (CTO Advisor) · **Builders:** Vikram (backend-developer) + Jatin (platform-devops) · **2026-05-29**
**Branch:** chore/stage2-feat-tenancy-rls-live-cutover

---

## ⚠️ STAGE-6 STAGING CORRECTION (Rohan — MUST READ BEFORE COMMIT)

At review time **only the 5 TS files were staged**; the **3 CDK files were unstaged** (`infra/cdk/bin/app.ts` modified-unstaged; the new stack + its test untracked). Shreya (Stage 4) + Tanvi (Stage 5) both flagged this, and I re-confirmed via `git status` at Stage 6. **The build is correct as-authored — this is a commit-completeness item, not a defect.** The TS boundary gate (`no-aws-sdk-boundary.test.ts`) and the CDK `secrets:` mapping it gates are two halves of ONE 8-CF contract and MUST ship in the same commit.

### Mechanical commit command (ALL 8 files — Founder runs after free-text "commit it")

```sh
cd /Users/rishabhporwal/Desktop/Brain
git add \
  apps/api-gateway/src/interfaces/server.ts \
  apps/core-service/src/__tests__/boot-assert.test.ts \
  apps/core-service/src/__tests__/no-aws-sdk-boundary.test.ts \
  apps/core-service/src/application/connectors/boot-assert.ts \
  apps/core-service/src/application/connectors/index.ts \
  infra/cdk/bin/app.ts \
  infra/cdk/lib/core-service-task-def-stack.ts \
  infra/cdk/test/core-service-task-def-stack.test.ts
# verify the staged set == these 8 (no git add -A; provider-config.ts must NOT appear, diff == 0):
git diff --cached --name-only
```

Then commit with the Track V + Track J messages below (or a single combined message). Feature-branch only — no merge to development/release/master without a Founder-driven PR. Do NOT `cdk deploy`. Never print the live `shpss_…` value.

---

## Track V — TS core-service boot-assert + AWS-SDK hard gate

### Staged files

```
apps/api-gateway/src/interfaces/server.ts
apps/core-service/src/__tests__/boot-assert.test.ts
apps/core-service/src/__tests__/no-aws-sdk-boundary.test.ts
apps/core-service/src/application/connectors/boot-assert.ts
apps/core-service/src/application/connectors/index.ts
```

### Proposed commit message

```
feat(core-service): boot-assert for SHOPIFY_CLIENT_SECRET + AWS-SDK hard gate (CF-TS-FAILFAST-1, CF-TS-NO-AWS-CLIENT-1, CF-TS-NEVERLOG-1)

- New apps/core-service/src/application/connectors/boot-assert.ts:
  pure assertShopifyOAuthSecretsPresent(env): string|null — mirrors the
  gateway assertBootableAuthConfig pattern (server.ts:60-76); presence/
  non-empty check only; never reads/logs the value; names var only.

- Re-exported from the connectors barrel (index.ts).

- Wired at gateway boot (server.ts main()) alongside assertBootableAuthConfig;
  process.exit(1) on non-null fatal string (CF-TS-FAILFAST-1).

- boot-assert.test.ts: 11 unit tests (present→null, whitespace→fatal,
  empty→fatal, never-log negative, injectable-env isolation).

- no-aws-sdk-boundary.test.ts: hard gate — greps production source tree
  (excl. __tests__) + package.json for any aws-sdk dep → ZERO assertion;
  never-log cross-check on the boot assert (CF-TS-NEVERLOG-1).

- requireEnv / validateShopifyHmac / exchangeShopify UNTOUCHED (CF-TS-HMAC-CONST-1).
- Zero AWS SDK added to core-service (CF-TS-NO-AWS-CLIENT-1 holds).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### Reversibility recipe (Track V)

1. Revert `apps/api-gateway/src/interfaces/server.ts`: remove the `assertShopifyOAuthSecretsPresent` import and the 8-line boot call block in `main()`.
2. Delete `apps/core-service/src/application/connectors/boot-assert.ts`.
3. Remove the `assertShopifyOAuthSecretsPresent` re-export from `apps/core-service/src/application/connectors/index.ts`.
4. Delete the two test files.
No schema, no data, no deployed resource touched — purely additive code.

---

## Track J — CDK task-def `secrets:` mapping (authored-not-deployed)

### Staged files

```
infra/cdk/bin/app.ts
infra/cdk/lib/core-service-task-def-stack.ts
infra/cdk/test/core-service-task-def-stack.test.ts
```

### Proposed commit message

```
feat(infra-cdk): representative core-service Fargate task-def with secrets: mapping (CF-HMAC-TS-OWNER-INJECT-1, CF-TS-SAME-KEY-1, CF-TS-RESIDENCY-1, CF-TS-INJECT-SYNTH-1)

AUTHORED, NOT DEPLOYED (no cdk deploy; HELD-Stage-8 for live wiring).

- infra/cdk/lib/core-service-task-def-stack.ts (new):
  Representative FargateTaskDefinition with ONE container + ONE secrets: entry:
    SHOPIFY_CLIENT_SECRET ← ecs.Secret.fromSecretsManager(importedSecret)
  importedSecret = Secret.fromSecretCompleteArn(Fn.importValue("brain-app-shopify-hmac-secret-arn"))
  — imports the EXISTING secret from CredentialCustodyStack (CF-TS-SAME-KEY-1: 0 new secrets).
  Residency guard: constructor throws on non-ap-south-1 (CF-TS-RESIDENCY-1).
  Least-priv execution role: GetSecretValue + kms:Decrypt on THIS secret + CMK only.

- infra/cdk/bin/app.ts: CoreServiceTaskDefStack registered (ap-south-1, no live account needed).

- infra/cdk/test/core-service-task-def-stack.test.ts (new, 16 tests):
  #1 ECS::TaskDefinition count = 1
  #2 Secrets[SHOPIFY_CLIENT_SECRET].ValueFrom = Fn::ImportValue("brain-app-shopify-hmac-secret-arn")
  #3 No us-/eu- region strings in template (CF-TS-RESIDENCY-1)
  #4 SecretsManager::Secret count = 0 (CF-TS-SAME-KEY-1)
  #5 No plaintext SHOPIFY_CLIENT_SECRET in Environment; no shpss_ literal (CF-TS-NEVERLOG-1)
  #6 Wrong-region throws (CF-TS-RESIDENCY-1)

cdk synth: PASS (both stacks). npm test: 49/49 PASS.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### Reversibility recipe (Track J)

1. Delete `infra/cdk/lib/core-service-task-def-stack.ts`.
2. Delete `infra/cdk/test/core-service-task-def-stack.test.ts`.
3. Revert `infra/cdk/bin/app.ts` to remove the `CoreServiceTaskDefStack` import and instantiation, restore the original `new CredentialCustodyStack(...)` call (no variable binding needed).
No live AWS resource exists — the stack is authored-not-deployed. `cdk destroy` is not needed.

---

## HELD-for-Stage-8 (do NOT deploy/provision without Founder authorization)

- Live core-service task-role injection wiring.
- The rotated `SHOPIFY_CLIENT_SECRET` value provisioned into SM (`brain/_app/shopify/hmac_secret`). Never print the live value.
- No `cdk deploy`.

/**
 * CoreServiceTaskDefStack — representative Fargate task definition for core-service.
 *
 * AUTHORED, NOT DEPLOYED.
 * This stack is synthesized + tested in CI (`cdk synth` + assertions test).
 * Real provisioning (live task-role wiring + deployed core-service container) is
 * the HELD Stage-8 Founder/Jatin-at-console ceremony.
 * DO NOT run `cdk deploy` without explicit Founder authorization.
 *
 * Purpose: declare the ECS task-def `secrets:` mapping that injects the
 * ap-south-1 SM secret `brain/_app/shopify/hmac_secret` → container env var
 * `SHOPIFY_CLIENT_SECRET` at Fargate container start. core-service reads the var
 * via `process.env` / `requireEnv` exactly as today — zero AWS SDK in TS.
 *
 * Cross-stack reference strategy:
 *   The secret and CMK are owned by CredentialCustodyStack which exports them via
 *   named CF exports (`brain-app-shopify-hmac-secret-arn`,
 *   `brain-credential-custody-cmk-arn`).  We import them here via
 *   `cdk.Fn.importValue(...)` to avoid a circular CDK cross-stack dependency
 *   (the custody stack must NOT depend on this stack's execution role).
 *   The `ecs.Secret.fromSecretsManager(Secret.fromSecretCompleteArn(...))` pattern
 *   resolves the same ap-south-1 SM ARN at container start — same secret, no
 *   re-declaration (CF-TS-SAME-KEY-1).
 *
 * Constraints (all verified by test/core-service-task-def-stack.test.ts):
 *   CF-HMAC-TS-OWNER-INJECT-1 — platform env-injection; TS stays AWS-free.
 *   CF-TS-SAME-KEY-1           — imports existing `brain-app-shopify-hmac-secret-arn`;
 *                                NO new AWS::SecretsManager::Secret in this stack.
 *   CF-TS-RESIDENCY-1          — stack pinned ap-south-1; imported ARN is ap-south-1.
 *   CF-TS-INJECT-SYNTH-1       — synth-level assertions prove the mapping; no live container.
 *   CF-TS-NEVERLOG-1           — no plaintext secret in Environment; no `shpss_` literal.
 *
 * Scope (do NOT expand without Founder authorization):
 *   - ONE container definition with ONE `secrets:` entry (the Shopify HMAC secret).
 *   - Minimal task-execution role with least-priv GetSecretValue + KMS Decrypt on
 *     THIS secret + THIS CMK only. No IAM widening (CF-CC-IAM-LEASTPRIV-1).
 *   - Full Fargate service (networking, ALB, autoscaling, ECR image, task-role attach)
 *     is HELD-Stage-8 infra.
 *
 * @paradigm sql
 * @residency ap-south-1 (DPDP in-region; CF-TS-RESIDENCY-1)
 */
import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

/**
 * The CF export name from CredentialCustodyStack for the Shopify HMAC secret ARN.
 * Defined as a constant here so the test can reference it in its assertions.
 */
export const SHOPIFY_HMAC_SECRET_EXPORT_NAME = "brain-app-shopify-hmac-secret-arn";

/**
 * The CF export name from CredentialCustodyStack for the credential CMK ARN.
 */
export const CREDENTIAL_CMK_EXPORT_NAME = "brain-credential-custody-cmk-arn";

export class CoreServiceTaskDefStack extends cdk.Stack {
  /**
   * The representative Fargate task definition for core-service.
   * Exposed for synth-level assertions in the test harness.
   */
  public readonly taskDef: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // -------------------------------------------------------------------------
    // RESIDENCY GUARD (CF-TS-RESIDENCY-1)
    // Mirrors the guard in credential-custody-stack.ts:112.
    // Fails fast at synth if region is ever changed — the resolved secret ARN
    // must be ap-south-1 (DPDP in-region requirement).
    // -------------------------------------------------------------------------
    if (this.region !== "ap-south-1" && !cdk.Token.isUnresolved(this.region)) {
      throw new Error(
        `CoreServiceTaskDefStack MUST be synthesized in ap-south-1 (CF-TS-RESIDENCY-1). ` +
          `Got: ${this.region}. The secrets: mapping must resolve an ap-south-1 ARN — ` +
          `refusing to continue (DPDP/residency).`
      );
    }

    // -------------------------------------------------------------------------
    // Import the secret + CMK ARN from CredentialCustodyStack via CF exports.
    //
    // CF-TS-SAME-KEY-1: we import the EXISTING secret ARN (owned by
    // CredentialCustodyStack) — we do NOT create a new Secret resource here.
    // Assertion #4 in the test suite confirms resourceCountIs("AWS::SecretsManager::Secret", 0).
    //
    // Using Fn.importValue avoids a circular CDK cross-stack dependency:
    //   CredentialCustodyStack must NOT have a DependsOn edge back to this stack.
    //   The one-directional import (this stack → custody stack) is correct and CDK-safe.
    // -------------------------------------------------------------------------
    const shopifyHmacSecretArn = cdk.Fn.importValue(SHOPIFY_HMAC_SECRET_EXPORT_NAME);
    const credentialCmkArn = cdk.Fn.importValue(CREDENTIAL_CMK_EXPORT_NAME);

    // Reconstruct the ISecret interface from the imported ARN so
    // ecs.Secret.fromSecretsManager can reference it. This does NOT create a
    // new CF resource (fromSecretCompleteArn is a CDK import construct — no
    // AWS::SecretsManager::Secret is emitted).
    const importedSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "ImportedAppShopifyHmacSecret",
      shopifyHmacSecretArn
    );

    // -------------------------------------------------------------------------
    // Task execution role — least privilege (CF-TS-RESIDENCY-1 + CF-CC-IAM-LEASTPRIV-1)
    //
    // Grants ECS permission to pull the secret from SM + decrypt via the CMK at
    // container start. Scope:
    //   - secretsmanager:GetSecretValue on THIS secret ARN ONLY (not brain/*)
    //   - kms:Decrypt on THIS CMK ARN ONLY
    //
    // NOT attaching the broader custodyPolicy (which grants put/seal/create on
    // brain/* — over-broad for a read-only injection consumer).
    // The full task-role (application-level permissions) is HELD-Stage-8.
    // -------------------------------------------------------------------------
    const executionRole = new iam.Role(this, "CoreServiceTaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description:
        "ECS task execution role for core-service — grants SM GetSecretValue + KMS Decrypt " +
        "on brain/_app/shopify/hmac_secret ONLY. Least-priv injection role. CF-TS-RESIDENCY-1.",
    });

    // GetSecretValue on THIS secret only.
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CoreServiceGetShopifyHmacSecret",
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [importedSecret.secretArn],
      })
    );

    // KMS Decrypt on THIS CMK only.
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CoreServiceDecryptShopifyHmacCmk",
        effect: iam.Effect.ALLOW,
        actions: ["kms:Decrypt"],
        resources: [credentialCmkArn],
      })
    );

    // -------------------------------------------------------------------------
    // Fargate task definition (representative; HELD-Stage-8 for full service)
    //
    // cpu/memoryLimitMiB: minimal values for synth. Real sizing is Stage-8 infra.
    // executionRole: the least-priv role above (reads secret at container start).
    // taskRole: HELD — the application-level role for core-service is not within
    //   this slice's scope (no deployed container yet, G5).
    // -------------------------------------------------------------------------
    this.taskDef = new ecs.FargateTaskDefinition(this, "CoreServiceTaskDef", {
      cpu: 256,
      memoryLimitMiB: 512,
      executionRole,
    });

    // -------------------------------------------------------------------------
    // Container definition — ONE container, ONE secrets: entry (CF-TS-SAME-KEY-1)
    //
    // image: placeholder (no ECR repo yet; HELD-Stage-8).
    //   ContainerImage.fromRegistry uses a registry string; at synth this becomes
    //   a plain Image field in the CF template — no AWS call.
    //
    // secrets: (CF-HMAC-TS-OWNER-INJECT-1 + CF-TS-RESIDENCY-1)
    //   SHOPIFY_CLIENT_SECRET ← ecs.Secret.fromSecretsManager(importedSecret)
    //   ECS resolves the ap-south-1 SM ARN, decrypts via CMK, and injects the value
    //   as an env var at container start. core-service reads it via process.env exactly.
    //
    // environment (plaintext): intentionally empty — NO SHOPIFY_CLIENT_SECRET here
    //   (CF-TS-NEVERLOG-1). Secrets must be in secrets:, never in environment:.
    //
    // logging: intentionally omitted (no log group required for the scaffold;
    //   full logging config is HELD-Stage-8).
    // -------------------------------------------------------------------------
    this.taskDef.addContainer("core-service", {
      image: ecs.ContainerImage.fromRegistry(
        "public.ecr.aws/amazonlinux/amazonlinux:latest"
        // PLACEHOLDER — HELD-Stage-8: real ECR image ARN (ECR repo + CI pipeline).
        // This string is a well-known public image, never a real core-service build.
        // It does NOT contain any credential or sensitive value.
      ),
      secrets: {
        // CF-HMAC-TS-OWNER-INJECT-1: platform env-injection via ECS secrets: entry.
        // CF-TS-SAME-KEY-1: importedSecret is the EXISTING appShopifyHmacSecret — no new secret.
        // CF-TS-RESIDENCY-1: the resolved ARN is the ap-south-1 import from custody stack.
        // CF-TS-NEVERLOG-1: this is the secrets: block (SM-sourced), NOT the environment:
        //   (plaintext) block. The value is never in the CF template; only the ARN reference.
        SHOPIFY_CLIENT_SECRET: ecs.Secret.fromSecretsManager(importedSecret),
      },
      // environment: explicitly empty — SHOPIFY_CLIENT_SECRET must NEVER appear here.
      // CF-TS-NEVERLOG-1 assertion (#5 in §4.3) enforces this at synth time.
      environment: {},
    });

    // -------------------------------------------------------------------------
    // Stack output — the task definition ARN, for Stage-8 ceremony reference.
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, "CoreServiceTaskDefArn", {
      value: this.taskDef.taskDefinitionArn,
      description:
        "Representative core-service Fargate task-def ARN. " +
        "AUTHORED NOT DEPLOYED — full service wiring is HELD-Stage-8. " +
        "CF-HMAC-TS-OWNER-INJECT-1.",
      exportName: "brain-core-service-task-def-arn",
    });
  }
}

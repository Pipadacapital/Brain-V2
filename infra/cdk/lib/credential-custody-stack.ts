/**
 * CredentialCustodyStack — Brain IaC for AWS Secrets Manager credential custody.
 *
 * AUTHORED, NOT DEPLOYED.
 * This stack is synthesized + tested in CI (`cdk synth` + assertions test).
 * Real provisioning is the HELD Stage-8 Founder/Jatin-at-console ceremony.
 * DO NOT run `cdk deploy` without explicit Founder authorization.
 * (CF-CC-NO-LIVE-1 / CF-CC-C7-LEG-1)
 *
 * Constraints (all verified by test/credential-custody-stack.test.ts):
 *   CF-CC-RESIDENCY-1    — KMS CMK + Secrets Manager both ap-south-1; CMK-encrypted secret.
 *   CF-CC-IAM-LEASTPRIV-1 — IAM policy enumerates exactly the allowed action set on
 *                           secret:brain/* and KMS on the CMK only; no "*" resource.
 *
 * @paradigm sql
 */
import * as cdk from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/** The Brain-standard secret namespace. All brain secrets live under this prefix. */
const SECRET_NAME_PREFIX = "brain/";

/**
 * The exact set of Secrets Manager actions granted to the ingestion-service
 * custody client. This matches the Protocol surface:
 *   get  → GetSecretValue
 *   put  → CreateSecret + PutSecretValue (upsert; CreateSecret on first write, PutSecretValue thereafter)
 *   seal → DeleteSecret
 * Plus DescribeSecret (required by the boto3 upsert to check existence)
 * and TagResource (used when creating the secret with metadata tags).
 *
 * CF-CC-IAM-LEASTPRIV-1: this list is the COMPLETE and EXACT set — no "*", no wildcards.
 */
const SECRETSMANAGER_ACTIONS = [
  "secretsmanager:GetSecretValue",
  "secretsmanager:CreateSecret",
  "secretsmanager:PutSecretValue",
  "secretsmanager:DescribeSecret",
  "secretsmanager:DeleteSecret",
  "secretsmanager:TagResource",
] as const;

/**
 * The exact set of KMS actions granted on the CMK.
 * Decrypt: required for GetSecretValue (decrypting SecretString).
 * GenerateDataKey: required for CreateSecret/PutSecretValue (encrypting SecretString).
 * No other KMS actions (no kms:*, no kms:Encrypt standalone — GenerateDataKey covers it).
 */
const KMS_ACTIONS = [
  "kms:Decrypt",
  "kms:GenerateDataKey",
] as const;

export class CredentialCustodyStack extends cdk.Stack {
  /**
   * The customer-managed KMS key used to encrypt brain/* secrets.
   * Exposed as a public readonly for cross-stack references (HELD; not used yet).
   */
  public readonly credentialCmk: kms.Key;

  /**
   * A representative Secrets Manager secret resource authorizing the CMK for brain/* secrets.
   * No real SecretString is provisioned here — this is the IaC author posture.
   * Actual secrets are created in the Stage-8 ceremony.
   */
  public readonly representativeBrainSecret: secretsmanager.Secret;

  /**
   * The least-privilege managed policy for the ingestion-service IAM role that
   * runs the AwsSecretsManagerCustody client.
   * Scoped to secret:brain/* + the CMK ARN only. No "*" resource.
   */
  public readonly custodyPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // -------------------------------------------------------------------------
    // RESIDENCY GUARD (CF-CC-RESIDENCY-1)
    // Belt-and-suspenders: the app.ts entry pins env.region = "ap-south-1", and
    // we assert it here at synth time so the stack construction fails fast if the
    // region is ever changed, rather than silently producing wrong-region resources.
    // -------------------------------------------------------------------------
    if (this.region !== "ap-south-1" && !cdk.Token.isUnresolved(this.region)) {
      throw new Error(
        `CredentialCustodyStack MUST be synthesized in ap-south-1 (CF-CC-RESIDENCY-1). ` +
          `Got: ${this.region}. Refusing to continue — secrets and CMK must stay in ap-south-1 (DPDP/residency).`
      );
    }

    // -------------------------------------------------------------------------
    // 1. Customer-managed KMS CMK (CF-CC-RESIDENCY-1 + CF-CC-IAM-LEASTPRIV-1)
    //
    // Properties:
    //   - enableKeyRotation: true — annual automatic key material rotation.
    //   - removalPolicy: RETAIN — prevents accidental CMK deletion on stack destroy;
    //     a CMK can only be scheduled for deletion (7–30 day window), never instant.
    //   - pendingWindow: Duration.days(30) — maximum recovery window on key deletion.
    //   - description: identifies this key in the AWS console.
    //   - alias: "brain/credential-custody" — human-readable reference.
    //
    // NOT using the default aws/secretsmanager managed key per CF-CC-RESIDENCY-1:
    // "secret encrypted with the ap-south-1 customer-managed CMK (NOT the default
    // aws/secretsmanager key)".
    // -------------------------------------------------------------------------
    this.credentialCmk = new kms.Key(this, "CredentialCustodyCmk", {
      description:
        "Brain credential custody CMK — encrypts brain/* secrets in Secrets Manager. " +
        "ap-south-1 (DPDP in-region). CF-CC-RESIDENCY-1.",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pendingWindow: cdk.Duration.days(30),
    });

    // Human-readable alias. Does not affect the key's ARN or permissions.
    this.credentialCmk.addAlias("brain/credential-custody");

    // -------------------------------------------------------------------------
    // 2. Representative Secrets Manager secret (IaC posture, CF-CC-RESIDENCY-1)
    //
    // This secret resource establishes the CMK-encrypted posture for brain/* secrets.
    // It does NOT contain a real SecretString — provisioning real credentials is
    // the HELD Stage-8 ceremony (CF-CC-NO-LIVE-1).
    //
    // Secret name: "brain/custody-posture" — a documentation-only sentinel resource
    // that ensures the CMK + Secrets Manager integration is captured in the IaC.
    // Individual per-workspace secrets (brain/{ws}/{vendor}/credential) are created
    // in the Stage-8 ceremony using the Python custody_factory + boto3 client.
    //
    // encryptionKey: the CMK above (NOT the default aws/secretsmanager key).
    // removalPolicy: RETAIN — never auto-delete a secret from IaC teardown.
    // -------------------------------------------------------------------------
    this.representativeBrainSecret = new secretsmanager.Secret(
      this,
      "BrainCustodyPostureSecret",
      {
        secretName: `${SECRET_NAME_PREFIX}custody-posture`,
        description:
          "IaC posture sentinel — establishes CMK-encrypted brain/* secret convention. " +
          "No real credential value. Stage-8 ceremony provisions actual secrets. (CF-CC-NO-LIVE-1)",
        encryptionKey: this.credentialCmk,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      }
    );

    // -------------------------------------------------------------------------
    // 3. Least-privilege IAM managed policy (CF-CC-IAM-LEASTPRIV-1)
    //
    // This policy is attached to the ingestion-service IAM role in the Stage-8
    // ceremony. It grants ONLY the operations the AwsSecretsManagerCustody Protocol
    // surface (get/put/seal) needs — nothing more.
    //
    // Resource scoping (no "*"):
    //   - Secrets Manager: arn:aws:secretsmanager:ap-south-1:*:secret:brain/*
    //     The account is left as a wildcard because we synthesize without a real
    //     account ID (NO-LIVE-1); in the Stage-8 ceremony the role policy is applied
    //     to the actual account. The SECRET PATH restriction (brain/*) is what
    //     enforces the workspace namespace — cross-account widening is a separate
    //     network/perimeter concern.
    //   - KMS: the exact CMK ARN only (this.credentialCmk.keyArn).
    //
    // The secretsmanager resource ARN uses a trailing "/*" because Secrets Manager
    // appends a 6-character random suffix to secret names (e.g., "brain/foo-Ab1cDe").
    // The wildcard after "brain/" is REQUIRED for the path match and is NOT a
    // "resource: *" wildcard — it is a resource-level path constraint.
    //
    // CF-CC-IAM-LEASTPRIV-1 checklist:
    //   [x] Exactly the enumerated SM action set (no extra permissions, no sm:*)
    //   [x] Exactly the enumerated KMS action set (no kms:*)
    //   [x] SM resource scoped to secret:brain/* (no "*")
    //   [x] KMS resource scoped to the CMK ARN (no "*")
    //   [x] Read-only is INSUFFICIENT — put/seal (CreateSecret/PutSecretValue/
    //       DeleteSecret) are included (persona-1 C2, §11 of the plan)
    // -------------------------------------------------------------------------
    this.custodyPolicy = new iam.ManagedPolicy(
      this,
      "IngestionServiceCustodyPolicy",
      {
        managedPolicyName: "brain-ingestion-credential-custody",
        description:
          "Least-privilege Secrets Manager + KMS policy for the Brain ingestion-service " +
          "AwsSecretsManagerCustody client. Scoped to brain/* secrets + the CMK only. " +
          "CF-CC-IAM-LEASTPRIV-1.",
        document: new iam.PolicyDocument({
          statements: [
            // --- Secrets Manager: get / put / seal (CF-CC-IAM-LEASTPRIV-1) ---
            new iam.PolicyStatement({
              sid: "BrainSecretsManagerCustody",
              effect: iam.Effect.ALLOW,
              actions: [...SECRETSMANAGER_ACTIONS],
              resources: [
                // arn:aws:secretsmanager:ap-south-1:*:secret:brain/*
                // "brain/*" is a resource PATH prefix, NOT a "*" wildcard resource.
                // Secrets Manager appends a 6-char suffix, so the trailing "/*" is required.
                `arn:aws:secretsmanager:ap-south-1:*:secret:brain/*`,
              ],
            }),

            // --- KMS: decrypt + generate-data-key on the CMK only (CF-CC-IAM-LEASTPRIV-1) ---
            new iam.PolicyStatement({
              sid: "BrainCustodyCmkAccess",
              effect: iam.Effect.ALLOW,
              actions: [...KMS_ACTIONS],
              resources: [
                // Exact CMK ARN — no "*" (CF-CC-IAM-LEASTPRIV-1: "KMS on the specific
                // ap-south-1 CMK ARN only").
                this.credentialCmk.keyArn,
              ],
            }),
          ],
        }),
      }
    );

    // -------------------------------------------------------------------------
    // Outputs — emitted at synth time; used in the Stage-8 ceremony.
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, "CredentialCmkArn", {
      value: this.credentialCmk.keyArn,
      description: "Brain credential custody CMK ARN (ap-south-1). CF-CC-RESIDENCY-1.",
      exportName: "brain-credential-custody-cmk-arn",
    });

    new cdk.CfnOutput(this, "CustodyPolicyArn", {
      value: this.custodyPolicy.managedPolicyArn,
      description:
        "Least-privilege Secrets Manager + KMS policy ARN for the ingestion-service role. CF-CC-IAM-LEASTPRIV-1.",
      exportName: "brain-ingestion-custody-policy-arn",
    });
  }
}

/**
 * BronzeStorageStack — S3 raw archive for the medallion bronze tier.
 *
 * AUTHORED, NOT DEPLOYED.
 * This stack is synthesized + tested in CI (`cdk synth` + assertions test).
 * Real provisioning is the HELD Stage-8 Founder/Jatin-at-console ceremony.
 * DO NOT run `cdk deploy` without explicit Founder authorization.
 *
 * Purpose (data-warehouse-implementation-plan.md §B7 P1-D / proposal R7):
 *   Provide the durable S3 raw archive that makes CH bronze a REPLAY CACHE
 *   (not the source of truth).  Once this stack is deployed, the CH bronze TTL
 *   can be activated (0013_bronze_ttl.sql) and the daily BACKUP cron retired.
 *
 * Architecture (proposal §2.1):
 *   Object path: s3://{bucket}/{workspace_id}/{vendor}/{y}/{m}/{d}/{idem_key}.json.zst
 *   Per-workspace KMS prefix: brain/bronze/{workspace_id}  (reuses CredentialCustodyCmk
 *   pattern — no new key infra, same CMK family, workspace-scoped alias).
 *   Lifecycle: 90d Standard → Glacier IR → delete after 7 years.
 *   S3 versioning: ON (blast-radius isolation; overwrite protection).
 *
 * Constraints (all verified by test/bronze-storage-stack.test.ts):
 *   CF-BS-RESIDENCY-1   — Stack pinned ap-south-1; S3 bucket in ap-south-1.
 *                          Constructor throws at synth if region ≠ ap-south-1.
 *   CF-BS-LIFECYCLE-1   — 90d Standard → Glacier IR → delete at 7y (2555d).
 *   CF-BS-VERSIONING-1  — S3 versioning enabled (blast-radius / overwrite protection).
 *   CF-BS-KMS-PREFIX-1  — Per-workspace KMS alias prefix brain/bronze/{ws}.
 *   CF-BS-DLQ-1         — DLQ topic name constant exported (live MSK topic is
 *                          a HELD Stage-8 ceremony; CDK models the posture).
 *
 * Cross-stack reference:
 *   The CredentialCustodyCmk ARN is imported via CF export
 *   `brain-credential-custody-cmk-arn` (same pattern as CoreServiceTaskDefStack).
 *   No new CMK is created; no IAM widening.
 *
 * @paradigm sql
 * @residency ap-south-1 (DPDP in-region; CF-BS-RESIDENCY-1)
 */
import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as kms from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The DLQ Kafka topic name (integrations.dlq.v1).
 *
 * CF-BS-DLQ-1: The live MSK topic creation is the HELD Stage-8 ceremony.
 * This constant is exported so the transform worker (P1-B) and the ingestion
 * service can reference it without hardcoding the topic name.
 *
 * MSK-Serverless is the Phase-0/1 event bus.  The topic is created at deploy
 * time in the Stage-8 ceremony.  CDK does not manage MSK topics directly
 * (Kafka admin API creates them); this constant is the authoritative name.
 */
export const DLQ_TOPIC_NAME = "integrations.dlq.v1";

/**
 * The DLQ Kafka topic partition count (Phase-0/1 sizing).
 * One partition per known integration vendor (Phase-0/1: 7 vendors).
 * Graduated at MSK graduation (TECH/00 trigger, Q1).
 */
export const DLQ_TOPIC_PARTITIONS = 7;

/**
 * DLQ topic retention: 30 days (ms).
 * Queryable poison events age out after 30d; replay is from S3 archive.
 */
export const DLQ_TOPIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30d in ms

/**
 * The S3 bucket name for the bronze raw archive.
 * Name is deterministic so it can be referenced in IaC + app config without
 * a CF output import.  brain-bronze-raw-archive is the canonical name.
 *
 * NOTE: S3 bucket names must be globally unique.  The Stage-8 ceremony appends
 * the account ID as a suffix (e.g. brain-bronze-raw-archive-123456789012) to
 * guarantee uniqueness without leaking the account ID in source control.
 * The bucket name here is the prefix; the full name is set at deploy time.
 */
export const BRONZE_BUCKET_NAME_PREFIX = "brain-bronze-raw-archive";

/**
 * The KMS alias prefix for per-workspace bronze encryption keys.
 * A workspace-scoped alias follows the pattern: brain/bronze/{workspace_id}
 * The actual KMS key is the CredentialCustodyCmk (imported via CF export).
 * Per-workspace aliases are created in the Stage-8 ceremony (one per workspace).
 *
 * CF-BS-KMS-PREFIX-1: the CDK stack models the naming convention; actual
 * aliases are administered at deploy time (not synthesized here to avoid
 * workspace-count-dependent resource churn).
 */
export const BRONZE_KMS_ALIAS_PREFIX = "brain/bronze/";

/**
 * Lifecycle transition thresholds (days after object creation).
 * Matches proposal §5 cost model: Standard 90d → Glacier IR → delete 7y.
 *   - GLACIER_IR_DAYS: transition to Glacier Instant Retrieval after 90 days.
 *   - DELETE_DAYS: permanent delete after 7 years (7 × 365 = 2555 days).
 *     This implements the "delete 7y" lifecycle that bounds the total storage
 *     surface for DPDP compliance (long-term retention max = 7 years).
 */
export const LIFECYCLE_GLACIER_IR_DAYS = 90;
export const LIFECYCLE_DELETE_DAYS = 2555; // 7 years = 7 × 365

/**
 * CF export name from CredentialCustodyStack for the CMK ARN.
 * Matches CoreServiceTaskDefStack import pattern (CF-TS-SAME-KEY-1).
 */
const CREDENTIAL_CMK_EXPORT_NAME = "brain-credential-custody-cmk-arn";

// ---------------------------------------------------------------------------
// Stack
// ---------------------------------------------------------------------------

export class BronzeStorageStack extends cdk.Stack {
  /**
   * The S3 bucket for the bronze raw archive.
   * Exposed for synth-level assertions and cross-stack references.
   */
  public readonly bronzeBucket: s3.Bucket;

  /**
   * The KMS key imported from CredentialCustodyStack.
   * Same CMK pattern as CoreServiceTaskDefStack (no new key, no IAM widening).
   */
  public readonly credentialCmk: kms.IKey;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // -------------------------------------------------------------------------
    // RESIDENCY GUARD (CF-BS-RESIDENCY-1)
    // Belt-and-suspenders: app.ts pins env.region = "ap-south-1".
    // We assert here at synth time so the stack fails fast on a region change.
    // S3 bucket + KMS must stay in ap-south-1 (DPDP residency requirement).
    // -------------------------------------------------------------------------
    if (this.region !== "ap-south-1" && !cdk.Token.isUnresolved(this.region)) {
      throw new Error(
        `BronzeStorageStack MUST be synthesized in ap-south-1 (CF-BS-RESIDENCY-1). ` +
          `Got: ${this.region}. S3 bucket and KMS must stay in ap-south-1 ` +
          `(DPDP residency; data-warehouse-architecture-proposal.md §4.3).`
      );
    }

    // -------------------------------------------------------------------------
    // Import the CredentialCustodyCmk from CredentialCustodyStack.
    //
    // Same pattern as CoreServiceTaskDefStack (CF-TS-SAME-KEY-1 equivalent):
    //   - Import via Fn.importValue → no circular CDK cross-stack dependency.
    //   - NO new KMS key is created (no IAM widening, no new CMK cost).
    //   - The brain/bronze/ per-workspace aliases point to THIS key.
    //
    // Per-workspace aliases (brain/bronze/{workspace_id}) are administered at
    // the Stage-8 ceremony, not synthesized here (avoids workspace-count churn).
    // -------------------------------------------------------------------------
    const credentialCmkArn = cdk.Fn.importValue(CREDENTIAL_CMK_EXPORT_NAME);
    this.credentialCmk = kms.Key.fromKeyArn(this, "ImportedCredentialCmk", credentialCmkArn);

    // -------------------------------------------------------------------------
    // S3 bronze raw archive bucket (CF-BS-VERSIONING-1 + CF-BS-LIFECYCLE-1)
    //
    // Properties:
    //   bucketName:     BRONZE_BUCKET_NAME_PREFIX (Stage-8 ceremony appends account suffix).
    //                   Using a fixed prefix ensures the app config can reference it
    //                   without a CF output import.  The suffix is added at deploy time.
    //   versioned:      true — blast-radius isolation; prevents overwrite of archived events.
    //   encryptionKey:  the imported CredentialCustodyCmk — same key family as SM secrets.
    //                   enforceSSL: true — TLS in transit (DPDP + OWASP transport security).
    //   blockPublicAccess: BLOCK_ALL — bronze data is never public (DPDP PII posture).
    //   removalPolicy:  RETAIN — never auto-delete the bronze archive on stack destroy.
    //   autoDeleteObjects: false — explicit protect; RETAIN + no auto-delete.
    //
    // Lifecycle rules (CF-BS-LIFECYCLE-1):
    //   - After 90 days: transition to S3 Glacier Instant Retrieval (5-6x cheaper
    //     than Standard for read-once archive; ~$0.004/GB/mo vs ~$0.023/GB/mo).
    //   - After 7 years (2555 days): DELETE.  Bounds total storage surface for
    //     DPDP compliance (long-term retention max = 7 years).
    //   - Non-current version expiration after 90 days (versioning cleanup):
    //     keeps the S3 cost bounded when objects are re-uploaded during replay.
    // -------------------------------------------------------------------------
    this.bronzeBucket = new s3.Bucket(this, "BronzeRawArchiveBucket", {
      // Name prefix (Stage-8 ceremony appends account suffix for global uniqueness).
      // The full name is brain-bronze-raw-archive-{account_id}.
      bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,

      // Versioning ON (CF-BS-VERSIONING-1): blast-radius isolation.
      versioned: true,

      // CMK encryption — same key as CredentialCustodyStack brain/* secrets.
      encryptionKey: this.credentialCmk,
      encryption: s3.BucketEncryption.KMS,
      bucketKeyEnabled: true, // reduce per-request KMS call cost

      // No public access (DPDP PII posture).
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      // TLS in transit (DPDP + OWASP A02).
      enforceSSL: true,

      // RETAIN — never auto-delete on stack destroy (bronze is the durable SoT).
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,

      // Lifecycle (CF-BS-LIFECYCLE-1):
      //   90d Standard → Glacier IR → delete at 7y (2555d).
      lifecycleRules: [
        {
          id: "BronzeArchiveLifecycle",
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(LIFECYCLE_GLACIER_IR_DAYS),
            },
          ],
          expiration: cdk.Duration.days(LIFECYCLE_DELETE_DAYS),
          // Non-current version cleanup: expire after 90 days to bound
          // version-metadata growth on re-uploads during replay operations.
          noncurrentVersionExpiration: cdk.Duration.days(LIFECYCLE_GLACIER_IR_DAYS),
        },
      ],

      // CORS: not needed — bronze is write-only from ingestion-service (no browser access).
      cors: [],
    });

    // -------------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------------

    new cdk.CfnOutput(this, "BronzeBucketName", {
      value: this.bronzeBucket.bucketName,
      description:
        "Brain bronze raw archive S3 bucket name (ap-south-1). " +
        "Set S3_BRONZE_BUCKET env var to this value in ingestion-service. " +
        "CF-BS-RESIDENCY-1 + CF-BS-VERSIONING-1.",
      exportName: "brain-bronze-bucket-name",
    });

    new cdk.CfnOutput(this, "BronzeBucketArn", {
      value: this.bronzeBucket.bucketArn,
      description:
        "Brain bronze raw archive S3 bucket ARN. " +
        "Used in Stage-8 IAM policy wiring for ingestion-service task role. " +
        "CF-BS-RESIDENCY-1.",
      exportName: "brain-bronze-bucket-arn",
    });

    new cdk.CfnOutput(this, "BronzeKmsAliasPrefix", {
      value: BRONZE_KMS_ALIAS_PREFIX,
      description:
        "Per-workspace KMS alias prefix for bronze encryption. " +
        "Full alias: brain/bronze/{workspace_id}. " +
        "Aliases are created in the Stage-8 ceremony. " +
        "CF-BS-KMS-PREFIX-1.",
      exportName: "brain-bronze-kms-alias-prefix",
    });

    new cdk.CfnOutput(this, "DlqTopicName", {
      value: DLQ_TOPIC_NAME,
      description:
        "DLQ Kafka topic name (integrations.dlq.v1). " +
        "Topic creation is the HELD Stage-8 MSK ceremony. " +
        "CF-BS-DLQ-1.",
      exportName: "brain-dlq-topic-name",
    });
  }
}

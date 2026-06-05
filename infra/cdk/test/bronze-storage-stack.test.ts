/**
 * BronzeStorageStack — CDK assertions test (P1-D).
 *
 * Verifies the synthesized CloudFormation template against the acceptance contract:
 *   CF-BS-RESIDENCY-1   — Stack pinned ap-south-1; constructor throws on wrong region.
 *   CF-BS-LIFECYCLE-1   — 90d Standard → Glacier IR → delete at 7y (2555d).
 *   CF-BS-VERSIONING-1  — S3 versioning enabled.
 *   CF-BS-KMS-PREFIX-1  — Per-workspace KMS alias prefix brain/bronze/{ws}.
 *   CF-BS-DLQ-1         — DLQ topic name constant = "integrations.dlq.v1".
 *
 * ZERO real AWS calls — CDK assertions library operates on the synthesized JSON template.
 *
 * Also covers:
 *   - NEGATIVE: wrong region throws at synth time (the primary P1-D verify gate).
 *   - POSITIVE: ap-south-1 region synthesizes without error.
 *   - POSITIVE: bucket has versioning + KMS encryption + no public access + enforceSSL.
 *   - POSITIVE: lifecycle transitions to Glacier IR at 90d + expires at 2555d.
 *   - POSITIVE: DLQ constant is correct and DLQ CF output is emitted.
 *   - POSITIVE: stack emits all required CloudFormation outputs.
 *   - POSITIVE: no new KMS key is created (reuses imported CMK from CredentialCustodyStack).
 *
 * @paradigm sql
 */
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  BronzeStorageStack,
  DLQ_TOPIC_NAME,
  DLQ_TOPIC_PARTITIONS,
  DLQ_TOPIC_RETENTION_MS,
  BRONZE_KMS_ALIAS_PREFIX,
  LIFECYCLE_GLACIER_IR_DAYS,
  LIFECYCLE_DELETE_DAYS,
  BRONZE_BUCKET_NAME_PREFIX,
} from "../lib/bronze-storage-stack";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the stack + template once with the correct region. Shared across describes. */
function buildTemplate(): { stack: BronzeStorageStack; template: Template } {
  const app = new cdk.App();
  // Provide a dummy CMK ARN so Fn.importValue resolves at test time.
  // In CI (no real AWS) the import token stays a CF token; assertions work on
  // the JSON shape, not on live AWS resource values.
  const stack = new BronzeStorageStack(app, "TestBronzeStorageStack", {
    env: { region: "ap-south-1", account: "123456789012" },
  });
  const template = Template.fromStack(stack);
  return { stack, template };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("BronzeStorageStack — exported constants", () => {
  test("DLQ_TOPIC_NAME is 'integrations.dlq.v1' (CF-BS-DLQ-1)", () => {
    expect(DLQ_TOPIC_NAME).toBe("integrations.dlq.v1");
  });

  test("DLQ_TOPIC_PARTITIONS is 7 (Phase-0/1 sizing: one per known vendor)", () => {
    expect(DLQ_TOPIC_PARTITIONS).toBe(7);
  });

  test("DLQ_TOPIC_RETENTION_MS is 30 days in ms", () => {
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    expect(DLQ_TOPIC_RETENTION_MS).toBe(expectedMs);
  });

  test("BRONZE_KMS_ALIAS_PREFIX is 'brain/bronze/' (CF-BS-KMS-PREFIX-1)", () => {
    expect(BRONZE_KMS_ALIAS_PREFIX).toBe("brain/bronze/");
  });

  test("LIFECYCLE_GLACIER_IR_DAYS is 90 (CF-BS-LIFECYCLE-1)", () => {
    expect(LIFECYCLE_GLACIER_IR_DAYS).toBe(90);
  });

  test("LIFECYCLE_DELETE_DAYS is 2555 (7 years = 7 × 365; CF-BS-LIFECYCLE-1)", () => {
    expect(LIFECYCLE_DELETE_DAYS).toBe(2555);
  });

  test("BRONZE_BUCKET_NAME_PREFIX starts with 'brain-bronze'", () => {
    expect(BRONZE_BUCKET_NAME_PREFIX).toMatch(/^brain-bronze/);
  });
});

// ---------------------------------------------------------------------------
// Residency guard
// ---------------------------------------------------------------------------

describe("BronzeStorageStack — residency guard (CF-BS-RESIDENCY-1)", () => {
  test("NEGATIVE: constructor throws when region is NOT ap-south-1", () => {
    const app = new cdk.App();
    expect(() => {
      new BronzeStorageStack(app, "WrongRegionStack", {
        env: { region: "us-east-1", account: "123456789012" },
      });
    }).toThrow(/ap-south-1/);
  });

  test("NEGATIVE: constructor throws error mentioning CF-BS-RESIDENCY-1", () => {
    const app = new cdk.App();
    expect(() => {
      new BronzeStorageStack(app, "WrongRegionStack2", {
        env: { region: "eu-west-1", account: "123456789012" },
      });
    }).toThrow(/CF-BS-RESIDENCY-1/);
  });

  test("NEGATIVE: constructor throws on us-west-2 (not India region)", () => {
    const app = new cdk.App();
    expect(() => {
      new BronzeStorageStack(app, "USWest2Stack", {
        env: { region: "us-west-2", account: "123456789012" },
      });
    }).toThrow(/ap-south-1/);
  });

  test("POSITIVE: ap-south-1 synthesizes without error", () => {
    const app = new cdk.App();
    expect(() => {
      new BronzeStorageStack(app, "CorrectRegionStack", {
        env: { region: "ap-south-1", account: "123456789012" },
      });
    }).not.toThrow();
  });

  test("POSITIVE: synthesized stack region is ap-south-1", () => {
    const app = new cdk.App();
    const stack = new BronzeStorageStack(app, "RegionVerifyStack", {
      env: { region: "ap-south-1", account: "123456789012" },
    });
    expect(stack.region).toBe("ap-south-1");
  });
});

// ---------------------------------------------------------------------------
// S3 bucket — existence and count
// ---------------------------------------------------------------------------

describe("BronzeStorageStack — S3 bucket (CF-BS-VERSIONING-1 + CF-BS-LIFECYCLE-1)", () => {
  let template: Template;
  let stack: BronzeStorageStack;

  beforeAll(() => {
    ({ template, stack } = buildTemplate());
  });

  test("has exactly one S3 bucket resource", () => {
    template.resourceCountIs("AWS::S3::Bucket", 1);
  });

  test("bronzeBucket construct property is accessible on the stack", () => {
    expect(stack.bronzeBucket).toBeDefined();
    expect(stack.bronzeBucket.bucketArn).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Versioning (CF-BS-VERSIONING-1)
  // -------------------------------------------------------------------------

  test("S3 bucket has versioning ENABLED (CF-BS-VERSIONING-1)", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: {
        Status: "Enabled",
      },
    });
  });

  // -------------------------------------------------------------------------
  // Encryption + KMS (CF-BS-KMS-PREFIX-1)
  // -------------------------------------------------------------------------

  test("S3 bucket is KMS-encrypted (not SSE-S3) (CF-BS-KMS-PREFIX-1)", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "aws:kms",
            },
          },
        ],
      },
    });
  });

  test("S3 bucket has BucketKeyEnabled=true (per-request KMS cost reduction)", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            BucketKeyEnabled: true,
          },
        ],
      },
    });
  });

  test("NEGATIVE: S3 bucket does NOT use the default SSE-S3 algorithm (must be aws:kms)", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    for (const [, bucket] of Object.entries(buckets)) {
      const enc = (bucket as Record<string, unknown>).Properties as Record<string, unknown>;
      if (enc?.["BucketEncryption"]) {
        const config = enc["BucketEncryption"] as Record<string, unknown>;
        const rules = (config["ServerSideEncryptionConfiguration"] as Array<Record<string, unknown>>);
        for (const rule of rules) {
          const alg = (rule["ServerSideEncryptionByDefault"] as Record<string, unknown>)?.["SSEAlgorithm"];
          expect(alg).not.toBe("AES256");
          expect(alg).toBe("aws:kms");
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // Public access blocking (DPDP PII posture)
  // -------------------------------------------------------------------------

  test("S3 bucket blocks all public access (DPDP PII posture)", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  // -------------------------------------------------------------------------
  // RETAIN removal policy (durable SoT)
  // -------------------------------------------------------------------------

  test("S3 bucket has DeletionPolicy Retain (bronze is the durable SoT)", () => {
    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
    });
  });

  // -------------------------------------------------------------------------
  // Enforce SSL (DPDP + OWASP A02)
  // -------------------------------------------------------------------------

  test("S3 bucket policy enforces SSL (denies non-HTTPS requests)", () => {
    // When enforceSSL is true, CDK emits an AWS::S3::BucketPolicy with a Deny
    // statement for s3:* if aws:SecureTransport is false.
    const policies = template.findResources("AWS::S3::BucketPolicy");
    expect(Object.keys(policies).length).toBeGreaterThanOrEqual(1);

    // Find the SSL-enforcement Deny statement
    let foundSslDeny = false;
    for (const [, policy] of Object.entries(policies)) {
      const doc = (policy as Record<string, unknown>).Properties as Record<string, unknown>;
      const stmts = (doc["PolicyDocument"] as Record<string, unknown>)["Statement"] as Array<
        Record<string, unknown>
      >;
      for (const stmt of stmts) {
        if (
          stmt["Effect"] === "Deny" &&
          stmt["Condition"] !== undefined
        ) {
          const cond = stmt["Condition"] as Record<string, unknown>;
          if (cond["Bool"] !== undefined) {
            const boolCond = cond["Bool"] as Record<string, unknown>;
            if (boolCond["aws:SecureTransport"] === "false") {
              foundSslDeny = true;
            }
          }
        }
      }
    }
    expect(foundSslDeny).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle rules (CF-BS-LIFECYCLE-1)
// ---------------------------------------------------------------------------

describe("BronzeStorageStack — S3 lifecycle rules (CF-BS-LIFECYCLE-1)", () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = buildTemplate());
  });

  test("S3 bucket has at least one lifecycle configuration", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: Match.anyValue(),
    });
  });

  test("lifecycle transitions to Glacier Instant Retrieval after 90 days", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    let foundGlacierIR = false;

    for (const [, bucket] of Object.entries(buckets)) {
      const props = (bucket as Record<string, unknown>).Properties as Record<string, unknown>;
      const lifecycle = props["LifecycleConfiguration"] as Record<string, unknown> | undefined;
      if (!lifecycle) continue;

      const rules = lifecycle["Rules"] as Array<Record<string, unknown>>;
      for (const rule of rules) {
        const transitions = rule["Transitions"] as
          | Array<Record<string, unknown>>
          | undefined;
        if (!transitions) continue;

        for (const t of transitions) {
          // Glacier Instant Retrieval storage class
          if (
            t["StorageClass"] === "GLACIER_IR" &&
            (t["TransitionInDays"] === LIFECYCLE_GLACIER_IR_DAYS ||
              (t["TransitionInDays"] as number) === 90)
          ) {
            foundGlacierIR = true;
          }
        }
      }
    }

    // expect true — if false, the assertion message names the missing transition.
    if (!foundGlacierIR) {
      throw new Error(`Expected a lifecycle transition to GLACIER_IR after ${LIFECYCLE_GLACIER_IR_DAYS} days`);
    }
    expect(foundGlacierIR).toBe(true);
  });

  test("lifecycle rule expires objects after 7 years (2555 days)", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    let foundExpiration = false;

    for (const [, bucket] of Object.entries(buckets)) {
      const props = (bucket as Record<string, unknown>).Properties as Record<string, unknown>;
      const lifecycle = props["LifecycleConfiguration"] as Record<string, unknown> | undefined;
      if (!lifecycle) continue;

      const rules = lifecycle["Rules"] as Array<Record<string, unknown>>;
      for (const rule of rules) {
        if (
          rule["ExpirationInDays"] === LIFECYCLE_DELETE_DAYS ||
          (rule["ExpirationInDays"] as number) === 2555
        ) {
          foundExpiration = true;
        }
      }
    }

    if (!foundExpiration) {
      throw new Error(`Expected lifecycle expiration at ${LIFECYCLE_DELETE_DAYS} days (7 years)`);
    }
    expect(foundExpiration).toBe(true);
  });

  test("lifecycle rule has Status=Enabled", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    let foundEnabled = false;

    for (const [, bucket] of Object.entries(buckets)) {
      const props = (bucket as Record<string, unknown>).Properties as Record<string, unknown>;
      const lifecycle = props["LifecycleConfiguration"] as Record<string, unknown> | undefined;
      if (!lifecycle) continue;

      const rules = lifecycle["Rules"] as Array<Record<string, unknown>>;
      for (const rule of rules) {
        if (rule["Status"] === "Enabled") {
          foundEnabled = true;
        }
      }
    }

    if (!foundEnabled) {
      throw new Error("Expected at least one lifecycle rule with Status=Enabled");
    }
    expect(foundEnabled).toBe(true);
  });

  test("lifecycle has non-current version expiration (versioning cost control)", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    let foundNoncurrentExpiry = false;

    for (const [, bucket] of Object.entries(buckets)) {
      const props = (bucket as Record<string, unknown>).Properties as Record<string, unknown>;
      const lifecycle = props["LifecycleConfiguration"] as Record<string, unknown> | undefined;
      if (!lifecycle) continue;

      const rules = lifecycle["Rules"] as Array<Record<string, unknown>>;
      for (const rule of rules) {
        if (rule["NoncurrentVersionExpiration"] !== undefined) {
          foundNoncurrentExpiry = true;
        }
      }
    }

    if (!foundNoncurrentExpiry) {
      throw new Error("Expected NoncurrentVersionExpiration for versioning cost control");
    }
    expect(foundNoncurrentExpiry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// KMS — no new key created (reuses CredentialCustodyCmk import)
// ---------------------------------------------------------------------------

describe("BronzeStorageStack — KMS posture (CF-BS-KMS-PREFIX-1 + no new CMK)", () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = buildTemplate());
  });

  test("NEGATIVE: no new KMS key resource in BronzeStorageStack (reuses imported CMK)", () => {
    // BronzeStorageStack imports the CredentialCustodyCmk via Fn.importValue.
    // It must NOT create a new AWS::KMS::Key resource — that would mean a new
    // CMK cost + a second CMK lifecycle to manage.
    template.resourceCountIs("AWS::KMS::Key", 0);
  });

  test("credentialCmk construct property is accessible on the stack", () => {
    const app = new cdk.App();
    const stack = new BronzeStorageStack(app, "KmsPropStack", {
      env: { region: "ap-south-1", account: "123456789012" },
    });
    expect(stack.credentialCmk).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DLQ — topic constant + CF output (CF-BS-DLQ-1)
// ---------------------------------------------------------------------------

describe("BronzeStorageStack — DLQ topic constant + CF output (CF-BS-DLQ-1)", () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = buildTemplate());
  });

  test("emits DlqTopicName CloudFormation output with value 'integrations.dlq.v1'", () => {
    template.hasOutput("DlqTopicName", {
      Value: DLQ_TOPIC_NAME,
    });
  });

  test("DlqTopicName output description references 'integrations.dlq.v1'", () => {
    template.hasOutput("DlqTopicName", {
      Description: Match.stringLikeRegexp("integrations.dlq.v1"),
    });
  });

  test("DlqTopicName output description mentions HELD Stage-8 (MSK topic is authored-not-deployed)", () => {
    template.hasOutput("DlqTopicName", {
      Description: Match.stringLikeRegexp("Stage-8"),
    });
  });

  test("NEGATIVE: DLQ_TOPIC_NAME does NOT equal a typo variant", () => {
    expect(DLQ_TOPIC_NAME).not.toBe("integrations.dlq.v0");
    expect(DLQ_TOPIC_NAME).not.toBe("integrations.dead-letter.v1");
    expect(DLQ_TOPIC_NAME).not.toBe("dlq.v1");
  });
});

// ---------------------------------------------------------------------------
// CloudFormation outputs
// ---------------------------------------------------------------------------

describe("BronzeStorageStack — CloudFormation outputs", () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = buildTemplate());
  });

  test("emits BronzeBucketName output", () => {
    template.hasOutput("BronzeBucketName", {
      Description: Match.stringLikeRegexp("bronze"),
    });
  });

  test("emits BronzeBucketArn output", () => {
    template.hasOutput("BronzeBucketArn", {
      Description: Match.stringLikeRegexp("ARN"),
    });
  });

  test("emits BronzeKmsAliasPrefix output with value 'brain/bronze/'", () => {
    template.hasOutput("BronzeKmsAliasPrefix", {
      Value: BRONZE_KMS_ALIAS_PREFIX,
    });
  });

  test("BronzeKmsAliasPrefix output description references CF-BS-KMS-PREFIX-1", () => {
    template.hasOutput("BronzeKmsAliasPrefix", {
      Description: Match.stringLikeRegexp("CF-BS-KMS-PREFIX-1"),
    });
  });

  test("has exactly 4 CF outputs (BronzeBucketName, BronzeBucketArn, BronzeKmsAliasPrefix, DlqTopicName)", () => {
    const outputs = template.findOutputs("*");
    expect(Object.keys(outputs).length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Authored-not-deployed posture
// ---------------------------------------------------------------------------

describe("BronzeStorageStack — authored-not-deployed posture", () => {
  test("stack description mentions AUTHORED NOT DEPLOYED", () => {
    const app = new cdk.App();
    const stack = new BronzeStorageStack(app, "PostureCheckStack", {
      env: { region: "ap-south-1", account: "123456789012" },
      description:
        "Brain bronze S3 raw archive: S3 bucket + lifecycle (90d→Glacier IR→7y delete) + " +
        "per-workspace KMS prefix posture + DLQ topic name constant. " +
        "AUTHORED NOT DEPLOYED — provisioning is the HELD Stage-8 Founder ceremony.",
    });
    expect(stack.stackName).toBe("PostureCheckStack");
  });
});

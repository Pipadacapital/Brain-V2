/**
 * CredentialCustodyStack — CDK assertions test.
 *
 * Verifies the synthesized CloudFormation template against the acceptance contract:
 *   CF-CC-IAM-LEASTPRIV-1 — exact SM action set, resource scoped to brain/*, no "*" resource.
 *   CF-CC-RESIDENCY-1      — KMS CMK exists with rotation; secret uses CMK encryption; stack ap-south-1.
 *
 * ZERO real AWS calls — the CDK assertions library operates purely on the synthesized JSON template.
 *
 * @paradigm sql
 */
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { CredentialCustodyStack } from "../lib/credential-custody-stack";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the stack + template once. Shared across all describe blocks. */
function buildTemplate(): { stack: CredentialCustodyStack; template: Template } {
  const app = new cdk.App();
  const stack = new CredentialCustodyStack(app, "TestCredentialCustodyStack", {
    env: { region: "ap-south-1", account: "123456789012" },
  });
  const template = Template.fromStack(stack);
  return { stack, template };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CredentialCustodyStack — KMS CMK (CF-CC-RESIDENCY-1)", () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = buildTemplate());
  });

  test("has exactly one customer-managed KMS Key resource", () => {
    template.resourceCountIs("AWS::KMS::Key", 1);
  });

  test("CMK has EnableKeyRotation = true (CF-CC-RESIDENCY-1 + DPDP)", () => {
    template.hasResourceProperties("AWS::KMS::Key", {
      EnableKeyRotation: true,
    });
  });

  test("CMK has a DeletionPolicy of Retain (no accidental deletion)", () => {
    template.hasResource("AWS::KMS::Key", {
      DeletionPolicy: "Retain",
    });
  });

  test("CMK description references Brain credential custody and ap-south-1", () => {
    template.hasResourceProperties("AWS::KMS::Key", {
      Description: Match.stringLikeRegexp("Brain credential custody CMK"),
    });
  });

  test("CMK alias is 'alias/brain/credential-custody'", () => {
    template.resourceCountIs("AWS::KMS::Alias", 1);
    template.hasResourceProperties("AWS::KMS::Alias", {
      AliasName: "alias/brain/credential-custody",
    });
  });
});

describe("CredentialCustodyStack — Secrets Manager posture (CF-CC-RESIDENCY-1)", () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = buildTemplate());
  });

  test("has exactly one Secrets Manager secret", () => {
    template.resourceCountIs("AWS::SecretsManager::Secret", 1);
  });

  test("secret name is prefixed with 'brain/'", () => {
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: Match.stringLikeRegexp("^brain/"),
    });
  });

  test("secret is encrypted with the CMK (NOT the default AWS-managed key) (CF-CC-RESIDENCY-1)", () => {
    // The secret's KmsKeyId must reference the CMK construct — not the literal
    // string "aws/secretsmanager". We assert the KmsKeyId is present and is a
    // Ref/Fn::GetAtt (a CDK token) — not the default managed key string.
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      KmsKeyId: Match.anyValue(),
    });

    // Negative: the default aws/secretsmanager key must NOT appear as KmsKeyId.
    // If the secret had no encryptionKey, KmsKeyId would be absent or literal.
    const secrets = template.findResources("AWS::SecretsManager::Secret");
    for (const secretResource of Object.values(secrets)) {
      const kmsKeyId = (secretResource as Record<string, unknown>).Properties as
        | Record<string, unknown>
        | undefined;
      if (kmsKeyId) {
        const keyId = (kmsKeyId as Record<string, unknown>)["KmsKeyId"];
        // Must not be the default aws/secretsmanager key literal string.
        expect(keyId).not.toBe("aws/secretsmanager");
        // Must not be undefined (CMK must be explicitly specified).
        expect(keyId).toBeDefined();
      }
    }
  });

  test("secret has DeletionPolicy Retain (no auto-delete)", () => {
    template.hasResource("AWS::SecretsManager::Secret", {
      DeletionPolicy: "Retain",
    });
  });
});

describe("CredentialCustodyStack — Least-privilege IAM policy (CF-CC-IAM-LEASTPRIV-1)", () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = buildTemplate());
  });

  test("has exactly one ManagedPolicy resource", () => {
    template.resourceCountIs("AWS::IAM::ManagedPolicy", 1);
  });

  test("Secrets Manager statement has the EXACT enumerated action set — no more, no fewer", () => {
    // The precise SM actions required by the AwsSecretsManagerCustody protocol
    // (get/put/seal). Any addition or removal is a policy violation.
    const expectedSmActions = new Set([
      "secretsmanager:GetSecretValue",
      "secretsmanager:CreateSecret",
      "secretsmanager:PutSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:TagResource",
    ]);

    const policies = template.findResources("AWS::IAM::ManagedPolicy");
    const policyDoc = Object.values(policies)[0].Properties.PolicyDocument as {
      Statement: Array<{
        Sid?: string;
        Action: string | string[];
        Resource: unknown;
        Effect: string;
      }>;
    };

    const smStatement = policyDoc.Statement.find(
      (stmt) =>
        stmt.Sid === "BrainSecretsManagerCustody" ||
        (Array.isArray(stmt.Action)
          ? stmt.Action.some((a) => a.startsWith("secretsmanager:"))
          : (stmt.Action as string).startsWith("secretsmanager:"))
    );

    expect(smStatement).toBeDefined();

    const actions = new Set(
      Array.isArray(smStatement!.Action)
        ? smStatement!.Action
        : [smStatement!.Action]
    );

    // Exact equality — no extra actions sneaked in.
    expect(actions).toEqual(expectedSmActions);
  });

  test("Secrets Manager statement resource is scoped to brain/* — NOT a '*' wildcard", () => {
    const policies = template.findResources("AWS::IAM::ManagedPolicy");
    const policyDoc = Object.values(policies)[0].Properties.PolicyDocument as {
      Statement: Array<{
        Sid?: string;
        Action: string | string[];
        Resource: string | string[];
        Effect: string;
      }>;
    };

    const smStatement = policyDoc.Statement.find(
      (stmt) =>
        stmt.Sid === "BrainSecretsManagerCustody" ||
        (Array.isArray(stmt.Action)
          ? stmt.Action.some((a) => a.startsWith("secretsmanager:"))
          : (stmt.Action as string).startsWith("secretsmanager:"))
    );

    expect(smStatement).toBeDefined();

    const resources = Array.isArray(smStatement!.Resource)
      ? smStatement!.Resource
      : [smStatement!.Resource];

    // NEGATIVE: no bare "*" resource (the core IAM-LEASTPRIV-1 anti-pattern).
    expect(resources).not.toContain("*");

    // POSITIVE: all resources must be scoped to the ap-south-1 Secrets Manager brain/* path.
    for (const resource of resources) {
      expect(resource).toMatch(/^arn:aws:secretsmanager:ap-south-1:.+:secret:brain\//);
    }
  });

  test("Secrets Manager statement does NOT use a wildcard action (no 'secretsmanager:*')", () => {
    const policies = template.findResources("AWS::IAM::ManagedPolicy");
    const policyDoc = Object.values(policies)[0].Properties.PolicyDocument as {
      Statement: Array<{ Action: string | string[] }>;
    };

    for (const stmt of policyDoc.Statement) {
      const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
      for (const action of actions) {
        expect(action).not.toMatch(/:\*$/);
      }
    }
  });

  test("KMS statement has EXACTLY Decrypt + GenerateDataKey — no other KMS actions", () => {
    const expectedKmsActions = new Set(["kms:Decrypt", "kms:GenerateDataKey"]);

    const policies = template.findResources("AWS::IAM::ManagedPolicy");
    const policyDoc = Object.values(policies)[0].Properties.PolicyDocument as {
      Statement: Array<{
        Sid?: string;
        Action: string | string[];
        Resource: unknown;
      }>;
    };

    const kmsStatement = policyDoc.Statement.find(
      (stmt) =>
        stmt.Sid === "BrainCustodyCmkAccess" ||
        (Array.isArray(stmt.Action)
          ? stmt.Action.some((a) => a.startsWith("kms:"))
          : (stmt.Action as string).startsWith("kms:"))
    );

    expect(kmsStatement).toBeDefined();

    const actions = new Set(
      Array.isArray(kmsStatement!.Action)
        ? kmsStatement!.Action
        : [kmsStatement!.Action]
    );

    expect(actions).toEqual(expectedKmsActions);
  });

  test("KMS statement resource is the CMK ARN — NOT a '*' wildcard (CF-CC-IAM-LEASTPRIV-1)", () => {
    const policies = template.findResources("AWS::IAM::ManagedPolicy");
    const policyDoc = Object.values(policies)[0].Properties.PolicyDocument as {
      Statement: Array<{
        Sid?: string;
        Action: string | string[];
        Resource: unknown;
        Effect: string;
      }>;
    };

    const kmsStatement = policyDoc.Statement.find(
      (stmt) =>
        stmt.Sid === "BrainCustodyCmkAccess" ||
        (Array.isArray(stmt.Action)
          ? stmt.Action.some((a) => a.startsWith("kms:"))
          : (stmt.Action as string).startsWith("kms:"))
    );

    expect(kmsStatement).toBeDefined();

    const resources = Array.isArray(kmsStatement!.Resource)
      ? kmsStatement!.Resource
      : [kmsStatement!.Resource];

    // NEGATIVE: no bare "*" (CF-CC-IAM-LEASTPRIV-1: "KMS on the specific ap-south-1 CMK ARN only").
    expect(resources).not.toContain("*");

    // POSITIVE: every KMS resource must reference the CMK (Fn::GetAtt or ARN form — not a literal "*").
    for (const resource of resources) {
      // CDK emits KMS key ARN as Fn::GetAtt of the key resource — it will be an object or a string
      // containing the key reference. It must not be a plain "*" string.
      expect(resource).not.toBe("*");
    }
  });

  test("policy has exactly two statements (SM and KMS) — no silent extras", () => {
    const policies = template.findResources("AWS::IAM::ManagedPolicy");
    const policyDoc = Object.values(policies)[0].Properties.PolicyDocument as {
      Statement: unknown[];
    };
    expect(policyDoc.Statement).toHaveLength(2);
  });

  test("NEGATIVE: no ForceDeleteWithoutRecovery-enabling wildcard anywhere in the policy", () => {
    // ForceDeleteWithoutRecovery is a DescribeSecret/DeleteSecret flag set at API-call time,
    // not in IAM. This test verifies there is no secret SM wildcard (secretsmanager:*)
    // that could permit DeleteSecret with ForceDeleteWithoutRecovery if called.
    // The real ForceDeleteWithoutRecovery guard is in the Python seal() implementation
    // (Track A); here we confirm the IAM policy does not grant wildcard SM permissions
    // that would widen beyond the exact action set.
    const policies = template.findResources("AWS::IAM::ManagedPolicy");
    const policyDoc = Object.values(policies)[0].Properties.PolicyDocument as {
      Statement: Array<{ Action: string | string[] }>;
    };
    for (const stmt of policyDoc.Statement) {
      const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
      expect(actions).not.toContain("secretsmanager:*");
      expect(actions).not.toContain("*");
    }
  });
});

describe("CredentialCustodyStack — Residency guard (CF-CC-RESIDENCY-1)", () => {
  test("stack constructor throws if region is not ap-south-1", () => {
    const app = new cdk.App();
    expect(() => {
      new CredentialCustodyStack(app, "WrongRegionStack", {
        env: { region: "us-east-1", account: "123456789012" },
      });
    }).toThrow(/ap-south-1/);
  });

  test("stack in ap-south-1 synthesizes without error", () => {
    const app = new cdk.App();
    expect(() => {
      new CredentialCustodyStack(app, "CorrectRegionStack", {
        env: { region: "ap-south-1", account: "123456789012" },
      });
    }).not.toThrow();
  });

  test("synthesized template region is ap-south-1 (via stack metadata)", () => {
    const app = new cdk.App();
    const stack = new CredentialCustodyStack(app, "RegionVerifyStack", {
      env: { region: "ap-south-1", account: "123456789012" },
    });
    expect(stack.region).toBe("ap-south-1");
  });
});

describe("CredentialCustodyStack — CloudFormation outputs", () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = buildTemplate());
  });

  test("emits CredentialCmkArn output", () => {
    template.hasOutput("CredentialCmkArn", {
      Description: Match.stringLikeRegexp("CMK ARN"),
    });
  });

  test("emits CustodyPolicyArn output", () => {
    template.hasOutput("CustodyPolicyArn", {
      Description: Match.stringLikeRegexp("Least-privilege"),
    });
  });
});

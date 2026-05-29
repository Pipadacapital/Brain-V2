#!/usr/bin/env node
/**
 * Brain CDK App — entry point.
 *
 * AUTHORED, NOT DEPLOYED.
 * Deployment is the HELD Stage-8 Founder/Jatin-at-console ceremony
 * (CF-CC-NO-LIVE-1). Run `cdk synth` for local verification only.
 * DO NOT run `cdk deploy` without explicit Founder authorization.
 *
 * @paradigm sql
 * @residency ap-south-1 (DPDP in-region; CF-CC-RESIDENCY-1)
 */
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CredentialCustodyStack } from "../lib/credential-custody-stack";

const app = new cdk.App();

new CredentialCustodyStack(app, "CredentialCustodyStack", {
  /**
   * Residency guard (CF-CC-RESIDENCY-1): pin env.region to ap-south-1.
   * Both the KMS CMK and Secrets Manager secrets are created in this region.
   * The stack constructor also asserts this at synth time.
   */
  env: {
    region: "ap-south-1",
    // Account is intentionally left as a token (resolved at deploy-time in the
    // Stage-8 ceremony) so this stack can be synthesized without real AWS creds.
  },
  description:
    "Brain credential custody: KMS CMK + Secrets Manager posture + least-privilege IAM. " +
    "AUTHORED NOT DEPLOYED — provisioning is the HELD Stage-8 Founder ceremony (CF-CC-NO-LIVE-1).",
});

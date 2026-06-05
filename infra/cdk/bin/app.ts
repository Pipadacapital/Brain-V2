#!/usr/bin/env node
/**
 * Brain CDK App — entry point.
 *
 * AUTHORED, NOT DEPLOYED.
 * Deployment is the HELD Stage-8 Founder/Jatin-at-console ceremony
 * (CF-CC-NO-LIVE-1). Run `cdk synth` for local verification only.
 * DO NOT run `cdk deploy` without explicit Founder authorization.
 *
 * Stacks (all authored-not-deployed; Stage-8 ceremony deploys each):
 *   1. CredentialCustodyStack  — KMS CMK + Secrets Manager (P0-A/B)
 *   2. CoreServiceTaskDefStack — Fargate task-def secrets injection (P0-A)
 *   3. BronzeStorageStack      — S3 bronze archive + lifecycle + DLQ posture (P1-D)
 *
 * @paradigm sql
 * @residency ap-south-1 (DPDP in-region; CF-CC-RESIDENCY-1)
 */
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CredentialCustodyStack } from "../lib/credential-custody-stack";
import { CoreServiceTaskDefStack } from "../lib/core-service-task-def-stack";
import { BronzeStorageStack } from "../lib/bronze-storage-stack";

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

new CoreServiceTaskDefStack(app, "CoreServiceTaskDefStack", {
  /**
   * Residency guard (CF-TS-RESIDENCY-1): pin env.region to ap-south-1.
   * The secrets: mapping imports the existing brain-app-shopify-hmac-secret-arn
   * CF export from CredentialCustodyStack (no circular dependency).
   * The stack constructor also asserts this at synth time.
   */
  env: {
    region: "ap-south-1",
    // Account is intentionally left as a token (resolved at deploy-time in the
    // Stage-8 ceremony) so this stack can be synthesized without real AWS creds.
  },
  description:
    "Brain core-service representative Fargate task-def: secrets: mapping " +
    "brain/_app/shopify/hmac_secret → SHOPIFY_CLIENT_SECRET (env-injection). " +
    "AUTHORED NOT DEPLOYED — live wiring is HELD-Stage-8. " +
    "CF-HMAC-TS-OWNER-INJECT-1 + CF-TS-SAME-KEY-1 + CF-TS-RESIDENCY-1.",
});

new BronzeStorageStack(app, "BronzeStorageStack", {
  /**
   * Residency guard (CF-BS-RESIDENCY-1): pin env.region to ap-south-1.
   * S3 bucket + KMS must stay in ap-south-1 (DPDP residency requirement).
   * Imports brain-credential-custody-cmk-arn from CredentialCustodyStack
   * (same pattern as CoreServiceTaskDefStack — no new CMK, no IAM widening).
   *
   * Deploy sequence (Stage-8 ceremony, HELD):
   *   1. Deploy CredentialCustodyStack first (produces brain-credential-custody-cmk-arn).
   *   2. Deploy BronzeStorageStack (consumes the CMK ARN import).
   *   3. Set S3_BRONZE_BUCKET env var in ingestion-service (from BronzeBucketName output).
   *   4. Apply 0013_bronze_ttl.sql to CH (only after S3 is confirmed live).
   *   5. Retire the daily bronze_backup_cron.py stopgap.
   */
  env: {
    region: "ap-south-1",
    // Account is intentionally left as a token (resolved at deploy-time in the
    // Stage-8 ceremony) so this stack can be synthesized without real AWS creds.
  },
  description:
    "Brain bronze S3 raw archive: S3 bucket + lifecycle (90d→Glacier IR→7y delete) + " +
    "per-workspace KMS prefix posture + DLQ topic name constant. " +
    "AUTHORED NOT DEPLOYED — provisioning is the HELD Stage-8 Founder ceremony. " +
    "CF-BS-RESIDENCY-1 + CF-BS-LIFECYCLE-1 + CF-BS-VERSIONING-1 + CF-BS-KMS-PREFIX-1 + CF-BS-DLQ-1. " +
    "Must land ≤14 days after P0-C (bronze writer) per R7 SLA.",
});

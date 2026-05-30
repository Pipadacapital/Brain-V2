# Brain Live Cutover Checklist
## As of 2026-05-29 — All held ceremonies across every merged feature

> Authored by Jatin (platform-devops). Proven synthesizable (cdk synth + cdk test both GREEN — see journal entry 2026-05-29T23:30:00Z).
> NO live action has been performed. This file is a one-command-per-step console runbook.
> Execute top-to-bottom in the dependency order shown. Steps marked (FOUNDER ONLY) require credentials or legal authority that only the Founder holds.

---

## DEPENDENCY ORDER OVERVIEW

```
P1 (Shopify rotate)   ─► P2a (AWS account bootstrap)
                              ├─► P2b (CDK deploy CredentialCustodyStack)
                              │         └─► P2c (put live secrets into SM)
                              │                   └─► P2d (CoreServiceTaskDef deploy + task-role attach)
                              └─► P3 (DPDP sign + calendar pick)
                                       └─► P4a (staging clone provision)
                                                └─► P4b (RLS staging rehearsal)
                                                        └─► P4c (RLS FORCE ceremony — OPEN P0)
P5 (connector_identity_map DDL + seed)  ─► P6 (gRPC server + public ingress)
                                                └─► P7 (webhook registration + smoke)
P8 (Google OAuth redirect-URI registration)
```

---

## P1 — Rotate compromised Shopify app secret (FOUNDER ONLY)  [URGENT — before any other step]

**Safety gate:** None — this step protects against current credential exposure. Do before any code deployment.

**Precondition:** The live `SHOPIFY_CLIENT_SECRET` (`apps/api-gateway/.env:27`) was exposed in tooling. Treat as compromised.

### P1.1 — Rotate in Shopify Partner dashboard

```
ACTION (browser):
  Shopify Partner dashboard
    → Apps → [your app] → API credentials
    → "Rotate client secret"
  Copy the new shpss_… value. Store ONLY in your password manager or encrypted note.
  DO NOT paste into any chat, file, or terminal log.
```

**Expected output:** Shopify shows a new shpss_… value. The old value is immediately invalidated.

### P1.2 — Update local .env (do not commit)

```bash
# Edit locally — do NOT commit .env
vim apps/api-gateway/.env
# Line 27: SHOPIFY_CLIENT_SECRET=<new_shpss_value_from_P1.1>
```

**Expected output:** Local dev server picks up the new value. Git diff shows no .env in staged files.

---

## P2 — AWS account + KMS CMK + Secrets Manager + IAM (FOUNDER ONLY for AWS creds)

**Precondition:** AWS IAM principal with AdministratorAccess (or scoped CDK-bootstrap + SecretsManager + KMS + IAM create/attach permissions) for the ap-south-1 account. This principal is NEVER stored in the repo or in CI.

**Constraint (CF-CC-RESIDENCY-1):** All resources MUST land in ap-south-1. The CDK stacks enforce this at synth time (residency guard in both stack constructors).

### P2.1 — Set AWS credentials

```bash
export AWS_PROFILE=<brain-ap-south-1>    # the IAM principal for the Brain AWS account
export AWS_REGION=ap-south-1
# Verify (must return your account ID — not InvalidClientTokenId):
aws sts get-caller-identity
```

**Expected output:** JSON with `Account`, `UserId`, `Arn` for the Brain AWS account. No error.

### P2.2 — CDK bootstrap (first time only — skip if already bootstrapped)

```bash
cd /Users/rishabhporwal/Desktop/Brain/infra/cdk
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap aws://${ACCOUNT_ID}/ap-south-1
```

**Expected output:** `Environment aws://<ACCOUNT_ID>/ap-south-1 bootstrapped.` Creates the CDKToolkit stack in ap-south-1.

### P2.3 — Synth verification (offline — no creds needed, run this first to confirm)

```bash
cd /Users/rishabhporwal/Desktop/Brain/infra/cdk
npx cdk list    # Expected: CredentialCustodyStack\nCoreServiceTaskDefStack
npx cdk synth   # Expected: "Successfully synthesized to .../cdk.out" — ZERO errors
npm test        # Expected: Test Suites: 2 passed, Tests: 49 passed, 0 failed
```

**Expected output (captured 2026-05-29):**
- `cdk list`: `CredentialCustodyStack` and `CoreServiceTaskDefStack`
- `cdk synth`: `Successfully synthesized to .../cdk.out` with zero errors
- `npm test`: 49/49 passed, 2 suites

### P2.4 — Deploy CredentialCustodyStack (DDR sign-off required before this step)

```bash
cd /Users/rishabhporwal/Desktop/Brain/infra/cdk
npx cdk deploy CredentialCustodyStack --require-approval broadening
```

**Expected output:**
- CloudFormation creates: 1 KMS CMK (`alias/brain/credential-custody`, rotation enabled, RETAIN)
- 2 Secrets Manager secrets (`brain/custody-posture`, `brain/_app/shopify/hmac_secret`), both CMK-encrypted, RETAIN
- 1 IAM ManagedPolicy `brain-ingestion-credential-custody` (scoped to `arn:aws:secretsmanager:ap-south-1:*:secret:brain/*` + CMK ARN)
- 3 CloudFormation outputs: `CredentialCmkArn`, `CustodyPolicyArn`, `AppShopifyHmacSecretArn`
- Stack status: `CREATE_COMPLETE`

**Safety gate:** Review the IAM policy broadening prompt. Confirm it matches the expected 6 SM actions + 2 KMS actions on scoped resources — no wildcard `*` resources.

### P2.5 — Put live secrets into Secrets Manager (FOUNDER ONLY — requires rotated value from P1.1)

```bash
# App-level Shopify HMAC secret (the shpss_… rotated in P1.1):
aws secretsmanager put-secret-value \
  --region ap-south-1 \
  --secret-id brain/_app/shopify/hmac_secret \
  --secret-string '{"value":"<NEW_SHOPIFY_CLIENT_SECRET_FROM_P1.1>"}'

# Per-workspace connector credential (Sugandh Lok; run once per connector):
# workspace_id = the Sugandh Lok workspace UUID from brain_dev
aws secretsmanager put-secret-value \
  --region ap-south-1 \
  --secret-id brain/<SUGANDH_LOK_WORKSPACE_ID>/shopify/credential \
  --secret-string '{"value":"<SHOPIFY_ACCESS_TOKEN_FOR_SUGANDH_LOK>"}'
```

**Expected output:** `VersionId` returned for each put. No error.

**Verification:**
```bash
aws secretsmanager describe-secret \
  --region ap-south-1 \
  --secret-id brain/_app/shopify/hmac_secret \
  --query 'KmsKeyId'
# Must return the CMK ARN from P2.4 — not "aws/secretsmanager"
```

### P2.6 — Flip ingestion-service backing flag

```bash
# In the ingestion-service Fargate task definition environment (or .env for local staging):
CONNECTOR_CUSTODY_BACKING=aws-secrets-manager
```

**Precondition:** botocore and urllib3 must NOT be at DEBUG log level. Verify:
```bash
# In ingestion-service runtime — no botocore DEBUG line in logs
grep -r "logging.basicConfig.*DEBUG\|boto.*DEBUG\|urllib3.*DEBUG" \
  apps/ingestion-service/src/ apps/ingestion-service/pyproject.toml
# Expected: ZERO hits (CF-TS-NEVERLOG-1)
```

### P2.7 — Attach IAM policy to ingestion-service task role

```bash
# Get the policy ARN from the stack output:
CUSTODY_POLICY_ARN=$(aws cloudformation describe-stacks \
  --region ap-south-1 \
  --stack-name CredentialCustodyStack \
  --query "Stacks[0].Outputs[?OutputKey=='CustodyPolicyArn'].OutputValue" \
  --output text)

# Get the ingestion-service task role ARN (from Fargate task definition):
TASK_ROLE_ARN=<ingestion-service-task-role-arn>

aws iam attach-role-policy \
  --role-name <ingestion-service-task-role-name> \
  --policy-arn "${CUSTODY_POLICY_ARN}"
```

**Expected output:** No error. Role now has `brain-ingestion-credential-custody` attached.

**Verification:**
```bash
aws iam list-attached-role-policies \
  --role-name <ingestion-service-task-role-name> \
  --query 'AttachedPolicies[].PolicyName'
# Must include "brain-ingestion-credential-custody"
```

### P2.8 — Deploy CoreServiceTaskDefStack

```bash
cd /Users/rishabhporwal/Desktop/Brain/infra/cdk
npx cdk deploy CoreServiceTaskDefStack --require-approval broadening
```

**Expected output:**
- CloudFormation creates: 1 IAM Role (`CoreServiceTaskExecutionRole`, assumes `ecs-tasks.amazonaws.com`)
- 1 Fargate TaskDefinition with `secrets:` entry `SHOPIFY_CLIENT_SECRET` → `brain/_app/shopify/hmac_secret`
- Stack status: `CREATE_COMPLETE`
- Output: `CoreServiceTaskDefArn`

**Precondition:** CredentialCustodyStack must be `CREATE_COMPLETE` (P2.4). The `CoreServiceTaskDefStack` imports the secret ARN via `Fn::ImportValue("brain-app-shopify-hmac-secret-arn")`.

**Safety gate (CF-TS-NEVERLOG-1):** Confirm the CloudFormation template has ZERO occurrences of `shpss_` or any secret literal value:
```bash
grep -r "shpss_" infra/cdk/cdk.out/CoreServiceTaskDefStack.template.json
# Expected: ZERO hits
```

---

## P3 — DPDP §7 sign + festival window selection (FOUNDER ONLY — legal + calendar)

**Precondition:** P2.4 complete (custody stack deployed). Required before P4c (RLS FORCE flip).

### P3.1 — Sign the DPDP §7 addendum

```
ACTION (document review):
  Read:  .engineering-os/runs/2026-05-24T07-23-52Z__654a53__feat-tenancy-auth-rls-hardening__rishabhporwal/06b-dpdp-section7-addendum-draft.md
  Sign the Founder attestation line at the bottom (Acts A–D; §8(2)+§7 lawful basis;
  Founder-as-controller-of-Sugandh-Lok).
  This is a legal signature — only the Founder can execute.
```

**Expected output:** Signed addendum. File updated with signature + date.

### P3.2 — Ratify the RLS bypass granted_until date

```
DECISION (Founder confirms):
  RECOMMENDED: cutover-date + 30 days (bounded, DPDP-defensible bypass lifetime
  while legacy parity stabilizes; tighten if legacy can retire sooner).
  Record this date in the runbook environment: BYPASS_GRANTED_UNTIL=<YYYY-MM-DD>
```

### P3.3 — Pick festival-safe execution window

```
DECISION (Founder confirms):
  RECOMMENDED: low-traffic weekday (Tue–Thu) early-morning IST in mid-June 2026.
  Avoids: Diwali (Oct–Nov), Republic-Day sale (late Jan), EOSS (≈Jan–Feb / Jun–Jul end),
          month-end COD settlement peaks.
  Record: RLS_CUTOVER_DATE=<YYYY-MM-DD> RLS_CUTOVER_TIME=<HH:MM IST>
```

---

## P4 — RLS live cutover (closes the OPEN P0: live Supabase zero-RLS)

**Precondition:** P3 complete. Staging rehearsal (P4a+P4b) must show GREEN before P4c.
**File:** `apps/core-service/migrations/manual/rls/rollout-runbook.sh`

### P4.1 — Provision staging clone (FOUNDER ONLY — Supabase dashboard + data)

```
ACTION (browser — Supabase dashboard):
  Option A: pg_dump the live Brain Supabase DB → restore into a new ap-south-1 Supabase project.
            Set STAGING_DIRECT_URL to the new project's :5432 direct URL.
  Option B: Use Supabase branch feature (if available for your plan).
  OR:
  Option B (synthetic): Place a synthetic-only attestation at
    .engineering-os/runs/feat-tenancy-rls-live-cutover/staging-rehearsal/synthetic-only-attestation.txt
    and use a synthetic DB that matches the schema.
```

### P4.2 — Run staging rehearsal (STEP 0–4 only — not FORCE)

```bash
# Set required env vars (from runbook header):
export DATABASE_URL=<pgbouncer :6543 pooled URL>
export DIRECT_URL=<Postgres :5432 direct URL>
export STAGING_DIRECT_URL=<staging clone :5432 URL>
export ALPHA_WORKSPACE_ID=<test workspace UUID>
export BETA_WORKSPACE_ID=<second test workspace UUID>
export STAGING_RUN_FOLDER=<path to capture folder>
export RLS_APP_PASSWORD=<sourced from Secrets Manager>
export LEGACY_ROLNAME=<postgres.<tenant-id>>
export LEGACY_BASE_URL=<e.g. https://app.sugandhlok.com>
export LIVE_SUGANDH_LOK_SESSION=<valid session cookie>

# Run STEPS 0–4 against STAGING_DIRECT_URL (NOT prod):
bash apps/core-service/migrations/manual/rls/rollout-runbook.sh --staging-only
```

**Expected output:** 11 capture outputs in `STAGING_RUN_FOLDER`. CF-SEC-1 probe GREEN. STEP 4 ends with `RLS PROBE PASS`.

### P4.3 — RLS FORCE ceremony (OPEN P0 closure — FOUNDER PRESENT, per-PoNR auth required)

```
PRECONDITIONS — ALL must be GREEN before proceeding:
  [ ] P3.1: DPDP §7 addendum signed
  [ ] P3.3: Festival window: confirmed low-traffic Tue–Thu early-morning IST
  [ ] P4.2: Staging rehearsal GREEN (11 captures, probe PASS)
  [ ] Child-3 residual-writer conversion: ALL bare-write sites converted (grep = 0 hits)
  [ ] Corrected bare-write grep against full src/ returns ZERO hits
  [ ] RLS probe re-run H+2/H+24/H+48 plan armed

ROLLBACK TREE (arm before FORCE — per CF-CUT-ROLLBACK-ATOMIC-1 CORRECT ORDER):
  R1: psql "$DIRECT_URL" --file apps/core-service/migrations/manual/rls/down.sql
  R2: psql "$DIRECT_URL" --file apps/core-service/migrations/manual/rls/down-bypass-audit.sql
  R3: psql "$DIRECT_URL" -c "ALTER ROLE \"$LEGACY_ROLNAME\" NOBYPASSRLS"
  R4: Brain Decision-Log "rls.rollback" INSERT
  (WRONG order — DO NOT execute X1 ALTER ROLE before X2 down.sql — causes 0-row outage window)
```

```bash
# FORCE flip — ONLY after ALL preconditions GREEN, Founder present:
bash apps/core-service/migrations/manual/rls/rollout-runbook.sh --force
```

**Expected output:** STEP 5 complete. RLS FORCE probe GREEN. All 43 tables enforced. Bypass-audit log populated. Decision-Log "rls.force" entry written.

**48h monitor:** Arm post-FORCE:
- API p95 < 500ms on tRPC reads (CloudWatch)
- Cron success rate remains 100%
- RLS probe re-runs at H+2, H+24, H+48 — all GREEN

---

## P5 — connector_identity_map DDL + seed (webhook intake prerequisite)

**Precondition:** P2.4 complete (custody stack deployed, DB connection available).
**File:** `apps/ingestion-service/migrations/manual/shop-map/step-a-create.sql`

### P5.1 — Apply DDL (HOLD-AT-CUTOVER — apply at Stage-8 ceremony)

```bash
# Run against the live Brain Postgres (ap-south-1, :5432 direct URL):
psql "${DIRECT_URL}" \
  --file apps/ingestion-service/migrations/manual/shop-map/step-a-create.sql
```

**Expected output:** `CREATE TABLE` / `COMMENT` — no error. Table `connector_identity_map` with composite PK `(vendor, external_identity)` exists.

**Verification:**
```bash
psql "${DIRECT_URL}" -c "\d connector_identity_map"
# Must show: vendor TEXT NOT NULL, external_identity TEXT NOT NULL, workspace_id UUID NOT NULL,
#            created_at TIMESTAMPTZ, PRIMARY KEY (vendor, external_identity)
```

**Reversibility:** `apps/ingestion-service/migrations/manual/shop-map/down.sql`

### P5.2 — Seed Sugandh-Lok identity row (FOUNDER ONLY — requires real shop domain + workspace UUID)

```bash
# Sugandh Lok workspace UUID from brain_dev:
SUGANDH_LOK_WS=<sugandhlok-workspace-uuid>

psql "${DIRECT_URL}" -c "
INSERT INTO connector_identity_map (vendor, external_identity, workspace_id)
VALUES ('shopify', 'sugandhlok.myshopify.com', '${SUGANDH_LOK_WS}')
ON CONFLICT (vendor, external_identity) DO NOTHING;
"
```

**Expected output:** `INSERT 0 1` (or `INSERT 0 0` if already seeded — idempotent).

**Verification:**
```bash
psql "${DIRECT_URL}" -c "
SELECT vendor, external_identity, workspace_id
FROM connector_identity_map
WHERE vendor = 'shopify' AND external_identity = 'sugandhlok.myshopify.com';
"
# Must return exactly 1 row with the correct workspace_id
```

---

## P6 — grpcio floor fix + gRPC server bind + public ingress (before webhook registration)

**Precondition:** P5 complete. CDK / CI pipeline must pass grpcio>=1.70.0 (Shreya MED-1).

### P6.1 — Raise grpcio floor in pyproject.toml (Shreya MED-1 — BEFORE Stage-8 deploy)

**Current value (DRIFT FOUND):** `grpcio>=1.68.0,<2.0.0` — admits a known-DoS pre-1.70 version.

```bash
# Edit pyproject.toml:
vim apps/ingestion-service/pyproject.toml
# Change:
#   "grpcio>=1.68.0,<2.0.0",
#   "grpcio-health-checking>=1.68.0,<2.0.0",
# To:
#   "grpcio>=1.70.0,<2.0.0",
#   "grpcio-health-checking>=1.70.0,<2.0.0",
```

Then update lockfile and verify:
```bash
cd apps/ingestion-service
uv lock
uv run --no-sync pytest tests/unit/ -q
# Expected: 329 passed, 14 skipped (or equivalent after any rebase)
```

### P6.2 — Delete orphaned shop_resolver.py (Shreya MED-2 — BEFORE Stage-8 deploy)

```bash
# This file was superseded by identity_resolver.py but left on disk:
rm apps/ingestion-service/src/interfaces/grpc/shop_resolver.py
git diff --stat  # Confirm deletion is staged
uv run --no-sync pytest tests/unit/ -q  # Still 329 passed
```

### P6.3 — Register gateway route in server.ts (HOLD-AT-CUTOVER — the live server registration)

```
FILE: apps/api-gateway/src/interfaces/route.webhook.ts
STATUS: EXPORTED but NOT registered in server.ts (NO-LIVE-1 hold).

ACTION: In server.ts, register the webhook plugin:
  import webhookPlugin from './interfaces/route.webhook';
  app.register(webhookPlugin, { prefix: '' });

This makes POST /webhooks/:vendor publicly reachable.
```

**Verification after registration:**
```bash
# Health check (the webhook route should be live):
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/webhooks/shopify \
  -H "X-Shopify-Hmac-Sha256: invalid" \
  -H "Content-Type: application/json" \
  -d '{"test":true}'
# Expected: 200 (Outcome REJECTED — correct; invalid HMAC path)
```

### P6.4 — Start gRPC server in ingestion-service (HOLD-AT-CUTOVER — the live server bind)

```
FILE: apps/ingestion-service/src/interfaces/grpc/webhook_server.py
STATUS: AUTHORED, NOT STARTED. Server binds to 127.0.0.1:<GRPC_PORT> (INTERNAL-only).

ACTION: Add webhook_server startup to the ingestion-service entrypoint.
  In the main process or a thread: await start_webhook_server(identity_resolver, port=<GRPC_PORT>)
```

**Verification (internal connectivity only — not public):**
```bash
# From within the same host/pod, confirm gRPC port is listening:
ss -tlnp | grep <GRPC_PORT>
# Expected: LISTEN on 127.0.0.1:<GRPC_PORT>
```

### P6.5 — Configure WAF + TLS for /webhooks/:vendor (FOUNDER + Architect decision)

```
ACTION (AWS Console — WAF):
  Attach AWS WAF WebACL to the ALB in ap-south-1.
  Rules for /webhooks/:vendor:
    - Rate limit: 1000 req/5min per source IP (supplements TokenBucket in gateway code)
    - Block requests > 1MB body (supplements gateway body-size cap)
    - Block known bad actors (AWS Managed Rules: CommonRuleSet + KnownBadInputsRuleSet)

ACTION (Route 53 + ACM):
  Ensure the ALB listener has a TLS certificate (ACM) for the brain API domain.
  /webhooks/:vendor must be HTTPS-only (no HTTP cleartext inbound).
```

**Verification:**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://<brain-api-domain>/webhooks/shopify \
  -X POST \
  -H "X-Shopify-Hmac-Sha256: invalid" \
  -H "Content-Type: application/json" \
  -d '{"test":true}'
# Expected: 200 (REJECTED outcome — HMAC invalid, but route is reachable over TLS)
```

---

## P7 — Webhook registration + real vendor smoke (FOUNDER ONLY — Shopify dashboard)

**Precondition:** P5 (connector_identity_map seeded) + P6 (gRPC server + public ingress live).

### P7.1 — Register Shopify webhook subscription

```
ACTION (Shopify Partner dashboard OR Shopify Admin API):
  POST https://{shop}.myshopify.com/admin/api/2024-01/webhooks.json
  Headers: X-Shopify-Access-Token: <SHOPIFY_ACCESS_TOKEN>
  Body: {
    "webhook": {
      "topic": "orders/create",
      "address": "https://<brain-api-domain>/webhooks/shopify",
      "format": "json"
    }
  }
```

**Expected output:** `{"webhook": {"id": ..., "address": "https://<brain-api-domain>/webhooks/shopify", ...}}`

### P7.2 — Trigger test event and verify round-trip

```
ACTION (Shopify Admin → Webhooks → Send test notification):
  Send a test "orders/create" event to the registered URL.
```

**Expected output:**
- Shopify reports: delivery successful (HTTP 200 from the gateway)
- Gateway logs: `webhook.received vendor=shopify outcome=ACCEPTED` (no HMAC value in log)
- ingestion-service logs: `webhook.intake.completed vendor=shopify` with `request_id` matching gateway log
- `raw_shopify_orders` (or equivalent) has a new row for the test event — with workspace_id = Sugandh Lok UUID
- Kafka topic `integrations.shopify.v1` has the event (check via consumer CLI)

**Trace pipeline verification (post-deploy requirement):**
```bash
# Confirm request_id appears in ALL log surfaces:
# 1. Gateway log line: webhook.received request_id=<uuid>
# 2. ingestion-service log line: webhook.intake.completed request_id=<uuid>
# 3. X-Ray trace: same trace_id spans both services
# Search in CloudWatch Logs Insights:
# fields @timestamp, @message | filter @message like /<uuid>/ | sort @timestamp asc
```

---

## P8 — Real-auth: Google OAuth redirect-URI registration (FOUNDER ONLY — external dashboards)

**Precondition:** Real-auth slices A+C+E are merged. Slice D (onboarding+DB) needs local-vs-live-DB decision first (separate Founder item).

### P8.1 — Supabase Auth dashboard

```
ACTION (Supabase dashboard → Authentication → URL Configuration):
  Add Site URL: https://brain.pipadacapital.com
  Add Redirect URLs:
    https://brain.pipadacapital.com/auth/callback
    https://brain.pipadacapital.com/auth/v1/callback
    (add staging equivalent if P4.1 staging clone is in use)
```

### P8.2 — Google Cloud Console

```
ACTION (console.cloud.google.com → APIs & Services → Credentials → OAuth client):
  Under "Authorized redirect URIs", add:
    https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
    https://brain.pipadacapital.com/auth/callback
```

**Verification:**
```bash
# E2E sign-in with Google via the live Brain app:
# Navigate to brain.pipadacapital.com → Sign in with Google
# Expected: redirect to Google → consent → redirect back to brain.pipadacapital.com with session
```

---

## LEGACY DECOMMISSION — Shiprocket-last DELETE PoNR

**Precondition:** ALL of P1–P7 complete + parity-GREEN (Brain-native paths cover all legacy features) + vendor-200-over-prod-path confirmed + festival-safe window.

**This is a point-of-no-return (PoNR). Per-PoNR Founder auth required at each step.**

### DECOM.1 — Pre-decommission parity gate (per-PoNR Founder auth)

```
CHECKLIST (all must be GREEN):
  [ ] Brain-native Shopify pull-fetch produces metric parity with legacy (orders, GMV, COGS)
  [ ] Brain-native webhook intake delivers events (P7 smoke GREEN)
  [ ] All 7 legacy migration children: Stage 8 complete and live (including Child 3 residual-writer conversion)
  [ ] RLS FORCE flip complete (P4c GREEN)
  [ ] Staging rehearsal parity check: recomputed canonical metrics match legacy within tolerance
  [ ] Shiprocket connector: last active connector to decommission (must be last per runbook ordering)
```

### DECOM.2 — Delete legacy Shopify webhook registrations

```bash
# For each registered webhook on the legacy URL:
DELETE https://{shop}.myshopify.com/admin/api/2024-01/webhooks/{webhook_id}.json
Headers: X-Shopify-Access-Token: <token>
# Expected: 200 OK, empty body
```

### DECOM.3 — Drain legacy traffic and shut down legacy Express server

```
ACTION:
  1. Update DNS / load balancer to stop routing to legacy app.
  2. Verify zero in-flight requests on legacy (CloudWatch / legacy log drain).
  3. Stop the legacy Heroku / EC2 instance.
  4. Record: legacy.decommissioned_at = <ISO timestamp>
```

### DECOM.4 — Delete legacy Shiprocket connector (Shiprocket last — per design)

```bash
# Remove Shiprocket API key from the legacy credential store.
# This is the final legacy connector decommission.
# Verify Brain-native Shiprocket connector is live and producing metric parity first.
```

---

## POST-CUTOVER MONITORING (48h armed after every P4c / P6 / P7)

```bash
# CloudWatch composite alarm — auto-rollback trigger:
# p95 > 2s for 5 consecutive minutes → SNS → ArgoCD rollback
# error rate > 1% for 5 consecutive minutes → SNS → ArgoCD rollback
# health probe failing 2 consecutive checks → SNS → ArgoCD rollback

# Manual spot-checks at H+2, H+24, H+48:
# 1. RLS probe re-run (P4c post-FORCE)
# 2. Webhook intake round-trip (P7 smoke)
# 3. Custody get() smoke: ingestion-service reads brain/_app/shopify/hmac_secret
# 4. Metric parity: daily_metrics for Sugandh Lok = legacy within 1%
# 5. Decision-Log write availability: assert no write failures in last 48h
```

---

## BOTOCORE/URLLIB3 DEBUG — NEVERLOG PRECONDITION (must be OFF before any secret is live)

```bash
# Confirm botocore + urllib3 are NOT at DEBUG in the ingestion-service runtime:
grep -r "logging.basicConfig.*DEBUG\|botocore.*DEBUG\|urllib3.*DEBUG" \
  apps/ingestion-service/src/ || echo "CLEAN — no DEBUG logging"
# Expected: CLEAN

# Also confirm in the running container (post-deploy):
# CloudWatch Logs → ingestion-service → search for "botocore"
# Expected: ZERO log lines containing botocore DEBUG output or secret values
```

---

## REVERSIBILITY RECIPE (for 13-deployment-report.md reference)

| Step | Rollback command |
|------|-----------------|
| P2.4 CredentialCustodyStack | `npx cdk destroy CredentialCustodyStack` — NOTE: RETAIN policy means CMK + secrets are NOT deleted; schedule deletion manually via console with 30-day window |
| P2.8 CoreServiceTaskDefStack | `npx cdk destroy CoreServiceTaskDefStack` |
| P4c RLS FORCE | R1-R4 in EXACT order per CF-CUT-ROLLBACK-ATOMIC-1 (see P4.3 ROLLBACK TREE above) |
| P5 connector_identity_map | `psql "$DIRECT_URL" --file apps/ingestion-service/migrations/manual/shop-map/down.sql` |
| P6.3 gateway route registration | Remove `app.register(webhookPlugin)` from server.ts; redeploy gateway image |
| P7 webhook registration | DELETE /admin/api/.../webhooks/{id}.json (Shopify API) |
| DECOM.3 legacy shutdown | Restart Heroku dynos / EC2; restore DNS routing — PoNR: IRREVERSIBLE once DNS TTL expires + Shopify webhooks fully migrated |

---

## OPEN ITEMS (must be resolved before executing the corresponding step)

| Item | Step gated | Owner | Description |
|------|-----------|-------|-------------|
| grpcio floor >=1.70.0 | P6.1 | Shreya MED-1 | Raise from 1.68.0 → 1.70.0 in pyproject.toml + lockfile before deploy |
| shop_resolver.py deletion | P6.2 | Maya / Jatin | Orphaned dead file; no longer imported by servicer |
| Child-3 residual-writer conversion | P4c | Builder | ALL bare-write sites in legacy src/ must be converted; grep = 0 hits |
| DPDP §7 addendum signature | P3.1 | Founder (legal) | Cannot be delegated |
| Local-vs-live-DB decision for real-auth slice D | P8 | Founder | Supabase dashboard action required first |
| Staging clone provision | P4.1 | Founder (Supabase) | Either pg_dump/restore or Supabase branch |
| Festival-safe cutover date ratification | P3.3 | Founder | Calendar decision; must be documented before P4c |

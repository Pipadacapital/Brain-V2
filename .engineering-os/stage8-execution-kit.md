# Stage-8 Founder Execution Kit — 2026-05-29

> Turnkey runbook for the 5 console/credential/decision items that only the Founder can
> execute. Each is reduced to copy-paste steps with defaults pre-chosen. Authored by
> claude-code; nothing here has been executed (no AWS, no Shopify, no live DB touched).
> Recommended decisions are marked **[RECOMMENDED — Founder confirms]**; override freely.

Order matters: **P1 (rotate) → P2 (AWS provision) → P3 (staging clone) → P4 (RLS ceremony) →
P5 (real-auth)**. P2 must precede the custody Stage-8 legs; P3 must precede the RLS rehearsal.

---

## P1 — Rotate the compromised Shopify app secret  🔴 URGENT

The live `SHOPIFY_CLIENT_SECRET` (`apps/api-gateway/.env:27`) was exposed in tooling this
session + nearly committed (GitHub push-protection blocked it). Treat as compromised.

1. Shopify Partner dashboard → your app → **API credentials** → **Rotate client secret**.
2. Update `apps/api-gateway/.env:27` `SHOPIFY_CLIENT_SECRET=<new value>` locally (do NOT commit `.env`).
3. The new value gets stored in Secrets Manager at P2 step 4 (`brain/_app/shopify/hmac_secret`).
4. Any prod api-gateway env/secret store holding the old value must be updated too.

*Why only you:* Shopify dashboard auth. No code change.

---

## P2 — Provision AWS Secrets Manager + deploy the custody stack

The CDK is authored + assertion-tested (`infra/cdk/lib/credential-custody-stack.ts`); it has
NOT been deployed. With AWS creds for the **ap-south-1** account:

```bash
cd infra/cdk
npm ci
npx cdk synth                     # sanity (no creds needed)
export AWS_PROFILE=<brain-ap-south-1>      # ap-south-1 IAM principal
npx cdk bootstrap aws://<ACCOUNT_ID>/ap-south-1   # first time only
npx cdk deploy CredentialCustodyStack --require-approval broadening
```
This creates: the KMS CMK (ap-south-1, rotation on), the per-workspace secret namespace
`brain/*`, the app singleton `brain/_app/shopify/hmac_secret`, and the least-priv IAM managed
policy. Then:

4. **Put the secrets** (per-connector tokens + the rotated Shopify HMAC value):
```bash
aws secretsmanager put-secret-value --region ap-south-1 \
  --secret-id brain/_app/shopify/hmac_secret \
  --secret-string '{"value":"<NEW_SHOPIFY_CLIENT_SECRET_FROM_P1>"}'
# per-connector (Sugandh Lok): brain/<workspace_id>/<vendor>/credential, value {"value": "..."}
```
5. **Flip the runtime flag** so ingestion-service uses the real backing (default stays held):
```
CONNECTOR_CUSTODY_BACKING=aws-secrets-manager   # ingestion-service env
```
6. **Attach the IAM policy** to the ingestion-service task/pod role.
7. Ensure **botocore/urllib3 are NOT at DEBUG** in the live ingestion-service (NEVERLOG precondition).

*Why only you:* real AWS account, creds, cost (~$0.40/secret/mo + ~$1/mo CMK). The code path
is built + tested against moto.

---

## P3 — Provision the ap-south-1 staging clone (unblocks the RLS rehearsal)

The RLS Stage-8 rehearsal (the 11 deferred captures + Rohan's `stage6-remutate/`) needs a
live-like clone. Two acceptable shapes (CF-CUT-RESIDENCY-1):

- **(a)** A Supabase project clone in **ap-south-1** (`pg_dump`/restore of the live DB into a
  fresh ap-south-1 project, or Supabase branch). Set `STAGING_DIRECT_URL` to it.
- **(b)** A synthetic-only DB with the generator artifact placed at
  `…/feat-tenancy-rls-live-cutover/staging-rehearsal/synthetic-only-attestation.txt`.

Then run the rehearsal leg of `apps/core-service/migrations/manual/rls/rollout-runbook.sh`
against `STAGING_DIRECT_URL` and capture the 11 outputs + the 3 re-mutations.

*Why only you:* provisioning + real PROD-shaped data. Runbook + capture targets already exist.

---

## P4 — RLS live FORCE-flip ceremony (closes the OPEN P0)

Pre-flip gates P1–P8 are in `…/feat-tenancy-rls-live-cutover/15-stage8-ceremony-prep.md`.
The three decisions you owe, with recommendations:

- **§7 DPDP addendum signature** — review + sign `…/06b-dpdp-section7-addendum-draft.md`
  (Acts A–D, §8(2)+§7 basis, Founder-as-controller-of-Sugandh-Lok). *Only you* — a legal
  attestation; I will not forge it. It is otherwise complete and ready for your signature line.
- **Path-B (legacy-retirement) completion date** → `granted_until` for the bypass.
  **[RECOMMENDED — Founder confirms]: cutover-date + 30 days** (gives a bounded, DPDP-defensible
  bypass lifetime while parity stabilizes; tighten if legacy can retire sooner).
- **Festival-safe window** (CF-CUT-CALENDAR-1). **[RECOMMENDED — Founder confirms]: a low-traffic
  weekday (Tue–Thu) early-morning IST in mid-June 2026** — clears Diwali (Oct–Nov), Republic-Day
  sale (late Jan), and EOSS (≈Jan–Feb / Jun–Jul end). Avoid month-end COD settlement peaks.

Then execute `rollout-runbook.sh` at the console, Founder-present, with the rollback tree armed.

*Why only you:* live PROD DDL + a legal signature + Founder-only scheduling.

---

## P5 — Real-auth slice-D: provider-dashboard redirect-URI registration

Register the production OAuth redirect URIs so slice-D's live e2e passes:
- **Supabase** Auth → URL config → add the prod redirect URL(s).
- **Google Cloud** console → OAuth client → Authorized redirect URIs → add the prod callback.

*Why only you:* external provider dashboards. Code (slices A/C/E) is merged.

---

## Status legend
- **Code/IaC:** all built, reviewed, merged to `development`.
- **Held:** every live keystroke above. Nothing in this kit has been run.
- After P1–P5, the OPEN P0 closes (P4) and the connector/legacy-decommission cutovers unblock
  (P2 satisfies the real-`seal()` leg of CF-C7; the per-connector DELETE PoNR still needs the
  vendor-200-over-prod-path + parity-GREEN signs at the decommission ceremony, Shiprocket last).

# Persona Review — `india-connector-pii-secrets-compliance-officer`

> **Persona type:** India compliance / PII / secrets-custody  
> **Spawned by:** Rohan (CTO Advisor), Stage 1 of `feat-connector-framework-cutover` (Child 3)  
> **Requirement reviewed:** `01-requirement.md` + `02-cto-advisor-review.md` (same run folder)  
> **Binding architecture:** `06-architecture-plan.md` (Child-0 spike, A6 risk register, PII register)  
> **Primary skill loaded:** `data-privacy-dpdp` + `security-baseline`  
> **Lens:** DPDP Act 2023 + Rules 2025 obligations at the ingest boundary; secrets custody; residency; consent/purpose column modelling  
> **Timestamp:** 2026-05-24

---

## Persona framing

I am a compliance officer who has read the DPDP Act 2023 and watched the Rules 2025 take shape. I have also read the legacy connector code — not the architecture documents first. Here is what the code actually does: `shiprocket.ts:getValidToken()` reads `ShiprocketConnection.email` and `.password` off the Prisma row (schema:498-500) and POSTs them to Shiprocket's login endpoint to obtain a bearer token. `klaviyoConnection.apiKey` (schema:559) is stored plaintext in the same DB. `meta_ads_connections.access_token` (schema:763) and `google_ads_connections.refresh_token` (schema:699) are likewise plaintext DB columns selected in `integrations.ts:52–76`. This is the custody reality on the ground — no HSM, no KMS, no SSM, not even an encrypted column. The Supabase DB is the credential vault by default.

My job is to confirm or deny whether Child 3 can proceed with a lawful, architecturally defensible ingest path before a Brain Secrets Manager exists, and to flag every compliance obligation that activates the moment live brand-customer PII crosses into Brain.

I have a bias toward naming the exact statute/rules text, the exact schema line, and the exact failure mode. I will not say "this might be a concern." I will say what breaks, when, and under which provision.

---

## CONCERN 1 — CF-SEC-SECRETS-1: No custody mechanism exists; Supabase DB is the de-facto credential vault

**Severity: HIGH (build-gating; fires at synthesis unless a Founder decision ratifies an interim)**

**Evidence:**

Rohan verified: zero secrets-manager / vault / KMS primitive anywhere in `apps/`, `packages/`, `pylibs/` (his grep CLEAN). I verified independently: `apps/ingestion-service` is a bare DDD scaffold (`.gitkeep` only). The backlog document `chore-security-governance-hardening-phase.md` names WS-1 as "Migrate all integration credentials to AWS Secrets Manager (ap-south-1)" — explicitly NOT active.

The Child-0 architecture names the mitigation for R-CRED-01 as: "secret → Brain secrets manager, legacy plaintext deleted at that connector's cutover." This mitigation cannot execute because the destination does not exist.

What the framework 3a WILL do instead — by default, with no Secrets Manager — is read OAuth tokens and API keys from the Supabase `ShopifyConnection`, `KlaviyoConnection`, `ShiprocketConnection`, etc. rows at ingest time, exactly as the legacy `getValidToken()` does (`shiprocket.ts:68-88`). That means:

1. The Brain ingest-service will need a direct Postgres connection to the Supabase DB to read those rows — or a service that reads them and hands the credential to the ingestion-service. Either path leaves the plaintext credential in the DB column.
2. During the dual-run window before cutover, both legacy and Brain simultaneously hold a read path to the same plaintext credential rows. This is the R-CRED-01 "duplicated plaintext across two systems" window that the architecture warns against.
3. After the legacy-plaintext-delete-at-cutover (C8), if the Brain custody store is still "the same Postgres DB column," nothing was actually rotated — it was a no-op rename of which process reads the column.

**The DPDP angle:** DPDP Act 2023 §8(4) requires the Data Fiduciary (Brain/Pipada Capital) to implement "reasonable security safeguards" for personal data. While the plaintext credentials are not themselves personal data, they are the access keys to the vendor APIs that return customer PII (Shopify orders with `email`, WooCommerce `customerPhone`, Shiprocket `deliveryPincode`). Compromise of a Shopify `accessToken` or a Shiprocket `email/password` pair gives the attacker access to all historic customer orders for that workspace — a reportable breach under DPDP §8(6) + Rules 2025 Rule 7 (breach notification within 72 hours). The Rules 2025 explicitly require "technical safeguards commensurate with the sensitivity of personal data being protected" (Rules 2025, Rule 6(1)(a-e): encryption, access controls, access logging). Storing the credential that unlocks customer PII in a plaintext Postgres column with no encryption at rest is not commensurate.

**Proposed binding constraint (CF-C3-SECRETS-INTERIM-1):**

The Secrets Manager-as-final-destination does not need to exist for 3a's build-and-LOCAL-verify phase. But the Stage-8 HOLD-AT-CUTOVER ceremony CANNOT proceed until ONE of the following is true, as a precondition:

- **(Option A — Preferred):** WS-1 is activated before Stage-8 ceremony; AWS Secrets Manager (ap-south-1) is provisioned; tokens are rotated into it; the Brain ingest-service reads via IAM-scoped `GetSecretValue` (no plaintext in DB columns post-rotation).
- **(Option B — Interim-ratified by Founder):** The Founder ratifies in writing (in the run folder) that for the initial Sugandh Lok cutover, the legacy Supabase DB column IS the interim credential store, the ingestion-service reads it over the RLS-session-scoped Postgres connection, and WS-1 activates before any second workspace's credentials are stored this way. This is NOT compliant long-term but it is bounded — one workspace, Founder-owned, Founder-ratified. The constraint is that WS-1 MUST activate before the second workspace is onboarded. The "delete legacy plaintext at cutover" (C8) under Option B means the Supabase DB row's plaintext field is encrypted-at-rest (Supabase has AES-256 storage encryption by default at the disk level — this needs positive confirmation from the Supabase project settings for the ap-south-1 deployment). Column-level encryption of credential fields is the additional hardening.

**Why this does NOT kill the requirement:** 3a builds fine without live credentials — LOCAL-verified against stub connectors. The Founder decision (Option A or B) only gates the Stage-8 HOLD-AT-CUTOVER ceremony, which Rohan already named as deferred. But the decision MUST happen before the runbook is written (3b), because the runbook must name the custody mechanism. A runbook that says "rotate credential into Brain Secrets Manager" when Brain has no Secrets Manager is a fiction.

**Escalate?** YES — this is the same class as the Child-1 DPDP lawful-basis escalation (a missing instrument, not a derivable fact). Recommended Founder ask: "Do you activate WS-1 now (or alongside Child 3), or do you ratify Option B for Sugandh Lok only with the constraint that WS-1 activates before workspace 2?"

---

## CONCERN 2 — Delete-plaintext-at-cutover (C8) sequencing: irreversible data loss if custody is not proven first

**Severity: HIGH (procedural; the failure mode is permanent lockout of a live connector)**

**Evidence:**

The A6.3 ceremony states: "legacy plaintext credential deleted at that connector's cutover (not after)." The Shiprocket credential model is `email` + `password` — these are the user's account credentials to the Shiprocket portal, not an API key Shiprocket can regenerate at will. If:

1. The Brain ingest-service is NOT yet proven to hold a working credential copy (e.g., the cutover ceremony fails mid-step, or the Secrets Manager write succeeded but the IAM policy is wrong, so the service cannot read it back), AND
2. The legacy plaintext `password` row has been deleted, AND
3. Shiprocket has NO historical event replay (A1.3 table, architecture:201),

then the workspace is in a state where: no system holds a working credential, Brain cannot authenticate to Shiprocket, legacy cannot authenticate to Shiprocket, and there is no replay window. The Shiprocket connection is dead, and the only recovery path is the workspace admin re-entering their Shiprocket email/password. At a live brand's peak season, this is an incident.

For Shopify, Klaviyo, Meta, and Google the risk is lower because those credentials CAN be regenerated (OAuth re-auth) or replayed from the API. But for Shiprocket `email/password`, the credential is the user's account password — if the user changed it after the connection was made and hasn't synced it, the delete-and-re-enter path does not work either.

**Proposed binding constraint (CF-C3-DELETE-SEQUENCE-1):**

The delete-plaintext-at-cutover step (C8) MUST be the last step in the per-connector ceremony, executed ONLY after a positive custody proof:

```
Step 1: Write credential to Brain custody store (Secrets Manager / encrypted column).
Step 2: Brain ingest-service reads credential back from custody store and authenticates successfully to the vendor API (a live HTTP round-trip test, not just a "write succeeded").
Step 3: Count-based parity confirmed within rollback window N (M-A5-Q3).
ONLY THEN: Step 4: Delete legacy plaintext column value.
```

The runbook (3b) must encode this exact step ordering. Step 2 (live authentication test before delete) is the key addition the current architecture prose does not make explicit. The A4 rollback tree must branch BEFORE Step 4: if the live auth test fails, the rollback path is "abort ceremony, credential still in legacy, no action needed" — not "restore from backup."

For Shiprocket specifically: because re-authentication from `email/password` re-generates a fresh `accessToken` anyway (the `getValidToken()` logic in `shiprocket.ts:82`), the actual item that is life-critical to preserve is the `email` + `password` pair, not the `accessToken`. Encrypt these in the custody store; the `accessToken` is ephemeral.

---

## CONCERN 3 — CF-SEC-3 PII lawful-basis re-arm: Klaviyo ingests EMAIL PERFORMANCE metrics containing campaign-recipient data; the lawful basis is not brand-scoped to Sugandh Lok's own customers

**Severity: HIGH (DPDP §4 processing act re-arms the gate; not a carry-forward / future concern)**

**Evidence:**

The architecture's PII register (A6.2) lists three models: `ShopifyCustomer.email/firstName/lastName`, `WoocommerceOrder.customerEmail/customerPhone/billing*/shipping*`, `ShiprocketShipment.deliveryPincode/City/State`. All three are first-party data — Sugandh Lok's own brand customers transacting on Sugandh Lok's Shopify/WooCommerce store or receiving Sugandh Lok shipments. The Founder-as-legal-controller ratification (Child 1 lawful basis) covers this: Rishabh (controller for Sugandh Lok) processes his own customers' data.

Klaviyo is different. Examine `klaviyo-sync.ts` carefully. The sync fetches `EmailPerformance` records — campaign name, `delivered`, `uniqueOpens`, `uniqueClicks`, `placedOrderCount`, `unsubscribeCount`. These are aggregate campaign metrics, NOT individual subscriber PII. At the aggregate level, Klaviyo sync appears non-PII for the stored schema fields. However:

The Klaviyo API's underlying data model involves individual email recipient events (open, click, placed order) aggregated by Klaviyo before returning campaign stats. Brain receives only the aggregates — no individual email addresses, no subscriber identifiers flow into `EmailPerformance`. This means Klaviyo ingest, AS CURRENTLY SCOPED in `klaviyo-sync.ts`, does NOT bring individual-person PII into Brain's raw event store. The PII register's omission of a Klaviyo row is defensible for the current sync scope.

BUT: the `klaviyo-sync.ts` also fetches SMS flow data (`klaviyoFlowSeriesDaily(..., 'sms')`). SMS flow metrics can include `deliveredSms`, `openedSms` etc. — still aggregates, still no individual phone numbers in the output. Non-PII at the stored model level.

**The real re-arm concern is different and I will name it precisely:**

The framework (3a) is described as a "generic connector-ingest primitive." The concern is not that Klaviyo's current `syncKlaviyoForWorkspace` ingests individual PII — it doesn't. The concern is:

1. **The generic framework enables easy addition of a Klaviyo "profile sync" or "subscriber list sync" in a future iteration** — those DO contain `email`, `phone_number`, `firstName`, `lastName` per subscriber. The framework's generic shape (one primitive, adapter pattern) means the compliance gate around PII must sit at the adapter level, not assumed away at the framework level.
2. **Meta Ads and Google Ads ingestion.** The `meta_ads_daily_metrics` and `google_ads_daily_metrics` stored in the raw event store are workspace-level campaign performance aggregates — clicks, impressions, spend. These are PII-free. However, Meta's Conversions API and Google's enhanced conversions features can push hashed customer PII (SHA-256 email, phone) as match keys. If the Brain ingest primitive reads these extended event payloads, individual-customer hashed PII enters the raw archive. The architecture does NOT flag this surface; it assumes Meta and Google connectors are ad-performance-metrics-only.

**Proposed binding constraint (CF-C3-PII-ADAPTER-GATE-1):**

Each connector adapter in the framework MUST declare, at code level, a PII manifest: which fields in the raw event payload are personal data under DPDP §2(t), what lawful basis applies, and the purpose. This manifest is checked by the ingest primitive before writing to the raw event store. For the initial Sugandh Lok scope:

- Shopify adapter: `email, firstName, lastName` (ShopifyCustomer); `email` (ShopifyOrder) — lawful basis: Founder controller, Sugandh Lok brand-only.
- WooCommerce adapter: `customerEmail, customerPhone, billing*, shipping*` (WoocommerceOrder) — same lawful basis.
- Shiprocket adapter: `deliveryPincode, deliveryCity, deliveryState` (ShiprocketShipment) — same.
- Klaviyo adapter: no individual PII in current scope (aggregate campaign metrics only) — manifest explicitly declares "no individual PII."
- Meta Ads adapter: aggregate campaign metrics only — manifest explicitly declares "no individual PII"; Conversions API / hashed match keys are OUT OF SCOPE until separately gated.
- Google Ads adapter: aggregate campaign metrics only — same.

This manifest forces an explicit decision at each future adapter addition rather than letting PII scope creep silently through the generic framework. Rohan should bind this as a per-adapter artefact requirement in Stage 2.

---

## CONCERN 4 — CF-RES-1: ap-south-1 residency is not positively asserted at the ingest-service write path; it is trusted from the DB URL

**Severity: MEDIUM (architecture constraint not yet satisfied in the scaffold; must be binding in Stage 2 design)**

**Evidence:**

The Child-0 A2.0 residency tripwire confirms: `DATABASE_URL`/`DIRECT_URL` are in `backend/.env`, not committed. The Supabase project's ap-south-1 region is assumed but unconfirmed from the repo. The Child-1 rollout runbook (`apps/core-service/migrations/manual/rls/rollout-runbook.sh`) has a STEP 0 region-assert that checks the DB URL contains `ap-south-1` before proceeding.

The `ingestion-service` is a bare scaffold. When the Brain ingest-service writes to the raw event store, it will read its DB URL from an environment variable. There is NO code in `ingestion-service` yet that performs a region assertion. The risk is:

- A misconfigured deploy of the ingest-service that points at the wrong Supabase project or a non-ap-south-1 replica writes customer PII (Shopify `email`, Shiprocket pincode) to a non-India region. Under DPDP §16, transferring personal data of Indian residents outside India (to a country not on the Central Government's approved list) is a cross-border transfer requiring specific conditions. This is not a theoretical risk — it is the exact failure mode the architecture's A2.0 tripwire arms against.
- The architecture assumes `ap-south-1` is confirmed. It is not confirmed from the codebase. If R-RES-01 fires (region != ap-south-1), the ingestion of live Shopify/Shiprocket PII would itself be a DPDP §16 violation. The ingest-service is the first Brain runtime that writes live customer PII — this is the highest-consequence write path for residency purposes.

**Proposed binding constraint (CF-C3-RESIDENCY-ASSERT-1):**

The ingest-service's startup sequence MUST include a positive region assertion — identical to the Child-1 rollout runbook STEP 0 — that parses both `DATABASE_URL` and `DIRECT_URL`, confirms both contain `ap-south-1`, and REFUSES TO START if either fails. This is not a deploy-pipeline annotation; it is a runtime startup gate. The principle: the service that writes live PII must assert its own residency, not trust the operator to configure the URL correctly. The assertion failure must emit a named error (not a generic startup crash) and must be checked in the Stage-2 architecture design.

---

## CONCERN 5 — DPDP accountability: the raw event store has no consent/purpose/lawful-basis column; a retroactive backfill is irreversible-complex

**Severity: MEDIUM (not a ship-blocker for 3a LOCAL-verify; but failing to add it NOW makes the Stage-8 live ingest of PII non-compliant, and retroactive backfill is expensive)**

**Evidence:**

The A6.2 PII register (architecture:1053) states: "consent/purpose column added (Brain models DPDP consent the legacy schema lacks)." But this is an assertion in the risk register, not yet reflected in any schema or code. The `ingestion-service` scaffold has no domain models. The raw event store schema is undefined (Stage-2 Aryan's job).

DPDP Act 2023 §7 requires processing to be for a specified purpose. §8(3) requires the Data Fiduciary to maintain evidence of consent/lawful basis. Under Rules 2025, Rule 3(1)(b), the notice to the data principal must include "a description of personal data and the purpose of processing." If a row in the Brain raw event store contains a Shopify customer's email and there is no column linking that row to the purpose/lawful-basis record for that customer's data, then: (a) the right-to-erasure (DPDP §12) cannot be scoped correctly (which rows do we delete when this customer withdraws consent?), (b) the data-retention limit (§8(7)) cannot be applied per-purpose, and (c) an audit by the Data Protection Board (established under §18) would find no accountability trail for the processing.

The legacy schema has NO consent/purpose fields anywhere. The migration does not add them at the legacy side (CF-BN-NOLEGACY-1 correctly prohibits this). So unless Brain's raw event store schema adds them from day one, every PII row ingested at the Stage-8 cutover is unlinked from its lawful basis. A retroactive backfill — linking purpose/consent to potentially millions of historical Shopify order rows — is expensive, error-prone, and itself a DPDP §4 processing act that requires its own lawful basis.

**Proposed binding constraint (CF-C3-CONSENT-COLUMN-1):**

The raw event store schema (designed in Stage 2 by Aryan) MUST include, as a non-nullable column on every table that contains personal data fields, at minimum:
- `lawful_basis` (enum: `owner_brand_controller` | `data_principal_consent` | `legitimate_interest` — initial value is `owner_brand_controller` for Sugandh Lok)
- `purpose_code` (string: e.g., `analytics_performance`, `logistics_tracking`, `email_performance`)
- `workspace_id` (already planned via `withWorkspace`) — needed for per-workspace erasure scoping

These columns must be populated at ingest time by the connector adapter, not backfilled later. For the initial Sugandh Lok scope, `lawful_basis = owner_brand_controller` and a purpose code from a small enum is sufficient. The full consent primitive (WS-2 in the backlog) deepens this. The point is: adding these three columns NOW costs almost nothing (they are stamped at ingest-write with a constant value for Sugandh Lok); not adding them NOW creates a retroactive backfill problem across every PII row.

The Stage-2 schema design must treat this as a mandatory column set, not a "later enhancement."

---

## CONCERN 6 — Sugandh Lok own-brand containment: the framework MUST enforce, not just document, the brand-agnostic cutover scope

**Severity: MEDIUM (architectural enforcement gap; the constraint is named but not mechanically enforced)**

**Evidence:**

CF-SEC-3 was satisfied for Child 1 on the explicit ground: "Sugandh Lok is the only in-scope brand." The Founder is the legal owner/controller of Sugandh Lok. The framework (3a) is brand-agnostic by construction — it reads workspace credentials and ingests for any workspace it has a connection for. Nothing in the current constraint set prevents the Stage-8 HOLD-AT-CUTOVER from being executed for a second workspace that is NOT Sugandh Lok, simply because the ceremony runbook (3b) does not name a workspace-allowlist.

If the cutover ceremony is executed for workspace B (a brand the Founder does NOT control), the ingest-service begins processing that brand's customer PII under the Sugandh Lok lawful basis (owner_brand_controller) — which does not apply. This is a DPDP §7 violation: processing without a valid lawful basis for the specific data principal.

**Proposed binding constraint (CF-C3-WORKSPACE-ALLOWLIST-1):**

The Stage-8 ceremony runbook (3b) MUST name the specific workspace IDs for which the cutover is approved. The framework's credential-read path SHOULD include a runtime workspace allowlist check at the ingest-service startup: "only process these workspace IDs; reject any other workspace's credential read until the DPDP lawful-basis instrument for that workspace is on record." This is not a framework redesign — it is a startup config check that can be a single env-var `ALLOWED_WORKSPACE_IDS`. When a second workspace is onboarded, the WS-2 governance workstream (DPA, consent primitive) fires first, and the allowlist is expanded only after that.

---

## Summary verdict

Six concerns, none of which say "looks good." Ranked by severity:

| ID | Concern | Severity | Ship-blocker? | Escalate? |
|----|---------|----------|---------------|-----------|
| CF-C3-SECRETS-INTERIM-1 | No custody mechanism; Supabase DB = de-facto credential vault; R-CRED-01 mitigation cannot execute | HIGH | Yes — gates Stage-8 HOLD-AT-CUTOVER ceremony | YES — Founder must choose Option A (activate WS-1) or ratify Option B (Sugandh Lok only) |
| CF-C3-DELETE-SEQUENCE-1 | Delete-plaintext (C8) sequencing lacks live auth-proof step before delete; Shiprocket `email/password` has no recovery path if step fails | HIGH | Yes — must be in the 3b runbook | No (derivable constraint, Aryan binds in Stage 2) |
| CF-C3-PII-ADAPTER-GATE-1 | Generic framework silently enables PII scope creep; Klaviyo scope is clean now but adapter pattern has no declared PII manifest per connector | HIGH | Yes — per-adapter manifest required in Stage 2 design | No (derivable; Aryan binds) |
| CF-C3-RESIDENCY-ASSERT-1 | Ingest-service has no startup region assertion; first Brain runtime writing live PII must assert ap-south-1, not trust URL config | MEDIUM | Yes — must be in Stage 2 design (not needed for LOCAL-verify) | No (carried tripwire per architecture) |
| CF-C3-CONSENT-COLUMN-1 | Raw event store schema will have no consent/purpose/lawful-basis column; retroactive backfill of PII rows is irreversibly expensive | MEDIUM | No for LOCAL-verify; YES before Stage-8 live ingest | No (Aryan binds at Stage 2 schema design) |
| CF-C3-WORKSPACE-ALLOWLIST-1 | Brand-agnostic framework has no enforcement of Sugandh-Lok-only scope; CF-SEC-3.HARD re-arms silently if second workspace is cut over | MEDIUM | No for framework build; yes before second-workspace cutover | No (runbook binding + startup config) |

**Escalation recommendation to Founder (mandatory, not optional):**

The Secrets Manager non-existence (Concern 1) is a genuine `/escalate`. The Founder asked agents to proceed with all children without asking — but this is not a design decision, it is a missing instrument that only the Founder can resolve. The specific ask is narrow: "Option A (activate WS-1 now or alongside Child 3 Stage 3/4 build) OR ratify Option B (Sugandh Lok only, interim Supabase column custody, WS-1 activates before workspace 2, confirm Supabase ap-south-1 AES-256 at-rest encryption is active)." This is a 2-sentence Founder decision, not a long discussion. Without it, the HOLD-AT-CUTOVER runbook (3b) cannot be written with a truthful custody mechanism. Writing a runbook that names "Brain Secrets Manager" for a system that does not exist is a compliance fiction.

The other five concerns are derivable constraints that Aryan binds in Stage 2. They do not require the Founder.

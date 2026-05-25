# Stage 1 Synthesis — `feat-connector-framework-cutover` (Child 3 of `chore-migrate-legacy-to-brain`)

> Written by Rohan (cto-advisor) AFTER both requested personas returned and the orchestrator re-invoked me.
> Pairs with the intake `02-cto-advisor-review.md` (3 challenges, 13 binding constraints, the armed Secrets-Manager escalation).
> Personas synthesized: `03-persona-connector-cutover-token-handoff-realist.md` (5 concerns), `04-persona-india-connector-pii-secrets-compliance-officer.md` (6 concerns).

| Field | Value |
|-------|-------|
| **req_id** | `feat-connector-framework-cutover` |
| **Stage** | 1 (synthesis — post-persona re-invoke) |
| **Timestamp** | 2026-05-24T20:30:00Z |
| **Decision** | **ADVANCE → Stage 2 (Aryan, architect)** with a sharpened scope (3a SPLIT into 3a-i framework + 3a-ii first-runtime decision; Shopify re-bound as atomic-not-per-shop) + **escalation FIRED (escalate-now; Stage-2 proceeds, Stage-3 build gated)** |
| **Lane** | high-stakes (unchanged — confirmed) |
| **Paradigm** | `sql` + OAuth/connection/event-handling (unchanged — confirmed; cost-routing audit clean) |
| **Maya co-owns Stage 2** | **FLIPPED to conditional-YES** — see §6 (CF-C3-CONSENT-COLUMN-1 touches the raw event-store schema that pre-shapes Child-4 metric fields). Aryan confirms or declines at Stage-2 open; default is co-own. |
| **Personas synthesized** | 2/2; **both ACCEPTED** (5 + 6 genuine code/architecture-grounded concerns; zero "looks good") |

---

## 1. Persona quality gate — accept / reject

Both personas read the **actual legacy code and the `ingestion-service` scaffold**, not just the architecture prose, and each surfaced concrete file-and-line evidence. Neither said "looks good." Both pass the quality gate.

### Persona 1 — `connector-cutover-token-handoff-realist:sonnet` — **ACCEPTED**
- 5 concerns (2 CRITICAL / 2 HIGH / 1 MEDIUM), every one grounded in a legacy file:line and cross-checked against the binding Child-0 doc.
- **Verified against the binding architecture myself:**
  - Concern 1 (Shopify atomic flip) — the architecture's own A1.3 line 195 / A6.3 line 1069 say "1 webhook/shop", which the persona proved at code level is an *oversimplification*: HMAC is keyed on the app-level `SHOPIFY_CLIENT_SECRET` env (`webhooks.ts:35`), one shared `callbackUrl` (`:505`), shop-domain routing (`shopify.ts:663`). This **refines** the binding doc; it does not contradict my intake. **ACCEPT.**
  - Concern 2 (rollback assumes legacy live + plaintext exists) — A4 Child-3 row (line 554) literally says rollback = "Token handed back to legacy; webhook re-registered to legacy endpoint" — which silently requires (a) legacy running, (b) plaintext still in legacy DB. R-CRED-01 (line 1078) deletes plaintext "at that connector's cutover (not after)." The two collide. **ACCEPT.**
  - Concern 3 (Shiprocket is polling not webhook; `discoverChannels` bare write) — A1.3 line 201 / M-A5-Q3 line 667 confirm "NO historical event replay". The persona sharpens that Shiprocket has no webhooks *at all* (`shiprocket.ts` re-loginable email/password JWT; `shiprocket-sync.ts:341-364` `discoverChannels` bare-writes via the `prisma` singleton). This is exactly the residual no-context writer the Child-1 FORCE-unlock (3c) targets — and it stays live until Shiprocket *decommission*, not when we build the Brain replacement. This is a material sharpening of my 3c ruling. **ACCEPT.**
  - Concern 4 (Shape-B first-runtime scope is larger than CF-C3-FIRST-RUNTIME-1 named) — `pyproject.toml` deps=[], only `.gitkeep`; no psycopg3/asyncpg/httpx/aiokafka/pydantic; no Kafka topic; `withWorkspace` is TS-only and **cannot be imported by a Python service**. The persona is right that even "LOCAL-only" needs a real Python session-context primitive + a docker-compose harness. **ACCEPT.**
  - Concern 5 (Meta/Google 24-48h attribution vs 8h parity) — A1.3 line 199 + M-A5-Q3 line 663 use an 8h window + spend-sum parity; `meta-sync.ts` + `cron.ts:44` confirm the 24-48h attribution delay. The 8h spend-sum check will false-PASS. **ACCEPT.**

### Persona 2 — `india-connector-pii-secrets-compliance-officer:sonnet` — **ACCEPTED**
- 6 concerns (3 HIGH / 3 MEDIUM), each citing the exact statute + the exact schema line.
- **Verified:**
  - Concern 1 (no custody mechanism; Supabase DB = de-facto plaintext vault) — confirms my intake's armed escalation #1 with code (schema:498-500/559/699/763). R-CRED-01 (line 1078) names "Brain secrets manager" as the destination, which I verified does not exist. The persona's binary Founder ask (Option A activate WS-1 / Option B ratify Sugandh-Lok-only interim) is the right shape. **ACCEPT — this fires the escalation (§5).**
  - Concern 2 (delete-plaintext-at-cutover lacks live-auth-proof; Shiprocket lockout) — A6.3/R-CRED-01 say delete "at that connector's cutover (not after)"; the persona's Shiprocket `email/password` lockout failure mode is real (no replay, no Shiprocket-side regeneration of an account password). Pairs with Persona-1 Concern 2. **ACCEPT.**
  - Concern 3 (per-adapter PII manifest; generic framework enables silent PII scope creep) — Klaviyo/Meta/Google are aggregate-only *today*, but the adapter pattern means the compliance gate must sit at the adapter, not the framework. Honest and code-grounded (`klaviyo-sync.ts` aggregates; Meta Conversions API / Google enhanced-conversions as the future hashed-PII surface). **ACCEPT.**
  - Concern 4 (ingest-service startup residency assertion) — mirrors Child-1 rollout-runbook STEP-0; the first Brain runtime writing live PII must self-assert ap-south-1. **ACCEPT** (carried CF-RES-1.a, now made a *runtime startup gate*, not just a deploy annotation).
  - Concern 5 (non-nullable consent/purpose/lawful_basis columns from day one; retroactive backfill is irreversibly expensive) — DPDP §7/§8(3)/§12 + Rules 2025 Rule 3(1)(b). The legacy schema has none; CF-BN-NOLEGACY-1 forbids adding them legacy-side; so Brain's raw event store must carry them at ingest-write. **ACCEPT — this is what flips Maya to co-own (§6).**
  - Concern 6 (Sugandh-Lok-only workspace allowlist enforced at startup) — CF-SEC-3 is satisfied for Sugandh Lok only; the brand-agnostic framework needs a mechanical `ALLOWED_WORKSPACE_IDS` startup check so the gate cannot be bypassed by cutting over a second brand. **ACCEPT.**

**De-dup note:** Persona-1 Concern 2 + Persona-2 Concern 2 both attack the delete-plaintext sequencing from different angles (engineering rollback vs compliance lockout). I fold them into ONE constraint (CF-C3-ROLLBACK-CRED-WINDOW-1) with both rationales, rather than two near-duplicates.

---

## 2. Scope ruling on the two CRITICALs

### (a) Shopify — "per-connector reversibility" is FALSE for Shopify; re-bound as **per-connector-EXCEPT-Shopify-is-all-shops-atomic**

My intake CF-C3-SINGLE-OWNER-1 and CF-C3-PER-CONNECTOR-N-1 implied each connector — including each Shopify shop — is an independent reversible unit. Persona-1 proved at code level that for Shopify the reversibility unit is **the registered webhook `callbackUrl`, which is one shared endpoint across all shops**, and the HMAC secret is the **app-level** `SHOPIFY_CLIENT_SECRET` (not a per-brand OAuth token that rotates per A6).

**Ruling:** I AMEND the intake. The per-connector-reversibility invariant holds for Shopify only at the granularity of **"all Shopify shops at once."** Bound as **CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1** (owner: Aryan): the Shopify cutover is a single scripted bulk `webhookSubscriptionCreate` across ALL connected shops × 14 topics, rate-limited (2 mutations/sec/shop); rollback is the same bulk script in reverse; the runbook must specify (i) the bulk re-registration script + its reverse, (ii) Shopify rate-limit budgeting, (iii) how Brain verifies HMAC using the **app-level** secret (which must be present in Brain's environment **before** any webhook arrives — and is therefore an app-level secret that CF-SEC-SECRETS-1's per-brand rotation model does NOT cover; it needs its own custody line, folded into the escalation §5). This does NOT change the lane or kill the child — it makes the Shopify ceremony honest. **Mitigation that keeps it reversible:** because Shopify HAS 60-day order-API replay (A1.3 line 195), an all-shops flip is still recoverable via API backfill within the 4h window — so atomic ≠ irreversible for Shopify. The irreversibility risk concentrates on **Shiprocket** (no replay), which is why Shiprocket is sequenced LAST.

### (b) Shape-B first runtime — bound **CF-C3-RUNTIME-SCOPE-DECISION-1** as a Stage-2 must-decide, and SCOPE-SPLIT 3a

Persona-1 Concern 4 is the Shape-B trap that bit Child 1. `ingestion-service` is a bare scaffold; standing up the **first live Brain runtime + first Kafka topic + first Python session-context primitive** is a hidden scope explosion. CF-C3-FIRST-RUNTIME-1 named the *question* but underweighted the *minimum viable scope* (Python deps, a Postgres connection from Python, a Python `withWorkspace` equivalent via `set_config('app.workspace_id', …, true)`, a Kafka topic, a deploy target).

**Ruling — SCOPE-SPLIT 3a (mirrors how I bound Child-1 to Shape A):** I split the intake's 3a into:
- **3a-i — Framework, LOCAL-verified (the build, fully in scope this child):** ONE generic connector-ingest primitive in `ingestion-service` (Python source + declared deps + a **Python-native** `withWorkspace` equivalent + idempotent UPSERT under RLS + Kafka producer **unit-tested against a local broker** + cursor + raw archive) + a **docker-compose test harness** (local Postgres + Kafka). Per-connector adapters as config, not N bespoke paths (Single-Primitive). **No live Supabase connection. No MSK topic provisioned. No live token moved.**
- **3a-ii — First-runtime-scope DECISION (Stage-2 binding, Aryan):** Aryan MUST record ONE of two binding choices in the Stage-2 plan, with its test-coverage implications:
  - **(A) Framework-only LOCAL-verified** — no live Supabase, no MSK; HOLD-AT-CUTOVER includes a **mandatory integration test against the real Supabase pgbouncer/pooler before any live webhook is pointed at Brain** (closes the gap that the live cutover would otherwise be the first real connection — the exact failure HOLD-AT-CUTOVER exists to prevent).
  - **(B) Full-runtime LOCAL+STAGING** — deploy target + MSK topic provisioned + integration test against Supabase staging before HOLD-AT-CUTOVER (this pulls @jatin in as a deploy-pipeline track at Stage 2).
  - A third "figure it out during build" path is **forbidden** — that is how Child-1's Shape-B trap happened.

**Do I split Child 3 into separate requirements (3a vs 3b)?** NO — same call as Child 1 (1a/1b inside one req) and Child 2 (Shape A inside one req). The framework (3a-i) + the ceremony runbook (3b) + the residual-writer unlock (3c) stay inside ONE requirement; the live flips are deferred behind the named **HOLD-AT-CUTOVER** state and executed at Stage 8 one connector at a time. This keeps the child reversible without fragmenting the dependency graph. The 3a-ii decision is the reversibility safeguard, not a reason to split the req.

---

## 3. 3c — Force-unlock scope correction (Persona-1 Concern 3)

My intake CF-C3-FORCE-UNLOCK-1 said the "complete bare-write grep ZERO hits" precondition for Child-1's FORCE is satisfied once the Brain framework becomes the context-aware replacement. Persona-1 correctly sharpened: the legacy `discoverChannels` / `backfillShiprocketCourierNames` / `backfillShiprocketPincodes` bare writers **remain live in the legacy app and keep writing via the bare `prisma` singleton until that connector is DECOMMISSIONED** (the last step, after cutover + sustained parity). Building the Brain replacement does NOT silence the legacy writer; retiring the legacy caller does.

**Ruling:** I bind **CF-C3-FORCE-UNLOCK-SCOPE-1** (owner: Aryan + carried to Child-1's HOLD-AT-FORCE ledger): the complete bare-write grep is GREEN — and Child-1's FORCE may run — only after the **Shiprocket connector (last) is decommissioned**, not when Child-3 ships the Brain framework. CF-C3-FORCE-UNLOCK-1 (the grep is against Brain code, never legacy edits) still holds; CF-C3-FORCE-UNLOCK-SCOPE-1 adds the *timing* truth: the legacy bare writers die at decommission. This is an important correction to the cross-child unlock edge — Child-1's FORCE is gated further out than my intake implied.

---

## 4. Binding CF-* contract carried to Stage 2 (folded, de-duped, owner-tagged)

> Owners: **Aryan** = homes / runtime-scope / schema / ceremony-runbook design; **Jatin** = secrets / residency / infra (only if Option A/B pulls deploy in); **Founder** = the escalation decision (§5). De-duped against the 13 intake constraints; new ones from synthesis flagged **(NEW)**.

| ID | Severity | Owner | Constraint |
|----|----------|-------|------------|
| **CF-BN-NOLEGACY-1** | — | Aryan/all | Legacy = reference-only. Framework built Brain-native in `ingestion-service`; legacy `discoverChannels`/`backfill*` retired at cutover, never edited. Any diff in `legacy project/` = drift bounce. |
| **CF-C3-SINGLE-OWNER-1** | — | Aryan | Token in exactly ONE system at a time (A3.2 rule 3); ACL never dual-homes a token. |
| **CF-C3-HOLD-AT-CUTOVER-1** | — | Aryan (design) / Founder+Jatin (exec) | Live per-connector token transfer + webhook re-registration + legacy-plaintext-delete DEFERRED to Stage-8 gated ceremony. Child exit = framework + runbook present + LOCAL-verified; ZERO live token moved in a normal run. |
| **CF-C3-PER-CONNECTOR-N-1** | — | Aryan | Per-connector rollback window N (M-A5-Q3): Shopify/Woo 4h, Meta/Google 8h, Klaviyo/Unicommerce 12h, **Shiprocket 72h + ≥2-week pre-shadow (no replay — LAST)**. Lowest-risk first. |
| **CF-C3-PARITY-COUNT-1** | — | Aryan | Parity = count-based + event-field spot-check per connector (M-A5-Q3 carve-out lines 655-669); do NOT build a numeric harness here. |
| **CF-C3-SINGLE-PRIMITIVE-1** | — | Aryan | ONE generic ingest primitive consumed N times; per-connector quirks are config/adapters, not N bespoke paths. |
| **CF-C3-RLS-CONSUME-1** | — | Aryan | Every write goes through a session-context primitive consuming Child-1 RLS; the legacy "workspaceId-but-no-RLS" model must NOT leak into Brain. **Refined by CF-C3-PY-SESSION-CTX-1 below** (the TS `withWorkspace` cannot be imported by Python). |
| **CF-C3-PY-SESSION-CTX-1 (NEW)** | HIGH | Aryan | The Python ingest-service MUST implement its own session-context primitive — `set_config('app.workspace_id', $1, true)` tx-local, same fail-closed semantics as the Child-1 TS `withWorkspace`, designed + tested (not assumed). It is a backing-detail re-implementation of the SAME contract, NOT a new app-layer scoping model. (Persona-1 Concern 4.) |
| **CF-C3-RUNTIME-SCOPE-DECISION-1 (NEW)** | CRITICAL | Aryan | Stage-2 MUST record ONE binding choice: (A) Framework-only LOCAL-verified + mandatory real-pooler integration test inside HOLD-AT-CUTOVER, OR (B) Full-runtime LOCAL+STAGING (deploy target + MSK topic + staging integration test) → pulls @jatin in. No "decide during build" path. (Persona-1 Concern 4; the Shape-B trap.) |
| **CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1 (NEW)** | CRITICAL→bound | Aryan | Shopify cutover is **all-shops-atomic** (one shared `callbackUrl` flip), NOT per-shop. Runbook: bulk `webhookSubscriptionCreate` across all shops × 14 topics (rate-limited 2/sec/shop) + the same script in reverse for rollback + app-level-secret HMAC verification present in Brain BEFORE first webhook + endpoint responsive BEFORE the flip (else events drop; Shopify retries 48h on 5xx). Reversible via 60-day order-API backfill within the 4h window. (Persona-1 Concern 1; amends intake CF-C3-SINGLE-OWNER-1/PER-CONNECTOR-N-1.) |
| **CF-C3-ROLLBACK-CRED-WINDOW-1 (NEW)** | HIGH | Aryan | Legacy-plaintext-delete (C8) is the LAST ceremony step, AFTER (1) credential written to custody, (2) **a live HTTP round-trip auth test against the vendor proves Brain can read+use it**, (3) count-parity confirmed within window N. During the rollback window the legacy cred is SEALED (not deleted, not dual-live). A4 rollback branches BEFORE the delete: failed auth test = "abort, cred still in legacy, no restore needed." For Shiprocket the life-critical item is the `email/password` pair (the `accessToken` is ephemeral via `getValidToken`). Folds Persona-1 Concern 2 + Persona-2 Concern 2. |
| **CF-C3-SHIPROCKET-POLL-MODEL-1 (NEW)** | HIGH | Aryan | Shiprocket runbook models a **polling-gap** scenario, not webhook event-loss: (1) disable legacy `syncAllShiprocket` cron, (2) verify no legacy Shiprocket cron scheduled, (3) Brain first poll with `days=7` (cover the gap), (4) shipment-count parity. The 72h window is a polling-parity window. (Persona-1 Concern 3.) |
| **CF-C3-FORCE-UNLOCK-1** | — | Aryan | The "complete bare-write grep ZERO hits" precondition for Child-1's FORCE is satisfied against BRAIN code (grep must NOT exclude backfill/discoverChannels — the legacy grep was DEFECTIVE); legacy writers retired at cutover, never edited. |
| **CF-C3-FORCE-UNLOCK-SCOPE-1 (NEW)** | HIGH | Aryan + Child-1 HOLD-AT-FORCE ledger | The legacy bare writers (`discoverChannels`/`backfillShiprocketCourierNames`/`backfillShiprocketPincodes`) stay LIVE until the **Shiprocket connector (last) is DECOMMISSIONED** — so Child-1's FORCE unlock is gated on Shiprocket decommission, NOT on Child-3 shipping the Brain framework. Corrects the cross-child unlock-edge timing. (Persona-1 Concern 3.) |
| **CF-C3-PII-ADAPTER-GATE-1 (NEW)** | HIGH | Aryan | Each connector adapter declares a code-level PII manifest (fields that are personal data per DPDP §2(t) + lawful basis + purpose), checked by the ingest primitive before writing. Sugandh-Lok scope: Shopify=email/firstName/lastName; Woo=customerEmail/customerPhone/billing*/shipping*; Shiprocket=deliveryPincode/City/State; Klaviyo/Meta/Google="no individual PII (aggregates only); Conversions-API/enhanced-conversions OUT OF SCOPE until separately gated." Forces an explicit decision at each future adapter. (Persona-2 Concern 3.) |
| **CF-C3-CONSENT-COLUMN-1 (NEW)** | MEDIUM (build) / HIGH (before Stage-8 live ingest) | Aryan (+ Maya co-design — see §6) | Raw event-store schema carries, NON-NULLABLE on every PII table from day one: `lawful_basis` (enum, init `owner_brand_controller`), `purpose_code` (enum, e.g. `analytics_performance`/`logistics_tracking`/`email_performance`), `workspace_id`. Stamped at ingest-write, not backfilled (retroactive backfill across millions of rows is irreversibly expensive + itself a §4 processing act). (Persona-2 Concern 5 — this is the Child-4 coupling that flips Maya.) |
| **CF-C3-RESIDENCY-ASSERT-1 (NEW; sharpens CF-RES-1.a)** | MEDIUM | Aryan (design) / Jatin (deploy) | The ingest-service STARTUP sequence positively asserts ap-south-1 on BOTH `DATABASE_URL` and `DIRECT_URL` and REFUSES TO START on failure (a runtime startup gate, not a deploy annotation), emitting a named error. The first Brain runtime writing live PII asserts its own residency. (Persona-2 Concern 4.) |
| **CF-C3-WORKSPACE-ALLOWLIST-1 (NEW)** | MEDIUM | Aryan (runbook) | The Stage-8 ceremony runbook names the specific approved workspace IDs; the ingest-service enforces a startup `ALLOWED_WORKSPACE_IDS` check and rejects any other workspace's credential read until that workspace's DPDP instrument is on record. Sugandh-Lok-only until WS-2 governance fires. (Persona-2 Concern 6; mechanizes CF-SEC-3.) |
| **CF-C3-META-GOOGLE-ATTRIBUTION-WINDOW-1 (NEW)** | MEDIUM | Aryan | For Meta/Google, parity includes a 48h re-validation window (not just 8h); first Brain-owned cron syncs `days=7`; the 8h window is COUNT parity only; spend-sum is NOT a hard rollback trigger within 48h of cutover (24-48h attribution finalization). (Persona-1 Concern 5.) |
| **CF-SEC-SECRETS-1** | HIGH (build-gating) | **Founder** (decision) → Aryan (runbook) | No plaintext creds in Brain long-term. **FIRES the escalation (§5).** Folds in the new app-level Shopify HMAC secret custody question raised by CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1. Re-bound as **CF-C3-SECRETS-INTERIM-1** below. |
| **CF-C3-SECRETS-INTERIM-1 (NEW; supersedes the interim portion of CF-SEC-SECRETS-1 for this child)** | HIGH (gates Stage-8 ceremony; build-gates Stage-3 until the Founder decision) | **Founder** | Stage-8 HOLD-AT-CUTOVER cannot proceed until ONE is true: (A) WS-1 activated + AWS Secrets Manager (ap-south-1) provisioned + tokens rotated + IAM-scoped `GetSecretValue`; OR (B) Founder ratifies in-writing-in-run-folder a Sugandh-Lok-ONLY interim Supabase-column custody + confirms ap-south-1 AES-256 at-rest encryption + commits WS-1 activates before workspace 2. The 3b runbook cannot name a truthful custody mechanism until this decision exists. |
| **CF-SEC-3** | HIGH (re-arms) | Founder + Aryan | DPDP lawful-basis for PII ingested at the boundary. Satisfied Sugandh-Lok-only; re-arms before any third-party-brand PII enters prod (mechanized by CF-C3-WORKSPACE-ALLOWLIST-1 + CF-C3-PII-ADAPTER-GATE-1). |
| **CF-RES-1.a** | — | Jatin | (carried; sharpened by CF-C3-RESIDENCY-ASSERT-1 into a startup gate). |
| **CF-C3-FIRST-RUNTIME-1** | — | Aryan | (carried; superseded in specificity by CF-C3-RUNTIME-SCOPE-DECISION-1 + CF-C3-PY-SESSION-CTX-1). |
| **CF-C3-NO-CUTOVER-AT-FESTIVAL-1** | — | Aryan (runbook) | No live cutover during a known festival traffic window (RTO/COD volume amplifies the data-loss window). |
| **CF-C3-DELETE-SEQUENCE-1** | HIGH | Aryan | (Persona-2 Concern 2 — folded into CF-C3-ROLLBACK-CRED-WINDOW-1; retained as an alias for the step-ordering: write→live-auth-test→parity→THEN delete.) |

**Net:** 13 intake constraints → **24 binding constraints** carried to Stage 2 (11 NEW from synthesis), zero dropped, two CRITICALs ruled on, one cross-child unlock-edge timing corrected.

---

## 5. Escalation — FIRED (escalate-now), Stage-2 PROCEEDS, Stage-3 build GATED

The compliance persona CONFIRMED the Secrets-custody gap (Concern 1) with code: the Supabase DB is the de-facto plaintext credential vault, R-CRED-01's "Brain secrets manager" destination does not exist, and there is **no lawful long-term interim** — only a Founder-ratifiable bounded one. This is the same rubric class as Child-1's DPDP escalation: **a missing instrument only the Founder can produce/decide**, not a fact I can derive from canon. I therefore **fire the armed escalation now**, following the Child-1 pattern exactly (`escalated_now: true`, `does_not_block_stage: 2`, `blocks_stage: 3`).

**Why escalate-now, not Stage 7:** the 3b runbook is a Stage-2/3 artifact and CANNOT name a truthful custody mechanism until this decision exists. Writing "rotate into Brain Secrets Manager" for a system that does not exist is a compliance fiction. Firing now lets the Founder decide in parallel with Aryan's Stage-2 design (which touches no live data, no creds), ready before Stage 3 build authorization.

**Why Stage 2 still proceeds:** the framework (3a-i) builds + LOCAL-verifies against stub connectors with zero live credentials; Aryan's architecture (homes, schema, Python session-context, runbook design) touches no live data and no creds. Nothing in Stage 2 is blocked.

### Exact Founder ask (binary — a 2-sentence decision)

> **Child-3 connector framework needs a credential-custody decision before Stage-3 build authorization. Choose ONE:**
> - **Option A (preferred):** Activate `chore-security-governance-hardening-phase` WS-1 now (or alongside Child-3 build) — provision AWS Secrets Manager in ap-south-1, rotate the connector OAuth tokens / API keys into it, and the ingest-service reads via IAM-scoped `GetSecretValue` (no plaintext in DB columns post-rotation).
> - **Option B (interim, Sugandh-Lok-only):** Ratify in writing that for the initial Sugandh Lok cutover the legacy Supabase DB column IS the interim credential store, read over an RLS-session-scoped Postgres connection, AND (i) confirm Supabase ap-south-1 AES-256 at-rest encryption is active, AND (ii) commit that WS-1 activates **before any second workspace's credentials are stored** this way. Delete-plaintext-at-cutover under Option B means encrypting the credential column (Supabase disk AES-256 + column-level hardening).
>
> Additionally, note the **app-level Shopify HMAC secret** (`SHOPIFY_CLIENT_SECRET`, the Partner-app secret, not a per-brand OAuth token): Brain must hold it to verify Shopify webhooks. It is NOT covered by the per-brand rotation model — it needs its own custody line under whichever option you choose.

**Effect:** `build_gated_on` = CF-C3-SECRETS-INTERIM-1 (Founder Option A or B). **Stage 2 proceeds now; Stage 3 cannot start until the decision is on record.**

**What re-arms / re-fires:**
- **CF-SEC-3** re-fires before any **non-Sugandh-Lok** brand's PII enters prod (mechanized by CF-C3-WORKSPACE-ALLOWLIST-1). Sugandh-Lok-only holds for now.
- **CF-C3-RESIDENCY-ASSERT-1** `/escalate` re-fires only if the ap-south-1 startup assertion FAILS at execution.

This is mirrored to `.engineering-os/pending-founder-attention.md` as a FIRED escalation (the intake heads-up is upgraded from "armed" to "fired").

---

## 6. Maya co-ownership of Stage 2 — FLIPPED to conditional-YES

My intake said NO (raw ingest, no metric registry). Persona-2 Concern 5 (CF-C3-CONSENT-COLUMN-1) changes this: the raw event-store schema must carry non-nullable `lawful_basis` / `purpose_code` / `workspace_id` columns **from day one** because retroactive backfill is irreversible-expensive. That schema is the same raw event store Child-4's metric registry will read — and `purpose_code` + the PII-manifest field set (CF-C3-PII-ADAPTER-GATE-1) **pre-shape fields Child-4 will consume** (e.g. which fields are even available to roll up, and the per-purpose retention/erasure scoping that metric materialization must respect).

This is exactly the carve-out I named at intake: *"If Aryan's Stage-2 design finds the raw event-store schema must pre-shape fields the metric registry will consume (a Child-4 coupling), he raises a co-owner request then."* The persona surfaced that coupling concretely. Rather than wait for Aryan to discover it mid-design, I **flip the default to co-own**: Maya (intelligence-engineer) co-designs the raw event-store schema's PII/consent/purpose column set with Aryan at Stage 2, to avoid a Child-4 re-cut. Aryan may DECLINE at Stage-2 open with a one-line rationale if he judges the schema is purely an ingest concern with no Child-4 field coupling — but the burden is now on declining, not on requesting. (Same mechanism as Child-2, which co-owned with Maya.)

---

## 7. What Stage 2 (Aryan) needs to produce

1. **3a-ii runtime-scope decision (CF-C3-RUNTIME-SCOPE-DECISION-1):** record Option A (LOCAL-only + mandatory pooler integration test inside HOLD-AT-CUTOVER) or B (LOCAL+STAGING + @jatin deploy track). No third path.
2. **The single ingest primitive (CF-C3-SINGLE-PRIMITIVE-1)** + the **Python session-context primitive (CF-C3-PY-SESSION-CTX-1)** with locked signature, fail-closed, tx-local `set_config`.
3. **Raw event-store schema (co-designed with Maya)** including the non-nullable `lawful_basis`/`purpose_code`/`workspace_id` columns (CF-C3-CONSENT-COLUMN-1) + the per-adapter PII manifest contract (CF-C3-PII-ADAPTER-GATE-1).
4. **Per-connector cutover ceremony runbook (3b)** encoding: Shopify all-shops-atomic bulk script + reverse (CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1); the write→live-auth-test→parity→delete sequencing (CF-C3-ROLLBACK-CRED-WINDOW-1); Shiprocket polling-gap model with `days=7` first poll (CF-C3-SHIPROCKET-POLL-MODEL-1); Meta/Google 48h re-validation (CF-C3-META-GOOGLE-ATTRIBUTION-WINDOW-1); the per-connector N windows (CF-C3-PER-CONNECTOR-N-1); no-cutover-at-festival; workspace allowlist (CF-C3-WORKSPACE-ALLOWLIST-1). The runbook is the Stage-8 deploy artifact, NOT executed in a normal run.
5. **Startup residency assertion (CF-C3-RESIDENCY-ASSERT-1)** on both URLs.
6. **3c force-unlock timing (CF-C3-FORCE-UNLOCK-SCOPE-1):** document that Child-1's FORCE is gated on Shiprocket decommission, reflected in the Child-1 HOLD-AT-FORCE ledger.
7. **Custody mechanism named per the Founder's Option A/B** (the runbook cannot finalize until §5 resolves; design proceeds with both branches stubbed).
8. **Build-base note (carried):** the build needs the Child-1 RLS primitive on its base branch; resolve at Stage-2/3 build-base selection when the Founder merges the `feature/feat-tenancy-auth-rls-hardening` PR to `development`.

Paradigm `sql` + event-handling is CONFIRMED — Aryan affirms at Stage-2 open (no re-invoke unless he changes it).

---

## 8. Final Stage-1 decision

**ADVANCE → Stage 2 (Aryan, architect; Maya co-owns by default).** High-stakes lane, `sql` paradigm, 24 binding constraints, two CRITICALs ruled (Shopify atomic + Shape-B runtime-scope must-decide), 3a SCOPE-SPLIT into 3a-i framework / 3a-ii runtime decision, live flips deferred behind HOLD-AT-CUTOVER, escalation FIRED (escalate-now: Stage-2 proceeds, Stage-3 build gated on the Founder's Option A/B custody decision). No CHALLENGE-BACK, no KILL — the requirement is sound and planable; the corrections sharpen it, they don't break it.

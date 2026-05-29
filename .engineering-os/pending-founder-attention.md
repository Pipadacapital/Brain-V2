# Pending Founder Attention

> Items here require Founder review. Agents add lines; Founder acts and strikes them through.
> Each line names the issue, the artifact path, and the slash command to act.

---

## 🆕 2026-05-29 — Stage 6 PASS (delegated gate signed) — `connector-webhook-intake`

**Rohan's verdict: PASS → APPROVE.** Signed the Founder gate on your behalf under standing delegation (hard-rule deviation scan CLEAN). This is the **inbound webhook ingress** that consumes the HMAC-custody seam from `chore-app-hmac-secret-custody` — now generalized (per your "100+ sources" directive) into a **vendor-dispatched registry**: a generic `POST /webhooks/:vendor` at the gateway → internal gRPC → a verify-first/default-deny Python servicer that reads every per-vendor fact (verify fn, secret fn, signature/identity/idempotency/topic headers, allowlist) from `WEBHOOK_VERIFIERS[request.vendor]`. **Shopify is the FIRST registered vendor, not the shape.** Adding vendor #2 is zero core change (proven by a 2nd test-vendor running the full ACCEPTED/PARKED/IGNORED/REJECTED matrix GREEN with zero servicer/route/proto edits). `connector_identity_map` is composite-PK `(vendor, external_identity)` — the integration-extensible-schema posture, not per-vendor tables. `@paradigm sql`, **₹0/mo** (zero LLM/ML). 18 CFs MET; 0 CRITICAL/HIGH at S4/S5/S6; over-engineering audit CLEAN; four-tenancy PRESENT; legacy diff==0. Run folder: `.engineering-os/runs/2026-05-29T19-00-00Z__13116e1__connector-webhook-intake__rishabhporwal/` (`11-final-review.md`, `14-retro.md`, `12-founder-decision.json`).

**Independent re-mutation (run by me on disk — captured, reverted byte-clean, md5 of `webhook_servicer.py` identical pre/post):** (1) flip verify→always-True → RED 9-failed; (2) map-before-verify → RED 2-failed; (3) the BOUNCE-1 `except Exception:` REJECT→`pass` → RED 2-failed (`UnboundLocalError` propagates — **the BOUNCE-1 fix holds under my hand**, not just Tanvi's; Maya removed the dead belt-guard and now `secret` is declared inside the try so a fall-through leaves it unbound); (5) hardcode-Shopify-ignore-vendor → RED 5-failed (`_test_token` correctly rejected as `unknown_vendor`). Mutation 4 (anchor→body-hash) lives in the intake module — Shreya+Tanvi both RED + structurally sound, not re-applied this pass. **Full suites after reverts: 329 passed / 14 skipped (Python), 42 passed (gateway).** The verify-first invariants are genuinely test-anchored.

**Stage-5 BOUNCE-1 was the verify-the-verifier durable rule (`2026-05-26`) firing correctly** — Tanvi caught a vacuous mutation-3 kill test (a belt-and-suspenders guard absorbed the fall-through), Maya fixed via dead-code removal, I re-verified RED. The rule is already adopted; **no new rule-proposal** (the auto-candidate rule needs ≥3 distinct runs of a *new* root cause; this is the existing family, and the standing rule worked).

**Two Founder asks:**
1. **Commit it** — say "commit it" (free text) to commit the reviewed code to a fresh `feat/connector-webhook-intake` branch off `development`. Mechanical command (16 explicit product paths only, **no `git add -A`**) in `…/11-final-review.md §13` + `…/pending-founder-commit.md`. ⚠️ The command re-`git add`s the working-tree versions of `webhook_servicer.py` + `test_webhook_servicer.py` first (the BOUNCE-1 delta sits unstaged on a stale index). Committing the code is **NOT** the live ingress and **NOT** the secret rotation.
2. **Line up the Stage-8 ceremony prerequisites** (non-blocking now, needed before cutover): public ingress + WAF/TLS for the gateway, the real Shopify webhook subscription URL, the compromised `shpss_…` rotation value, the real `connector_identity_map` Sugandh-Lok row, and a festival-safe window.

**What stays HELD for Stage 8 (Founder/Jatin-at-console — none delegable, none auto-advanced):** live gRPC server bind (internal-only) · public ingress + WAF/TLS for `POST /webhooks/:vendor` · register the vendor webhook subscription at the real URL · **rotate** the compromised `shpss_…` (two-place ceremony; the value at `apps/api-gateway/.env:27` is compromised-by-exposure) · seed `connector_identity_map` with the real Sugandh-Lok row · **raise grpcio floor → `>=1.70.0`** + lockfile pin (Shreya MED-1, known-DoS-line admission) · real vendor test-event round-trip smoke · **botocore/urllib3 DEBUG-off** + **festival-safe window**.

**Carry-forward MED/LOW (non-blocking):** MED-2 `shop_resolver.py` is dead code (not imported; staged as provenance) — delete in Stage-8 prep or a fast-follow. `webhook_intake.py` still hard-wires `ShopifyAdapter` for normalize/manifest (documented v1-single-vendor limitation; the `vendor` param + Kafka topic + `RawEvent.vendor` are already generic — the spec-lookup is the vendor-#2 onboarding task). LOW-1 gateway logs `vendor`/`bodyLength` pre-verify (non-PII, bounded). MED-3 out-of-slice Expo `@xmldom/xmldom` advisories (mobile-developer).

---

## 🆕 2026-05-29 — Stage 6 PASS (delegated gate signed) — `chore-app-hmac-secret-custody`

**Rohan's verdict: PASS → APPROVE.** Signed the Founder gate on your behalf under standing delegation (hard-rule deviation scan clean). Closes the plaintext-secret posture on the **Shopify inbound-webhook HMAC verifier (C3, Python)**: an app-level singleton secret provider (`AppSecretsManagerProvider` + factory + dev/held fallbacks) feeds the **unchanged** `verify_shopify_hmac()` — fail-closed on unretrievable, ap-south-1 residency-asserted, ids-only never-log with botocore-DEBUG suppression, boot/cached (≤1 SM call). CDK adds the representative `brain/_app/shopify/hmac_secret` (CMK-encrypted, RETAIN, authored-NOT-deployed, IAM not widened). `@paradigm sql`, **₹0/mo**. 11/11 CFs MET; 0 CRITICAL/HIGH at S4/S5/S6; over-engineering audit PASS. Run folder: `.engineering-os/runs/2026-05-29T17-00-00Z__47e81e9__chore-app-hmac-secret-custody__rishabhporwal/` (`11-final-review.md`, `14-retro.md`, `12-founder-decision.json`).

**Re-mutation (run by me on disk — moto, no real AWS, NOT deferred):** the two CRITICAL gate tests were authored by the orchestrator after a transient builder API-500, so I gave them special scrutiny. #1 `compare_digest`→`==` → RED / byte-identical revert / GREEN. #2 not-found `raise`→`return ""` (fall-open) → RED across **4 tests** (the mutation test + 3 corroborating behavioral assertions on different code paths) / byte-identical revert / 37 GREEN. **Both gates genuinely non-vacuous.** Also replicated Tanvi's full suites (263p/14s Python, 35p CDK, `shpss_` grep 0).

**Two Founder asks:**
1. **Commit it** — say "commit it" to commit the reviewed code to a fresh `feat/chore-app-hmac-secret-custody` branch off `development`. Mechanical command (5 product files only, no `git add -A`) in `…/pending-founder-commit.md`. Committing the code is NOT the live provisioning. `apps/api-gateway/.env` is deliberately left untouched.
2. **Note the named follow-on** — `chore-ts-oauth-app-secret-custody` moves the TS OAuth path (C1/C2) off `requireEnv` to the SAME key; bound, not built, mechanical when scheduled.

**What stays HELD for Stage 8 (Founder/Jatin-at-console — none delegable, none auto-advanced):** real SM provisioning of `brain/_app/shopify/hmac_secret` + CMK association · put + **rotate** the live `shpss_…` value (compromised-by-exposure at `apps/api-gateway/.env:27`) · IAM role attach to the ingestion-service task role (policy already scoped — `brain/*` prefix-covers `brain/_app/*`, no widening) · the inbound-webhook **INGRESS ROUTE** (a separate `connector-webhook-intake` feature — this slice leaves the seam only) · **botocore/urllib3 OFF-DEBUG** in the live service · **festival-safe window** for the rotation.

---

## 🆕 2026-05-29 — Stage 6 PASS (delegated gate signed) — `feat-credential-custody-aws-sm`

**Rohan's verdict: PASS → APPROVE.** Signed the Founder gate on your behalf under standing delegation (hard-rule deviation scan clean). Real boto3 AWS Secrets Manager custody (Option A) is built: fail-closed factory, lazy client, ap-south-1 residency, least-priv IAM in CDK (authored-NOT-deployed), 7-day-recovery seal, ids-only never-log. 226 Python tests + 22 CDK assertions + cdk synth clean. `@paradigm sql`, **₹0/mo recurring** (HELD live cost ~$0.40/secret/mo + ~$1/mo KMS CMK — awareness only). Over-engineering audit PASS. Run folder: `.engineering-os/runs/2026-05-29T16-00-00Z__cc1a2b__feat-credential-custody-aws-sm__rishabhporwal/` (`11-final-review.md`, `14-retro.md`, `12-founder-decision.json`).

**The Stage-5 BOUNCE was the verify-the-verifier rule's 11th occurrence — and the rare meta-case: the vacuous test was the gate-mutation test itself.** Maya fixed it (test_2 now drives BOTH fail-closed branches under one spy). I re-mutated all 3 load-bearing gates myself on disk (case None→AWS RED, case _:→AWS RED, residency-removed RED), reverted each clean — fully discharged here (moto, no real AWS; no deferral).

**Two Founder asks:**
1. **Commit it** — say "commit it" to commit the reviewed code to the feature branch. Mechanical command in `…/pending-founder-commit.md`. ⚠️ The command re-`git add`s the working-tree versions of the test + `custody.py` first (the BOUNCE-1 + LOW-2 fixes sit unstaged on a stale index — committing the staged tree would commit the pre-fix versions). Committing the code is NOT the live provisioning.
2. **Line up the Stage-8 ceremony prerequisites** (non-blocking now, needed before cutover): a real AWS account with **ap-south-1** enabled + the **KMS CMK** + connector-cutover credentials available to rotate.

**What stays HELD for Stage 8 (Founder/Jatin-at-console — none delegable, none auto-advanced):** real AWS provisioning · KMS CMK · IAM role creation · live token rotation (`cdk deploy`) · `CF-C7-CUSTODY-PROOF-1` vendor-200 + parity-GREEN legs · the legacy-plaintext **DELETE PoNR (Shiprocket LAST, no replay)** · **botocore/urllib3 DEBUG-loggers-OFF** precondition before live activation · **festival-freeze** (no Diwali/Republic-Day/EOSS). This build makes ONLY the real-`seal()`/`get()` leg satisfiable; the `CF-C7` gate stays FIRED until the ceremony signs the rest.

**Carry-forward LOW:** LOW-1 hatchling `uv sync` build-target gap (non-blocking; tests run with `--no-sync`; Maya/WS-1). LOW-2 already resolved on disk.

---

## 🆕 2026-05-29 — Stage 6 PASS (delegated gate signed) — `feat-tenancy-rls-live-cutover` — ✅ MERGED to development (PR #15)

> **Update 2026-05-29:** code + audit trail **committed and merged to `development` via PR #15** (commits `4a8743f` product + `43a8b9c` eos). `active.json` → `status: merged-on-development`. Ask #1 below (commit it) is **DONE**. The live FORCE flip remains FULLY HELD — code-merge ≠ live cutover; the OPEN P0 closes only when the Stage-8 console ceremony runs. Asks #2–#4 remain open.

**Rohan's verdict: PASS (Stage-8-READY-BEHIND-HOLDS) → APPROVE-WITH-CAVEATS.** Signed the Founder gate on your behalf under standing delegation. Both review fixes (SEC-MED-1 + QA-LOW-1) verified on disk; 4 of Tanvi's gates re-run by me with matching PASS; per-CF audit of all of plan §11 clean; paradigm `sql` / ~₹0/mo; over-engineering audit clean; no hard-rule deviation. Run folder: `.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/` (`11-final-review.md`, `14-retro.md`, `12-founder-decision.json`).

**The live FORCE flip stays FULLY HELD** (Founder-at-console, Stage 8 — not delegable, not auto-advanced). What I deliberately did NOT sign as done: the durable-rule (10th occurrence) Stage-6 re-mutation — there's no ap-south-1 staging clone / live legacy HTTP / psql in the build env, so I refused to fabricate it and bound it as a HARD pre-flip precondition to `stage6-remutate/` instead.

**Founder asks:**
1. ~~**Commit it**~~ — ✅ **DONE 2026-05-29** — committed + merged to `development` via PR #15 (`4a8743f` product, `43a8b9c` eos). Committing the code is NOT the live flip.
2. **Sign the §7 DPDP addendum** — `…/06b-dpdp-section7-addendum-draft.md` (Acts A-D, §8(2)+§7 basis), at Stage 7/8 **BEFORE** the Stage-8 STEP 5 / FORCE flip.
3. **Set a REAL Path-B completion date** — `granted_until` is currently a placeholder; the bypass exit deadline needs a real date written into the runbook header.
4. **Pick a festival-safe window** — no Diwali / Republic-Day-sale / EOSS (CF-CUT-CALENDAR-1; you own the calendar).

**What stays HELD for Stage 8:** HOLD-AT-FORCE · HOLD-AT-STEP-5 (§7 signature) · HOLD-AT-BYPASS-REVOKE (Path B) · HOLD-AT-RE-MUTATION (my `stage6-remutate/` captures, non-waivable) · DEFERRED-STAGING-REHEARSAL (11 deferred captures run live on the provisioned ap-south-1 clone).

---

## 🧹 Hygiene Sweep — 2026-05-26 (claude-code) — current state at a glance

The historical bullets below are preserved as audit trail. This sweep reconciles them against actual git state on `origin/development` so readers don't re-act on already-resolved items.

### ✅ Code-merged (status `merged-on-development` in active.json)
All "you commit" / "awaiting-founder-commit" / "committed-on-feature-branch" asks below for the following 18 items have been **fulfilled** — the code landed on `origin/development` via PRs #1–#5. Do NOT re-act on the strike-eligible commit-asks for these items:

- **Migration epic children (via PRs #1+#2, feat-tenancy-auth-rls-hardening branch):** `feat-tenancy-auth-rls-hardening`, `feat-tenancy-rls-brain-native`, `feat-money-minor-units-parity`, `feat-connector-framework-cutover`, `feat-metric-engine-olap-split`, `feat-ai-engine-intelligence`, `feat-legacy-decommission`
- **Phase-2 parity slices (via PRs #3+#4):** `feat-store-order-fact-layer`, `feat-pnl-cm-waterfall`, `feat-rto-cod-economics`, `feat-marketing-acquisition`, `feat-cohorts-ltv`, `feat-catalog-inventory`, `feat-finance-settings-goals`, `feat-parity-cleanup-pages`
- **Real-auth epic slices (via PR #3):** `feat-auth-supabase-identity` (A), `feat-onboarding-membership-db` (C), `feat-connector-data-ingestion` (E)

### 🚧 STILL OPEN — Founder action required (not resolved by the merges)

These are NOT resolved by the merges and remain valid asks below:

1. ~~**🚨 Custody Option A vs B** (`CF-C3-SECRETS-INTERIM-1`)~~ — ✅ **DECIDED 2026-05-29: Option A — AWS Secrets Manager (ap-south-1).** Correct long-term home; required before brand #2 regardless; activates security-governance WS-1. (Decision-log: `decision-log/2026/05/2026-05-29.jsonl`.)
2. **🚧 Real `seal()` implementation** (`CF-C7-CUSTODY-PROOF-1`) — now scoped to the **Option-A build slice**: real `aws_secrets_manager_custody.{get,put,seal}` (boto3 + IAM-scoped GetSecretValue + 7-day recovery) + CDK + factory wiring + mocked-boto3 tests. Real AWS provisioning + live token rotation = Founder/Jatin-at-console. Gate still binds: real impl + prod-custody-path vendor-200 + parity GREEN signed per-connector BEFORE any plaintext-DELETE (Shiprocket last).
3. **🚨 OPEN P0 — live Supabase has zero RLS** — Brain-native RLS rebuild needed (sequenced vs the live legacy app still hitting that DB).
4. **ℹ️ ARMED tripwire** `CF-C7-DPDP-ERASURE-1` (archive format) — fires at decommission Stage 2 if Aryan can't name a §12-satisfying format.
5. ~~**📋 Candidate rule** `2026-05-25__verify-the-verifier-mutation-on-gate`~~ — ✅ **ADOPTED 2026-05-26** (durable-rules/2026-05-26__verify-the-verifier-mutation-on-gate.md, status: adopted; now enforced — drove the kill-test discipline on feat-tenancy-rls-live-cutover, its 10th occurrence). ~~**Still-open proposals (separate):** `2026-05-25__pre-stage-working-tree-baseline` and `2026-05-25__verify-legacy-formula-at-stage1-not-slice-table`~~ — ✅ **BOTH ADOPTED 2026-05-29** → `durable-rules/2026-05-29__pre-stage-working-tree-baseline.md` + `durable-rules/2026-05-29__verify-legacy-formula-at-stage1-not-slice-table.md` (decision-log 2026-05-29). No open rule proposals remain.
6. **Epic-level ratifications (2026-05-29):**
   - ✅ `epic-phase2-feature-parity` — **RATIFIED build-complete** (all 8 slices merged-on-development). Live activation rides the migration read-path/RLS Stage-8 cutovers; not independently live.
   - ⚠️ `epic-real-auth-supabase` — **OPEN.** Children A/C/E merged, but slice-D live e2e still needs **provider-dashboard redirect-URI registration** (Supabase/Google console — a Founder act) before it's complete.
   - ⚠️ `chore-migrate-legacy-to-brain` — **OPEN (master strangler epic).** Closes only when the held Stage-8 cutovers run (RLS FORCE, connector token-transfer + plaintext-delete, recon, read-flip, decommission) AND `feat-frontend-dashboard-morningbrief` web build is dispositioned (currently `approved`, never built into web).

### ❓ Genuinely still pending (no merged work)
- `feat-frontend-dashboard-morningbrief` — mobile-only; never built into web. Still at Stage 8 readiness, no code in `origin/development`.

### 🔒 Held LIVE-prod cutover gates (NOT closed by the merges)
Code-merge ≠ live cutover. These remain HELD per the original Stage-8 readiness notes: `HOLD-AT-FORCE` (Child-1 RLS), `HOLD-AT-CUTOVER` (Child-3 connector token transfer + webhook re-register + legacy plaintext-DELETE), `HOLD-AT-LIVE-RECON` (Child-2), `HOLD-AT-READ-FLIP` (Child-4 prod CH read flip). All await Founder Stage-8 ceremonies + the custody decision.

**Sweep notes:** `active.json` backed up at `state/active.json.bak.20260526T*.json`. Per-item updates carry `merged_at`, `merged_via_pr`, `merged_via_branch`, and `hygiene_sweep_note` fields. No historical text below was rewritten.

---

- **🚨 ESCALATION (Rohan, CTO Advisor) — FIRED at synthesis 2026-05-24T20:30:00Z — `feat-connector-framework-cutover` (Child 3): credential-custody decision required BEFORE Stage-3 build authorization.** This upgrades the Child-3 intake heads-up below from *armed* to *fired*. The compliance persona confirmed with code what I flagged at intake: **Brain has no Secrets Manager and the Supabase DB is the de-facto plaintext credential vault** (`ShiprocketConnection.email/password` schema:498-500; `KlaviyoConnection.apiKey` :559; `meta_ads_connections.access_token` :763; `google_ads_connections.refresh_token` :699). The architecture's R-CRED-01 names "Brain secrets manager" as the rotation destination — it **does not exist** (you deferred it to inactive WS-1). There is **no lawful long-term interim** — only a Founder-ratifiable bounded one. This is the same rubric class as the Child-1 DPDP escalation (a missing instrument only you can produce/decide), so I fire it now, Child-1-style.
  - **Why now, not Stage 7:** the Stage-2/3 cutover runbook (3b) cannot name a truthful custody mechanism until you decide. Writing "rotate into Brain Secrets Manager" for a system that does not exist is a compliance fiction. Firing now lets you decide in parallel with Aryan's Stage-2 design (no live data, no creds touched). **Stage 2 PROCEEDS; Stage 3 build is GATED on this decision.**
  - **Founder ask — choose ONE (a 2-sentence decision):**
    - **Option A (preferred):** Activate `chore-security-governance-hardening-phase` WS-1 now (or alongside Child-3 build) — provision AWS Secrets Manager (ap-south-1), rotate the connector OAuth tokens / API keys into it, ingest-service reads via IAM-scoped `GetSecretValue` (no plaintext in DB columns post-rotation).
    - **Option B (interim, Sugandh-Lok-only):** Ratify in writing (in the run folder) that for the initial Sugandh Lok cutover the legacy Supabase DB column IS the interim credential store (read over an RLS-session-scoped Postgres connection), AND (i) confirm Supabase ap-south-1 AES-256 at-rest encryption is active, AND (ii) commit that WS-1 activates **before any second workspace's credentials are stored** this way. Delete-at-cutover under B = encrypting the credential column.
    - **Plus:** the **app-level Shopify HMAC secret** (`SHOPIFY_CLIENT_SECRET`, the Partner-app secret, NOT a per-brand OAuth token) must be held by Brain to verify Shopify webhooks; it is not covered by per-brand rotation and needs its own custody line under whichever option you choose.
  - **Effect:** `build_gated_on` = CF-C3-SECRETS-INTERIM-1 (your Option A or B on record before Stage-3 build authorization).
  - **What re-arms:** CF-SEC-3 re-fires before any **non-Sugandh-Lok** brand's PII enters prod (mechanized by a startup `ALLOWED_WORKSPACE_IDS` check). CF-C3-RESIDENCY-ASSERT-1 `/escalate` re-fires only if the ap-south-1 startup assertion fails at execution.
  - **Artifacts:** `.engineering-os/runs/2026-05-24T19-30-00Z__c7fed9__feat-connector-framework-cutover__rishabhporwal/05-stage1-synthesis.md` §5 (the exact ask) + `04-persona-india-connector-pii-secrets-compliance-officer.md` Concern 1.
  - **⬆️ ADDENDUM (Rohan) — FIRED 2026-05-25T08:15:00Z at Child-7 (`feat-legacy-decommission`) synthesis: your A/B *decision* is necessary but NOT sufficient for the irreversible plaintext-DELETE.** The Child-7 decommission persona checked the code: the custody `seal()`/`get()`/`put()` are `NotImplementedError` **stubs in BOTH backings** (`aws_secrets_manager_custody.py` + `supabase_column_custody.py`), and Child-3's Stage-6 review deferred Option A/B "as a config swap" — but **you cannot config-swap between two stubs.** Worse: a Child-3 Stage-8 live-auth-test (STEP 2) can PASS by reading the credential **directly from the legacy Postgres column**, bypassing Brain custody entirely — and then the legacy plaintext gets DELETED on the strength of a test that never exercised the custody path. For **Shiprocket (no historical replay)** that is the single most irreversible step in the whole 7-child program: a dead connector, no recovery.
    - **Founder ask (addendum):** before the Stage-8 plaintext-DELETE may execute, confirm the chosen option's `seal()`/`get()` is a **REAL implementation (non-`NotImplementedError`)** — i.e. either **(A)** AWS Secrets Manager (ap-south-1) provisioned + `aws_secrets_manager_custody.{put,get,seal}` real; OR **(B)** `supabase_column_custody.{put,get,seal}` a real encrypt-in-place impl (Sugandh-Lok-only, ap-south-1 AES-256 at-rest confirmed). The decommission runbook will write the per-connector delete PoNR with this as a hard signed precondition (**CF-C7-CUSTODY-PROOF-1**): real `seal()` confirmed + a Brain call **via the production custody path** (not a direct DB read) returns vendor 200 + parity GREEN → THEN delete, Shiprocket last.
    - **Why now:** under the autonomous-run "Founder checks at the end" directive, a silent dependency on a non-existent custody instrument is most dangerous — the runbook would otherwise write "verify custody, then delete" as if a custody path exists. **No decision is needed to WRITE the runbook (Stage 2 proceeds); this gate must be satisfied before the Stage-8 DELETE is EXECUTED.** Stage-8 plaintext-delete `build_gated_on` = CF-C7-CUSTODY-PROOF-1.
    - **Artifacts:** `.engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal/05-stage1-synthesis.md` §3 + `03-persona-dpdp-decommission-safety-realist.md` Concern 1 (C7-D-001).

- **ℹ️ ARMED TRIPWIRE (Rohan, non-blocking) — Child-7 `feat-legacy-decommission` DPDP §12 archive-format tripwire is now CONCRETE (armed at intake, sharpened at synthesis).** No action today. The Child-7 persona (C7-D-002) made the intake tripwire concrete: a **flat `pg_dump` archive of the retired legacy DB is NOT DPDP §12 erasure-scopable** (you cannot run a per-data-principal scoped `DELETE` against a `.sql` file without a full restore — and the canon erasure mechanism is PG-tombstone + plaintext-hard-delete → ClickHouse `ALTER…DELETE WHERE workspace_id=? AND customer_id=?` → S3 purge → consent `withdrawn`, audit entry retained). **CF-C7-DPDP-ERASURE-1** requires Aryan to name a §12-satisfying format at Stage 2 — either (a) the DB stays **live-read-only in ap-south-1 until the retention window expires** then is wholesale-deleted, OR (b) a **per-workspace-partitioned** erasure-capable format (e.g. S3 Parquet by `workspace_id`, erasure = `DeleteObject` on the partition). The tripwire **`/escalate` FIRES at Stage 2 iff Aryan cannot name any §12-satisfying format without re-architecting the archive** (a genuine retention-vs-erasure trade-off only you can weigh). Logged so it can't be silently resolved inside the runbook. NB: "archive" (app shutdown) and "decommission" (archive deletion at retention-expiry) are **two separate dates**, potentially months apart. **Artifact:** `…/feat-legacy-decommission/05-stage1-synthesis.md` §3 + `03-persona-dpdp-decommission-safety-realist.md` Concern 2.

- **🚨 OPEN P0 — live DB has NO tenant isolation; Child 1's only fix was UNTRACKED by Founder directive 2026-05-24.**
  - **What happened:** `feat-tenancy-auth-rls-hardening` (Child 1) implemented RLS + session-context + cron-scoping **inside the legacy Express/Prisma backend** (22 files, force-added past `.gitignore`). Founder directed that the legacy codebase is **reference-only** and must not be part of the active architecture path. Per Founder decision, all 22 files were **`git rm --cached`** (untracked, still on disk as gitignored reference) — forward commit, no history rewrite. Commit `2580ba5` remains in history.
  - **The risk this leaves OPEN:** the live shared Supabase Postgres (`ap-south-1`) still has **45 models / 66 `workspaceId` refs / 0 RLS** — i.e., **no row-level cross-tenant isolation in production today**. The reviewed, gate-passed fix is now out of the tracked tree and was never deployed (it was at Stage 8 awaiting commit). The leak window stays open until a **Brain-native** RLS implementation is built and shipped. Founder accepted this interim exposure with the tradeoff stated.
  - **What's needed next (Founder to direct):** re-scope the tenant-isolation work as **Brain-native** (new migration package / Brain service that owns the shared DB's RLS), since legacy Prisma can no longer be the vehicle. The legacy app still runs live against that DB, so the rebuild must address how the live app behaves once RLS goes live (shim, or sequence legacy retirement first). Suggested: `/requirement` a Brain-native "tenant-isolation-rls (Brain-native rebuild)" slice; Rohan to formally amend the Child 0 strangler-fig plan to reflect "no new implementation in legacy."
  - **Reference preserved:** the untracked RLS design (fail-closed policy shapes, FK-scope classification, rollout runbook, cron scoping) survives on disk under `legacy project/backend/` as migration reference — migrate the *logic*, not the code.
- **ℹ️ HEADS-UP (Rohan, non-blocking) — Child-0 binding gate amendment incoming at Stage 2 for `feat-tenancy-rls-brain-native`.** No action required now; flagged for visibility because it touches a Founder-approved binding artifact.
  - **What:** The Brain-native Child-1 rebuild delivers RLS migrations + session-context primitive + probe + runbook as Brain code but **defers the live FORCE flip to Stage 8** (per the requirement's own non-goal + because there is no Brain runtime yet to hold `app.workspace_id`, and a fail-closed FORCE without a context-aware consumer = 0-rows outage, not a leak). The binding Child-0 architecture `06-architecture-plan.md` §A2.2 currently states the Child-1 exit criterion as "RLS **live** + verified" and Child-2's entry as "RLS **live**" — machine-checkable. So at Stage 2, Aryan (architect) will produce a **decision-logged amendment** to §A2.2 changing this to "RLS satisfiable Brain-native + FORCE deferred per a named **HOLD-AT-FORCE** state," reflected in `state/active.json`, so Child-2's dependency check reads the real (not a ghost) criterion.
  - **Why visibility, not approval:** this formalizes the *exact* discipline you already ratified on the sibling slice — your Stage-7 directive on `feat-tenancy-auth-rls-hardening` was literally "advance to Stage 8 but **HOLD at STEP-5 FORCE**" (decision-log 2026-05-24T09:25:28Z). The amendment is an architecture-governance act Aryan owns at Stage 2 and Rohan signs at Stage 6. **Object only if you do NOT want the binding gate softened from "live" to "satisfiable + deferred"** — otherwise no action needed; the pipeline proceeds.
  - **Artifact:** `.engineering-os/runs/2026-05-24T09-57-25Z__245326__feat-tenancy-rls-brain-native__rishabhporwal/05-stage1-synthesis.md` (§4 escalation, §5 obligations). The amendment itself lands in the Stage-2 plan.
- **ℹ️ HEADS-UP (Rohan, non-blocking) — Child-3 `feat-connector-framework-cutover` intake ADVANCED; two armed gates to watch.** ⬆️ **UPDATE 2026-05-24T20:30:00Z: gate (1) below has FIRED at synthesis — see the 🚨 FIRED escalation at the top of this file (Option A/B custody decision now gates Stage-3 build). Gates (2) and (3) remain armed-not-fired.** No action required now; flagged because both could become a Stage-3 build blocker if they fire at synthesis.
  - **(1) 🔐 Secrets Manager does not exist — the requirement's "Brain Secrets Manager available" dependency is FALSE.** I verified: zero secrets-manager/vault/KMS primitive anywhere in Brain (`apps/`/`packages/`/`pylibs/` grep CLEAN). You DEFERRED Secrets Manager + credential rotation to the inactive `chore-security-governance-hardening-phase` WS-1 (see the struck-through credential item below). The connector framework must read OAuth tokens / API keys from *somewhere*, and the architecture's R-CRED-01 mandates "rotate into Brain Secrets Manager + delete legacy plaintext at cutover." I have ARMED a `/escalate`: it fires at synthesis IF the compliance persona confirms there is no lawful *interim* custody (e.g. read legacy plaintext as reference-only during pre-cutover shadow, with rotation deferred to the Stage-8 cutover ceremony). **You may want to decide proactively: activate WS-1 now, OR ratify an interim cred-custody approach for Child 3.**
  - **(2) 👤 CF-SEC-3 PII-at-ingest re-arms before ANY third-party-brand PII enters prod.** Child 3 is where customer PII (`ShopifyCustomer` email/name, `WoocommerceOrder` billing/shipping, `ShiprocketShipment` pincode) actively flows INTO Brain. It is satisfied for Sugandh Lok (your own brand) — but the framework is brand-agnostic, so the moment a non-Sugandh-Lok brand's connector cuts over, the gate re-fires (DPA/§7 instrument needed). Confirms the residual tripwire you set on Child 1.
  - **(3) Named hold state HOLD-AT-CUTOVER:** the live per-connector token transfer + webhook re-registration + legacy-plaintext-delete is the irreversible step (Shiprocket has NO replay). I've kept it OUT of the normal pipeline run — it executes at Stage-8, one connector at a time, lowest-risk first, with you at the console and the A4 rollback tree armed (mirrors Child-1 HOLD-AT-FORCE / Child-2 HOLD-AT-LIVE-RECON). **Object only if you do NOT want the live cutover gated behind an explicit Stage-8 ceremony** — otherwise no action needed.
  - **Unlocks:** Child-3's residual-writer conversion (3c) is the precondition that lets Child-1's FORCE ceremony eventually run.
  - **Artifact:** `.engineering-os/runs/2026-05-24T19-30-00Z__c7fed9__feat-connector-framework-cutover__rishabhporwal/02-cto-advisor-review.md` (escalation + binding constraints). Personas + synthesis next; the pipeline proceeds.
- ~~**spike-legacy-migration-architecture — Stage 6 PASS (Rohan). APPROVE recommended.**~~ **✅ APPROVED by Founder 2026-05-24T01:40:00Z.** Architecture accepted as BINDING for the 7-child epic; Child 1 greenlit. Decision: `.../12-founder-decision.json`. Stage 8 (no-op readiness analogue) ran via Jatin.
  - ~~**Armed residency tripwire — GATE-ZERO.**~~ **✅ RESOLVED 2026-05-24T01:40:00Z — Founder confirmed legacy Supabase/Postgres is in `ap-south-1`** (`DATABASE_URL` host `aws-1-ap-south-1.pooler.supabase.com`, project ref `pavcgecgciamejdcysjx`). No DPDP §16 cross-border-transfer escalation. Child-1 gate-zero now runs as a confirmation step, not a blocker. (CF-RES-1 still binds Child 1 to assert region before RLS DDL.)
  - ~~**🔐 rotate exposed credentials.**~~ **↪ DEFERRED by Founder to the post-migration phase** (tracked: `chore-security-governance-hardening-phase` WS-1). Credentials are dev-only, NOT committed, `.env`/`**/.env` now gitignored. Founder will rotate + move to Secrets Manager when WS-1 activates. Standing guardrail stays: never commit/log secrets.
- ~~**🚨 ESCALATION (Rohan) — Child 1 DPDP lawful-basis instrument required BEFORE Stage-3 build.**~~ **✅ RESOLVED by Founder decision 2026-05-24:** Founder is the **legal owner/controller of Sugandh Lok** (the only in-scope brand), authorized proceeding on his own brand's data, and **deferred formal governance** (DPAs, §7 memo, credential rotation, data-governance) to the dedicated backlog epic `chore-security-governance-hardening-phase`. Gate `CF-SEC-3.HARD` satisfied for Child 1. Recorded: `…/feat-tenancy-auth-rls-hardening/dpdp-lawful-basis-memo-DRAFT.md` §8. **Residual tripwire:** re-arms before ANY third-party brand's PII is processed in production. (Original escalation detail retained below for the record.)
- **🚨 (RESOLVED — see above) ESCALATION (Rohan, CTO Advisor) — `feat-tenancy-auth-rls-hardening` (Child 1) — DPDP lawful-basis instrument required BEFORE Stage-3 build.**
  - **What:** Child 1 is the first slice that writes real code against the **live** Supabase Postgres. Its CF-SEC-1 RLS probe will `SELECT` `Invitation.email`, and any `workspace_id`-denormalization backfill will read every `ShopifyCustomer` PII row (`email`/`firstName`/`lastName`). Both are **DPDP §4 processing acts performed by Brain**. There is **no DPA, no §7 continuity memo, and no consent/purpose columns anywhere** on record — so at Stage-3 build time Brain would process brand-customer PII with no documented lawful basis.
  - **Why I escalate NOW (not at the Stage-7 gate):** unlike the residency tripwire (an unknown fact the spike resolved), this is a **legal instrument that does not exist and only you can produce/decide**. It **gates Stage-3 build authorization**. Escalating now lets you draft/sign it in parallel with Aryan's Stage-2 design (which touches no live data), so it is ready before the first DDL/probe runs. Deferring risks building against live-PII reads before a lawful basis exists — exactly what DPDP §8(6) penalizes (up to ₹200 cr/incident).
  - **Founder ask — produce or confirm ONE of:**
    - (a) an executed **DPA / brand-contract processor clause** covering Brain's processor role + migration-time processing, with at least the anchor customer **Sugandh Lok**; OR
    - (b) a **Founder-signed DPDP §7 legitimate-use continuity memo** attesting that RLS-policy application + CF-SEC-1 probe queries + any `workspace_id` denormalization backfill fall within the original purpose the data was provided for. Must explicitly name **`Invitation.email`, `ShopifyCustomer` PII, `User`**.
  - **Effect:** `build_gated_on` = this instrument. **Stage 2 (architecture) proceeds now**; **Stage 3 (build) cannot start until the instrument is on record.** Synthesis: `.../05-stage1-synthesis.md` §3. Supporting persona: `.../04-persona-india-data-isolation-compliance-officer.md` Concern 2.
  - **Note (not part of this escalation):** CF-RES-1 remains an armed in-pipeline tripwire — Child 1's deploy asserts `ap-south-1` at the **Postgres level on BOTH `DATABASE_URL` :6543 AND `DIRECT_URL` :5432**; `/escalate` re-fires only if that assertion fails at execution.
- **chore-scaffold-monorepo — Stage 6 PASS (Rohan, CTO Advisor). APPROVE recommended.** Review the diff and commit. Final review: `.engineering-os/runs/2026-05-23T23-11-01Z__c4f3f4__chore-scaffold-monorepo__rishabhporwal/10-cto-final-review.md`. Mechanical commit command (105 product files already staged): `.engineering-os/runs/2026-05-23T23-11-01Z__c4f3f4__chore-scaffold-monorepo__rishabhporwal/pending-founder-commit.md`. Act with `/approve chore-scaffold-monorepo` (then commit per the commit artifact) or `/reject chore-scaffold-monorepo <reason>`. Note: per the standing no-commit rule, the pipeline stopped here — agents staged, you commit.

---

- **✅ feat-connector-framework-cutover (Child 3) — Stage 6 PASS (Rohan). APPROVE signed under standing delegation.** Highest-risk child of the legacy→Brain migration: the connector framework, built Brain-native + LOCAL-verified, ZERO live flip (HOLD-AT-CUTOVER). Round 1 bounced on a real bug class (unwired integrated seams + tautological test doubles — the PII gate could never fire); Vikram rewired all four gates + replaced doubles with real-path tests; Shreya (09b) + Tanvi (10b) both re-verified PASS, and I independently re-ran the load-bearing gates with captured output and reproduced every PASS.
  - **Commit:** per the no-commit autonomous-run policy the code is **staged but not committed** — you commit. Mechanical command (45 product files, explicit paths, no `git add -A`): `.engineering-os/runs/2026-05-24T19-30-00Z__c7fed9__feat-connector-framework-cutover__rishabhporwal/pending-founder-commit.md`. Authorize with free-text **"commit it"** (harness guard).
  - **What stays HELD for your Stage-8 ceremony:** live per-connector token transfer + webhook re-registration, legacy-plaintext delete/seal (after write→auth-test→parity), the **credential-custody Option A/B decision (CF-C3-SECRETS-INTERIM-1)** — config swap, both backings stubbed, escalation deferred to Stage-8 — real-pooler IT (STEP 0.5)/live vendor auth (STEP 2)/live count-parity (STEP 5), MSK/Glue/deploy pipeline, live RLS DDL, N1 entrypoint frozenset wiring, and **CF-C3-FORCE-UNLOCK-SCOPE-1** (Child-1 FORCE stays HELD until Shiprocket DECOMMISSION + bare-write grep ZERO + sign-off).
  - **Artifacts:** final review `…/11-final-review.md`; retro `…/14-retro.md`; delegated decision `…/12-founder-decision.json`. **Next:** Stage-8 readiness (Jatin) — readiness-only, no live deploy.

---

- **✅ feat-metric-engine-olap-split (Child 4) — Stage 6 PASS (Rohan). APPROVE-WITH-CAVEATS signed under standing delegation.** The Brain-native metric engine: TS↔Python byte-identity registry + canonical CM/revenue/marketing/RTO ladder + runbook-gated ClickHouse MVs + fail-closed workspace-scoped query-gateway + the 9-field Definitional-Delta Register. Round 1 bounced on a real money/governance HIGH (the 4 Brain-native decision metrics — True-CM2, paMER, aMER, LTV:CAC — had materially different formulas in TS vs Python/DDR, hidden by a vacuous registry-parity gate); the team reconciled them to ONE canonical formula across TS == Python == DDR and rebuilt the gate non-vacuous. I independently re-verified: parity gate exit 0; 434 tests pass; **I mutated the real `definitions.ts` on disk twice (id-rename + re-introducing the original H-1 SQL) and the gate went RED both times, GREEN on revert** — the crux is genuinely closed.
  - **DDR sign-off (the headline governance gate — my authority):** **9 of 11 rows SIGNED** (`cm2_mu`, `misc_expenses_prorated_mu`, `cogs_mu`, `true_cm2_mu`/`pamer_bp`/`amer_bp`/`ltv_cac_bp` as correctness-fixtures with no-legacy-shadow acknowledged, `blended_roas_x100`/`acos_bp` display-only). **2 rows UNSIGNED-PENDING-child-dependency:** `total_tax_mu` (unlocks when `child-3-shopify-connector` is GREEN — per-SKU GST tax) and `fx_restatement` (unlocks when `child-3-workspace-cost-currency-migration` is GREEN — live FX). The structural Rule-2 block is working as designed; I re-sign these at the Stage-8 live-flip re-review.
  - **True-CM2 RTO-provision formula recorded as Phase-0 proxy canon** (cost-base-per-order): `true_cm2_mu = cm2_mu − intDiv(rto_orders × (ad_spend + variable + cogs), total_orders)`. **Caveat for your awareness:** this is a defensible Phase-0 proxy; the business canon defines RTO cost more granularly (forward+reverse+restock+write-down + refund/payment-failure). The `formula_snapshot` immutability pins exactly the proxy form; refine in a later child.
  - **Commit:** per the no-commit policy the code is **staged but not committed** — you commit. Mechanical command (explicit Child-4 paths, **no `git add -A`** — Child-3 files are co-staged and must NOT be bundled): `.engineering-os/runs/2026-05-24T22-25-29Z__0e76f7__feat-metric-engine-olap-split__rishabhporwal/pending-founder-commit.md`. Authorize with free-text **"commit it"** (harness guard).
  - **What stays HELD for Stage-8:** apply the ClickHouse DDL (runbook); provision ClickHouse Cloud **ap-south-1** + the analytics-service Postgres **read-only role**; arm `CACHE-PURGE-C4C5`; the live read-source flip additionally requires parity GREEN on **Brain-Child-3-sourced** data (legacy-sourced GREEN is NOT a cutover license) + the 2 pending DDR rows signed + my re-sign. Zero live DDL / read-flip / legacy edit this child.
  - **Artifacts:** final review `…/11-final-review.md`; retro `…/14-retro.md`; delegated decision `…/12-founder-decision.json`; signed register `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.md`. **Next:** Stage-8 readiness (Jatin) — readiness-only, no live deploy.
- **📋 CANDIDATE RULE from a recurring pattern — review with `/adopt-rule 2026-05-25__verify-the-verifier-mutation-on-gate` or `/reject-rule 2026-05-25__verify-the-verifier-mutation-on-gate <reason>`.** ⬆️ **UPDATE 2026-05-25 (Child-4 Stage-6): now 5 occurrences across 4 consecutive high-stakes children — and the 5th MATERIALIZED IN-CHILD, the strongest evidence yet.** The "structurally-inert verification / tautological gate double / false-GREEN at the gate" root cause: Child-1 RLS probe `return 0`; Child-2 RMM tautology; Child-3 PII-gate double + HMAC hexdigest self-verify; Child-4 caught PRE-EMPTIVELY at Stage-1 (#4); **and Child-4 round-1 build MATERIALIZED it (#5) — despite the per-child CF `CF-C4-VERIFY-THE-VERIFIER-1` being bound at Stage 1, a vacuous registry-parity gate (directory-presence only) still shipped to review and let 4 decision metrics carry divergent formulas past every gate; round-1 QA even PASSED on the same defect Security bounced.** This is decisive: **a per-child binding CF is NOT sufficient — the failure recurs even when the team knows to look for it, because the vacuous gate looks green.** Only a standing, mechanically-enforced rule closes it (real-path entrypoint + negative control + killed mutant, captured Stage-3 AND re-verified Stage-5). **I have NOT adopted it** — a proposal becomes a durable rule only when you run `/adopt-rule`. Proposal (now with evidence #5): `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md`.
- **ℹ️ HEADS-UP (Rohan, non-blocking) — Child-4 `feat-metric-engine-olap-split` Stage-1 synthesis COMPLETE → advancing to Stage 2 (Aryan + Maya co-own).** Both personas PASS; 10 grounded concerns folded into the binding CF-C4-* contract (1 CRITICAL + 6 HIGH + 3 MEDIUM). No `/escalate` (both personas NO-escalate; all resolve at Stage 2). No action required now; flagged for visibility on three substantive intake outcomes:
  - **(1) A CRITICAL that gates the MV DDL pass:** ClickHouse's `/` operator returns Float64 on integer operands (not integer FLOOR) — every ratio MV expression in the M-A1-1 draft is wrong-by-default. `CF-C4-RATIO-DIVOP-1` (`intDiv` + null-guard everywhere + ClickHouse round-trip fixtures) **must be bound before any MV DDL is written.** This is design-stage correctness, fully resolvable by Aryan+Maya at Stage 2 — not a blocker on you.
  - **(2) The Definitional-Delta Register you will sign at Stage 6 expanded 6→9 fields** (`parity_gap`, `child_dependency`, `formula_snapshot`). Effect: a Brain-native metric with no legacy comparand (True-CM2) can **never** be silently skipped by the shadow-compare, and a row whose delta can't be measured until Child-3 cuts over (`total_tax_mu`, the FX re-statement) can **never** be signed prematurely. This strengthens the artifact's integrity before it reaches your delegated gate.
  - **(3) `HOLD-AT-READ-FLIP` confirmed:** this child builds the registry + ClickHouse MVs + query-gateway + shadow-compare + Register Brain-native/shadow-verified; the live read-source flip is HELD to a Stage-8 ownership gate (gated on parity GREEN + your-delegated Register sign-off + CACHE-PURGE-C4C5 armed). Zero live flip / zero live DDL on the legacy rollup this child. Mirrors Child-1 HOLD-AT-FORCE / Child-2 HOLD-AT-LIVE-RECON / Child-3 HOLD-AT-CUTOVER.
  - **Artifact:** `.engineering-os/runs/2026-05-24T22-25-29Z__0e76f7__feat-metric-engine-olap-split__rishabhporwal/05-stage1-synthesis.md`. The pipeline proceeds to Stage 2.

---

## 2026-05-25 — Rohan (cto-advisor) — feat-ai-engine-intelligence (Child 5) — INFORMATIONAL heads-up (NO action requested now)

**Subject:** Armed-not-fired residency tripwire on the AI-engine frontier-model choice.

**Context:** Child-5 Stage-1 intake ADVANCED (high-stakes; MIXED paradigm; recommendation-only/HELD live flip). I ruled NO `/escalate` at intake — India-resident inference is a one-line gateway startup-gate (CF-C5-RESIDENCY-1) and Claude-API data-handling is a bounded build-time routing choice, not a canon ambiguity, and (unlike Child-1/Child-3) needs no Founder-only legal instrument.

**The one armed unknown (a Founder-priced trade-off, decided at Stage 2 not now):** if Aryan/Maya find that the frontier model which passes the eval bar for the chat / global / Morning-Brief-synthesis surface has **NO India-resident inference option** — i.e. the only quality-passing path would route PII out of `ap-south-1` — that becomes a genuine DPDP §16 cross-border question weighing model quality vs data residency. **`/escalate` is ARMED to fire then** (mirrors the Child-0 residency tripwire). No decision is needed from you today; this is logged so the trade-off cannot be silently resolved inside an engineering plan.

**Where it lives:** `02-cto-advisor-review.md` §Escalation ruling + CF-C5-RESIDENCY-1; run folder `.engineering-os/runs/2026-05-24T23-55-52Z__c88096__feat-ai-engine-intelligence__rishabhporwal`.

---

## 2026-05-25 — Rohan (cto-advisor) — feat-ai-engine-intelligence (Child 5) — STAGE 6 PASS (delegated gate SIGNED; you commit)

- **✅ feat-ai-engine-intelligence (Child 5, 5a vertical slice) — Stage 6 PASS (Rohan). APPROVE-WITH-CAVEATS signed under standing delegation. Round 2 (Security + QA both PASS after a round-1 bounce).** This is the AI engine's first proven vertical slice: the LiteLLM gateway + the executable `@paradigm` cost-routing decorator + per-workspace budgets + semantic/filtersHash cache + Decision-Log middleware + ONE read-only P&L insight agent end-to-end + Memory pgvector (k≥5 anonymized cohorts) + the eval harness (faithfulness/groundedness) + the 6-layer prompt-injection defense. Recommendation-only, HOLD-AT-SERVE. **It is also the child where we finally beat — structurally, before review — the "fake test" failure that snuck past Children 1-4.**
  - **The 5 enforcement gates are REAL code, not docstrings:** @paradigm routing, faithfulness (LLMs can't invent a number), the Iron-Law executor (untrusted text can't set a money magnitude), graduation (no write tool auto-fires), tool-scope. Each carries a killed-mutant AND an inverse-mutant. **I independently mutated two of them on disk myself** — no-op'd the paradigm gate (5 tests went RED) and weakened the executor schema so an injected ₹9,999,999 magnitude sticks (2 tests went RED) — both reverted clean. A fake gate stays green under mutation; these did not.
  - **Round-1 bounce (now resolved + I re-verified in code):** Memory cross-brand "k≥5" was a `LIMIT` not real k-anonymity and leaked brand identity (CRITICAL); the spotlight detected `</data>` breakouts but never acted on the flag (HIGH); the Decision-Log had no request/trace/user correlation (HIGH, traceability). All three fixed structurally; I confirmed the deltas (anonymized cohort table with a storage CHECK k≥5, sentinel-escaping + fail-closed `flagged`, the correlation quad end-to-end).
  - **Cost routing is exactly right (my Stage-6 duty):** deterministic SQL/ML signals make ZERO LLM calls (structurally enforced — Tier-A can't reach the gateway); only narration hits the model; LLMs never produce a number. Per-brand ≈ **₹440/mo** at Sugandh-Lok volume; breakeven GMV ≈ **₹88,000/mo @ 0.5%** — the %-of-GMV model holds.
  - **Nothing goes live:** no serving flip, `CACHE-PURGE-C4C5` armed-not-fired, recommendation-only until graduated, legacy untouched (zero direct Anthropic SDK — gateway only). The chat agent, the 07:15 Morning-Brief fan-out, and the full agent roster (AICMO/AICOO/AICFO + AI CX) are deliberately the NEXT slice (5b).
  - **500 tests, 0 failures** — I re-ran all four suites myself (14 brain_cost_router + 154 intelligence-service + 291 brain_metrics + 41 analytics baselines).
  - **⚠️ Commit manifest has two corrections (in the commit doc):** (1) several load-bearing Track-M source/test files are currently **untracked** and must be staged or the committed code won't import; (2) a **duplicate divergent migration** (`src/infrastructure/db/migrations/`) must be EXCLUDED (the canonical one is `migrations/postgres/`). Per the no-commit policy the code is **staged-but-not-committed — you commit.** Mechanical command (explicit Child-5 paths, **no `git add -A`** — Child-3/4 co-staged): `.engineering-os/runs/2026-05-24T23-55-52Z__c88096__feat-ai-engine-intelligence__rishabhporwal/pending-founder-commit.md`. Authorize with free-text **"commit it"** (harness guard).
  - **What stays HELD for Stage-8:** the live serving flip; `CACHE-PURGE-C4C5` firing (post-purge count must=0); per-agent graduation; real DB readers wired (graduation/cap/daily-aggregate, currently fail-closed `NotImplementedError`) + the residency assertion at the live entrypoint; the **5b roster** (chat + Morning-Brief Pattern-B + remaining ~12 page agents + AICMO/AICOO/AICFO + AI CX); the **5b India-resident frontier-model tripwire** (the armed `/escalate` above); and the Gate-2 faithfulness unit-binding (C5-SEC-004) before any agent's action path graduates.
  - **Artifacts:** final review `…/11-final-review.md`; retro `…/14-retro.md`; delegated decision `…/12-founder-decision.json`; commit doc `…/pending-founder-commit.md`. **Next:** Stage-8 readiness (Jatin) — readiness-only, no live deploy, no commit until you authorize.
- **📋 CANDIDATE RULE update — `verify-the-verifier-mutation-on-gate` now has evidence #6 (Child-5), the strongest yet.** Child-5 is the FIRST child where the failure class was beaten *structurally before review* (5 gates bound real with killed+inverse mutants at Stage-1 + re-mutated by me at Stage-6) — but the round-1 bounce showed the failure migrated to the *un-bound supporting controls* (Memory/spotlight/traceability), sharpening the rule to "every security control, not only the named gates." **I have NOT adopted it** — review with `/adopt-rule 2026-05-25__verify-the-verifier-mutation-on-gate` or `/reject-rule 2026-05-25__verify-the-verifier-mutation-on-gate <reason>`. Proposal: `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md`.

---

## 2026-05-25 — Rohan (cto-advisor) — feat-frontend-dashboard-morningbrief (Child 6) — STAGE 6 PASS (delegated gate SIGNED; you commit)

- **✅ feat-frontend-dashboard-morningbrief (Child 6, 6a runnable vertical) — Stage 6 PASS (Rohan). APPROVE-WITH-CAVEATS, Founder gate signed under standing delegation. Round 2 (Security + QA both PASS after a round-1 bounce).** This is the child that makes Brain **visible** — the one you can launch and SEE.
  - **I booted it myself.** `apps/api-gateway/src/interfaces/server.ts` on a fresh port: `/health` → ok; `metrics.kpiSummary` → **net_revenue ₹18.5L · cm2 ₹3.2L · ROAS 2.85× · 1,247 orders**, money on the wire as superjson **bigint**, a **live per-request request_id UUID**. Launch: terminal 1 `cd apps/api-gateway && pnpm dev`; terminal 2 `cd apps/web && echo "NEXT_PUBLIC_BRAIN_LOCAL_HARNESS=true" > .env.local && pnpm dev`; open `http://localhost:3000/login` (founder@sugandhlok.com / brain-local-dev). Every number flows from the registry-backed data path — **none is typed into the UI**.
  - **The 3 integrity gates are REAL — I broke each one myself:** removed superjson → the live HTTP wire contract breaks RED; disabled the registry-traceability throw → orphan-field test RED; disabled the idempotency dedup → a duplicate approve writes a 2nd Decision-Log row RED. All reverted clean. The UI cannot corrupt a number (render-only, bigint to the edge, formatMoney the sole transform), cannot leak across tenants (workspace==claim choke point + role gates), and a double-tap can't double-write the append-only log.
  - **Round-1 bounce (now resolved, re-verified):** SEC H1 (the error "Request ID" was showing the procedure name, not the correlation id) + QA B1 (the BFF had a `dev` script but no `server.ts` — `pnpm dev` couldn't boot, so the app wasn't runnable) + QA B2 (a web TypeScript compile error). All fixed; I re-ran 543 tests (0 failures), tsc exit 0, and the Child-4 parity gate exit 0.
  - **Everything stays HELD — nothing goes live:** behind `CF-C6-HOLD-AT-ROUTE-FLIP` (LOCAL-only, single Sugandh-Lok workspace, seeded data, zero live operator cutover). The dev-only header-trust login is acceptable ONLY because the HOLD is binding; production JWT-verify is the documented cutover requirement.
  - **⚠️ Two small commit corrections (in the commit doc):** a stray `definitions.ts.bak3` and a stray `apps/web/package-lock.json` (npm lockfile in a pnpm repo) are staged and must be **excluded**. Per the no-commit policy the code is **staged-but-not-committed — you commit.** Mechanical command (explicit Child-6 paths, **no `git add -A`** — Child-3/4/5 co-staged on the branch): `.engineering-os/runs/2026-05-25T05-09-29Z__e257dd__feat-frontend-dashboard-morningbrief__rishabhporwal/pending-founder-commit.md`. Authorize with free-text **"commit it"** (harness guard).
  - **What stays HELD for Stage-8 / the cutover:** production JWT-verify + membership lookup (kills the header-trust login); the live per-route-group operator flip; **real cert-pin hashes** (current+rotation) in the mobile build; the **notifications-service push SEND** (the 07:15 Morning-Brief dispatch SLO — a NAMED dependency, a later child, not this child); `core.device_tokens` live DDL; the M1/M2 gRPC tenancy+trace wire; Fargate/MSK/ClickHouse-Cloud provisioning; and the **6b long-tail** (~28 web route groups + mobile beyond the Morning-Brief core + i18n translations/RTL).
  - **One honest test-debt note (non-blocking):** the H1 error-path killed-mutant test asserts against a *replica*, not the live errorFormatter; the production code is correct (I confirmed by direct read + the live success-path UUID), and on the error path the correlation id is still **logged** with the real UUID — so support can trace any failure. Tracked as SEC-C6-L2. The G-BIGINT gate test similarly uses `createCaller` (which skips the serializer) — the true bigint gate is the live HTTP boot, which exists and I ran.
  - **Artifacts:** final review `…/11-final-review.md`; retro `…/14-retro.md`; delegated decision `…/12-founder-decision.json`; commit doc `…/pending-founder-commit.md`. **Next:** Stage-8 readiness (Jatin) — readiness-only, no live deploy, no commit until you authorize.
- **📋 CANDIDATE RULE — `verify-the-verifier-mutation-on-gate` now has evidence #7 (Child-6).** The 3 named gates were genuinely non-vacuous (I mutated all 3 → RED), but the failure class re-surfaced on *supporting* tests (the errorFormatter replica + the `createCaller`-skips-serializer gap) — the same migration Child-5 showed, sharpening the rule to "the killed-mutant must invoke the production path; framework-internal closures need a real-HTTP fixture, not a replica." **I have NOT adopted it** — review with `/adopt-rule 2026-05-25__verify-the-verifier-mutation-on-gate` or `/reject-rule 2026-05-25__verify-the-verifier-mutation-on-gate <reason>`. Proposal: `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md`.

---

## 2026-05-25 — Rohan (cto-advisor) — feat-legacy-decommission (Child 7, FINAL) — INFORMATIONAL heads-up (NO action requested now)

**Subject:** Two armed conditions on the final decommission child — neither needs a decision today.

**Context:** Child-7 Stage-1 intake ADVANCED (high-stakes; design/runbook-only shape — like the Child-0 spike, no app code; the deliverable is the decommission runbook + point-of-no-return ledger + final-state verification + DPDP close-out). Children 1-6 are all at Stage-8 readiness behind their named holds; this child SEQUENCES their cutovers, it does not execute them.

**Armed condition 1 — the Stage-8 execution gate (by design, not an escalation):** the actual production cutovers, the legacy plaintext-credential destruction (C8), and the legacy DB shutdown are irreversible and inherently yours. They are the **Stage-8 / Founder-at-console execution gate** — the correct ratification point. Writing the runbook needs no decision from you; executing it does. I ruled NO mid-pipeline /escalate at intake because there is no canon ambiguity (the order is DAG-forced, the DPDP archival answer is canon). The runbook will land each irreversible step behind an explicit point-of-no-return with a "Brain-custody-proven" precondition (Shiprocket last, no replay).

**Armed condition 2 — DPDP §12 erasure-scopability of the retired store (a tripwire, mirrors Child-0 residency + Child-5 frontier-model):** the legacy DB becomes a retained PII archive on retirement. The canon answer is in-region (ap-south-1) + retention-bounded + erasure-scopable per data-principal. **IF** Stage-2/6 finds the archived store is neither erasure-scopable nor provably-purgeable without re-architecting the archive, that becomes a genuine retention-vs-erasure compliance trade-off and **`/escalate` is ARMED to fire then.** No decision needed today; logged so the trade-off cannot be silently resolved inside the runbook.

**Festival-window note (Stage-8 calendar, yours + Jatin's):** the irreversible cutovers + DB shutdown must not be scheduled in a festival peak GMV window (maximum blast radius). The runbook names the constraint; you own the calendar.

**Where it lives:** `02-cto-advisor-review.md` §Escalation ruling + the 5 intake rulings; run folder `.engineering-os/runs/2026-05-25T07-12-38Z__1be105__feat-legacy-decommission__rishabhporwal`.

---
## 2026-05-25 — Candidate rule from a recurring pattern (Rohan, Stage-6, feat-store-order-fact-layer)
A 3rd occurrence of the "uncommitted working-tree state contaminates a stage's verification/commit set"
root-cause family (Child-1 + Child-2 divergent-gate-copy; Child-6 stray staged files; this slice's
pre-existing login-form.tsx `useRouter` break failing 6 login-form tests that the slice never touched).
Crosses the >=3 codification threshold. CANDIDATE rule written (NOT self-adopted):
`.engineering-os/rule-proposals/2026-05-25__pre-stage-working-tree-baseline.md`.
Review with `/adopt-rule 2026-05-25__pre-stage-working-tree-baseline` or
`/reject-rule 2026-05-25__pre-stage-working-tree-baseline <reason>`.

ALSO surfaced (not a slice blocker, your disposition):
- 6 failing `apps/web/src/test/login-form.test.tsx` tests from a pre-existing uncommitted
  `login-form.tsx` change (useRouter not wrapped in an app-router provider in the test).
- uv workspace fails to build (`brain-cost-router` missing `tool.uv.sources` entry in
  intelligence-service) — blocks `uv run` for Python tests; worked around with an ephemeral venv.

---

## 2026-05-25T14:30Z — Recurring-pattern candidate rule (8th occurrence) — feat-pnl-cm-waterfall

The "verify-the-verifier / vacuous gate" root cause recurred for the **8th time** (7th high-stakes
child of the migration epic), now in Phase-2 slice-2. The `shadow_compare` registry parity gate —
already shipped and GREEN across prior slices — was silently permitting a TS↔Python `cm1_mu` formula
divergence (TS shipped COGS-only `net_revenue − cogs`; Python honest `net_revenue − cogs − variable_costs`),
because it compares structural fields + decimal-conversion vectors, never the formula text. This was a
real, material correctness bug (CM1 overstated by the entire variable-cost line) that passed every gate.

Caught at Stage-1 by Rohan via code-read + recall of the Child-4 H-1 bounce; closed in slice-2 with a
production-path cross-language formula anchor and re-verified at Stage-6.

Evidence #8 appended to the existing proposal (NOT self-adopted):
`.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md`

**Action:** review with `/adopt-rule verify-the-verifier-mutation-on-gate` or
`/reject-rule verify-the-verifier-mutation-on-gate <reason>`. 8 occurrences strongly argue for adoption:
the gate was already green in production and hid a real bug — it was caught only because a reviewer
recalled the lineage, which is not a repeatable control.

- **📋 CANDIDATE RULE (Rohan, Stage-6, 2026-05-25) — `feat-marketing-acquisition` (Phase-2 slice 4).** Recurring root cause across ≥3 runs (slices 3 & 4 + metric-engine/pnl divergence retros): the ratified slice-table shorthand cannot be trusted as a spec, and speculative pre-builds hidden behind a parity "shadow-phase" carve diverge from legacy silently. Proposal `.engineering-os/rule-proposals/2026-05-25__verify-legacy-formula-at-stage1-not-slice-table.md` would make "read the real legacy formula at Stage 1/2 + reconcile/decommission divergent pre-builds" a mandatory gate. Review with `/brain-engineering-os:adopt-rule .engineering-os/rule-proposals/2026-05-25__verify-legacy-formula-at-stage1-not-slice-table.md` or `/reject-rule verify-legacy-formula-at-stage1-not-slice-table <reason>`.

---

## 2026-05-26T12:55:00Z — ~~🚨 ESCALATION (Rohan, CTO Advisor) — FIRED at synthesis — `feat-tenancy-rls-live-cutover`: Founder picks the path BEFORE Stage-3 build~~ ✅ **RESOLVED 2026-05-26T16:00:00Z — Founder ratified Path C with hard exit deadline = Path B completion date.** Aryan Stage-2 unblocked; STEP-3 shim shape = `ALTER ROLE … BYPASSRLS` on the one named legacy connection identity; bypass audit per CF-CUT-BYPASS-AUDIT-1 binding. Artifact: `.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/06-founder-decision-cf-cut-path-1.json`. Original escalation text preserved below for audit trail.

**Subject:** This is the slice that finally closes the OPEN P0 logged at the top of this file. Founder-priced trade-off between path choices needs ratification now so Stage-2 plan is written to ONE path; Stage 2 proceeds on the default in parallel.

**Why now, not Stage 7:** at intake the path choice was an open question; the compliance persona (`03-persona-india-data-isolation-compliance-officer.md`) confirmed that a standing Path-C bypass is NOT lawful as a permanent state under DPDP §4 — it needs an exit deadline + narrow named scope + audit + a second-brand tripwire. The strangler persona (`04-persona-live-rollout-strangler-realist.md`) confirmed Path C is operationally cleanest if reconciled with Child-3's `CF-C3-FORCE-UNLOCK-SCOPE-1`. Synthesis is the right gate per the precedent set on Child-1 (DPDP at synthesis) and Child-3 (custody Option A/B at synthesis). Deferring to Stage 7 risks Stage-2/3 rework.

**Founder ask — pick ONE (a 2-sentence decision):**

- **(A) Path C with hard exit deadline = Path B completion date** *(my recommendation, Stage-2 default)*. Closes the OPEN P0 at the storage layer for every NEW connection within one cutover window. Residual surface = ONE explicitly-named legacy connection identity, bypass usage audited per CF-CUT-BYPASS-AUDIT-1, lifetime bounded by the Founder-ratified Path-B completion date. Defensible under DPDP §7 transitional continuity for the bounded interval; consistent with the Founder's own established "merge code, HOLD irreversibles for Founder-at-console" discipline used on Children 1-7.
- **(C) Path A2 — pgbouncer custom auth.** Cleanest DPDP posture (workspace-scoped on the legacy side too, no transitional bypass). BUT real infra work (pgbouncer custom-auth hooks + JWT-to-`workspace_id` derivation at the pool layer); blast-radius dwarfs Path C's narrow bypass; weeks of new infra + risk before the OPEN P0 closes.

**Inadmissible options:**
- **Path A1** — barred by `feedback_legacy_is_reference_only.md` (requires legacy backend code edit).
- **Path B as the immediate close** — barred. §8(6) notice timeline: the OPEN P0 has been open since 2026-05-24; waiting weeks while parity ships compounds the exposure. Path B remains the right *final* close (sequenced after Path C closes the immediate leak), not the immediate close.

**Effect:** `build_gated_on` = CF-CUT-PATH-1 (Founder ratification on record before Stage-3 build authorization). **Stage 2 PROCEEDS in parallel on default (Path C with deadline)**; if Founder rules A2, Stage 2 amends with a decision-logged plan revision (the runbook outline transfers; only STEP 3's shim shape changes).

**What this also unlocks** (informational, no Founder act required today):
- **The OPEN P0** (item #3 in the hygiene sweep at the top of this file) closes once this slice's Stage 8 ceremony runs.
- **DPDP §7 continuity addendum** (CF-CUT-DPDP-ADDENDUM-1) will be drafted by Aryan at Stage 2 enumerating (i) live FORCE-flip execution, (ii) live CF-SEC-1 probe execution, (iii) creation+use of legacy bypass (Path C only), (iv) STEP-5 smoke against legacy HTTP. Founder signs before Stage-8 STEP 5. Same Founder-as-controller-of-Sugandh-Lok basis as the Child-1 memo; CF-SEC-3.HARD does NOT re-trigger.

**Artifacts:** `.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/`
- `01-requirement.md` (canonical body from the Founder draft)
- `02-cto-advisor-review.md` (intake, persona-count decision, armed escalations)
- `03-persona-india-data-isolation-compliance-officer.md` (5 concerns; recommends this escalation)
- `04-persona-live-rollout-strangler-realist.md` (7 concerns including CRITICAL O2 — STEP-5 verify-the-verifier hazard; 10th occurrence of the durable-rule class)
- `05-stage1-synthesis.md` §4 (the escalation), §6 (full CF-* contract)

**Intake branch:** `chore/intake-feat-tenancy-rls-live-cutover` (branched off `origin/development`). No commit; intake artifacts only, no code change.

---

## 2026-05-26T12:55:00Z — ℹ️ HEADS-UP (Rohan, non-blocking) — `feat-tenancy-rls-live-cutover` Stage-1 synthesis complete; durable rule's 10th occurrence pre-empted

**Subject:** The strangler persona's CRITICAL O2 finding (`STEP 5` legacy-smoke is the canonical verify-the-verifier hazard for THIS slice) is exactly the durable-rule `2026-05-26__verify-the-verifier-mutation-on-gate` target class — the rule's #10 occurrence would have landed in production if STEP 5 had shipped as a psql double of the bypass role (a fake green that authorizes the cutover-complete signal). The synthesis bound CF-CUT-VERIFY-THE-VERIFIER-1 to CRITICAL/binding with explicit kill-test pair (real legacy HTTP path + 3 captured pre-ceremony mutants on the staging clone + Stage-6 disk re-mutation per sub-rule 7).

**No action required** — this is the durable-rule working as designed (Stage-1 catch, before Stage-2 plan, before any code). Logged for visibility as additional evidence that the adopted rule is doing its job structurally.


---

## 2026-05-29T16:00:00Z — NON-BLOCKING readiness heads-up (Rohan) — feat-credential-custody-aws-sm

**This is NOT an escalation and NOT a build blocker.** Your Option-A decision (CF-C3-SECRETS-INTERIM-1, AWS
Secrets Manager ap-south-1) is on record and the build is scoped to make it real (code + CDK + mocked-boto3
tests, ZERO live AWS). Stage 1 → ADVANCE → Aryan (Stage 2).

**What you'll need lined up BEFORE the Stage-8 cutover ceremony** (HELD items — gather ahead of time, no action
needed for the build itself):
1. A real AWS account with **ap-south-1 enabled**.
2. A **customer-managed KMS CMK in ap-south-1** for envelope-encrypting the secrets (the build's CDK will
   declare it; you provision/deploy it at Stage 8).
3. The **IAM role** for the ingestion-service runtime (least-privilege policy authored by the build).
4. The **live connector credentials** (the current legacy-DB plaintext tokens) available to rotate into Secrets
   Manager during the ceremony.
5. Your **free-text "commit it"** at Stage 7 to commit the reviewed code (no commit without it).

The legacy-plaintext DELETE still stays gated on the FULL CF-C7-CUSTODY-PROOF-1 (real seal()/get() — this build —
PLUS a Brain call via the production custody path returning vendor 200 PLUS parity GREEN, signed per-connector,
Shiprocket last). This build only makes the first of those three legs real.

**Separately tracked (Rohan ruling, not built here):** the app-level Shopify HMAC secret
(`SHOPIFY_CLIENT_SECRET`) needs its own non-workspace-scoped custody line (TS webhook consumer) —
`CF-CC-SHOPIFY-HMAC-1`, recommended as a small follow-up requirement under WS-1.

---

## 2026-05-29T17:05:00Z — NON-BLOCKING readiness item (chore-app-hmac-secret-custody, Stage 1)

**Filed by:** Rohan (CTO Advisor). **Severity:** medium. **Does NOT block** Stage 2/build.

**Item — exposed Shopify HMAC secret should be rotated at the Stage-8 cutover ceremony.**
The live Shopify Partner-app secret value (`shpss_…`) currently sits in plaintext in
`apps/api-gateway/.env:27`. It is git-ignored (dev-only) but it HAS been observed in tooling
output / grounding during this intake, so treat it as **compromised-by-exposure**.

At the Stage-8 console ceremony for this feature (alongside the parent
`feat-credential-custody-aws-sm` AWS provisioning), please:
1. Set a NEW app secret in the Shopify Partner dashboard.
2. `put-secret-value` the new value into AWS Secrets Manager `brain/_app/shopify/hmac_secret` (ap-south-1).
3. Confirm the boot-time cache refresh picks it up.

Rotation for this key is a documented MANUAL two-place ceremony (Shopify dashboard + custody) —
Secrets Manager auto-rotation is FORBIDDEN for it (SM cannot update Shopify's dashboard → would
break every signature). No action needed now; line this up ahead of cutover.

---

## 2026-05-29 — connector-webhook-intake — architecture placement decision (NON-BLOCKING; Stage 2 proceeding on default)

**From:** Rohan (cto-advisor), Stage 1 intake.
**Status:** NON-BLOCKING. Aryan builds the Stage-2 plan on the default; amends only if you override.

WHERE the public Shopify inbound webhook endpoint lives. Ruled at Stage 1:

- **Default = Option C** — thin public receive at api-gateway (raw-body-faithful) → forward the
  untouched raw body + `X-Shopify-*` headers to ingestion-service → verify
  (`verify_shopify_hmac` + the app-level secret) + idempotent intake + Kafka produce in Python.
  Keeps the public surface + rate-limit at the gateway (canon "public → api-gateway only") AND the
  lone base64/raw-body verifier Single-Primitive in Python alongside the secret provider + ingest_batch.

- **Option A barred** — would duplicate the verifier in Node (Single-Primitive + CF-HMAC-ALGO-DISTINCT-1).
  The gateway's existing `validateShopifyHmac` is the OAuth-callback verifier (hex/sorted-query) — wrong
  algorithm for inbound webhooks; reusing it would be a correctness bug.

- **Option B** (ingestion-service grows its own *public* FastAPI listener) — would add a SECOND public
  front door to a service that is a Kafka worker today: new long-running server + dep + public
  ingress/TLS/WAF/rate-limit posture, contradicting the gateway-as-sole-public-choke-point invariant.
  A material, mostly-irreversible expansion of the public attack surface + deploy shape. Surfaced here
  rather than chosen silently.

**Ask:** ratify Option C, or override to B (accepting the second-front-door tradeoff). No action blocks
Stage 2. Live deploy + public webhook registration (the Shopify subscription pointing at the real URL) +
rotation of the compromised `shpss_…` at apps/api-gateway/.env:27 are HELD-Stage-8 regardless.

---

## 2026-05-29 — chore-ts-oauth-app-secret-custody — Stage 6 PASS (delegated APPROVE-WITH-CAVEATS) — Rohan

**Verdict:** APPROVE-WITH-CAVEATS, signed on your behalf under standing delegation (zero hard-rule deviations → delegation valid). The TS Shopify-OAuth env-injection slice is build-complete and verified.

**What I independently re-ran (verify-the-verifier):**
- Load-bearing CF-TS-NO-AWS-CLIENT-1: injected an `@aws-sdk` import into `boot-assert.ts` → boundary test went RED (named the exact file) → reverted → tree byte-identical (hash `ddf80bc` both sides) → GREEN. Non-vacuous, not a tautology.
- `provider-config.ts` diff == 0; core-service 262 pass; CDK 49 pass; `cdk synth` shows the `secrets:` mapping via `Fn::ImportValue`, ap-south-1 only, zero `shpss_` literal, zero new SM secret, 1 task-def, IAM scoped to the one secret/CMK ARN (no `*`). All 8 CFs MET. `@paradigm sql`, ₹0/mo.

**Two precise asks for you:**
1. **Commit (when ready):** give the free-text **"commit it"**, then run the staging command in this run's `pending-founder-commit.md`. It now stages **all 8 files** — the 5 TS files PLUS the **3 CDK files** (`infra/cdk/bin/app.ts`, `core-service-task-def-stack.ts`, its test) that were left unstaged at review (Shreya + Tanvi flagged; I re-confirmed). The TS boundary gate and the CDK `secrets:` mapping it gates must ship in ONE commit. Feature-branch only; no merge without your PR.
2. **Stage-8 live cutover stays HELD** — needs your authorization for: the full core-service Fargate service + live task-role wiring + provisioning the **rotated** `SHOPIFY_CLIENT_SECRET` into SM `brain/_app/shopify/hmac_secret` (the value is never printed in any artifact) + the live injection smoke. No `cdk deploy` until then.

**Parent closure:** this closes the parent's named TS follow-on at build level; CF-CC-OWNER-1 (core-service stays AWS-SDK-free) is preserved — no Node AWS client was introduced. **Carry-forward LOW:** L1 console.error fatal-boot style (fold into a structured boot logger later; non-blocking).

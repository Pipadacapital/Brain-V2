# 08 — Security Review (Stage 4, PARALLEL MODE) — spike-legacy-migration-architecture

| Field | Value |
|-------|-------|
| **req_id** | `spike-legacy-migration-architecture` (Child 0 of epic `chore-migrate-legacy-to-brain`) |
| **Reviewer** | Shreya (security-reviewer) |
| **Timestamp** | 2026-05-24T01:29:51Z |
| **Mode** | PARALLEL REVIEW (Shreya ∥ Tanvi; orchestrator reconciles) |
| **Gate type** | DESIGN-LEVEL VETO (no-prod-code spike; per `02-cto-advisor-review.md` `gate_applicability_no_code_spike` + `state.gate_applicability_no_code_spike.security_stage4 = "full"`) |
| **VERDICT** | **PASS** (design-level) — zero CRITICAL, zero HIGH, zero compliance violation, zero missing-traceability. 3 MED + 2 LOW logged as binding child-stage requirements (tech debt carried forward, non-blocking for the spike). |

---

## Change-class scope declaration (FIRST)

**Change class:** Architecture spike — design artifact only. ZERO runtime/product/legacy code in the diff.

- **Guardrail verified:** `git status` + `git diff --stat` show ONLY `.engineering-os/**` (decision-log, agent journals, feature memory, state, usage, run folders, state backups). **No `legacy project/**`, no `apps/`, `backend/src/`, `frontend/src/`, `services/`, `packages/`, `pylibs/`, `protos/`, no `.env`/lockfile/secret touched.** The no-prod-code guardrail HELD. This is NOT a Stage-4 fast-pass (the spike's *decisions* govern auth/multi-tenancy/connectors/PII/money/india-compliance — full design-level review applies, per Rohan's ruling).
- **ALWAYS-ON checks (code-surface):** vuln scans / secrets-grep / supply-chain / input-validation / minor-units-no-float → **N/A — out of scope (design-only spike; no compute path, no dependency graph, no code to scan).** The money-derived ALWAYS-ON rule is satisfied at the design layer: the plan mandates BIGINT minor-units + `ROUND_HALF_EVEN` and explicitly forbids float money leaking into Brain (A3.2 rule 2, A5.1 rule 4) — reviewed for adequacy below, not scanned.
- **Surface-specific gates I DO run (because the spike's decisions touch them):** multi-tenancy/RLS-isolation, PII-boundary/DPDP, data-residency, connector-credential-handling, audit-immutability, agentic-actions (AI surface mapping), traceability. These are reviewed as **design adequacy**, with VETO on a CRITICAL/HIGH design flaw or any compliance violation baked into the plan.

---

## What I validated against ground truth (not just the plan's word)

Every load-bearing security claim in the plan was re-verified against the actual legacy code — the plan does not get to assert a vulnerability it then claims to close without me confirming the vulnerability is real and the closure is sound.

| Plan claim | My independent verification | Result |
|---|---|---|
| Zero Postgres RLS; isolation is app-layer middleware only | `grep` for `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`/`FORCE ROW` across `legacy project/backend/**` = **0 hits**. `middleware/workspace.ts:30-52` resolves workspace from `:slug` + `workspaceMember.findFirst` — app-layer only, nothing at storage. | CONFIRMED |
| Cron cross-workspace `findMany` fan-out (the co-mingling surface) | `cron.ts:65` + `:148` `shopifyConnection.findMany`; `meta-sync.ts:290`, `google-sync.ts:660`, `shiprocket-sync.ts:351` all `findMany({where:{status}})` across all workspaces. | CONFIRMED |
| Plaintext creds at rest | schema lines 498 (`Shiprocket.password`), 500 (`shiprocketApiPassword`), 522 (`Unicommerce.password`), 559 (`Klaviyo.apiKey`), 699 (`google refresh_token`), 763 (`meta access_token`), 1014 (`Woo.consumerSecret`), 286/293/501 (Shopify token/secret) — all bare `String`. | CONFIRMED |
| `AuditLog.workspaceId String?` nullable | schema line 657 `workspaceId String? @map("workspace_id")` (plan cites 658 — off-by-one, substantively correct). Nullable FK to Workspace confirmed. | CONFIRMED |
| Residency UNCONFIRMED from repo | `grep` for `ap-south`/`us-east`/`eu-west`/`region`/`residency` in `backend/src/config/` + `docs/` = **0 hits**. Region genuinely undeterminable from code. | CONFIRMED |

The plan's threat model is grounded in the real codebase, not a strawman. This is the precondition for trusting the rest of the design.

---

## Design-level VETO surface — adequacy assessment

### 1. Cross-brand isolation during migration (C1/C5) — ADEQUATE

- **The RLS+session gate is a genuine HARD entry gate for EVERY child, not just Child 1.** A2.1 states it verbatim ("No slice's dual-run/shadow phase may begin until BOTH (G1) RLS live on ALL workspace-scoped tables AND (G2) cron fan-out converted to per-workspace-session-scoped invocations"). Critically, it is encoded as an **explicit column in the A2.2 sequence table** (`RLS+session gate (G1+G2)` = `REQUIRED GREEN` on Children 2/3/4/5/6), not prose — exactly what the compliance persona (C5) demanded so downstream builders cannot treat it as optional. **The facade ENFORCES it** (A2.1, A3, A5.1 rule 1) — "refuses to route any shadow traffic for a slice whose RLS+session gate column is not GREEN."
- **The breach window (R-LEAK-01) is correctly closed BEFORE any data moves.** Child 1 *establishes* the gate (G1+G2 go GREEN) and is sequenced as the root with **zero behavior change to the live API** (additive RLS + transparent session context); no Brain read path exists during Child 1. There is no window where shadow traffic flows under app-layer-only scoping — by construction, shadow cannot begin until the gate is GREEN.
- **The facade routing-bug-leaks-Brand-A-under-Brand-B scenario is structurally defended.** A3.2 rule 1 forbids the legacy "workspaceId-but-no-RLS" model from leaking into Brain — "every Brain read/write is under RLS session context"; the ACL is the *only* bridge and only after the gate is GREEN. So even a facade routing bug during dual-run hits the RLS storage-layer guard (defense-in-depth: app-layer + storage-layer), rather than the legacy single-layer failure mode. This is the correct answer to "is there ANY window where a routing bug could leak PII" — the storage layer is armed before routing complexity is introduced.
- **Enforceability/testability:** A4 Child-1 parity is concrete and falsifiable — "cross-workspace query returns 0 rows under each workspace session" + "no cross-workspace findMany in cron paths" + byte-identical API responses on a fixed corpus. This is a testable gate, not an aspiration.

> One residual I flag as MED (not a VETO) below: the gate's *enforcement mechanism* ("the facade enforces it") is asserted but the facade itself is design-deferred — the actual GREEN/RED predicate and its tamper-resistance is a Child-1 deliverable. Acceptable for a spike; named so it cannot drift.

### 2. PII boundary crossing + residency (C6) — ADEQUATE (with the residency call examined independently)

- **The PII-boundary register (A6.2) is real and complete.** It enumerates every PII-bearing model the compliance persona named — `ShopifyCustomer` (email/firstName/lastName), `WoocommerceOrder` (customerEmail/customerPhone/billing*/shipping*), `ShiprocketShipment` (deliveryPincode/City/State), `ShopifyOrder.email`, `Invitation.email` — with the crossing slice (Child 3 ingest → Child 4 ClickHouse/S3; Child 1 for Invitation), the pre-crossing proof required (residency confirmed + purpose-linked consent record), and DPDP §12/§13 erasure scoping (per-workspace under RLS, consent/purpose column added since the legacy schema lacks one). I cross-checked the model list against the schema PII fields — no PII-bearing model is missing from the register.
- **DPDP §4 processing before PII flows to ClickHouse/S3 is handled at the right layer.** The register makes "purpose-linked consent record exists" a **pre-condition for the crossing**, and notes Brain *adds* the consent primitive the legacy schema lacks (no `consent_given_at`/`purpose_code` exists in legacy — I confirmed). The actual consent-primitive DDL is correctly deferred to the child that performs the crossing (Child 1 tenancy / Child 3 ingest) — appropriate for a spike that maps, not builds.
- **The armed residency tripwire (A2.0 / R-RES-01) is a SOUND control.** It is BLOCKING and EARLY ("before A2 can be treated as finalized-and-executable"), it is binary and unambiguous (region == ap-south-1 → proceed; != → `/escalate` + FREEZE A2 + insert pre-Child-1 residency migration), it is named in the risk register so it cannot be silently skipped, and the alternate branch (Step 0 residency migration before any PII crosses) is pre-designed. This is the correct treatment of an unconfirmed-fact predicate.

### 3. Connector credential handling (C1/C8) — ADEQUATE

- **The per-connector token-handoff ceremony (A6.3) correctly handles the single-token / single-webhook reality.** It is a SINGLE-OWNER CUTOVER, not a shadow (A2.2 Child 3, A3.2 rule 3 "the single-owner connector token MUST NOT be dual-homed — the ACL never proxies a token to two readers"). This is the only correct design — the schema confirms one token field per connector and Shopify's one-webhook-per-shop reality (I verified `ShopifyConnection.accessToken` single field + `registerWebhooks` import). A dual-homed token would itself be a security finding; the plan forbids it explicitly.
- **Credential ROTATION (not copy) is specified and is the right answer to R-CRED-01.** Child 3 = "credential-ROTATION event: secret → Brain secrets manager, **legacy plaintext deleted at that connector's cutover** (not after)." This closes the duplicated-plaintext-across-two-DBs-during-dual-run window the persona flagged. "Deleted AT cutover, not after" is the load-bearing precision — it minimizes the duplication window to the cutover instant.
- **No window where a token is exposed or duplicated beyond the cutover instant.** Token lives in exactly one system at a time (A2.2 Child 3). The rollback tree (A4 Child 3 / M-A5-Q3) hands the token *back* to legacy and re-registers the legacy webhook on failure — so rollback does not orphan or duplicate the credential either.
- **Shiprocket correctly flagged HIGHER-risk** (no historical event replay → longest shadow before transfer + largest rollback window N=72h). The single connector most likely to lose data on a bad cutover is named and given the most conservative ceremony. Sound.

### 4. Audit immutability (C9) — ADEQUATE

- **Null-`workspaceId` AuditLog disposition (A1.4) is correct and DPDP-defensible.** Brand-scoped rows → per-workspace append-only Decision Log under RLS; null-workspace rows → a dedicated **system-workspace sentinel** (reserved `workspace_id` for platform actions) so they stay attributable for DPDP accountability, NOT silently orphaned and NOT co-mingled into any tenant's Decision Log. Migration-process-generated audit rows during dual-run are attributed to that sentinel. This is the right answer to the persona's "system events have no erasure-scoping target" concern.
- **Tamper-evidence preserved through migration:** the Decision Log target is append-only under RLS (A1.4, A6.4 R-AUD-01); the cache-purge gate (M-A5-5 step 5) writes its audit row to the Decision Log and that row is **explicitly NOT deleted on rollback** ("part of the permanent audit trail"). The plan preserves audit immutability across the cutover/rollback boundary — a subtle correctness point it got right.

### 5. Traceability of the 9 concerns — ALL 9 GENUINELY ADDRESSED (none hand-waved)

I checked each concern for *binding mechanics*, not name-checks. See the dedicated table below. All 9 land in a concrete artifact with an enforceable rule. The standout: C5/C1 (the two CRITICALs) are bound as a hard A2 *column* + a facade-enforced gate + a single-owner-cutover rule — not a prose aspiration.

> **Migration-program traceability note (the correlation-ID surface).** A real code diff would VETO on a missing `request_id`+`trace_id`+`workspace_id`+`user_id` on any endpoint/consumer/LLM call. This spike ships no code path, so there is no correlation-ID propagation to verify *here*. I am NOT marking traceability N/A silently — I am converting it into a **binding requirement on every downstream child** (see LOW-2): the facade, every per-workspace-session cron invocation, every connector ingest event, every shadow-compare job, and every Decision-Log/AI write introduced in Children 1–7 MUST carry the 4-tuple end-to-end, and that is a Stage-4 VETO surface at each child. For the spike itself: zero missing-traceability findings (no code path exists to be untraceable). Note the observability plan (§14) already names parity reports + gate-state flags as queryable — the correlation-ID requirement extends that.

---

## Findings

### CRITICAL — none
### HIGH — none
### Compliance violations (DPDP/PDPL/DLT/NCPR/calling-hours/recording-consent) — none

No outbound channel / DLT / NCPR / WhatsApp / calling-window / recording-consent surface is exercised by this spike (those are Child-3/future-lifecycle concerns; the spike correctly defers them). DPDP/residency/PII is the live compliance surface and the plan handles it without a violation.

### MEDIUM (logged as binding child-stage requirements; non-blocking for the spike)

- **MED-1 — Facade gate-enforcement mechanism is asserted but design-deferred.** A2.1/A3/A5.1 say "the facade enforces" the RLS+session gate and writer-exclusivity, but the facade's actual GREEN/RED predicate, who can flip it, and its tamper-resistance (a mis-set flag would re-open the R-LEAK-01 breach window) are not specified in the spike.
  - *Location:* A2.1, A3.1–A3.4, A5.1 rule 1.
  - *Remediation (Child 1 must additionally specify):* the gate-state store must be authoritative + auditable (flip events written to the immutable Decision Log), the GREEN predicate must be derived from a live RLS-verification probe + a cron-session-scope assertion (not a manually-toggled boolean), and a RED-by-default fail-closed posture (unknown gate state ⇒ no shadow traffic). This is the single highest-leverage hardening for the breach window; it is a Child-1 Stage-4 VETO item.
- **MED-2 — Shadow-compare read path uses a "read-only replica" but the dual-run still shares the legacy Postgres.** M-A5-2 enforces no-Postgres-dual-write via a read-only role for the analytics-service user (good), but the dual-run runs Brain alongside legacy against the same logical database. The compliance persona's exact phrasing was "the same Postgres database (or even a shared read replica)" is the co-mingling surface.
  - *Location:* M-A5-2 ("read-only replica connection"), A5.1 rule 2.
  - *Remediation (Child 2/Child 4 must additionally specify):* confirm the shadow-compare bridge reads from a *physically separate* read replica (or a point-in-time snapshot), AND that the read-only role is RLS-session-scoped per workspace (a read-only role alone does not prevent a cross-workspace `findMany` if RLS context is absent on the analytics-service connection). The RLS+session gate (G1+G2) must therefore also apply to the analytics-service's read connection, not only the write paths — make this explicit.
- **MED-3 — Consent lawful-basis for the *migration itself* (DPDP §4 processing) is named as a pre-condition but its source is not yet established.** A6.2 requires "purpose-linked consent record exists" before PII crosses, and notes the legacy schema has none. The spike correctly says Brain adds the primitive — but the *lawful basis for processing the existing legacy PII during the migration* (before any new consent is captured) is not addressed. Migrating PII that was collected under the legacy product's terms into a new architecture is itself §4 processing.
  - *Location:* A6.2 PII register, R-RES-01.
  - *Remediation (Child 1/Child 3 must additionally specify):* document the lawful basis for migration-time processing (likely "necessary for the specified purpose for which the data was originally provided" continuity, DPDP §7 legitimate-uses / existing-consent continuity), and whether a fresh consent/notice is required on cutover. If this is a genuine DPDP-interpretation ambiguity at child-time (not resolvable from canon), it is an `/escalate` candidate then — flag it now so it is not discovered late.

### LOW (logged; non-blocking)

- **LOW-1 — `oauth_states` (schema:843, A1.1 #44) classified "reuse" with no encryption/expiry note.** OAuth CSRF state is short-lived but if mishandled at the connector cutover (Child 3) it is an OAuth-flow injection surface. *Remediation:* Child 3 must confirm short-TTL + single-use + tamper-evident state (per `oauth-implementation`); minor because it is ephemeral and not PII.
- **LOW-2 — Correlation-ID 4-tuple end-to-end is not yet a stated requirement on the migration program's runtime.** *Remediation:* add to every child's acceptance bar: facade + session-scoped crons + connector ingest + shadow-compare jobs + Decision-Log/AI writes MUST propagate `request_id`+`trace_id`+`workspace_id`+`user_id`; missing-traceability is a Stage-4 VETO at each child. (Spike-level: no finding — no code path exists.)

---

## Concerns traceability (the 9 — solid vs hand-waved)

| Concern | Severity | Bound in | Solid or hand-waved? | Note |
|---|---|---|---|---|
| C1 — connector token-handoff ceremony | CRITICAL | A2.2 (Child 3 = single-owner cutover), A6.3, A4 Child-3 rollback tree, A1.3 | **SOLID** | Per-connector ceremony + replay matrix + rollback window N + Shiprocket-higher-risk. Matches schema reality. |
| C2 — WorkspaceDailyMetrics single-writer | HIGH | A2.2 Child-4, A3.3, A5.1 rule 2, M-A5-2 | **SOLID** | ClickHouse-shadow-never-Postgres-dual-write + DB-level read-only role enforcement. Data-race correctly precluded. |
| C3 — Child5 hard-dep on Child4 + cache invalidation | HIGH | A2.2 (Child-5 hard edge), A2.3 DAG, A4 Child-5, M-A1-3 / M-A5-5 (`CACHE-PURGE-C4C5`) | **SOLID** | Named cutover gate with verbatim purge steps + facade 4-condition predicate + verification query. |
| C4 — static-FX parity contamination | MED | A5.1 rule 3, A6.3 R-FX-01, M-A5-3 (4 mechanics) | **SOLID** | Compare-in-primary-currency-at-fixed-snapshot; multi-currency false-positive precluded. |
| C5 — RLS+cron hard entry gate | CRITICAL | A2.1, A2.2 (explicit column), A5.1 rule 1, A6.2 R-LEAK-01 | **SOLID** | The breach window. Encoded as a table column + facade-enforced + shadow-blocked. Strongest binding in the plan. |
| C6 — PII register + residency tripwire | HIGH | A6.2 register, A2.0 / R-RES-01 armed tripwire | **SOLID** | Complete PII register (verified vs schema) + binary blocking tripwire + pre-designed Step-0 branch. |
| C7 — exact-integer money parity | HIGH | A4 Child-2, A5.1 rules 4-5, M-A5-1 (harness + ROUND_HALF_EVEN proof + 6 test vectors + TS/Py skeletons) | **SOLID** | Zero-tolerance, per-workspace-date reconciliation, banker's-rounding TS↔Python byte-identity proof incl. the `1234.565` case. |
| C8 — connector credential rotation | MED | A2.2 Child-3, A6.4 R-CRED-01 | **SOLID** | Rotation-not-copy + delete-legacy-plaintext-at-cutover. |
| C9 — AuditLog null-workspaceId | MED | A1.4, A6.4 R-AUD-01 | **SOLID** | System-workspace sentinel; attributable, not orphaned, not co-mingled. Audit immutability preserved through rollback. |

**0 of 9 hand-waved.** Every concern lands in a concrete artifact with an enforceable, falsifiable rule.

---

## Escalation opinion — residency tripwire (do I concur with Rohan's "tripwire not escalate-now"?)

**I CONCUR with Rohan's call. I do not independently escalate now.**

Reasoning (independent of Rohan's, reaching the same place):
- The `/escalate` rubric fires on a **compliance *ambiguity* I cannot resolve from canon** — not on an **unconfirmed fact**. Here the *rule* is unambiguous: DPDP §16 governs cross-border transfer; Brain canon mandates ap-south-1 by default; if region != ap-south-1 the migration is a §16 transfer requiring a residency migration first. There is no interpretation gap to escalate. The only unknown is a single binary fact — the Supabase project's region — which I independently confirmed is genuinely undeterminable from the repo (0 region markers; `DATABASE_URL` in uncommitted `.env`).
- Escalating an unconfirmed fact would be **fabricating an escalation**, which my mandate forbids as squarely as burying a real one.
- The tripwire is a *sound* control precisely because it is BLOCKING, EARLY, BINARY, NAMED-IN-RISK-REGISTER, and PRE-AUTHORIZED — it cannot be silently skipped (A2 "cannot be finalized" until the region is confirmed), and the != ap-south-1 branch *is* an immediate real escalation + A2 freeze + Step-0 residency migration. This is strictly better than escalating-now on a guess, because it escalates on a *determined* fact with the alternate plan already designed.

**One independent sharpening I attach (does NOT change the verdict):** the tripwire must fire **before Child 1's RLS DDL touches the database**, and confirming the region is a Child-1 *gate-zero* item, not merely "before A2 finalized." A2.0 already says "before A2 can be treated as finalized-and-executable" and sequences Step-0-residency ahead of Child 1 — so this is satisfied; I am underlining it as a non-negotiable ordering so the fact-confirmation cannot slip to mid-Child-1. If the Founder/anyone confirms region != ap-south-1 during Child-1 prep, that is the moment the armed `/escalate` fires.

---

## Gate (G4) decision

- [x] Zero CRITICAL design findings
- [x] Zero HIGH design findings
- [x] Zero compliance violations (DPDP/PDPL/residency/PII handled without a violation; no DLT/NCPR/outbound surface exercised)
- [x] Zero missing-traceability findings (no code path exists; 4-tuple requirement carried forward as LOW-2 binding)
- [x] Isolation gate (C5) is a hard, facade-enforced, table-column entry gate for EVERY child
- [x] Connector cutover = single-owner token-handoff + credential rotation (C1/C8)
- [x] Audit immutability preserved through migration + rollback (C9)
- [x] PII register complete + residency tripwire sound (C6)
- [x] No-prod-code guardrail HELD (git status = `.engineering-os/**` only)
- [x] All 9 persona concerns genuinely bound (0 hand-waved)
- [ ] Vuln scans CLEAN — N/A (no code to scan; design-only)

**MED/LOW are logged as binding child-stage requirements (tech debt), not spike blockers.**

---

## VERDICT: PASS (design-level)

The migration architecture closes the legacy security/compliance gaps it identifies (verified real against ground truth), and the migration SEQUENCING does not open a breach window — the RLS+session gate is armed before any data moves and the facade enforces it as a hard precondition for every slice's dual-run. The two CRITICAL fault lines (no-RLS isolation + single-token connectors) are bound with the strongest mechanics in the plan. I have no CRITICAL or HIGH design finding and no compliance violation. The 3 MED + 2 LOW are real hardening items that belong to the children that build the runtime, and I have routed them as binding Stage-4 VETO surfaces at those children so they cannot drift.

**Routing (PARALLEL MODE):** Return `SECURITY: PASS` to the orchestrator. Do NOT advance the pipeline; the orchestrator reconciles with Tanvi's Stage-5 verdict.

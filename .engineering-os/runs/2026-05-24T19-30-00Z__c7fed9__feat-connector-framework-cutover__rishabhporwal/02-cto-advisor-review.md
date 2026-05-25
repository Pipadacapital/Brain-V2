# CTO Advisor Review — Stage 1 (intake / brainstorm)

> Filled by Rohan (cto-advisor) at Stage 1 intake for Child 3 of EPIC `chore-migrate-legacy-to-brain`.
> Pairs with `05-stage1-synthesis.md` (written after personas return). This is the intake pass.

| Field | Value |
|-------|-------|
| **req_id** | `feat-connector-framework-cutover` |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-24T19:42:00Z |
| **Decision** | **ADVANCE** (with a binding scope refinement + 2 personas requested → synthesis pending) |
| **Parent epic** | `chore-migrate-legacy-to-brain` (Child 3 of 7) |

---

## Lane decision

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Trigger-surface scan fires on SIX surfaces simultaneously: `connectors` (the literal subject), `auth` (OAuth flows + token custody), `pii` (Shopify/Woo customer email/phone + Shiprocket delivery pincode ingested at the boundary), `multi-tenancy` (every write workspace-scoped via `withWorkspace`), `india-compliance` (DPDP lawful-basis for ingested PII + plaintext-cred rotation + ap-south-1 residency), `schema-proto` (raw event store + the `integrations.*.v1` Kafka topic contract). Foundational-scaffolding carve-out is INAPPLICABLE — this ships live runtime, ingests live PII, and performs an irreversible-per-connector cutover. Conservative tie-break is moot; nothing pulls this below high-stakes. |
| **trigger_surfaces_touched** | `connectors`, `auth`, `pii`, `multi-tenancy`, `india-compliance`, `schema-proto` |
| **Stages that run** | Full high-stakes lane: 1 (intake + 2 personas) → 2 (architect, Maya co-owns? see below) → 3/4 (build) → 4 (security VETO) → 5 (QA) → 6 (final review VETO) → 7 (Founder gate, delegated to Rohan) → 8 (deploy/cutover readiness). No stage drops. |

---

## Pre-flight dependency check

- **Child-3 `blocks` (per Child-0 DAG, §A2.3 line 515):** depends **ONLY on Child-1's gate**, NOT on Child-2's money rep. Connectors land **raw**; money Decimal→MU conversion is a Child-2 *compute* concern at the ACL boundary, not an ingest concern. Confirmed against the architecture: "Child 3 depends only on Child 1's gate (it ingests raw; it does not require Child 2's money rep)."
- **Child-1 gate status:** **SATISFIABLE Brain-native** — `withWorkspace`/`withSuperadmin` primitive present at `apps/core-service/src/infrastructure/db/workspace-context.ts` (verified on disk this intake), committed `860aeee` on `feature/feat-tenancy-auth-rls-hardening`. The Child-1 entry contract requires SATISFIABLE (not LIVE/FORCED) for downstream *design*; LIVE is required only at a child's own live-write cutover.
- **Result: NO dependency violation.** Child 3 may proceed to Stage 1 → 2.
- **Non-blocking build-base note (carried to Stage 2/3, NOT a Stage-1 blocker):** Child-1/2 are committed on `feature/feat-tenancy-auth-rls-hardening`, not yet merged to `development`. The Child-3 build needs the `withWorkspace` primitive on its base branch. **Resolve at Stage 2/3 build-base selection** when the Founder merges that PR; do not block intake.

---

## Made requirements less dumb first

**Could DELETE:**
- The phrase **"Brain Secrets Manager available for credential rotation"** as a *satisfied dependency*. It is **FALSE on the ground.** I verified: zero secrets-manager / vault / KMS primitive exists anywhere in `apps/`, `packages/`, `pylibs/` (grep CLEAN). The Founder explicitly **DEFERRED credential rotation + Secrets Manager to `chore-security-governance-hardening-phase` WS-1** (pending-founder-attention.md, struck-through item: "Founder will rotate + move to Secrets Manager when WS-1 activates"), and **WS-1 is not active.** This is not a delete-the-scope move — it's a delete-the-false-premise move. See Challenge #C below; it is the single most likely thing to derail this child.

**Could SIMPLIFY:**
- Do **NOT** build a generic 7-connector framework in one cutover. The architecture already prescribes **per-connector ceremony (A6) + per-connector rollback window N (M-A5-Q3)**. The simplification is to bind the *framework* (one connector-ingest primitive, generic) but **sequence the cutovers one connector at a time, lowest-risk-first**, with Shiprocket (no replay, N=72h, ≥2-week pre-shadow) LAST. The framework is built once; the cutovers are N independent reversible events. This is the Single-Primitive Rule applied to the cutover ceremony itself.

**Could DEFER:**
- **The live token transfer / webhook re-registration / legacy-plaintext-delete for ALL connectors** to a Stage-8 named HOLD state — exactly mirroring Child-1's `HOLD-AT-FORCE` and Child-2's `HOLD-AT-LIVE-RECON`. This child's *exit* should be the Brain-native connector framework + per-connector ceremony runbook **present and LOCAL-verified**, with the live single-owner flip deferred to a gated Stage-8 ceremony. Rationale: the live flip is irreversible-the-instant-the-token-moves; it must not happen inside a normal pipeline run — it needs the Founder at the console with the A4 rollback tree armed. I am naming this **HOLD-AT-CUTOVER** (see binding constraints).
- **Backfill / historical replay** beyond the cutover-overlap window → its own bounded operation, not part of the framework build.

---

## Scope refinement (challenge applied — this is NOT a CHALLENGE-BACK)

The requirement is **sound, dependency-satisfied, and planable** — so this is an ADVANCE with a sharpened scope, the same shape I used for Child 1 (1a→1b) and Child 2 (shape A). I split Child 3 into **3a (framework) → 3b (per-connector cutover ceremony) → 3c (residual-writer FORCE-unlock)** inside ONE requirement, and I move the live flips behind a named HOLD:

- **3a — Brain-native connector ingest framework (the build, fully in scope this child):** one generic connector-ingest primitive in `ingestion-service` — OAuth/credential read → idempotent UPSERT into the raw event store (Postgres under RLS via the Child-1 `withWorkspace` primitive) → Kafka producer to `integrations.*.v1` → cursor persistence → raw archive. Same code path for live + backfill (bounded vs unbounded window param). LOCAL-verified. **No live token moved.**
- **3b — Per-connector cutover ceremony runbook (present + LOCAL-verified this child; EXECUTED at Stage-8 HOLD-AT-CUTOVER, one connector at a time):** the A6 ceremony (token-transfer instant, max data-loss window, replay availability, A4 go/no-go rollback tree) + count-based + event-field-spot-check parity per connector (M-A5-Q3 windows: Shopify/Woo 4h, Meta/Google 8h, Klaviyo/Unicommerce 12h, Shiprocket 72h with ≥2-week pre-shadow). The runbook is the deploy artifact (mirrors Child-1's rollout-runbook), NOT executed in a normal pipeline run.
- **3c — Residual no-context-writer conversion for the Child-1 FORCE-unlock (SCOPE-CONTESTED — see Challenge #B; my ruling is to KEEP it here but redefine what "convert" means):** Child-1's `HOLD-AT-FORCE` precondition is "Child-3 converts the residual no-context writers (`discoverChannels`, `backfill*`) so a complete bare-write grep returns ZERO hits." Those writers live in the **legacy Express/Prisma backend, which is now reference-only and untracked** — we cannot edit them. The honest conversion is: the Brain-native ingest framework (3a) **becomes the context-aware replacement** for those writer paths (discoverChannels / backfillShiprocketCourierNames / backfillShiprocketPincodes are connector-ingest operations by nature), and the "complete bare-write grep returns ZERO hits" is satisfied against **Brain code** (the new framework writes only through `withWorkspace`), with the legacy writers *retired at their connector's cutover*, not edited. This resolves the legacy-reference-only contradiction. Bound below.

**Maya co-ownership of Stage 2: NO** (preliminary — Aryan may request her). This child ingests **raw** events; there is no metric-registry, no money Decimal→MU conversion (Child 2 owns that at the ACL), no numeric shadow-compare (M-A5-Q3 explicitly carves connectors OUT of the numeric harness — parity is count-based + spot-check), no AI surface. The seam Maya would own (raw-event → metric rollup) is Child 4. **If** Aryan's Stage-2 design finds the raw event-store schema must pre-shape fields the metric registry will consume (a Child-4 coupling), he raises a co-owner request then — same rule as Child 1.

---

## Personas spawned *(Stage 1 — 2 requested, the high-stakes cap; two distinct risk dimensions intersect)*

> **I am NOT spawning these myself.** Per my subagent role I return the persona list for the orchestrator/Founder to spawn in parallel, then re-invoke me for synthesis (`05-stage1-synthesis.md`). Two distinct dimensions justify the cap of 2 (one engineering-reversibility, one compliance-secrets) — they do not overlap.

1. **`connector-cutover-token-handoff-realist:sonnet`** — *engineering reversibility (reasoning-heavy → sonnet).*
   **Brief:** Adversarially prove Child 3 is a **disguised big-bang**, not reversible-per-connector. Pressure-test: (a) the single-owner webhook cutover **data-loss window** — at the token-transfer instant legacy stops receiving; is the gap genuinely bounded + replayable per the A1.3/M-A5-Q3 table, or does Shiprocket (NO replay, N=72h) make at least one connector a one-way door? (b) the A4 rollback tree — "restore legacy token + re-register webhook" assumes the legacy app is still live and able to re-accept; is that true after 3c retires its writer? (c) is the "framework" actually one primitive consumed N times, or will per-connector quirks (Shopify 1 webhook/shop vs Shiprocket email/password vs Google refresh_token) force N bespoke ingest paths (Single-Primitive violation)? (d) `ingestion-service` is a **bare DDD scaffold** (`.gitkeep` only, no Kafka, no deploy pipeline) — is standing up the FIRST live Brain runtime + first Kafka topic in this child a hidden scope explosion (the Shape-B trap that bit Child 1)? Name the **one connector + one step** most likely to cause irreversible data loss or a live outage.

2. **`india-connector-pii-secrets-compliance-officer:sonnet`** — *compliance + secrets (DPDP trade-offs → sonnet).*
   **Brief:** (a) **CF-SEC-SECRETS-1 / R-CRED-01:** the architecture says "rotate cred into Brain Secrets Manager, delete legacy plaintext at cutover" — but **no Secrets Manager exists and the Founder deferred it to inactive WS-1.** Is there a lawful, no-plaintext interim custody for the OAuth tokens/API keys the framework must read, or does this child gate on WS-1 (escalation)? Pressure-test the "delete legacy plaintext at cutover" sequencing — deleting before Brain custody is proven = lockout; after = dual plaintext window (R-CRED-01). (b) **CF-SEC-3 / DPDP lawful-basis for ingested PII at the boundary:** Child 3 is where `ShopifyCustomer.email/firstName/lastName`, `WoocommerceOrder` billing/shipping PII, `ShiprocketShipment` delivery pincode/city/state actively flow INTO Brain via the ingest framework (DPDP §4 processing acts). Child-1's CF-SEC-3.HARD was satisfied ONLY for Sugandh Lok (Founder-owned); it **re-arms before any third-party-brand PII enters prod.** Is the connector framework brand-agnostic in a way that lets non-Sugandh-Lok PII in at cutover? If so, that re-arms the gate. (c) Residency: ap-south-1 must be asserted on the new ingest write path. (d) DPDP consent/purpose column modeling for newly-ingested PII the legacy schema lacks (A6.2 register). Flag any genuine ambiguity to `/escalate`.

**Declined personas:** `ai-cost-realist` (no compute/LLM path — connectors are sql + OAuth + event-handling; cost-routing audit clean). A generic architecture persona (slice-boundary + Kafka-topic + ingest-schema correctness is Aryan's binding Stage-2 job; the cutover realist supplies the adversarial method read). A 3rd persona would overshoot the cap — if I wanted a 3rd, the child is too broad, but the 3a/3b/3c split keeps it within two dimensions.

**Synthesis:** *DONE — see `05-stage1-synthesis.md` (2026-05-24T20:30:00Z).* **Both personas ACCEPTED** (5 + 6 genuine code/architecture-grounded concerns; zero "looks good"). Outcome amends this intake on three points: **(1)** Shopify re-bound as **all-shops-atomic** (CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1), not per-shop reversible — the HMAC secret is app-level `SHOPIFY_CLIENT_SECRET`, the callbackUrl is one shared endpoint; **(2)** intake 3a SCOPE-SPLIT into 3a-i (framework LOCAL-verified) + 3a-ii (CF-C3-RUNTIME-SCOPE-DECISION-1, a Stage-2 binding LOCAL-only-vs-STAGING must-decide) + a Python session-context primitive (CF-C3-PY-SESSION-CTX-1, since the TS `withWorkspace` cannot be imported by a Python service); **(3)** Maya co-ownership FLIPPED to conditional-YES (CF-C3-CONSENT-COLUMN-1 pre-shapes Child-4 metric fields). 13 intake constraints → 24 carried to Stage 2 (11 NEW), zero dropped.

---

## Paradigm recommendation

**Recommended paradigm:** `sql` (+ OAuth/connection/event-handling: idempotent UPSERT + Kafka producer + cursor persistence)

**Why:** Pure deterministic data movement — receive vendor events, dedupe (idempotent UPSERT keyed on vendor event id), write workspace-scoped under RLS, emit to Kafka. **No ML, no LLM, no cost-routing path.** Cost-routing audit clean — there is no inference, no classification, no narration. Any temptation to "smart-route" or "AI-classify" incoming events would be a paradigm over-reach and belongs to Child 5 (AI), not here. Aryan may refine in Stage 2 (e.g., the exact Kafka delivery semantics), but the paradigm class is settled: deterministic ingest.

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | Indirect-but-load-bearing — Shiprocket is the RTO/COD data source. Its NO-replay status (M-A5-Q3 N=72h, ≥2-week pre-shadow) means a botched Shiprocket cutover **loses RTO/COD shipment-status events that cannot be re-fetched as webhooks**, corrupting the RTO economics every downstream CM2/CM3 metric depends on. This is the single highest-blast-radius connector. |
| **COD** | Same Shiprocket dependency — `codAmount` spot-check on last 20 shipments is the parity basis. COD reconciliation is from Shiprocket's order-level API (not event webhooks) if rollback fires. |
| **GST** | No direct GST surface this child — connectors land **raw**; per-SKU GST 2.0 (0/5/18/40) classification is a Child-2/Child-4 compute concern. Do NOT pull GST logic into ingest. |
| **Festival seasonality** | Operational: a connector cutover MUST NOT be scheduled during a festival traffic spike — the data-loss window + the per-connector quiesce amplify under peak volume. Bind as a runbook scheduling constraint (no cutover during a known festival window). |
| **Pincode reliability** | `ShiprocketShipment.deliveryPincode/City/State` is ingested PII (A6.2 register) AND the pincode is the serviceability/reliability signal. Ingest framework must preserve it workspace-scoped. |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | **N/A this child** — no outbound channel (call/WhatsApp/SMS) is sent. Connectors are inbound ingest only. Klaviyo is ingested as a *data source* (email performance metrics), NOT used to *send* here. If a future child sends via an ingested channel, those gates arm then. |

---

## Escalation decision (per the rubric)

> **UPDATE AT SYNTHESIS (2026-05-24T20:30:00Z):** the compliance persona CONFIRMED the Secrets-custody gap with code (Supabase DB = de-facto plaintext vault; R-CRED-01 destination does not exist; no lawful long-term interim). Escalation #1 is therefore **FIRED (escalate-now)** per the Child-1 pattern — Stage-2 PROCEEDS, Stage-3 build GATED on the Founder's Option A/B custody decision. See `05-stage1-synthesis.md` §5 for the exact Founder ask + what re-arms. Items #2 (CF-SEC-3) and #3 (CF-RES-1.a) remain armed-not-fired.

**ONE escalation surfaced at intake (conditional/armed) + one carried tripwire. Decision: surface to Founder now as a NON-BLOCKING heads-up with an ARMED gate; full `/escalate` fires at synthesis IF the compliance persona confirms no lawful interim cred custody exists.**

1. **🔐 Secrets Manager non-existence vs. CF-SEC-SECRETS-1 (the load-bearing one).** The architecture's credential-rotation mitigation (R-CRED-01) names "Brain Secrets Manager" as the custody target. It **does not exist** and the Founder **deferred it to inactive WS-1.** This is a **missing build-gating prerequisite that only the Founder can resolve** — the same rubric class as Child-1's DPDP lawful-basis escalation (a missing instrument, not a derivable fact). The connector framework (3a) cannot read OAuth tokens / API keys without *some* custody mechanism, and "rotate to Secrets Manager + delete legacy plaintext at cutover" is the architecture's stated requirement. **Why armed-not-fired-yet:** I want the compliance persona to first confirm whether a lawful *interim* custody exists (e.g., the framework reads from the existing legacy plaintext as reference-only during pre-cutover shadow, with rotation deferred to the actual cutover ceremony which is itself Stage-8 HOLD) — if so, this is a Stage-2 design constraint, not a blocker. If NOT, it `/escalate`s: "Child-3 build needs either WS-1 activated OR a Founder-ratified interim cred-custody decision before the framework reads any live credential." Mirrored to `pending-founder-attention.md` as a non-blocking heads-up now.

2. **CF-SEC-3 PII-at-ingest re-arm (carried tripwire).** Child 3 is where customer PII actively flows into Brain. CF-SEC-3.HARD was satisfied for Sugandh Lok only and **re-arms before any third-party-brand PII enters prod.** Sugandh Lok remains the only in-scope brand, so this does NOT fire at intake — but the framework is brand-agnostic by construction, so the compliance persona must confirm the cutover ceremony cannot admit non-Sugandh-Lok PII without re-firing the gate. Armed, not fired.

3. **Residency (CF-RES-1.a) — carried, not new.** ap-south-1 confirmed (Founder, 2026-05-24). The new ingest write path must positive-assert region at deploy, same as Child 1. Armed in-pipeline tripwire, no escalation unless the assertion fails at execution.

**No CHALLENGE-BACK, no KILL.** The requirement is sound and planable; the false "Secrets Manager available" premise is a Stage-1 correction (handled above + escalation), not grounds to bounce the whole child.

---

## Binding constraints carried to Stage 2 (Aryan)

| ID | Constraint |
|----|------------|
| **CF-BN-NOLEGACY-1** (re-affirmed) | Legacy = reference-only. The connector framework is built Brain-native in `ingestion-service`; the legacy `discoverChannels`/`backfill*` writers are **retired at cutover, never edited**. Any diff touching `legacy project/` = drift bounce. |
| **CF-C3-SINGLE-OWNER-1** | Token lives in exactly ONE system at a time (A3.2 rule 3 — never dual-homed). The ACL never proxies a token to two readers. |
| **CF-C3-HOLD-AT-CUTOVER-1** (NEW, named hold state) | The live per-connector token transfer + webhook re-registration + legacy-plaintext-delete is DEFERRED to a Stage-8 gated ceremony (mirrors Child-1 HOLD-AT-FORCE / Child-2 HOLD-AT-LIVE-RECON). This child's exit = framework + per-connector ceremony runbook present + LOCAL-verified; ZERO live token moved in a normal pipeline run. Requires Founder-at-console + A4 rollback tree armed to execute. |
| **CF-C3-PER-CONNECTOR-N-1** | Per-connector rollback window N is binding (M-A5-Q3): Shopify/Woo 4h, Meta/Google 8h, Klaviyo/Unicommerce 12h, **Shiprocket 72h + ≥2-week pre-shadow (no replay — sequenced LAST, highest risk)**. Lowest-risk connector cut over first. |
| **CF-C3-PARITY-COUNT-1** | Parity is **count-based + event-field spot-check** per connector, NOT the numeric shadow-compare (M-A5-Q3 explicit carve-out, architecture lines 655-669). Do NOT build a numeric harness here. |
| **CF-C3-SINGLE-PRIMITIVE-1** | ONE generic connector-ingest primitive (OAuth read → idempotent UPSERT under `withWorkspace` → Kafka `integrations.*.v1` → cursor → archive) consumed N times. Per-connector quirks are config/adapters, not N bespoke ingest paths. Single-Primitive Rule. |
| **CF-C3-RLS-CONSUME-1** | Every write goes through the Child-1 `withWorkspace` primitive (`apps/core-service/.../workspace-context.ts` signature) — the framework consumes RLS, never re-invents app-layer scoping. The legacy "workspaceId-but-no-RLS" model MUST NOT leak into Brain (A3.2 rule 1). |
| **CF-C3-FORCE-UNLOCK-1** (3c) | The Brain-native framework is the context-aware replacement for the residual no-context writers; the "complete bare-write grep returns ZERO hits" precondition for Child-1's FORCE is satisfied against **Brain code** (must NOT exclude backfill/discoverChannels — the legacy grep was DEFECTIVE), with legacy writers retired at cutover. This is the explicit unlock edge for Child-1 HOLD-AT-FORCE. |
| **CF-SEC-SECRETS-1** (armed) | No plaintext creds in Brain. Rotation + legacy-plaintext-delete-at-cutover per R-CRED-01 — **GATED on a custody mechanism that does not yet exist** (Secrets Manager deferred to inactive WS-1). Stage-2 must design the interim-or-escalate decision (see escalation #1). |
| **CF-SEC-3** (armed) | DPDP lawful-basis for PII ingested at the boundary. Satisfied for Sugandh Lok; **re-arms before any third-party-brand PII enters prod.** Add the consent/purpose column the legacy schema lacks (A6.2 register). |
| **CF-RES-1.a** (carried) | Positive-assert ap-south-1 on the new ingest write path at deploy; `/escalate` on assertion failure. |
| **CF-C3-FIRST-RUNTIME-1** | `ingestion-service` is a bare scaffold (`.gitkeep` only; no Kafka, no deploy pipeline). Standing up the first live Brain runtime + first Kafka topic is a Stage-2 architecture decision Aryan must scope explicitly (the Shape-B scope-inflation trap that bit Child 1) — decide whether the framework ships behind a deploy-pipeline track (@jatin) or stays LOCAL-verified-only this child. |
| **CF-C3-NO-CUTOVER-AT-FESTIVAL-1** | Runbook scheduling constraint: no live connector cutover during a known festival traffic window (RTO/COD volume amplifies the data-loss window). |

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-24T19:42:00Z",
  "actor": "cto-advisor",
  "type": "stage1-intake",
  "req_id": "feat-connector-framework-cutover",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "epic_child_id": "child-3-connector-framework",
  "stage": 1,
  "decision": "ADVANCE",
  "lane": "high-stakes",
  "paradigm": "sql",
  "persona_count": 2,
  "needs_personas": ["connector-cutover-token-handoff-realist:sonnet", "india-connector-pii-secrets-compliance-officer:sonnet"],
  "personas_spawned_by_me": false,
  "scope_refinement": "3a framework / 3b per-connector cutover ceremony (HOLD-AT-CUTOVER, Stage-8) / 3c residual-writer FORCE-unlock satisfied against Brain code",
  "dependency_check": "no-violation (Child-1 gate SATISFIABLE; Child-2 NOT required — connectors land raw)",
  "escalation": "armed-not-fired: (1) Secrets Manager non-existence vs CF-SEC-SECRETS-1 — fires at synthesis if no lawful interim custody; (2) CF-SEC-3 PII re-arm (Sugandh-Lok-only holds); mirrored non-blocking to pending-founder-attention.md",
  "maya_co_owns_stage2": false,
  "rationale": "Highest-risk child; sound+planable; split 3a/3b/3c + named HOLD-AT-CUTOVER keeps the irreversible flip out of the normal run; false 'Secrets Manager available' premise corrected"
}
```

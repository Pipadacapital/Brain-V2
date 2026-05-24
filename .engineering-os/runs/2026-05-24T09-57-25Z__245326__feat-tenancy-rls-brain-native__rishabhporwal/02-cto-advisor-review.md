# CTO Advisor Review — Stage 1 (intake / brainstorm)

> Filled by the CTO Advisor agent (Rohan) in Stage 1.
> Validates against [schemas/cto-advisor-review.schema.json](../schemas/cto-advisor-review.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-brain-native` |
| **Stage** | 1  *(intake)* |
| **Timestamp** | 2026-05-24T10:02:00Z |
| **Decision** | **ADVANCE**  *(personas requested first; synthesis pending orchestrator re-invoke)* |
| **Parent epic** | `chore-migrate-legacy-to-brain` — Brain-native rebuild of withdrawn `child-1-tenancy-auth-rls-hardening` |

---

## Pre-flight dependency check (mandatory — child requirement)

- This req is the **Brain-native rebuild** of the epic child `child-1-tenancy-auth-rls-hardening`.
- That child's `blocks` = `["child-0-audit-migration-architecture-spike"]`.
- `spike-legacy-migration-architecture` (= child-0) status = **`done`** in `state/active.json`.
- **Result: dependency SATISFIED. No violation. Proceed.**
- The withdrawn legacy implementation (`feat-tenancy-auth-rls-hardening`, status `awaiting-founder-commit`, untracked per Founder directive) is **reference-only**, not a blocker. This rebuild supersedes it on the active path.

## Semantic recall (v0.8.0)

`memory_search -k 6` top hit = `feat-tenancy-auth-rls-hardening` (similarity ~0.756) — the withdrawn legacy Child 1. This is **expected and intentional**, not a near-duplicate to bounce: same logical scope (RLS + session-context + cron-scoping + auth-claim), deliberately different vehicle (Brain-native, not legacy Prisma/Express). The hit is used as **proven reference to mine**, exactly per the requirement's instruction. No *other* shipped pattern to template; no accidental duplicate.

---

## Made requirements less dumb first

*The "delete / simplify / defer" pass before anything else.*

**Could delete:**
- Nothing core. The requirement is already tightly scoped (Child-1 slice of a binding epic) and the non-goals are correct.

**Could simplify (and the requirement already does, correctly):**
- **The auth/role-claim (1b) is claim-MAPPING, not invention.** Legacy `WorkspaceRole` is already 5-level (OWNER>ADMIN>MANAGER>ANALYST>VIEWER) and maps onto the canon's `viewer/analyst/agency/operator/owner`. This is a mechanical mapping behind the data-layer slice, never a new RBAC model. (Inherited finding from the legacy child — do not re-derive.)
- **Mine the proven legacy reference; do not re-derive.** The fail-closed policy shapes, the 45-model FK-scope classification (21 direct / ~18 connId-FK 1-hop / WoocommerceLineItem 2-hop / 4 global), the `rls-probe` GREEN predicate, the cron session-scoping, and the 6-step rollout runbook are all **proven, reviewed reference** on disk. Re-express them Brain-native; do not re-invent the analysis.

**Could defer (and the requirement already does, correctly):**
- **Applying RLS DDL to the live DB (the FORCE flip)** — explicitly a non-goal this run (deploy = Stage 8, runbook-gated, Founder-approved). **This is the load-bearing simplification** (see "The core architectural tension" below). It means the §4-processing acts that triggered the legacy child's DPDP escalation (CF-SEC-1 probe reading `Invitation.email`; `ShopifyCustomer` denorm backfill) **do not occur in this run** — they are Stage-8/live-deploy concerns.
- Money/minor-units (Child 2), connectors (Child 3), metric/OLAP (Child 4), AI (Child 5), frontend (Child 6), decommission (Child 7) — all correctly out of scope.
- Formal DPA / governance program — deferred to `chore-security-governance-hardening-phase` (Founder decision, on record).

---

## The core architectural tension (the meat for Aryan, Stage 2 — STRESS-TESTED here)

The requirement says "**Brain-native** RLS." That phrase hides two very different things, and conflating them is the trap this Stage-1 must expose:

**1. The infrastructure artifacts** — the SQL migrations (ENABLE+CREATE fail-closed policy, FORCE step, down.sql), the **session-context primitive** (`SET LOCAL app.workspace_id` equivalent, correct under pgbouncer txn-pool, bind-param), the RLS probe, and the rollout runbook. These genuinely *should* be Brain-native: authored to the new DDD standard, owned by a Brain package/service (per Child-0 A1 row 186, Identity/Tenancy → `core-service`), mined from the legacy reference. **No tension here — this is the deliverable.**

**2. The runtime consumer that must hold `app.workspace_id` on every connection once RLS is FORCE'd.** Here is the rub:

- The **Brain monorepo is scaffolding only** — zero implementation, no running service against that DB. The first product-code requirement (`chore-scaffold-monorepo`) only just shipped; there is **no Brain runtime** that queries the shared Postgres.
- The thing **actually hitting the live shared DB today is the running legacy Express deployment.**
- RLS policies are **fail-closed by design** (`col = current_setting('app.workspace_id',true)::uuid` → 0 rows when context unset). So the moment RLS goes **FORCE-on**, *any* consumer that does not set the workspace context gets **0 rows → production outage**, not a leak.
- Therefore: **you cannot honestly flip the C5 gate GREEN (RLS FORCE-live) before a context-aware runtime exists against that DB.** The previous legacy child's deploy stage literally recognized this — the platform journal records Stage 8 **"HOLD AT FORCE"**.

**The two candidate shapes (Aryan decides in Stage 2 — I frame, do not resolve):**

- **(A) Build-the-primitive-and-DDL-now, defer-the-FORCE-flip.** Deliver the Brain-native session-context primitive + the migrations package (ENABLE+CREATE policy in fail-closed shape) + the probe + the runbook **as Brain code**, but do **not** FORCE on the live DB this run. The C5 gate becomes **"satisfiable Brain-native"** — which is *exactly* what the requirement's own success metric says (line 56: "the C5 universal hard gate … is **satisfiable** Brain-native") and what its non-goal confirms (line 70: not applying RLS DDL to live this run). **This is my recommended framing** and I believe it is the correct deliverable boundary for a child-sized slice when there is no Brain runtime yet.

- **(B) Make the live legacy app context-aware via a minimal ACL/facade shim** so RLS can actually FORCE on the live DB without waiting for a Brain runtime. Per Child-0 A3 (lines 522-538) the facade/ACL is itself a **Brain** component sitting in front of legacy (not an edit to legacy internals), translating `connectionId`-scoped legacy rows → `workspace_id`-scoped Brain envelopes and injecting session context. **But:** (i) a *running* facade is itself a Brain runtime/deployment that does not exist yet — so this expands the child's scope into "stand up the first Brain runtime against the live DB"; (ii) "legacy is reference-only / no legacy edits" must be honored — the facade must inject context *without* modifying the legacy app's own DB-access code, or the legacy app must be retired-first for the migrated paths. That is a non-trivial sequencing decision.

**The question I am handing to the personas + Aryan:** *Is the right first move shape (A) — the session-context primitive + migrations package + probe + runbook as Brain-native code, FORCE deferred — and is the gate honestly "satisfiable Brain-native" without a Brain runtime? Or does honoring the C5 gate + the still-live legacy consumer force shape (B) (a context-injecting facade shim) into this child's scope?* This is the single decision that defines this child's deliverable boundary. It is **not** a CHALLENGE-BACK — the requirement is sound, well-scoped, and planable; this is the architectural question Stage 2 exists to settle. I am surfacing it so the persona pressure-tests it before Aryan binds it.

---

## Scope refinement (within ADVANCE — not a bounce)

Carry the legacy child's proven 1a→1b split, re-expressed Brain-native:

- **1a — data-layer isolation (Brain-native).** The session-context primitive (txn-local `set_config('app.workspace_id',$1,true)` inside an explicit transaction; pooled-vs-direct routing; bind-param, no injection) + the RLS migrations package (44-table ENABLE+CREATE fail-closed + FORCE + symmetric down) + FK-scope classification re-applied + the probe (RED-by-default → GREEN on cross-read=0 AND context-less=0) + cron session-scoping (no cross-workspace `findMany`). This is the C5-gate-establishing unit. Per shape (A), the **FORCE flip on live is deferred to Stage 8/deploy**; the *deliverable this run* is the Brain-native code + migrations + runbook that make the gate satisfiable.
- **1b — Brain auth/role-claim contract.** Map the existing Supabase JWT → Brain 5-level `WorkspaceRole`; `requireRole` on mutations. Claim-mapping, ships behind 1a. No DDL.

**Single-Primitive Rule (explicit):** the session-context primitive is built **once** and consumed N times (every workspace-scoped read/write, every cron per-connection unit, the probe). The requirement's "built once, consumed N times" framing is correct and must hold — flag any per-call-site re-implementation as a violation at Stage 6.

---

## Personas spawned *(Stage 1 — count decision below)*

1. **`live-rollout-strangler-realist`** — see [`03-persona-live-rollout-strangler-realist.md`](.)

**Synthesis:** **DONE — see [`05-stage1-synthesis.md`](.) (2026-05-24T10:12:00Z).** Persona ACCEPTED (5 in-lane concerns: 1 CRITICAL, 3 HIGH, 1 MEDIUM — all folded, none dropped). Outcome: confirms ADVANCE; binds **shape A** as the one deliverable boundary (CF-BN-SHAPE-A-1); promotes **CF-BN-GATE-BOUNDARY-1 to CRITICAL/binding** (Aryan must produce a decision-logged amendment to Child-0 §A2.2 changing "RLS live" → "satisfiable Brain-native + FORCE deferred per a named HOLD-AT-FORCE state"); adds **CF-BN-DDL-GATING-1** (runbook-gated/manual RLS DDL) + sharpens CF-C1-ROLLOUT-ORDER-1 (quiesce at ENABLE *and* FORCE), CF-C1-POOL-1.a (local pgbouncer-txn-pool test at Stage 3), CF-BN-OWNER-1 (bind path *and* interface signature). Escalation: no blocking `/escalate`; mirrored to pending-founder-attention.md for visibility (amends a Founder-approved binding gate; Founder already ratified the HOLD-AT-FORCE pattern on the sibling).

---

## Persona-count decision *(MANDATORY)*

**Count chosen: 1.**

**Rationale (classifier rule fired):** This is high-stakes (lane caps at 2), but **one risk dimension dominates** and it is *not* the dimensions the legacy child needed two personas for. The legacy Child 1 spawned 2 because two live, unsettled dimensions intersected: (engineering) the live RLS rollout mechanics, AND (compliance) an *open* DPDP §4/§7 lawful-basis ambiguity that gated build.

For this rebuild, **the compliance dimension is largely SETTLED, not open:**
- DPDP lawful-basis (CF-SEC-3) is **RESOLVED** — Founder is legal owner/controller of Sugandh Lok (the only in-scope brand), authorized processing on his own brand's data; formal governance deferred to `chore-security-governance-hardening-phase`. The tripwire **re-arms before any third-party brand PII** — a known, *carried* constraint, not a live ambiguity.
- Residency is **confirmed `ap-south-1`** — no §16 transfer escalation; CF-RES-1 carries as an assert-at-deploy step.
- Crucially, because this run **defers the FORCE flip and the live probe** (non-goal line 70), the §4-processing acts that triggered the legacy escalation (probe reading `Invitation.email`; `ShopifyCustomer` denorm backfill) **do not occur in this run**. A compliance persona would be re-litigating an already-resolved, currently-inactive question — i.e., a "looks good" persona, which I reject by policy.

What genuinely dominates and is **unsettled** is a single engineering/sequencing dimension: **can a "Brain-native RLS" child be delivered, and the C5 gate be honestly satisfiable, when there is no Brain runtime against the live DB and a live legacy consumer still queries it?** (shapes A vs B above). That is exactly one persona's job.

I considered but **declined** a second persona:
- An `india-data-isolation-compliance-officer` — declined: compliance is settled for this run (above); spawning it would burn tokens to re-confirm a resolved escalation. The CF-SEC-3.HARD re-arm is carried as a binding constraint regardless.
- An `ai-cost-realist` — declined: pure SQL/DDL + connection-handling; no compute/LLM path.
- A generic architecture persona — declined: the A-vs-B shape decision is Aryan's binding Stage-2 job; the persona's role is to *adversarially pressure-test* it, which the strangler-realist does, not to duplicate the architect.

**This is NOT a reflexive 2.** The honest read is 1.

**Persona depth tag: `:sonnet`.** This is reasoning-heavy, not a bounded checklist — it must reason about deployment sequencing, the fail-closed-FORCE-without-runtime failure mode, the strangler facade's role vs the "no legacy edits" constraint, and where the deliverable boundary honestly sits. Multi-step adversarial reasoning over a live-migration nuance = `:sonnet`, not `:haiku`.

---

## Binding contract (acceptance inputs carried for Aryan / Shreya / Tanvi)

Inherited from Child-0 + the legacy Child-1 (proven reference — re-express Brain-native, do not import code):

- **CF-RES-1.a** — assert region `ap-south-1` at the Postgres level on BOTH pooled (:6543) and direct (:5432) URLs before any RLS DDL. (Confirmed fact; legacy `.env.bak.singapore` proves a move happened — assert, never trust.)
- **CF-SEC-1** — fail-closed RLS probe: RED-by-default → GREEN on (cross-read=0 AND context-less=0) per workspace-scoped table; transition Decision-Logged. (Probe *code* this run; live *run* at Stage 8.)
- **CF-SEC-3.HARD** — satisfied for Child 1 (Founder owns Sugandh Lok); **RE-ARMS before any third-party brand PII** is processed. Carry verbatim.
- **CF-SEC-5** — correlation-ID 4-tuple (`request_id`/`trace_id`/`workspace_id`/`user_id`) on every new Brain runtime path.
- **CF-C1-POOL-1.a** — session-context correct under pgbouncer txn-pool: txn-local `set_config('app.workspace_id',$1,true)` inside an explicit transaction; **session-level SET banned; bind-param (no injection).**
- **CF-C1-RLS-DEFAULT-1.a** — fail-closed shapes only: `(col = current_setting('app.workspace_id',true)::uuid)`. **Banned:** `OR ... IS NULL`, `COALESCE`, `USING(true)`, session-SET, bare-singleton RLS query.
- **CF-C1-FK-SCOPE-1.a** — all 45 models classified; every workspace-scoped table (incl. FK-transitive) protected via JOIN-policy or `workspace_id` denorm; per-table live `EXPLAIN` decision-gate (a Stage-8 pre-step).
- **CF-C1-CRON-SCOPE-1.a** — cron fan-out per-workspace-session-scoped; no cross-workspace `findMany` remains; per-connection try/catch + proof-of-attempt preserved.
- **CF-C1-AUDITLOG-1.a** — nullable-`workspace_id` tables (AuditLog, Notifications) get dual-policy (ws-scoped + SUPERADMIN-only for null rows).
- **CF-C1-ROLLOUT-ORDER-1 / QUIESCE-1** — the harness-asserted rollout sequence (region-assert both URLs → quiesce-crons-first → context-code → ENABLE+CREATE → probe GREEN → FORCE per table → smoke); FORCE rollback = DDL not flag. (Runbook *artifact* this run; *execution* at Stage 8.)
- **CF-C1-ZERO-BEHAVIOR-1** — byte-identical live API behavior; zero downtime; per-slice reversible.

**NEW Brain-native-specific constraints (this rebuild adds):**
- **CF-BN-OWNER-1** — the session-context primitive + RLS migrations live in a **Brain package/service** (candidate: `core-service` per A1 row 186), authored to the new DDD standard, NOT in legacy. Aryan binds the exact home in Stage 2.
- **CF-BN-NOLEGACY-1** — zero legacy code imported/edited/committed; legacy stays reference-only on disk. Any builder touching `legacy project/` = drift bounce.
- **CF-BN-GATE-BOUNDARY-1** — the deliverable boundary (shape A vs B) is explicitly settled in the Stage-2 plan, with the C5-gate "satisfiable Brain-native" success criterion made falsifiable (what exactly is GREEN at end of this run vs deferred to Stage 8). This is the persona's + Aryan's central question.

---

## Paradigm recommendation

**Recommended paradigm:** `sql`  *(SQL/DDL + connection-handling)*

**Why:** Pure deterministic data-layer work — RLS DDL, session-context binding, FK-scope classification, cron session-scoping, JWT-claim mapping. No patterns-without-rules (no ML), no NL boundary (no LLM). Cost-routing audit clean; zero over-reach. (Matches the legacy child's paradigm exactly.)

> Architect (Aryan) may refine in Stage 2 — this is a first-pass read. No Maya (intelligence) co-owner needed: no metric/money/AI/numeric-parity dimension in this slice.

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | N/A directly — but RLS protects the order/shipment/RTO data that the RTO model will read. No isolation = cross-brand RTO leakage downstream. |
| **COD** | N/A directly — same: protects COD/payment data integrity per workspace. |
| **GST** | N/A directly — money/tax is Child 2; the seam must not violate minor-units (it doesn't — no money handling here). |
| **Festival seasonality** | N/A — no seasonal compute in this slice. |
| **Pincode reliability** | N/A directly — protects pincode/courier data per workspace downstream. |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | N/A — no outbound channel in this slice. |
| **DPDP / data isolation (the relevant lens)** | **PRIMARY.** This slice closes the **0-RLS cross-tenant-leak P0** (the live `pending-founder-attention.md` top item). DPDP §8(6) cross-brand leak is the risk being mitigated. Lawful-basis CF-SEC-3 resolved for Sugandh Lok (Founder-owned); re-arms before third-party PII. Residency `ap-south-1` confirmed. Note: the §4-processing acts (live probe/backfill) are **deferred to Stage 8** by this run's non-goals — so the run itself processes no live PII. |
| **Region adapter** | Seam must not block ae/sa later (region_impact = `in` now; RegionAdapter unaffected — RLS is region-agnostic). |

---

## Lane decision *(MANDATORY — v0.8.0 risk tiering)*

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Trigger-surface scan fires on MULTIPLE surfaces — no carve-out applies. The foundational-scaffolding carve-out is **explicitly inapplicable** (this touches live tenant data semantics, PII tables, and money-adjacent isolation — the carve-out is barred when any money/PII/india-compliance surface is present). Conservative tie-break forbids any downgrade. |
| **trigger_surfaces_touched** | `auth` (Supabase JWT → Brain WorkspaceRole claim, `requireRole`), `multi-tenancy` (`workspace_id` RLS — the entire point), `pii` (workspace-scoped tables include `Invitation.email`, `ShopifyCustomer` PII — even though live processing is deferred), `schema-proto` (RLS DDL migrations on the shared schema; session-context primitive contract), `india-compliance` (DPDP §8(6) cross-tenant isolation; CF-SEC-3 re-arm tripwire), `connectors` (cron sync fan-out session-scoping touches connector sync paths). |

**Stages that will run (high-stakes lane):** 1 (intake + 1 persona) → 2 (architect, Aryan) → 3 (build) → 4 (security VETO, Shreya) → 5 (QA VETO, Tanvi) → 6 (final review VETO, Rohan) → 7 (Founder gate) → 8 (deploy + monitor, Jatin — where the FORCE flip lives, runbook-gated). Full rigor; no stage drops.

---

## Decision

**ADVANCE** — personas requested first (1 × `:sonnet`). Synthesis pending orchestrator re-invoke.

The requirement is **sound, well-scoped, and planable**. It correctly closes the open 0-RLS P0 on the active (Brain-native) path, correctly mines the proven legacy reference without importing legacy code, and correctly defers the live FORCE flip to Stage 8. It is **not** a CHALLENGE-BACK and **not** a KILL. The one unsettled question (the deliverable boundary — shape A vs B, can the gate be satisfiable Brain-native with no Brain runtime) is precisely what one adversarial persona + Aryan's Stage-2 plan exist to settle.

---

## Escalation

**None at intake.** The legacy child's two escalation triggers are both already resolved by Founder decision on record (DPDP lawful-basis via Sugandh Lok ownership; residency `ap-south-1`). No new canon ambiguity, no cost-model threat, no moat change, no irreversible decision this run (FORCE deferred). The CF-SEC-3.HARD re-arm is a **carried constraint**, not a live escalation. The A-vs-B deliverable-boundary question is an *architecture* decision (Aryan), not a Founder escalation.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-24T10:02:00Z",
  "actor": "cto-advisor",
  "type": "intake-advance",
  "req_id": "feat-tenancy-rls-brain-native",
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "trigger_surfaces_touched": ["auth","multi-tenancy","pii","schema-proto","india-compliance","connectors"],
  "persona_count": 1,
  "needs_personas": ["live-rollout-strangler-realist:sonnet"],
  "paradigm": "sql",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "rebuild_of": "feat-tenancy-auth-rls-hardening",
  "dependency_check": "satisfied (child-0 spike done)",
  "next": "personas -> Rohan synthesis -> Architect (Aryan) Stage 2"
}
```

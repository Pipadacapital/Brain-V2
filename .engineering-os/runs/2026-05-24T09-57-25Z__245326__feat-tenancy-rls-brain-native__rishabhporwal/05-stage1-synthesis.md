# Stage 1 — Synthesis (CTO Advisor / Rohan)

> Synthesis pass: reached after the orchestrator spawned the requested persona (`03-persona-live-rollout-strangler-realist.md`) and re-invoked Rohan. Folds the persona into the binding contract carried to Stage 2 (Architect / Aryan).
> Pairs with `02-cto-advisor-review.md` (intake pass). Validates the Stage-1 DoD.

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-brain-native` |
| **Stage** | 1 (synthesis) |
| **Timestamp** | 2026-05-24T10:12:00Z |
| **Decision** | **ADVANCE → Architect (Aryan), Stage 2** |
| **Lane** | high-stakes (confirmed; unchanged) |
| **Paradigm** | `sql` (SQL/DDL + connection-handling; no ML/LLM) — confirmed |
| **Maya (intelligence) co-owner** | **No** — no metric/money/AI/numeric-parity dimension in this slice |
| **Parent epic** | `chore-migrate-legacy-to-brain` — Brain-native rebuild of withdrawn `child-1-tenancy-auth-rls-hardening` |

---

## 1. Persona accept / reject

**Persona: `live-rollout-strangler-realist:sonnet` — ACCEPTED.**

It surfaced **5 genuine, in-lane concerns** (1 CRITICAL, 3 HIGH, 1 MEDIUM), all materially advancing the deliverable-boundary question I framed at intake and none of them a "looks good" pass. It did exactly its job: it pressure-tested the four questions I handed it and converted my recommended *framing* (shape A, FORCE deferred) into a *binding obligation with a falsifiable test* — it found the one way shape A silently fails (ship against an unamended gate) and named the precise fix (a decision-logged amendment to the binding Child-0 §A2.1 + a named hold state). I independently verified its CRITICAL against the source: Child-0 `06-architecture-plan.md` §A2.2 line 501 states the Child-1 exit criterion verbatim as **"RLS live + verified on all workspace-scoped tables"** and line 502 states Child-2's entry criterion as **"RLS live"** — both are machine-checkable state, not prose. The persona's claim is accurate, not rhetorical.

No concern is silently dropped. Disposition of all 5 below.

---

## 2. Disposition of all 5 concerns (folded into the binding contract)

| # | Sev | Persona concern (one-line) | Disposition | Carried as |
|---|-----|----------------------------|-------------|------------|
| 1 | **CRITICAL** | §A2.1/§A2.2 says "RLS live + verified," NOT "satisfiable"; the success-metric rewrite is not self-authorizing — without a decision-logged amendment + named HOLD state, Child-2 pre-flight correctly BLOCKS on "RLS live = false" | **ACCEPT — binds as the headline Stage-2 deliverable.** Aryan must produce a written, decision-logged amendment to Child-0 §A2.2 (Child-1 exit row + Child-2 entry row) + a **named "HOLD AT FORCE" hold state** recorded in the binding architecture, else this child ships against a gate it cannot satisfy by its own architecture's terms. | **CF-BN-GATE-BOUNDARY-1 (SHARPENED → now CRITICAL/binding):** Stage-2 deliverable = a decision-logged §A2.2 amendment ("RLS migrations + session-context primitive + probe + runbook present Brain-native; FORCE execution deferred per named HOLD-AT-FORCE state; gate satisfiable Brain-native") + the named hold state reflected in `state/active.json` exit criteria for this child. |
| 2 | **HIGH** | Shape B (live ACL shim) is out of scope (needs the first Brain runtime; collides with CF-BN-NOLEGACY-1). Shape A is the only viable shape. | **ACCEPT — promote shape A from "recommended framing" to the one unambiguous binding Stage-2 decision.** Confirmed: the only mechanism that lets the live legacy app set context without editing it is a Brain-resident network-boundary shim = a Brain runtime = scope inflation + first-runtime-deployment, which the child-sized-slice discipline and the scaffolding-only monorepo forbid. | **CF-BN-SHAPE-A-1 (NEW):** the deliverable is shape A — primitive + migrations + probe + runbook as Brain code; FORCE deferred to Stage 8. Shape B is explicitly out of scope this child. Aryan binds shape A in Stage 2 (closes the A-vs-B question I left open at intake). |
| 3 | **HIGH** | quiesce-crons must be required at ENABLE time (not only FORCE); even `ENABLE` (no FORCE) gates `authenticated`-role reads → partial outage; `step-a-enable-create.sql` must be runbook-gated DDL, not migration-runner-applied | **ACCEPT.** This is the real teeth of "satisfiable but not flipped": the intermediate ENABLE-but-not-FORCE state is hazardous for any non-service-role connection. Two Stage-2 decisions required: (i) the migrations package marks the RLS DDL as **runbook-gated / manual** (e.g. `migrations/manual/rls/`) so a stray `prisma migrate deploy` cannot apply it; (ii) the runbook requires quiesce-crons **before ENABLE**, not only before FORCE — preserving legacy CF-C1-ROLLOUT-ORDER-1. | **CF-C1-ROLLOUT-ORDER-1 (SHARPENED):** quiesce-crons-FIRST applies at ENABLE *and* FORCE; even ENABLE-without-FORCE is not a safe partial state for non-service-role paths. **CF-BN-DDL-GATING-1 (NEW):** RLS DDL ships as runbook-gated/manual artifacts, structurally un-applicable by the migration runner; not run against the live DB in this run. |
| 4 | **HIGH** | session-context pool-correctness must have a LOCAL pgbouncer-txn-pool integration test at Stage 3 (the legacy child hit this isolation gap at QA — untestable in isolation) | **ACCEPT.** The legacy child could only confirm pool-correctness against live `:6543/:5432`, deferring it to Stage 8 — a QA gap. The Brain-native child can and must close it locally so Stage-5 QA is completable without live-DB access. | **CF-C1-POOL-1.a (SHARPENED):** Stage-2 plan must prescribe a LOCAL integration test (e.g. `supabase start` + pgbouncer txn-pool mode, `:6543` and `:5432` listening) exercising `withWorkspace()` under interleaved concurrent transactions, asserting (a) no context leak across pooled connections and (b) txn-end/`RESET ALL` clears `app.workspace_id`. This is a Stage-3 deliverable + a Stage-5 QA gate, not a Stage-8 deferral. |
| 5 | **MEDIUM** | "satisfiable but not flipped" is honest ONLY with a named hold state recorded in the binding architecture | **ACCEPT — same root as #1; this is its enforceability rationale.** Folds into CF-BN-GATE-BOUNDARY-1: the named HOLD-AT-FORCE state must live in the binding architecture (not an informal understanding), mirroring the legacy child's explicitly-recorded Stage-8 "HOLD AT FORCE" discipline — which the Founder himself ratified as a Stage-7 binding directive on the sibling (`feat-tenancy-auth-rls-hardening`, decision-log 2026-05-24T09:25:28Z). | Folded into **CF-BN-GATE-BOUNDARY-1** (named hold state is a required component of the amendment). |

**Single-Primitive Rule (carried, reinforced by persona #2's deeper point):** the session-context primitive is built **once** in a Brain package with a settled path + exported interface signature and consumed N times. The persona correctly notes the monorepo's package-boundary discipline makes CF-BN-OWNER-1's path/interface decision *load-bearing from the first use* (Child 3 connectors / Child 4 metrics will import it) — so Aryan must bind the path **and** the exported signature (`withWorkspace<T>(workspaceId, fn) ` + `withSuperadmin<T>(fn)`) in Stage 2, not just the owning package.

---

## 3. Confirmations (held from intake, re-affirmed at synthesis)

- **Lane: high-stakes** — unchanged. The persona did not surface any surface that would change the lane; it reinforced the trigger surfaces (multi-tenancy, schema-proto, auth, connectors via cron fan-out).
- **Paradigm: `sql`** — confirmed. Pure deterministic data-layer work (RLS DDL + connection-handling + JWT-claim mapping). No ML, no LLM, no cost-routing path. Audit clean.
- **No Maya co-owner** — confirmed. No metric/money/AI/numeric-parity dimension. (Money is Child 2; the seam must not violate minor-units, and it does not — no money handling here.)
- **DPDP CF-SEC-3 + residency: resolved-on-record.** CF-SEC-3 is satisfied for this run (Founder is legal owner/controller of Sugandh Lok, the only in-scope brand). **CF-SEC-3.HARD re-arms before any third-party-brand PII is processed** — carried verbatim as a binding constraint; NOT triggered this run because the live probe + denorm backfill (the §4-processing acts) are deferred to Stage 8 per non-goal line 70. Residency confirmed `ap-south-1`; CF-RES-1.a carries as an assert-at-deploy step on BOTH pooled + direct URLs. No §16 transfer escalation. The persona correctly raised no compliance concern — validating my intake decision to decline a second (compliance) persona.

---

## 4. Escalation decision (NEW assessment this pass)

**No blocking `/escalate` to the Founder. Mirror to `pending-founder-attention.md` for visibility (non-blocking).**

The gate-language amendment (CF-BN-GATE-BOUNDARY-1) is an **architecture-governance act that Aryan owns at Stage 2 and Rohan signs at Stage 6** — it is not a CHALLENGE-BACK and not a canon/compliance/cost-model ambiguity that my escalation rubric forces upward. BUT it materially **amends a Founder-approved binding architecture** (the Child-0 spike, status `done`) whose gate definition downstream dependency checks (Children 2–7) mechanically enforce against. Under my rubric, an act that changes the Memory-Layer/Decision-Log moat or a binding gate warrants Founder *visibility*, even when it does not require Founder *permission*.

The reason this is visibility-not-permission: the Founder **already ratified exactly this pattern** on the sibling slice — his own Stage-7 directive on `feat-tenancy-auth-rls-hardening` (decision-log 2026-05-24T09:25:28Z) is literally "advance to Stage 8 but **HOLD at STEP-5 FORCE**." Deferring FORCE while the code/migrations/runbook ship is the Founder's own established discipline. The amendment formalizes that same discipline at the architecture-gate level for the Brain-native path. So this informs the Founder that a binding gate he approved will be amended (with rationale + decision-log pointer) — it does not ask him to decide something new.

**Action taken:** appended a non-blocking note to `.engineering-os/pending-founder-attention.md` ("Heads-up: Child-0 §A2.2 gate amendment incoming at Stage 2"). The pipeline continues to Stage 2; the amendment itself is produced + decision-logged by Aryan and reviewed by Rohan at Stage 6.

---

## 5. Headline Stage-2 obligations for Aryan (the synthesis hand-off)

1. **(CRITICAL, headline) Produce the gate-language amendment.** Write a decision-logged amendment to Child-0 `06-architecture-plan.md` §A2.2 — change the Child-1 exit row from "RLS live + verified on all workspace-scoped tables" to the satisfiable-Brain-native + FORCE-deferred wording, define a **named HOLD-AT-FORCE state**, and reconcile the Child-2 entry row ("RLS live") so the downstream dependency check reads the amended (not the ghost) criterion. Reflect the named hold state in `state/active.json` Child-1 exit criteria. *(CF-BN-GATE-BOUNDARY-1, concerns 1 + 5.)*
2. **Bind shape A as the one deliverable boundary** — primitive + RLS migrations + probe + runbook as Brain code, FORCE deferred to Stage 8; shape B explicitly out of scope. *(CF-BN-SHAPE-A-1, concern 2.)*
3. **Settle the architecture-governance question** (the §4 escalation read): confirm the amendment is the correct mechanism (vs any alternative) and that it is decision-logged + Founder-visible — this is the act Rohan signs at Stage 6.
4. **Make ENABLE/FORCE execution boundary explicit + runbook-gated** — RLS DDL is manual/runbook-gated (un-applicable by the migration runner); quiesce-crons-FIRST at ENABLE *and* FORCE. *(CF-BN-DDL-GATING-1 + CF-C1-ROLLOUT-ORDER-1, concern 3.)*
5. **Prescribe the local pgbouncer-txn-pool integration test** as a Stage-3 deliverable + Stage-5 QA gate. *(CF-C1-POOL-1.a, concern 4.)*
6. **Bind the primitive's package path + exported interface signature** (not just the owning package) so the Single-Primitive Rule holds at first cross-child import. *(CF-BN-OWNER-1, concern 2 deeper point.)*

---

## 6. Folded binding contract carried to Stage 2 (full CF-* list)

**Inherited (Child-0 + legacy Child-1 proven reference — re-express Brain-native, do not import code):**
- **CF-RES-1.a** — assert region `ap-south-1` on BOTH pooled (:6543) + direct (:5432) URLs before any RLS DDL.
- **CF-SEC-1** — fail-closed RLS probe: RED-by-default → GREEN on (cross-read=0 AND context-less=0) per workspace-scoped table; transition Decision-Logged. (Probe *code* this run; live *run* at Stage 8.)
- **CF-SEC-3.HARD** — satisfied this run (Founder owns Sugandh Lok); **RE-ARMS before any third-party-brand PII**. Carry verbatim.
- **CF-SEC-5** — correlation-ID 4-tuple (`request_id`/`trace_id`/`workspace_id`/`user_id`) on every new Brain runtime path.
- **CF-C1-POOL-1.a (SHARPENED)** — txn-local `set_config('app.workspace_id',$1,true)` inside an explicit transaction; session-level SET banned; bind-param (no injection); **+ LOCAL pgbouncer-txn-pool integration test at Stage 3 (leak + clear assertions); Stage-5 QA gate.**
- **CF-C1-RLS-DEFAULT-1.a** — fail-closed shapes only `(col = current_setting('app.workspace_id',true)::uuid)`; banned: `OR…IS NULL`, `COALESCE`, `USING(true)`, session-SET, bare-singleton RLS query.
- **CF-C1-FK-SCOPE-1.a** — all 45 models classified; every workspace-scoped table (incl. FK-transitive) protected via JOIN-policy or `workspace_id` denorm; per-table live `EXPLAIN` decision-gate (Stage-8 pre-step).
- **CF-C1-CRON-SCOPE-1.a** — cron fan-out per-workspace-session-scoped; no cross-workspace `findMany`; per-connection try/catch + proof-of-attempt.
- **CF-C1-AUDITLOG-1.a** — nullable-`workspace_id` tables (AuditLog, Notifications) get dual-policy (ws-scoped + SUPERADMIN-only for null rows).
- **CF-C1-ROLLOUT-ORDER-1 / QUIESCE-1 (SHARPENED)** — region-assert both URLs → **quiesce-crons-FIRST (at ENABLE *and* FORCE)** → context-code → ENABLE+CREATE → probe GREEN → FORCE per table → smoke; FORCE rollback = DDL not flag. (Runbook *artifact* this run; *execution* at Stage 8.)
- **CF-C1-ZERO-BEHAVIOR-1** — byte-identical live API behavior; zero downtime; per-slice reversible.

**Brain-native-specific (this rebuild):**
- **CF-BN-OWNER-1 (REINFORCED)** — session-context primitive + RLS migrations live in a Brain package/service (candidate `core-service`, A1 row 186), DDD-standard, NOT in legacy. Stage 2 binds the **exact package path AND the exported interface signature** (`withWorkspace<T>` + `withSuperadmin<T>`).
- **CF-BN-NOLEGACY-1** — zero legacy code imported/edited/committed; legacy stays reference-only on disk. Any builder touching `legacy project/` = drift bounce.
- **CF-BN-SHAPE-A-1 (NEW)** — deliverable = shape A (primitive + migrations + probe + runbook as Brain code, FORCE deferred to Stage 8). Shape B (live ACL shim) explicitly out of scope this child.
- **CF-BN-GATE-BOUNDARY-1 (SHARPENED → CRITICAL/binding)** — Stage-2 deliverable: decision-logged amendment to Child-0 §A2.2 (Child-1 exit + Child-2 entry rows) changing "RLS live" → "satisfiable Brain-native + FORCE deferred per named HOLD-AT-FORCE state"; named hold state reflected in `state/active.json`; Founder-visible (mirrored to pending-founder-attention.md). Makes the success metric falsifiable: what is GREEN end-of-run vs deferred to Stage 8.
- **CF-BN-DDL-GATING-1 (NEW)** — RLS DDL ships as runbook-gated/manual artifacts (e.g. `migrations/manual/rls/`), structurally un-applicable by the migration runner; not run against the live DB in this run.

---

## 7. Decision

**ADVANCE → Architect (Aryan), Stage 2.** The requirement is sound, well-scoped, and planable; the persona confirmed shape A and converted the gate-honesty risk into a precise, falsifiable Stage-2 obligation. Not a CHALLENGE-BACK, not a KILL. The single defining decision — the deliverable boundary + the gate-language amendment that makes it honest — is exactly Stage 2's job, now bound as Aryan's headline deliverable.

---

## 8. Decision-log entry (mirrored)

```json
{
  "ts": "2026-05-24T10:12:00Z",
  "actor": "cto-advisor",
  "type": "intake-synthesis-advance",
  "req_id": "feat-tenancy-rls-brain-native",
  "decision": "ADVANCE",
  "next_stage": 2,
  "next_agent": "architect",
  "lane": "high-stakes",
  "paradigm": "sql",
  "maya_needed": false,
  "persona_accepted": "live-rollout-strangler-realist:sonnet (5 concerns: 1 CRITICAL, 3 HIGH, 1 MEDIUM — all folded)",
  "headline_stage2_obligation": "decision-logged amendment to Child-0 A2.2 gate language (RLS live -> satisfiable Brain-native + FORCE deferred per named HOLD-AT-FORCE state) + bind shape A + runbook-gated DDL + local pgbouncer-txn-pool test + primitive path/signature",
  "new_constraints": ["CF-BN-SHAPE-A-1","CF-BN-DDL-GATING-1"],
  "sharpened_constraints": ["CF-BN-GATE-BOUNDARY-1->CRITICAL","CF-C1-ROLLOUT-ORDER-1 (quiesce at ENABLE+FORCE)","CF-C1-POOL-1.a (local pgbouncer test)","CF-BN-OWNER-1 (path+signature)"],
  "escalation": "no blocking /escalate; mirrored to pending-founder-attention.md for visibility (amends a Founder-approved binding gate; Founder already ratified the HOLD-AT-FORCE pattern on the sibling 2026-05-24T09:25:28Z)",
  "next": "Architect (Aryan) Stage 2"
}
```

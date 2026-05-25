# CTO Advisor Review — Stage 1 (intake)

> Filled by the CTO Advisor agent in Stage 1 (intake). Child 7 of EPIC `chore-migrate-legacy-to-brain` — the FINAL child (legacy decommission). A DESIGN/RUNBOOK child (like Child-0 the spike): no app code; execution is Stage-8 / Founder-gated.

| Field | Value |
|-------|-------|
| **req_id** | `feat-legacy-decommission` |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-25T07:30:00Z |
| **Decision** | **ADVANCE** *(1 persona requested first; synthesis after orchestrator re-invoke)* |

---

## Lane decision

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Trigger-surface scan fires multiple hard surfaces: `india-compliance` (DPDP — retiring the legacy authoritative PII store + retention-compliant archival + erasure-scopability of a decommissioned store), `auth`/`connectors` (the C8 plaintext-credential destruction completes the single-owner token handoff — irreversible), `multi-tenancy` (the legacy DB holds all-workspace data; its retirement is a per-tenant-data-authoritativeness handoff), `schema-proto`/`money` (the `workspace_daily_metrics` single-writer C2 final state = `legacy-reads-decommissioned`, the billing base). Foundational-scaffolding carve-out **inapplicable** (this is the opposite of empty homes — it destroys live state). Conservative tie-break moot: multiple hard surfaces force high-stakes outright. |
| **trigger_surfaces_touched** | `india-compliance`, `auth`, `connectors`, `multi-tenancy`, `schema-proto`, `money` |
| **shape** | **design/runbook-only** (no app code build) — same lane-degradation as Child-0. Stages that run: 1 (intake) → 2 (decommission-runbook plan, Aryan) → 6 (Rohan final review: compliance + reversibility IS the gate, my VETO). NO Stage-3/4/5 code build, NO Shreya/Tanvi code review of nonexistent code (Tanvi degrades to artifact-completeness + internal-consistency; Shreya reviews the irreversibility/PoNR/credential-destruction design as a design-level VETO — same degradation Child-0 used). EXECUTION of the cutovers is Stage-8 / Founder-gated, NOT this child. |

**Why high-stakes lane WITHOUT a code build:** the high-stakes classification is correct (this is the single most irreversible child in the program) but the *deliverable* is a binding runbook + final-state verification checklist + a point-of-no-return ledger, not code. The rigor lands on the **design review** (Stage 6, mine), not on mutation tests of code that does not exist. This mirrors Child-0 exactly (high-stakes design child; code-specific gates degrade to design analogues per the spike's §13/QA-lane note, arch line 1089).

---

## Made requirements less dumb first

**Could delete:** nothing. Every scope line is load-bearing for a safe retirement. The temptation to delete the "reversibility tree per hold" is exactly wrong — that tree is THE load-bearing artifact (it is what makes the PoNR honest).

**Could simplify:** do NOT re-derive the per-child cutover gates here. Each held cutover already carries its own parity gate + rollback tree, authored in that child's run (Child-1 HOLD-AT-FORCE 6-step rollout + `down.sql`; Child-3 per-connector A4 rollback decision tree + ceremony; Child-4 read-source flip + CACHE-PURGE-C4C5; Child-5 serve-flip + cache-purge + graduation; Child-6 route-flip + production JWT). Child-7's runbook **references and sequences** those existing gates — it does not restate them. The runbook's net-new content is (a) the ONE dependency-correct ORDER across the six holds, (b) the program-level point-of-no-return ledger, (c) the legacy-DB archival + shutdown disposition, (d) the DPDP close-out. Aryan binds; he must not duplicate the per-child gates.

**Could defer:** the actual flipping of each hold is ALREADY deferred — it is Stage-8 / Founder-at-console execution, gated per the named hold. This child only PLANS the sequence. The `chore-security-governance-hardening-phase` handoff (deferred from earlier children) is correctly noted as a forward-handoff, not pulled into this child.

---

## Challenge (the five Stage-1 questions you asked me to rule)

These are answered as intake *rulings/findings*, not as a CHALLENGE-BACK (the requirement is sound and well-shaped). I record them so Aryan plans against fixed answers.

### (a) The ORDER — is there ONE dependency-correct hold-release sequence, and what is the explicit point-of-no-return per hold?

**Yes, there is exactly one safe order, and it is forced by the Child-0 DAG** (arch line 515: `0→1→2→4→5→6→7`, plus `1→3→(3 feeds 4)`, `1→6, 2→6, 4→6, 5→6`) and the single-writer/single-owner constraints. The release order is NOT the build order — it is the *authoritativeness-handoff* order, bottom-up from the data spine:

1. **HOLD-AT-FORCE (Child-1 RLS)** — live RLS FORCE on the legacy DB. Pre-req per arch line 499/505: Child-3 residual-writer conversion complete + a complete bare-write grep GREEN (the legacy grep was DEFECTIVE — must NOT exclude backfill/discoverChannels) + FK-scope EXPLAIN per table. This FORCEs *before* connector/read flips because the live DB must be tenant-isolated before Brain becomes its authoritative consumer. Reversibility: `NO FORCE → DISABLE → DROP POLICY` (DDL in `down.sql`). **NOT a PoNR.**
2. **HOLD-AT-CUTOVER (Child-3 connectors, per-connector, Shiprocket LAST)** — single-owner token transfer. Reversible via the A4 rollback tree (hand token back, re-register legacy webhook, replay from API) UNTIL the **legacy plaintext credential is destroyed (C8)**. **The plaintext-delete is the per-connector PoNR.** Shiprocket last because it has NO historical replay (arch line 157/554) → largest rollback window, longest pre-cutover shadow.
3. **HOLD-AT-READ-FLIP (Child-4 metrics)** — flip `workspace_daily_metrics` read source: `legacy-writes/Brain-reads-shadow → Brain-writes/legacy-reads-fallback → legacy-reads-decommissioned` (arch line 508/542). Gated on exact-integer-equality parity GREEN on **Brain-Child-3-sourced** data + the Definitional-Delta Register fully signed (see (d)) + CACHE-PURGE-C4C5 armed. Reversible by flipping the read flag back UNTIL `legacy-reads-decommissioned`. **The `legacy-reads-decommissioned` transition is a PoNR for the metric rollup.**
4. **HOLD-AT-SERVE (Child-5 AI)** — serve-flip: Brain AI reads ClickHouse authoritative + CACHE-PURGE-C4C5 FIRES (post-purge stale-narration count must = 0) + per-agent graduation. Reversible (re-enable legacy AI read path) ONLY while Child-4 `legacy-reads` not yet decommissioned (arch line 556) → **this is why AI serve-flip must not outrun the metric read-flip rollback window.** Legacy `module/ai*` + Ollama + `SystemSettings.ollamaUrl` retired here.
5. **HOLD-AT-ROUTE-FLIP (Child-6 frontend, per-route-group)** — facade flips each route group from legacy frontend to Brain surface; replaces dev-only header-trust with **production JWT-verify + membership lookup**. Reversible per-route-group (re-point facade to legacy) per Child-0 A4.
6. **Legacy stack shutdown + archive** — only after ALL contexts at sustained parity + `legacy-reads-decommissioned` reached everywhere. **The legacy DB shutdown is the PROGRAM-LEVEL terminal PoNR.**

**Ruling for Aryan:** the runbook must carry a per-hold row: `{hold, pre-req gate (ref to the child's gate), reversibility action, the explicit PoNR line, what is destroyed/irreversible past it}`. The PoNR ledger is the load-bearing artifact. There must be NO step whose PoNR is crossed before its dependency's parity is signed.

### (b) The irreversible steps — reversibility tree until the PoNR.

Two classes of irreversible destruction, both gated:
- **Legacy plaintext credential destruction (C8, single-owner C8 per requirement).** Per arch R-CRED-01 (line 1078) the delete happens **at that connector's cutover, not after** — but the binding constraint `CF-SEC-SECRETS-1` requires **Brain custody PROVEN first** (the Child-3 write→auth-test→parity→seal→delete sequence). Reversibility tree BEFORE delete: token handed back to legacy + webhook re-registered. AFTER delete: no rollback to legacy connector auth (would require re-issuing creds from the provider). **Ruling:** the runbook must make "Brain custody proven" a hard checklist gate (a successful authenticated Brain API call + parity within the window + the secret sealed in Brain secrets manager) as the precondition for each plaintext-delete, Shiprocket last.
- **Legacy DB shutdown.** Terminal. Reversibility: until shutdown, the archived snapshot + the facade re-point keep legacy restorable. AFTER shutdown + archive-then-decommission, the live store is gone (the archive remains for DPDP retention, read-only). **Ruling:** shutdown is gated on 100%-decommissioned (every context `legacy-reads-decommissioned`) + the archive verified restorable + Founder authorization at console.

### (c) DPDP — retention-compliant archival of the retired PII store + erasure-scopability.

The legacy DB holds the all-workspace PII inventory (arch A6.2 line 1051: ShopifyCustomer email/name, ShiprocketShipment pincode/city/state, ShopifyOrder.email, Invitation.email). On retirement this becomes a **retained PII store** and must stay DPDP-accountable:
- **Residency:** `CF-RES-1` — the archive stays in `ap-south-1` (R-RES-01 confirmed ap-south-1 at Child-0; an out-of-region archive would be a DPDP §16 cross-border transfer). The runbook must assert the archive region.
- **Retention:** archive is DPDP retention-compliant then decommissioned (requirement scope line 46). The runbook must name the retention basis/period and the decommission trigger.
- **Erasure-scopability (DPDP §12/§13):** the retired store must remain **erasure-scopable per workspace/data-principal** while archived — a §12 erasure request after retirement must still be satisfiable against the archive, OR the archive must be provably already-migrated-and-purgeable. The `AuditLog.workspaceId String?` null-rows → system-workspace-sentinel disposition (arch A1.4 / R-AUD-01) must be carried so system events stay attributable post-retirement.
- **Ruling:** this is a DPDP accountability design point, NOT a Founder escalation (no ambiguity — the canon answer is in-region + retention-bounded + erasure-scopable). It is bound in the runbook and reviewed at my Stage 6. The `chore-security-governance-hardening-phase` handoff carries any residual governance hardening.

### (d) The 2 pending Child-4 DDR rows (`total_tax_mu` + FX) — do they become signable post-connector-cutover?

**Yes — confirmed.** Child-4's Definitional-Delta Register signed 9 of 11 rows; the 2 unsigned are explicitly `unsigned_pending_child_dependency`: `total_tax_mu` (depends on `child-3-shopify-connector`) and `fx_restatement` (depends on `child-3-workspace-cost-currency-migration`). Both dependencies are inside Child-3 (connectors), which is `awaiting-founder-commit` at Stage 8. Once the Shopify connector is live + at parity (HOLD-AT-CUTOVER flipped) and the FX/currency migration has run, the two rows become satisfiable on Brain-sourced data and signable. **Ruling:** the DDR full sign-off (mine) is sequenced AFTER HOLD-AT-CUTOVER (Shopify) + BEFORE the HOLD-AT-READ-FLIP `legacy-reads-decommissioned` transition — i.e. the read-flip PoNR cannot be crossed until I have signed all 11 DDR rows. The runbook makes the DDR full sign-off a named gate on the read-flip.

### (e) Does anything actually get DECOMMISSIONED in THIS child, or is it 100% runbook?

**This child is ~100% runbook + sign-offs — it executes NO live cutover and destroys NOTHING at runtime.** Per arch line 511/558 and the requirement's out-of-scope, the actual hold-flips, credential destruction, and DB shutdown are Stage-8 / Founder-at-console execution gated per the named holds. The one thing that may be *produced* (not executed) here beyond the runbook is the program-level **final-state verification checklist** + the **PoNR ledger** + the **DPDP close-out doc**. Net: the deliverable is a binding plan; nothing is decommissioned by writing it. Legacy is already reference-only + untracked from git (this child plans its *runtime* retirement, not a git removal).

---

## Personas — decision

| Field | Value |
|-------|-------|
| **Count** | **1** |
| **Within lane cap?** | Yes — high-stakes caps at 2; I am choosing 1 (single dominant risk dimension). |
| **Persona** | `dpdp-decommission-safety-realist:sonnet` |
| **Tier** | `:sonnet` — reasoning-heavy: the irreversibility tree, the ordering-correctness proof, DPDP erasure-scopability of a retired store, and the "Brain-custody-proven-before-plaintext-delete" precondition are multi-step adversarial reasoning, not a bounded checklist. NOT `:haiku`. |

### Persona-count rationale (which classifier rule fired)

The **1-persona** rule fired: "a single risk dimension dominates." Here that dimension is **irreversible-decommission safety** — the point-of-no-return ledger + plaintext-credential destruction + DPDP retention/erasure of the retired store. The ordering question (a) and the connector-cutover-sequencing are NOT a *second* independent dimension — they collapse into the same PoNR/reversibility analysis (you cannot reason about the order without reasoning about what is irreversible at each step). A second persona (e.g. a connector-sequencing realist) would overlap >70% with this one and overshoot for marginal signal. The requirement explicitly offered a 0-persona path "if the runbook is self-evident + low-ambiguity" — it is NOT: a wrong order destroys legacy plaintext credentials or shuts down the DB before Brain custody/parity is proven, which is an irreversible data/access-loss event. Conservative rule → spawn the persona.

### Why this persona must surface ≥1 grounded concern (quality gate)

The persona must adversarially attack: (1) is there a step whose PoNR is crossed before its dependency's parity is signed? (2) is "Brain custody proven" specified strongly enough to gate each plaintext-delete (Shiprocket especially, no replay)? (3) is the archive erasure-scopable per DPDP §12 after the live store is gone? (4) does the AI serve-flip rollback window outrun the metric read-flip decommission (arch line 556 hazard)? A "looks good, runbook is complete" persona is REJECTED at synthesis.

**I do NOT spawn it** (I am a subagent with no Agent tool). I RETURN it in `needs_personas`; the top-level orchestrator spawns `03-persona-dpdp-decommission-safety-realist.md`, then re-invokes me for synthesis.

### Personas declined (recorded)

- **`india-compliance-officer` (generic):** folded into the DPDP-decommission-safety persona's brief — the DPDP angle here is specifically about a *retired store* (archival/erasure/residency), which the decommission-safety persona owns. A generic compliance persona would not add the irreversibility reasoning that is the actual risk.
- **`connector-cutover-sequencing-realist`:** declined — collapses into the PoNR/ordering analysis (see count rationale). Would overshoot the cap for marginal signal.
- **`generic-architecture / runbook-completeness persona`:** declined — runbook completeness + internal consistency is Tanvi's degraded-QA Stage-6 job (artifact-completeness bar, the Child-0 analogue) + Aryan's Stage-2 binding job; not a Stage-1 reasoning dimension.

---

## Paradigm recommendation

**Recommended paradigm:** `sql` / runbook (no compute)

**Why:** zero inference path; zero new runtime. The deliverable is an ordered decommission sequence + verification checklists + a PoNR ledger + a DPDP close-out — pure design/ops. Any `@paradigm` LLM decorator or any new compute in this child would be a paradigm violation. This child DEFENDS the cost model by retiring the legacy direct-Anthropic-SDK + Ollama path (Child-5 already retires the serving path; this child confirms the retirement at final state).

> Architect (Aryan) carries this sign-off — no inference, no metric arithmetic, no LLM client. This is a runbook, not a service.

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | None directly. Indirect: `true_cm2_mu` RTO-provision proxy (Child-4) must be intact at final state — confirmed via DDR full sign-off, not re-derived here. |
| **COD** | None directly (no new payment/order path; retirement only). |
| **GST** | `total_tax_mu` is one of the 2 pending DDR rows — becomes signable post-Shopify-connector-cutover (ruling (d)); GST-2.0 per-SKU semantics live in the connector/metric children, not this child. |
| **Festival seasonality** | Operational timing concern: the legacy DB shutdown + irreversible cutovers must NOT be scheduled in a festival peak window (a bad cutover during peak GMV is maximum blast radius). The runbook should name a cutover-window constraint (Founder/Jatin own the calendar at Stage 8). |
| **Pincode reliability** | None directly (ShiprocketShipment pincode PII is part of the archived store — covered under DPDP archival ruling (c)). |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | None — this child sends NOTHING outbound (no WhatsApp/SMS/call/email/ad-audience). Not a trigger surface here. |

---

## Escalation ruling

| Field | Value |
|-------|-------|
| **Decision** | **none at intake** (production-cutover authorization + plaintext destruction is a **Stage-8 / Founder-at-console gate**, NOT a mid-pipeline `/escalate`). One **armed-not-fired** condition recorded. |

**Why this is a Stage-8 gate, not an escalation:** the production cutover authorization, the plaintext credential destruction, and the legacy DB shutdown are inherently Founder-gated — but that gate is the **Stage-8 execution gate** (Founder + Jatin at console, the named-hold flips), which is the correct, already-defined ratification point for irreversible execution. An `/escalate` is for a *canon ambiguity I cannot resolve in good conscience*. There is none here at intake: the order is DAG-forced, the DPDP archival answer is canon (in-region + retention-bounded + erasure-scopable), the PoNR ledger is a design artifact. Writing the runbook needs no Founder decision; *executing* it does — and that is the Stage-8 gate by construction.

**Armed-not-fired (logged, will not surprise the Founder):** IF, at Stage 2/6, the runbook reveals that DPDP §12 erasure cannot be satisfied against the archived store without re-architecting the archive (i.e. the retired store is neither erasure-scopable nor provably-purgeable) — that becomes a genuine compliance ambiguity weighing retention vs erasure obligation, and **`/escalate` is ARMED to fire then** (mirrors the Child-0 residency tripwire + the Child-5 frontier-model tripwire). No decision is needed from the Founder today; this is logged in `pending-founder-attention.md` so the trade-off cannot be silently resolved inside an engineering plan.

---

## Pre-flight dependency check

Child-7 depends on ALL of Children 1-6. Meta-tracker `blocks` lists Children 3/4/5/6 explicitly; the Child-0 DAG (arch line 515) + the named holds make the full 1-6 chain the true dependency set. Status of each:

| Child | req_id | status | named hold (unlocked here) |
|---|---|---|---|
| 1 RLS | `feat-tenancy-rls-brain-native` | committed-on-feature-branch (Stage 8) | HOLD-AT-FORCE |
| 1 hardening | `feat-tenancy-auth-rls-hardening` | awaiting-founder-commit (Stage 8) | (FORCE pre-reqs) |
| 2 money | `feat-money-minor-units-parity` | committed-on-feature-branch (Stage 8) | — |
| 3 connectors | `feat-connector-framework-cutover` | awaiting-founder-commit (Stage 8) | HOLD-AT-CUTOVER |
| 4 metric+OLAP | `feat-metric-engine-olap-split` | approved (Stage 8) | HOLD-AT-READ-FLIP |
| 5 AI | `feat-ai-engine-intelligence` | approved (Stage 8) | HOLD-AT-SERVE |
| 6 frontend | `feat-frontend-dashboard-morningbrief` | approved (Stage 8) | HOLD-AT-ROUTE-FLIP |

**Ruling: NO VIOLATION for THIS child (the runbook).** All of Children 1-6 are at Stage-8 readiness (committed-on-branch / awaiting-founder-commit / approved) — i.e. each has reached Stage-6 PASS and is behind its named hold. The dependency rule for a *design/runbook child* is satisfied by the prior children being at-readiness (the runbook plans against their committed contracts + named holds; same build-on-committed-contract situation ruled non-blocking on Children 4/6). 

**The hard gate is on EXECUTION, not on writing the runbook:** Child-7's *execution* (the actual hold-flips) is gated on each prior HELD cutover being flipped + parity-signed at Stage 8 — this child **sequences** that; it does not execute it. No `blocks` dependency is in an un-shipped state that prevents *planning*. I do NOT refuse — I ADVANCE the runbook, with the execution-gating made explicit in the plan.

---

## Decision

**ADVANCE** — to Stage 2 (Aryan), as a **decommission-runbook plan** (design/runbook-only; no code build). First pass requests **1 persona** (`dpdp-decommission-safety-realist:sonnet`); I synthesize after the orchestrator re-invokes me with `03-persona-*.md`.

**Next step:** orchestrator spawns the persona → re-invokes me for synthesis → on synthesis ADVANCE, Stage 2 = Aryan authors the decommission runbook + PoNR ledger + final-state verification checklist + DPDP close-out. My Stage-6 design review (compliance + reversibility) IS the gate. Execution is Stage-8 / Founder-at-console.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T07:30:00Z",
  "actor": "cto-advisor",
  "type": "stage1-intake",
  "req_id": "feat-legacy-decommission",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "epic_child_id": "child-7-decommission",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "shape": "design-runbook-only",
  "persona_count": 1,
  "needs_personas": ["dpdp-decommission-safety-realist:sonnet"],
  "escalation": "none-at-intake; stage8-founder-gate-is-the-execution-ratification; dpdp-erasure-tripwire-armed",
  "rationale": "Final child: runbook to sequence the 6 named held cutovers in DAG-forced order with an explicit PoNR ledger; irreversible plaintext-delete (Brain-custody-proven) + DB shutdown gated; DPDP in-region retention+erasure-scopable archival; 2 pending Child-4 DDR rows signable post-Shopify-cutover; nothing decommissioned by writing the runbook (Stage-8 executes)."
}
```

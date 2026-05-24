# CTO Advisor Review — Stage 1 (intake / brainstorm)

> Filled by Rohan (CTO Advisor), Stage 1 intake. Child 2 of EPIC `chore-migrate-legacy-to-brain`.
> Validates against [schemas/cto-advisor-review.schema.json](../../../../.claude/plugins/cache/brain-engineering-os-marketplace/brain-engineering-os/0.26.0/schemas/cto-advisor-review.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `feat-money-minor-units-parity` |
| **Stage** | 1  *(intake)* |
| **Timestamp** | 2026-05-24T13:02:00Z |
| **Decision** | **ADVANCE** *(personas requested first → synthesis pending orchestrator re-invoke)* |
| **Parent epic** | `chore-migrate-legacy-to-brain` (epic-ratified, architecture binding) |
| **Blocks (dependency)** | `child-0-audit-migration-architecture-spike` (status `done` ✓) |
| **Entry-gate note** | Child-1 C5 gate must be SATISFIABLE Brain-native (it is: `feat-tenancy-rls-brain-native` = readiness-complete, stage 8) — see §"Entry-gate honesty" below |

---

## Pre-flight dependency check (mandatory for child requirements)

- Parent `chore-migrate-legacy-to-brain.proposed_children` → `child-2-money-minor-units-migration.blocks = ["child-0-audit-migration-architecture-spike"]`.
- `spike-legacy-migration-architecture` status = **`done`** → **NO VIOLATION**. Proceed.
- **Second-order entry gate (NOT a `blocks` edge, but a binding cutover precondition):** Child-0 §A2.2 line 506 sets the Child-2 *entry* state to RLS **SATISFIABLE Brain-native AND FORCE-readiness pre-conditions met**. `feat-tenancy-rls-brain-native` reached `readiness-complete` (stage 8) = the SATISFIABLE state with FORCE HELD. This is sufficient for **this child's scope** (types + harness design; no live data, no live read of the shadow). It is NOT yet LIVE/FORCED — which is correct, because this child does not run the live reconciliation (deferred/gated, req line 53). Recorded so the future Stage-8 cutover ceremony for *real* MU conversion inherits the live-FORCE precondition.

---

## Made requirements less dumb first

*The "delete / simplify / defer" pass before anything else.*

**Could delete:**
- Nothing in the stated scope is deletable — the Money type, the conversion rules, and the parity harness are mutually load-bearing (the harness is meaningless without the type; the type is untrusted without the harness). The requirement is already tightly scoped.

**Could simplify:**
- The numeric mechanics are **already designed** in the binding architecture (Child-0 §A5.2, authored by Maya 2026-05-24T01:18:46Z): the `roundHalfEven` TS skeleton + Python impl, the `decimal_to_minor_units` contract, the 6 ROUND_HALF_EVEN test vectors, the harness iteration grain + report shape, the FX-exclusion mechanic, the M-A5-Q1/Q2/Q3 rulings. **This child must EXTEND that binding design into shipped code + CI gate — not re-derive it.** Simplification = forbid re-litigation; the spike's rulings are fixed inputs (mirrors how Child 1 carried the spike's gate forward).

**Could defer:**
- **The live column migration / backfill / reconciliation run** — already deferred by the requirement (line 53, non-goal line 62), mirroring Child-1's HOLD-AT-FORCE discipline. This child delivers the **type + canonical conversion rules + a deterministic, fixture/golden-set parity harness** that PROVES the rules and the Money type; the live per-workspace-date reconciliation against the live legacy DB is a gated Stage-8-class rollout in a later cutover, not this child.
- **The CM2 / metric definitional-delta question (M-A1-Q2)** — explicitly **deferred to Child 4** by the binding architecture (Child-0 line 410: the Definitional-Delta Register is a Child-4 deliverable, signed by Rohan before cutover). See §"Scope-boundary ruling" below. This child establishes the *numeric-equality* machinery; Child 4 establishes the *definitional* sign-off that sits on top of it.

---

## Scope-boundary ruling (answers the three Founder-flagged tensions)

**1. What does the "parity harness" deliver THIS child without touching live data?**

A **deterministic, fixture/golden-set parity harness** — not a live reconciliation. Concretely (this is the binding scope, to be planned by Aryan + Maya at Stage 2):
- The canonical `Money` value object (BIGINT minor-units + `currency_code`) in BOTH `packages/lib-metrics` (TS) and `pylibs/brain_metrics` (Python).
- The canonical conversion rules as shipped code: `roundHalfEven`/`decimalToMinorUnits` (TS) + `decimal_to_minor_units` (Python) — proving money → BIGINT paise via ROUND_HALF_EVEN ×100, ratio → INT32 ×10,000, count → INT64.
- A **CI-enforced TS↔Python parity gate** (extends `tools/check-metrics-parity.sh`) over the 6 banker's-rounding test vectors + the M-A5-Q2 4-decimal cases — a single divergence fails the gate.
- The **harness *engine*** (the `@paradigm: sql` comparator from §A5.2 / M-A5-1) exercised against a **golden fixture set** (synthetic legacy-Decimal rows × known Brain-MU expected values, incl. the `1234.565` tie-break, sub-paise truncation, negative amounts, overflow boundaries). This PROVES the comparator + conversion rules are exact-integer-equal, with **zero live-DB read**.
- The `WorkspaceMetricGoal.goalValue` typing split (`goalType` → `money | ratio`) — req success-metric; resolves Child-0 A1 #8.

What this child does NOT deliver: any query against the live legacy Postgres, any MU value served to users, any backfill of existing rows, any per-workspace-date live reconciliation report. Those are the gated cutover. The deliverable bar: **"the Money type + conversion rules + harness engine are PROVEN correct on golden fixtures and CI-locked, such that the future live reconciliation is a mechanical re-point at real data, not a re-derivation."**

**2. Is the numeric parity Maya's domain → does Maya co-own Stage 2?**

**YES — Maya (intelligence-engineer) co-owns Stage 2.** This is not a marginal call:
- Maya **authored** the binding numeric design (Child-0 §A5.2, all of M-A5-1..5 + M-A5-Q1/Q2/Q3) as the spike's Stage-2 co-owner.
- The canon assigns metric-engine **TS↔Python parity** to the intelligence/analytics surface (`pylibs/brain_metrics` is Maya's; `packages/lib-metrics` is the shared registry). The Money type lives at the seam of both.
- Two carry-forwards from the spike's Stage-6 ledger land on Child 2 and are Maya's: **CF-MAYA-2** (`WorkspaceCost.currency @default("USD")` → costs stored in primary currency at entry; Child-0 line 408) and **CF-QA-1** (TS `roundHalfEven` must operate at Decimal precision, not lossy float — see persona below).
- Division of Stage-2 labor: **Aryan owns** the package/DDD homes, the type's interface contract, where the harness engine lives, the CI wiring, reversibility/staging. **Maya owns** the numeric mechanics (rounding byte-identity, conversion correctness, fixture/golden-set design, FX-exclusion mechanic, the comparator's exact-equality semantics). Same co-ownership pattern as the spike's A5.

**3. Is the M-A1-Q2 CM2 definitional-delta question in scope here?**

**NO — deferred to Child 4**, per the binding architecture (Child-0 line 410: "Child 4 architect must explicitly document all confirmed definition changes in a **Definitional-Delta Register** ... signed by Rohan before cutover"; CF-MAYA-1 is a Child-4 pre-condition). Child 2 is **types + numeric equality**; Child 4 is **metric definitions + the definitional sign-off** that classifies a non-zero delta as `expected_definitional_delta` vs a bug. Putting definitional parity in Child 2 would (a) require metric definitions that don't exist until Child 4, and (b) pull Child-4 scope forward — a Single-Primitive / scope-creep violation. **Recorded as a hard boundary for Aryan:** the Child-2 harness must support the `expected_definitional_delta` classification *hook* (so Child 4 can plug into it) without *populating* the register.

---

## Personas spawned *(Stage 1 — count = 1)*

1. **`money-finance-parity-realist:sonnet`** — see [`03-persona-money-finance-parity-realist.md`](.) *(to be authored by orchestrator-spawned persona)*

**Persona-count decision:** see dedicated section below.

**Persona brief (binding for the spawn):**
> Adversarially stress-test the money/numeric-parity foundation. You are the one genuine adversary on this child. Ground every concern in the binding Child-0 §A5.2 design + the actual legacy code (`legacy project/` is reference-only — read, never edit). Required attack surfaces:
> 1. **The float-multiply landmine (highest priority).** Child-0's TS skeleton `roundHalfEven(legacy_decimal * 100)` does the `* 100` in JS IEEE-754 float. For `1234.565` JS computes `123456.49999...`, so a naive `roundHalfEven` returns `123456` "by luck of the wrong path," and for other vectors it will silently diverge from Python's string-based `Decimal`. The Python side is explicitly protected (must receive a STRING). **Is the TS side equally protected?** The skeleton is NOT — it takes a `number`. Pressure-test: does Child 2 need a TS arbitrary-precision/decimal-string path (the legacy Prisma Decimal arrives as a STRING — does TS parse it as string too, or lossily as Number first?) to make TS↔Python byte-identical? This is CF-QA-1, and it can break the exact-equality gate. Name the precise mechanism Child 2 must ship.
> 2. **Golden-fixture sufficiency.** Without live data, the harness is only as trustworthy as its fixtures. Enumerate the fixture classes that MUST be present or the "PASS" is hollow: banker's-rounding ties (all 6 vectors), 4-decimal sub-paise truncation, negative amounts (refunds — `shopify_refund_line_items`), zero, overflow (BIGINT max vs INT32 ratio max), multi-currency primary-currency normalization, the FX-`WorkspaceCost.currency="USD"` contamination case. Which class, if omitted, lets a real conversion bug ship?
> 3. **Scope-boundary integrity.** Confirm the child does NOT smuggle in (a) live-DB reads, (b) metric definitions (Child 4), (c) the Definitional-Delta Register (Child 4), (d) the live backfill. Flag any success-metric line that can only be met by crossing one of these boundaries.
> 4. **Single-Primitive Rule.** The Money type must be built ONCE and consumed N times. Is there any pull toward a TS-only and a separately-evolved Python-only money rep (the legacy anti-pattern)? Bind the shared-definition obligation.
> 5. **Currency-at-entry (CF-MAYA-2).** `WorkspaceCost.currency @default("USD")` vs INR-primary workspaces. Does this child need the currency-at-entry normalization, or is that a Child-4 metric concern? (It touches the *type's* currency_code semantics — pressure-test whether it's a Child-2 type-contract decision or deferrable.)
> Return ≥1 concern with severity; "looks good" is rejected. Mark each concern Escalate: Yes/No with a one-line reason. Cite file:line for every legacy claim.

**Synthesis:** *(pending — orchestrator spawns the persona, writes `03-persona-money-finance-parity-realist.md`, then re-invokes Rohan for the synthesis pass. This artifact is the FIRST pass: personas requested, no synthesis yet.)*

---

## Persona-count decision

**Count chosen: 1.**

**Rationale (classifier rule fired):** *"A single risk dimension dominates."* This child has exactly one genuine adversarial dimension — **numeric/financial parity correctness** (the exact-integer-equality gate, the TS↔Python byte-identity, the float-multiply landmine, fixture sufficiency). Everything else is either (a) already-bound by the Child-0 architecture (rounding rule, paise canonical unit, ratio scaled-int rule, FX exclusion — all ruled in §A5.2, not open) or (b) Aryan's binding Stage-2 structural job (package homes, CI wiring, DDD). The lane (high-stakes) *permits* 2, but a reflexive 2nd persona here would have no distinct dimension to own:

- **Declined `ai-cost-realist`** — there is NO compute/LLM/ML path. The harness is explicitly `@paradigm: sql` (Child-0 line 685: "no LLM call, no float arithmetic in the harness itself"). An AI-cost persona would have nothing to audit. (The Founder's brief independently reached the same conclusion.)
- **Declined `india-compliance-officer`** — no PII, no outbound channel, no consent surface, no DPDP/DLT/calling-window touch in this child. Money *representation* is not a compliance surface (it becomes one at billing/GMV-metering, which is Child 4+). DPDP CF-SEC-3.HARD is resolved-on-record and re-arms only before 3rd-party PII (Child 3); residency is confirmed ap-south-1. A compliance persona would re-litigate resolved/inactive questions = a "looks good" persona, rejected by policy.
- **Declined a generic architecture persona** — structure-correctness (package homes, type contract, CI wiring) is Aryan's binding Stage-2 deliverable, co-owned with Maya. Duplicating it as a persona adds no adversarial signal.

**Depth tag `:sonnet`** — this is reasoning-heavy, not a bounded checklist: float-vs-decimal IEEE-754 reasoning, multi-step parity argument across two language runtimes, fixture-completeness reasoning over the legacy schema. A `:haiku` bounded pass would miss the float-multiply landmine (the load-bearing finding).

---

## Paradigm recommendation

**Recommended paradigm:** `sql`

**Why:** The Money type is a deterministic value object; the conversion is pure arithmetic (`ROUND_HALF_EVEN ×100`); the parity harness is a SQL/integer comparator with zero float arithmetic and zero LLM/ML (Child-0 line 685 already tags it `@paradigm: sql`). This is the canon's most important invariant in its purest form — **LLMs never produce a metric/money number; money is integer minor-units, never float/NUMERIC.** Any reach toward ML/LLM on this child would be a paradigm-bypass anti-pattern. Architect (Aryan) may refine, but there is no defensible non-`sql` path here.

> First-pass read; Aryan confirms in Stage 2.

---

## Lane decision

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** |
| **trigger_surfaces_touched** | `["money", "schema-proto"]` |
| **feature_class_rationale** | Trigger-surface scan fires on **money** (the canonical minor-units Money type + conversion + exact-equality billing-base parity) and **schema-proto** (the `Money` value object becomes a shared cross-service/cross-language contract in `packages/lib-metrics` + `pylibs/brain_metrics`, and the `goalType` enum split changes a typed contract). ≥1 trigger surface ⇒ high-stakes; express/standard off the table. Foundational-scaffolding carve-out is **inapplicable** — money is an explicit money/financial surface, and the carve-out bars itself on any money surface. Conservative tie-break is moot (the trigger scan is unambiguous), but would force high-stakes regardless. |

**Stages that will run (high-stakes lane):** 1 (this) → 2 Architect (Aryan, **co-owned by Maya**) → 3 build → 4 Security (Shreya VETO) → 5 QA (Tanvi VETO, metric-registry parity gate is squarely hers) → 6 final review (Rohan VETO) → 7 Founder gate (Founder-delegated to Rohan for the epic) → 8 deploy/readiness (Jatin; live conversion HELD).

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | Indirect — RTO cost/provision figures are money; they MUST flow through the canonical paise Money type. Not exercised this child (no metric compute); the type must not preclude RTO-provision money correctness downstream. |
| **COD** | Indirect — `shiprocket_shipments.codAmount` + `charges` are in the harness money-field scope (Child-0 line 675). COD amounts must convert paise-exact. Type-level only this child. |
| **GST** | Indirect but load-bearing — GST is extracted **per-SKU by slab (0/5/18/40)**, never blended; the per-line tax amounts are money and depend on this exact paise type. Child 2 must not introduce a representation that loses per-line precision (the M-A5-Q2 sub-paise ruling already protects this). Definitional GST extraction is Child 4. |
| **Festival seasonality** | None this child (no time-series/seasonal compute). |
| **Pincode reliability** | None this child. |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | None — no outbound channel, no PII, no consent surface. Not a trigger surface for this child. |

---

## Binding contract carried into Stage 2 (acceptance inputs for Aryan/Maya/Shreya/Tanvi)

**Inherited from the Child-0 spike (fixed; do not re-derive):**
- **Conversion rules:** money → BIGINT paise via `ROUND_HALF_EVEN ×100` (universal canonical = paise, even for 4-decimal sources — M-A5-Q2); ratio/percent → INT32 `FLOOR(ratio ×10,000)` `_bp` (M-A5-Q1); count → INT64.
- **`ROUND_HALF_EVEN` is THE shared rule**, byte-identical TS↔Python, CI-checked via `tools/check-metrics-parity.sh` (Child-0 §A5.1 rule 4). Required test vectors: the 6 banker's-rounding cases (`1234.565→123456`, `1234.575→123458`, `0.005→0`, `0.015→2`, `999.995→100000`, `0.025→2`) + M-A5-Q2 4-decimal cases.
- **Harness engine contract** (Child-0 M-A5-1): iteration grain (workspace,date,field) primary + (workspace,order,field)/(…,line_item,field) secondary; fail-fast FIRST_DIVERGENCE report shape; `@paradigm: sql`; zero float arithmetic in the harness.
- **CF-QA-1 (HARD, Maya/Aryan):** the TS `roundHalfEven` must operate at Decimal precision — the float-`* 100` skeleton is a known landmine; TS must consume the legacy Decimal as a **string** (Prisma returns Decimal as string) to be byte-identical with Python. **This is the persona's #1 attack and a Stage-5 QA gate.**
- **CF-MAYA-2 (Maya):** `WorkspaceCost.currency @default("USD")` → costs normalized to workspace primary currency at entry; the Money type's `currency_code` semantics must support this.
- **Scope hooks, not populated this child:** the `expected_definitional_delta` classification hook (so Child 4's Definitional-Delta Register can plug in) — present in the harness, unpopulated here.

**New Child-2-specific constraints (sharpen with the persona at synthesis):**
- **CF-C2-PRIMITIVE-1:** the `Money` value object is built ONCE, shared, consumed N times (Single-Primitive Rule). Bind its package path + exported interface signature in BOTH `packages/lib-metrics` and `pylibs/brain_metrics`; forbid a TS-only / Python-only divergent rep.
- **CF-C2-GOLDEN-1:** the parity PASS is proven on a **golden fixture set** (no live-DB read this child); fixture classes MUST include ties, sub-paise truncation, negatives/refunds, zero, overflow, multi-currency normalization, FX-contamination. (Persona attack #2 enumerates the binding set.)
- **CF-C2-NO-LIVE-1:** ZERO live legacy-DB read, ZERO MU served to users, ZERO backfill. Legacy = reference-only (no import/edit/commit under `legacy project/`). Any builder touching live data or legacy code = drift bounce.
- **CF-C2-SCOPE-DEFER-1:** metric definitions, the CM waterfall, and the Definitional-Delta Register are Child 4 — NOT this child. The `goalType money|ratio` split IS in scope (resolves A1 #8).
- **CF-C2-ENTRY-GATE-1:** Child-1 C5 gate must be SATISFIABLE Brain-native (it is) for this child's harness *design*; LIVE/FORCED is only required at the later live-reconciliation cutover, not at this child's exit.

---

## Decision

**ADVANCE** — sound, well-scoped, planable, dependency satisfied. Not CHALLENGE-BACK (the requirement is precise and the architecture has already de-risked it), not KILL (it is a binding non-negotiable: the C7 money-parity gate that every downstream metric depends on). One adversarial money-parity opinion (`:sonnet`) banked before the type + harness become load-bearing across the whole metric engine.

**Escalation:** **None at intake.** No compliance ambiguity (no PII/channel/consent surface this child), no cost-model threat (pure `sql`, no LLM), no moat/Memory-Layer change, no irreversible decision (additive type + harness, live conversion deferred + gated). The two prior-child escalations (DPDP lawful-basis, residency) are resolved-on-record and not re-triggered here.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-24T13:02:00Z",
  "actor": "cto-advisor",
  "type": "stage1-intake-advance-personas-requested",
  "req_id": "feat-money-minor-units-parity",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "trigger_surfaces_touched": ["money", "schema-proto"],
  "needs_personas": ["money-finance-parity-realist:sonnet"],
  "maya_co_owns_stage2": true,
  "paradigm": "sql",
  "rationale": "Child-2 money/minor-units foundation + C7 exact-integer-equality harness; 1 sonnet money-parity persona (one dominant numeric dimension); Maya co-owns Stage 2 numeric mechanics; live reconciliation deferred/gated; definitional-delta deferred to Child 4."
}
```

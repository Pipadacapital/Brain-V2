# Stage 1 — CTO Advisor Review (Rohan)

| Field | Value |
|-------|-------|
| **req_id** | `spike-legacy-migration-architecture` |
| **Parent epic** | `chore-migrate-legacy-to-brain` (epic_child_id `child-0-audit-migration-architecture-spike`) |
| **Stage** | 1 (intake + brainstorm) |
| **Reviewer** | Rohan (cto-advisor) |
| **Timestamp** | 2026-05-24T00:59:44Z |
| **Decision** | **ADVANCE** — personas requested first; synthesis pending orchestrator re-invoke |

---

## TL;DR

This is **Child 0** — the deep-audit + binding migration-architecture spike I recommended and the Founder ratified. It **writes zero production code and changes nothing in legacy runtime**; its deliverable is the architecture that makes every later coding slice planable. I reuse the epic decomposition I already did (parent `02-cto-advisor-review.md`) rather than re-derive it.

Two judgment calls this child needs from me at Stage 1, beyond inheriting the epic frame:
1. **Does a no-code spike still run the full high-stakes path?** — Yes, but with an honest read of *which* gates have real surface to bite on. The lane is governed by the **decisions this spike binds**, not by lines of code it ships. I keep the lane high-stakes and explain below exactly what Security/QA/final-review verify for a design-only deliverable (they verify the *architecture*, not running code).
2. **Re-confirm the two personas.** — Confirmed, unchanged, with sharpened one-line briefs so the orchestrator's persona generator has a tight mandate.

I also **tighten the spike contract** (exact artifacts that must exist + the "good enough to make later slices planable" bar + the no-prod-code guardrail) so Aryan (Stage 2) and the reviewers inherit a tight contract instead of a vibe.

---

## Reuse, don't re-derive (provenance)

The legacy ground-truth, the 6 absent non-negotiables, and the strangler-fig child sequence are already established and Founder-ratified in:
- `.engineering-os/runs/2026-05-24T00-51-31Z__e0edfa__chore-migrate-legacy-to-brain__rishabhporwal/02-cto-advisor-review.md` (my epic decomposition)
- `state/active.json` → `chore-migrate-legacy-to-brain.legacy_ground_truth` + `.proposed_children`

This child does **not** restate that. It *produces the deepened, binding version* of it. Semantic recall (k=6) returned only this child's own intake + the parent epic's records — no near-duplicate to merge, no prior shipped pattern to template against. Nearest shipped artifact is `chore-scaffold-monorepo` (the empty Brain skeleton this migration eventually lands into) — relevant as the *target* structure, not as a pattern to copy.

---

## Pre-flight dependency check

- This child's `blocks` array in the parent's `proposed_children` = **`[]`** (Child 0 depends on nothing; it is the unblocker for Children 1–N).
- No dependency violation. Cleared to proceed.

---

## Lane decision

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** (confirmed; inherited from epic, re-justified for a no-code spike below) |
| **feature_class_rationale** | A design-only spike whose *output binds* auth/RLS, money-representation, connector, metric, AI, and compliance decisions across live tenant data. The trigger surfaces are touched *by the decisions*, not by code. The conservative tie-break also forbids any downgrade here. |
| **trigger_surfaces_touched** | `auth`, `multi-tenancy`, `mcp-tools`, `connectors`, `outbound-channels`, `pii`, `schema-proto`, `money`, `india-compliance` (the surfaces this spike's architecture *governs* — same maximal set as the epic) |

### Honest reasoning: should a no-code spike run the full high-stakes path?

The Founder asked me to decide this honestly and not fabricate review surface a no-code spike genuinely lacks. My answer: **keep high-stakes, but be precise about what each gate verifies.**

**Why high-stakes (not a downgrade):**
- The classifier is mechanical: any trigger-surface hit ⇒ high-stakes. The foundational-scaffolding carve-out is the *only* downgrade path, and it explicitly **excludes** anything touching `money`/`pii`/`connectors`/`india-compliance`. This spike's deliverables decide the RLS model (multi-tenancy/leak surface), the Decimal→minor-units money conversion (money + financial integrity), live-PII residency/consent sequencing (pii + india-compliance), and the connector-framework target (connectors). It is the *opposite* of the carve-out. Not even close.
- A wrong decision here is **not** a local defect — it is inherited by every downstream coding child. The blast radius of a bad migration architecture is the entire migration program plus live tenant data and money. That is the highest-risk class of work Brain does, even though no byte of runtime changes this week.
- The conservative tie-break (Founder rule 2026-05-20) forbids downgrading on doubt. There is no doubt to resolve down here.

**What honest review surface a no-code spike actually has (so the gates aren't ceremony):**

| Stage | On normal code | On THIS spike (design-only) | Real bite? |
|---|---|---|---|
| **2 Architect (Aryan)** | binding build plan | binding **architecture deliverable itself** — Aryan + Maya co-own; the spike's output IS Aryan's Stage-2 work product | Yes — this is the heart of the spike |
| **4 Security (Shreya)** | code/secret review | adversarial review of the **RLS/isolation design, residency/PII sequencing, dual-run data-handling** — does the *plan* close the no-RLS leak surface and respect DPDP/residency *before* any data moves? | Yes — design-level VETO on the leak/compliance plan |
| **5 QA (Tanvi)** | run tests | **verify the artifacts exist, are complete, and are internally consistent** against the acceptance contract below (every legacy capability mapped; every slice has a parity+rollback+decommission plan; risk register covers all 6 non-negotiables; no orphan capability) | Yes — completeness/consistency is verifiable without running code |
| **6 Final review (Rohan)** | re-run gates | drift check vs this contract + re-confirm the strangler sequence is genuinely phased (not a disguised big-bang) + over-engineering audit (is the architecture proportionate, or gold-plated?) | Yes |

**Stages that genuinely have thin surface (and I say so honestly):**
- **Mutation tests** — N/A for a no-code spike. There is no code to mutate. Tanvi's Stage-5 mandate adapts to *artifact-completeness verification*, which is the right analogue. I am NOT requiring mutation tests be invented for design work; that would be fabricated rigor.
- **Stage 8 deploy / 48h monitor** — there is nothing to deploy. The "deploy" is the *acceptance of the architecture as binding* (it spawns the children). Jatin's stage becomes a no-op readiness confirmation analogous to the scaffold deploy (`runtime_deployed: false`).
- **Real-network smoke** — N/A; no runtime touched.

So: the lane stays high-stakes, **all reasoning gates run with real surface** (architect, security-of-the-design, completeness-QA, final review, Founder gate), and the **code-specific gates honestly degrade to their design-only analogues** rather than being faked. This is the correct posture: don't weaken a real gate, don't fabricate one.

---

## Persona-count decision

| Field | Value |
|-------|-------|
| **Count** | **2** (the cap; high-stakes lane) |
| **Rule fired** | Two distinct dominant risk dimensions intersect (subagent-orchestration, "2 personas" row): the migration *method* (engineering) and the *isolation + financial/compliance integrity* of the sequencing (non-engineering). |
| **Personas chosen** | (1) `migration-strangler-fig-realist`; (2) `india-data-isolation-compliance-officer` |

**Re-confirmed — judgment unchanged from the epic.** These two were named on the epic specifically *to attach to this child's Stage 1*, where they shape a planable scope (the epic verdict was CHALLENGE-BACK, so the adversarial reads land here, not there). They map cleanly onto the two gates that have the most teeth for a design deliverable.

**Sharpened one-line briefs (mandate for the persona generator):**

1. **`migration-strangler-fig-realist`** — *"Read the proposed strangler-fig sequence as an adversary trying to prove it is a big-bang rewrite wearing a phased label. For each slice boundary, attack: can legacy stay authoritative and live while Brain runs in shadow? Is dual-write/dual-read genuinely reversible per slice, or does any slice create a point of no return? Where does the facade/anti-corruption layer leak the legacy model into Brain (or vice-versa)? Is the ordering safe given the dependency graph (RLS before connectors; money before metrics), or does any slice secretly require a later one? Name the single slice most likely to force an unplanned big-bang and why."*

2. **`india-data-isolation-compliance-officer`** — *"Pressure-test the migration *sequencing* for data-isolation, residency, and financial-integrity failure modes — concrete, not hypothetical. (a) The 66 app-layer `workspaceId` assumptions with NO Postgres RLS: does the plan close the cross-brand-leak surface BEFORE any data moves, and does adding RLS break the app-layer assumptions? (b) Live customer PII (`ShopifyCustomer`, emails, addresses) + India residency (ap-south-1) + DPDP consent the legacy schema does not model — at which slice does PII cross a boundary, and is consent/residency provable before it does? (c) The Decimal/Float→BIGINT minor-units conversion across ~48 models: where is rounding-drift or a dual-run money mismatch a financial-correctness/billing-base risk (realized GMV in minor units is the fee base)? Flag any point that should `/escalate` to the Founder as a DPDP/residency ambiguity rather than be decided by the spike."*

**Declines (carried from the epic, still correct):**
- **`ai-cost-realist`** — the LiteLLM-gateway / `@paradigm` / kill-the-direct-SDK decisions belong to **Child 5 (AI-engine migration)**, not to the architecture spike. Spawning it here would be a 3rd persona overshooting a slice that isn't first. The spike only *maps* the legacy AI surface to a target; it does not bind the cost model. Flagged as a required persona on Child 5.
- **Generic architecture persona** — slice-boundary correctness is **Aryan's binding Stage-2 job** on this very child (co-owned with Maya). The strangler-fig realist already supplies the adversarial migration-method read. Don't duplicate Aryan.

> Per orchestration rules I do **not** spawn these. They are returned in `needs_personas`; the orchestrator spawns both in parallel and re-invokes me to synthesize. Synthesis stays ADVANCE — these personas sharpen the *sequence + guardrails*; they don't change that the spike should run.

---

## Tightened spike contract (the binding scope Aryan + reviewers inherit)

This is the load-bearing part of this child's Stage 1: a tight contract so "good enough" isn't subjective.

### Co-ownership
- **Aryan (architect)** — owns the capability map, strangler-fig sequence, facade/ACL design, per-slice parity/rollback/decommission, dual-run strategy, risk register. This is his Stage-2 deliverable.
- **Maya (intelligence/data-ml)** — co-owns the **data + AI-surface mapping**: the legacy metric/rollup tables (`*DailyMetrics`, `*DailyAggregate`) → metric-registry + ClickHouse target; the legacy AI-engine surface (`ai-engine`/`ai` modules, direct-SDK/Ollama providers, "Triple Whale-style" insights) → Brain agentic + Decision-Log target (mapping only — Child 5 binds it). The dual-run **shadow-compare** of computed numbers is a data-ML concern Maya must specify.

### Required artifacts (acceptance = ALL exist and pass the completeness bar)

| # | Artifact | "Good enough to make later slices planable" bar |
|---|---|---|
| A1 | **Capability map** | EVERY legacy Prisma model (~48), backend route/lib group, connector (7), and frontend route-group (~204 tsx, grouped) → its target Brain bounded context **or** explicit "deprecate". Each row classified reuse/refactor/redesign **and** tagged with which of the 6 non-negotiables it is missing. **Zero orphans** (no legacy capability without a target or a deprecate decision). |
| A2 | **Strangler-fig sequence** | The ordered slice list (the 7-ish children) with explicit dependency edges, each with: entry criterion, exit/parity criterion, and the facade behavior during the slice. Must be demonstrably phased — every slice independently reversible; legacy authoritative until that slice's parity gate passes. |
| A3 | **Facade / anti-corruption-layer design** | How legacy stays live + reachable + authoritative while Brain runs alongside per slice: where the facade sits, what it routes, how it prevents the legacy model from leaking into Brain's domain (and vice-versa), how routing flips at cutover. |
| A4 | **Per-slice parity + rollback + decommission plan** | For each slice: a concrete, *measurable* definition of "parity" (what is compared, tolerance — esp. money: zero rounding drift), the rollback procedure, and the decommission criterion (when legacy code for that slice is safe to delete). |
| A5 | **Dual-run / shadow-compare strategy** | How legacy + Brain run side-by-side: dual-write/dual-read mechanics, what outputs are shadow-compared (numbers, especially money + metrics), how mismatches are surfaced/triaged, the cutover decision rule. Maya specifies the numeric-compare. |
| A6 | **Risk register** | Mapped to the 6 absent non-negotiables (RLS, minor-units money, OLTP/OLAP split, metric-registry TS↔Python parity, gateway/@paradigm/Decision-Log, Kafka spine) + the cross-brand-leak surface + PII/residency/DPDP + financial-integrity of the money conversion. Each risk: likelihood, blast radius, the slice that mitigates it, and whether it is an `/escalate` candidate. |

### The no-prod-code guardrail (binding constraint on every later stage of this child)
- **ZERO changes to `legacy project/` runtime, schema, or connectors.** Read/analysis + design only.
- **No** schema migration, **no** connector edit, **no** new product code in this child.
- The only files this child produces are **architecture/plan artifacts** in the run folder (+ the EOS bookkeeping). If any builder stage proposes touching legacy or product code, that is a drift bounce, not within-authority.
- Locked Brain stack governs all *target-state* proposals. The two known new-layer questions (Zustand→Redux Toolkit; axios→tRPC) are *mapped here* but *bound* in Child 6 (frontend) — this spike records the decision + rationale, it does not implement.

### What this spike explicitly does NOT decide (hand-offs to later children)
- Final AI-agent roster / cost model → Child 5 (`ai-cost-realist` persona there).
- Actual RLS DDL, money DDL, connector code, metric definitions, frontend rewrite → Children 1–6.
- This spike makes them *planable*; it does not pre-build them.

---

## Domain / canon context check

Inherited from the epic and still binding for this child's *target-state* mapping:
- **Honest economics** — target must invert legacy ROAS-primary to **CM2-first** (CM/CM2 waterfall + RTO provision + break-even COD r). Mapped in A1/A6; bound in Child 4. ✅
- **Multi-tenancy** — 66 `workspaceId` refs, **no RLS** = 1 of 4 layers missing. Leak-surface risk in A6; closed first in Child 1. ✅
- **Money** — Decimal/Float → minor-units; A4 must define zero-rounding-drift parity. ✅
- **Decision Log (moat)** — absent in legacy; A1 maps it; Children 4/5 introduce it before any rec/action migrates. ✅
- **Compliance** — live PII + India COD/GST + no consent/DLT/NCPR modeling; compliance persona reads the *sequencing*; a specific DPDP/residency ambiguity inside a future slice is an `/escalate` trigger, not a guess now. ✅
- **RegionAdapter** — legacy is implicitly India + Shopify/Woo; A1 maps the RegionAdapter even India-only. ✅

**No `/escalate` fired at this child's intake.** The EPIC framing was already ratified; this spike's job is to *surface* the ambiguities (via the compliance persona + A6) that may escalate inside later slices, not to escalate now.

---

## First-pass paradigm

N/A — this child produces **no compute path**. It is analysis + design. (Per-child paradigm guidance lives in the epic review: Children 1–4 are overwhelmingly SQL; only Child 5 carries small/frontier-LLM `@paradigm` decisions.)

---

## Decision: ADVANCE (personas requested first)

ADVANCE the spike. Two personas requested — orchestrator spawns both in parallel, then re-invokes me to synthesize before Stage 2. On synthesis I expect to remain ADVANCE and carry the personas' concerns into Aryan + Maya's Stage-2 contract (the personas sharpen the sequence + guardrails; they cannot, and need not, turn this well-scoped spike into anything else).

**Next after synthesis:** Stage 2 — **Aryan (architect)**, co-owned with **Maya (intelligence/data-ml)** on the data/AI-surface mapping. The spike's six artifacts (A1–A6) ARE Aryan+Maya's Stage-2 deliverable.

---

## Stage 1 DoD

- [x] `02-cto-advisor-review.md` filled (no placeholders)
- [x] Lane decision recorded + re-justified for a no-code spike (high-stakes; carve-out explicitly inapplicable; honest gate-by-gate read)
- [x] Persona-count decision recorded (2, within high-stakes cap) with sharpened briefs — personas requested, synthesis pending orchestrator re-invoke
- [x] Pre-flight dependency check (blocks=[]; no violation)
- [x] Tightened spike contract (A1–A6 + completeness bar + no-prod-code guardrail) recorded
- [x] Decision recorded: **ADVANCE**
- [x] Decision log + journal updated
- [x] state/active.json updated (parent epic `chore-migrate-legacy-to-brain` + `chore-scaffold-monorepo` left intact)

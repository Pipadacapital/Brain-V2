# Stage 1 — CTO Advisor Review (Rohan)

**req_id:** `feat-ai-engine-intelligence` (Child 5 of EPIC `chore-migrate-legacy-to-brain`)
**Stage:** 1 (intake / brainstorm)
**Reviewer:** Rohan (cto-advisor)
**Timestamp:** 2026-05-25T04:30:00Z
**Decision:** **ADVANCE** (2 personas requested first → synthesis pending orchestrator re-invoke)

---

## TL;DR

Child 5 is **THE child where the @paradigm cost-routing invariant finally binds against running code** — it is the engine behind the headline product surface (Morning Brief + AI recommendations) and the first child with a live inference path, so a mis-route here doesn't just cost tokens, it inverts the %-of-GMV unit economics. The requirement is **sound, well-grounded in the binding Child-0 architecture, dependency-satisfiable for the BUILD, and planable** — it is **NOT a KILL and NOT a CHALLENGE-BACK**. But it is the **single broadest functional surface in the epic** (≈15 agent/context surfaces + LiteLLM gateway + Decision Log writes + Memory Layer/pgvector + evals + prompt-injection defense + the C3 cache gate). My intake does real work:

1. **Binds the paradigm as MIXED with a hard split rule** — Tier-A signals are `sql`/`ml` and **never call an LLM**; Tier-B narration is `small_llm`/`frontier_llm` routed through the gateway; and the canon's iron rule — **LLMs NEVER produce a number** — becomes a *structural faithfulness gate*, not a hope.
2. **Binds a scope split (5a vertical slice / 5b full roster) as a Stage-2 must-decide** — the surface is too broad to build flat; the agent roster is config-shaped follow-on behind one proven end-to-end vertical.
3. **Resolves M-A1-Q3** (deterministic-vs-LLM) as a binding Stage-2 input: the deterministic/LLM boundary is already drawn in the architecture (signals = SQL; narration = LLM) and is the load-bearing line the whole cost model rides on.
4. **Hardens the injection→action-injection surface, the C3 hard edge + CACHE-PURGE-C4C5 gate, and the residency/Claude-API data-handling line** into testable constraints.

Maya **co-owns Stage 2** (intelligence-service is her lane; she authored M-A1-3 + the M-A1-Q3 ruling). Two personas: `ai-cost-realist` (mandatory — the cost model is the crux) + `prompt-injection-action-injection-realist` (untrusted commerce text → MCP write tools). **No `/escalate` at intake** — residency + Claude-API data-handling are a bounded build-time gate, not a canon ambiguity (ruling below).

---

## Made requirements less dumb first

**Could delete:**
- Nothing from the *capability* set is deletable without breaking the product (Morning Brief is the headline surface). But the **flat 15-agent build is itself the dumb thing** — see the scope split. The full roster does NOT need to be built in this child to prove the engine; one vertical slice + a config-shaped interface for the rest deletes ~80% of the surface area from the risk-bearing build.
- **The legacy `module/ai-engine/cache/insight-cache.ts` semantics are NOT re-implemented from scratch** — the `filtersHash` key is *preserved* and the cache moves into `memory.insight_cache` (architecture M-A5-5). Don't invent a new cache primitive.

**Could simplify:**
- **Tier-A is the simplification.** ~80% of the legacy AI surface (13 context adapters + anomaly/trend/comparator + intent-classifier) is deterministic SQL that the legacy code was paying Opus/Sonnet to do. Routing it to ClickHouse SQL (zero LLM call) IS the primary cost reduction — the simplification is the feature. Stage 2 must ensure no Tier-A surface quietly grows an LLM call "for richness".
- **Intent-classifier stays deterministic** (architecture line 433: keyword routing, no LLM) — resist the urge to "upgrade" it to an LLM router.

**Could defer (and the architecture already does):**
- **Frontend rendering** of Morning Brief / AI Chat → Child 6 (out of scope, confirmed).
- **Legacy AI-path decommission** → Child 7 (out of scope, confirmed).
- **Live serving flip + cache purge firing** → HELD (recommendation-only; legacy AI stays authoritative). Mirror the prior-children HOLD discipline. **The full 15-agent roster → defer the long tail to 5b behind a proven 5a vertical slice (see scope ruling).**

---

## Pre-flight dependency check (MANDATORY — child requirement)

Child-5 entry in the epic `proposed_children` (`child-5-ai-engine-migration`): **`blocks: ["child-0-audit-migration-architecture-spike", "child-4-metric-engine-oltp-olap-split"]`.**

| Blocker | Maps to | Status in state | Satisfied for BUILD? |
|---|---|---|---|
| `child-0-audit-migration-architecture-spike` | `spike-legacy-migration-architecture` | `done` | YES |
| `child-4-metric-engine-oltp-olap-split` | `feat-metric-engine-olap-split` | `approved` / stage 8 (Stage-6 PASS, Founder gate signed under delegation; **NOT committed, NOT live-flipped**) | **YES for the SHADOW BUILD; the LIVE flip is HELD** — see ruling |

**The build-vs-live dependency ruling (the pre-flight crux, requested explicitly):**

Architecture **C3 (line 509/515) is the ONLY hard sequential edge in the entire DAG**: *"Child 5 has the only hard sequential edge — it cannot start until Child 4's ClickHouse is authoritative."* I must rule precisely on what "start" means, because reading it as "Child-4 must be LIVE-FLIPPED" would deadlock the standing directive (Child 4 is intentionally `HOLD-AT-READ-FLIP`, never live-flipped).

**RULING — mirror the prior-children build-vs-live distinction exactly:**

- The C3 hard edge governs the **LIVE SERVING** of Brain AI ("Mandatory entry: `workspace_daily_metrics` no longer authoritative; Brain AI reads ClickHouse" — line 509). That is the **HELD** part of this child and stays held.
- The **BUILD (Shape-A)** — the agents, the gateway, the Decision Log writes, the Memory queries, the evals, the injection defense, the context_builders reading the **Child-4 metric-registry / ClickHouse-MV contract** — proceeds against that contract, exactly as Child 4 built against the Child-2 registry that was itself only committed-on-branch, and Child 3/4 built against Child-1/2 committed-on-branch. **Build-on-contract is satisfied; live-flip is gated.**
- **`status != "shipped"` exception:** Child-4 is `approved` (Stage-6 PASS, Founder-gate-signed under the standing delegation), not `"shipped"`/merged. This is the **same situation Child 4 itself was in relative to Child-2** (committed-on-branch, not merged) and which I ruled non-blocking-for-build there. The build-base (branch carrying Child-4's `lib-metrics`/`brain_metrics` registry + ClickHouse MV DDL + query-gateway) is a Stage-2/3 resolution, **not an intake violation**. **No dependency-violation; I do NOT refuse to proceed.**
- **The HELD live flip additionally requires** (carried to Stage 2 as the named hold gate): Child-4 live ClickHouse authoritative for workspace W **AND** `CACHE-PURGE-C4C5` armed-and-fired for W **before** any Brain narration is served (architecture M-A5-5 line 470–477).

**Child-1 (RLS gate):** SATISFIABLE Brain-native (`feat-tenancy-rls-brain-native`, committed). The intelligence-service reads ClickHouse via Child-4's workspace-scoped query-gateway + writes Decision Log/Memory under RLS — the gate at SATISFIABLE is sufficient for a shadow/recommendation-only build (live FORCE stays HELD). **Child-2 (money)** committed-on-branch — AI inputs are MU. No violation.

**Result: NO dependency violation. Proceed with the BUILD; the live serving flip is the named HELD state.**

**Build-base note (carry to Stage 2, not blocking intake):** Child-1/2/3/4 are committed on `feature/feat-tenancy-auth-rls-hardening`, not yet merged to `development`. Child-5 build imports Child-4's `analytics-service` query-gateway + metric registry + Decision-Log/Memory schema. Resolve the build-base (merge-to-development or branch-from) at Stage 2/3 — same resolution as Children 3 and 4.

---

## Semantic recall (v0.8.0)

`memory_search -k 6` on the Child-5 gist returned **no near-duplicate** (top sim 0.72). Nearest prior records are all *the binding context*, not a shippable template: Maya's Child-0 A1.5/A5.2 AI-surface deepening (sim 0.72 — the authoritative M-A1-3 mapping this child makes concrete), the Child-4 build/registry records (sim 0.69 — the metric contract this child reads), and the Child-1 DPDP-instrument escalation (sim 0.69 — the residency/PII shape). **This is a genuine new build with no shipped AI-engine pattern to template.** What I reuse rather than re-derive: the Shape-A / named-HOLD boundary discipline (every child), the parity-harness/eval shape (Child-2/4), the Single-Primitive sweep + over-engineering audit posture, and the build-vs-live dependency ruling shape (Child-3/4). The injection + cost dimensions are **net-new to the epic** — hence both personas.

---

## Lane decision

| Field | Value |
|---|---|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Trigger scan fires the **largest surface set of any child to date**: **AI-surface / connectors** (the whole product-agent + gateway inference path — the subject of the child); **mcp-tools** (`@mcp_tool` write tools the agents reach — `module/ai/tools` → Brain MCP surface, line 462); **pii** (untrusted commerce text — inbox/ticket/ad-copy/brand-notes — flows into LLM context → prompt-injection → **action-injection**; customer PII may enter prompts); **money** (every AI *input* is a minor-units metric; the iron rule LLMs-NEVER-produce-a-number means a faithfulness violation is a money-correctness incident); **multi-tenancy** (per-workspace budgets, Decision Log + Memory writes, cross-tenant insight/cache leak = P0); **india-compliance** (India-resident inference for PII + Decision-Log residency ap-south-1, CF-RES-1; Claude-API data-handling); **schema-proto** (Decision Log schema + MCP tool contracts + Memory/pgvector schema). Foundational-scaffolding carve-out **inapplicable** (live inference path + business logic + money/PII/connector surfaces all present). Conservative tie-break moot — multiple hard surfaces force high-stakes outright. |
| **trigger_surfaces_touched** | `["connectors", "mcp-tools", "pii", "money", "multi-tenancy", "india-compliance", "schema-proto"]` |
| **Stages that run** | Full high-stakes lane, no stage drops: 1 (intake, **2 personas**) → 2 (architect Aryan, **Maya co-owns**) → 3 (build) → 4 (Shreya security — injection-defense + tool-scope VETO surface) → 5 (Tanvi QA — **mutation tests on the faithfulness/injection/paradigm gates are mandatory**) → 6 (Rohan final-review VETO — **paradigm audit is load-bearing here**) → 7 (Founder gate, delegated) → 8 (readiness). |

---

## Paradigm — the crux (MIXED; @paradigm cost-routing binds here)

**`MIXED` — `sql`/`ml` for Tier-A signals (~80%) + `small_llm`/`frontier_llm` for Tier-B narration (~20%), routed through the LiteLLM gateway. CONFIRMED and BINDING.**

This is the child the whole cost-routing skill exists for. Brain bills %-of-GMV; a Sonnet call is ~10,000× an SQL query; the legacy code was paying Opus/Sonnet for the *entire* AI surface — that is precisely the inversion this child reverses.

**The Q1–Q4 audit, applied to the surface (architecture M-A1-3 / lines 430–467 already did the routing; I bind it):**

| Surface | Q1 SQL? | Q2 ML? | Q3 small_llm? | Q4 frontier? | Bound paradigm |
|---|---|---|---|---|---|
| 13 context_builders (data fetch from ClickHouse MV) | **YES** | — | — | — | `sql` — zero LLM call |
| anomaly / trend / comparator (z-score / lin-reg / %-delta) | **YES** (ClickHouse `stddevPop` / `simpleLinearRegression`) | (statistical, not ML-model) | — | — | `sql` |
| intent-classifier (keyword routing) | **YES** | — | — | — | `sql` — stays deterministic |
| benchmarks / workspace-ai-config lookups | **YES** | — | — | — | `sql` |
| page-insight narration — 12/13 standard pages | No (genuine NL) | No | **YES** | — | `small_llm` (Haiku-class, gateway-routed) |
| page-insight `global` + chat (multi-turn reasoning) | No | No | No | **YES** | `frontier_llm` (Sonnet 4.6 default, eval-gated) |
| Morning Brief 07:15 synthesis (the writing) | No | No | No | **YES** | `frontier_llm` |

**The cost-routing iron rules I bind for Stage 2/5/6:**

1. **LLMs NEVER produce a number.** Every number in any AI output is sourced from a deterministic Tier-A signal / ClickHouse metric. The LLM receives numbers as *structured context* and may only *narrate* them. This is enforced **structurally** (Challenge (b) below — the faithfulness gate), not by prompt instruction alone.
2. **No Tier-A surface may grow an LLM call.** Any `@paradigm: haiku/sonnet/small_llm/frontier_llm` decorator appearing on a context_builder, a signal detector, the comparator, or the intent-classifier at Stage 6 = a **paradigm violation → automatic BOUNCE**.
3. **Model-agnostic routed tiers.** `@paradigm("small_llm"|"frontier_llm")` names a *policy tier the gateway resolves to the cheapest model passing that tier's eval bar* — not a fixed model. The Stage-6 audit asks **which model the gateway routed to and did it pass the eval bar at that cost.**
4. **Layer-3 per-workspace monthly LLM cap MUST be live before the highest-cost surface (chat/Morning-Brief synthesis) ships** (cost-routing skill, non-negotiable). Recommendation-only/HELD does not exempt the cap from being *built* — it must exist in the gateway this child.
5. **Target mix is measured, not asserted:** the `paradigm_distribution` telemetry (per-workspace/day) must be emitted by the gateway so the 85/12/2.5/0.5 target is observable. Challenge (e) (hidden LLM over-use) is checked against this telemetry at Stage 6.

**M-A1-Q3 resolution (binding Stage-2 input):** The deterministic-vs-LLM boundary is **already authoritatively drawn** by Maya in the architecture (M-A1-Q3 answer + lines 430–467): signals (anomaly/spike/trend) + context-building + intent-routing + benchmarks are **deterministic (SQL)**; only genuine narration (page-insight, chat, Morning-Brief synthesis) is **LLM**. I bind this as the Stage-2 starting contract — Aryan/Maya may *not* move a surface from the SQL column to the LLM column without a recorded paradigm justification through Q1–Q4. The split is the cost model; the cost model is the unit economics.

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | AI *inputs* include RTO signals (rto_rate_bp, rto_value_mu from Child-4 MVs); narration must re-anchor to CM2/RTO-provisioned economics, NOT ROAS (architecture M-A1-2 — system prompts updated to CM2-first, line 455). The AI does not *compute* RTO numbers (LLMs never produce a number); it narrates the deterministic signal. |
| **COD** | Same — COD/prepaid split + break-even COD rate are deterministic Child-4 signals the agents narrate. |
| **GST** | AI inputs include `total_tax_mu` (per-SKU GST-2.0 event tax, Child-4 CF-C4-GST-EVENT-TAX-1). AI narrates; never recomputes. Note this metric carries a Child-3 dependency in the DDR — narration over it inherits that caveat. |
| **Festival seasonality** | Anomaly/trend detection over festival-spiked series is a **deterministic-signal correctness** concern (false-positive spikes during Diwali) — belongs to Child-4's signal layer, narrated here. Flag for Stage 2: the Morning Brief must not "recommend" against a festival baseline as if it were an anomaly. |
| **Pincode reliability** | pincode-intelligence context_builder (line 454) is `sql` data-fetch; narrated, not computed by LLM. |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | **Relevant via the MCP write-tool surface.** If any agent's tool can trigger an outbound channel (WhatsApp/SMS/call/ad-audience), the DLT/NCPR/9am–9pm/template-policy constraints apply. **Recommendation-only-until-graduated keeps these tools from auto-firing in this child** — but the tool *contracts* and their server-side caps + least-privilege scopes are designed now (Challenge (c)). Any outbound-channel tool that could *fire* (vs recommend) is OUT of this child's graduated scope and must be flagged at Stage 2. |

---

## Challenge — the five hard pressure-points (decision is ADVANCE; these are binding Stage-2 inputs, not a CHALLENGE-BACK)

### (a) Scope — intelligence-service is the broadest surface in the epic; slice it.

15 agent/context surfaces + gateway + Decision Log + Memory + evals + injection defense in one flat build is the same "too-big-to-build-honestly" trap I caught on Child 4 (4a/4b) and Child 3 (3a/3b/3c). **Binding scope ruling (Stage-2 must-decide, CF-C5-SCOPE-SPLIT-1):**

- **5a — the proven vertical slice (the dangerous unit, ships first):** the **LiteLLM gateway** (`@paradigm` routing + per-workspace virtual-key budgets + semantic cache + Layer-3 cap + cost/paradigm telemetry + India-resident inference) + **Decision Log** write middleware (every recommendation + every MCP write tool) + **ONE end-to-end agent vertical** (recommend page-insight: the `analytics` or `pnl` context_builder → Tier-A signals → Haiku narration → Decision Log row → eval-gated → injection-defended) + the **Memory Layer query** primitive (Brand Fingerprint pgvector, k≥5) + the **eval harness** (golden-set + faithfulness/groundedness) + the **injection-defense stack** (all six layers). This proves the *engine + every cross-cutting gate* end-to-end on one agent.
- **5b — the full roster (config-shaped follow-on, ships behind 5a):** the remaining ~12 page agents + AICMO/AICOO/AICFO + AI CX recommenders + the 07:15 Morning-Brief fan-out synthesis, each as an *instance of the proven 5a primitives* (base class + `@paradigm` + `@mcp_tool` decorators), NOT new bespoke paths.
- **Rule:** collapsible into ONE tracked build at Stage 2 with a one-line rationale (burden on collapsing, not on splitting) — **NOT** split into separate `/requirements` (would fragment gateway/Decision-Log/eval ownership). If Aryan collapses, the **eval-gate + faithfulness-gate + injection-defense + paradigm-route must each be proven on the 5a vertical BEFORE any 5b agent is wired** — a 5b agent must never reach a write tool on an un-evaled, un-defended path. Precedent: Child-1 1a/1b, Child-3 3a/3b/3c, Child-4 4a/4b — scope refinement within ADVANCE, not a CHALLENGE-BACK.

### (b) The LLMs-NEVER-produce-a-number faithfulness gate — how is the 07:15 synthesis *structurally* prevented from contradicting the deterministic numbers?

A prompt instruction ("only use the numbers I gave you") is not a gate — it is a hope, and it is exactly the kind of thing a tautological test fakes (the recurring verify-the-verifier pattern, evidence #5). **Binding constraint CF-C5-FAITHFULNESS-1:** the narration path must enforce numeric faithfulness **structurally**, and the eval must prove it with a **killed mutant**. Stage-2 must specify the mechanism; acceptable shapes (Aryan/Maya choose):
- **Numeric grounding by reference, not generation:** the LLM emits narration with **typed slots/citations** that bind to specific deterministic signal IDs; a post-generation validator asserts every number in the output string **exactly matches** a value in the structured input context (re-extract numbers from the narration → set-compare against the provided signal values → any number not present, or any provided value contradicted, **fails the response before it is written to the Decision Log / served**).
- The eval harness must include a **faithfulness adversarial set** where the structured context contains numbers the model is tempted to "round" or "improve", and a **killed-mutant test**: a deliberately number-hallucinating narration MUST be caught RED by the faithfulness validator (mirrors the Child-4 mutation-on-gate discipline). A faithfulness gate that passes a hallucinated number = a vacuous gate = BOUNCE.
- This is the iron rule (LLMs never produce a number) made into a runtime assertion, not a system-prompt sentence. **Owner: Maya (eval/faithfulness) + Aryan (validator placement in the gateway/agent path).**

### (c) Prompt-injection → action-injection — untrusted commerce text drives MCP write tools.

Brain is unusually exposed: inbox/ticket text, ad-copy, campaign names, brand notes, marketplace extracts, **and prior-LLM output** all flow into agent context, and agents reach `@mcp_tool` write tools (`module/ai/tools` → Brain MCP surface, line 462). Injection becomes **action-injection** (a poisoned campaign name flips "summarize" into "pause all campaigns" / "refund"). **Binding constraint CF-C5-INJECTION-1 — ship all six layers on any agent that can reach a write tool** (prompt-injection-defense skill):
1. Input isolation + spotlighting (untrusted text in fenced data blocks, never concatenated into instructions).
2. Output-schema validation **before any tool runs**.
3. Dedicated injection preprocessor on untrusted text.
4. Behavioral tool-call monitoring.
5. **Least-privilege tool scopes** (per-agent, per-workspace; an `@mcp_tool` an agent cannot reach cannot be injected).
6. **The Iron Law: untrusted text MAY influence the model's WORDS — it MUST NEVER choose the tool or its magnitude. The tool + the size of the action (₹ moved, % budget) are decided by typed code with server-side caps**, never parsed from free text.

Plus: **recommendation-only-until-graduated** is the structural backstop this child (no tool auto-fires; every action is a Decision-Log recommendation a human graduates) — but the caps + scopes + Iron-Law enforcement are **built now** so graduation does not later open an undefended path. Stage-5 must prove with a **killed mutant**: a crafted injection input must NOT change which tool fires or its magnitude (the cap holds server-side). **Owner: Aryan (tool-scope + cap architecture) + Maya (preprocessor + spotlighting in the agent path); Shreya VETO surface at Stage 4.**

### (d) The hard C3 edge + cache-purge gate.

The ONLY hard sequential edge in the DAG (line 515). **Binding constraint CF-C5-C3-EDGE-1:** the BUILD reads the Child-4 metric-registry/ClickHouse-MV contract via Child-4's **workspace-scoped query-gateway** (never raw, never the legacy Postgres rollup — Child-4's single-writer/single-reader discipline must hold transitively). The **live serving flip is HELD** behind: (i) Child-4 ClickHouse authoritative for W, (ii) **`CACHE-PURGE-C4C5` armed-and-fired** for W (architecture M-A5-5: `DELETE … WHERE workspace_id=W`; post-purge `SELECT COUNT(*) … expires_at>NOW()` MUST return 0; the facade blocks Brain narration for W until the count is zero), (iii) recommendation→graduation per agent. **The `filtersHash` key (sha256 of workspaceId/page/dateFrom/dateTo/filters) is PRESERVED** as the cache key (no new cache primitive) and the purge is a **named cutover step, not a post-condition** — it fires *before* Brain narration is served for W. **Owner: Aryan (gateway read-path + facade gate) + Maya (insight_cache primitive + purge).**

### (e) Cost-model — does the Tier-A/B split actually hit the target mix, or is there hidden LLM over-use?

The 80/20 split is an *architecture claim*; this child makes it *measurable*. **Binding constraint CF-C5-COST-AUDIT-1:** the gateway must emit `paradigm_distribution` telemetry (per-workspace/day) so the 85% SQL / 12% ML / 2.5% small_llm / 0.5% frontier target is *observable, not asserted*. The hidden-over-use traps to check at Stage 2/6: (1) a context_builder that "enriches" with an LLM call (must stay `sql`); (2) the chat/global path silently routing standard pages to `frontier_llm`; (3) the semantic cache hit-rate too low to keep small_llm under budget; (4) the Morning-Brief fan-out making N frontier calls instead of one synthesis over pre-computed Tier-A signals. **The `ai-cost-realist` persona binds the exact per-call token budget + per-brand monthly projection (the cost-routing PR-template fields) — this is the persona's core job.** The Layer-3 cap (rule 4 above) is the backstop if the mix drifts.

---

## Persona-count decision

| Field | Value |
|---|---|
| **Count** | **2** (high-stakes cap; two distinct, intersecting risk dimensions) |
| **Rationale** | Classifier rule: *"two distinct risk dimensions intersect"* → spawn two. Here the two dimensions are **(1) cost-routing correctness** — the entire reason this child exists, the %-of-GMV economics ride on the Tier-A/B split and the faithfulness gate (an LLM that produces a number is both a correctness AND a cost defect) — and **(2) AI-safety / prompt-injection → action-injection** — a net-new threat surface to the epic (untrusted commerce text steering MCP write tools), with a Shreya VETO surface behind it. These are genuinely distinct (one is unit-economics + numeric integrity; the other is adversarial-input + tool-action safety) and they *intersect* at the agent path, which is exactly the "spawn two" case. Not 1 (cost alone would miss the injection surface that Shreya will VETO on; injection alone would miss the cost inversion that is the child's reason for being). Not 3+ (the remaining dimensions — residency/compliance, architecture correctness — are NOT persona-worthy: residency is a one-line startup-gate bind + a bounded ruling I make below, and architecture correctness is Aryan's binding Stage-2 job). |
| **Personas (requested — orchestrator spawns; I synthesize next pass)** | 1. **`ai-cost-realist:sonnet`** — reasoning-heavy: bind the exact per-call token budgets + per-brand monthly ₹ projection at Sugandh-Lok volume; adversarially prove the Tier-A/B split actually hits the 85/12/2.5/0.5 target and find the hidden-LLM-over-use paths (Challenge (e)); pressure-test the faithfulness gate as a *cost* defect (a hallucinated number is also a wasted frontier call); confirm the Layer-3 cap + `paradigm_distribution` telemetry are present and load-bearing. Name the single surface most likely to silently route to `frontier_llm`. **`:sonnet`** because this is multi-step cost modeling + numeric reasoning, not a checklist. |
| | 2. **`prompt-injection-action-injection-realist:sonnet`** — reasoning-heavy: adversarially prove the six-layer defense holds where untrusted commerce text reaches a write tool; find the path where a crafted input changes *which* tool fires or *how much* it moves (Iron-Law breach); pressure-test that recommendation-only + server-side caps + least-privilege scopes are real, not prompt-instructions; confirm prior-LLM-output is treated as untrusted in the cross-agent choreography. Name the single highest-risk injection site (likely the marketplace-extract or inbox path) and the one MCP tool whose cap is most dangerous if injection-controlled. **`:sonnet`** because this is multi-step adversarial reasoning over a tool-action graph. |
| **Personas declined** | `india-residency-claude-api-compliance-officer` — residency-of-inference + Claude-API data-handling is a **bounded startup-gate bind + a ruling I make below**, not a reasoning dimension needing a persona (no new channel/PII *ingest* surface beyond Child-3, already bound; the new fact is only that PII may enter a *prompt*, which the injection persona + the residency constraint cover). `generic-architecture-persona` — the agent base-class / gateway / Memory / Decision-Log architecture is Aryan's binding Stage-2 job; do not duplicate it. **Both declines recorded so a later reader sees the choice was deliberate.** |
| **Persona quality gate** | Each persona must surface ≥1 code/architecture-grounded concern (file:line or concrete path against the binding architecture) or be **rejected as a "looks good" persona** at synthesis. |

---

## Maya co-ownership (Stage 2)

**CONFIRMED.** intelligence-service is Maya's lane by default, and she is the *author* of the binding inputs this child makes concrete: M-A1-3 (AI-surface → target mapping), the M-A1-Q3 ruling (deterministic-vs-LLM boundary), and the M-A5-5 cache-purge gate. **Seam (Aryan ↔ Maya):**
- **Aryan owns:** the gateway integration (LiteLLM routing/budgets/cache/Layer-3 cap/telemetry/residency), the agent base-class + `@paradigm`/`@mcp_tool` decorator plumbing, the MCP tool-scope + server-side-cap architecture, the Decision-Log write middleware, the facade C3 read-path + CACHE-PURGE gate placement, service plumbing.
- **Maya owns:** the agent/context-builder definitions (the M-A1-3 mapping made concrete), the eval harness (golden-set + **faithfulness/groundedness** — Challenge (b)), the Memory-Layer query primitives (Brand Fingerprint pgvector, k≥5), the injection preprocessor + spotlighting in the agent path, the Morning-Brief synthesis prompt (CM2-first, M-A1-2).
- **Integration seam:** the **agent ↔ gateway contract** (the `@paradigm`-decorated call the agent makes and the structured-context/typed-output the gateway returns) + the **faithfulness validator placement** (the structural numeric gate of Challenge (b)). Aryan may *narrow* Maya's co-ownership at Stage-2 open only with a one-line rationale (burden on declining, not requesting — same mechanism as prior children); given she authored M-A1-3/Q3, a full decline is unlikely.

---

## Escalation ruling (India-resident inference / Claude-API data-handling)

**Decision: NO `/escalate` at intake.** Requested explicitly, so I rule it deliberately:

The residency angle has two facets, both **bounded build-time gates, not canon ambiguities**:
1. **India-resident inference for PII (CF-RES-1).** The canon is unambiguous (India data in-region by default; inference touching PII routes through an India-resident path). The architecture already names this (requirement line 14/37/45). This is a **one-line startup-gate bind** (the gateway asserts India-resident routing for any PII-bearing call, refuse-to-start/refuse-to-route on mismatch — the same shape as Child-3's `CF-C3-RESIDENCY-ASSERT-1` and Child-4's `CF-C4-RESIDENCY-1`). No interpretation is open; it's a constraint to implement, bound below as CF-C5-RESIDENCY-1.
2. **Claude-API data-handling.** This is a real consideration (does PII in a prompt leave India / cross to the model provider?), but it is **not a canon ambiguity** — it is a **build-time design choice with a clear constraint**: PII-bearing prompts must use an India-resident inference path (a regional model endpoint / a routed policy that keeps PII in-region), and the gateway's per-call paradigm/residency policy enforces it. The `ai-cost-realist` + injection personas will surface the concrete call-sites where PII enters a prompt; the residency constraint binds how those are routed. **Recommendation-only/HELD** further bounds exposure this child.

**Why this is NOT the Child-1 / Child-3 escalation class:** those escalations were a **missing legal *instrument*** only the Founder could produce (a DPA / §7 memo / a credential-custody decision) that **gated the build**. Here there is **no missing instrument** — the residency constraints are implementable from the canon, and no PII *leaves* the bounded recommendation-only path without the gateway's residency policy applying. **The `/escalate` ARMS** (not fires) on a specific predicate carried to Stage 2: **if Aryan/Maya find that the chosen frontier model for the chat/global/Morning-Brief surface has NO India-resident inference option** (i.e. the only path that passes the eval bar would route PII out of ap-south-1), **THAT is a genuine DPDP §16 cross-border ambiguity over a Founder-priced trade-off (model quality vs residency) → `/escalate` fires then**, exactly as the Child-0 residency tripwire was armed-not-fired. Bound below as CF-C5-RESIDENCY-1 with the armed tripwire. **Mirrored as an informational heads-up (no action requested now) to `pending-founder-attention.md`.**

---

## Binding constraints carried to Stage 2 (the load-bearing intake output)

| ID | Constraint | Owner |
|---|---|---|
| **CF-C5-SCOPE-SPLIT-1** | 5a proven vertical slice (gateway + Decision-Log + ONE end-to-end agent + Memory + evals + injection-defense) / 5b config-shaped roster behind it; collapsible at Stage-2 with a one-line rationale; NOT separate /requirements; every cross-cutting gate (eval, faithfulness, injection, paradigm-route) proven on 5a BEFORE any 5b agent reaches a write tool. | Aryan |
| **CF-C5-PARADIGM-MIXED-1** | MIXED paradigm bound per the table above; LLMs NEVER produce a number; no Tier-A surface grows an LLM call; `@paradigm` on any signal/context-builder/comparator/intent-classifier = BOUNCE; model-agnostic routed tiers; `paradigm_distribution` telemetry emitted. | Aryan + Maya |
| **CF-C5-FAITHFULNESS-1** | The numeric-faithfulness gate is **structural** (output numbers re-extracted + exact-matched against provided deterministic signal values; non-matching response fails before Decision-Log/serve), proven by a **killed-mutant** (a number-hallucinating narration caught RED). A vacuous faithfulness gate = BOUNCE. | Maya (eval) + Aryan (validator placement) |
| **CF-C5-INJECTION-1** | All six injection-defense layers on any agent reaching a write tool; the Iron Law (untrusted text never chooses tool or magnitude; caps server-side); recommendation-only backstop; killed-mutant proves a crafted input cannot change which tool fires or its magnitude. | Aryan (scopes+caps) + Maya (preprocessor+spotlighting); Shreya VETO @ Stage 4 |
| **CF-C5-DECISION-LOG-1** | Decision Log write on **every** recommendation + **every** MCP write tool (middleware on the gateway call); workspace-scoped under RLS; the value-claim proof base; residency ap-south-1. | Aryan |
| **CF-C5-MEMORY-1** | Memory-Layer queries (Brand Fingerprint 16-dim pgvector; Condition-Outcome pairs; cross-brand benchmarks **k≥5**); reads only, workspace-scoped; extends the existing `memory.*` schema (no new store). | Maya |
| **CF-C5-C3-EDGE-1** | Build reads the Child-4 metric-registry/ClickHouse-MV contract **via the workspace-scoped query-gateway** (never raw, never legacy Postgres rollup); live serving flip HELD behind Child-4-authoritative-for-W + CACHE-PURGE-C4C5 fired + per-agent graduation. | Aryan |
| **CF-C5-CACHE-PURGE-1** | `filtersHash` key PRESERVED; CACHE-PURGE-C4C5 is a **named cutover step before serving** (DELETE per-W; post-purge count MUST = 0; facade blocks until zero); built+armed this child, fired at the Stage-8 HELD flip. | Maya + Aryan |
| **CF-C5-COST-AUDIT-1** | Gateway emits per-workspace/day `paradigm_distribution`; per-call token budget + per-brand monthly ₹ projection recorded (cost-routing PR template); the 4 hidden-over-use traps checked at Stage 6. | Aryan + ai-cost-realist persona |
| **CF-C5-LAYER3-CAP-1** | Per-workspace monthly LLM cost cap (Layer-3 throttle) **live in the gateway** before the chat/Morning-Brief surface ships (cost-routing non-negotiable); recommendation-only does not exempt building it. | Aryan |
| **CF-C5-RESIDENCY-1** | India-resident inference for PII-bearing calls + Decision-Log/Memory residency ap-south-1; gateway startup-gate asserts the residency policy, refuse-to-route on mismatch. **ARMED tripwire:** if the eval-passing frontier model for chat/global/synthesis has NO India-resident option → `/escalate` (DPDP §16 cross-border vs model-quality, a Founder-priced trade-off). | Aryan + Maya |
| **CF-C5-RECOMMEND-ONLY-1** | Recommendation-only-until-graduated; no MCP write tool auto-fires; graduation tracker; any outbound-channel tool that could *fire* (DLT/NCPR/9am-9pm/WhatsApp-template surface) is OUT of graduated scope this child and flagged at Stage 2. | Aryan + Maya |
| (inherited) | **CF-BN-NOLEGACY-1** (legacy AI path retired at Child-7, never edited; direct `@anthropic-ai/sdk` ELIMINATED — gateway only), **CF-RES-1** (residency), the Child-4 single-writer/query-gateway discipline (read-side). | all |

---

## Open questions for Stage 2 (inputs for Aryan/Maya, not blockers)

1. **5a vertical-slice collapse-vs-split** decision (CF-C5-SCOPE-SPLIT-1) — which one agent is the 5a vertical (recommend `pnl` or `analytics` page-insight: richest Tier-A signal set, exercises the full faithfulness gate).
2. **The structural faithfulness mechanism** (CF-C5-FAITHFULNESS-1) — typed-slot/citation binding vs post-generation numeric re-extraction + set-compare; where the validator sits (gateway middleware vs agent path).
3. **Least-privilege MCP tool-scope model + server-side cap representation** (CF-C5-INJECTION-1) — per-agent/per-workspace scope grants; how a cap is declared in typed code so free text can never set magnitude.
4. **Gateway model roster + eval bars per tier** (CF-C5-PARADIGM-MIXED-1) — small_llm candidates (Nova Micro / Gemini Flash-Lite / Haiku) + frontier (Sonnet 4.6 default); the India-resident-inference availability per model (feeds CF-C5-RESIDENCY-1's armed tripwire).
5. **Semantic-cache strategy + hit-rate target** to keep small_llm under budget (CF-C5-COST-AUDIT-1).
6. **Morning-Brief 07:15 fan-out shape** (5b) — one synthesis frontier call over pre-computed Tier-A signals, NOT N frontier calls (the cost trap).
7. **`@paradigm` decorator + cost-router presence** — confirm `pylibs/brain_cost_router/` exists (cost-routing skill says it's a Phase-0→1 boundary requirement); if absent, building it is in 5a's gateway scope.

---

## Decision

**ADVANCE.** The requirement is sound, precisely grounded in the binding Child-0 architecture, **dependency-satisfiable for the BUILD** (the C3 hard edge governs the HELD live flip, not the shadow build — ruled above), and planable. It is **NOT a CHALLENGE-BACK** (the scope breadth is resolved by the 5a/5b split *within* ADVANCE, mirroring every prior child) and **NOT a KILL** (this is the headline product surface and the whole point of the cost-routing invariant). Two personas requested to harden the two net-new, intersecting risk dimensions (cost-routing correctness + injection→action-injection) before Aryan/Maya plan. No `/escalate` (residency is a bounded gate with an armed tripwire). Maya co-owns Stage 2.

**Next:** orchestrator spawns `ai-cost-realist:sonnet` + `prompt-injection-action-injection-realist:sonnet` in parallel (writing `03-persona-*.md` / `04-persona-*.md`) → re-invokes me for synthesis → Stage 2 (Aryan + Maya).

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T04:30:00Z",
  "actor": "cto-advisor",
  "type": "stage1-intake",
  "req_id": "feat-ai-engine-intelligence",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "epic_child_id": "child-5-ai-engine",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "paradigm": "mixed (sql/ml Tier-A ~80% + small_llm/frontier_llm Tier-B ~20%)",
  "persona_count": 2,
  "needs_personas": ["ai-cost-realist:sonnet", "prompt-injection-action-injection-realist:sonnet"],
  "maya_co_owns_stage2": true,
  "escalation": "none (residency bounded gate; /escalate ARMED on no-India-resident-frontier-model predicate)",
  "rationale": "Sound, architecture-grounded, build-dependency-satisfiable (C3 governs HELD live flip not shadow build); 5a/5b scope split + MIXED paradigm + structural faithfulness gate + 6-layer injection defense + C3/cache-purge gate bound to Stage 2; 2 personas on the cost + injection dimensions."
}
```

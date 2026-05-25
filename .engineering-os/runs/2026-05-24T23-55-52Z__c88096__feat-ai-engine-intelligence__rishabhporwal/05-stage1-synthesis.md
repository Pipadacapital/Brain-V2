# Stage 1 — Synthesis (post-persona) — Rohan (cto-advisor)

**req_id:** `feat-ai-engine-intelligence` (Child 5 of EPIC `chore-migrate-legacy-to-brain`)
**Stage:** 1 (intake / synthesis pass — personas returned)
**Reviewer:** Rohan (cto-advisor)
**Timestamp:** 2026-05-25T08:15:00Z
**Personas synthesized:** `ai-cost-realist:sonnet` (03) + `prompt-injection-action-injection-realist:sonnet` (04)
**Decision:** **ADVANCE → Stage 2 (Aryan + Maya co-own)**

---

## TL;DR

Both personas **PASS the quality gate** — neither is a "looks good" pass; each surfaced 7 grounded concerns (1 CRITICAL apiece) anchored to specific legacy files (`brain_cost_router/__init__.py`, `context-adapters/pincode-intelligence.ts`, `ai/chat/index.ts`, `ai/tools/executors.ts`, `pipeline/page-insight.ts:184-213`). I **accept 13 of 14 concerns** and fold them into the CF-C5-* set with owners; I **reject none outright** but **down-scope one** (the cost persona's CONCERN 7 prompt-cache is INFO-grade, not a binding constraint — see rejections). The intake's 13 constraints become **20 carried to Stage 2** (7 NEW: PARADIGM-IMPL, PINCODE-TOKEN-CAP, FAITHFULNESS-COST, MORNING-BRIEF-FAN-OUT, CACHE-STRATEGY, CHAT-CONTEXT-PRUNE; + INJECTION-2 through INJECTION-7 fold into a hardened INJECTION-1).

**The convergence finding (the load-bearing synthesis insight):** both personas, working independently on orthogonal lanes (cost vs safety), name **the chat agent as the single highest risk** and **the Morning-Brief fan-out as the dangerous structural seam**. That is not coincidence — it is the signal that these two surfaces are where the engine's cross-cutting gates must be proven hardest:

- **Chat:** cost persona — "no natural damping, unbounded context growth, the surface where Layer-3 cap is hit first" (C6 + highest-cost-risk section). Injection persona — "highest-risk injection site: the multi-turn tool-calling loop, passes the FULL tool list every turn, two-hop injection via tool-result data" (CONCERN 7). **One surface, two kill-vectors. The 5a vertical slice must NOT be chat** (it is the hardest case, not the cleanest proof) — but the 5a primitives must be designed knowing chat is the eventual stress test.
- **Morning-Brief fan-out:** cost persona C4 (N-agent narration = 2.4× cost trap) and injection persona CONCERN 3 (prior-LLM-output re-enters synthesis as trusted text = chained injection) are **the SAME multi-stage seam viewed from two angles** — I de-dupe them into one binding decision: **CF-C5-MORNING-BRIEF-PATTERN-B-1** (Pattern B only: 13 Tier-A signal bundles → ONE Sonnet synthesis; AND prior-agent outputs fenced `trusted=false` if any narration is present). One constraint closes both holes.

**The structural-enforcement throughline (verify-the-verifier lineage, now at its 5th-occurrence epic-wide):** every gate this child introduces — the `@paradigm` decorator, the faithfulness validator, the Iron-Law executor contract, the graduation middleware, the tool-scope dispatch — must be **REAL code with killed-mutant tests, not a prompt sentence or an advisory check.** Both personas independently hit this same nerve (cost C1: "decorator is a zero-impl stub, Stage-6 audit becomes manual grep"; injection C1: "the Iron Law is a sentence in a constraint document, not a demonstrated architectural pattern"). This is exactly the failure class that bit Children 1-4 (contextless RLS probe / tautological re-derivation / impossible-PII-condition / vacuous registry-parity gate). **I bind it for this child by VETO authority.**

**Escalation: NONE fired.** The injection persona's four "Stage-2-blocking" flags are **Stage-2 ARCHITECTURE-BINDING inputs for Aryan/Maya, NOT Founder escalations** (clarified below). The India-resident-inference tripwire stays **ARMED for Stage 2** (fires only if no eval-passing frontier model has an India-resident option). **NO commit. Intake only.**

---

## Persona quality gate

| Persona | Concerns | Severity mix | Quality verdict | Why it passes |
|---|---|---|---|---|
| `ai-cost-realist:sonnet` | 7 | 1 CRIT / 4 HIGH / 2 MED | **PASS** | Every concern file:line-anchored against the legacy migration target; bound the actual per-call token anatomy from the real prompts; produced a defensible per-brand ₹ projection (₹376 optimistic / ₹980 pessimistic) + break-even GMV (₹75K–₹196K); named the single silent-frontier-route surface (chat). Not a looks-good pass — it found a CRITICAL the architecture review would have missed (the decorator is a 4-line stub). |
| `prompt-injection-action-injection-realist:sonnet` | 7 (incl. 1 INFO) | 1 CRIT / 3 HIGH / 2 MED / 1 INFO | **PASS** | Every concern grounded in the actual legacy data-flow (`executeTool` arg-casting, `chat/index.ts:61` full-tool-list, `page-insight.ts:184` free-text recommendation field); produced concrete attack payloads (injected campaign name → reallocate_budget magnitude); answered both required escalation questions (highest-risk site = chat multi-turn loop; most-dangerous cap = budget reallocation, + the per-day-aggregate-cap insight a per-call cap would miss). Not a looks-good pass. |

**Both ACCEPTED.** Convergence on chat + Morning-Brief noted above is itself a quality signal (two independent lanes triangulating the same two surfaces).

---

## Concern disposition (accept / reject / fold)

### ai-cost-realist

| # | Concern | Sev | Disposition | Folds into |
|---|---|---|---|---|
| C1 | `brain_cost_router` `@paradigm` decorator is a zero-impl 4-line stub; cost model rides on non-existent code | CRITICAL | **ACCEPT** | **CF-C5-PARADIGM-IMPL-1 (NEW)** — executable decorator = the FIRST 5a deliverable, before any agent/context_builder is authored; Stage-6 audit must be STRUCTURAL (does the decorated `sql`/`ml` path's call graph reach the gateway?) not a grep. |
| C2 | pincode-intelligence context has no input-token cap (46 rows × 12 fields) → 2× std page, can tip Haiku→frontier | HIGH | **ACCEPT** | **CF-C5-PINCODE-TOKEN-CAP-1 (NEW)** — hard row maxima + construction-time `<1,800t` assertion. Generalized: any context_builder must declare a token ceiling (the analytics 30-row cap is the pattern; pincode is the gap). |
| C3 | faithfulness re-run is a COST defect — a format-normalization false-reject burns a 2nd frontier call | HIGH | **ACCEPT** | folds into **CF-C5-FAITHFULNESS-1** as a sub-clause **CF-C5-FAITHFULNESS-COST-1 (NEW)** — validator normalizes output + signal to canonical integer (paise) BEFORE compare; eval includes the "₹1.2L vs 120000" PASS case; retry-rate emitted to telemetry. (This sharpens the faithfulness gate I already bound; the cost lens caught the false-positive failure mode.) |
| C4 | Morning-Brief fan-out shape unbound; N-agent narration default = 2.4× cost | HIGH | **ACCEPT + DE-DUPE** | **CF-C5-MORNING-BRIEF-PATTERN-B-1 (NEW)** — merged with injection CONCERN 3 (same seam). Pattern B ONLY (Tier-A bundles → ONE synthesis); any per-agent Tier-B narration before synthesis = Stage-6 BOUNCE. |
| C5 | semantic cache hit-rate unvalidated; `filtersHash` (exact-match) ≠ semantic cache; 30% vs 70% hit = ₹4K/mo delta @100 brands | HIGH | **ACCEPT** | **CF-C5-CACHE-STRATEGY-1 (NEW)** — Stage-2 distinguishes `filtersHash` deterministic cache (page-insight, preserved — the M-A5-5 gate key) from gateway semantic cache (chat); 07:15 tick pre-warms top-2 date ranges per workspace; monthly projection cites assumed hit-rate as an explicit parameter. |
| C6 | chat unbounded multi-turn context growth; 20-turn session = ₹53; Layer-3 cap is a monthly cliff not a per-session governor | MEDIUM | **ACCEPT** | **CF-C5-CHAT-CONTEXT-PRUNE-1 (NEW)** — sliding-window (last N=6 turns) + hard 6,000t input ceiling enforced at gateway before dispatch (truncate, not reject). A per-session governor under the Layer-3 monthly cap. |
| C7 | static system-prompt prefix (definitions+benchmarks ~300t) not prompt-cached; ~$84/mo saving @100 brands | MEDIUM | **DOWN-SCOPE → INFO** | NOT a binding CF. It is a real optimization but (a) it is an implementation efficiency, not a correctness/safety/unit-economics gate, (b) the benchmarks block is page-specific so the cacheable prefix is small, (c) binding it risks over-engineering the gateway for a marginal saving on a recommendation-only/HELD child. **Recorded as a Stage-2 ADVISORY note** (Aryan MAY apply Anthropic `cache_control` on the static prefix if cheap); not a gate, not a BOUNCE trigger. See rejections. |

### prompt-injection-action-injection-realist

| # | Concern | Sev | Disposition | Folds into |
|---|---|---|---|---|
| INJ-1/2 | Iron Law is a sentence not an architecture; write-tool executors must source magnitude from a **server-side authoritative record at execution time**, never from LLM tool-call args (schema must not even accept a magnitude field) | CRITICAL | **ACCEPT** | folds into **CF-C5-INJECTION-1** as the binding sub-clause **CF-C5-INJECTION-EXECUTOR-2 (NEW)** — write-tool executor signature sources magnitude server-side; LLM arg is limited to (i) a typed entity ID from a known enum, (ii) an intent enum (pause/increase/decrease) — NEVER a raw numeric magnitude. Makes the Iron Law structurally un-bypassable. **Stage-2 tool-contract-binding (must be designed before any write-tool-reachable agent is specified).** |
| INJ-3 | Prior LLM output re-enters Morning-Brief synthesis as trusted text → chained injection via page-agent narrations | HIGH | **ACCEPT + DE-DUPE** | merged with cost C4 into **CF-C5-MORNING-BRIEF-PATTERN-B-1** — synthesis instruction region = system + structured signal IDs only; any prior-agent narration is fenced `<prior_agent_output trusted="false">`; synthesis cross-references structured signals, never follows embedded instructions. |
| INJ-4 | Least-privilege tool scopes deferred as an open question; must be a static per-agent allow-list at DEFINITION time, enforced at gateway dispatch | HIGH | **ACCEPT** | **CF-C5-INJECTION-SCOPE-4 (NEW)** — per-agent tool allow-list declared statically at agent-class definition (`@mcp_tool(scope=[...])`), verified at instantiation, AND the gateway DROPS any tool-call whose name is not in the agent's allow-list regardless of LLM request (Decision-Log row written on drop). Closes the legacy `tools: AI_TOOLS` full-list-every-turn pattern. |
| INJ-5 | Recommendation-only gate enforced only at orchestrator layer; a deceived orchestrator bypasses it; must be enforced at GATEWAY MIDDLEWARE | HIGH | **ACCEPT** | **CF-C5-INJECTION-GRADUATION-5 (NEW)** — graduation status checked at the gateway middleware (the layer that dispatches to the executor), server-side, stateless w.r.t. LLM context (queries the graduation table), present EVEN IF the orchestrator fails to prevent emission. Survives a deceived orchestrator. |
| INJ-6 | `recommendation` field is free-text NL string (`page-insight.ts:184`); social-engineering injection into the graduation decision | MEDIUM | **ACCEPT** | **CF-C5-INJECTION-TYPED-REC-6 (NEW)** — the recommendation field that drives a graduation decision is a typed struct `{action: RecommendationActionEnum, entity_id, rationale}` with a closed action enum; free-text is render-only and never passed back to the executor as instructions. (Stage-2 Decision-Log schema design.) |
| INJ-7 | Six-layer defense not explicitly applied to ALL untrusted-text entry points (workspace AI config strings, benchmark data into instruction region) | MEDIUM | **ACCEPT** | **CF-C5-INJECTION-SPOTLIGHT-7 (NEW)** — spotlighting applies to ALL human/operator-entered strings that flow into any prompt region (workspace goal labels, custom metric names, display name, future configurable benchmarks), not only real-time commerce text; instruction region contains ONLY static templates + typed signal values. |
| INJ-8 (INFO) | Highest-risk site = chat multi-turn loop; most-dangerous cap = budget reallocation (continuous magnitude, ₹1-5L exposure, Diwali timing); needs per-workspace-per-DAY aggregate cap | INFO | **ACCEPT (binding the actionable part)** | the per-call cap is insufficient — **CF-C5-INJECTION-EXECUTOR-2 carries a per-workspace-per-day aggregate reallocation cap** (multiple sub-cap calls must not aggregate past the daily max). The "chat = highest risk" answer informs the 5a-slice choice (5a is NOT chat). |

---

## Rejections / down-scopes (recorded so a later reader sees the choice was deliberate)

1. **Cost C7 (prompt-cache) → DOWN-SCOPED to a Stage-2 ADVISORY, not a binding CF.** It is an efficiency, not a correctness/safety/economics gate; the cacheable prefix is small (benchmarks block is page-specific); binding it risks gateway over-engineering on a HELD/recommendation-only child for ~$84/mo @100 brands (a scale Brain is not at). Aryan MAY apply `cache_control` on the static prefix if it is cheap; it is not a gate and not a BOUNCE trigger. **This is the only down-scope.**

2. **No concern rejected outright.** Both personas earned their spend.

---

## Clarification — the injection persona's "Stage-2-blocking" flags are ARCHITECTURE-BINDING, NOT Founder escalations

The injection persona marked Concerns 1-4 "Escalate? YES — Stage-2 blocking." **I rule explicitly: these are Stage-2 ARCHITECTURE-BINDING inputs for Aryan/Maya — they MUST be designed before any write-tool-reachable agent is specified — NOT `/escalate`-to-Founder triggers.**

- The persona's own wording confirms it: "Stage-2 blocking inputs for Aryan/Maya's architecture plan" — i.e. they block *Stage-2 design completion*, not *the build awaiting a Founder-only decision*.
- They are **fully derivable from the canon + the prompt-injection-defense skill** (the Iron Law, least-privilege scopes, middleware enforcement, typed recommendations are all skill-prescribed). There is **no missing legal instrument and no Founder-priced trade-off** — unlike the Child-1 / Child-3 escalations, which needed a Founder-only DPA / §7 memo / credential-custody decision the team could not produce.
- Therefore they route to Aryan/Maya as **must-design-before-write-tool** constraints, and Shreya holds the **VETO** on them at Stage 4. I can answer them in good conscience from the canon; that is precisely the "answer rather than escalate" rule.

**Escalation status: NONE-fired.** The **India-resident-inference tripwire stays ARMED for Stage 2** (unchanged): it fires ONLY if Aryan/Maya find the eval-passing frontier model for chat/global/Morning-Brief has NO India-resident inference option — that is the one genuine DPDP §16 cross-border-vs-model-quality Founder-priced trade-off. Informational heads-up already mirrored to `pending-founder-attention.md` at intake.

---

## Structural-enforcement discipline (the verify-the-verifier lineage — BOUND by VETO)

Both personas independently hit the same nerve: a gate that is a *sentence* or an *advisory check* is not a gate. This is the 5th epic-wide occurrence of the pattern (Child-1 contextless RLS probe / Child-2 tautological re-derivation / Child-3 impossible-PII-condition + self-verifying HMAC / Child-4 vacuous registry-parity gate). **For THIS child I bind, by Stage-6 VETO authority, that EACH of the following is REAL code with a NAMED real-path integration test + a killed-mutant test (designed Stage 2, built Stage 3, captured Stage 5):**

| Gate | Must be (not) | Killed-mutant proof |
|---|---|---|
| `@paradigm` decorator | executable enforcement + telemetry (not a grep, not a docstring) | a `sql`/`ml`-decorated function whose call path reaches the gateway → test RED |
| faithfulness validator | runtime numeric re-extract + canonical-integer set-compare (not a prompt sentence) | a number-hallucinating narration → caught RED before Decision-Log/serve |
| Iron-Law executor contract | magnitude sourced server-side at execution (not parsed from LLM args) | a crafted injection that sets a magnitude in tool-call args → magnitude IGNORED, server-side value used |
| graduation middleware | gateway-layer dispatch check (not orchestrator self-check) | an un-graduated agent emitting a write tool-call (orchestrator bypassed) → DROPPED at gateway, Decision-Log recommendation written instead |
| tool-scope dispatch | static allow-list enforced at gateway (not the full list per call) | an agent requesting a tool outside its declared scope → DROPPED at gateway |

A vacuous version of ANY of these = automatic Stage-6 BOUNCE. (This reinforces the pending human-gated rule-proposal `verify-the-verifier-mutation-on-gate`, now at evidence #5; NOT self-adopted — awaits `/adopt-rule`.)

---

## 5a / 5b scope ruling (CONFIRMED, sharpened by the personas)

**CF-C5-SCOPE-SPLIT-1 HELD as written, with one persona-driven sharpening:**

- **5a — the proven vertical slice (ships first):** the **executable `@paradigm` decorator** (cost C1 — now named the FIRST deliverable) + the **LiteLLM gateway** (routing + per-workspace virtual-key budgets + the two distinct caches per CF-C5-CACHE-STRATEGY-1 + Layer-3 cap + `paradigm_distribution` telemetry + India-resident routing) + **Decision-Log write middleware** + **ONE end-to-end agent vertical** — **recommend `pnl` or `analytics` page-insight, explicitly NOT chat** (both personas name chat as the hardest/most-dangerous surface — the 5a slice must be the cleanest proof of the full gate stack, not the hardest case) + the **Memory-Layer query primitive** (pgvector k≥5) + the **eval harness** (golden-set + faithfulness/groundedness with the C3-format-normalization PASS case) + the **6-layer injection-defense stack** (now hardened with INJECTION-2/4/5/6/7).
- **5b — the config-shaped roster (behind 5a):** the remaining ~12 page agents + AICMO/AICOO/AICFO + AI CX recommenders + the **07:15 Morning-Brief fan-out synthesis (Pattern B only)** + the **chat agent (the stress test — sliding-window pruning + full 6-layer defense + the per-day reallocation cap must all hold simultaneously here)**, each an instance of the proven 5a primitives.
- **Rule (unchanged):** collapsible into ONE tracked build at Stage 2 with a one-line rationale (burden on collapsing); NOT separate `/requirements`; every cross-cutting gate proven on 5a BEFORE any 5b agent reaches a write tool. **Sharpened:** chat and Morning-Brief (the two converged-risk surfaces) are explicitly 5b — they are the surfaces where the proven primitives are stress-tested, never the surfaces that prove the primitives.

**Maya co-own: CONFIRMED.** MIXED paradigm: CONFIRMED & BINDING. Named HOLD (HOLD-AT-READ-FLIP — live serving flip + CACHE-PURGE-C4C5 firing): CONFIRMED. Recommendation-only-until-graduated: CONFIRMED.

---

## Full CF-C5-* constraint set carried to Stage 2 (13 intake → 20 carried; 7 NEW; 1 down-scoped to advisory; zero dropped)

| ID | Constraint (one line) | Severity | Owner |
|---|---|---|---|
| **CF-C5-SCOPE-SPLIT-1** | 5a vertical (gateway+decorator+Decision-Log+ONE agent[not chat]+Memory+evals+injection) / 5b roster; collapsible; gates proven on 5a first | — | Aryan |
| **CF-C5-PARADIGM-MIXED-1** | MIXED per Q1-Q4 table; LLMs never produce a number; no Tier-A LLM call; `@paradigm` on signal/context/comparator/intent = BOUNCE; model-agnostic tiers; `paradigm_distribution` telemetry | HIGH | Aryan + Maya |
| **CF-C5-PARADIGM-IMPL-1 (NEW)** | `brain_cost_router` exports an EXECUTABLE `@paradigm` decorator (enforcement + telemetry) as the FIRST 5a deliverable; Stage-6 audit is structural not grep | **CRITICAL** | Aryan |
| **CF-C5-FAITHFULNESS-1** | numeric faithfulness STRUCTURAL (output numbers re-extracted + exact-matched to deterministic signal values; non-match fails before Decision-Log/serve); killed-mutant; vacuous gate = BOUNCE | HIGH | Maya (eval) + Aryan (placement) |
| **CF-C5-FAITHFULNESS-COST-1 (NEW)** | validator normalizes output + signal to canonical integer (paise) BEFORE compare; eval has the "₹1.2L==120000" PASS case; retry-rate emitted to telemetry | HIGH | Maya + Aryan |
| **CF-C5-INJECTION-1** | all 6 injection-defense layers on any write-tool-reachable agent; recommendation-only backstop; killed-mutant that a crafted input cannot change which tool fires or its magnitude | HIGH | Aryan (scopes/caps) + Maya (preprocessor/spotlight); Shreya VETO @4 |
| **CF-C5-INJECTION-EXECUTOR-2 (NEW)** | write-tool executor sources magnitude from a server-side authoritative record at execution; LLM arg limited to typed entity-ID enum + intent enum, NEVER a raw magnitude; + per-workspace-per-DAY aggregate reallocation cap | **CRITICAL** | Aryan; Shreya VETO @4 |
| **CF-C5-INJECTION-SCOPE-4 (NEW)** | per-agent tool allow-list declared statically at agent-class definition, verified at instantiation; gateway DROPS any out-of-scope tool-call regardless of LLM request (Decision-Log on drop) | HIGH | Aryan |
| **CF-C5-INJECTION-GRADUATION-5 (NEW)** | recommendation-only/graduation enforced at GATEWAY MIDDLEWARE (server-side, stateless w.r.t. LLM, present even if orchestrator fails), not orchestrator self-check | HIGH | Aryan |
| **CF-C5-INJECTION-TYPED-REC-6 (NEW)** | the recommendation field driving a graduation decision is a typed struct `{action: closed-enum, entity_id, rationale}`; free-text is render-only, never an executor instruction | MEDIUM | Maya + Aryan (Decision-Log schema) |
| **CF-C5-INJECTION-SPOTLIGHT-7 (NEW)** | spotlighting applies to ALL human/operator-entered strings into any prompt region (goal labels, custom metric names, display name, configurable benchmarks); instruction region = static templates + typed values only | MEDIUM | Maya |
| **CF-C5-MORNING-BRIEF-PATTERN-B-1 (NEW, de-dupes cost C4 + injection INJ-3)** | Pattern B ONLY (13 Tier-A bundles → ONE Sonnet synthesis); any per-agent Tier-B narration before synthesis = BOUNCE; AND prior-agent outputs fenced `trusted=false`, synthesis cross-references structured signals only | HIGH | Aryan + Maya |
| **CF-C5-PINCODE-TOKEN-CAP-1 (NEW)** | pincode-intelligence context_builder hard row maxima (≤27) + construction-time `<1,800t` assertion; generalize a token ceiling per context_builder | HIGH | Maya |
| **CF-C5-CACHE-STRATEGY-1 (NEW)** | distinguish `filtersHash` deterministic cache (page-insight, preserved = M-A5-5 key) from gateway semantic cache (chat); 07:15 pre-warms top-2 date ranges/workspace; projection cites hit-rate as explicit parameter | HIGH | Aryan |
| **CF-C5-CHAT-CONTEXT-PRUNE-1 (NEW)** | chat sliding-window (last N=6 turns) + hard 6,000t input ceiling at gateway before dispatch (truncate not reject); a per-session governor under the Layer-3 monthly cap | MEDIUM | Aryan |
| **CF-C5-DECISION-LOG-1** | Decision-Log write on EVERY recommendation + EVERY MCP write tool (gateway middleware); workspace-scoped under RLS; residency ap-south-1 | HIGH | Aryan |
| **CF-C5-MEMORY-1** | Memory-Layer queries (Brand Fingerprint 16-dim pgvector + Condition-Outcome pairs + cross-brand benchmarks k≥5); reads only, workspace-scoped; extends `memory.*`, no new store | — | Maya |
| **CF-C5-C3-EDGE-1** | build reads Child-4 registry/MV contract VIA the workspace-scoped query-gateway (never raw, never legacy rollup); live flip HELD behind Child-4-authoritative-for-W + CACHE-PURGE fired + graduation | HIGH | Aryan |
| **CF-C5-CACHE-PURGE-1** | `filtersHash` key PRESERVED; CACHE-PURGE-C4C5 a NAMED cutover step BEFORE serving (DELETE per-W; post-purge count MUST=0; facade blocks until zero); built+armed this child, fired at Stage-8 flip | HIGH | Maya + Aryan |
| **CF-C5-COST-AUDIT-1** | gateway emits per-workspace/day `paradigm_distribution`; per-call token budget + per-brand monthly ₹ projection recorded (cost-routing PR template); 4 hidden-over-use traps checked @6 | HIGH | Aryan + cost lens |
| **CF-C5-LAYER3-CAP-1** | per-workspace monthly LLM cost cap (Layer-3) LIVE in the gateway before the chat/Morning-Brief surface ships; recommendation-only does not exempt building it | HIGH (non-negotiable) | Aryan |
| **CF-C5-RESIDENCY-1** | India-resident inference for PII-bearing calls + Decision-Log/Memory ap-south-1; gateway startup-gate asserts residency policy, refuse-to-route on mismatch. **ARMED tripwire:** no India-resident eval-passing frontier model → `/escalate` (DPDP §16 vs model-quality) | HIGH | Aryan + Maya |
| **CF-C5-RECOMMEND-ONLY-1** | recommendation-only-until-graduated; no MCP write tool auto-fires; graduation tracker; any outbound-channel tool that could FIRE (DLT/NCPR/9am-9pm/WhatsApp-template) is OUT of graduated scope this child, flagged @2 | HIGH | Aryan + Maya |
| (advisory, NOT a gate) | **CF-C5-PROMPT-CACHE (down-scoped from cost C7)** — Aryan MAY `cache_control` the static system-prompt prefix if cheap; not a BOUNCE trigger | INFO | Aryan (optional) |
| (inherited) | CF-BN-NOLEGACY-1 (direct `@anthropic-ai/sdk` ELIMINATED — gateway only; legacy AI path retired at Child-7, never edited); CF-RES-1; Child-4 query-gateway/single-writer read discipline (transitive) | — | all |

---

## What Stage 2 needs from Aryan + Maya (the binding open questions, updated)

**Aryan owns:** gateway integration (routing/budgets/two-cache-strategy/Layer-3 cap/telemetry/residency startup-gate) + the executable `@paradigm` decorator (FIRST deliverable, CF-C5-PARADIGM-IMPL-1) + agent base-class + `@mcp_tool` static-scope decorator (INJECTION-4) + the Iron-Law executor contract (INJECTION-2, magnitude server-side) + the graduation gateway-middleware (INJECTION-5) + Decision-Log write middleware + facade C3 read-path + CACHE-PURGE placement + chat context-pruning at gateway (CHAT-CONTEXT-PRUNE-1).

**Maya owns:** the agent/context-builder definitions (M-A1-3 made concrete) + per-context_builder token ceilings (PINCODE-TOKEN-CAP-1) + the eval harness (golden-set + faithfulness/groundedness with the canonical-integer normalization + the format-normalization PASS case) + Memory-Layer pgvector queries (k≥5) + the injection preprocessor + spotlighting on ALL operator strings (INJECTION-7) + the typed recommendation struct (INJECTION-6) + the Morning-Brief synthesis prompt (CM2-first, Pattern B, fenced prior-agent output).

**Integration seam (the two must agree at Stage-2 open):** (1) the **agent ↔ gateway contract** (the `@paradigm`-decorated call + the structured-context/typed-output the gateway returns); (2) the **faithfulness-validator placement** (gateway middleware vs agent path); (3) the **executor magnitude-source contract** (where the server-side authoritative record is read at execution).

**Stage-2 must-decide list:**
1. 5a collapse-vs-split + which one agent is the 5a vertical (recommend `pnl` or `analytics` page-insight — explicitly NOT chat).
2. Structural faithfulness mechanism (typed-slot/citation binding vs post-gen numeric re-extract+set-compare) + canonical-integer normalization + validator placement.
3. Least-privilege MCP tool-scope model (static `@mcp_tool(scope=[...])`) + server-side cap representation (so free text can never set magnitude) + the Iron-Law executor signature + per-day aggregate reallocation cap.
4. Where the graduation/recommendation-only check fires (must be gateway middleware, not orchestrator).
5. Gateway model roster + per-tier eval bars (small_llm: Nova Micro / Gemini Flash-Lite / Haiku; frontier: Sonnet 4.6 default) + **per-model India-resident-inference availability** (feeds CF-C5-RESIDENCY-1's armed tripwire — if none, `/escalate`).
6. Two-cache strategy (`filtersHash` deterministic vs gateway semantic) + 07:15 pre-warm + hit-rate parameter.
7. Morning-Brief Pattern B shape (Tier-A bundles → ONE synthesis; prior-agent output fenced `trusted=false`).
8. Confirm `pylibs/brain_cost_router/` decorator must be BUILT in 5a (cost C1 confirmed it is a 4-line stub — it does not exist).

---

## Decision

**ADVANCE → Stage 2 (architect Aryan; Maya co-owns).** Both personas passed; 13 of 14 concerns accepted (1 down-scoped to advisory, 0 rejected outright); 7 NEW constraints folded with owners; the Morning-Brief seam de-duped (cost C4 + injection INJ-3 → one CF); the structural-enforcement discipline bound by VETO across 5 gates; escalation NONE-fired (injection "Stage-2-blocking" flags clarified as architecture-binding, not Founder escalations); the India-resident-inference tripwire ARMED for Stage 2; Maya co-own + MIXED paradigm + HOLD-AT-READ-FLIP + recommendation-only all confirmed. **NO commit. Intake only.**

**Next:** orchestrator spawns Stage 2 — Aryan (architect) + Maya (intelligence, co-owner) — to produce `06-architecture-plan.md` + `07-handoff-to-developer.md` against the 20 CF-C5-* constraints.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T08:15:00Z",
  "actor": "cto-advisor",
  "role": "Rohan",
  "type": "stage1-synthesis",
  "req_id": "feat-ai-engine-intelligence",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "epic_child_id": "child-5-ai-engine",
  "stage": 1,
  "decision": "ADVANCE",
  "personas_synthesized": ["ai-cost-realist:sonnet", "prompt-injection-action-injection-realist:sonnet"],
  "persona_quality_gate": "BOTH PASS (7 concerns each, 1 CRITICAL each, all file:line-grounded; converged on chat=top-risk + Morning-Brief=dangerous-seam)",
  "concerns_accepted": 13,
  "concerns_downscoped_to_advisory": 1,
  "concerns_rejected": 0,
  "new_constraints": ["CF-C5-PARADIGM-IMPL-1", "CF-C5-PINCODE-TOKEN-CAP-1", "CF-C5-FAITHFULNESS-COST-1", "CF-C5-MORNING-BRIEF-PATTERN-B-1", "CF-C5-CACHE-STRATEGY-1", "CF-C5-CHAT-CONTEXT-PRUNE-1", "CF-C5-INJECTION-EXECUTOR-2", "CF-C5-INJECTION-SCOPE-4", "CF-C5-INJECTION-GRADUATION-5", "CF-C5-INJECTION-TYPED-REC-6", "CF-C5-INJECTION-SPOTLIGHT-7"],
  "de_dupe": "cost C4 (N-agent fan-out cost trap) + injection INJ-3 (prior-LLM-output trusted) -> CF-C5-MORNING-BRIEF-PATTERN-B-1 (one seam)",
  "constraints_intake_to_stage2": "13 -> 20 (+ 1 advisory)",
  "structural_enforcement_bound_by_veto": ["@paradigm decorator", "faithfulness validator", "Iron-Law executor contract", "graduation middleware", "tool-scope dispatch"],
  "verify_the_verifier_occurrence": 5,
  "escalation": "none-fired (injection 'Stage-2-blocking' flags = architecture-binding inputs for Aryan/Maya, not Founder escalations); India-resident-inference tripwire ARMED for Stage 2",
  "maya_co_owns_stage2": true,
  "paradigm": "mixed (confirmed binding)",
  "named_hold_state": "HOLD-AT-READ-FLIP",
  "committed": false,
  "rationale": "Both personas earned spend; chat+Morning-Brief convergence drives the 5a-not-chat slice choice and the de-duped fan-out constraint; 5 gates bound as real-code-with-killed-mutants per the verify-the-verifier lineage; ADVANCE to Stage 2 Aryan+Maya."
}
```

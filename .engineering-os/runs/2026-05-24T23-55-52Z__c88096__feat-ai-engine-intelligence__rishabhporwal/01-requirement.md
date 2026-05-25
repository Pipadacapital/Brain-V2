# Requirement: AI engine — intelligence-service — Brain-native (Child 5)

> Drafted from the binding Child-0 architecture (Child-5 row + AI-surface→target mapping M-A1-3 + the Tier-A/B 80/20 cost reduction + LLM gateway + Decision Log + cache-invalidation gate + the only hard sequential edge C3). Rohan/Founder edit at Stage 1.

| Field | Value |
|-------|-------|
| **req_id** | `feat-ai-engine-intelligence` |
| **Title** | AI engine — intelligence-service — Brain-native (Child 5) |
| **parent_epic** | `chore-migrate-legacy-to-brain` |
| **epic_child_id** | `child-5-ai-engine` |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-24T23:55:00Z |
| **Tier impact** | all (the Morning Brief + AI recommendations are the headline product surface) |
| **Region impact** | in (India-resident inference for PII via LLM gateway; ap-south-1) |

---

## Lane *(set by Rohan at Stage 1)*

| Field | Value |
|-------|-------|
| **feature_class** | *(set by Rohan)* — expected **high-stakes** |
| **trigger_surfaces_touched (first-pass)** | `connectors`/AI-surface, `pii` (commerce text into LLM context — prompt-injection → action-injection), `multi-tenancy`, `india-compliance` (residency of inference + Decision Log), `schema-proto` (Decision Log + MCP tool contracts), `money` (AI inputs are MU metrics; LLMs NEVER produce a number) |
| **paradigm (first-pass)** | MIXED — `sql`/`ml` for signals (anomaly/spike/trend ~80% Tier-A) + `small_llm`/`frontier_llm` for narration (~20% Tier-B). THE child where @paradigm cost-routing finally binds (ai-cost-realist persona). |
| **maya_co_owns** | YES (intelligence-service is her lane; she authored M-A1-3 AI-surface mapping) |

---

## Raw text (from Founder)

> Complete the application migration as per Brain's Architecture — runnable application with UI. (Standing directive: complete all epic children end-to-end; Founder checks at the end.)

---

## Problem statement

Child 5 of the strangler-fig migration. The legacy app calls Opus/Sonnet (direct `@anthropic-ai/sdk`) + Ollama for the ENTIRE AI surface (13 page adapters + tools), an over-use that inverts Brain's %-of-GMV unit economics. Brain's target: ~85% SQL / 12% ML / 2.5% small-LLM / 0.5% frontier — LLMs NEVER produce a number; deterministic signals (anomaly/spike/trend) are SQL/ML; only genuine narration is LLM, routed through the model-agnostic **LiteLLM gateway** with per-workspace budgets, semantic cache, eval-gated model selection, India-resident inference for PII.

This child builds **intelligence-service**: the product agents (AICMO/AICOO/AICFO + AI CX recommenders), the daily-tick fan-out → **Sonnet Morning Brief synthesis (07:15 IST)**, the **Decision Log** writes (every recommendation + every MCP write tool), the **Memory Layer** queries (Brand Fingerprint via pgvector), prompt-injection defense, and the @paradigm cost-routing. Recommendation-only until graduated. It reads the Child-4 ClickHouse metrics as its inputs.

## Scope (from Child-0 architecture — Rohan to confirm/split at Stage 1)

**In scope:**
- **AI-surface→target mapping (M-A1-3) made concrete:** Tier-A (deterministic signals → SQL/ML, NO LLM call) vs Tier-B (genuine narration → Haiku standard pages / Sonnet chat+global). ~80% Tier-A.
- **LLM gateway** (LiteLLM, OpenAI-format) — @paradigm("small_llm"|"frontier_llm") routing, fallback/retry, semantic cache, per-workspace virtual-key budgets, cost tracking, OTel; India-resident inference for PII. Direct `@anthropic-ai/sdk` ELIMINATED.
- **Product agents** (base class + @paradigm + @mcp_tool decorators), the daily tick (06:55→07:15 fan-out → Sonnet synthesis), graduation tracker, recommendation-only-until-graduated.
- **Decision Log** writes (analytics-service) on every recommendation + every MCP write tool (middleware); the value-claim proof base.
- **Memory Layer** queries (Brand Fingerprint 16-dim pgvector; Condition-Outcome pairs; cross-brand benchmarks k≥5).
- **Prompt-injection defense** (untrusted commerce text → action-injection): input isolation/spotlighting, output-schema validation before any tool runs, least-privilege tool scopes, caps server-side.
- **LLM evals** (golden-set + faithfulness/groundedness — the 07:15 synthesis must NEVER contradict the deterministic numbers); the three-point CI release gate.
- **filtersHash cache invalidation** (the C3/C4→C5 named cutover step) so no stale legacy narration survives.

**Out of scope (deferred):**
- Frontend rendering of the Morning Brief / AI Chat (Child 6).
- Legacy AI path decommission (Child 7).
- Live serving flip (HOLD — recommendation-only + held cutover; legacy AI stays authoritative until parity + cache purge).

## Dependencies
- **HARD sequential edge (architecture C3, line 509):** Child 5's LIVE serving needs Child-4 ClickHouse authoritative. Child 4 is at readiness (HOLD-AT-READ-FLIP). **For the BUILD (Shape-A), Child 5 reads the Child-4 registry/MV contract** (code present); the live flip stays HELD — Rohan to rule on build-vs-live dependency (mirror prior children).
- Child 1 (gate SATISFIABLE), Child 2 (money — AI inputs are MU), Child 4 (metric registry/MVs — committed-on-branch). LiteLLM gateway + pgvector + Claude API available.

## Constraints carried forward (Rohan to bind)
- `CF-BN-NOLEGACY-1`, `CF-RES-1` (inference + Decision-Log residency ap-south-1), LLMs-never-produce-a-number (faithfulness gate), @paradigm cost-routing (Q1-Q4 audit; SQL≫ML≫Haiku≫Sonnet 1:100:1000:10000), prompt-injection defense, Decision-Log-on-every-write-tool, eval-gate-before-ship, Memory-Layer k≥5.

## Notes for Stage 1 (Rohan)
- Shape boundary (mirror prior children): build agents + gateway + Decision Log + evals + injection defense Brain-native; the live serving flip + cache purge are HELD (named HOLD state). Recommendation-only until graduated.
- This is THE child where the cost-routing paradigm binds — `ai-cost-realist` persona is the obvious candidate; also a prompt-injection/AI-safety persona (untrusted commerce text → MCP action-injection).
- Maya co-owns by default (intelligence-service is her lane).

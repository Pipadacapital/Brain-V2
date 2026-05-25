# Slice 9 — CTO Advisor Stage-1 review (feat-ai-insight-narration)

| Field | Value |
|-------|-------|
| **req_id** | `feat-ai-insight-narration` (slice 9/9 of `epic-phase2-feature-parity`) |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-25T17:30:00Z |
| **Decision** | **ADVANCE** — narrow, grounded, cost-gated; this is the LAST slice |
| **Paradigm** | `small_llm` (Haiku) for narration; `sql` for signals. NEVER frontier per page. |

## Lane decision
- **feature_class: high-stakes** (inherited epic lane; AND trigger surfaces: MCP/agent tool surface, outbound-LLM call, PII-adjacent commerce text into LLM context, decision-log write, multi-tenancy). Conservative tie-break moot — clearly high-stakes.
- **trigger_surfaces_touched:** `mcp-tools` (agent tool scope), `llm-call`, `pii` (untrusted commerce text), `decision-log`, `multi-tenancy`.
- Stages that run: full high-stakes pipeline (S1 Rohan → S2 Aryan → S3 Maya+Vikram+Ananya → S4 Shreya → S5 Tanvi faithfulness VETO → S6 Rohan), gates under standing delegation.

## Standing lesson applied (verify legacy at Stage 1, not the slice table)
Read the ACTUAL legacy AI surface, not the prose:
- **`module/ai-engine`** (page insights): a FULL implementation — context-adapters×13, prompts/page, pipeline, providers with **hardcoded Opus/Sonnet via direct SDK + an Ollama path**. This is the paradigm-breaking anti-pattern Child-0 flagged. **Do NOT port it.**
- **`lib/insights/insight-builder.ts`**: the simpler path — builds a metrics text, calls a small model (Ollama), parses JSON. Closer to small_llm, BUT it lets the LLM **invent** insight_type/title/reason/recommendation AND a confidence number. That is exactly what slice 9 must NOT replicate.
- **`lib/insights/anomalies.ts`**: PURE rule-based statistical signals (spike 2×, drop 0.5×, roas_drop threshold). This is the correct grounded-signal layer.
- **CLAUDE.md note** ("legacy `module/ai` is dead"): confirmed — `module/ai` is the *chat* path (dead). The page-insight `module/ai-engine` is live-but-paradigm-wrong.

**Ruling:** build the Brain-native MINIMAL grounded narrator. It is ALREADY ~90% built by Child-5 (`feat-ai-engine-intelligence`): `PnlInsightAgent` + gateway + faithfulness validator + injection preprocessor + golden-set eval + 5 VETO gates. Slice 9 is NOT a rebuild — it is **exposing that vertical through the serving stack so it renders grounded narration on a page**, which is the only gap to the deliverable bar.

## Scope (strict — Single-Primitive Rule; no over-engineering)
REUSE wholesale (zero rebuild): the Child-5 intelligence-service vertical (agent base, gateway client, graduation middleware, faithfulness validator/extraction, injection preprocessor, golden-set eval, 5 gates) + slices 1-8 metric surface (the canonical Sugandh-Lok seed).

NET-NEW (the thin serving seam):
1. `DataPlanePort.getPageInsights()` — additive method on the SAME port (no second code path). StubDataPlane impl produces grounded narration for the /pnl page from the existing canonical seed signals.
2. `insights.forPage` tRPC procedure — workspaceProc, requireRole(ANALYST), **READ `.query` ONLY** (no `.mutation`, no send/dispatch/execute). Mirrors the lifecycle READ-only structural discipline (slice 8).
3. BFF faithfulness + injection gate (`assertInsightFaithfulness`, `assertNoToolReach`) — mirrors the registry-traceability gate pattern.
4. Web `InsightStrip` component rendered on `/pnl`.
5. Tests: positive + negative (faithfulness killed-mutant, injection killed-mutant, no-write-reach structural, RLS fail-closed, role-gate).

LOCAL-NO-KEY decision: no live Claude API key locally → wire the narration behind the LLM gateway contract with a **deterministic grounded stub** that constructs prose ONLY from the canonical signal integers (so faithfulness PASSES on real signal values, and the killed-mutant test — a hallucinated number — goes RED). The production path flips to the real Haiku gateway by config (same seam as slices 1-8). Stated explicitly so it is not mistaken for a live call.

## The 4 NON-NEGOTIABLE gates — how each is met
1. **cost-routing-paradigms:** `@paradigm small_llm` (Haiku), narration only, NOT Sonnet, NOT per-pageview (filtersHash 6h cache in the gateway). Q1-Q4 cost audit at S6.
2. **llm-evals / "LLMs NEVER invent numbers":** every narration number set-compared against the deterministic registry signal set (Child-5 `validate_faithfulness`); golden-set eval gate must PASS; the BFF re-asserts faithfulness before render (defense in depth).
3. **prompt-injection-defense:** untrusted commerce text (brand name, goal labels, campaign/product titles) fenced `<data trusted="false">` + sentinel-escaped + fail-closed on injection pattern; output reaches NO write/MCP tool (agent scope READ-only, Gate 5); output-schema validated before render.
4. **decision-log:** narration is READ-ONLY (recommendation-only, not graduated); the gateway writes one Decision-Log row per synthesis (audit), no execute path.

## Persona-count decision
**Count chosen: 0.** Rationale: per the complexity classifier, this slice is "a clear repeat of a prior pattern in the lessons registry" — the dominant risk dimension (cost/paradigm + injection) was already stress-tested by TWO `:sonnet` personas at Child-5 (`ai-cost-realist` + `prompt-injection-action-injection-realist`), whose 14 concerns are codified into the very vertical we are reusing. Slice 9 adds only a thin serving seam over that proven vertical; spawning a persona would re-litigate settled work. The faithfulness/cost/injection gates are enforced as real code at S4 (Shreya) and S5 (Tanvi faithfulness VETO), not by an intake persona. Within the high-stakes cap (≤2); 0 is the floor and is justified by registry-pattern reuse.

## India context
No outbound channel (in-app narration only) → no DLT/NCPR/9am-9pm trigger. PII handling: untrusted commerce text fenced; no raw PII in logs (content-hash only). Residency: Child-5 `assert_india_residency` covers the gateway. CM2-first framing (not ROAS) preserved by the existing PNL_SYSTEM_PROMPT.

## Decision: ADVANCE → Stage 2 (Aryan). Next: full pipeline, gates under standing delegation.

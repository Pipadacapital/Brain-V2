# Handoff to Builders — feat-ai-engine-intelligence (Child 5)

> High-stakes lane → separate handoff (Lever 5). Builders: **@vikram (backend-developer)** for the plumbing (decorator, gateway, dispatch, executor, schema, Decision-Log) + **@maya (intelligence-engineer, co-owner)** for the agent vertical, signals, eval harness, injection defense, Memory. + **@jatin (platform-devops)** for the deploy pipeline. Spawn Vikram + Maya in PARALLEL (Maya's Track M depends on V1→V2 contracts; she starts on signals/eval/injection/Memory immediately and integrates the agent at the V2 seam).

## The one thing that matters

Build the AI engine + the **5 VETO gates as REAL code with killed mutants** end-to-end on ONE non-chat agent (`pnl` page-insight), **recommendation-only**, with the **live serving flip + CACHE-PURGE firing HELD** (`HOLD-AT-SERVE`). A vacuous version of ANY of the 5 gates = automatic Stage-6 BOUNCE (Rohan VETO, verify-the-verifier lineage #5). Each gate must have its **killed-mutant test AND its inverse mutant** (prove the gate is load-bearing) — these are specified per-gate in `06-architecture-plan.md` §A0.2-A0.6. Do not ship a gate without both.

## Acceptance contract (every item REQUIRED at handoff — shift-left, do NOT leave for Shreya/Tanvi to bounce)

| # | Item | Gate / CF | Owner | Done = |
|---|------|-----------|-------|--------|
| 1 | `@paradigm` decorator executable: `sql`/`ml` reaching the gateway dispatch boundary raises `ParadigmViolation`; emits `paradigm_distribution` | Gate 1 / PARADIGM-IMPL-1 | Vikram | killed mutant RED + inverse mutant caught; built FIRST |
| 2 | Faithfulness validator: re-extract + canonical-integer normalize + set-compare; bounded 1-retry; gateway-side middleware | Gate 2 / FAITHFULNESS-1+COST-1 | Maya (rules) + Vikram (placement) | hallucinated-number → RED; **₹1.2L vs 120000 → PASS**; retry-rate emitted |
| 3 | Iron-Law executor: `WriteToolCall` has NO magnitude field; magnitude server-side from `ai.workspace_action_cap`; per-call + per-day aggregate cap | Gate 3 / INJECTION-EXECUTOR-2 | Vikram | injected `amount_mu` DROPPED → executed magnitude = server value (RED if honored) |
| 4 | Graduation middleware at gateway DISPATCH (server-side, stateless w.r.t. LLM; survives deceived orchestrator) | Gate 4 / INJECTION-GRADUATION-5 | Vikram | un-graduated write-call (orchestrator bypassed) → DROPPED + Decision-Log rec row |
| 5 | Tool-scope dispatch: static per-agent allow-list at class definition, enforced at gateway (NOT full-list-per-call) | Gate 5 / INJECTION-SCOPE-4 | Vikram (dispatch) + Maya (declaration) | out-of-scope tool-call → DROPPED + Decision-Log row |
| 6 | Decision-Log row on EVERY recommendation + every (would-be) write tool; typed recommendation struct (closed action enum); RLS; ap-south-1 | DECISION-LOG-1 + TYPED-REC-6 | Vikram | append-only; 2-workspace RLS isolation test |
| 7 | `pnl` 5a agent: context (Child-4 `query_metrics`) → deterministic signals → Haiku → faithfulness → typed InsightItem[]; **READ-ONLY scope** | SCOPE-SPLIT-1 | Maya | full vertical green on mocked gateway; no write-tool reachable |
| 8 | Context token-ceiling assertion `<1,800t` at construction (pnl is the 5a instance of the generalized cap) | PINCODE-TOKEN-CAP-1 | Maya | construction-time assert |
| 9 | Memory query primitive: Brand Fingerprint pgvector, k≥5, read-only, workspace-scoped | MEMORY-1 | Maya | k≥5 query test under RLS |
| 10 | Two-cache strategy: `filtersHash` deterministic cache key PRESERVED; semantic-cache config stub (chat=5b) | CACHE-STRATEGY-1 | Vikram | filtersHash unchanged from legacy formula |
| 11 | CACHE-PURGE-C4C5 built + ARMED, NOT fired; facade serve-gate blocks until post-purge count = 0; audit Decision-Log row | CACHE-PURGE-1 | Vikram | purge primitive + serve-gate present, NOT executed |
| 12 | India-resident routing assertion for PII-bearing calls; ap-south-1 stores; refuse-to-route on mismatch | RESIDENCY-1 | Vikram | startup assert; tripwire HELD (Haiku-only 5a surface) |
| 13 | Layer-3 per-workspace monthly LLM cap LIVE in gateway | LAYER3-CAP-1 | Vikram | cap meter + breach alarm |
| 14 | `paradigm_distribution` telemetry per workspace/day (cost-mix observable) | COST-AUDIT-1 | Vikram | counter emitted per call |
| 15 | Injection: spotlighting on ALL operator-entered strings; prior-LLM-output fenced `trusted=false` (5b synthesis seam, designed now) | SPOTLIGHT-7 + PATTERN-B-1 | Maya | instruction region = static templates + typed values only |
| 16 | Deploy pipeline: intelligence-service Dockerfile + `turbo --affected` + ECR + ArgoCD app + canary + auto-rollback; ap-south-1; zero-real-LLM CI | TECH/00 §3.4 #11 | Jatin | per-service pipeline green |

## Guardrails (HARD)

- **No git commit** (feature branch only; Founder merges). Build-base = current branch `feature/feat-tenancy-auth-rls-hardening`; branch a Child-5 feature branch from it.
- **No live serving flip, no live LLM spend in build.** Mocked gateway + golden-set eval fixtures in tests/CI. ONE manual `@pytest.mark.smoke` real Haiku call (excluded from CI) pre-Stage-8 only.
- **No real customer PII in tests.** Use synthetic fixtures.
- **Legacy reference-only.** Never edit/commit into `legacy project/`; port logic Brain-native (direct `@anthropic-ai/sdk` ELIMINATED — gateway only, CF-BN-NOLEGACY-1).
- **LLMs NEVER produce a number** — every number narrated is a re-extracted match to a deterministic signal (Gate 2).
- **No `@paradigm: small_llm/frontier_llm` on any context_builder / signal / comparator / intent-classifier** = BOUNCE (Gate 1 catches it at runtime).
- **Versions:** resolve + pin latest-stable; NEVER invent a version number.

## The 3 co-owner seams (already LOCKED in §Handoff seam of the plan)

1. Agent ↔ gateway: agent calls `GatewayClient.complete(paradigm, signals, system_template, untrusted_blocks)`; never LiteLLM directly.
2. Faithfulness placement: gateway-side middleware; Maya's `extraction.py` (canonical-normalize rules) feeds `validate_faithfulness(narration, signals)`.
3. Executor magnitude: `WriteToolCall` magnitude-less; `execute_write_tool` reads `ai.workspace_action_cap` server-side.

## Build order

`V1 (decorator)` → `V2 (gateway/dispatch/executor/faithfulness-placement/Decision-Log)` + `V3 (schema/RLS/purge)` → `Track M (agent/signals/eval/injection/Memory)` integrates at the V2 seam → `Track J (deploy)`. Maya starts signals/eval/injection/Memory + `extraction.py` immediately (no V1/V2 dependency on those); she integrates the agent once the `GatewayClient` contract lands.

## What stays HELD for Stage 8 (do NOT build)

- Live serving flip (Brain narration served to a workspace) — gated on Child-4 authoritative-for-W + CACHE-PURGE fired + per-agent graduation.
- CACHE-PURGE-C4C5 FIRING (the primitive is built + armed; firing is the Stage-8 cutover act).
- 5b roster: chat, Morning-Brief 07:15 fan-out, 12 remaining page agents, AICMO/AICOO/AICFO, AI-CX — config-shaped instances of the proven 5a primitives, a later child/slice.
- The India-resident tripwire re-check for the 5b frontier model.

## Next

RETURN to orchestrator → Stage 3, spawn **backend-developer (Vikram) + intelligence-engineer (Maya) in parallel** (+ platform-devops Jatin for Track J).

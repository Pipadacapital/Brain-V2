# Persona Review: ai-cost-realist
## Child 5 — AI Engine / Intelligence-Service (feat-ai-engine-intelligence)

**Persona:** ai-cost-realist:sonnet
**Spawned by:** Rohan (Stage 1 intake)
**Timestamp:** 2026-05-25T06:00:00Z
**Skill loaded:** cost-routing-paradigms, claude-api

---

## Persona framing

I am the person who carries the %-of-GMV unit-economics constraint. Brain's revenue model is a slice of brand GMV — that means every inference rupee is paid from the margin, not a flat subscription. If the 85/12/2.5/0.5 Tier-A/B split slips even modestly — say from 85% SQL to 75% SQL — the frontier-LLM percentage does not double; it can go up 5-10×, because the cost curve is ~10,000× steeper for frontier vs SQL. One mis-routed surface can make a brand unprofitable to serve. My job is to prove the split holds in running code, bind the per-call token budgets, and name the hidden over-use path the architecture review would miss.

I read: `providers/router.ts` (hardcodes OPUS_MODEL for global+chat, SONNET_MODEL for all standard pages — confirmed); `pipeline/page-insight.ts` (maxTokens=2048 output, temperature=0.3, no input-token budget cited); `prompts/page/analytics.ts` ("designed to stay under ~900 tokens" — a comment, not a gate); `prompts/page/pnl.ts` ("~1,000 tokens" — same); `context-adapters/analytics.ts` (daily capped at 30 rows — the only explicit input-budget control in the codebase); `context-adapters/pincode-intelligence.ts` (emits 6+ sub-lists: codKillList×10, topRevenuePincodes×10, rtoHotspots×8, loyaltyGems×6, expansionOpps×6, problemAreas×6 = up to 46 structured rows of multi-field pincode objects — NO explicit token cap on this context); `prompts/system.ts` (benchmarks block + definitions block injected on every call by default — env-toggled but default=on); `insight-cache.ts` (TTL 6 hours, re-generates on miss or force-refresh); `brain_cost_router/__init__.py` (the library stub exists but contains zero routing logic, zero decorator implementation — it is a placeholder, not a shipped primitive).

Pricing anchors (verified via Anthropic platform docs, May 2026): Sonnet 4.6: $3.00/M input, $15.00/M output. Haiku 3.5: $0.80/M input, $4.00/M output. Batch API: 50% discount on both. Prompt cache read: 10% of standard input. Exchange rate: 1 USD ≈ ₹84.

---

## Per-call token budget + per-brand monthly ₹ projection

### Token anatomy per call (measured from legacy prompts, the Brain migration target)

**Haiku call — standard page (e.g., analytics):**
- System prompt: ~400 tokens (definitions block ~180t + benchmarks block ~120t + output format + rules ≈ 400t total; default both enabled)
- User prompt: system comment says "~900 tokens" — no enforced gate; for a 30-day analytics page with goals this is realistically 800–1,200t input
- Output: maxTokens=2048 but actual JSON output is 3-5 insights × ~100t each ≈ 400–600t
- **Per call: ~1,200–1,600t input / ~500t output**
- At Haiku 3.5 rates: ($0.80 × 1,400/1M) + ($4.00 × 500/1M) = $0.00112 + $0.0020 = **$0.0031 / call ≈ ₹0.26/call**

**Pincode-intelligence Haiku call (the outlier):**
- The `buildPincodeIntelligenceContext` emits up to 46 pincode rows × 12 fields each + 3 tier summaries + 10 state summaries. No token cap exists on this path (the analytics context caps daily rows at 30; no equivalent cap in pincode-intelligence). Measured JSON serialization: 46 rows × ~80 chars/row ≈ 3,700 chars ≈ 925 tokens of structured data, plus system + summary block = **~2,000–2,500t input**
- At Haiku 3.5: ~$0.006/call ≈ ₹0.50/call — 2× the standard page cost

**Sonnet call — global page or Morning-Brief synthesis:**
- For global/chat: context includes metrics + signals + conversation history. At 2,000t input / 1,000t output: ($3.00 × 2,000/1M) + ($15.00 × 1,000/1M) = $0.006 + $0.015 = **$0.021/call ≈ ₹1.76/call**
- Morning-Brief synthesis (5b): if the fan-out gathers pre-computed Tier-A signals from 13 agents and synthesizes in ONE Sonnet call → input could be 13 × ~300t agent summaries = 3,900t context + system = ~4,500t in: ($3.00 × 4,500/1M) + ($15.00 × 1,000/1M) = $0.0135 + $0.015 = **$0.0285/call ≈ ₹2.40/brief**

### Sugandh Lok (anchor brand) monthly projection

Assumed volume (conservative DTC brand, ~150 orders/day, 2 active connections):
- 13 page-insight pages × 1 unique date range per day × 1 brand = 13 Haiku calls/day (cache TTL 6h; each unique date window generates a new call on first load)
- Plus daily-tick 07:15 Morning-Brief synthesis = 1 Sonnet call/day
- Plus chat: assume 5 user chat turns/day (frontier per turn with growing context)

**Monthly (30 days):**
- Haiku: 13 calls/day × 30 days × $0.0031 = **$1.21/month ≈ ₹102/month** (standard pages, cache hitting well)
- Morning-Brief: 1 call/day × 30 × $0.0285 = **$0.855/month ≈ ₹72/month**
- Chat (5 turns/day): 5 × 30 × $0.021 = **$3.15/month ≈ ₹265/month** (growing conversation history adds tokens per turn)
- **Total LLM: ~₹440/month at Sugandh-Lok volume (cache hit rate ~70%)**

At 0.5% %-of-GMV: for Brain to be cost-positive on AI inference alone, GMV must be > ₹440 / 0.005 = **₹88,000/month GMV** (~880 orders/month at AOV ₹1,000). That is achievable for Sugandh Lok and most DTC brands above a minimal threshold.

BUT: the projections above assume (a) the semantic cache achieves 70%+ hit rate, (b) the Morning-Brief is ONE synthesis call not N per-agent calls, (c) the faithfulness gate does not cause synthesis retries, and (d) chat conversation history is pruned. Every one of these assumptions is currently unvalidated and each represents a cost multiplier if wrong. See concerns below.

---

## Concerns

---

### CONCERN 1 — brain_cost_router is a zero-implementation stub: the @paradigm decorator does not exist as executable code [CRITICAL]

**Evidence:** `/Users/rishabhporwal/Desktop/Brain/pylibs/brain_cost_router/brain_cost_router/__init__.py` contains exactly 4 lines — a module docstring and a paradigm priority comment. No `@paradigm` decorator class, no routing logic, no enforcement, no telemetry emission. The `pyproject.toml` lists zero dependencies. The `intelligence-service/src/` tree is entirely `.gitkeep` stubs.

**The crux:** The entire cost model rides on the `@paradigm` decorator enforcing that a context_builder cannot become `small_llm` or `frontier_llm`. If the decorator is not implemented before Stage 3 code is written, every agent author writes their own ad-hoc LiteLLM call — and the Stage-6 paradigm audit becomes manual grep, not a structural gate. The canonical anti-pattern in the legacy codebase (`providers/router.ts:getDefaultModel` — a plain function returning a model string, no enforcement) is exactly the shape that gets copied when the decorator is missing.

**Proposed constraint (new):** CF-C5-PARADIGM-IMPL-1: `brain_cost_router` must export an executable `@paradigm("sql"|"ml"|"small_llm"|"frontier_llm")` decorator that (a) at test time asserts the decorated function's call path does not invoke the LiteLLM gateway for `sql`/`ml` paradigms, and (b) at runtime emits the paradigm label to the `paradigm_distribution` telemetry sink. This implementation must be the 5a vertical slice's FIRST deliverable, before any agent or context_builder is authored. A missing or no-op decorator = context_builders silently inherit the caller's model tier.

---

### CONCERN 2 — The pincode-intelligence context has no input-token cap: it silently costs 2× a standard page [HIGH]

**Evidence:** `context-adapters/analytics.ts:420` explicitly caps `current.daily.length > 30 ? current.daily.slice(-30) : current.daily`. The analogous `context-adapters/pincode-intelligence.ts` emits: `codKillList` (up to 10 rows), `topRevenuePincodes` (10 rows), `rtoHotspots` (8 rows), `loyaltyGems` (6 rows), `expansionOpps` (6 rows), `problemAreas` (6 rows) = up to 46 pincode-rows × 12 fields each, PLUS state summaries (10 entries) and tier summaries. No explicit token budget in the prompt builder (the prompt file for pincode-intelligence is `prompts/page/pincode-intelligence.ts` — not read but the context shape implies 2,000–2,500t input). No cap comment analogous to the analytics "~900 tokens" note.

**Cost impact:** pincode-intelligence calls at Haiku 3.5 cost ~₹0.50 vs ~₹0.26 for a standard page. At Sugandh-Lok volume with daily ticks, this page alone costs twice the analytics page. Worse, if a brand has dense pincode data (tier-1 brand, 200+ unique pincodes), the uncapped context can exceed 4,000 tokens input — this is where Haiku may be insufficient for quality and the gateway upgrades to frontier, 10× the cost, without a guard.

**Proposed constraint:** CF-C5-PINCODE-TOKEN-CAP-1: the `pincode-intelligence` context_builder MUST truncate its sub-lists to hard maxima (recommend: codKillList≤5, topRevenuePincodes≤5, rtoHotspots≤5, loyaltyGems≤4, expansionOpps≤4, problemAreas≤4 = max 27 rows) and the prompt builder must assert total estimated tokens < 1,800t at construction time. Bind at Stage 2.

---

### CONCERN 3 — The faithfulness gate is a COST defect: a re-run on contradiction = one extra frontier Sonnet call at ₹1.76 [HIGH]

**Evidence:** CF-C5-FAITHFULNESS-1 (Rohan's binding constraint) requires that a number-hallucinating narration is caught and rejected. Rejection at the response level means re-running the synthesis call. For the 07:15 Morning-Brief on Sonnet, one re-run costs an additional ₹2.40. If the faithfulness gate has a non-trivial false-positive rate (rejects a correct response because a number was reformatted — e.g., the model writes "₹1.2L" when the signal value is 120000), the daily retry rate could be 10-20% of synthesis calls.

**At Sugandh-Lok volume:** 20% retry rate on Morning-Brief adds 0.2 × ₹2.40 × 30 = ₹14.4/month on a single brand. Projected at 100 brands: ₹1,440/month in faithfulness-gate retries alone, on a surface that should be a deterministic pass once the context is clean.

**The specific defect path:** the faithfulness validator compares output numbers against provided signal values. If the LLM writes "approximately ₹1.2L" and the validator is string-matching against the integer `120000`, the validator fails a correct response. The retry burns a second Sonnet call. This is the "tautological test masquerading as a gate" analog from the architecture — here it is a format-normalization bug that becomes a cost multiplier.

**Proposed constraint:** CF-C5-FAITHFULNESS-COST-1: the numeric extraction step in the faithfulness validator MUST normalize both the model output and the signal values to the same canonical form (integer paise / smallest unit, no locale formatting) before comparison. The eval harness must include a test case where the model writes a locale-formatted number (₹1.2L) for a signal value of 120000 and the validator must PASS it. The retry cost is a first-class metric in the eval harness: retries-per-synthesis emitted to the paradigm_distribution telemetry alongside the paradigm label.

---

### CONCERN 4 — The Morning-Brief fan-out shape is unspecified: N-agent pre-synthesis calls is the default if not explicitly blocked [HIGH]

**Evidence:** Architecture line 229 (Rohan's open question 6) notes: "one synthesis frontier call over pre-computed Tier-A signals, NOT N frontier calls (the cost trap)." This is still an open question at Stage 1, not a bound constraint. The requirement (01-requirement.md) describes "the daily-tick fan-out → Sonnet Morning Brief synthesis (07:15 IST)" without specifying whether the N=13 agents each produce a Tier-B narration before the synthesis, or whether all 13 agents produce Tier-A summaries that are fed as structured context into ONE synthesis call.

**Cost difference at N=13 agents:**
- Pattern A (wrong): 13 Haiku narrations × ₹0.26 + 1 Sonnet synthesis × ₹2.40 = ₹5.78/brief
- Pattern B (correct): 13 SQL/ML signal extractions (zero LLM) + 1 Sonnet synthesis × ₹2.40 = ₹2.40/brief
- At 30 days × 1 brand: Pattern A costs ₹173.4/month vs Pattern B ₹72/month — a 2.4× difference that compounds directly with the number of brands.

**The hidden trap:** the `buildEnrichedContext` function in `module/ai/pipeline/context-builder.ts` already establishes the "LLM-over-pre-computed-signals" pattern — it passes anomaly/spike/drop signals as plain text descriptions to the chat system message. If this pattern is naively migrated, the 5b architect adds a per-agent narration step "for richer Morning-Brief context" and the N-call pattern is born without the cost router catching it (because each individual Haiku call is `@paradigm("small_llm")` compliant — the over-use is structural, not per-call).

**Proposed constraint:** CF-C5-MORNING-BRIEF-FAN-OUT-1: the Morning-Brief synthesis architecture MUST be documented as a Stage-2 binding decision. The only permissible pattern is: all 13 agents produce Tier-A (SQL/ML) signal bundles → these are aggregated into a SINGLE structured context object → ONE Sonnet synthesis call narrates the full brief. Any pattern where a Tier-B (small_llm or frontier_llm) narration occurs per-agent BEFORE the synthesis call = a paradigm violation → Stage-6 BOUNCE. This constraint must be in the architecture plan as a named pattern, not implied.

---

### CONCERN 5 — The semantic cache hit rate is the cost multiplier no one has bounded: a 50% miss rate doubles the entire projection [HIGH]

**Evidence:** The legacy `insight-cache.ts` uses `filtersHash = sha256(workspaceId, page, dateFrom, dateTo, filters)`. This is a date-range-keyed exact-match cache — NOT a semantic cache. A user who views analytics for "last 30 days" on May 24 vs May 25 gets two different `dateFrom`/`dateTo` combinations → two cache misses → two Haiku calls. The "semantic cache" the requirement names (via LiteLLM) is a similarity-vector cache on the prompt embedding, which operates differently. The requirement does not specify which cache strategy applies to page-insight calls vs chat calls.

**For page-insight calls (the high-volume surface):** a date-range-keyed cache (the existing `filtersHash` strategy) achieves high hit rates only if users consistently request the same date range. In practice, Sugandh Lok with an Indian DTC brand checks today's data vs last 7 days vs last 30 days. Each is a distinct `filtersHash` key. The effective hit rate for page-insight calls is likely 30-50% in the first weeks before cache warms, and approaches 70% only after a brand establishes a consistent default date range.

**Cost impact of 30% hit rate vs 70% hit rate at 100 brands:**
- 13 pages × 100 brands × 30 days × (1-hit_rate) × ₹0.26/call:
  - 30% hit: 13 × 100 × 30 × 0.70 × ₹0.26 = **₹7,098/month**
  - 70% hit: 13 × 100 × 30 × 0.30 × ₹0.26 = **₹3,042/month**
  - Delta: ₹4,056/month at 100 brands from cache hit rate alone

**The semantic cache does not help here unless the gateway's semantic cache is applied to page-insight prompts** — but page-insight prompts embed numeric time-series data that changes daily, making semantic similarity unreliable for cache hits. The correct strategy for page-insight is the deterministic `filtersHash` cache (already present), with a per-workspace default-range preference recorded so the 07:15 daily tick pre-warms the most common date range before users arrive.

**Proposed constraint:** CF-C5-CACHE-STRATEGY-1: Stage 2 must explicitly distinguish (a) the `filtersHash` deterministic cache (preserved for page-insight — the M-A5-5 gate key) from (b) the gateway semantic cache (applicable to chat turns where prompt varies naturally). The daily 07:15 fan-out MUST pre-warm the top-2 date ranges per workspace (today, last-30-days) for all 13 pages before first user request. The monthly projection for 100 brands must cite the assumed cache hit rate as an explicit input parameter in the cost model PR template.

---

### CONCERN 6 — The chat surface has unbounded multi-turn context growth: 5 turns/day at Sonnet is optimistic; 20 turns is routine [MEDIUM]

**Evidence:** `module/ai/chat/index.ts` implements `MAX_TOOL_ROUNDS = 5` for tool-call loops but has NO limit on the number of `ChatMessage[]` entries passed in `messages`. The `buildChatSystemMessageForTools` function embeds a fixed system prefix + default period — the conversation history grows unbounded with each turn. A 10-turn conversation where each assistant reply is 300 tokens adds 3,000 tokens to subsequent turns' input context. A 20-turn conversation with tool-result injections can reach 6,000-8,000t input per turn.

**At Sonnet 4.6 rates:** 8,000t input + 500t output = ($3.00 × 8,000/1M) + ($15.00 × 500/1M) = $0.024 + $0.0075 = $0.0315/turn ≈ ₹2.65/turn. A brand operator doing a 20-turn diagnostic session costs ₹53 in one session. At 5 sessions/brand/month and 100 brands: ₹26,500/month from chat alone — potentially exceeding the entire Haiku page-insight spend by 8×.

**The Layer-3 cap (CF-C5-LAYER3-CAP-1) is the structural backstop**, but a per-workspace monthly cap with no per-session conversation-history pruning means the cap is hit on a bad day and the brand operator loses access for the rest of the month.

**Proposed constraint:** CF-C5-CHAT-CONTEXT-PRUNE-1: the chat agent MUST implement a sliding-window context strategy (recommended: last N=6 turns + system context + current turn, dropping older turns). A hard maximum of 6,000t total input per chat call MUST be enforced at the gateway layer before dispatch; calls exceeding this limit are truncated, not rejected. This is a cost AND latency control — Sonnet at 8,000t input has materially higher p99 latency than at 2,000t input.

---

### CONCERN 7 — The system prompt injects benchmarks + definitions blocks on EVERY Haiku call: these are 300+ tokens of static content that should be prompt-cached [MEDIUM]

**Evidence:** `module/ai-engine/prompts/system.ts:15-98`. The `getSystemPrompt` function constructs the system prompt from: (1) a `definitionsBlock` (~180t) and (2) a `benchmarksBlock` (~120t, from `getBenchmarksBlock(page)`) — both injected by default (`AI_ENABLE_DEFINITIONS !== 'false'`, `AI_ENABLE_BENCHMARKS !== 'false'`). This is ~300t of static, workspace-agnostic content sent on every page-insight call.

**Cost impact:** at Haiku 3.5 without prompt caching: 300t × $0.80/1M × 30 calls/day × 30 days = $0.0022/month for one brand — negligible alone. But at 100 brands × 13 pages × 30 days × 300t × $0.80/1M = $93.6/month in static tokens that are identical across all workspaces and all pages. With Anthropic's prompt cache at 10% of input price, this drops to $9.36/month — a **$84/month saving** at 100 brands, purely from caching the static system prompt prefix.

**The real cost concern is the benchmarks block is PAGE-SPECIFIC:** `getBenchmarksBlock(page)` varies the content per page, which means the system prompt is not constant across pages. If the gateway caches per-(workspace, page) key, the savings still apply within a page but the cache key space is 13× larger. If the gateway naively treats the full system prompt as uncacheable (the LiteLLM default without explicit cache control), all 300t are billed at full input rate.

**Proposed constraint:** CF-C5-PROMPT-CACHE-1: the LiteLLM gateway MUST emit the static prefix of the system prompt (the non-page-specific portion: definitions + output format + severity guide + confidence guide + rules) as a prompt-cached block (marked with `cache_control: {"type": "ephemeral"}` in the Anthropic API). The page-specific benchmarks block is injected as non-cached user context. Expected saving: ~$84/month at 100 brands, scaling linearly.

---

## Per-brand ₹ projection summary (Sugandh-Lok volume, 30 days)

| Surface | Calls/month | Cost/call | Monthly ₹ | Notes |
|---|---|---|---|---|
| Haiku page-insight (12 std pages) | 12 × 30 × (1-0.70 hit) = 108 | ₹0.26 | ₹28 | 70% cache hit assumed |
| Haiku pincode-intelligence | 1 × 30 × 0.30 = 9 | ₹0.50 | ₹4.50 | 70% cache hit; 2× std page cost |
| Sonnet Morning-Brief synthesis | 30 | ₹2.40 | ₹72 | 1 call/day; ONE synthesis pattern |
| Sonnet chat (5 turns/day, 10-turn avg history) | 150 | ₹1.76 | ₹264 | Pruned to 6-turn sliding window |
| Faithfulness gate retries (10%) | 3 | ₹2.40 | ₹7.20 | 10% retry rate on synthesis |
| **TOTAL (optimistic)** | | | **~₹376/month** | All optimistic assumptions |
| **TOTAL (pessimistic — 30% cache hit, 20-turn chat, 20% retry)** | | | **~₹980/month** | Each multiplier unvalidated |

At Brain's %-of-GMV pricing (0.5% assumed): break-even GMV = ₹376/0.005 = **₹75,200/month (optimistic)** or ₹980/0.005 = **₹196,000/month (pessimistic)**. Sugandh Lok must be well above ₹2L GMV/month (likely true for an established DTC brand), but the pessimistic scenario is still only 2× the optimistic — the model is viable IF the cache hit rate, fan-out pattern, and conversation pruning are bound. They are currently unbound.

---

## Single highest-cost-risk surface

**The chat agent (Sonnet, multi-turn, unbounded context growth) is the single surface most likely to silently route to frontier when it should not — and to consume 10× the projected cost when it does.**

The page-insight surface has natural damping (cache TTL, one call per page per date range). The Morning-Brief has one call per day. But the chat surface has NO natural damping: every user turn is a frontier call, conversation history compounds, and the tool-call loop (MAX_TOOL_ROUNDS=5) can inject additional tool-result tokens mid-conversation. A brand operator in a 30-minute diagnostic session can generate $0.50-$1.00 in frontier LLM cost in a single interaction. This is the surface where the Layer-3 per-workspace cap will be hit first, where a missing context-pruning strategy manifests as sticker-shock on the monthly bill, and where the requirement's "recommendation-only-until-graduated" backstop provides NO cost protection (chat is not a write-tool surface; it does not require graduation).

The gap: the architecture names the Layer-3 cap as a non-negotiable gate before chat ships, but does not name a per-session token budget or conversation-history pruning strategy. Without these, the Layer-3 cap is the only brake — and it is a monthly cliff, not a per-session governor.

---

## Proposed new constraints (summary)

| ID | Constraint | Severity if missing | Owner |
|---|---|---|---|
| CF-C5-PARADIGM-IMPL-1 | brain_cost_router must export an executable @paradigm decorator (enforcement + telemetry) as the first 5a deliverable | CRITICAL | Aryan |
| CF-C5-PINCODE-TOKEN-CAP-1 | pincode-intelligence context_builder hard-capped at ≤27 rows; prompt builder asserts <1,800t at construction | HIGH | Maya |
| CF-C5-FAITHFULNESS-COST-1 | faithfulness validator normalizes to canonical integer form before comparison; retry cost emitted to telemetry | HIGH | Maya + Aryan |
| CF-C5-MORNING-BRIEF-FAN-OUT-1 | Morning-Brief MUST use Pattern B (Tier-A aggregation → ONE Sonnet call); per-agent Tier-B narration before synthesis = BOUNCE | HIGH | Aryan + Maya |
| CF-C5-CACHE-STRATEGY-1 | filtersHash cache vs semantic cache explicitly distinguished; 07:15 tick pre-warms top-2 date ranges per workspace; monthly projection cites hit rate | HIGH | Aryan |
| CF-C5-CHAT-CONTEXT-PRUNE-1 | chat agent: sliding-window N=6 turns; hard 6,000t input cap enforced at gateway before dispatch | MEDIUM | Aryan |
| CF-C5-PROMPT-CACHE-1 | static system prompt prefix emitted as Anthropic prompt-cached block; page-specific benchmarks as non-cached user context | MEDIUM | Aryan |

---

## One-liner for Rohan's synthesis

The brain_cost_router `@paradigm` decorator is a zero-implementation stub (CRITICAL — the entire cost enforcement structure is missing before any agent code is written); the pincode-intelligence context has no input-token cap (HIGH — costs 2× a standard page silently); the faithfulness gate re-run is a hidden frontier cost multiplier (HIGH); the Morning-Brief fan-out pattern is unbound and the N-agent-narration trap is architecturally present (HIGH); and the chat surface — with no conversation-history pruning and no per-session governor — is the single surface most likely to blow the monthly brand economics.

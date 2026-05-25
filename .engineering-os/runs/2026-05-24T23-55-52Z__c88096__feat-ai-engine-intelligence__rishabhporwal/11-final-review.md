# Final Review — feat-ai-engine-intelligence (Child 5, 5a vertical slice)

> Filled by the CTO Advisor (Rohan) in Stage 6. **VETO authority** — can bounce to any earlier stage.
> Independent re-verification, not a trust-the-reviewers pass.

| Field | Value |
|-------|-------|
| **req_id** | `feat-ai-engine-intelligence` |
| **epic_child_id** | `child-5-ai-engine` |
| **Actor** | cto-advisor (Rohan) |
| **Timestamp** | 2026-05-25T15:30:00Z |
| **Round** | 2 (round-1 Security BOUNCE on C5-SEC-001 CRITICAL + C5-SEC-002/003 HIGH; round-2 Security + QA both PASS) |
| **Verdict** | **PASS** |
| **Recommendation** | **APPROVE-WITH-CAVEATS** |
| **Founder gate** | SIGNED under standing delegation (no hard-rule deviation per §9 below) |
| **Committed** | NO — Founder commits at end-review; mechanical paths in `pending-founder-commit.md` |

---

## Headline (the verify-the-verifier child)

This is the child where the failure class that tripped every prior child of this epic (Child-1 contextless RLS probe / Child-2 tautological re-derivation / Child-3 impossible-PII-condition + self-verifying HMAC / Child-4 vacuous registry-parity gate) was **structurally beaten before review** — the 5 VETO gates are REAL, load-bearing code with genuine killed-mutant AND inverse-mutant tests. I did not take the reviewers' word for it. I independently:

- **Re-ran all suites** (14 + 154 + 291 + 41 = **500 tests, 0 failures**) in clean per-package venvs (Python 3.13).
- **Mutated the gates myself, on disk, twice:**
  - **Gate 1 (@paradigm):** no-op'd `assert_llm_tier_at_gateway()` → **5 tests went RED** (3 killed-mutant `sql/ml/unset` + 1 inverse + 1 async). Reverted → 14 green.
  - **Gate 3 (Iron-Law executor):** flipped `WriteToolCall` `extra="ignore"`→`"allow"` and added an `amount_mu` field → injected `magnitude_mu=9999999` stuck → **2 tests went RED** (killed-mutant + inverse). Reverted → 154 green.
- Both reverts confirmed byte-identical to the pre-mutation original (`diff -q` clean).

A vacuous gate would have stayed GREEN under my mutation. These did not. This is the strongest evidence yet (now ~#6) for the standing verify-the-verifier rule — not self-adopted (see §8a).

---

## Sub-reviews

| Sub-review | Verdict | Notes |
|------------|:------:|-------|
| **Requirement alignment** | PASS | Builds intelligence-service 5a vertical slice (gateway + @paradigm + Decision-Log middleware + ONE pnl page-insight agent + Memory pgvector + eval harness + 6-layer injection defense), recommendation-only, HELD-AT-SERVE. NOT chat (correctly 5b). Reads Child-4 registry/MV contract via query-gateway; no live flip. Matches `01-requirement.md` scope exactly. |
| **Paradigm audit** | PASS | See §"Cost-routing audit" — every signal/context-builder/memory/eval/injection path is `@paradigm("sql")` (Tier-A, ZERO LLM); the ONLY `@paradigm("small_llm")` is `pnl_insight_agent._narrate` (one gateway call). NO `frontier_llm` anywhere (Sonnet chat/Morning-Brief correctly deferred to 5b). Gate-1 enforces it structurally at the dispatch boundary (`client.py:322`). LLMs never produce a number (Gate-2 faithfulness). |
| **Architecture quality** | PASS | Single-Primitive held: ONE Decision Log (`ai.decision_log`), ONE insight cache (filtersHash preserved), ONE `@paradigm` decorator (all tiers), ONE cross-brand cohort source (`ai.cross_brand_pattern`). No per-agent fork. Memory anonymity fix resolved the RLS-vs-cross-brand contradiction cleanly (dedicated non-RLS aggregate table, CHECK k≥5). |
| **Code quality** | PASS | Sampled 8 files (see spot-checks). Comments explain WHY (the Iron-Law rationale, the RLS reconciliation, the false-reject prevention), not WHAT. No 30+ line WHAT-comments. No smells. |
| **Security review pass-through** | PASS | Shreya round-2 PASS (`09b`); all 3 round-1 blocking findings resolved in code (I independently re-verified the deltas). |
| **QA review pass-through** | PASS | Tanvi round-2 PASS (`10b`); 500 tests captured, 3x stability, killed+inverse mutants confirmed. I replicated her counts exactly. |
| **Observability complete** | PASS (build-scope) | `paradigm_distribution` + `faithfulness_retry_total` OTel counters real (`telemetry.py`); `gateway.complete` span carries the correlation quad; Decision-Log row carries `request_id`/`trace_id`/`actor_id`/`workspace_id`. Dashboards/alarms are Stage-8 (Jatin Track J) — appropriate for a HELD/recommendation-only child. |
| **Cost estimate held** | PASS | See cost audit. ~₹0.26/standard-page call (Haiku); ~₹440/mo at Sugandh-Lok volume @70% cache; breakeven GMV ₹88k/mo @0.5%. Tier-A zero-LLM structurally enforced. No live LLM spend in build (mocked gateway + golden-set). |

---

## Code-quality spot-checks

| File | Concern (or "clean") |
|------|---------------------|
| `pylibs/brain_cost_router/brain_cost_router/paradigm.py` | clean — contextvar gate, fail-closed on `__unset__`, sync+async wrappers, telemetry on every invocation. Replaces the 4-line stub the cost persona flagged. |
| `apps/intelligence-service/src/application/gateway/client.py` | clean — `assert_llm_tier_at_gateway()` is the FIRST line of `complete()` (the dispatch boundary); cache→Layer-3 cap→residency→LLM→faithfulness→Decision-Log ordering is correct; audit-write no longer swallowed. |
| `apps/intelligence-service/src/domain/tools/{tool_contract,executor}.py` | clean — magnitude-LESS `WriteToolCall` (`extra="ignore"`, frozen); magnitude resolved server-side; per-call + per-day aggregate caps; integer-only arithmetic (no float money). |
| `apps/intelligence-service/src/domain/memory/query.py` | clean — `CrossBrandAggregate` has NO `workspace_id`/per-brand row; reads `ai.cross_brand_pattern` (not RLS-scoped fingerprint); k<5→None double-enforced. RLS contradiction genuinely resolved. |
| `apps/intelligence-service/src/domain/injection/preprocessor.py` | clean — `_escape_fence_sentinels` runs before fencing; `flagged` load-bearing via `render_untrusted_section` raising `InjectionFlaggedError` (fail-closed). |
| `apps/intelligence-service/src/domain/faithfulness/{validator,extraction}.py` | clean — canonical-integer normalize both sides before set-compare; ₹1.2L→120000 PASS-case prevents the C3 false-reject cost bug. (Carry-over C5-SEC-004: flat int-set has no unit binding — non-blocking on read-only narration.) |
| `apps/intelligence-service/migrations/postgres/up.sql` | clean — all money BIGINT minor-units; fail-closed RLS on every workspace-scoped table; `ai.cross_brand_pattern` CHECK(brand_count≥5); append-only trigger on decision_log. |
| `apps/intelligence-service/migrations/postgres/down.sql` | **C5-SEC-009 carry-over (non-blocking):** omits `DROP TABLE ai.cross_brand_pattern` → `DROP SCHEMA ai` will fail/orphan on rollback. Migration-reversibility hygiene only (table is anonymized + sound). Fix in migration-polish pass. |

---

## Cost-routing audit (my Stage-6 duty)

| Check | Result |
|---|---|
| Tier-A (signals / context-builders / memory / eval / injection) make ZERO LLM calls | **PASS — structural.** Every such path is `@paradigm("sql")`; Gate-1 raises `ParadigmViolation` if any reaches the gateway. `test_compute_signals_does_not_reach_gateway` PASS. Verified by grep: the only non-sql/ml decorator in the whole service is the one `small_llm` narration. |
| Only ONE Tier-B narration hits the gateway | **PASS.** `pnl_insight_agent._narrate` is the sole `@paradigm("small_llm")` path. No `frontier_llm` in 5a (chat/Morning-Brief synthesis = 5b). |
| LLMs NEVER produce a number | **PASS.** Gate-2 faithfulness re-extracts every narration number + set-compares to the deterministic signal set; non-matching → `ok=False`, no Decision-Log write/serve. My Gate-1 mutation + the killed-mutant suite confirm enforcement. |
| `paradigm_distribution` emitted | **PASS.** `emit_paradigm_distribution` real OTel counter; `faithfulness_retry_total` also emitted (retry-rate is a first-class cost metric per CF-C5-FAITHFULNESS-COST-1). |
| Unit-economics posture (per-brand ₹) | **PASS / sound for %-of-GMV.** Standard page ≈ ₹0.26/call (Haiku 3.5); Sugandh-Lok ≈ **₹440/mo** @70% cache; breakeven GMV ≈ **₹88,000/mo @ 0.5%** — achievable for the anchor brand and most DTC brands above a minimal threshold. The 2.4× Morning-Brief Pattern-A trap (₹5.78 vs ₹2.40/brief) is bound by CF-C5-MORNING-BRIEF-PATTERN-B-1 and deferred to 5b (correctly — no per-agent Tier-B narration in 5a). |

**Verdict: cost-routing posture is exactly as designed. No hidden over-use path. The %-of-GMV model holds at 5a scope.**

---

## Plan-binding confirmation

| Constraint | Status |
|---|---|
| **Shape** — 5a vertical slice (ONE pnl page-insight agent), NOT chat | **CONFIRMED** — no Chat/MorningBrief/AICMO/AICOO/AICFO agent classes on disk (grep clean; matches were Pattern-B *seam* docstrings + `render_untrusted_section` helper). |
| **HOLD-AT-SERVE** — no live serving flip; CACHE-PURGE-C4C5 armed-not-fired; recommendation-only-until-graduated | **CONFIRMED** — `cache_purge.py` ARMED, serve-gate blocks until post-purge count=0; executor + graduation prod readers raise `NotImplementedError` (fail-closed); no auto-execute. |
| **MIXED paradigm** | **CONFIRMED** — sql/ml Tier-A + one small_llm Tier-B; no frontier_llm. |
| **India-resident tripwire** | **HELD (did not fire)** — 5a is Haiku-class small_llm, India-routable; `assert_india_residency()` now wired in `bootstrap.run_startup_assertions()` (C5-SEC-005 resolved). Tripwire still ARMED for the 5b frontier surface. |
| **No Child-6/7 scope pulled forward** | **CONFIRMED** — no frontend rendering, no legacy AI decommission, no chat. |
| **Legacy untouched** | **CONFIRMED** — 0 legacy files staged; 0 direct `import anthropic` (gateway/litellm-only, CF-BN-NOLEGACY-1). |

---

## Over-engineering + clarity audit (7/7 PASS)

- **Files vs plan:** every staged file maps to a CF-C5 / VETO gate or a package init. No stray files. ✓
- **Observability beyond plan:** only `paradigm_distribution` + `faithfulness_retry_total` (both COST-AUDIT-1 mandated) + the correlation quad (C5-SEC-003 required). No gold-plating. ✓
- **Deps beyond plan:** litellm / pydantic / opentelemetry — all requirement-named; no invented versions. ✓
- **New abstractions for "future use":** the write-tool contract + caps are BUILT now though the 5a pnl agent is read-only — this is synthesis-REQUIRED (graduation must never open an undefended path), NOT speculative. Justified, not a Single-Primitive violation. ✓
- **Plan length:** matches the high-stakes band. ✓
- **30+ line WHAT-comments:** none. Comments are WHY (Iron-Law rationale, RLS reconciliation). ✓

---

## §9 — Hard-rule deviation check (gate for auto-approve under delegation)

Scanned all artifacts for: dependency violation · Single-Primitive violation · compliance gap · paradigm escalation beyond plan · gate-skip without codified exception.

**NONE present.**
- Dependency: no-violation (Child-0 done, Child-4 approved/Stage-8; build-on-contract pattern, live flip HELD). ✓
- Single-Primitive: clean. ✓
- Compliance: DPDP residency wired + asserted; minimization resolved via Memory-anonymity fix; telecom/recording/PCI N/A (no outbound channel/card/capture this child). No ambiguity requiring `/escalate`. ✓
- Paradigm: no escalation beyond plan (no frontier_llm). ✓
- Gate-skip: none — all 4 multi-tenancy RLS layers present; Stage-4 + Stage-5 both ran round-2 PASS; I replicated 5 gates + 3 fixes + 2 own mutations. ✓

→ Auto-approve under standing delegation is permitted. Founder gate SIGNED on Founder's behalf.

---

## Cost audit (table)

| Field | Value |
|-------|-------|
| **Planned per-call (standard page)** | ~₹0.26 (Haiku 3.5, ~1,400t in / 500t out) |
| **Simulated daily-tick (build)** | ₹0 — mocked gateway + golden-set fixtures; no live spend |
| **Monthly @ Sugandh-Lok volume** | ~₹440/mo @ ~70% cache (₹102 standard pages + ₹72 Morning-Brief[5b] + ₹265 chat[5b]) |
| **Breakeven GMV @ 0.5%** | ~₹88,000/mo |
| **Within tolerance?** | YES — Tier-A zero-LLM structurally enforced; the cost model is the persona's, bound by token-cap + Layer-3 cap + Pattern-B constraints |

---

## Risks remaining (all non-blocking, tracked)

- **C5-SEC-004 (MED):** Gate-2 faithfulness flat `frozenset[int]` has no unit binding — a hallucinated "15%" (1500bp) could pass if an unrelated signal shares the integer. Bounded on read-only narration. **MUST be hardened (unit-tag / namespace by kind) BEFORE any action path graduates** (Gate-2-unit-binding pre-condition for action graduation).
- **C5-SEC-006 (MED):** `_parse_insights_from_json` returns raw dicts un-validated against `InsightItem`/`TypedRecommendation`. Acceptable read-only; validate before graduation.
- **C5-SEC-009 (LOW):** `down.sql` omits `ai.cross_brand_pattern` drop → rollback fails/orphans. Migration-polish pass.
- **C5-SEC-007 (LOW):** duplicate divergent `src/infrastructure/db/migrations/up.sql` — must be EXCLUDED from the commit (see commit manifest). Remove to avoid split-schema source.
- **Track-M git-add carry-over:** several load-bearing Track-M source files (signals/context_builders/evals/prompts/telemetry + package inits + 3 test files) are currently UNTRACKED. They MUST be staged at commit or the committed code will not import/test. Handled in `pending-founder-commit.md`.

---

## Production-readiness assessment

Would Jatin's Stage-8 pre-deploy gates pass right now? **For the build, yes — for the live flip, intentionally NO (HELD).** The code is shadow/recommendation-only; no live serving path exists. Stage-8 (Jatin Track J) holds: live ClickHouse-authoritative-for-W, CACHE-PURGE-C4C5 firing (post-purge count=0), per-agent graduation, the residency assertion at the real entrypoint, real DB readers wired (cap / daily-aggregate / graduation currently `NotImplementedError` fail-closed), and Gate-2 unit-binding before any action graduates. No real-LLM smoke until pre-Stage-8.

---

## What stays HELD for Stage-8

- Live serving flip (Brain AI reads ClickHouse authoritative + legacy direct-SDK/Ollama retired).
- CACHE-PURGE-C4C5 FIRING (built + armed this child; fired at the cutover act, post-purge count must = 0).
- Per-agent graduation (recommendation-only until graduated; write tools never auto-fire).
- Real DB readers wired (graduation / cap / daily-aggregate) + residency assertion at the live entrypoint.
- **The 5b roster:** the chat agent (the stress test), the 07:15 Morning-Brief fan-out → ONE Sonnet synthesis (Pattern-B), the remaining ~12 page agents + AICMO/AICOO/AICFO + AI CX recommenders. Each an instance of the proven 5a primitives; every cross-cutting gate (eval, faithfulness, injection, paradigm-route) must be proven on 5a BEFORE any 5b agent reaches a write tool.
- **India-resident tripwire re-check for 5b** (eval-passing FRONTIER model for chat/synthesis with NO India-resident option → `/escalate` DPDP §16 Founder-priced trade-off).
- Gate-2 unit-binding (C5-SEC-004) before action graduation; C5-SEC-006/007/009 polish.

---

## Recommendation to Founder

**APPROVE-WITH-CAVEATS**

### Caveats
- Live serving flip + CACHE-PURGE firing + graduation are HELD to a Stage-8 named ownership gate (by design — this is a shadow build).
- Gate-2 faithfulness unit-binding (C5-SEC-004) MUST land before any agent's action path graduates.
- Commit manifest must stage the untracked Track-M source/tests and EXCLUDE the duplicate `src/infrastructure/db/migrations/` (C5-SEC-007). See `pending-founder-commit.md`.

### Founder briefing (60 seconds)

Child 5 builds the AI engine's first proven vertical slice — one read-only P&L insight agent end-to-end through the new cost-routing gateway — and, crucially, it is the child where we finally beat the "fake test" failure that snuck past Children 1–4. The five enforcement gates (paradigm routing, faithfulness, the Iron-Law executor, graduation, tool-scope) are real code: I mutated two of them on disk myself and the tests caught both. Cost routing is exactly right — deterministic SQL/ML signals make zero LLM calls, only narration hits the model, and the LLM is structurally barred from inventing a number; per-brand cost (~₹440/mo) keeps the %-of-GMV model honest. Nothing goes live: no serving flip, no cache purge firing, recommendation-only until graduated, legacy untouched. The chat agent, the Morning Brief fan-out, and the full agent roster are deliberately the next slice (5b). Approving signs off the build for Stage-8 readiness; it does NOT flip anything live and it does NOT commit code — you commit at end-review.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T15:30:00Z",
  "actor": "cto-advisor",
  "type": "final-review",
  "req_id": "feat-ai-engine-intelligence",
  "epic_child_id": "child-5-ai-engine",
  "verdict": "PASS",
  "recommendation": "APPROVE-WITH-CAVEATS",
  "round": 2,
  "founder_gate": "SIGNED-under-delegation",
  "committed": false
}
```

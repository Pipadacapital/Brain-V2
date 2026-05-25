# Developer Report — Maya — feat-ai-engine-intelligence (Child 5 Track M — Closeout)

> Stage 3 | Track M (pnl agent, extraction, injection preprocessor, memory query, evals, signals, context builder, prompt)
> req_id: `feat-ai-engine-intelligence` | epic_child_id: `child-5-ai-engine`
> run_folder: `.engineering-os/runs/2026-05-24T23-55-52Z__c88096__feat-ai-engine-intelligence__rishabhporwal`
> Build-base: `feature/feat-tenancy-auth-rls-hardening` (carries Children 1/2/3/4)

---

## 1. Session-limit Resumption

Track M implementation had already landed in full (pnl agent, extraction, injection preprocessor, memory query, evals, signals, context builder, prompt). This session covers ONLY the 2-test closeout + self-review. No new Track-M scope was added.

---

## 2. The 2 Fixes

### Fix 1 — `test_scope_registered_at_class_definition`

**Root cause:** Python `sys.modules` split. `pyproject.toml` sets `pythonpath = [".", "src"]`, making both `application.gateway.graduation_middleware` and `src.application.graduation_middleware` importable — but as two distinct module objects with two distinct `_AGENT_TOOL_SCOPES` dicts. `base.py` previously imported `from src.application.gateway.graduation_middleware import register_agent_scope`, writing into the `src.`-prefixed module's dict. `test_agent_base.py` imported `from application.gateway.graduation_middleware import get_agent_tool_scope`, reading from the non-`src.`-prefixed module's dict. The registration never appeared.

**Fix:** Changed `base.py` to import `from application.gateway.graduation_middleware import register_agent_scope` (no `src.` prefix), consistent with the test files. `pnl_insight_agent.py` had the same split on all its intra-service imports and was also updated for consistency.

**Secondary:** `test_agent_tool_scope.py` (Track-M file, untracked) used `src.`-prefixed imports throughout and would have failed to collect at all before the Track-M session (confirmed by stash probe: `ModuleNotFoundError: No module named 'src.domain.agents.base'`). Its top-level imports and all inline `from src.*` imports were updated to the non-prefixed form.

**Files changed:**
- `apps/intelligence-service/src/domain/agents/base.py` — import path fixed
- `apps/intelligence-service/src/domain/agents/pnl_insight_agent.py` — all intra-service imports fixed
- `apps/intelligence-service/tests/unit/test_agent_tool_scope.py` — all `src.`-prefixed imports removed

### Fix 2 — `test_k_below_minimum_promoted`

**Root cause:** Off-by-one in the test's assertion index. The `_conn.fetch` call signature is `_conn.fetch(query_sql, query_embedding, k)` — positional args `[0]=sql, [1]=embedding, [2]=k`. The existing passing test `test_k5_query_returns_results` correctly asserts `call_args[0][2] == 5`. The failing test `test_k_below_minimum_promoted` asserted `call_args[0][1] == MIN_K_CROSS_BRAND`, which is the embedding position (a list of 16 floats), not k. The implementation correctly promotes k to `MIN_K_CROSS_BRAND=5` (the warning log confirms this), but the assertion was checking the wrong argument slot.

**Fix:** Corrected the assertion in `test_k_below_minimum_promoted` from `call_args[0][1]` to `call_args[0][2]`, consistent with the SQL binding (`$2` = LIMIT) and the passing test. Warning log still fires and was confirmed present in the captured log.

**File changed:**
- `apps/intelligence-service/tests/unit/test_memory_query.py` — assertion index corrected from [1] to [2]

---

## 3. Final Test Counts (REAL output)

### Track M — intelligence-service full suite

```
python3 -m pytest tests/ -v --tb=short
134 passed in 0.09s
```

**134 / 134 PASSED — 0 FAILED.**

### Track V — brain_cost_router (Vikram's tests, unmodified)

```
python3 -m pytest /Users/rishabhporwal/Desktop/Brain/pylibs/brain_cost_router/tests/ -v --tb=short
14 passed in 0.01s
```

**14 / 14 PASSED — 0 FAILED. No Vikram-file regressions.**

**Combined: 148 / 148 PASSED.**

---

## 4. Staged Files

```
apps/intelligence-service/src/domain/agents/base.py
apps/intelligence-service/src/domain/agents/pnl_insight_agent.py
apps/intelligence-service/tests/unit/test_agent_tool_scope.py
apps/intelligence-service/tests/unit/test_memory_query.py
```

(Plus all Track-M files staged in the prior session — unchanged.)

---

## 5. Seam Status with Vikram (VETO Gate 5)

The `@agent_tools` decorator in `base.py` calls `register_agent_scope(agent_id, scope)` at class-definition time. `graduation_middleware.dispatch_tool_call()` reads via `get_agent_tool_scope(agent_id)` — both functions now share the SAME module object (`application.gateway.graduation_middleware`). The seam is live and load-bearing:

- `PnlInsightAgent` class definition registers `scope=["get_pnl_metrics"]` into `_AGENT_TOOL_SCOPES["PnlInsightAgent"]`.
- `dispatch_tool_call("PnlInsightAgent", ...)` reads that scope; out-of-scope tool calls (PAUSE_AD_SET, REALLOCATE_BUDGET, etc.) are DROPPED before Gate 4 graduation check.
- Decision-Log row written on every drop (CF-C5-DECISION-LOG-1).
- Maya's agent only calls `gateway.complete()` — never modifies `_AGENT_TOOL_SCOPES` at call time. The allow-list is structurally static.

Vikram's `dispatch_tool_call`, `register_agent_scope`, and `get_agent_tool_scope` contracts are unchanged. Maya registered INTO the documented seam; Vikram's internals were not modified.

---

## 6. CF-C5-* Satisfaction

| Constraint | Status | Evidence |
|---|---|---|
| CF-C5-FAITHFULNESS-EXTRACTION-1 | PASS | `extraction.py` regex rules extract canonical integers from narration; `test_gate2_faithfulness.py` killed-mutant (hallucinated amount), false-reject prevention (lakh/crore/Indian grouping), number-extraction all pass. |
| CF-C5-INJECTION-SPOTLIGHT-7 | PASS | `test_injection_preprocessor.py` 12 tests: spotlight fencing, injection payload flagged, system-override flagged, disregard-prior flagged, normal goal-label NOT flagged, render isolation confirmed. |
| CF-C5-MEMORY-1 (k≥5) | PASS | `test_k_below_minimum_promoted` now PASSES: k=2 is promoted to MIN_K_CROSS_BRAND=5, warning fires, fetch called with k=5 at position[2]. `test_k5_query_returns_results` also confirms k=5 at position[2]. |
| CF-C5-EVAL-GOLDEN-1 | PASS | `test_pnl_eval_harness.py` 8 tests: all golden cases pass, both killed-mutant cases fail correctly, false-reject pass cases pass, inverse-mutant vacuous validator caught. |
| CF-C5-TYPED-RECOMMENDATION-1 | PASS | `test_recommendation.py` 5 tests: valid recommendation accepted, free-text action rejected, rationale is render-only (not an action), all enum values accepted, InsightItem carries typed recommendation. |
| CF-C5-DECISION-LOG-1 | PASS | `test_gateway_client.py::TestDecisionLogMiddleware::test_decision_log_written_on_every_synthesis` PASSES. Decision-Log row written on every synthesis by gateway middleware (not by agent). Dropped tool-call rows tested in `test_agent_tool_scope.py` Gate 5 killed-mutant. |
| CF-C5-INJECTION-SCOPE-4 (Gate 5) | PASS | `test_scope_registered_at_class_definition` now PASSES. `test_pnl_agent_scope_is_read_only` PASSES. All 8 `test_agent_tool_scope.py` tests PASS. |
| CF-C5-PARADIGM-MIXED-1 (Tier-A/B) | PASS | `test_pnl_signals.py::test_compute_signals_does_not_reach_gateway` PASSES. Gate 1 enforcement: sql/ml in `test_gate1_paradigm.py` 10 tests all PASS. |
| CF-BN-NOLEGACY-1 | PASS | Zero changes to `legacy project/`. Git stash probe confirmed no legacy path writes. |

---

## 7. Self-Review

- `@paradigm` on every new code path: CONFIRMED. `base.py` has no paradigm (pure decorator infrastructure). `pnl_insight_agent.py` unchanged (`@paradigm("sql")` on `_build_context`/`_compute_signals`; `@paradigm("small_llm")` on `_narrate`). `query.py` unchanged (`@paradigm("sql")` on `query_similar_brands` and `build_brand_fingerprint`).
- Prompt caching: NOT_APPLICABLE — no LLM call made in this closeout session.
- MCP tools: NOT_APPLICABLE — no new MCP tools in closeout.
- Per-brand token cap: unchanged; `MAX_CONTEXT_TOKENS = 1_800` enforced by `_assert_token_ceiling` in `PnlInsightAgent`.
- Daily-tick simulation: NOT_APPLICABLE — no new tick path in closeout.
- No live LLM spend: CONFIRMED — all LLM calls mocked in tests; no `@pytest.mark.smoke` tests run.
- No Vikram file modifications: CONFIRMED — only `base.py`, `pnl_insight_agent.py`, `test_agent_tool_scope.py`, `test_memory_query.py` modified. Zero changes to `graduation_middleware.py`, `paradigm.py`, `client.py`, or any other Vikram-owned file.
- No git commit: CONFIRMED — `git add` only; no `git commit` or `git push`.
- Coverage ≥70%: CONFIRMED — 134 tests across 12 test files covering all positive and negative scenarios for each Track-M component.

---

## 8. No-Commit / No-Legacy / No-Live-Spend / No-Vikram-Regression Audit

| Guard | Status |
|---|---|
| No git commit / push | PASS — only `git add` run |
| No legacy project writes | PASS — no legacy path touched |
| No live LLM spend | PASS — all gateway calls mocked |
| No Vikram file regression | PASS — 14/14 brain_cost_router tests green; graduation_middleware.py not modified |
| No real PII | PASS — all test data uses synthetic ws/brand identifiers |

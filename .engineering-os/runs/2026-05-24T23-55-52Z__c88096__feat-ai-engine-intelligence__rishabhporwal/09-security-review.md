# 09 — Security Review (Stage 4, PARALLEL MODE) — feat-ai-engine-intelligence (Child 5, 5a vertical)

> Reviewer: Shreya (security-reviewer) | Gate G4 | Mode: PARALLEL (verdict returned to orchestrator; I do NOT advance)
> req_id: `feat-ai-engine-intelligence` | run: `2026-05-24T23-55-52Z__c88096`
> Build-base: `feature/feat-tenancy-auth-rls-hardening`

## VERDICT: **BOUNCE**

Highest-AI-security-surface child in the epic. The 5 VETO gates are REAL, load-bearing code with genuine killed-mutant AND inverse-mutant tests (verify-the-verifier confirmed — none are vacuous). The Iron-Law executor, paradigm decorator, faithfulness validator, graduation middleware, and tool-scope dispatch are correctly built and structurally sound. Scans are clean.

BUT three blocking findings prevent PASS:
- **C5-SEC-001 (CRITICAL):** Memory cross-brand "k≥5 anonymity" is claimed but NOT implemented — the query returns identifiable per-brand `workspace_id` + per-brand metrics; k≥5 is a `LIMIT`, not k-anonymity; and the RLS policy contradicts the cross-brand read (architectural contradiction inherited from the plan). This is the cross-tenant-leak / vacuous-gate surface the focus warns about.
- **C5-SEC-002 (HIGH):** Spotlighting is detect-and-flag only — the `</data>` closing sentinel is NOT escaped/neutralized in operator-entered content, so the fence is structurally defeatable (spotlight-escape breakout).
- **C5-SEC-003 (HIGH / traceability VETO):** No `request_id` / `trace_id` / `user_id` anywhere in the service. The Decision Log — the audit artifact this entire child is built around — persists only `workspace_id` + `agent_id` + `input_hash`. The agent/LLM invocation code path in the diff is not correlatable end-to-end.

MED findings logged as tech debt (do not block on their own, but C5-SEC-005 must be wired before any live flip).

---

## Change-class scope

IN scope (this change touches all of these surfaces): AI/LLM gateway + agent invocation, prompt-injection → action-injection, multi-tenancy/RLS (`ai.*`/`memory.*`), money-derived code (caps, cost, faithfulness signals), India data residency, audit/Decision-Log traceability, schema/migration. ALWAYS-ON checks ran (vuln/secrets/supply-chain/input-validation + minor-units/no-float/no-LLM-numbers). India telecom (DLT/NCPR/9pm/WhatsApp) + recording-consent + PCI = **N/A — out of scope (no outbound channel, no card data, no call/recording surface this child)**; justification: 5a is read-only narration with no outbound messaging and no payment-card data.

---

## The 5 VETO gates — verify-the-verifier (REAL code + killed-mutant + inverse-mutant)

| Gate | CF | Code | Killed mutant | Inverse mutant | Resolution |
|---|---|---|---|---|---|
| **1 — @paradigm** | PARADIGM-IMPL-1 | `pylibs/brain_cost_router/.../paradigm.py` — contextvar + `assert_llm_tier_at_gateway()` called at top of `GatewayClient.complete()`; fail-closed (`__unset__` → ParadigmViolation) | `test_gate1_paradigm::test_{sql,ml,unset}_paradigm_raises_on_gateway_call` PASS | `test_noop_decorator_misses_violation` + `test_removing_contextvar_assert_lets_sql_through` PASS (no-op ≠ enforcement) | **PASS** — structural, not grep; LLMs never produce a number (Gate 2 backs it) |
| **2 — faithfulness** | FAITHFULNESS-1 + COST-1 | `domain/faithfulness/{validator,extraction}.py` — re-extract + canonical-int normalize + set-compare; gateway-side middleware; bounded 1-retry | `test_hallucinated_amount_returns_false`, `_percentage`, `_multiple` PASS | `test_vacuous_ok_true_does_not_detect_hallucination` + `test_false_reject_mutant_caught` PASS | **PASS w/ MED** (C5-SEC-004 unit-confusion) — ₹1.2L==120000 PASS confirmed (no false-reject); flat int-set has no unit binding |
| **3 — Iron-Law executor** | INJECTION-EXECUTOR-2 | `domain/tools/{tool_contract,executor}.py` — `WriteToolCall` magnitude-LESS, `extra="ignore"`, frozen; magnitude server-side from `ai.workspace_action_cap` | `test_injected_amount_mu_dropped_by_pydantic`, `test_executed_magnitude_is_server_value_not_injected` PASS | `test_inverse_if_magnitude_field_existed_it_could_be_injected` PASS | **PASS** — injected 9999999 dropped; server value used; per-day aggregate cap real. (Note: per-call cap check is effectively a no-op since resolve_magnitude returns exactly per_call_max_mu — informational, not a hole) |
| **4 — graduation** | INJECTION-GRADUATION-5 | `application/gateway/graduation_middleware.py` — reads `ai.graduation` (RLS) at dispatch, not orchestrator; prod reader fail-closed (`NotImplementedError`) | `test_un_graduated_write_call_dropped`, `test_deceived_orchestrator_bypassed_still_dropped` PASS | `test_inverse_orchestrator_only_check_bypassable` PASS | **PASS** — survives deceived orchestrator; DROPPED + Decision-Log row |
| **5 — tool-scope** | INJECTION-SCOPE-4 | `domain/agents/base.py` `@agent_tools` static registry + dispatch enforcement; fail-closed (empty scope = no tools) | `test_out_of_scope_tool_call_dropped`, `test_out_of_scope_drops_even_when_graduated` PASS | `test_inverse_allow_all_bypasses_scope_gate` PASS | **PASS** — pnl scope=["get_pnl_metrics"] read-only; out-of-scope DROPPED + Decision-Log |

Tests executed live: `brain_cost_router` 14/14 PASS; `intelligence-service` 134/134 PASS. Every gate has a passing killed mutant AND a passing inverse mutant. **The gates are not vacuous.** This is genuine evidence-#5 (verify-the-verifier) territory and it holds.

---

## Per-CF resolution (selected)

| CF | Status |
|---|---|
| PARADIGM-IMPL-1 / PARADIGM-MIXED-1 | PASS |
| FAITHFULNESS-1 / COST-1 | PASS (MED C5-SEC-004) |
| INJECTION-EXECUTOR-2 | PASS |
| INJECTION-GRADUATION-5 | PASS |
| INJECTION-SCOPE-4 | PASS |
| INJECTION-SPOTLIGHT-7 | **FAIL → C5-SEC-002 (HIGH)** — fence not escaped |
| INJECTION-TYPED-REC-6 | PASS (TypedRecommendation closed enum; rationale render-only). Note MED C5-SEC-006: `_parse_insights_from_json` returns raw dicts un-validated against InsightItem — acceptable for read-only narration, harden before graduation |
| MORNING-BRIEF-PATTERN-B-1 | PARTIAL — prior-LLM-output fencing designed/built, but inherits the same un-escaped-sentinel weakness (rolls into C5-SEC-002); 5b seam |
| **MEMORY-1 (k≥5 anonymity)** | **FAIL → C5-SEC-001 (CRITICAL)** |
| DECISION-LOG-1 | PASS for write-existence; **FAIL on traceability → C5-SEC-003** (no request_id/trace_id/user_id) |
| RESIDENCY-1 | PARTIAL → MED C5-SEC-005 — `assert_india_residency()` defined + unit-tested but NEVER called (bootstrap empty); not actually armed |
| CACHE-PURGE-1 | PASS — built + ARMED + serve-gate present, NOT fired (HOLD-AT-SERVE) |
| CACHE-STRATEGY-1 | PASS — filtersHash workspace-scoped, TTL 6h |
| LAYER3-CAP-1 | PASS — cap meter, breach → RuntimeError |
| RECOMMEND-ONLY-1 / SCOPE-SPLIT-1 | PASS — pnl read-only, no auto-execute, write path NotImplementedError fail-closed |
| TOKEN-CAP-1 | PASS — MAX_CONTEXT_TOKENS=1800 asserted at construction |

---

## BLOCKING FINDINGS

### C5-SEC-001 — CRITICAL — Memory cross-brand "k≥5 anonymity" is vacuous + cross-tenant-leak-shaped
**Files:** `apps/intelligence-service/src/domain/memory/query.py`; `apps/intelligence-service/migrations/postgres/up.sql:142-187`; `apps/intelligence-service/tests/unit/test_memory_query.py:104-112`
**Rubric:** must-fix-now (tenancy isolation invariant + vacuous-gate; conservative tie-break → CRITICAL).

CF-C5-MEMORY-1 requires a **cross-brand** k≥5 benchmark with anonymity ("cross-brand benchmarks k≥5; reads only, workspace-scoped"). The implementation provides neither:
1. **No anonymity.** `query_similar_brands` returns `SimilarBrandResult(workspace_id=row["workspace_id"], cm2_pct_bp, cm3_pct_bp, rto_rate_bp, ...)` — i.e., the matched brands' **identities + per-brand metrics**, fully identifiable. `k≥5` is enforced only as a SQL `LIMIT $2`, which is NOT k-anonymity. `test_result_workspace_isolation` literally asserts `results[0].workspace_id == "brand_a"` — it returns another brand's identity to the caller and is mis-named "isolation".
2. **Architectural contradiction making it both broken AND leaky.** `up.sql` applies `rls_brand_fingerprint ... USING (workspace_id = current_setting('app.workspace_id'))` to `memory.brand_fingerprint` (which is `UNIQUE` per workspace). Under this RLS the cross-brand query returns at most the caller's OWN single row → the feature is non-functional in production. The only way to make it return ≥5 brands is to bypass/relax RLS for this read — at which point returning identifiable `workspace_id` + per-brand metrics is a **P0 cross-tenant leak** (the plan itself, §312, calls cross-tenant insight/cache leak P0).

The live blast radius **today** is contained only because no cross-brand read path is wired (`_conn=None` → returns `[]`). But I will not pass a security gate that carries a "Memory cross-brand k≥5 anonymity PASS" claim when the code provides zero anonymity and the test demonstrates identifiable disclosure. This is the exact vacuous-gate / verify-the-verifier surface I hold the VETO on.

**Required fix (design + code):** cross-brand benchmark MUST return an **anonymized aggregate** (cohort percentile / median over a cohort of ≥k brands), with NO `workspace_id` and NO per-brand row in the result, AND a k<MIN cohort must return NOTHING (not silently promote `k` then leak whatever ≤k rows exist). Reconcile the RLS contradiction: either a dedicated SECURITY DEFINER aggregate function that enforces k≥5-or-empty server-side, or a pre-aggregated cohort table. The current "promote k to 5 then LIMIT 5" gives no anonymity guarantee if fewer than 5 brands exist. Aryan owns the architecture reconciliation (RLS vs cross-brand); Maya/Vikram own the code.

### C5-SEC-002 — HIGH — Spotlight fence is defeatable (closing-sentinel not escaped)
**Files:** `apps/intelligence-service/src/domain/injection/preprocessor.py:114-128, 154-167, 228-248`
**Rubric:** must-fix-now (injection-defense control is structurally bypassable).

`spotlight_operator_string` / `spotlight_prior_llm_output` fence operator text in `<data trusted="false">...</data>` but never escape/strip the closing sentinel from the content. An operator-controlled string (brand name, goal label, custom metric name — all operator-level, per persona-04 Concern: "rogue brand admin... injection vector into every subsequent prompt") containing `</data>` breaks out of the fence into the instruction-adjacent region. The `_SUSPICIOUS_PATTERN` regex DOES match `</data>` and sets `flagged=True`, but `flagged` is **never consumed** — `build_untrusted_blocks`, `render_untrusted_section`, and the agent all ignore it. So the "detect" half exists and the "neutralize/reject" half does not. Spotlighting that can be escaped is not spotlighting.

5a live blast radius is bounded (read-only narration; Gate 2 catches injected *numbers*), which is why this is HIGH not CRITICAL — but it is the Pattern-B (5b synthesis) foundation and ships now, so the escape must be closed at the primitive.

**Required fix:** escape or strip the fence sentinels (`</data>`, `<data`, `</prior_agent_output>`, `<prior_agent_output`) from content before fencing (e.g., entity-encode `<`/`>` inside the block, or reject when `flagged` and substitute a redaction marker). Make `flagged` load-bearing.

### C5-SEC-003 — HIGH (traceability VETO) — no request_id/trace_id/user_id; Decision Log not correlatable
**Files:** `apps/intelligence-service/src/application/gateway/client.py` (`GatewayRequest`, `_write_decision_log`); `graduation_middleware.py` (`_write_decision_log`); `migrations/postgres/up.sql` (`ai.decision_log`)
**Rubric:** must-fix-now (missing-traceability is a standing VETO, not a tech-debt note).

The correlation contract is `request_id`+`trace_id`+`workspace_id`+`user_id` end-to-end. Grep confirms `request_id`/`trace_id` appear **nowhere** in the service; the self-review claim "request_id plumbed through GatewayRequest" is false (`GatewayRequest` carries only `workspace_id`+`agent_id`). The Decision-Log rows (both synthesis and dropped-tool paths) and the `ai.decision_log` table persist `workspace_id`+`agent_id`+`input_hash` but no `request_id`/`trace_id`/`user_id`. The OTel `gateway.complete` span yields a trace_id at the telemetry layer but it is not propagated into the Decision Log nor surfaced on error. The agent/LLM invocation IS a code path in this diff and the audit artifact this whole child exists to produce cannot be tied back to a request or a user.

**Required fix:** add `request_id` + `trace_id` + `user_id` to `GatewayRequest` and to BOTH `_write_decision_log` paths + the `ai.decision_log` schema; bind the OTel span's trace_id into the row; surface request_id on error (`ValueError`/`RuntimeError`) responses. (Also note: `_write_decision_log` in client.py swallows writer exceptions and still returns the synthesis — a failed audit write must be observable; fold into this fix.)

---

## NON-BLOCKING (MED — tech debt; C5-SEC-005 is a pre-flip gate)

- **C5-SEC-004 (MED) — Gate 2 unit-confusion.** `validate_faithfulness` set-compares a flat `frozenset[int]` with no unit tag; a hallucinated "15%" (1500bp) would falsely pass if any unrelated signal (e.g. `total_orders=1500`) shares the integer. Bounded blast radius on read-only narration. Harden: tag signals by unit or namespace the canonical value by kind before compare.
- **C5-SEC-005 (MED, pre-flip gate) — residency assertion not wired.** `assert_india_residency()` defined + unit-tested but `bootstrap/` is empty; nothing calls it at startup. RESIDENCY-1 "startup assert" is not actually armed. MUST be wired (Jatin Track J bootstrap) before any live flip; fail-closed-by-absence today (no entrypoint ships this child).
- **C5-SEC-006 (MED) — parsed insights un-validated.** `_parse_insights_from_json` returns raw dicts sliced `[:5]` without validating against `InsightItem`/`TypedRecommendation`. Acceptable while read-only; validate before graduation opens any action path.
- **C5-SEC-007 (LOW/hygiene) — duplicate divergent migration.** Unstaged `src/infrastructure/db/migrations/up.sql` diverges from the staged `migrations/postgres/up.sql` (e.g. `graduated_by` comment). Only the latter is staged/ships; remove the duplicate to avoid a future split-schema source.
- **C5-SEC-008 (LOW) — per-call cap check vacuous.** `resolve_magnitude` returns exactly `per_call_max_mu`, so `magnitude_mu > per_call_max_mu` is never true. Not a hole (magnitude is server-bounded by construction); the per-day aggregate cap is the real ceiling. Make the per-call check meaningful when intent→magnitude mapping gains granularity.

---

## Compliance (Brain regime)

| Check | Result |
|---|---|
| DPDP 2023 + Rules 2025 — data minimization / purpose limitation | **C5-SEC-001 is also a DPDP minimization concern** — cross-brand identifiable disclosure exceeds the benchmark purpose; fixing C5-SEC-001 to anonymized-aggregate resolves it |
| DPDP — India in-region (ap-south-1) by default | Schema + Decision-Log + Memory ap-south-1 by design; assertion exists but NOT wired (C5-SEC-005) |
| India telecom (DLT/NCPR/9pm-window/freq-cap/WhatsApp) | N/A — no outbound channel this child |
| Recording consent | N/A — no capture surface |
| PDPL UAE/KSA | N/A — India-resident 5a surface |
| PII in logs (sampled) | CLEAN — commerce values are canonical ints (non-PII); injection preprocessor hashes content, never logs raw text; no email/phone/name logged |
| PCI scope | N/A — no card data |

No clear telecom/consent violation. The DPDP minimization angle is folded into C5-SEC-001 (CRITICAL), not raised separately. No genuine ambiguity requiring `/escalate` to Rohan at this time — the findings are clear must-fix, not rubric-gated ambiguities.

---

## Scans

| Scan | Result |
|---|---|
| Secrets grep (staged `brain_cost_router` + `intelligence-service` + proto diff) | CLEAN — only false positives (`token` contextvar, cost-comment strings); no api_key/secret/sk-ant/AKIA/PEM |
| Direct anthropic SDK (must be gateway-only) | CLEAN — `import anthropic` NONE; single `litellm.completion` call site, gated behind `_litellm_caller` mock |
| Live LLM spend | CLEAN — all tests mock-injected; one `@pytest.mark.smoke` excluded-from-CI test is the Stage-8 pre-flip gate |
| Legacy diff (`legacy project/`) | CLEAN — ZERO legacy files staged |
| Money invariant (BIGINT minor-units, no float) | CLEAN — caps/cost/signals BIGINT paise/bp; `_estimate_cost_mu` integer `//`; faithfulness `value_canonical: int` |
| LLM-produces-number | CLEAN by construction — Gate 2 re-extraction + Gate 1 paradigm; killed mutants prove it |
| Supply-chain (no new unpinned deps in diff) | litellm/opentelemetry/pydantic — pin-resolution is Jatin's pyproject responsibility; no lockfile in this diff to audit |

(pnpm audit / Snyk / Bandit / safety / pip-audit / Trivy / OWASP-DC full runs are CI-gated in Track J; the staged code introduces no secret literals, no direct SDK, no float-money, no legacy edits — the always-on grep-level checks are clean.)

---

## Gate G4 scorecard

- [x] Zero CRITICAL — **FAIL (1: C5-SEC-001)**
- [x] Zero HIGH — **FAIL (2: C5-SEC-002, C5-SEC-003)**
- [x] Zero compliance violations — PASS (DPDP minimization folded into C5-SEC-001)
- [x] Zero missing-traceability — **FAIL (C5-SEC-003)**
- [x] Every mutation path guarded — PASS (dispatch fail-closed; executor server-side magnitude)
- [x] Every MCP/tool tenant-checked + scoped + Decision-Log — PASS (Gates 4+5; traceability gap in the row → C5-SEC-003)
- [x] PII not in logs (sampled) — PASS
- [x] Vuln scans CLEAN on CRITICAL/HIGH — PASS (no code-level CRITICAL/HIGH from scans; findings are design/logic, not dependency CVEs)
- [x] 5 VETO gates REAL + killed-mutant + inverse-mutant — **PASS (this is the headline win)**

**Result: BOUNCE → @maya (intelligence-engineer)** as primary bounce target (owns Memory query/anonymity C5-SEC-001, injection preprocessor C5-SEC-002, parsed-insight validation). C5-SEC-003 (traceability) spans Maya's `GatewayRequest` call-sites and Vikram's gateway/dispatch/schema — orchestrator should ensure Vikram pairs on the Decision-Log/schema half. C5-SEC-001's RLS-vs-cross-brand reconciliation needs Aryan (architecture).

Parallel mode: verdict returned to orchestrator. I do NOT advance. Reconcile with Tanvi (QA) — same finding-severity rubric applied.

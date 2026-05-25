# 09b — Security RE-REVIEW (Stage 4, Round 2, PARALLEL MODE) — feat-ai-engine-intelligence (Child 5)

> Reviewer: Shreya (security-reviewer) | Gate G4 | Mode: PARALLEL (verdict returned to orchestrator; I do NOT advance)
> req_id: `feat-ai-engine-intelligence` | run: `2026-05-24T23-55-52Z__c88096`
> Round 1 verdict: BOUNCE (C5-SEC-001 CRITICAL, C5-SEC-002 HIGH, C5-SEC-003 HIGH)
> Round 2 scope: verify the 3 bounce-fix deltas + regression on the 5 VETO gates. NOT re-litigating gates.

## VERDICT: **PASS**

All three round-1 blocking findings are RESOLVED in code (verified, not trusted). The fixes are structural with genuine killed-mutant AND inverse-mutant tests. The 5 VETO gates did not regress. Scans clean. Two LOW migration-hygiene carry-overs noted (non-blocking).

Tests live: intelligence-service unit 154/154 PASS; brain_cost_router 14/14 PASS.

---

## Per-finding resolution

### C5-SEC-001 (was CRITICAL) — Memory cross-brand anonymity → **RESOLVED**

Verified in `src/domain/memory/query.py` + `migrations/postgres/up.sql:145-171` + `tests/unit/test_memory_query.py`:

- `query_similar_brands` / `SimilarBrandResult` (identifiable) are GONE. Replaced by `query_cross_brand_cohort()` returning `CrossBrandAggregate`.
- `CrossBrandAggregate` (query.py:71-88) carries ONLY cohort-level fields: `brand_count`, `cohort_label`, `cm2_pct_bp_p50`, `cm3_pct_bp_p50`, `rto_rate_bp_p50`. **No `workspace_id`. No per-brand row. No similarity score.** Confirmed by reading the dataclass.
- The read targets `ai.cross_brand_pattern` (query.py:148-159), NOT `memory.brand_fingerprint`. `workspace_id` is passed for telemetry only and is explicitly NOT in the WHERE clause (query.py:119-121, 156). The RLS-scoped fingerprint table is never touched on the cross-brand path → the P0-leak shape (relax-RLS-then-return-identity) is structurally gone.
- `ai.cross_brand_pattern` has a real storage-layer `CHECK (brand_count >= 5)` (up.sql:155). The table is intentionally NOT RLS-scoped (up.sql:167-171) because it holds no `workspace_id` and no per-brand row — the k-anonymity guarantee is the CHECK, documented in-line. Populated by a SECURITY DEFINER aggregate job (no RLS relaxation needed). Architecturally sound.
- Python defense-in-depth: `brand_count < MIN_K_CROSS_BRAND` → `None` (query.py:187-197). k<5 → EMPTY, never partial-cohort leak.
- **Killed mutant CONFIRMED:** `test_result_has_no_workspace_id_field` (test:123-141) asserts `not hasattr(result, "workspace_id")` with an explicit cross-tenant-leak regression message. `test_k_below_minimum_returns_none` (test:88-100) feeds `brand_count = MIN_K-1` and asserts `None`. Real assertions, not vacuous.

### C5-SEC-002 (was HIGH) — Spotlight fence defeatable → **RESOLVED**

Verified in `src/domain/injection/preprocessor.py` + `tests/unit/test_injection_preprocessor.py`:

- `_escape_fence_sentinels()` (preprocessor.py:128-151) entity-encodes the angle brackets in each known fence-breaking sequence (closing/opening data, prior_agent_output, instruction, system tags). Called on raw text BEFORE fencing in both `spotlight_operator_string` (line 196) and `spotlight_prior_llm_output` (line 242).
- `flagged` is now **LOAD-BEARING**: `render_untrusted_section()` (preprocessor.py:341-348) raises `InjectionFlaggedError` (fail-closed) if ANY block is flagged. Detection runs on raw pre-escape text (line 191) so the suspicious-pattern match is not defeated by escaping.
- **Killed mutant CONFIRMED:** `test_closing_sentinel_escaped_in_operator_string` (test:210-239) feeds an operator string with an embedded closing data sentinel + injected instruction, slices the content region, asserts the raw sentinel is NOT present AND the entity-encoded form IS present. `test_render_raises_on_flagged_block` + `test_inverse_mutant_unflagged_always_renders` use `pytest.raises(InjectionFlaggedError)` — proving the gate is structural, not detect-only. Inverse mutant present.

### C5-SEC-003 (was HIGH, traceability VETO / CF-SEC-5) — correlation quad → **RESOLVED**

Verified across `client.py`, `graduation_middleware.py`, `up.sql`, `tests/unit/test_correlation_traceability.py`:

- `GatewayRequest` carries `request_id` / `trace_id` / `actor_id` (client.py:106-109); `workspace_id` already present → full quad.
- `ai.decision_log` schema has `request_id` / `trace_id` / `actor_id` columns (up.sql:53-55), NOT NULL with safe DEFAULTs, additive/non-breaking.
- BOTH write paths persist the quad: synthesis `_write_decision_log` (client.py:558-576) and dropped-tool `_write_decision_log` in graduation_middleware (lines 241-253) on both DROP paths (scope + graduation), with `request_id` in the warning logs.
- OTel binding (client.py:344-347): caller-supplied `trace_id` wins; else derived from the live span context. Set as span attributes `request_id` + `trace_id` (lines 421-422).
- `request_id` surfaced on errors: Layer-3 cap `RuntimeError` (line 367) and faithfulness `ValueError` (line 499).
- **Audit-write failure now surfaces:** the swallow-`try/except` was removed in client.py's `_write_decision_log` (writer exceptions propagate to `complete()`).
- **Killed mutant CONFIRMED:** `test_killed_mutant_drop_quad_from_request` (test:308-354) asserts the three quad keys in the DL row AND their exact values. `test_failed_dl_write_surfaces_exception` (test:270-293) uses `pytest.raises(IOError, match="Postgres is down")`. Inverse mutant `test_inverse_mutant_missing_quad_fields_undetected_by_vacuous_check` present (proves a `len(rows)==1` check is vacuous; field-level assertions catch it).

---

## 5 VETO gates — regression scan (NOT re-litigated; confirmed unchanged)

| Gate | Status round 2 |
|---|---|
| 1 — @paradigm | NO REGRESSION — `paradigm.py` gate logic unchanged; `test_paradigm` 14/14 PASS |
| 2 — faithfulness | NO REGRESSION — `validator.py`/`extraction.py` unchanged; gate2 suite PASS |
| 3 — Iron-Law executor | NO REGRESSION — executor change is additive (`requested_fraction_bp` default=10_000, integer `// 10_000`, no float); `executed_magnitude_mu` still server-side; magnitude-less WriteToolCall intact. Per-call cap check now NON-VACUOUS (C5-SEC-008 resolved). gate3 suite PASS |
| 4 — graduation | NO REGRESSION — gate logic (RLS read at dispatch, fail-closed `NotImplementedError`) unchanged; only the correlation quad added to kwargs. gate4/5 suite PASS |
| 5 — tool-scope | NO REGRESSION — static `@agent_tools` registry + fail-closed empty-scope unchanged. gate4/5 suite PASS |

---

## Regression scans (always-on)

| Scan | Result |
|---|---|
| Secrets grep (intelligence-service src + migrations) | CLEAN — no hardcoded keys/secrets |
| Direct anthropic SDK (must be gateway/litellm-only) | CLEAN — no `import anthropic`; single `litellm.completion`, guarded behind `_litellm_caller is not None` mock |
| Legacy edits | CLEAN — zero `legacy project/` files staged |
| Live LLM spend | CLEAN — all tests mock-injected; only real-call path is `@pytest.mark.smoke` (skipped in CI) |
| Float money (tools/gateway/faithfulness) | CLEAN — caps/cost/magnitude are BIGINT paise/bp with integer `//`. `extraction.py` `float()` parses text→canonical int (round/int), not money arithmetic — same as round 1, untouched. `confidence: float` is display-only, not routing. |
| Recommendation-only / write fail-closed | CLEAN — executor + graduation prod readers raise `NotImplementedError`; no auto-execute |
| PII in logs (changed files sampled) | CLEAN — preprocessor logs `content_hash` only, never raw operator text; query logs ids only |

---

## Compliance (Brain regime)

| Check | Result |
|---|---|
| DPDP minimization / purpose limitation | PASS — C5-SEC-001 fix removes cross-brand identifiable disclosure; `CrossBrandAggregate` carries no per-brand data. The DPDP minimization concern folded into C5-SEC-001 is resolved with it. |
| DPDP India in-region (ap-south-1) | PASS for build scope — `assert_india_residency()` now wired into `bootstrap.run_startup_assertions()` (C5-SEC-005 resolved); fail-closed on wrong `POSTGRES_REGION`. |
| India telecom (DLT/NCPR/9pm/freq-cap/WhatsApp) | N/A — no outbound channel this child |
| Recording consent | N/A — no capture surface |
| PDPL UAE/KSA | N/A — India-resident 5a surface |
| PCI scope | N/A — no card data |

No telecom/consent violation. No genuine ambiguity requiring `/escalate` to Rohan.

---

## Traceability

PASS — the correlation quad (`request_id` + `trace_id` + `workspace_id` + `actor_id`) is propagated end-to-end into both Decision-Log write paths, the `ai.decision_log` schema, the OTel `gateway.complete` span, and surfaced on error responses. Killed mutant proves it is load-bearing. The round-1 missing-traceability VETO is cleared.

---

## MED / LOW carry-overs (non-blocking tech debt)

- **C5-SEC-004 (MED) — Gate 2 unit-confusion.** Unchanged from round 1. Faithfulness set-compares a flat `frozenset[int]` with no unit tag. Bounded blast radius on read-only narration. Harden before any action path graduates. Carry-over.
- **C5-SEC-006 (MED) — parsed insights un-validated.** `_parse_insights_from_json` returns raw dicts without validating against `InsightItem`/`TypedRecommendation`. Acceptable while read-only; validate before graduation. Carry-over.
- **C5-SEC-005 (MED) — RESOLVED.** Residency assertion now wired into `bootstrap.run_startup_assertions()`. No longer a pre-flip gate.
- **C5-SEC-008 (LOW) — RESOLVED.** Per-call cap check is now non-vacuous via `requested_fraction_bp`; `test_gate3_executor` proves a >100% fraction is rejected.
- **C5-SEC-007 (LOW, hygiene) — STILL PRESENT (unstaged, does not ship).** Duplicate `src/infrastructure/db/migrations/up.sql` diverges from the staged `migrations/postgres/up.sql`. Not staged → does not ship; remove to avoid a split-schema source. Carry-over.
- **C5-SEC-009 (LOW, NEW, migration hygiene) — down.sql omits `ai.cross_brand_pattern`.** `migrations/postgres/down.sql` drops every other Child-5 table but not `ai.cross_brand_pattern` (added in this bounce-fix). The schema-removal at the end has no CASCADE, so a rollback will fail or orphan the table. Not a security finding (the table is anonymized + sound) — migration-reversibility hygiene only. Add the missing table-removal to down.sql. Non-blocking; flag to Vikram for the migration polish pass.

---

## Gate G4 scorecard (round 2)

- [x] Zero CRITICAL — **PASS** (C5-SEC-001 resolved)
- [x] Zero HIGH — **PASS** (C5-SEC-002 + C5-SEC-003 resolved)
- [x] Zero compliance violations — PASS
- [x] Zero missing-traceability — **PASS** (correlation quad end-to-end)
- [x] Every mutation path guarded — PASS (no regression)
- [x] Every MCP/tool tenant-checked + scoped + Decision-Log — PASS (quad now in the row)
- [x] PII not in logs (sampled) — PASS
- [x] Vuln scans CLEAN on CRITICAL/HIGH — PASS
- [x] 5 VETO gates REAL + no regression — PASS

**Result: PASS.** Parallel mode — verdict returned to orchestrator. I do NOT advance. Reconcile with Tanvi (QA) — same finding-severity rubric applied. Two LOW migration-hygiene items (C5-SEC-007, C5-SEC-009) tracked as tech debt for Vikram's migration polish; neither blocks.

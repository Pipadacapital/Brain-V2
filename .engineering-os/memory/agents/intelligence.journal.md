# Intelligence Engineer — Journal

> Append-only. See /Users/rishabhporwal/.claude/plugins/cache/brain-engineering-os-marketplace/brain-engineering-os/0.23.0/docs/role-empowerment-model.md for entry shape.

## 2026-05-25T13:30:00Z — Maya (intelligence-engineer) — feat-ai-engine-intelligence
**Stage:** 3 (Round 2 — Bounce Fix)
**Track:** M (memory/query.py, injection/preprocessor.py, pnl_insight_agent.py)
**Action:** Fixed C5-SEC-001 CRITICAL (memory anonymity), C5-SEC-002 HIGH (spotlight sentinel), C5-SEC-003 HIGH agent-side (correlation quad population)
**Skills loaded:** memory-layer-pgvector, prompt-injection-defense, agentic-design, cost-routing-paradigms
**Paradigm:** sql — all new code paths are pure string manipulation / SQL aggregate query; no LLM calls introduced
**Prompt caching:** NOT_APPLICABLE — no new LLM call paths
**Daily-tick simulation:** PASS — 154/154 tests green; correlation quad defaults to "system" for scheduler path
**Files touched:**
- `apps/intelligence-service/src/domain/memory/query.py` — replaced query_similar_brands with query_cross_brand_cohort + CrossBrandAggregate
- `apps/intelligence-service/src/domain/injection/preprocessor.py` — _escape_fence_sentinels + InjectionFlaggedError + flagged load-bearing
- `apps/intelligence-service/src/domain/agents/pnl_insight_agent.py` — request_id/trace_id/actor_id in _narrate() + generate_insights()
- `apps/intelligence-service/src/application/gateway/client.py` — audit write failure surfaces (not swallowed)
- `apps/intelligence-service/migrations/postgres/up.sql` — ai.cross_brand_pattern table + correlation quad fields on ai.decision_log
- `apps/intelligence-service/tests/unit/test_memory_query.py` — 9 tests covering new aggregate API + anonymity contract
- `apps/intelligence-service/tests/unit/test_injection_preprocessor.py` — +13 new tests: sentinel neutralization + flagged load-bearing
- `apps/intelligence-service/tests/unit/test_gateway_client.py` — +3 tests: correlation quad in Decision-Log row
**Verification:**
- Command: `python3 -m pytest tests/ -v --tb=short`
- Output: `154 passed in 0.08s`
**Key decisions:**
- C5-SEC-001: Reading from `ai.cross_brand_pattern` (pre-aggregated, no workspace_id) rather than `memory.brand_fingerprint` (RLS-scoped) resolves the architectural contradiction without any RLS relaxation. The aggregate job (SECURITY DEFINER) is the write path; the Python layer is read-only. No new memory store — `ai.cross_brand_pattern` is subsystem 3 of the Memory Layer per the memory-layer-pgvector skill.
- C5-SEC-002: Entity-encoding (not stripping) chosen for sentinel escape because it preserves the operator's intent visually (they can still see what they typed in the prompt output) while being structurally harmless. Stripping was the alternative but would silently remove content.
- C5-SEC-003: trace_id derived from the live OTel span at `_narrate()` call time — this ties the Decision-Log row to the telemetry trace without requiring the caller to manage OTel spans.
**Handoff signal:** READY-FOR-SECURITY-ROUND2

## 2026-05-23T12:48:01Z — system — bootstrap
**Action:** Journal initialized by /eos init on 2026-05-23T12:48:01Z.

## 2026-05-24T01:18:46Z — Maya (intelligence-engineer) — spike-legacy-migration-architecture
**Stage:** 2 (co-owner deepening)
**Track:** A1.5 + A5.2 (data/AI-surface mapping + numeric shadow-compare)
**Action:** Deepened Aryan's stubs A1.5 and A5.2 in 06-architecture-plan.md to binding quality; answered all 6 open questions (M-A1-Q1..Q3, M-A5-Q1..Q3); zero A1.1–A1.4 dispositions changed; zero A5.1 rules relaxed.
**Skills loaded:** metric-engine, clickhouse-olap, data-quality, llm-evals, memory-layer-pgvector, decision-log, cost-routing-paradigms, agentic-design, claude-api
**Paradigm:** sql (all signal computation; no LLM in harness or metric materialization) — justified: every metric in workspace_daily_metrics maps to deterministic SQL; ratio metrics use FLOOR(×10000) not ROUND_HALF_EVEN; the only LLM calls in the AI surface are page-level narration (Haiku for 12/13 pages, Sonnet for chat/global only). ~80% of legacy AI surface is actually sql/statistical paradigm.
**Prompt caching:** NOT_APPLICABLE (design-only spike; no LLM calls)
**Daily-tick simulation:** NOT_APPLICABLE (no code)
**Files touched:**
- `.engineering-os/runs/2026-05-24T00-58-39Z__a49c05__spike-legacy-migration-architecture__rishabhporwal/06-architecture-plan.md` (extended A1.5 + A5.2 in place, Maya-authored sections clearly marked)
- `.engineering-os/state/active.json` (.bak.20260524T011846Z written first; maya_deepening_pending→false; status→parallel-review; stage→4; co_owner_stage4→qa-agent)
- `.engineering-os/memory/agents/intelligence.journal.md` (this entry)
- `.engineering-os/decision-log/2026/05/2026-05-24.jsonl` (decision-log entry appended)
- `.engineering-os/runs/.../live.log` (live.log entries appended)
**Verification:**
- Command: `git status --short`
- Output: All modified/untracked files under `.engineering-os/**` ONLY. Legacy project untouched. PASS.
**Key decisions:**
- M-A1-Q1: NO ML required for any metric in workspace_daily_metrics; all sql paradigm.
- M-A1-Q2 (LOAD-BEARING): Parity measured vs Brain's corrected formula; expected definitional deltas (P&L lagged-shipping vs actual-cost CM2) go into Definitional-Delta Register signed off by Rohan before cutover.
- M-A1-Q3: ~80% of AI surface is sql-tier (signals/anomaly/trend/comparator); ~20% is genuine LLM narration (haiku for standard pages, sonnet for chat/global).
- M-A5-Q1: Ratio metrics use FLOOR(×10000), not ROUND_HALF_EVEN; same zero-tolerance compare rule.
- M-A5-Q2: Paise (×100) is the universal canonical unit; 4-decimal sources rounded once at ACL boundary via ROUND_HALF_EVEN; Python must receive Decimal as string not float.
- M-A5-Q3: Connector parity is count-based + spot-check (not numeric shadow); rollback windows: Shopify/Woo 4h, Meta/Google 8h, Klaviyo/Unicommerce 12h, Shiprocket 72h.
- CACHE-PURGE-C4C5 gate: fully specified with 6-step implementation target + facade enforcement predicate.
- ClickHouse shadow DDL: specified with ReplacingMergeTree + partition + sort key; zero Postgres dual-write enforced at DB layer (read-only role for analytics-service Postgres user).
**No plan-amendments raised:** All A5.1 rules feasible within design. Two Child scoping notes surfaced (Definitional-Delta Register as Child 4 deliverable; WorkspaceCost currency-at-entry migration as Child 2 pre-condition).
**Handoff signal:** READY-FOR-PARALLEL-REVIEW (Security/Shreya + QA/Tanvi)

## 2026-05-24T22:45:00Z — Maya (intelligence-engineer) — feat-connector-framework-cutover
**Stage:** 3
**Track:** M (raw event-store schema + consent columns + PII manifest + cursor)
**Action:** Delivered all 5 Track-M tasks: M1 step-a-enable-create.sql (raw tables + consent columns + RLS), M2 step-b-force.sql + down.sql (FORCE + symmetric rollback), M3 pii_manifest.py (PiiManifest instances for 7 vendors + fail-closed check_pii_fields gate), M4 cursor.py (CursorRow contract + UPSERT SQL), M5 forward-binding note in developer report. 40/40 unit tests green.
**Skills loaded:** integration-connectors, sql-query-optimization, data-quality, domain-driven-design, python-services, lifecycle-revenue-layer, india-commerce-economics, verification-before-completion
**Paradigm:** sql — justified: pure deterministic schema + data contract; no ML, no LLM; cost-routing audit clean (zero inference path in raw ingest).
**Prompt caching:** NOT_APPLICABLE (no LLM calls; sql paradigm throughout)
**Daily-tick simulation:** NOT_APPLICABLE (raw ingest DDL + PII contract; no tick path)
**Files touched:**
- `apps/ingestion-service/migrations/manual/raw/step-a-enable-create.sql` (raw tables + consent columns + RLS policies + indexes)
- `apps/ingestion-service/migrations/manual/raw/step-b-force.sql` (FORCE per table, Stage-8 HELD)
- `apps/ingestion-service/migrations/manual/raw/down.sql` (symmetric NO FORCE+DISABLE+DROP POLICY+DROP TABLE)
- `apps/ingestion-service/src/domain/framework/pii_manifest.py` (CF-C3-PII-ADAPTER-GATE-1 + all 7 manifests + check_pii_fields gate)
- `apps/ingestion-service/src/domain/framework/cursor.py` (M4 cursor contract + SQL constants + async helpers)
- `apps/ingestion-service/src/domain/framework/__init__.py` (package exports)
- `apps/ingestion-service/tests/unit/test_pii_manifest.py` (40 tests across 5 test classes)
- `apps/ingestion-service/tests/unit/__init__.py`
- `apps/ingestion-service/tests/__init__.py`
- `apps/ingestion-service/conftest.py` (sys.path setup for src/)
- `.engineering-os/runs/2026-05-24T19-30-00Z__c7fed9__feat-connector-framework-cutover__rishabhporwal/08-developer-report-maya.md`
- `.engineering-os/memory/features/feat-connector-framework-cutover.md` (Stage 3 M entry)
- `.engineering-os/decision-log/2026/05/2026-05-24.jsonl` (stage3-complete entry)
**Verification:**
- Command: `cd apps/ingestion-service && python3 -m pytest tests/unit/test_pii_manifest.py -v`
- Output: `40 passed in 0.02s` — all positive + negative scenarios PASS
**Key decisions:**
- M3: Used Vikram's PiiManifest type from adapter.py (locked P3 interface) rather than defining a second type; pii_manifest.py provides the per-vendor instances + the gate function (no type duplication).
- M1: Raw tables named `raw_*` to avoid collision with the legacy `shopify_orders` etc. in the legacy schema; `connector_cursor` keeps no `raw_` prefix (it's operational, not event data).
- M4: Cursor UPSERT is inside `with_workspace` transaction so cursor never advances past a failed batch (atomicity via Postgres rollback).
- M5: Forward-binding note in developer report + DDL comments: `raw_payload JSONB` preserves the full vendor event for Child-4 materialisation; `lawful_basis`/`purpose_code` column set is the per-purpose retention/erasure scoping boundary Child-4 metric workers must honour.
- No money conversion anywhere in the DDL or Python (raw TEXT/numeric fields with `_raw` suffix).
**Handoff signal:** READY-FOR-SECURITY-AND-QA-PARALLEL-REVIEW

---

## 2026-05-25T07:30:00Z — Maya (intelligence-engineer) — feat-metric-engine-olap-split

**Stage:** 3
**Track:** M (Python registry + 9-field DDR + ClickHouse fixtures + True-CM2 + taxonomy)
**Action:** Built all Track M deliverables for Child 4 (feat-metric-engine-olap-split)
**Skills loaded:** metric-engine, memory-layer-pgvector, cost-routing-paradigms, clickhouse-olap, python-services, engineering-discipline
**Paradigm:** sql — justified: every metric is deterministic integer arithmetic; zero inference path; LLMs never produce a metric number
**Prompt caching:** N/A (no LLM calls in metric path)
**Daily-tick simulation:** N/A (shadow build; no live ClickHouse; fixtures verified locally)
**Files touched:**
- `pylibs/brain_metrics/brain_metrics/registry/__init__.py` (NEW)
- `pylibs/brain_metrics/brain_metrics/registry/definitions.py` (NEW — 25 metrics)
- `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py` (NEW — 9-field DDR, 11 rows)
- `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.md` (NEW — Rohan-signable)
- `pylibs/brain_metrics/brain_metrics/parity/fixtures/clickhouse_roundtrip_fixtures.json` (NEW)
- `pylibs/brain_metrics/brain_metrics/parity/taxonomy.py` (UPDATED — COGS_SETTINGS_CHANGE_DELTA + 6 HarnessReport fields)
- `pylibs/brain_metrics/brain_metrics/parity/harness.py` (UPDATED — DDR hook, input_source)
- `pylibs/brain_metrics/brain_metrics/ratio.py` (UPDATED — N1 docstring cleanup)
- `pylibs/brain_metrics/brain_metrics/__init__.py` (UPDATED — registry + DDR exports)
- `pylibs/brain_metrics/tests/test_registry.py` (NEW — 125 tests)
- `pylibs/brain_metrics/tests/test_definitional_delta_register.py` (NEW — 64 tests)
- `pylibs/brain_metrics/tests/test_clickhouse_roundtrip.py` (NEW — 61 tests)
**Verification:**
- Command: `cd pylibs/brain_metrics && python3 -m pytest tests/ -q`
- Output: 250 passed in 0.07s (baseline was 125; +125 new tests)
**Paradigm on every new code path:** sql — confirmed; all formulas are integer arithmetic; zero float in money/ratio paths
**CF-C4 checklist:**
- CF-C4-DDR-1: 9-field DDR with 11 rows; both structural sign-off rules enforced in DDRRow.assert_signable()
- CF-C4-DDR-TRUE-CM2-1: True-CM2 formula pinned IN FULL; worked example (₹66,200); parity_gap:True; correctness_fixture gate
- CF-C4-DDR-MISC-PRORATE-1: Feb-boundary worked example (35714 vs 33333); adjudication discipline documented
- CF-C4-DDR-GST-TAX-1: total_tax_mu row with child_dependency:child-3-shopify-connector; magnitude 0–2%/5–10%
- CF-C4-DDR-FX-RESTATEMENT-1: FX row with child_dependency + shadow rate 8350 paise/USD (₹83.50)
- CF-C4-RATIO-DIVOP-1: all registry formulas use // (FLOOR); null-guard on all denominators; CH round-trip fixtures with zero-denom kill-test
- CF-C4-PRORATED-DIVOP-1: intDiv(monthly_amount_mu, days_in_month); NEVER hardcoded 30; Feb-boundary exact
- CF-C4-COGS-MV-REFRESH-1: COGS_SETTINGS_CHANGE_DELTA taxonomy (6th category, distinct from EXPECTED_DEFINITIONAL_DELTA); coq-change fixture
- CF-C4-PARITY-SCOPE-1: input_source field on HarnessReport; every run declares source; legacy-sourced GREEN ≠ cutover license
- CF-C4-VERIFY-THE-VERIFIER-1: kill-tests for zero-denom (ch-rt-zero-1), wrong-constant (ch-rt-div-3), parity_gap enforcement
**Child-2 carry-forwards:**
- N1: stale ratio.py "F4 fix (Child 4)" comment block resolved → updated to clean reconciliation note
- F3: HarnessReport now carries expected_definitional_delta hook wired to DDR (was "unpopulated")
**Registry-contract seam with Vikram:** Python definitions.py byte-identity contract ready; clickhouse_sql on every MetricDefinition matches intDiv template from V0; parity_class tags align with TS parity_class from V6
**Handoff signal:** READY-FOR-SECURITY-AND-QA-PARALLEL-REVIEW

## 2026-05-25T09:45:00Z — Maya (intelligence-engineer) — feat-ai-engine-intelligence (Child 5 Track M Closeout)
**Stage:** 3-closeout
**Track:** M (2-test fix + import-path normalization)
**Action:** Fixed 2 failing tests to bring suite from 132/134 to 134/134 PASSED. Fix 1: `src.` vs non-`src.` module identity split caused `@agent_tools` decorator to register into a different `_AGENT_TOOL_SCOPES` dict than the one tests read — resolved by normalizing all intra-service imports to non-`src.` prefix (pythonpath already sets `src` in path). Fix 2: off-by-one assertion index in `test_k_below_minimum_promoted` (`call_args[0][1]` → `call_args[0][2]`; k is position 2 of `fetch(sql, embedding, k)`).
**Skills loaded:** python-services, agentic-design, memory-layer-pgvector, verification-before-completion
**Paradigm:** sql — justified: pure test + import-path fix; zero LLM code path touched
**Prompt caching:** NOT_APPLICABLE (no LLM calls)
**Daily-tick simulation:** NOT_APPLICABLE (test-fix only)
**Files touched:**
- `apps/intelligence-service/src/domain/agents/base.py` (import path: src.application → application)
- `apps/intelligence-service/src/domain/agents/pnl_insight_agent.py` (all src.* intra-service imports → non-src)
- `apps/intelligence-service/tests/unit/test_agent_tool_scope.py` (src.* imports removed; inline src.* import fixed)
- `apps/intelligence-service/tests/unit/test_memory_query.py` (assertion index [1] → [2])
- `.engineering-os/runs/2026-05-24T23-55-52Z__c88096__feat-ai-engine-intelligence__rishabhporwal/08-developer-report-maya.md` (NEW)
- `.engineering-os/decision-log/2026/05/2026-05-25.jsonl` (stage3-complete entry)
- `.engineering-os/memory/agents/intelligence.journal.md` (this entry)
**Verification:**
- Command: `python3 -m pytest tests/ -v --tb=short`
- Output: `134 passed in 0.09s`
- Command: `python3 -m pytest /Users/rishabhporwal/Desktop/Brain/pylibs/brain_cost_router/tests/ -v --tb=short`
- Output: `14 passed in 0.01s` (Track V unchanged)
**Handoff signal:** READY-FOR-SECURITY-AND-QA-PARALLEL-REVIEW

## 2026-05-29T21:30:00Z — Maya (intelligence-engineer) — connector-webhook-intake (BOUNCE-1 Delta Fix)

**Stage:** 3 (DELTA bounce fix — BOUNCE-1 from Tanvi Stage-5 QA)
**Service:** ingestion-service
**Paradigm mix:** sql + io/event-handling (no LLM, no ML; zero marginal cost)
**Parity:** N/A (no metric formula in this slice; sql+io paradigm throughout)

**Decision (A vs B):** Option A — remove the redundant `if secret is None` belt-guard.

**Reasoning:**
The belt-guard at lines 252-263 (old numbering per Shreya's review) was dead code. Proof of exhaustiveness: the bare `except Exception:` catches every Python exception without exception (pun intended). The assignment `secret: str = spec.secret_fn(provider)` lives inside the `try` block body. If any exception fires before or during that assignment, the control flow transfers to one of the three except clauses, all of which `return _make_response(OUTCOME_REJECTED, request_id)` — so execution NEVER reaches the post-try block with `secret` unbound or None. The `if secret is None` guard was therefore structurally unreachable. Keeping unreachable dead code is wrong engineering AND it vacuated Mutation 3 — the belt-guard absorbed the fall-through when the bare except was mutated to `pass`, making the kill test pass for the wrong reason (VERIFY-THE-VERIFIER-1 violation).

**Fix applied:**
- Removed the `secret: str | None = None` pre-initialization before the try.
- Changed `secret: str | None = None` → `secret: str` declared inside the try as `secret: str = spec.secret_fn(provider)`.
- Removed the post-try `if secret is None:` guard block entirely.
- Reinforced the bare `except Exception:` block comment to state it is the load-bearing default-deny catch-all.
- Updated docstrings in the three mutation-3 kill tests to accurately describe the new kill mechanism: with mutation 3 applied (bare except → pass), `secret` is unbound after fall-through, so `spec.verify_fn(raw_body, signature_header_value, secret)` raises `UnboundLocalError` → test goes RED (pytest ERROR).

**Shreya line-ref shift (note for Shreya's awareness):**
Shreya's VERIFY-FIRST-1 evidence in 09-security-review.md cited `'secret is None' belt-guard→REJECT(254)` as one of the default-deny branches. That line no longer exists. The VERIFY-FIRST-1 posture is NOT weakened — the dead-code removal eliminates an unreachable branch and promotes the bare `except Exception:` REJECT to the single, independently testable load-bearing default-deny for unexpected exceptions. The other three REJECT paths (unknown vendor, missing sig, AppSecretUnavailableError, HeldAppSecretError) are all unchanged.

**Mutation-3 RED proof (captured output):**
```
FAILED tests/unit/test_webhook_servicer.py::TestVerifyFirstStateMachine::test_unexpected_exception_from_secret_rejected
FAILED tests/unit/test_webhook_servicer.py::TestKillMutations::test_mutation_3_unexpected_exception_rejects_not_accepts
2 failed, 64 passed in 0.10s
```
Error: `UnboundLocalError: cannot access local variable 'secret' where it is not associated with a value` at `webhook_servicer.py:252` (`spec.verify_fn(raw_body, signature_header_value, secret)`).

**All-5-mutations re-run results (each RED, each reverted clean):**
| # | Mutation | Result | Failures |
|---|----------|--------|----------|
| 1 | `verify_fn` → always True | RED | 9 failed |
| 2 | identity resolver before verify | RED | 2 failed |
| 3 | `except Exception:` REJECT → `pass` | RED | 2 failed (UnboundLocalError) |
| 4 | anchor → body hash | RED | 1 failed |
| 5 | `_get_registry` hardcode Shopify | RED | 5 failed |

**Final full suite (all mutations reverted):** `329 passed, 14 skipped in 0.95s` — green.

**Files touched:**
- `apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py` — removed `secret: str | None = None` pre-init + `if secret is None` belt-guard block; tightened exception-block comment; changed `secret` annotation to `str` inside try
- `apps/ingestion-service/tests/unit/test_webhook_servicer.py` — updated docstrings for the 3 mutation-3 kill tests to accurately describe the new kill mechanism

**Verification:**
- Command: `uv run --no-sync --project apps/ingestion-service pytest apps/ingestion-service/tests/ -q`
- Output: `329 passed, 14 skipped in 0.95s`

**Next:** READY-FOR-TANVI-DELTA-REVIEW

## 2026-05-25T08:30:00Z — Maya (intelligence-engineer) — feat-metric-engine-olap-split (Bounce-Fix Part 1)
**Stage:** 3-bounce-fix
**Track:** M (metric registry canon lock)
**Action:** Resolved Shreya H-1 BOUNCE — locked ONE canonical formula for each of the 4 divergent Brain-native decision metrics; verified Python registry + DDR already canonical; added test_locked_canon.py (41 tests); produced LOCKED CANON FORMULA TABLE for Vikram Part 2 alignment.
**Skills loaded:** metric-engine, cost-routing-paradigms, python-services, verification-before-completion
**Paradigm:** sql — justified: pure integer arithmetic formula verification; no LLM, no float, no ML
**Prompt caching:** NOT_APPLICABLE (no LLM calls)
**Daily-tick simulation:** NOT_APPLICABLE (registry definitions only)
**Files touched:**
- `pylibs/brain_metrics/tests/test_locked_canon.py` (NEW — 41 locked canon tests)
- `.engineering-os/runs/2026-05-24T22-25-29Z__0e76f7__feat-metric-engine-olap-split__rishabhporwal/08b-bounce-fix-report-maya.md` (NEW — report with LOCKED CANON FORMULA TABLE)
- `.engineering-os/decision-log/2026/05/2026-05-24.jsonl` (appended bounce-fix entry)
- `.engineering-os/memory/agents/intelligence.journal.md` (this entry)
**Verification:**
- Command: `cd pylibs/brain_metrics && python3 -m pytest tests/ -q`
- Output: 291 passed in 0.07s (was 250; +41 new locked canon tests; 0 failed)
**Divergences resolved:**
- true_cm2_mu: cost-base-proportional formula (CANONICAL) vs flat-per-order (TS WRONG)
- pamer_bp: CM2/ad_spend (CANONICAL) vs ad_spend/net_revenue reciprocal (TS WRONG)
- amer_bp: TrueCM2/ad_spend (CANONICAL) vs ad_spend/gross_sales (TS WRONG, different metric)
- ltv_cac_bp: id=ltv_cac_bp, unit=bp, scale=×10000 (CANONICAL) vs id=ltv_cac_x100, unit=x100, scale=×100 (TS WRONG)
**What was NOT changed:** definitions.py (already canonical), definitional_delta_register.py (already canonical)
**What was NOT touched:** packages/lib-metrics/src/registry/definitions.ts (Vikram lane), tools/check-metrics-parity.sh (Vikram lane)
**Handoff signal:** READY-FOR-VIKRAM-PART-2 (TS alignment + real parity gate + killed mutant)

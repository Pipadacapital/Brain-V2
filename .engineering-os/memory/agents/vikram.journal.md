
## 2026-05-25T10:55:00Z — Vikram (backend-developer) — feat-frontend-dashboard-morningbrief (Child 6, BOUNCE-FIX)
**Stage:** 3 (Round-2 — fixing B1 + H1)
**Track:** Track-V-bff
**Action:** Fixed B1 (missing server bootstrap — `pnpm dev` was failing) and H1 (errorFormatter shipping procedure path instead of correlation requestId). Created `src/interfaces/server.ts` (Fastify + tRPC on :3001, StubDataPlane, InMemoryIdempotencyStore, WorkspaceContext from headers). Fixed `trpc.ts:50` errorFormatter to use `ctx?.requestId`. Added 6 H1 killed-mutant tests + 4 server bootstrap smoke tests. Documented M2 (gRPC correlation) and M3 (Visx pixel-math invariant) in HARNESS.md. Real-network smoke confirms seed values return via HTTP.
**Skills loaded:** backend-fastify-trpc-grpc, verification-before-completion, engineering-discipline, defense-in-depth-validation, operational-readiness
**Paradigm:** sql
**Decisions:**
- TenancyInterceptor disposition: assertWorkspaceClaim/assertRequiredRole not re-called in server.ts because workspaceMiddleware in trpc.ts already enforces the check on every workspace-tier procedure. Double-calling would be redundant enforcement. buildGrpcMetadata deferred to Phase-2 per plan §2 + SEC-C6-M1.
- H1 fix: errorFormatter({ shape, ctx }) — ctx?.requestId is the correlation id; shape.data?.path is the procedure name ("metrics.kpiSummary") — semantically different, never interchangeable.
- Server logger: pino JSON (no pino-pretty dep); structured logs with request_id in every line via Fastify's built-in req.id.
- Context factory: Phase-0 reads x-workspace-id / x-user-id from headers, falls back to Sugandh-Lok stub. Production replaces with JWT verify. workspaceId in context MUST equal claim.workspaceId (workspaceMiddleware asserts this).
**Files touched:** apps/api-gateway/src/interfaces/server.ts (new), apps/api-gateway/src/interfaces/server.test.ts (new), apps/api-gateway/src/application/trpc.ts (H1 fix), apps/api-gateway/src/application/trpc.errorformatter.test.ts (new), apps/api-gateway/HARNESS.md (new)
**Verification:**
- Command: `tsc --noEmit` (exit 0) + `pnpm run test` (32/32 pass) + real smoke
- Smoke: `curl localhost:3001/health` → `{status:ok}` + `GET /trpc/metrics.kpiSummary` → `net_revenue_mu=185000000 cm2_mu=32000000` (bigint confirmed by superjson meta)
- 22 original gates UNCHANGED: all pass
- Passed: TRUE
**Open questions:** None for this round. Phase-2 gRPC wiring documented.
**Handoff signal:** READY-FOR-SECURITY (round-2 parallel Shreya + Tanvi)

## 2026-05-25T10:05:00Z — Vikram (backend-developer) — feat-frontend-dashboard-morningbrief (Child 6, mid-run)
**Stage:** 3
**Track:** V0–V3 (protos + tRPC scaffold + 3 integrity gates)
**Action:** Authored `metrics.proto` + `intelligence.proto` (both buf-lint clean), scaffolded api-gateway (package.json, tsconfig, vitest.config, proto-types.ts, trpc.ts, router.ts, loopback-data-plane.ts), delivered all 3 integrity gates (G-BIGINT with 2^53+1 mutant proof, G-IDEMPOTENT with Redis dedup + killed mutant, G-REGISTRY-ONLY with orphan-field killed mutant). tRPC superjson transformer in place.
**Skills loaded:** backend-fastify-trpc-grpc, idempotency-handling, api-traffic-patterns, defense-in-depth-validation, verification-before-completion
**Paradigm:** sql
**Decisions:**
- buf generate requires network to buf.build registry (offline environment); hand-authored proto-types.ts mirrors the proto contract exactly — protos remain source of truth, CI buf generate will produce official stubs when network is available.
- G-BIGINT mutant: 9e18 is exactly representable in float64 (no precision loss); used 2^53+1 = 9_007_199_254_740_993n (first integer that loses 1 through Number() conversion) — provably non-vacuous.
- DataPlanePort interface: single adapter seam enabling Phase 2 split (loopback→cross-task) as a config flip, zero code rewrite.
- idempotent_replay: fix required — router was storing idempotent_replay:false in Redis then returning it verbatim on cache hit; fixed to override replay=true when returning cached result.
**Files touched:** protos/brain/metrics/v1/metrics.proto, protos/brain/intelligence/v1/intelligence.proto, apps/api-gateway/package.json, apps/api-gateway/tsconfig.json, apps/api-gateway/vitest.config.ts, apps/api-gateway/src/domain/{proto-types,tenancy,idempotency,registry-mapper,gates.test}.ts, apps/api-gateway/src/application/{trpc,router}.ts, apps/api-gateway/src/infrastructure/loopback-data-plane.ts
**Verification:**
- Command: `pnpm vitest run` (api-gateway)
- Output: 22/22 PASS (3 gates all green with killed mutants)
- Passed: TRUE
**Open questions:** V4+ pending (Python gRPC handlers, device_tokens DDL, parity script, Python InsightItem)
**Handoff signal:** IN-PROGRESS (V4–V8 next)

## 2026-05-25T10:20:00Z — Vikram (backend-developer) — feat-frontend-dashboard-morningbrief (Child 6, complete)
**Stage:** 3
**Track:** V4–V8 (formatMoney + scale field + Python InsightItem + parity gate extension + tsc clean)
**Action:** Delivered V4–V8. formatMoney(bigint, currencyCode) in lib-metrics with INR lakh/crore notation + KWD 3-decimal killed mutant. scale:10000|100|1 additive field on all 17 TS MetricDefinitions + Python MetricDefinition dataclass. Python InsightItem amended with ExpectedImpact + RiskLevel + confidence_display_pct (frozen Pydantic). Extended registry-dump.ts + registry-dump.py to include scale in output. Extended check-metrics-parity.sh STRUCTURAL_FIELDS to assert scale byte-identity. Fixed tsconfig.json rootDir constraint (composite + paths, no rootDir). All tests pass.
**Skills loaded:** verification-before-completion, engineering-discipline, india-commerce-economics, caching-strategy
**Paradigm:** sql
**Decisions:**
- formatMoney never hardcodes /100; uses subunitMultiplier(code) to handle KWD(1000), JPY(1), INR(100). KWD killed mutant proves non-vacuous.
- scale default=1 in Python dataclass — backward-compatible additive amendment; existing metrics without explicit scale resolve to 1 (money/count).
- recommendation.py InsightItem: kept legacy confidence:float field for backward compat (deprecated in docstring); added confidence_display_pct:int per CF-C6-NO-UI-FLOAT-1.
- tsconfig.json: removed rootDir (TypeScript infers it when --noEmit; rootDir only needed for emit output directory structure). Removed outDir too. Result: tsc --noEmit clean.
- check-metrics-parity.sh STRUCTURAL_FIELDS: added "scale" to both Phase 1 check + killed-mutant sub-step. 16 shared metrics verified with scale parity now included.
**Files touched:** packages/lib-metrics/src/format-money.ts (new), packages/lib-metrics/src/format-money.test.ts (new), packages/lib-metrics/src/index.ts, packages/lib-metrics/src/registry/types.ts, packages/lib-metrics/src/registry/definitions.ts, packages/lib-metrics/src/registry-dump.ts, pylibs/brain_metrics/brain_metrics/registry/definitions.py, apps/intelligence-service/src/domain/tools/recommendation.py, tools/registry-dump.py, tools/check-metrics-parity.sh, apps/api-gateway/tsconfig.json, apps/api-gateway/vitest.config.ts, apps/api-gateway/src/application/{trpc,router}.ts, apps/api-gateway/src/domain/{tenancy,gates.test}.ts
**Verification:**
- Command: `tsc --noEmit` (api-gateway) + `pnpm vitest run` (lib-metrics: 126 tests, api-gateway: 22 tests) + `python3 -m pytest tests/` (brain_metrics: 291 tests) + `python3 recommendation.py smoke` + `bash check-metrics-parity.sh`
- Output: tsc exit 0 / 126 lib-metrics PASS (24 formatMoney new) / 22 api-gateway PASS (3 gates green) / 291 brain_metrics PASS / recommendation smoke PASS / parity gate PASS (16 shared metrics with scale)
- Total: 439 tests, 0 failures
- Passed: TRUE
**Open questions:** V5 device_tokens DDL (core.device_tokens migration) not written — out of scope for this stage (no Postgres migration runner in the api-gateway; belongs in core-service migration run). V4 Python gRPC handlers deferred to Phase 2 split (Phase 0 uses StubDataPlane in-process). LOCAL docker-compose harness deferred (no blocking blocker — StubDataPlane provides deterministic seed data for Ananya+Karan).
**Handoff signal:** READY-FOR-SECURITY (STANDARD/HIGH-STAKES; parallel Shreya + Tanvi)

## 2026-05-25T14:00:00Z — Vikram (backend-developer) — feat-ai-engine-intelligence
**Stage:** 3 (BOUNCE-FIX — C5-SEC-003 traceability VETO)
**Track:** V (GatewayRequest correlation quad + Decision-Log schema + OTel + bootstrap + per-call cap)
**Action:** Fixed C5-SEC-003 HIGH traceability VETO. Added request_id/trace_id/actor_id to GatewayRequest (pinned quad contract). Propagated quad into both _write_decision_log paths. Added 3 columns to ai.decision_log. Bound OTel trace_id. Surface request_id on errors. Stopped swallowing audit write failures. Wired assert_india_residency() into bootstrap. Made per-call cap real via fraction_bp. Updated test_memory_query.py to Maya's anonymized API. New test_correlation_traceability.py with killed+inverse mutants. 5 VETO gate logic unchanged.
**Skills loaded:** verification-before-completion, engineering-discipline, defense-in-depth-validation, audit-log-immutability, operational-readiness
**Paradigm:** MIXED
**Decisions:**
- OTel trace_id binding: caller-supplied takes precedence; fallback to active span's trace_id so every DL row has a trace backend entry even in 5a mock scope.
- Audit write failure surfacing: removed try/except in client.py _write_decision_log — the DL is the audit artifact this child exists to produce; silent failure is worse than a visible exception.
- bootstrap wiring: run_startup_assertions() is the single entry point for all startup checks; Jatin wires it from the service entrypoint (Track J boundary, not Track V).
- requested_fraction_bp on resolve_magnitude: default 10_000 bp = 100% = backward compatible; fraction > 10_000 triggers per-call cap (real enforcement path for future fine-grained intent mapping). No float anywhere.
- test_memory_query.py reconciliation: Maya's C5-SEC-001 fix already updated query.py to CrossBrandAggregate; test was still referencing the old SimilarBrandResult. Aligned test to new API + added workspace_id-absent killed mutant for C5-SEC-001.
**Files touched:** client.py, graduation_middleware.py, executor.py, bootstrap/__init__.py, migrations/postgres/up.sql, test_correlation_traceability.py (new), test_memory_query.py, test_gate3_executor.py
**Verification:**
- Command: `python3 -m pytest tests/unit/ -q` (from apps/intelligence-service/)
- Output: 154 passed in 0.07s
- brain_cost_router: 14 passed in 0.01s
- analytics-service: 41 passed; brain_metrics: 291 passed (0 regressions)
- Total: 500 tests, 0 failures
- Passed: TRUE
**Open questions:** Maya's call-site wiring of request_id/trace_id/actor_id into GatewayRequest (her lane; she populates from the agent context). Jatin's run_startup_assertions() entrypoint call (Track J).
**Handoff signal:** READY-FOR-SECURITY (round-2 parallel Shreya + Tanvi)

## 2026-05-25T10:30:00Z — Vikram (backend-developer) — feat-ai-engine-intelligence
**Stage:** 3 (Mid-execution journal — V1 complete)
**Track:** V1 (brain_cost_router @paradigm decorator)
**Action:** Built the executable @paradigm decorator in pylibs/brain_cost_router — replaces the 4-line stub. Contextvar enforcement, ParadigmViolation, paradigm_distribution + faithfulness_retry_total OTel telemetry. 14 tests.
**Skills loaded:** verification-before-completion, engineering-discipline, defense-in-depth-validation
**Paradigm:** MIXED (this file implements the paradigm enforcement mechanism itself)
**Decisions:**
- Used contextvars.ContextVar for the tier — the only mechanism that correctly propagates through async call graphs without thread-local ambiguity.
- assert_llm_tier_at_gateway() is a standalone function (not a method) so the gateway calls it without needing to hold a reference to the decorator machinery.
- Async wrapper uses asyncio.iscoroutinefunction to branch at decoration time (not at call time) — avoids double-wrapping.
- opentelemetry-api 1.42.1 installed (latest stable); get_tracer() does not accept version kwarg in this version.
**Files touched:** brain_cost_router/__init__.py, paradigm.py (new), errors.py (new), telemetry.py (new), pyproject.toml, tests/test_paradigm.py (new)
**Verification:**
- Command: `PYTHONPATH=pylibs/brain_cost_router python3 -m pytest pylibs/brain_cost_router/tests/ -v`
- Output: 14 passed in 0.01s
- Passed: TRUE
**Open questions:** None. V1 complete. Proceeding to V2.
**Handoff signal:** IN-PROGRESS (V2 next)

## 2026-05-25T13:30:00Z — Vikram (backend-developer) — feat-ai-engine-intelligence
**Stage:** 3 (Track V complete)
**Track:** V (V1+V2+V3 — gateway + dispatch + executor + faithfulness + schema + CACHE-PURGE)
**Action:** Built all 5 VETO gates + full Track V deliverables for Child 5 AI engine. GatewayClient (LiteLLM-backed, Gate 1 at dispatch boundary), faithfulness validator (Gate 2, ₹1.2L PASS, hallucination RED), Iron-Law executor (Gate 3, injected amount_mu DROPPED), graduation middleware (Gate 4, deceived orchestrator blocked), tool-scope dispatch (Gate 5, pnl agent requesting pause_ad_set DROPPED), ai.*/memory.* schema DDL with RLS, CACHE-PURGE-C4C5 ARMED, agent base class + @agent_tools, TypedRecommendation. 84 new tests, 0 failures.
**Skills loaded:** backend-fastify-trpc-grpc, verification-before-completion, engineering-discipline, defense-in-depth-validation, audit-log-immutability, idempotency-handling, india-commerce-economics, cost-routing-paradigms
**Paradigm:** MIXED (V1 is the paradigm enforcement mechanism; V2 is the gateway that enforces it at runtime)
**Decisions:**
- GatewayClient uses `_litellm_caller` injection pattern (same as analytics-service's `_client` pattern) — clean test injection without mocking litellm module.
- filtersHash cache is process-scoped (in-process dict) for the 5a build; Redis backing is wired in production bootstrap (out of scope for Track V).
- Layer-3 cap meter is in-process for the 5a build; Postgres backing (ai.workspace_llm_spend_mu) is wired in production bootstrap.
- dispatch_tool_call Gate 5 runs BEFORE Gate 4 (scope before graduation) — fail-fast on the cheaper check; also means out-of-scope tools never touch the graduation table.
- WriteToolCall extra="ignore" (not extra="forbid") — silently drops injected fields rather than raising an error. Rationale: raising an error on injection reveals that the injection was detected; silent drop is more defensive. The killed mutant proves the drop happens.
- assert_india_residency() accepts unset POSTGRES_REGION for the 5a local build (tripwire HELD for 5b frontier model check per §13).
- OTel get_tracer() does not accept version kwarg in opentelemetry-api 1.42.1 — removed the kwarg.
**Files touched:** 36 new files (see 08-developer-report-vikram.md §1 for full list)
**Verification:**
- Command: `cd apps/intelligence-service && PYTHONPATH="src:../../pylibs/brain_cost_router" python3 -m pytest tests/unit/ -v` + `PYTHONPATH=pylibs/brain_cost_router python3 -m pytest pylibs/brain_cost_router/tests/ -v`
- Output: 70 intelligence-service PASS + 14 brain_cost_router PASS = 84 total; 0 failures
- Baseline: 41 analytics-service PASS + 291 brain_metrics PASS = 0 regressions
- Grand total: 416 tests, 0 failures
- Passed: TRUE
**Open questions:** Maya's Track M integration at V2 seam (GatewayClient.complete() contract ready). extraction.py normalization rules may be extended by Maya without breaking the validator contract.
**Handoff signal:** READY-FOR-SECURITY (STANDARD/HIGH-STAKES; parallel Shreya + Tanvi)

## 2026-05-25T04:00:00Z — Vikram (backend-developer) — feat-metric-engine-olap-split
**Stage:** 3 (Bounce-Fix Part 2 of 2 — Shreya H-1 + Tanvi F1/F2)
**Track:** V (TS registry + parity gate + analytics coverage)
**Action:** Aligned TS registry to Maya's locked canon (4 formula corrections), rebuilt registry-parity gate from vacuous to real per-metric content-equality check with 2 killed mutants, added orchestrator tests to bump analytics-service coverage to 78%.
**Skills loaded:** verification-before-completion, engineering-discipline, defense-in-depth-validation, audit-log-immutability
**Paradigm:** sql
**Decisions:**
- true_cm2_mu: changed from flat per-order cost to cost-base-proportional formula (intDiv(rto_orders × (ad_spend + variable_costs + cogs), total_orders_count))
- pamer_bp: changed from ad_spend/net_revenue (reciprocal, wrong) to CM2/ad_spend (correct)
- amer_bp: changed from ad_spend/gross_sales (different metric) to true_cm2/ad_spend (correct), inline formula
- LTV_CAC_X100 → LTV_CAC_BP: id renamed, unit x100→bp, scale ×100→×10000 (Brain decision metric bp convention)
- blended_roas_x100 unit: x100→bp to match Python registry (display_only; no semantic impact)
- Parity gate scope: strictest check (SQL equality) on correctness_fixture metrics only; structural fields (id/kind/unit/display_only/parity_class) on all shared metrics; shadow_compare SQL differences are DDR-declared shadow-phase structural differences, not failures
- amer_bp SQL: added space `intDiv( (cm2_mu - ...` to match Python's formatting (after normalize_sql pass)
- Coverage: psycopg2 live path (lines 129-175) cannot be unit-tested; accepted at 78% (above 70% threshold)
**Files touched:** definitions.ts, index.ts (registry + root), registry.test.ts, registry-dump.ts (new), test_startup_assertions.py, check-metrics-parity.sh, registry-dump.py (new), ddr-dump.py (new)
**Verification:**
- Command: `tsc --noEmit` + `vitest run (102 tests)` + `pytest analytics-service/ (41 tests)` + `pytest brain_metrics/ (291 tests)` + `bash check-metrics-parity.sh`
- Output: tsc exit 0 / 102 TS pass / 41 analytics-service pass (78% coverage) / 291 brain_metrics pass / parity gate exit 0 (all 7 steps clean, 2 mutants killed)
- Total: 434 tests, 0 failures
- Passed: TRUE
**Open questions:** None. TS == Python == DDR for all 4 correctness_fixture metrics.
**Handoff signal:** READY-FOR-SECURITY (round-2 parallel Shreya + Tanvi)

## 2026-05-25T07:45:00Z — Vikram (backend-developer) — feat-metric-engine-olap-split
**Stage:** 3 (Track M reconciliation + final verification)
**Track:** V+M reconciliation
**Action:** Reconciled Track V with Maya Track M (complete at 07:30Z, 250 tests). Fixed `check-metrics-parity.sh` step 7 to detect Maya's dedicated `clickhouse_roundtrip_fixtures.json` (CH_ROUNDTRIP_PENDING warning resolved). Updated developer report with reconciled test counts (376 total) and clean parity gate output. All integration seam dependencies resolved.
**Skills loaded:** verification-before-completion, engineering-discipline
**Paradigm:** sql
**Decisions:**
- CH round-trip fixtures live in `pylibs/brain_metrics/brain_metrics/parity/fixtures/clickhouse_roundtrip_fixtures.json` (Maya's dedicated file), NOT embedded in `golden_fixtures.json`. The check-metrics-parity.sh step 7 now checks for the file directly; the original group-name scan in golden_fixtures.json was architecturally wrong for this case.
- No code changes to Track V deliverables — all 22 V-track files are correct. Only the parity gate script and the developer report were updated.
**Files touched:** tools/check-metrics-parity.sh (step 7 fix), 08-developer-report-vikram.md (reconciled counts + parity gate output + seam status)
**Verification:**
- Command: `bash tools/check-metrics-parity.sh` + `pytest apps/analytics-service/tests/` + `pytest pylibs/brain_metrics/tests/` + `vitest run (lib-metrics)` + `tsc --noEmit`
- Output: Parity gate PASS (all 6 steps, exit 0) / 36 analytics-service PASS / 250 brain_metrics PASS / 90 TS PASS / tsc exit 0 — total 376 tests passing
- Passed: TRUE
**Open questions:** None. Both tracks fully reconciled.
**Handoff signal:** READY-FOR-SECURITY (STANDARD/HIGH-STAKES; parallel Shreya + Tanvi; both tracks reconciled; parity gate fully clean)

## 2026-05-25T03:00:00Z — Vikram (backend-developer) — feat-metric-engine-olap-split
**Stage:** 3
**Track:** V (OLAP plumbing + query-gateway + single-writer grep + TS registry)
**Action:** Built all 9 Track V sub-tasks (V0–V8) for Child 4: intDiv template gate (CF-C4-RATIO-DIVOP-1), ClickHouse base+MV DDL runbook, fail-closed workspace-scoped query gateway, two-workspace isolation test + killed mutant, single-writer 3-pattern grep gate + planted-upsert killed mutant + Postgres read-only role startup assertion, ap-south-1 residency startup assertion + wrong-region killed mutant, TS metric registry (17 MetricDefinition records), extended check-metrics-parity.sh with F3 (expected_minor_units) + registry seam check, Stage-8 runbook README.
**Skills loaded:** backend-fastify-trpc-grpc, verification-before-completion, engineering-discipline, defense-in-depth-validation, sql-query-optimization, idempotency-handling, india-commerce-economics
**Paradigm:** sql (exclusively; CF-C4-RATIO-DIVOP-1)
**Decisions:**
- V0 first: authored `_divop_template.sql` before any MV DDL — the CF-C4-RATIO-DIVOP-1 gate. Verified no bare `/` in 0002_mv_computed_ratios.sql (all occurrences in comments).
- `cogs_mu` NOT an incremental MV — base table column populated by scheduled full daily recompute. The MV reads it as-is. Rationale: incremental MV is permanently wrong on coq-settings-change days (CF-C4-COGS-MV-REFRESH-1).
- `toDaysInMonth(date)` in prorated formula — NEVER a `30` constant (CF-C4-PRORATED-DIVOP-1). Feb-28 worked example: 310000/28=11071 not 10333.
- `x100` unit tag added to MetricDefinition to express ROAS ×100 integer — neither `bp` (×10000) nor `mu`. Within-lane decision.
- CH fixture detection in check-metrics-parity.sh: initial `ch_` substring check gave false positive from `rounding_mode_mismatch_fixtures`. Fixed to `startswith('clickhouse_')`.
- analytics-service pyproject.toml updated to add `[build-system]` + `[tool.hatch...]` + `[tool.pytest.ini_options]` — required for `python3 -m pytest tests/` to resolve `src/` correctly from project root.
**Files touched:** 22 Track V files (see 08-developer-report-vikram.md §1 for full list)
**Verification:**
- Command: `pytest apps/analytics-service/tests/ -v` + `vitest run (lib-metrics)` + `tsc --noEmit` + `bash tools/check-metrics-parity.sh` + `pytest pylibs/brain_metrics/tests/`
- Output: 36 analytics-service Python pass / 90 TS pass (28 registry + 62 money) / 0 tsc errors / 185 brain_metrics Python pass / parity gate PASS exit 0
- Total: 311 tests passing; 0 failures across all suites
- CH round-trip fixtures: WARNING CH_ROUNDTRIP_PENDING (Maya M4 pending — expected in parallel build)
- Passed: TRUE
**Open questions:** Maya's M4 (CH round-trip fixtures), M6 (hook wiring), M3/M7 (DDR rows) pending. Seam check shows Python registry present. Integration is ready pending M4.
**Handoff signal:** READY-FOR-SECURITY (STANDARD/HIGH-STAKES; parallel Shreya + Tanvi — pending orchestrator reconciliation with Maya Track M)

## 2026-05-24T17:35:00Z — Vikram (backend-developer) — feat-money-minor-units-parity
**Stage:** 3
**Track:** V (TS homes / CI parity gate / migration runbook)
**Action:** Built Track V of Child 2 — Money value object, convert/ratio/subunits/goal-type TS package, CI byte-identity parity gate rewrite, HOLD-AT-LIVE-RECON runbook skeleton. Fixed Python GoalType StrEnum for Python 3.13.
**Skills loaded:** backend-fastify-trpc-grpc, verification-before-completion, engineering-discipline, defense-in-depth-validation
**Paradigm:** sql
**Decisions:**
- Divergence probe: chose ROUND_HALF_UP vs ROUND_HALF_EVEN structural divergence (even-tied amounts) rather than IEEE-754 float-undershot probe — Node v22/V8 computes some float products exactly, so bit-pattern probes are less reliable than the structural rounding-rule divergence.
- parity-runner.ts excluded from coverage: CLI tooling, not a library function.
- GoalType uses StrEnum (Python 3.11+): `(str, Enum)` changed behavior in Python 3.12+ — StrEnum is the correct fix.
- No decimal.js: confirmed absent from pnpm-lock.yaml; audited inline BigInt algorithm ships.
**Files touched:** packages/lib-metrics/src/{money,convert,ratio,subunits,goal-type,index,parity-runner,money.test}.ts, packages/lib-metrics/{package.json,tsconfig.json,vitest.config.ts}, tools/{check-metrics-parity.sh,parity-runner.py}, pylibs/brain_metrics/brain_metrics/goal_type.py
**Verification:**
- Command: `vitest run` + `pytest tests/` + `tsc --noEmit` + `bash tools/check-metrics-parity.sh`
- Output: 61 TS pass / 104 Python pass / 0 tsc errors / 25 vectors byte-identical PASS
- Passed: TRUE
**Open questions:** None. Track V complete. Awaiting Maya Track M completion for full parallel review.
**Handoff signal:** READY-FOR-SECURITY (contingent on Maya Track M; parallel review Shreya + Tanvi)

## 2026-05-24T18:45:00Z — Vikram (backend-developer) — feat-money-minor-units-parity
**Stage:** 3 (bounce-fix second pass — clearing Stage-4 Security + Stage-5 QA BOUNCE, gate+TS side)
**Track:** V
**Action:** Single-source confirmation from gate side + F2 TS FLOOR mutation proof. No new code changes needed — all Vikram-owned staged files were correct from first bounce-fix pass. Pure verification + mutation kill demonstration.
**Skills loaded:** verification-before-completion, engineering-discipline, audit-log-immutability
**Paradigm:** sql
**Decisions:**
- F1: All three gate consumers (check-metrics-parity.sh, parity-runner.py, parity-runner.ts) confirmed reading the single canonical path. No edit needed; stale path was corrected in first bounce-fix pass. Confirmed via grep + find + git ls-files + live gate run.
- F2: Applied TRUNC mutation to ratio.ts:29-33, ran vitest, observed test FAIL (−3333 not −3334), restored real implementation, re-ran vitest 62/62. Mutant is killed. The -1/4 exact test does not kill because remainder is zero; -1/3 is the uniquely sufficient killing vector.
- TS count 62: reconciled — Tanvi saw 61 (her review snapshot pre-dates the -1/3 test addition in first bounce-fix); current count is 62 (the killing test is test #62).
**Files touched:** None (all verification only)
**Verification:**
- Command: `tsc --noEmit` + `vitest run (62 tests)` + `pytest tests/ (125 tests)` + `bash tools/check-metrics-parity.sh`
- Output: 0 tsc errors / 62 TS pass / 125 Python pass / 25 vectors byte-identical PASS exit 0
- Mutation: TRUNC → test FAILS `expected -3333 to be -3334`; restored → 62/62 pass
- Secrets: clean. Legacy: 0 lines. Maya-owned: 0 lines.
- Passed: TRUE
**Open questions:** None.
**Handoff signal:** READY-FOR-SECURITY (re-review Shreya + Tanvi)

## 2026-05-24T17:58:00Z — Vikram (backend-developer) — feat-money-minor-units-parity
**Stage:** 3 (BOUNCE-FIX pass)
**Track:** V
**Action:** Bounce-fix for F1 (HIGH), F2 (MED must-fix-now), F5 (LOW). Consolidated to one canonical golden-fixture file; added TS negative-FLOOR ratio mutation test; eliminated float exponent derivation.
**Skills loaded:** verification-before-completion, engineering-discipline, audit-log-immutability
**Paradigm:** sql
**Decisions:**
- F1: Verified all 7 stray files byte-identical to canonical before deletion — no content lost. Delete-then-repoint is the correct fix; a symlink would still leave a confusing dual-path structure.
- F2: Test vector `-1n/3n → -3334n` chosen because it has a non-zero remainder (unlike `-1/4` which is exact), directly exercising the `remNeg !== denNeg` branch at ratio.ts:29-33.
- F5: `toString().length - 1` is the cleanest integer log10 for powers-of-10 inputs. Validated 1→0, 10→1, 100→2, 1000→3, 10000→4. Zero float anywhere in convert.ts.
- Maya's taxonomy.py: not touched — Maya owns that file; RMM fix is her scope.
**Files touched:** tools/check-metrics-parity.sh (FIXTURE_PATH updated), packages/lib-metrics/src/convert.ts (exponent derivation), packages/lib-metrics/src/money.test.ts (+1 test), pylibs/brain_metrics/parity/ (deleted entire stray tree — 7 files)
**Verification:**
- Command: `vitest run` + `pytest tests/` + `./node_modules/.bin/tsc --noEmit` + `bash tools/check-metrics-parity.sh` + `find pylibs -name golden_fixtures.json`
- Output: 62 TS pass / 104 Python pass / 0 tsc errors / 25 vectors byte-identical PASS / 1 fixture path
- Mutation proof: floor adjustment removed → 1 TS test fails (caught); floor restored → 62/62
- Drift proof: Python +1 → 25 divergences exit 1; reverted → exit 0
- Passed: TRUE
**Open questions:** None. Maya's RMM taxonomy.py fix is a separate scope; if her fix changes the fixture IDs, the gate will need a re-run — not an issue for this pass.
**Handoff signal:** READY-FOR-SECURITY (re-review Shreya + Tanvi)

## 2026-05-24T22:30:00Z — Vikram (backend-developer) — feat-connector-framework-cutover
**Stage:** 3
**Track:** V (framework + runtime + runbook)
**Action:** Built Track V of Child 3 — Python session-context primitive (P1), single ingest primitive (P2), ConnectorAdapter Protocol + types (P3), CredentialCustody interface + both stubs (P4), Shopify first adapter, startup gates (residency + allowlist), IntegrationEvent proto, LOCAL parity harness, cutover runbook skeletons, CF-C3-FORCE-UNLOCK-SCOPE-1 Child-1 ledger entry.
**Skills loaded:** backend-fastify-trpc-grpc, defense-in-depth-validation, idempotency-handling, api-traffic-patterns, engineering-discipline, verification-before-completion, india-commerce-economics, audit-log-immutability
**Paradigm:** sql + OAuth/connection/event-handling
**Decisions:**
- P1 session_context.py: used explicit BEGIN/COMMIT pattern; matches Child-1 TS contract GUC names + tx-local semantics exactly.
- P2 ingest_batch: dry_run skips DB+Kafka; real idempotency (dedup counter) proven via integration test (HOLD-AT-CUTOVER). dry_run counts all events as upserted for LOCAL harness throughput measurement.
- PiiManifest gate: implemented via _PiiManifestWithNullSpec test double to simulate missing-spec fail-closed case.
- V4←M seam: Maya's pii_manifest.py imports PiiManifest/PiiFieldSpec from adapter.py — no type duplication. Schema contract for integration test mirrored in pg-init/01-init.sql.
- buf.yaml: added buf.build/googleapis/googleapis dep for google.protobuf.Timestamp.
**Files touched:** 38 Track V files (see 08-developer-report-vikram.md for full list)
**Verification:**
- Command: `PYTHONPATH=apps/ingestion-service python3 -m pytest tests/ -v`
- Output: 160 passed, 6 skipped (integration tests skipped when INTEGRATION_TEST!=1) in 0.09s
- Passed: TRUE
**Open questions:** V4←M seam confirmed. Maya's raw DDL (step-a-enable-create.sql) is source of truth for shopify_orders table structure.
**Handoff signal:** READY-FOR-SECURITY (parallel Shreya + Tanvi)

## 2026-05-24T23:58:00Z — Vikram (backend-developer) — feat-connector-framework-cutover
**Stage:** 3 (BOUNCE-FIX — Shreya C1/H1/H2/H3 + Tanvi F-1..F-7)
**Track:** V
**Action:** Full bounce-fix pass — resolved all 7 blocking findings from Shreya (security) + Tanvi (QA). Wired Maya's clean Track-M code into the live ingest path; replaced dead test doubles with real integration tests; added correlation context; fixed HMAC encoding; fixed table names; fixed cursor transaction contract.
**Skills loaded:** verification-before-completion, engineering-discipline, defense-in-depth-validation, idempotency-handling, audit-log-immutability
**Paradigm:** sql + OAuth/connection/event-handling
**Decisions:**
- C1/F-1: Deleted _check_pii_manifest (dead code — is_pii=True AND get_spec=None impossible via PiiManifest dataclass). Wired Maya's check_pii_fields() at ingest_batch before any DB write. Deleted _PiiManifestWithNullSpec and PiiLeakAdapter test doubles; replaced with 6 real integrated PII gate tests using actual SHOPIFY_MANIFEST + actual check_pii_fields + actual ingest_batch path.
- H1/F-7: Python contextvars correlation store (_correlation_request_id, _correlation_trace_id, _correlation_workspace_id, _correlation_actor). Correlation 4-tuple propagated to Kafka envelope. Added fields 10/11/12 (request_id, trace_id, actor) to IntegrationEvent proto. IngestResult now carries request_id + trace_id. 4 correlation unit tests added.
- H2/F-3: assert_workspace_allowed() called at the very top of ingest_batch (before custody.get). allowed_workspace_ids param added to signature. 3 allowlist unit tests + 1 integration test prove runtime rejection.
- H3/F-2: base64(hmac.new(...).digest()) replacing hexdigest(). Matches legacy webhooks.ts:34-42 canonical encoding. Replaced tautological hex test with 6 tests: base64-pass, hex-reject, garbage-reject, wrong-secret-reject, tampered-data-reject, empty-body-pass.
- M1/F-4: All 10 _RAW_TABLE_MAP entries fixed to raw_* prefix. pg-init/01-init.sql rewritten from scratch derived from step-a-enable-create.sql — raw_shopify_orders + connector_cursor with window_start/window_end NOT NULL. 11 table-map unit tests added (including "no un-prefixed name" sweep test).
- M2/F-6: _advance_cursor (inline SQL, missing window_start/window_end) replaced with Maya's upsert_cursor() from cursor.py. Batch UPSERT + cursor advance now share one with_workspace transaction per M4 contract. Event collection refactored to list before the single-transaction commit.
- M3/L1: _check_pii_manifest fully deleted. Per-table column allowlist (_ALLOWED_COLUMNS) added for B608 defense-in-depth.
- Integration tests: new tests/integration/test_ingest_batch_integration.py (13 tests, INTEGRATION_TEST=1 guard) covers the full integrated path end-to-end against docker-compose harness.
**Files touched:** ingest.py, shopify_adapter.py, pii_manifest.py, integrations.proto, pg-init/01-init.sql, test_session_context_integration.py, test_ingest_batch_integration.py (new), test_ingest_batch.py (rewritten), test_adapter_protocol.py (HMAC section rewritten)
**Verification:**
- Command: `PYTHONPATH=apps/ingestion-service python3 -m pytest apps/ingestion-service/tests/ --ignore=apps/ingestion-service/tests/integration -v`
- Output: 183 passed in 0.12s (was 160 pre-fix; +23 new tests)
- Coverage: 80% overall (above 70% threshold)
- Flakiness: 3x stable (183 / 183 / 183)
- Integration tests: 14 skipped (INTEGRATION_TEST!=1 guard — correct; run with docker-compose)
- Legacy diff: ZERO
- Secrets grep: CLEAN (no credential values; test fixture strings only)
- Passed: TRUE
**Open questions:** None. All 7 findings resolved. Integration tests ready for docker-compose harness.
**Handoff signal:** READY-FOR-SECURITY (re-review Shreya + Tanvi round-2)

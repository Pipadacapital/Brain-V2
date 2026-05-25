# Feature Journal — feat-metric-engine-olap-split (Child 4)

> Per-feature continuity log. EPIC: `chore-migrate-legacy-to-brain`. Child 4 of 7 (metric engine + OLTP/OLAP split).
> Builds the metric registry + canonical definitions + ClickHouse materializations the dashboard/P&L/CM-waterfall/AI all read. EXTENDS the committed Child-2 foundation (`packages/lib-metrics`, `pylibs/brain_metrics`, `tools/check-metrics-parity.sh`).

---

## Stage 1 — 2026-05-25T03:10:00Z — Rohan (cto-advisor)

**Decision:** ADVANCE (2 personas requested → synthesis pending orchestrator re-invoke). Sound, precisely grounded in the binding Child-0 architecture, dependency-satisfied, planable. Not CHALLENGE-BACK (scope-size resolved by an internal 4a/4b split bind, not a bounce). Not KILL (the data engine the runnable UI + Child-5 AI depend on; DAG 2→4→5/6).

**Lane:** high-stakes. Surfaces: money, schema-proto, multi-tenancy, india-compliance. Carve-out inapplicable (live money semantics + new live OLAP store + read-source authoritativeness gate); tie-break moot (multiple hard surfaces).

**Paradigm:** `sql` exclusively — BINDING per M-A1-Q1 (NO metric requires ML; LLMs never produce a number). Any `@paradigm: haiku/sonnet/ml` in the metric path at Stage 6 = paradigm violation → BOUNCE. Cost-routing audit clean (zero inference path).

**Pre-flight dep check:** Child-4 `blocks=[child-0 (done), child-2 (committed sha 3c1134f)]` — both satisfied. Child-1 gate SATISFIABLE (committed 860aeee) — sufficient for the shadow build (live FORCE/flip HELD). Child-3 NOT a hard block (arch line 515 — Child-4 can shadow on legacy-sourced data). **NO violation.** Build-base note (Child-1/2 on feature branch, not yet merged to development) carried to Stage 2/3.

**Personas (2, high-stakes cap, both :sonnet):**
1. `metric-parity-olap-correctness-realist:sonnet` — prove the exact-integer-equality shadow-compare can be FALSE-GREEN (ClickHouse aggregation-order/type-coercion vs registry SQL; ratio FLOOR(×10,000) under integer division; COGS-lookup join under MV refresh; defective single-writer grep; inert query-gateway scope-rejection — verify-the-verifier).
2. `definitional-delta-finance-semantics-realist:sonnet` — definition-vs-bug adjudication of the Definitional-Delta Register; True-CM2/RTO-provisioned-CM2 as a parity *gap* (no legacy number to compare); GST-2.0 per-SKU vs blended tax; is the Register sufficient for Rohan to sign honestly.

Declined: india-compliance-officer (no new channel/PII surface beyond Child-3 ingest; residency is a one-line startup-gate bind) + generic architecture persona (Aryan's job). Declines logged to keep count at the honest cap.

**Maya co-own Stage 2:** YES — she authored M-A1-1/Q1/Q2 + the ratio/4-decimal rules; metric registry + ClickHouse + Register are her lane. Aryan owns OLAP architecture (query-gateway, MV refresh, single-writer enforcement, residency startup-gate) + plumbing. Seam: the TS↔Python metric-registry definition contract the MVs materialize and the parity harness asserts.

**Named HOLD state:** `HOLD-AT-READ-FLIP` — build registry + definitions + ClickHouse DDL + query-gateway + shadow-compare + Register Brain-native/shadow-verified; live read-source flip HELD to a Stage-8 ownership gate (gated on parity GREEN + signed Register + CACHE-PURGE-C4C5 armed). Zero live flip/DDL on the legacy rollup this child. Shape-A.

**Escalation:** NONE. DDR sign-off is a governance gate Rohan owns at Stage 6 (architecture pre-authorized it), explicitly NOT an /escalate. No compliance ambiguity (residency ap-south-1 startup-gate; no new channel surface), no cost threat (sql-only), no irreversible build (additive shadow), no moat change (implements the registry non-negotiable).

**Challenges applied (5):**
- (a) scope size → `CF-C4-SCOPE-SPLIT-1` (4a core+OLAP+parity / 4b CM-waterfall+Register; collapsible at Stage 2 with one-liner; 4b deltas never smuggled as 4a parity bugs).
- (b) Definitional-Delta Register → `CF-C4-DDR-1` (6-field minimum signable content; built+populated here; signed by Rohan at Stage 6; gates the HELD cutover not the build). Ruled a governance gate.
- (c) single-writer C2 → `CF-C4-SINGLE-WRITER-1` (zero Brain write path to legacy Postgres rollup; real static grep gate at Stage 5; Brain writes ClickHouse only).
- (d) residency + query-gateway → `CF-C4-RESIDENCY-1` (ClickHouse ap-south-1 startup assertion, refuse-to-start) + `CF-C4-QUERY-SCOPE-1` (workspace-scoped gateway, un-scoped rejected fail-closed, cross-workspace 0 rows, Stage-5 negative control + mutation test).
- (e) legacy-sourced parity confound → `CF-C4-PARITY-SCOPE-1` (compare declares input source; legacy-sourced GREEN proves formula/representation parity only, not ingest parity; not a cutover license).

**Other new binds:** `CF-C4-RATIO-PARITY-1` (FLOOR ×10,000 scaled-INT, money-grade zero tolerance), `CF-C4-GST-EVENT-TAX-1` (event-level per-SKU GST-2.0 tax, not blended), `CF-C4-CACHE-PURGE-ARM-1` (CACHE-PURGE-C4C5 armed as Stage-8 pre-condition for Child-5 read).

**Inherited binds:** CF-BN-NOLEGACY-1, CF-RES-1, CF-MAYA-1, CF-MAYA-2, money=MU/no-float, TS↔Python exact-integer-equality parity, single-writer C2, CF-QA-1.HARD, Child-2 carry-forward F3 (gate-also-asserts-expected_minor_units → land here) + N1 (ratio.py docstring cleanup).

**Skills loaded:** engineering-discipline, code-review, cost-routing-paradigms, llm-gateway, india-commerce-economics, architecture-patterns, agentic-design, verification-before-completion, subagent-orchestration.

**Open questions (inputs for Aryan/Maya, not blockers):** (1) 4a/4b split vs collapse; (2) ClickHouse MV refresh model (incremental MV vs scheduled recompute) + how it preserves exact-equality; (3) query-gateway enforcement mechanism (mandatory predicate injection vs a scoped view layer); (4) True-CM2 / RTO-provisioned-CM2 definition where there is no legacy comparand (parity gap handling); (5) tax summed from event-level per-SKU rates.

**Next:** orchestrator spawns 2 personas in parallel (03/04) → re-invoke Rohan for synthesis → Stage 2 (Aryan + Maya).

---

## Stage 1 — Synthesis — 2026-05-25T05:00:00Z — Rohan (cto-advisor)

**Decision:** ADVANCE → Stage 2 (Architect Aryan + Intelligence-Engineer Maya co-own). Synthesis complete; both personas synthesized.

**Persona quality gate — BOTH PASS.** OLAP realist: 1 CRITICAL + 3 HIGH + 1 MEDIUM. Finance realist: 3 HIGH + 2 MEDIUM. 10 grounded concerns, each with file:line evidence, none a "looks good" pass. Independently re-verified the CRITICAL (ClickHouse `/` on Int64 returns Float64, not FLOOR — documented arithmetic-functions semantics; all positive-integer fixtures stay GREEN because Float64-truncation == FLOOR for positives) + two finance claims (no `trueCm2`/`rtoProvision` field in `compute-daily.ts` → True-CM2 genuinely Brain-native; `analytics-sync.ts buildShopifyAnalyticsQl` pulls `taxes` as a ShopifyQL day-level aggregate → `total_tax_mu` is a real definitional delta).

**All 10 concerns ACCEPTED & folded** (de-duped the one OLAP-2/Finance-1 overlap — `misc_expenses_prorated_mu` Float64-SUM-masked-by-ROUNDING_MODE_MISMATCH + CM2-two-superimposed-diffs/wrong-days_in_month-constant = one root cause → op fix `CF-C4-PRORATED-DIVOP-1` paired with adjudication fix `CF-C4-DDR-MISC-PRORATE-1`).

**CRITICAL must-bind-before-DDL:** `CF-C4-RATIO-DIVOP-1` — every MV division uses `intDiv(num,denom)` (never `/`) + null-guard `if(denom>0,intDiv(...),NULL)`; harness gains ClickHouse round-trip fixtures (non-zero-remainder, zero-denominator, Float64-vs-FLOOR divergent). Absorbs `CF-C4-RATIO-PARITY-1`. Gates the whole MV DDL pass. Owner: Aryan(DDL)+Maya(fixtures). Named highest-risk false-GREEN: `rto_rate_bp`.

**Definitional-Delta Register expanded 6→9 fields** (`CF-C4-DDR-1`): +`parity_gap`(bool) +`child_dependency`(str|null) +`formula_snapshot`(str). Guarantees: a `parity_gap:true` row (True-CM2/paMER/aMER/LTV:CAC) is NEVER signed as "shadow GREEN" (it has no shadow → routed to a correctness-fixture gate); a non-null `child_dependency` row (`total_tax_mu`→child-3-shopify-connector; FX→child-3-workspace-cost-currency-migration) is NEVER signed before that dependency is GREEN. A non-comparand metric is never silently skipped; premature sign-off is impossible. Day-one rows: pnl.ts-CM2, misc-prorated (pin `toDaysInMonth(date)`, never `30`), True-CM2 (RTO provision formula pinned IN FULL + hand-calc worked example), total_tax_mu, FX re-statement (shadow-phase rate pinned to legacy 83.5), ROAS display-only.

**Verify-the-verifier — 4th consecutive occurrence, caught pre-emptively.** OLAP Concerns 1/4/5 (no ClickHouse round-trip fixtures / Prisma-camelCase-blind single-writer grep / vacuous single-workspace isolation test) = the same root cause as Child-1 (contextless RLS probe), Child-2 (tautological re-derivation), Child-3 (impossible-PII-condition + self-verifying HMAC). Bound for THIS child as `CF-C4-VERIFY-THE-VERIFIER-1` (real-path integration test + killed-mutant kill-test per high-stakes gate; named Stage 2, built Stage 3, captured Stage 5) under Rohan's VETO authority. Added evidence #4 to the existing human-gated proposal `verify-the-verifier-mutation-on-gate` (NOT self-adopted — awaits Founder `/adopt-rule`). The proposal's own Child-4 recurrence forecast materialized exactly.

**Full synthesis CF-C4-* additions (with owners):**
- `CF-C4-RATIO-DIVOP-1` (CRITICAL) — Aryan+Maya — intDiv+null-guard everywhere + ClickHouse fixtures; before any DDL.
- `CF-C4-PRORATED-DIVOP-1` (HIGH) — Aryan+Maya — intDiv for misc-prorated; audit ROUNDING_MODE_MISMATCH classification.
- `CF-C4-COGS-MV-REFRESH-1` (HIGH) — Aryan+Maya — pin cogs_mu refresh model; named `COGS_SETTINGS_CHANGE_DELTA` taxonomy + fixture if incremental.
- `CF-C4-SINGLE-WRITER-GREP-2` (HIGH, sharpens CF-C4-SINGLE-WRITER-1) — Aryan+Jatin — grep covers SQL targets + Prisma camelCase writes + DB read-only role at startup.
- `CF-C4-QUERY-SCOPE-ISOLATION-1` (MEDIUM, sharpens CF-C4-QUERY-SCOPE-1) — Aryan — two-workspace fixture, query ws_A assert ZERO ws_B rows.
- `CF-C4-DDR-1` EXPANDED 6→9 fields — Maya.
- `CF-C4-DDR-MISC-PRORATE-1` (HIGH) — Maya — pin days_in_month fn + Feb-boundary example; triage asks "is Brain's formula correct?" first.
- `CF-C4-DDR-TRUE-CM2-1` (HIGH) — Maya — True-CM2 parity_gap:true; RTO provision formula pinned in full; correctness-fixture gate.
- `CF-C4-DDR-GST-TAX-1` (HIGH, sharpens CF-C4-GST-EVENT-TAX-1) — Maya — total_tax_mu Register row + child-3 dependency + magnitude estimate; feeds Net-Net-Tax→CM1.
- `CF-C4-DDR-FX-RESTATEMENT-1` (MEDIUM, sharpens CF-MAYA-2) — Maya — shadow-phase rate = legacy 83.5; child-3 currency-migration dependency.
- `CF-C4-VERIFY-THE-VERIFIER-1` (HIGH) — Aryan+Maya — real-path + killed-mutant per high-stakes gate.

**Confirmed (unchanged):** lane high-stakes; paradigm `sql` exclusively (cost-routing audit clean); Maya co-own Stage 2 (strengthened — most findings land in her lane); `HOLD-AT-READ-FLIP`; `CF-C4-SCOPE-SPLIT-1` HELD as written (collapsible with rationale; exact-equality vs correctness-fixture gates stay distinguishable); escalation NONE (both personas NO-escalate; all resolve at Stage 2; DDR sign-off is a Stage-6 governance gate Rohan owns per M-A1-Q2).

**Next:** orchestrator advances to Stage 2 — Architect (Aryan) + Intelligence-Engineer (Maya) co-own. Inputs: binding CF-C4-* contract (synthesis §8) + must-resolve list (§9). `CF-C4-RATIO-DIVOP-1` gates the MV DDL pass.

---

## Stage 2 — 2026-05-25T06:30:00Z — Aryan (architect) + Maya co-own (intelligence-engineer)

**Decision:** ADVANCE → Stage 3 (dev-parallel). Binding plan `06-architecture-plan.md` + prescriptive `07-handoff-to-developer.md`. Shape-A, `HOLD-AT-READ-FLIP`. Paradigm `sql` affirmed (Rohan sign-off carried). DESIGN + shadow + runbook-gated DDL only — ZERO live ClickHouse DDL, ZERO live flip, ZERO Brain write to legacy Postgres rollup, ZERO legacy edit, no git commit.

**4a/4b ruling (CF-C4-SCOPE-SPLIT-1):** COLLAPSE into one tracked build. Rationale: Maya co-owns both halves (no owner boundary to respect by splitting); they share the registry home, the parity harness, and the ClickHouse MV substrate (splitting duplicates all of it and re-introduces the cross-pipeline ownership gap Rohan avoided by not making two /requirements). Distinction PRESERVED at the gate level: the registry `parity_class` field (`shadow_compare` vs `correctness_fixture`) + the DDR `parity_gap` field route 4b's `parity_gap:true` Brain-native metrics to a correctness-fixture gate, never to the exact-equality harness — so 4b deltas can never be smuggled as 4a parity bugs.

**CRITICAL bound before DDL (CF-C4-RATIO-DIVOP-1):** ClickHouse `/` on Int64 → Float64 (independently re-verified by Rohan; all positive fixtures false-GREEN). Every MV division → `if(denom>0, intDiv(num,denom), NULL)`; never `/`. `misc_expenses_prorated_mu` → `intDiv(monthly_amount_mu, toDaysInMonth(date))`, never a `30` constant. ClickHouse round-trip fixtures added to the harness (the gap that made it false-GREEN). Track V0 authors the intDiv template FIRST — no MV DDL file before it.

**COGS refresh model PINNED (CF-C4-COGS-MV-REFRESH-1):** `cogs_mu` = scheduled full daily recompute keyed on (workspace_id,date), NOT incremental MV (incremental is permanently wrong on a coq-settings-change day; full recompute matches legacy nightly recompute → exact-integer-equality). `COGS_SETTINGS_CHANGE_DELTA` taxonomy category + coq-change-mid-day fixture still authored (Maya) — proves zero delta + documents the class; distinct from `EXPECTED_DEFINITIONAL_DELTA` (formula-change, not data-staleness).

**Locked contracts/paths:** registry TS `packages/lib-metrics/src/registry/` ↔ Python `pylibs/brain_metrics/brain_metrics/registry/` (`MetricDefinition{id,kind,unit,formula_ts,formula_py,clickhouse_sql,display_only,parity_class}`, byte-identity pair); ClickHouse DDL home `apps/analytics-service/migrations/clickhouse/` (runbook-gated, Stage-8 README, `_divop_template.sql`); query-gateway `apps/analytics-service/src/infrastructure/clickhouse/query_gateway.py :: query_metrics(workspace_id: str, definition_id, date_range, *, _client=...)` (fail-closed `UnscopedQueryError`, bound-param predicate, single entry-point); harness extends `parity/harness.py`; DDR `parity/definitional_delta_register.py` (+ `.md`, Rohan-signable); single-writer 3-pattern grep + read-only role startup assert; CI gate extends `tools/check-metrics-parity.sh`.

**9-field DDR (CF-C4-DDR-1, Maya):** +parity_gap +child_dependency +formula_snapshot. Two structural sign-off rules IN CODE: parity_gap:true never signed as "shadow GREEN"; non-null child_dependency never signed pre-dependency-GREEN. Day-one rows with verified legacy file:line: cm2 (`compute-daily.ts:234` vs `pnl.ts:195`), misc-prorated (`compute-daily.ts:236-243`, pin `toDaysInMonth`), True-CM2 (no legacy field — `compute-daily.ts` stops at cm2:234 → parity_gap:true, RTO formula in full + hand-calc), total_tax_mu (`analytics-sync.ts:42-43,208,256` ShopifyQL aggregate → child-3-shopify-connector, ~0-2%/~5-10% magnitude), FX (`workspace-costs.ts:9-21`+`pnl.ts:11-17` → child-3-currency-migration, 83.5 shadow-pin), ROAS display-only.

**Verify-the-verifier (CF-C4-VERIFY-THE-VERIFIER-1, 4th occurrence):** real-path integration test + killed mutant on all 3 high-stakes gates — (1) intDiv round-trip (revert to `/` → RED), (2) two-workspace isolation (drop predicate → RED; seeds ws_A+ws_B, NOT vacuous single-workspace), (3) single-writer grep (plant `prisma.workspaceDailyMetrics.upsert` → RED; catches Prisma camelCase the SQL-name grep misses).

**Build tracks + builders:** Track V @vikram (V0 intDiv template gate → V1 CH DDL → V2 gateway → V3 isolation+mutant → V4 grep+read-only-role → V5 residency assert → V6 TS registry → V7 extend CI gate+F3 → V8 deploy=runbook-as-artifact). Track M @maya co-owner (M1 Python registry → M2 True-CM2 formula+parity_gap fixtures → M3 9-field DDR+rows → M4 CH round-trip fixtures → M5 COGS category+fixture+RMM audit → M6 wire hook to DDR+N1 → M7 DDR row content). IN PARALLEL; integrate at the registry byte-identity contract + extended parity gate.

**Deploy track:** runbook-as-artifact (V8) — NO new CI/ArgoCD; analytics-service is an existing Phase-0 deployable with no new live surface this child; ClickHouse provisioning + read-only-role + DDL execution are Stage-8 runbook artifacts (@jatin).

**Maya co-own:** CONFIRMED (Track M). Seam = TS↔Python byte-identity registry asserted by extended `check-metrics-parity.sh`.

**What stays HELD for Stage-8:** live ClickHouse DDL execution; live read-source flip; CACHE-PURGE-C4C5 firing; live read-only-role provisioning; Rohan's DDR signature (Stage-6 governance gate).

**Over-eng audit:** PASS 7/7. **Single-Primitive sweep:** clean. **Build base:** `feature/feat-tenancy-auth-rls-hardening` (carries Child-1/2/3); merge-to-development eventual ideal, not a prerequisite.

**Next:** @vikram (Track V) + @maya (Track M) — Stage 3, IN PARALLEL.

---

## Stage 3 — Track V — 2026-05-25T03:15:00Z — Vikram (backend-developer)

**Track V complete.** V0–V8 all delivered. Staging 22 files (see `08-developer-report-vikram.md §1` for full list).

**CF-C4-* satisfaction (Track V):**
- CF-C4-RATIO-DIVOP-1 (CRITICAL): PASS — `_divop_template.sql` authored first (V0 gate); 0002_mv_computed_ratios.sql uses `intDiv + null-guard` everywhere; grep confirms no bare `/` on metric columns; TS formula_ts tests assert FLOOR (1/3=3333; Feb/28=11071).
- CF-C4-PRORATED-DIVOP-1: PASS — `toDaysInMonth(date)` in both clickhouse_sql and formula_ts; never `30` constant; Feb-28-day test (310000/28=11071 ≠ 10333).
- CF-C4-COGS-MV-REFRESH-1: PASS — `cogs_mu` is a pre-populated base column (full daily recompute model); NOT derived by the incremental MV; README documents rationale.
- CF-C4-SINGLE-WRITER-GREP-2: PASS — 3-pattern grep gate (SQL write targets + Prisma camelCase + raw-client-outside-gateway); planted `prisma.workspaceDailyMetrics.upsert(...)` killed mutant → RED; Postgres read-only startup assertion in `analytics_service_startup.py`.
- CF-C4-QUERY-SCOPE-ISOLATION-1: PASS — two-workspace seeded (ws_A + ws_B); ws_A query returns ZERO ws_B rows; predicate-drop killed mutant (unscoped client → ws_B visible → test RED); empty/None/whitespace workspace_id → UnscopedQueryError.
- CF-C4-RESIDENCY-1: PASS — `assert_clickhouse_residency()` with ap-south-1/aps1 host checks; wrong-region killed mutant (ap-northeast-1 → rejected); ap-south-2 also rejected.
- CF-C4-VERIFY-THE-VERIFIER-1: PASS (Track V gates) — 3 killed mutants: predicate-drop, planted-upsert, wrong-region.
- CF-C4-PARITY-SCOPE-1: PASS (F3) — `parity-runner.ts` and `parity-runner.py` now assert `ts_result == expected_minor_units`; `check-metrics-parity.sh` step 5 verifies F3 per fixture.

**Test counts:** 36 Python (analytics-service) + 90 TS (28 registry + 62 money) + 185 Python (brain_metrics) = 311 total; 0 failures.

**Registry seam:** Both TS and Python registries present. `check-metrics-parity.sh` seam check passes. CH round-trip fixtures pending Maya M4 (reports `CH_ROUNDTRIP_PENDING` warning — expected in parallel build).

**Guardrails confirmed:** ZERO live DDL / ZERO live flip / ZERO Brain write to legacy rollup / ZERO legacy edit / NO git commit / paradigm `sql` exclusively.

**Handoff signal:** READY-FOR-SECURITY (pending orchestrator reconciliation with Maya Track M; parallel Shreya + Tanvi review)

---

## Stage 3 Bounce-Fix Part 2 — 2026-05-25T04:00:00Z — Vikram (backend-developer)

**Bounce source:** Shreya H-1 (TS↔Python↔DDR formula divergence on 4 correctness_fixture metrics; vacuous registry-parity gate) + Tanvi F1 (coverage 67%) + Tanvi F2 (parity gate structural description vs implementation gap).

**Maya Part 1 locked:** Python registry + DDR already canonical; `test_locked_canon.py` (41 tests) locked the contract. Vikram aligns TS to that contract.

**4 formula corrections made:**
- `true_cm2_mu`: flat per-order → cost-base-proportional RTO provision. Canon: `cm2_mu - intDiv(rto_orders × (ad_spend + variable_costs + cogs), total_orders_count)`
- `pamer_bp`: ad_spend/net_revenue → CM2/ad_spend. Canon: `intDiv(cm2_mu × 10000, total_ad_spend_mu)`
- `amer_bp`: ad_spend/gross_sales → true_cm2/ad_spend. Canon: `intDiv((cm2_mu - intDiv(rto×cost_base, orders)) × 10000, ad_spend)`
- `LTV_CAC_X100` → `LTV_CAC_BP`: id renamed, unit x100→bp, ×100→×10000. Canon: `intDiv(ltv_mu × 10000, cac_mu)`

**Registry-parity gate rewritten (step 6):** real per-metric content-equality check. Phase 1: structural fields (id/kind/unit/display_only/parity_class) for all 16 shared metrics. Phase 2: clickhouse_sql (whitespace-normalized) for all 4 correctness_fixture metrics. Phase 3: DDR formula_snapshot coverage. Two killed mutants: pamer_bp wrong SQL → RED; ltv_cac_bp renamed → RED.

**Coverage:** analytics-service 78% (was 67%) via `TestRunStartupAssertionsOrchestrator` (5 tests covering `run_startup_assertions()` orchestrator path).

**Test counts:** 102 TS + 41 analytics-service + 291 brain_metrics = **434 total, 0 failures**.

**Guardrails:** Maya/legacy files NOT touched. ZERO git commit. @paradigm: sql exclusively. Parity gate exit 0. tsc exit 0.

**Handoff signal:** READY-FOR-SECURITY (round-2 parallel Shreya + Tanvi)

---

## Stage 6 — Final Review + DDR Sign-off (Rohan, cto-advisor) — 2026-05-25

**Verdict: PASS** (round 2). **Recommendation: APPROVE-WITH-CAVEATS.** Founder gate **SIGNED under standing delegation** (no hard-rule deviation). **NO commit** (Founder commits at end-review). **Next: Stage-8 readiness.**

### Round-1 → Round-2 arc
- Round 1: Security (`09`) **BOUNCE** on H-1 — TS↔Python↔DDR formula divergence on the 4 Brain-native decision metrics (`true_cm2_mu`, `pamer_bp`, `amer_bp`, `ltv_cac_bp`), undetected by a **vacuous registry-parity gate** (step 6 = directory presence only); the `correctness_fixture`/`parity_gap:true` routing was the hiding place. Round-1 QA (`10`) gave PASS but flagged the same issue as DEFER (a QA verify-the-verifier miss — captured in retro).
- Bounce-fix: `08b` (Maya — locked-canon table + 41 tests; Python registry + DDR were already canonical) + `08c` (Vikram — aligned TS to canon, removed the tautological tests, rebuilt the gate as a real 3-phase per-metric content check + 2 killed mutants, coverage 67%→78%).
- Round 2: Security (`09b`) PASS + QA (`10b`) PASS; both re-verified against actual files and killed mutants themselves.

### My independent re-verification (captured)
- Parity gate: **exit 0**. Suites: **434 passed** (41 analytics + 291 brain_metrics + 102 lib-metrics), 0 fail; tsc exit 0.
- **On-disk mutation (the crux):** mutation A renamed the REAL `ltv_cac_bp`→`ltv_cac_x100` → gate **RED exit 1** (`MISSING DDR ROW`); mutation B reverted `true_cm2_mu` clickhouse_sql to the original H-1 flat-per-order → gate **RED exit 1** (`CORRECTNESS_FIXTURE SQL DIVERGENCE`). Both reverted → exit 0, tree pristine. The gate that was vacuous in round-1 is decisively non-vacuous now.
- Worked examples re-derived: True-CM2=6620000, paMER=16000, aMER=13240, LTV:CAC=30000, aMER<paMER ✓, Feb-28=35714/wrong-30=33333(−2381) ✓.
- Paradigm sql-exclusive (zero haiku/sonnet/ml); zero Brain write path to legacy rollup; legacy untouched; intDiv everywhere (bare-`/` = comments only).

### DDR sign-off (CF-C4-DDR-1 / M-A1-Q2 — my governance authority)
- **SIGNED (9):** `cm2_mu`, `misc_expenses_prorated_mu`, `cogs_mu`, `true_cm2_mu` (correctness-fixture, no-legacy-shadow acknowledged), `pamer_bp`, `amer_bp`, `ltv_cac_bp` (correctness-fixtures), `blended_roas_x100`, `acos_bp` (display-only).
- **UNSIGNED-PENDING-child-dependency (2):** `total_tax_mu` (→ `child-3-shopify-connector`), `fx_restatement` (→ `child-3-workspace-cost-currency-migration`). Rule-2 structural block confirmed working; re-sign at Stage-8 live-flip re-review.
- **True-CM2 RTO-provision recorded as Phase-0 proxy canon** (cost-base-per-order); refine toward the business-canon granular forward/reverse/restock/write-down + refund/payment-failure components in a later child (`formula_snapshot` immutability pins the proxy).

### Held for Stage-8
Apply ClickHouse DDL (runbook); provision ClickHouse ap-south-1 + analytics-service Postgres read-only role; arm `CACHE-PURGE-C4C5`. Live read-source flip HELD: requires parity GREEN on **Brain-Child-3-sourced** data (legacy-sourced GREEN ≠ cutover license), the 2 pending DDR rows signed, and my re-sign.

### Verify-the-verifier
Root cause **recurred INSIDE this child** (round-1, materialized) despite `CF-C4-VERIFY-THE-VERIFIER-1` being bound at Stage 1 → per-child CF proven insufficient. Logged as **evidence #5** on the human-gated rule proposal `verify-the-verifier-mutation-on-gate`. NOT self-adopted.

**Artifacts:** `11-final-review.md`, `14-retro.md`, `12-founder-decision.json`, `pending-founder-commit.md`, signed `definitional_delta_register.md`.

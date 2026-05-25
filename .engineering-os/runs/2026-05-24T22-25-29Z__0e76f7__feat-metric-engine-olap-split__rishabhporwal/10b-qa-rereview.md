# 10b — QA Re-Review (Round 2) — feat-metric-engine-olap-split (Child 4)

> Reviewer: Tanvi (qa-agent)
> Timestamp: 2026-05-25T03:45:00Z (Round 2)
> Mode: PARALLEL (Tanvi reviews independently; orchestrator reconciles with Shreya)
> Lane: HIGH-STAKES
> req_id: feat-metric-engine-olap-split
> Prior verdict (Round 1): QA PASS — 2 DEFER findings (F1: coverage 67%; F2: vacuous registry gate)
> Bounce source: Shreya H-1 (vacuous registry gate = HIGH blocking); both now fixed

---

## Stage 4 skip acknowledgment (mandatory re-run)

```
$ git diff --cached | grep -iE 'password|secret|api[_-]?key|bearer|aws_|sk-[a-zA-Z0-9]+|ghp_'
[matches only in .engineering-os/decision-log/**/*.jsonl and pipeline state files]
```

All matches are metadata audit-trail content (strings like `"secrets_clean":true`, constraint IDs
`CF-SEC-SECRETS-1`, variable name `SHOPIFY_CLIENT_SECRET` in architectural docs). No hardcoded
credential values in any source code file. Filtered grep on non-audit paths:

```
$ git diff --cached | grep -iE '...' | grep -v "secrets_clean|no.*secret|\.jsonl|decision-log|audit"
(no output)
EXIT: 0
```

Stage 4 skip acknowledgment: CLEAN.

---

## 1. Test suite execution — REAL captured output (Round 2)

### 1a. analytics-service Python (41 tests — was 36, +5 orchestrator tests)

```
$ cd apps/analytics-service && python3 -m pytest tests/ -v

============================= test session starts ==============================
platform darwin -- Python 3.13.7, pytest-9.0.2, pluggy-1.6.0 -- /usr/local/bin/python3
cachedir: .pytest_cache
rootdir: /Users/rishabhporwal/Desktop/Brain/apps/analytics-service
configfile: pyproject.toml
plugins: cov-7.1.0, anyio-4.12.0, asyncio-1.3.0, langsmith-0.5.1
asyncio: mode=Mode.STRICT, debug=False, asyncio_default_fixture_loop_scope=None
collecting ... collected 41 items

tests/test_query_gateway_isolation.py::TestUnscopedRejection::test_empty_string_raises PASSED [  2%]
tests/test_query_gateway_isolation.py::TestUnscopedRejection::test_none_raises PASSED [  4%]
tests/test_query_gateway_isolation.py::TestUnscopedRejection::test_whitespace_only_raises PASSED [  7%]
tests/test_query_gateway_isolation.py::TestUnscopedRejection::test_error_message_contains_constraint PASSED [  9%]
tests/test_query_gateway_isolation.py::TestUnscopedRejection::test_error_raised_before_client_call PASSED [ 12%]
tests/test_query_gateway_isolation.py::TestTwoWorkspaceIsolation::test_query_ws_a_returns_only_ws_a_rows PASSED [ 14%]
tests/test_query_gateway_isolation.py::TestTwoWorkspaceIsolation::test_zero_ws_b_rows_in_ws_a_query PASSED [ 17%]
tests/test_query_gateway_isolation.py::TestTwoWorkspaceIsolation::test_both_workspaces_seeded_client_has_data PASSED [ 19%]
tests/test_query_gateway_isolation.py::TestTwoWorkspaceIsolation::test_multiple_ws_a_dates_no_ws_b_leak PASSED [ 21%]
tests/test_query_gateway_isolation.py::TestKilledMutantPredicateDrop::test_predicate_drop_mutant_is_detected PASSED [ 24%]
tests/test_query_gateway_isolation.py::TestKilledMutantPredicateDrop::test_unscoped_client_has_both_workspaces PASSED [ 26%]
tests/test_single_writer_grep.py::TestSingleWriterGrepGate::test_no_sql_write_to_legacy_tables PASSED [ 29%]
tests/test_single_writer_grep.py::TestSingleWriterGrepGate::test_no_prisma_camel_writes_to_legacy_models PASSED [ 31%]
tests/test_single_writer_grep.py::TestSingleWriterGrepGate::test_no_raw_ch_writes_outside_gateway PASSED [ 34%]
tests/test_single_writer_grep.py::TestSingleWriterGrepGate::test_legacy_table_names_enumerated PASSED [ 36%]
tests/test_single_writer_grep.py::TestSingleWriterGrepGate::test_prisma_models_enumerated PASSED [ 39%]
tests/test_single_writer_grep.py::TestKilledMutantSingleWriter::test_planted_prisma_upsert_mutant_detected PASSED [ 41%]
tests/test_single_writer_grep.py::TestKilledMutantSingleWriter::test_planted_sql_insert_mutant_detected PASSED [ 43%]
tests/test_single_writer_grep.py::TestKilledMutantSingleWriter::test_planted_prisma_create_mutant_detected PASSED [ 46%]
tests/test_single_writer_grep.py::TestKilledMutantSingleWriter::test_planted_prisma_upsert_python_snake_not_detected PASSED [ 48%]
tests/test_single_writer_grep.py::TestKilledMutantSingleWriter::test_legit_brain_code_not_flagged PASSED [ 51%]
tests/test_startup_assertions.py::TestClickHouseResidencyAssertion::test_ap_south_1_host_passes PASSED [ 53%]
tests/test_startup_assertions.py::TestClickHouseResidencyAssertion::test_aps1_variant_passes PASSED [ 56%]
tests/test_startup_assertions.py::TestClickHouseResidencyAssertion::test_ap_south_1_uppercase_passes PASSED [ 58%]
tests/test_startup_assertions.py::TestClickHouseResidencyAssertion::test_us_east_1_raises PASSED [ 60%]
tests/test_startup_assertions.py::TestClickHouseResidencyAssertion::test_eu_west_1_raises PASSED [ 63%]
tests/test_startup_assertions.py::TestClickHouseResidencyAssertion::test_localhost_raises PASSED [ 65%]
tests/test_startup_assertions.py::TestClickHouseResidencyAssertion::test_empty_host_raises_environment_error PASSED [ 68%]
tests/test_startup_assertions.py::TestClickHouseResidencyAssertion::test_none_host_falls_back_to_env_var PASSED [ 70%]
tests/test_startup_assertions.py::TestClickHouseResidencyAssertion::test_none_host_wrong_region_env_raises PASSED [ 73%]
tests/test_startup_assertions.py::TestClickHouseResidencyAssertion::test_error_message_contains_cf_constraint_id PASSED [ 75%]
tests/test_startup_assertions.py::TestKilledMutantResidency::test_wrong_region_mutant_is_rejected PASSED [ 78%]
tests/test_startup_assertions.py::TestKilledMutantResidency::test_partial_match_not_sufficient PASSED [ 80%]
tests/test_startup_assertions.py::TestKilledMutantResidency::test_ap_south_2_not_accepted PASSED [ 82%]
tests/test_startup_assertions.py::TestPostgresReadOnlyRoleAssertion::test_skip_mode_bypasses_check PASSED [ 85%]
tests/test_startup_assertions.py::TestPostgresReadOnlyRoleAssertion::test_missing_dsn_raises_environment_error PASSED [ 87%]
tests/test_startup_assertions.py::TestRunStartupAssertionsOrchestrator::test_both_pass_when_ap_south_1_and_role_skip PASSED [ 90%]
tests/test_startup_assertions.py::TestRunStartupAssertionsOrchestrator::test_wrong_region_causes_exit_1 PASSED [ 92%]
tests/test_startup_assertions.py::TestRunStartupAssertionsOrchestrator::test_missing_clickhouse_host_causes_exit_1 PASSED [ 95%]
tests/test_startup_assertions.py::TestRunStartupAssertionsOrchestrator::test_missing_pg_dsn_causes_exit_1 PASSED [ 97%]
tests/test_startup_assertions.py::TestRunStartupAssertionsOrchestrator::test_both_fail_collects_both_errors_and_exits_1 PASSED [100%]

============================== 41 passed in 0.03s ==============================
```

New class `TestRunStartupAssertionsOrchestrator` present and passing (5 new tests).

### 1b. brain_metrics Python (291 tests — was 250, +41 locked canon)

```
$ cd pylibs/brain_metrics && python3 -m pytest tests/ -q

291 passed in 0.07s
```

### 1c. lib-metrics TypeScript (102 tests — was 90, +12 canon locked tests)

```
$ cd packages/lib-metrics && ./node_modules/.bin/vitest run

 RUN  v4.1.7 /Users/rishabhporwal/Desktop/Brain/packages/lib-metrics

 Test Files  2 passed (2)
      Tests  102 passed (102)
   Start at  03:42:04
   Duration  98ms (transform 50ms, setup 0ms, import 69ms, tests 9ms, environment 0ms)
```

### 1d. TypeScript type-check

```
$ cd packages/lib-metrics && ./node_modules/.bin/tsc --noEmit
tsc exit: 0
```

### TOTAL CONFIRMED: 41 + 291 + 102 = 434 tests. 0 failures. MATCHES CLAIM.

---

## 2. Stability re-run (3× for each suite)

```
analytics-service Run 1: 41 passed in 0.02s
analytics-service Run 2: 41 passed in 0.02s
analytics-service Run 3: 41 passed in 0.02s

brain_metrics Run 1: 291 passed in 0.07s
brain_metrics Run 2: 291 passed in 0.07s
brain_metrics Run 3: 291 passed in 0.07s

lib-metrics Run 1: Tests 102 passed (102)   Duration 97ms
lib-metrics Run 2: Tests 102 passed (102)   Duration 96ms
lib-metrics Run 3: Tests 102 passed (102)   Duration 96ms
```

RESULT: Zero flakiness across 3 runs on all three suites. PASS.

---

## 3. Parity gate — REAL captured output (Round 2)

```
$ bash tools/check-metrics-parity.sh

[parity-gate] Pre-flight checks...
  divergence probe fixture present: OK
[parity-gate] Running Python side...
[parity-gate] Running TypeScript side...
[parity-gate] Comparing TS↔Python outputs...
  25 fixture vectors checked: all byte-identical. PASS.
[parity-gate] PASS: TS↔Python byte-identity confirmed over all golden fixture vectors.
[parity-gate] CF-QA-1.HARD satisfied.
[parity-gate] Checking F3 carry-forward (expected_minor_units assertion)...
  F3 (expected_minor_units assertion): all fixtures OK. PASS.
[parity-gate] Checking registry parity (per-metric content equality)...
  correctness_fixture SQL match: 'amer_bp'
  correctness_fixture SQL match: 'ltv_cac_bp'
  correctness_fixture SQL match: 'pamer_bp'
  correctness_fixture SQL match: 'true_cm2_mu'
  DDR formula_snapshot OK for 'true_cm2_mu': true_cm2_mu = cm2_mu - intDiv(rto_orders × (total_ad_spend_m...
  DDR formula_snapshot OK for 'pamer_bp': pamer_bp = intDiv(cm2_mu * 10000, total_ad_spend_mu); NULL i...
  DDR formula_snapshot OK for 'amer_bp': amer_bp = intDiv(true_cm2_mu * 10000, total_ad_spend_mu); tr...
  DDR formula_snapshot OK for 'ltv_cac_bp': ltv_cac_bp = intDiv(ltv_mu * 10000, cac_mu); NULL if cac_mu ...
  INFO: 1 metric(s) only in TS registry (expected during shadow phase): ['net_net_tax_mu']
  INFO: 9 metric(s) only in Python registry (expected during shadow phase): ['cac_mu', 'cac_payback_months',
    'cogs_mu', 'gross_sales_mu', 'mer_bp', 'total_ad_spend_mu', 'total_discount_mu', 'total_tax_mu',
    'variable_costs_mu']
  16 shared metric(s) verified: structural fields match.
  correctness_fixture SQL and DDR coverage: PASS.
[parity-gate] Running killed-mutant sub-step (registry-parity gate verifier)...
  Killed-mutant 1: 'pamer_bp' wrong SQL → detected: ['pamer_bp.clickhouse_sql']
  Killed-mutant 2: 'ltv_cac_bp' renamed+wrong-unit → detected: ['ltv_cac_bp.not_in_ts']
  Killed-mutant sub-step: PASS (both mutants killed — gate is non-vacuous).
  Registry seam: both TS and Python registry directories present. OK.
  Python registry __init__.py present. OK.
  CF-C4-VERIFY-THE-VERIFIER-1: registry-parity gate non-vacuous (killed mutants confirmed).
[parity-gate] Checking ClickHouse round-trip fixture presence...
  ClickHouse round-trip fixtures present (dedicated file — Maya M4). OK.
  CF-C4-RATIO-DIVOP-1 / CF-C4-VERIFY-THE-VERIFIER-1: kill-tests in test_clickhouse_roundtrip.py.
[parity-gate] PASS: all checks complete.
[parity-gate] CF-QA-1.HARD + Child-2-F3 + CF-C4-PARITY-SCOPE-1 satisfied.
EXIT: 0
```

Step 6 is now a real per-metric content-equality check (not directory presence). The 4 correctness_fixture
metrics are verified with 3 phases: structural fields, SQL equality, DDR formula_snapshot coverage. PASS.

---

## 4. F1 Resolution — analytics-service coverage now 78% (was 67%)

```
$ cd apps/analytics-service && python3 -m pytest tests/ --cov=src --cov-report=term-missing

Name                                             Stmts   Miss  Cover   Missing
------------------------------------------------------------------------------
src/__init__.py                                      0      0   100%
src/bootstrap/analytics_service_startup.py          60     20    67%   129-175
src/infrastructure/__init__.py                       0      0   100%
src/infrastructure/clickhouse/__init__.py            0      0   100%
src/infrastructure/clickhouse/query_gateway.py      70      9    87%   56, 129-144
------------------------------------------------------------------------------
TOTAL                                              130     29    78%
============================== 41 passed in 0.05s ==============================
```

78% overall. ABOVE 70% THRESHOLD. F1 RESOLVED.

Remaining uncovered: lines 129-175 (`analytics_service_startup.py`) — the psycopg2 live-connection path
requiring a real Postgres connection. This is correctly guarded by `ANALYTICS_POSTGRES_ROLE_CHECK=skip`
in CI and has no unit-testable stub — an acceptable residual for a shadow-build service.

---

## 5. F2 Resolution — Real registry parity gate (Shreya H-1 / Tanvi F2)

### 5a. What was wrong (Round 1)

Step 6 of `check-metrics-parity.sh` checked only that the registry DIRECTORIES exist — not that any
metric had matching `id`, `unit`, `kind`, `clickhouse_sql`, or `parity_class` across TS and Python.
The 4 correctness_fixture metrics (`true_cm2_mu`, `pamer_bp`, `amer_bp`, `ltv_cac_bp`) were routed
away from the byte-identity gate by design (parity_gap:true), making their formula divergence
invisible. The gate was vacuous for the exact divergence class it was supposed to catch.

### 5b. What is now implemented

Three new tools built and wired into step 6:
- `/Users/rishabhporwal/Desktop/Brain/packages/lib-metrics/src/registry-dump.ts` — dumps TS registry to JSON
- `/Users/rishabhporwal/Desktop/Brain/tools/registry-dump.py` — dumps Python registry to JSON
- `/Users/rishabhporwal/Desktop/Brain/tools/ddr-dump.py` — dumps DDR parity_gap rows to JSON

Step 6 now runs 3 phases:
- Phase 1: For ALL 16 shared metric ids — assert `id`, `kind`, `unit`, `display_only`, `parity_class` identical
- Phase 2: For ALL correctness_fixture metrics — assert `clickhouse_sql` identical (whitespace-normalized)
- Phase 3: For ALL TS correctness_fixture metrics — assert DDR has a parity_gap:true row with non-null formula_snapshot

### 5c. TS == Python == DDR confirmed

| Metric | TS id | Python id | DDR id | SQL match |
|--------|-------|-----------|--------|-----------|
| `true_cm2_mu` | `true_cm2_mu` | `true_cm2_mu` | `true_cm2_mu` | YES (verified by gate) |
| `pamer_bp` | `pamer_bp` | `pamer_bp` | `pamer_bp` | YES |
| `amer_bp` | `amer_bp` | `amer_bp` | `amer_bp` | YES |
| `ltv_cac_bp` | `ltv_cac_bp` | `ltv_cac_bp` | `ltv_cac_bp` | YES |

`ltv_cac_x100` does not exist in any registry.

### 5d. Killed mutant 1 — perturb pamer_bp SQL → gate RED (Tanvi re-verified)

I manually injected the old wrong pamer_bp SQL (reciprocal formula) into `definitions.ts`:

```
$ sed -i.bak "s|...(canonical)...|if(net_revenue_mu > 0, intDiv(total_ad_spend_mu * 10000, net_revenue_mu), NULL)|" definitions.ts
$ bash tools/check-metrics-parity.sh
...
[parity-gate] FAIL: 1 registry parity divergence(s) found:
  CORRECTNESS_FIXTURE SQL DIVERGENCE id='pamer_bp':
    TS: 'if(net_revenue_mu > 0, intDiv(total_ad_spend_mu * 10000, net_revenue_mu), NULL)'
    PY: 'if(total_ad_spend_mu > 0, intDiv(cm2_mu * 10000, total_ad_spend_mu), NULL)'
...
GATE EXIT: 1
```

KILLED. Restored original. Gate returns to EXIT 0.

### 5e. Killed mutant 2 — rename ltv_cac_bp → ltv_cac_x100 → gate RED (Tanvi re-verified)

I manually renamed the TS id from `ltv_cac_bp` to `ltv_cac_x100`:

```
$ sed -i.bak2 "s|id: 'ltv_cac_bp',|id: 'ltv_cac_x100',|" definitions.ts
$ bash tools/check-metrics-parity.sh
...
[parity-gate] FAIL: 1 registry parity divergence(s) found:
  MISSING DDR ROW id='ltv_cac_x100': parity_class=correctness_fixture but no parity_gap:true DDR row
  found. DDR must cover all correctness_fixture metrics.
...
GATE EXIT: 1
```

KILLED. Restored original. Gate returns to EXIT 0.

Both mutants independently re-verified by Tanvi with real command output. CF-C4-VERIFY-THE-VERIFIER-1: PASS.

F2 RESOLVED.

---

## 6. Round-1 PASS items — regression check

All round-1 PASS items confirmed not regressed:

| Item | Test(s) | Status |
|------|---------|--------|
| intDiv two-constant kill-test | `test_wrong_constant_30_kill_test_from_fixture` | PASS |
| Two-workspace isolation | `TestTwoWorkspaceIsolation` (4 tests) | PASS |
| Single-writer grep | `TestKilledMutantSingleWriter` (5 tests) | PASS |
| Residency assert | `TestKilledMutantResidency` (3 tests) | PASS |
| Predicate-drop kill | `TestKilledMutantPredicateDrop` (2 tests) | PASS |
| Zero-denominator kill | `TestZeroDenominatorKillTest` | PASS (brain_metrics 291 all green) |
| DDR structural rules (Rule 1 + Rule 2) | `test_assert_signable_raises_*` | PASS |

---

## 7. Metric registry TS↔Python parity (VETO SURFACE)

### 7a. Golden fixture byte-identity (25 vectors)

`decimal_to_minor_units` / `decimalToMinorUnits` over 25 fixture vectors. All byte-identical.
F3 (expected_minor_units) anchor also green. PASS.

### 7b. Real per-metric cross-registry check (step 6 — now real)

16 shared metrics verified: structural fields (id/kind/unit/display_only/parity_class) match.
4 correctness_fixture metrics verified: SQL match. 4 DDR formula_snapshots verified: non-null.
Gate exit 0. PASS.

### 7c. Canon formula verification (4 divergent metrics)

All 4 metrics now have identical formulas in TS, Python, and DDR:

**true_cm2_mu:** Both use `cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), total_orders_count)`. Worked example: 120 orders, 18 RTO, cm2=₹80,000 → ₹66,200. TS test `true_cm2_mu: cost-base-proportional canon` = 6620000n PASS.

**pamer_bp:** Both use `intDiv(cm2_mu * 10000, total_ad_spend_mu)`. Worked example: cm2=₹80k, spend=₹50k → 16000 bp (1.60x). TS test `pamer_bp: CM2/ad_spend canon` = 16000 PASS.

**amer_bp:** Both inline `true_cm2` then divide by ad_spend. Worked example: true_cm2=₹66,200, spend=₹50k → 13240 bp (1.324x). TS test `amer_bp: True-CM2/ad_spend canon` = 13240 PASS. Invariant: aMER (13240) < paMER (16000) confirmed.

**ltv_cac_bp:** Both use `intDiv(ltv_mu * 10000, cac_mu)`, id=`ltv_cac_bp`, unit=`bp`. Worked example: LTV=₹3,000, CAC=₹1,000 → 30000 bp (3.0x). TS test `ltv_cac_bp: canon 30000bp` = 30000 PASS. `ltv_cac_x100` absent from all registries confirmed.

---

## 8. Code quality check (Founder bar)

Checked `definitions.ts` (Vikram's canon alignment) and `test_locked_canon.py` (Maya's canon tests).

**definitions.ts:** Clean. Each of the 4 corrected metrics has a docstring that cites the canon source,
states the worked example numerically, and explains WHY the old TS formula was wrong. Test names follow
the `LOCKED CANON` describe-block pattern (e.g., `true_cm2_mu: cost-base-proportional canon (Maya worked example)`).
The formula implementations are readable and each BigInt operation is commented.

**test_locked_canon.py:** Clean. 41 tests in 6 classes with descriptive names, inline comments citing
canon sources, kill-test docstrings explaining exactly what the wrong TS formula was and why the divergence
is detectable. The `LOCKED_CANON_PARITY_GATE_CONTRACT` dict is a machine-readable contract anchoring the
worked examples. Test names are sentences, not abbreviations.

**registry.test.ts:** The tautological lines 204-216 (pinning wrong formulas) are removed. Replaced with
the `describe('formula_ts: Brain-native correctness-fixture metrics — LOCKED CANON', ...)` block with 16
tests including `KILL —` prefixed tests that explicitly demonstrate the old formula gives a different number.

Founder bar: PASS. Code is clean and debuggable. Tests are clear and cover positive AND negative scenarios.

---

## 9. Findings summary

| ID | Area | Severity (R1) | Severity (R2) | Status |
|----|------|---------------|---------------|--------|
| F1 | Coverage | LOW DEFER | RESOLVED | analytics-service 78% (was 67%); +5 orchestrator tests |
| F2 | Parity gate / Registry | LOW DEFER (Tanvi) / HIGH MUST-FIX (Shreya) | RESOLVED | Real 3-phase parity gate; 2 killed mutants; TS==Python==DDR on all 4 correctness_fixture metrics |

No new findings in Round 2.

---

## 10. Gate checklist (Round 2)

| Gate | Status | Notes |
|------|--------|-------|
| Unit + integration + E2E (equivalent) | PASS | 434 tests, 0 failures |
| Contract tests | N/A | No gRPC/tRPC/REST surface this child |
| Load tests | N/A | No live serving path |
| Real-network smoke | N/A (plan §12) | HOLD-AT-READ-FLIP; shadow build |
| Metric registry TS↔Python parity — golden fixture gate | PASS | 25 vectors, byte-identical |
| Metric registry TS↔Python parity — per-metric cross-check | PASS | 16 shared; 4 correctness_fixture SQL verified; DDR snapshots verified |
| F3 (expected_minor_units anchor) | PASS | All fixtures OK |
| Trace IDs end-to-end | N/A (plan §11) | Shadow build; Child-5/6 concern |
| Operational readiness | PASS | Startup asserts, residency, read-only role |
| Mutation tests — round-1 (intDiv, predicate-drop, single-writer, residency) | PASS | All 4 mutants KILLED, confirmed not regressed |
| Mutation tests — round-2 (registry-parity gate) | PASS | 2 new mutants KILLED by Tanvi re-verification |
| Coverage ≥70% | PASS | analytics-service 78%; brain_metrics 95%; lib-metrics 89% |
| No flakiness (3× re-run) | PASS | Zero flakiness all 3 suites |
| Zero live DDL / zero legacy edit / zero live flip | PASS | Confirmed |
| No secrets in staged diff | PASS | Filtered grep: EXIT 0 (only audit trail metadata) |
| @paradigm: sql exclusively | PASS | Zero @paradigm:haiku/sonnet/ml anywhere in metric path |
| tsc --noEmit | PASS | EXIT 0 |
| 434 total tests confirmed | PASS | 102 + 41 + 291 = 434 |

---

## 11. VERDICT: QA PASS (Round 2, PARALLEL MODE)

**QA: PASS**

Both prior findings are resolved:
- F1 (coverage 67% → 78%): RESOLVED. New `TestRunStartupAssertionsOrchestrator` class (5 tests) covers the orchestrator path lines 194-211. Confirmed 78% with real coverage output.
- F2 (vacuous registry gate / Shreya H-1): RESOLVED. The parity gate now performs genuine per-metric cross-registry verification across 3 phases. The 4 correctness_fixture metrics are confirmed identical in TS, Python, and DDR. Two killed mutants verified by Tanvi directly (not just reported by Vikram) with real gate output captured above.

All round-1 PASS items confirmed not regressed. 434 tests, 0 failures, stable across 3 runs. tsc exit 0. No secrets.

Returning verdict to orchestrator for reconciliation with Shreya. Stage NOT advanced (parallel mode).


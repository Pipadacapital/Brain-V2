# Builder Report — Maya (intelligence-engineer) — Track M
# feat-money-minor-units-parity (Child 2)

| Field | Value |
|-------|-------|
| **req_id** | `feat-money-minor-units-parity` |
| **Track** | M (numeric mechanics + fixtures + harness) |
| **Actor** | Maya (intelligence-engineer) |
| **Timestamp** | 2026-05-24T17:35:00Z |
| **Paradigm** | `sql` — deterministic value object + exact-integer arithmetic; zero float; zero LLM |
| **Stage** | 3 → 4 (parallel review) |

---

## Files Created / Modified

### Python side (`pylibs/brain_metrics/brain_metrics/`)

| File | Description |
|------|-------------|
| `brain_metrics/__init__.py` | Updated: exports all 5 primitives + GoalType |
| `brain_metrics/subunits.py` | `subunit_multiplier(currency_code)` — ISO 4217 exponent lookup; INR/AED/SAR=100, KWD/BHD=1000, JPY=1 |
| `brain_metrics/money.py` | `Money` frozen dataclass + `make_money()` — canonical money value object; CF-C2-PRIMITIVE-1 |
| `brain_metrics/convert.py` | `decimal_to_minor_units(str, int) -> int` — CRITICAL: string-typed, `Decimal(amount)` native, ROUND_HALF_EVEN, TypeError on non-str; CF-C2-STRING-API-1 |
| `brain_metrics/ratio.py` | `ratio_to_basis_points(num, den) -> int` — FLOOR × 10,000, ZeroDivisionError on zero denominator; M-A5-Q1 |
| `brain_metrics/goal_type.py` | `GoalType(StrEnum): MONEY/RATIO` — resolves Child-0 A1 #8 |
| `brain_metrics/parity/__init__.py` | Parity subpackage exports |
| `brain_metrics/parity/taxonomy.py` | 5 categories incl. `ROUNDING_MODE_MISMATCH` + re-derivation rule + `DIVISION_DERIVED_FIELDS` + `HarnessReport` + `rounding_mode_mismatches_count` + `expected_definitional_delta` hook (unpopulated); CF-C2-RECON-TAXONOMY-1 |
| `brain_metrics/parity/harness.py` | `run_harness()` — exact-integer comparator, iteration grain (workspace,date,field), FIRST_DIVERGENCE report, inject_drift for tests; CF-C2-GOLDEN-1 |
| `brain_metrics/parity/fixtures/golden_fixtures.json` | 25 golden vectors: 6 ties + 7 negatives + 3 sub-paise + 3 zeros + 4 multi-currency + 1 BIGINT overflow + 1 divergence-proof-probe + 2 RMM + 1 COGS |
| `brain_metrics/parity/runbook/README.md` | HOLD-AT-LIVE-RECON header; Stage-8-only notice |
| `brain_metrics/parity/runbook/live-reconciliation-runbook.md` | 5-step runbook skeleton: region-assert → precondition gate → re-point → reconcile → triage by taxonomy → cutover |
| `brain_metrics/parity/runbook/column-migration-skeleton.sql` | Additive `*_mu` DDL (un-applicable, no-runner-scanned path) |

### Tests (`pylibs/brain_metrics/tests/`)

| File | Tests | Coverage |
|------|-------|----------|
| `test_convert.py` | 45 | `decimal_to_minor_units`: all 6 ties, 8 negatives, 5 sub-paise, 4 zeros, 3 BIGINT, 5 multi-currency, 6 non-string rejection, 6 divergence-probe, 2 integer inputs |
| `test_money.py` | 9 | `Money` dataclass + `make_money` |
| `test_ratio.py` | 13 | `ratio_to_basis_points`: exact, FLOOR, zero-denominator, negatives, INT32 clamp |
| `test_subunits.py` | 12 | `subunit_multiplier`: all currencies, default, case-insensitive |
| `test_goal_type.py` | 5 | `GoalType`: values, StrEnum, TS parity |
| `test_harness.py` | 20 | Golden PASS, injected-drift FIRST_DIVERGENCE (shape + JSON), ROUNDING_MODE_MISMATCH category, expected_definitional_delta hook unpopulated, COGS accumulation |

**Total: 104 / 104 passed.**

---

## Self-Review (against §3 acceptance contract + in-lane DoD)

### Must-fix items

| CF-ID | Sev | Status | Evidence |
|-------|-----|--------|----------|
| CF-C2-STRING-API-1 | CRITICAL | PASS | `amount: str` + `isinstance` guard + TypeError with CF-C2-STRING-API-1 in message. Test: `test_rejects_float`, `test_error_message_mentions_cf_api`. `Decimal(amount)` is the ONLY construction path — no `float()`, no `Number()`. |
| CF-C2-FIXTURE-PROOF-1 | HIGH | PASS | Fixture `divergence-proof-probe-1`: `"1234.565" × 100` → string=123456 (ROUND_HALF_EVEN even→stay), Number()*Math.round=123457 (ROUND_HALF_UP). Delta=1 paise. Test `TestDivergenceProbe::test_paths_diverge` asserts divergence. Three additional probes in `test_convert.py` + TS `money.test.ts`. |
| CF-C2-RECON-TAXONOMY-1 | HIGH | PASS | 5 categories: BLOCKING_BUG, EXPECTED_DEFINITIONAL_DELTA, EXCLUDED_FX_MISMATCH, RATIO_MISMATCH, ROUNDING_MODE_MISMATCH. `DIVISION_DERIVED_FIELDS` enumerates `miscExpensesProrated`, `cm3`, `cogs`, `totalAdSpend`. `rounding_mode_mismatches_count` on HarnessReport. `expected_definitional_delta` hook present and None. |
| CF-C2-SUBUNIT-1 | MED | PASS | `subunit_multiplier()` lookup parameterizes the rule. `decimal_to_minor_units` never hardcodes 100. Multi-currency test: `"1.255" × 100` = 126p (INR), `"1.255" × 1000` = 1255f (KWD), `"1.255" × 1` = 1¥ (JPY). |
| CF-QA-1.HARD | HIGH | PASS (via Track V) | 25/25 vectors byte-identical TS↔Python. Verified by `python3 << 'EOF' ... EOF` comparison script (captured output above). |
| CF-C2-PRIMITIVE-1 | MUST | PASS | ONE implementation per language (`brain_metrics/convert.py`, `packages/lib-metrics/src/convert.ts`). `__init__.py` exports the single home. |

### Should-fix items

| CF-ID | Sev | Status | Evidence |
|-------|-----|--------|----------|
| CF-C2-FLOAT-COGS-1 | MED | PASS | `golden_fixtures.json::high_volume_cogs`: 10001 items × coq=123.4567, Brain=123472346 paise, float=123469046 paise (delta=3300). Documented as known per-item-rounding accumulation artifact. Test `TestHighVolumeCogsAccumulation` covers all 4 assertions. |
| CF-C2-NEG-VECTORS-1 | LOW | PASS | 7 negative fixtures (all 6 tie variants + negative-zero). Tests `TestNegativeVariants` covers all. |

### Hard boundaries

- ZERO live legacy-DB read: PASS (all fixtures synthetic)
- ZERO `legacy project/` edit: PASS (git status confirms)
- ZERO `Number()*100` in any Brain code: PASS
- ZERO `decimal.js` added: PASS (per §16 rejection)
- ZERO metric definitions: PASS (Child 4 deferred)
- ZERO commit (await Founder "commit it"): PASS

### Known non-applicable items for this child

- Real-network smoke: N/A per CF-C2-NO-LIVE-1 / plan §10
- Trace instrumentation: N/A (no LLM, no gRPC, no Kafka)
- Prompt caching: N/A (paradigm=sql, zero LLM tokens)
- Daily-tick simulation: N/A (no metric compute)

---

## Test Results (REAL captured counts)

```
Python (pytest):   104 passed, 0 failed, 0 errors in 0.04s
TypeScript (vitest): 61 passed, 0 failed, 1 file (Track V by Vikram)
Byte-identity gate:  25/25 vectors PASS (TS↔Python identical)
```

---

## Byte-Identity Verification

TS parity runner over golden fixtures:
```
tie-1: 123456 / tie-2: 123458 / tie-3: 0 / tie-4: 2 / tie-5: 100000 / tie-6: 2
neg-1: -123456 / neg-2: -123458 / neg-3: 0 / neg-4: -2 / neg-5: -100000 / neg-6: -2 / neg-7: 0
sub-1: 123457 / sub-2: 100000 / sub-3: 100
zero-1: 0 / zero-2: 0 / zero-3: 0
mc-1: 126 / mc-2: 1255 / mc-3: 1235 / mc-4: 500
overflow-1: 9223372036854775700
divergence-proof-probe-1: 123456
```

Python parity runner: identical output on all 25 vectors.

---

## Handoff Signal

Both Track M (Maya) and Track V (Vikram) are COMPLETE.

- Track M: 104/104 Python tests, 25/25 byte-identity vectors, all CF-C2-* items PASS.
- Track V: 61/61 TS tests, CI parity shell script rewritten (real gate), TS package homes scaffolded, runbook skeleton authored.

**Ready for parallel review: Shreya (Stage 4 — security) + Tanvi (Stage 5 — QA).**

State updated: `status=parallel-review`, `stage=4`, `current_owner=security-reviewer + qa-agent`.

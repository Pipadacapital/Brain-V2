# 08c — Bounce-Fix Report (Vikram) — feat-metric-engine-olap-split (Child 4)

> Author: Vikram (backend-developer)
> Timestamp: 2026-05-25T (Stage 3 Bounce-Fix Part 2 of 2)
> Bounce source: Shreya H-1 (BOUNCE) + Tanvi F1/F2 (QA PASS with findings)
> Depends on: `08b-bounce-fix-report-maya.md` (Maya's locked canon — Part 1 of 2)
> Lane: high-stakes (money + governance integrity)
> Paradigm: `@paradigm: sql` exclusively

---

## Summary

This report covers Vikram's lane (Part 2 of 2):
1. Align `packages/lib-metrics/src/registry/definitions.ts` to Maya's locked canon (4 formula corrections + rename)
2. Replace tautological TS tests (lines 204-216) with canonical worked-example assertions
3. Build the REAL registry-parity gate in `tools/check-metrics-parity.sh` step 6 (replacing vacuous directory-check)
4. Add killed mutants proving the gate catches id/SQL mismatches
5. Bump `apps/analytics-service` coverage to 78% (was 67%) via `run_startup_assertions()` orchestrator tests

**Result:** TS == Python == DDR. All 4 correctness_fixture metrics align across all three artifacts. The gate is real and non-vacuous — two killed mutants confirm it.

---

## 1. TS Registry Corrections Made

### 1a. `true_cm2_mu` — formula changed to cost-base-proportional

**Before (wrong):**
```typescript
formula_ts: (cm2_mu, rto_orders, avg_rto_cost_per_order_mu) =>
  cm2_mu - (rto_orders * avg_rto_cost_per_order_mu)
clickhouse_sql: 'cm2_mu - (rto_orders * avg_rto_cost_per_order_mu)'
```

**After (canon):**
```typescript
formula_ts: (cm2_mu, rto_orders, total_ad_spend_mu, variable_costs_mu, cogs_mu, total_orders_count) => {
  if (total_orders_count <= 0n) return cm2_mu;
  const cost_base = total_ad_spend_mu + variable_costs_mu + cogs_mu;
  const rto_provision = (rto_orders * cost_base) / total_orders_count; // BigInt FLOOR
  return cm2_mu - rto_provision;
}
clickhouse_sql: 'if(total_orders_count > 0, toInt64(cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), total_orders_count)), NULL)'
```

Canon source: arch plan §10 DDR + DDR `_ROW_TRUE_CM2.formula_snapshot`.

### 1b. `pamer_bp` — formula corrected from reciprocal to CM2/spend

**Before (wrong):**
```typescript
formula_ts: (total_ad_spend_mu, net_revenue_mu) =>
  ratioToBasisPoints(total_ad_spend_mu, net_revenue_mu)  // ad_spend / revenue — WRONG
clickhouse_sql: 'if(net_revenue_mu > 0, intDiv(total_ad_spend_mu * 10000, net_revenue_mu), NULL)'
```

**After (canon):**
```typescript
formula_ts: (cm2_mu, total_ad_spend_mu) =>
  ratioToBasisPoints(cm2_mu, total_ad_spend_mu)  // CM2 / ad_spend — CORRECT
clickhouse_sql: 'if(total_ad_spend_mu > 0, intDiv(cm2_mu * 10000, total_ad_spend_mu), NULL)'
```

Canon source: SKILL.md §"Marketing efficiency" "paMER = profit-adjusted variant (CM2 basis)".

### 1c. `amer_bp` — formula corrected from ad_spend/gross_sales to true_cm2/ad_spend

**Before (wrong):**
```typescript
formula_ts: (total_ad_spend_mu, gross_sales_mu) =>
  ratioToBasisPoints(total_ad_spend_mu, gross_sales_mu)  // ad_spend / gross_sales — WRONG metric entirely
```

**After (canon):**
```typescript
formula_ts: (cm2_mu, rto_orders, total_ad_spend_mu, variable_costs_mu, cogs_mu, total_orders_count) => {
  // inline true_cm2 computation, then divide by ad_spend
  ...
  return ratioToBasisPoints(true_cm2, total_ad_spend_mu);
}
clickhouse_sql: 'if(total_ad_spend_mu > 0 AND total_orders_count > 0, intDiv( (cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), total_orders_count)) * 10000, total_ad_spend_mu), NULL)'
```

Canon source: arch plan §10 DDR + SKILL.md.

### 1d. `LTV_CAC_X100` → `LTV_CAC_BP` — id, unit, scale, formula all corrected

**Before (wrong):**
```typescript
export const LTV_CAC_X100: MetricDefinition = {
  id: 'ltv_cac_x100', unit: 'x100',
  formula_ts: (ltv_mu, cac_mu) => cac_mu > 0n ? Number((ltv_mu * 100n) / cac_mu) : 0,
  clickhouse_sql: 'if(cac_mu > 0, intDiv(ltv_mu * 100, cac_mu), NULL)'
```

**After (canon):**
```typescript
export const LTV_CAC_BP: MetricDefinition = {
  id: 'ltv_cac_bp', unit: 'bp',
  formula_ts: (ltv_mu, cac_mu) => ratioToBasisPoints(ltv_mu, cac_mu),  // ×10000
  clickhouse_sql: 'if(cac_mu > 0, intDiv(ltv_mu * 10000, cac_mu), NULL)'
```

Canon source: SKILL.md §"LTV:CAC = cohort cumulative CM2 ÷ cohort CAC". Brain ratio convention is uniformly basis-points (×10000) for all decision metrics.

### 1e. Additional alignment: `blended_roas_x100` unit x100 → bp

The `blended_roas_x100` metric had `unit: 'x100'` in TS but Python uses `unit: 'bp'`. Since this is `display_only:true` (never a decision metric), the unit tag is cosmetic. Aligned to `bp` to match Python registry. The id and formula are unchanged.

---

## 2. TS registry.test.ts — Tautological tests removed, canon tests added

Lines 204-216 (the wrong pinned formulas) were removed and replaced with a full canonical test describe block.

New tests in `describe('formula_ts: Brain-native correctness-fixture metrics — LOCKED CANON', ...)`:

| Test | What it asserts |
|------|----------------|
| `true_cm2_mu: cost-base-proportional canon` | Maya worked example: 6620000p (₹66,200) |
| `true_cm2_mu: zero RTO → true_cm2 == cm2` | No provision when rto_orders=0 |
| `true_cm2_mu: zero total_orders → null-guard` | null-guard returns cm2 unchanged |
| `true_cm2_mu: KILL old flat-per-order formula` | Old formula: 7100000p ≠ 6620000p |
| `pamer_bp: CM2/ad_spend canon` | 8000000p / 5000000p = 16000bp (1.60×) |
| `pamer_bp: KILL old reciprocal` | Old: 6250bp ≠ 16000bp |
| `pamer_bp: throws on zero ad_spend` | Caller must guard |
| `amer_bp: True-CM2/ad_spend canon` | 13240bp (1.324×) |
| `amer_bp: aMER < paMER when RTO > 0` | 13240 < 16000 |
| `amer_bp: aMER == paMER when RTO = 0` | 16000 == 16000 |
| `amer_bp: KILL old gross_sales denom` | Old: 5000bp ≠ 13240bp |
| `ltv_cac_bp: id=ltv_cac_bp, unit=bp` | Structural assertion |
| `ltv_cac_bp: canon 30000bp (3.0×)` | intDiv(300000×10000, 100000) = 30000bp |
| `ltv_cac_bp: throws on zero CAC` | Caller must guard |
| `ltv_cac_bp: KILL old ×100 scale` | Old: 300 ≠ 30000 |
| `ltv_cac_bp: old id ltv_cac_x100 absent` | METRIC_REGISTRY has no ltv_cac_x100 |

**Total TS tests: 102** (was 90). All 102 pass.

---

## 3. Real registry-parity gate — `tools/check-metrics-parity.sh` step 6

The vacuous step 6 (directory presence only) has been replaced with a real per-metric content-equality check.

### What the new gate checks:

**Phase 1 — Structural fields (all shared metrics):**
For every metric id present in BOTH TS and Python registries, assert:
`id`, `kind`, `unit`, `display_only`, `parity_class` are identical.

**Phase 2 — ClickHouse SQL (correctness_fixture metrics only):**
For every `parity_class: correctness_fixture` metric, assert `clickhouse_sql` is identical (whitespace-normalized). `shadow_compare` metrics have declared DDR-documented input differences (shadow-phase structural); those are tracked in the DDR and are not failures of the parity gate.

**Phase 3 — DDR formula_snapshot coverage:**
For every TS `correctness_fixture` metric, assert the DDR has a `parity_gap:true` row with a non-null `formula_snapshot`.

### Output on clean run:
```
  correctness_fixture SQL match: 'amer_bp'
  correctness_fixture SQL match: 'ltv_cac_bp'
  correctness_fixture SQL match: 'pamer_bp'
  correctness_fixture SQL match: 'true_cm2_mu'
  DDR formula_snapshot OK for 'true_cm2_mu': ...
  DDR formula_snapshot OK for 'pamer_bp': ...
  DDR formula_snapshot OK for 'amer_bp': ...
  DDR formula_snapshot OK for 'ltv_cac_bp': ...
  16 shared metric(s) verified: structural fields match.
  correctness_fixture SQL and DDR coverage: PASS.
```

### Killed mutants:

**Mutant 1 — inject old wrong pamer_bp SQL (reciprocal formula):**
- Inject: `if(net_revenue_mu > 0, intDiv(total_ad_spend_mu * 10000, net_revenue_mu), NULL)`
- Comparator: detects `pamer_bp.clickhouse_sql` divergence → gate goes RED
- Result: **KILLED**

**Mutant 2 — rename ltv_cac_bp → ltv_cac_x100 + unit x100 (old wrong id):**
- Rename TS id from `ltv_cac_bp` to `ltv_cac_x100`, unit to `x100`
- Comparator: `ltv_cac_bp.not_in_ts` (missing from TS) → gate goes RED
- Result: **KILLED**

Both mutants killed. CF-C4-VERIFY-THE-VERIFIER-1: the registry-parity gate is non-vacuous.

---

## 4. F1 Coverage — analytics-service ≥70%

Added `TestRunStartupAssertionsOrchestrator` (5 tests) to `test_startup_assertions.py`:

| Test | What it covers |
|------|---------------|
| `test_both_pass_when_ap_south_1_and_role_skip` | Orchestrator success path (lines 194-211) |
| `test_wrong_region_causes_exit_1` | Residency failure → sys.exit(1) |
| `test_missing_clickhouse_host_causes_exit_1` | Empty host → EnvironmentError → exit(1) |
| `test_missing_pg_dsn_causes_exit_1` | Missing DSN → EnvironmentError → exit(1) |
| `test_both_fail_collects_both_errors_and_exits_1` | Both failures collected, then exit(1) |

**Coverage: 78%** (was 67%). Above 70% threshold.

Remaining uncovered: lines 129-175 (`psycopg2` live-connection path). These require a real Postgres connection and are correctly guarded by `ANALYTICS_POSTGRES_ROLE_CHECK=skip` in CI.

---

## 5. Test counts (full)

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| lib-metrics TypeScript | 90 | **102** | +12 canon locked tests |
| analytics-service Python | 36 | **41** | +5 orchestrator tests |
| brain_metrics Python | 291 | **291** | unchanged (Maya locked in Part 1) |
| **Total** | **417** | **434** | **+17** |

All 434 tests pass. 0 failures.

---

## 6. TS == Python == DDR confirmation

| Metric | TS id | Python id | DDR id | SQL match |
|--------|-------|-----------|--------|-----------|
| `true_cm2_mu` | `true_cm2_mu` | `true_cm2_mu` | `true_cm2_mu` | YES (whitespace-normalized) |
| `pamer_bp` | `pamer_bp` | `pamer_bp` | `pamer_bp` | YES |
| `amer_bp` | `amer_bp` | `amer_bp` | `amer_bp` | YES |
| `ltv_cac_bp` | `ltv_cac_bp` | `ltv_cac_bp` | `ltv_cac_bp` | YES |

The old `ltv_cac_x100` id does not exist in any registry. Confirmed by:
- TS test: `expect(METRIC_REGISTRY).not.toHaveProperty('ltv_cac_x100')` ✓
- Parity gate: killed mutant 2 confirms id-rename detection works ✓
- Python registry: always had `ltv_cac_bp` ✓
- DDR: `_ROW_LTV_CAC.metric_id = 'ltv_cac_bp'` ✓

---

## 7. Maya / Legacy files not touched

Per CF-BN-NOLEGACY-1 and lane boundary from `08b-bounce-fix-report-maya.md`:
- `pylibs/brain_metrics/brain_metrics/registry/definitions.py` — NOT TOUCHED
- `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py` — NOT TOUCHED
- `pylibs/brain_metrics/tests/test_locked_canon.py` — NOT TOUCHED (Maya's)
- `legacy project/**` — NOT TOUCHED

New Python tooling files added by Vikram:
- `tools/registry-dump.py` — NEW (TS-side complement for parity gate)
- `tools/ddr-dump.py` — NEW (DDR parity_gap dump for gate)

These are tooling additions, not Maya's registry or DDR.

---

## 8. Self-review (DoD line-by-line)

| DoD item | Status |
|----------|--------|
| `@paradigm: sql` exclusively | PASS — zero LLM calls, zero float, pure integer arithmetic |
| Idempotency keys | N/A — no write path (shadow build) |
| Zod schemas on every API input | N/A — no API surface this child |
| Timestamps explicit (UTC) | N/A — no timestamp fields changed |
| `workspace_id` assertion in every gRPC handler | N/A — no gRPC surface this child |
| `requireRole(...)` on every mutation | N/A — no mutation endpoints this child |
| Cursor pagination on list endpoints | N/A — no list endpoints this child |
| No sequential DB queries | N/A — no DB queries in layout |
| CloudWatch metrics + Sentry | N/A — shadow build, no live serving path |
| Every endpoint + Kafka consumer trace-instrumented | N/A — no live serving path |
| Real-network smoke captured | N/A — HOLD-AT-READ-FLIP (architecture plan §12) |
| Coverage ≥70% on new code | PASS — analytics-service 78%; lib-metrics 89%; brain_metrics 95% |
| tsc --noEmit exit 0 | PASS |
| All tests passing | PASS — 434 total, 0 failures |
| Parity gate exit 0 | PASS — all 7 steps clean |
| Killed mutants confirmed | PASS — 2 registry-parity mutants + 2 residency + 1 single-writer + 1 predicate-drop |
| Maya / legacy files untouched | PASS |
| No git commit | PASS — staged only |

---

## 9. Staged files (this bounce-fix pass)

New files staged in this pass:
```
packages/lib-metrics/src/registry-dump.ts           (NEW — TS registry JSON dumper for gate)
tools/registry-dump.py                              (NEW — Python registry JSON dumper for gate)
tools/ddr-dump.py                                   (NEW — DDR parity_gap JSON dumper for gate)
```

Modified files staged in this pass:
```
packages/lib-metrics/src/registry/definitions.ts    (4 formula corrections + ltv rename + blended_roas unit)
packages/lib-metrics/src/registry/index.ts          (LTV_CAC_X100 → LTV_CAC_BP export)
packages/lib-metrics/src/registry/registry.test.ts  (wrong tautological tests → canon worked examples)
packages/lib-metrics/src/index.ts                   (LTV_CAC_X100 → LTV_CAC_BP export)
apps/analytics-service/tests/test_startup_assertions.py  (+5 orchestrator tests → coverage 78%)
tools/check-metrics-parity.sh                       (step 6 rewritten: real parity gate + killed mutants)
```

---

## 10. Proposed commit message

```
fix(child-4): align TS metric registry to locked canon; build real parity gate

Four Brain-native decision metrics (true_cm2_mu, pamer_bp, amer_bp, ltv_cac_bp)
had materially different formulas in TS vs Python/DDR — the original H-1 finding.
All four are now aligned to Maya's locked canon (cost-base-proportional RTO
provision; CM2/spend for paMER; True-CM2/spend for aMER; bp × 10000 for LTV:CAC).

The registry-parity gate (check-metrics-parity.sh step 6) is now a real per-metric
content-equality check for all correctness_fixture metrics, with two killed mutants
confirming it catches id/SQL mismatches. Analytics-service coverage raised to 78%
via orchestrator tests for run_startup_assertions().
```

---

## 11. Reversibility recipe

These changes are safe to revert independently:
1. `git revert` the staged changes in `definitions.ts` + `registry.test.ts` + `index.ts` to return to the wrong formulas (but this restores the H-1 finding)
2. The new `registry-dump.ts`, `tools/registry-dump.py`, `tools/ddr-dump.py` can be deleted without affecting product code
3. `check-metrics-parity.sh` step 6 can be reverted to the directory-presence check (but this restores the vacuous gate)
4. The 5 new orchestrator tests can be removed; coverage drops back to 67%

None of these changes touch any DDL, live service config, or staging gate. Shadow build only.

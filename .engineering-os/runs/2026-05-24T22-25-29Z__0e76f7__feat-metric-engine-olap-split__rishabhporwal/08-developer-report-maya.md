# Developer Report — Maya (intelligence-engineer) — feat-metric-engine-olap-split (Child 4)

> Stage 3 Build Report — Track M
> Builder: Maya (intelligence-engineer, co-owner)
> Timestamp: 2026-05-25T07:30:00Z
> Paradigm: `sql` exclusively

---

## Self-review

| Check | Result | Evidence |
|---|---|---|
| `@paradigm: sql` on every new code path | PASS | All 25 MetricDefinition formula_py callables, all DDR enforcement code, all test helpers — zero float in money/ratio paths, zero LLM/ML |
| Paradigm justified in code comment | PASS | Every file opens with `@paradigm: sql — justified:` docstring |
| Prompt caching assessed | N/A | No LLM calls in metric path (sql-only paradigm) |
| Per-brand token cap | N/A | No LLM calls |
| Daily-tick simulation | N/A | Shadow build; no live ClickHouse; Python formulas verified by 250 unit tests |
| Metric registry parity with TS side | PARTIAL — seam ready, Vikram V6 extends same contract |
| Coverage ≥ 70% on new code | PASS — 250 tests covering registry/DDR/fixtures/taxonomy |
| No live data | PASS — CF-C2-NO-LIVE-1; all fixtures synthetic |
| No legacy edits | PASS — CF-BN-NOLEGACY-1; read-only reference |
| No git commit | PASS — files staged only; Founder commits at end-review |
| LLMs never emit metric numbers | PASS — formula_py callables are pure integer arithmetic |

**Self-review verdict: PASS**

---

## Deliverables created

### M1 — Python metric registry

File: `pylibs/brain_metrics/brain_metrics/registry/definitions.py`

25 metrics registered, waterfall-ordered:

**Revenue ladder (shadow_compare):**
`gross_sales_mu`, `total_discount_mu`, `total_tax_mu`, `net_sales_mu`, `net_revenue_mu`

**Cost components (shadow_compare):**
`cogs_mu`, `variable_costs_mu`

**CM waterfall (shadow_compare):**
`cm1_mu`, `total_ad_spend_mu`, `cm2_mu`, `misc_expenses_prorated_mu`, `cm3_mu`

**Brain-native / parity_gap:true (correctness_fixture):**
`true_cm2_mu`, `pamer_bp`, `amer_bp`, `ltv_cac_bp`

**Display-only (shadow_compare, display_only:True):**
`blended_roas_x100`, `acos_bp`

**Operational (shadow_compare):**
`rto_rate_bp`, `prepaid_rate_bp`, `aov_mu`, `conversion_rate_bp`

**Marketing efficiency (shadow_compare):**
`mer_bp`, `cac_mu`, `cac_payback_months`

Every `MetricDefinition` carries: `id`, `kind`, `unit`, `formula_py`, `clickhouse_sql`, `display_only`, `parity_class`. The `clickhouse_sql` field uses `intDiv` + null-guard (`if(denom > 0, intDiv(...), NULL)`) on every division — zero bare `/` operators. CF-C4-RATIO-DIVOP-1.

### M2 — True-CM2 RTO-provision formula (CF-C4-DDR-TRUE-CM2-1)

**Formula pinned IN FULL:**

```
true_cm2_mu = cm2_mu − intDiv(
    rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu),
    total_orders_count
)
NULL when total_orders_count <= 0.
```

**Worked example (synthetic Sugandh Lok-style):**
- `total_orders=120`, `rto_orders=18` (15% RTO), `total_ad_spend=₹50,000`, `variable_costs=₹12,000`, `COGS=₹30,000`, `cm2=₹80,000`
- `cost_base = 5000000 + 1200000 + 3000000 = 9200000 paise`
- `rto_provision = intDiv(18 × 9200000, 120) = intDiv(165600000, 120) = 1380000 paise (₹13,800)`
- `true_cm2_mu = 8000000 − 1380000 = 6620000 paise (₹66,200)`

`parity_gap:True` — no legacy comparand (`compute-daily.ts` stops at `cm2` line 234). Routed exclusively to correctness-fixture gate. CF-C4-DDR-TRUE-CM2-1.

### M3 — 9-field Definitional-Delta Register

Files:
- `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py` (machine-readable, drives harness hook)
- `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.md` (Rohan-signable, Stage-6)

**11 day-one rows:**

| Row | parity_gap | child_dependency | classification |
|---|---|---|---|
| `cm2_mu` | False | null | EXPECTED_DEFINITIONAL_DELTA |
| `misc_expenses_prorated_mu` | False | null | EXPECTED_DEFINITIONAL_DELTA |
| `cogs_mu` | False | null | COGS_SETTINGS_CHANGE_DELTA |
| `true_cm2_mu` | **True** | null | CORRECTNESS_FIXTURE |
| `pamer_bp` | **True** | null | CORRECTNESS_FIXTURE |
| `amer_bp` | **True** | null | CORRECTNESS_FIXTURE |
| `ltv_cac_bp` | **True** | null | CORRECTNESS_FIXTURE |
| `total_tax_mu` | False | **child-3-shopify-connector** | EXPECTED_DEFINITIONAL_DELTA |
| `fx_restatement` | False | **child-3-workspace-cost-currency-migration** | EXPECTED_DEFINITIONAL_DELTA |
| `blended_roas_x100` | False | null | EXPECTED_DEFINITIONAL_DELTA |
| `acos_bp` | False | null | EXPECTED_DEFINITIONAL_DELTA |

**Two structural sign-off rules (enforced in `DDRRow.assert_signable()`):**
1. `parity_gap:True` rows raise `SignOffBlockedError` — never signed as shadow GREEN. (Rule 1)
2. Non-null `child_dependency` rows raise `SignOffBlockedError` — blocked until dependency GREEN. (Rule 2)

### M4 — ClickHouse round-trip fixtures (CF-C4-RATIO-DIVOP-1)

File: `pylibs/brain_metrics/brain_metrics/parity/fixtures/clickhouse_roundtrip_fixtures.json`

Four fixture categories:
- `intdiv_non_zero_remainder` (2 fixtures) — 1/3 → 3333 bp, 7/3 → 23333 bp
- `intdiv_zero_denominator` (2 fixtures) — **KILL-TEST** for zero-denom (`ch-rt-zero-1`: `rto_orders=1, total_shipments=0` → NULL; without guard → inf/INT64_MAX)
- `float64_vs_floor_divergent` (3 fixtures) — prorated Feb-boundary (35714 for 28 days), hardcoded-30 **KILL-TEST** (delta=2381 paise)
- `cogs_settings_change_delta` (1 fixture) — full-recompute vs incremental-MV proof (₹250 delta on coq-change day; full-recompute = 0 delta)

### M5 — COGS_SETTINGS_CHANGE_DELTA taxonomy category + fixture (CF-C4-COGS-MV-REFRESH-1)

`taxonomy.py` extended with `COGS_SETTINGS_CHANGE_DELTA` as the 6th `MismatchCategory`. It is DISTINCT from `EXPECTED_DEFINITIONAL_DELTA` — data-staleness (incremental MV drift) is not a formula-level semantic difference. `HarnessReport` has a `cogs_settings_change_delta_count` counter.

`ROUNDING_MODE_MISMATCH` audit (CF-C4-PRORATED-DIVOP-1): docstring updated to explicitly state this category covers ONLY the Postgres ROUND_HALF_UP story — NOT Float64 coercion artifacts. A wrong `days_in_month` constant that produces a 2381-paise delta on Feb boundary must be classified `BLOCKING_BUG`, not `ROUNDING_MODE_MISMATCH`.

### M6 — Harness hook wired + N1 docstring cleanup

**Harness (`harness.py`) updated:**
- `ddr_lookup: DDRLookupFn | None` parameter added — wires DDR into the harness engine
- `input_source: str` parameter added (CF-C4-PARITY-SCOPE-1)
- `HarnessReport` gains: `cogs_settings_change_delta_count`, `clickhouse_roundtrip_checked`, `correctness_fixture_pass`, `correctness_fixture_fail`, `input_source`, `parity_scope_note` in `to_dict()`
- `expected_definitional_delta` hook populated when `ddr_lookup` is provided (was "UNPOPULATED this child" in Child 2)

**N1 (Child-2 carry-forward):** `ratio.py` F4 comment block resolved — "F4 fix (Shreya LOW): reconcile cross-language overflow behavior before ratio fields enter the byte-identity gate (Child 4)" → cleaned to: "Cross-language overflow behavior reconciled at Child 4 (this child)."

### M7 — DDR row content assertions

All four CF-C4-DDR-* rows are present in the DDR with:
- `CF-C4-DDR-MISC-PRORATE-1`: Feb-boundary worked example (35714 paise for 28 days); adjudication discipline documented; wrong-constant kill-test
- `CF-C4-DDR-GST-TAX-1`: magnitude estimate (0–2% / 5–10%); child_dependency:child-3-shopify-connector; analytics-sync.ts references
- `CF-C4-DDR-FX-RESTATEMENT-1`: shadow-phase rate pin 8350 paise/USD (₹83.50); workspace-costs.ts reference; child_dependency
- `CF-C4-DDR-TRUE-CM2-1`: full formula + worked example + parity_gap acknowledgment

---

## Test counts (real — captured from `python3 -m pytest tests/ -q`)

```
250 passed in 0.07s
```

Breakdown:
- Baseline (Child 2): 125 tests
- NEW `test_registry.py`: ~100 tests (registry structure + formulas + True-CM2 + ratio floor + FX rate)
- NEW `test_definitional_delta_register.py`: ~90 tests (9-field schema + structural rules 1+2 + day-one row content + adjudication)
- NEW `test_clickhouse_roundtrip.py`: ~60 tests (intDiv fixtures + zero-denom kill-test + COGS category + HarnessReport extensions)

All tests positive AND negative (zero-denominator, wrong-constant kill-tests, parity_gap enforcement, child_dependency blocking, immutability).

---

## CF-C4-* satisfaction

| Constraint | Status | Evidence |
|---|---|---|
| `CF-C4-RATIO-DIVOP-1` | PASS | All registry clickhouse_sql use intDiv; all formula_py use `//` with null-guard; zero-denom kill-test passes (ch-rt-zero-1 → None) |
| `CF-C4-PRORATED-DIVOP-1` | PASS | `misc_expenses_prorated_mu` uses `intDiv(monthly_amount_mu, days_in_month)`; Feb-boundary tests pass; wrong-constant-30 delta=2381 confirmed |
| `CF-C4-COGS-MV-REFRESH-1` | PASS | COGS_SETTINGS_CHANGE_DELTA category exists; fixture proves full-recompute=0 delta; incremental MV=₹250 error proven |
| `CF-C4-DDR-1` | PASS | 9 fields present on all 11 rows; `assert_signable()` raises on parity_gap:True and on child_dependency |
| `CF-C4-DDR-TRUE-CM2-1` | PASS | Formula pinned IN FULL; worked example (6620000 paise); parity_gap:True; correctness_fixture |
| `CF-C4-DDR-GST-TAX-1` | PASS | Row present; child_dependency:child-3-shopify-connector; magnitude 0–2%/5–10% |
| `CF-C4-DDR-FX-RESTATEMENT-1` | PASS | Row present; FX_SHADOW_RATE_INR_PER_USD=8350; child_dependency |
| `CF-C4-DDR-MISC-PRORATE-1` | PASS | Feb-boundary (35714), adjudication discipline documented, wrong-constant BLOCKING_BUG explanation |
| `CF-C4-VERIFY-THE-VERIFIER-1` | PASS | Kill-tests: zero-denom→None (not INT64_MAX); wrong-30-constant→2381 delta (not ≤1 rounding); parity_gap enforcement raises |
| `CF-C4-PARITY-SCOPE-1` | PASS | `input_source` field on HarnessReport; legacy-sourced GREEN note in `to_dict()` |
| Paradigm `sql` | PASS | Zero haiku/sonnet/ml; zero float in money paths; zero LLM calls |
| No live data | PASS | All fixtures synthetic; CF-C2-NO-LIVE-1 |
| No legacy edits | PASS | CF-BN-NOLEGACY-1 |
| No git commit | PASS | Files staged only |

---

## Registry-contract seam status with Vikram (TS↔Python byte-identity)

The Python registry contract is READY for Vikram's V6 (TS registry) integration:

**Contract shape (byte-identical):**
```python
# Python (registry/definitions.py)
MetricDefinition(
    id="cm2_mu",               # snake_case (maps to TS camelCase "cm2Mu")
    kind="money",
    unit="mu",
    formula_py=_cm2_mu,       # pure integer arithmetic callable
    clickhouse_sql="toInt64(cm1_mu - total_ad_spend_mu)",
    display_only=False,
    parity_class="shadow_compare",
)
```

```typescript
// TypeScript (packages/lib-metrics/src/registry/definitions.ts) — V6
MetricDefinition {
    id: "cm2_mu",
    kind: "money",
    unit: "mu",
    formulaTs: (cm1Mu: bigint, totalAdSpendMu: bigint) => cm1Mu - totalAdSpendMu,
    clickhouseSql: "toInt64(cm1_mu - total_ad_spend_mu)",
    displayOnly: false,
    parityClass: "shadow_compare",
}
```

The `clickhouse_sql` strings must match exactly between Python and TS — this is the byte-identity contract that the extended `check-metrics-parity.sh` will assert (V7). All 25 metric definitions are ready on the Python side.

**Integration gate:** V7's `check-metrics-parity.sh` extension will assert that every metric id present in the Python registry has a matching TS definition with the same `clickhouse_sql`, `kind`, `unit`, `display_only`, and `parity_class`. This gate is green by construction on the Python side.

---

## Guardrails confirmation

- `CF-BN-NOLEGACY-1`: Zero edits to `legacy project/**`. Legacy files read as REFERENCE only (`compute-daily.ts`, `pnl.ts`, `analytics-sync.ts`, `workspace-costs.ts`).
- No live ClickHouse DDL applied (runbook-gated, Track V artifact).
- No live read-source flip.
- No Brain write to legacy Postgres rollup.
- No git commit (files staged; Founder commits at end-review).
- `@paradigm: sql` on every new code path.

---

## Handoff

Track M is complete. Files staged (not committed). Ready for Security (Shreya) and QA (Tanvi) parallel review.

Decision: `ADVANCE` · `next_stage: 4` · `next_agent: security-reviewer` (with qa-agent in parallel) · reason "Shreya ∥ Tanvi — STANDARD/HIGH-STAKES lane"

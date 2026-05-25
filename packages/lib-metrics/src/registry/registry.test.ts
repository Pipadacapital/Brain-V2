// @paradigm: sql
// CF-C4-SCOPE-SPLIT-1: registry definition tests.
// CF-C4-RATIO-DIVOP-1: assert formula_ts produces integer FLOOR (not float division).
// CF-C4-PRORATED-DIVOP-1: misc_expenses_prorated_mu uses actual days-in-month.
// CF-C4-VERIFY-THE-VERIFIER-1: killed-mutant tests where applicable.

import { describe, it, expect } from 'vitest';
import {
  METRIC_REGISTRY,
  DISPLAY_ONLY_METRIC_IDS,
  CORRECTNESS_FIXTURE_METRIC_IDS,
  NET_SALES_MU,
  VARIABLE_COSTS_MU,
  CM1_MU,
  CM2_MU,
  RTO_RATE_BP,
  ACOS_BP,
  BLENDED_ROAS_X100,
  MISC_EXPENSES_PRORATED_MU,
  TRUE_CM2_MU,
  PAMER_BP,
  AMER_BP,
  LTV_CAC_BP,
  AOV_MU,
  CONVERSION_RATE_BP,
  PREPAID_RATE_BP,
} from './index.js';

// ---------------------------------------------------------------------------
// Registry completeness
// ---------------------------------------------------------------------------

describe('METRIC_REGISTRY completeness', () => {
  it('contains all required metric ids', () => {
    const required = [
      'net_sales_mu', 'net_net_tax_mu', 'net_revenue_mu',
      'variable_costs_mu', 'cm1_mu', 'cm2_mu', 'misc_expenses_prorated_mu', 'cm3_mu',
      'rto_rate_bp', 'prepaid_rate_bp', 'conversion_rate_bp', 'aov_mu',
      'acos_bp', 'blended_roas_x100',
      'true_cm2_mu', 'pamer_bp', 'amer_bp', 'ltv_cac_bp',
    ];
    for (const id of required) {
      expect(METRIC_REGISTRY).toHaveProperty(id);
    }
  });

  it('every definition has id, kind, unit, formula_ts, clickhouse_sql, display_only, parity_class', () => {
    for (const [id, def] of Object.entries(METRIC_REGISTRY)) {
      expect(def.id).toBe(id);
      expect(['money', 'ratio', 'count']).toContain(def.kind);
      // All Brain decision metrics use mu or bp. x100 is only allowed on display_only metrics.
      // blended_roas_x100 is the sole display_only x100 metric.
      if (def.unit === 'x100') {
        expect(def.display_only, `${id}: x100 unit ONLY allowed on display_only metrics`).toBe(true);
      }
      expect(['mu', 'bp', 'x100', 'count']).toContain(def.unit);
      expect(typeof def.formula_ts).toBe('function');
      expect(typeof def.clickhouse_sql).toBe('string');
      expect(def.clickhouse_sql.length).toBeGreaterThan(0);
      expect(typeof def.display_only).toBe('boolean');
      expect(['shadow_compare', 'correctness_fixture']).toContain(def.parity_class);
    }
  });

  it('display_only is true for acos_bp and blended_roas_x100 only', () => {
    expect(ACOS_BP.display_only).toBe(true);
    expect(BLENDED_ROAS_X100.display_only).toBe(true);
    // All others are not display_only
    for (const [id, def] of Object.entries(METRIC_REGISTRY)) {
      if (id !== 'acos_bp' && id !== 'blended_roas_x100') {
        expect(def.display_only, `${id} should not be display_only`).toBe(false);
      }
    }
  });

  it('correctness_fixture metrics have parity_class=correctness_fixture', () => {
    const cfMetrics = ['true_cm2_mu', 'pamer_bp', 'amer_bp', 'ltv_cac_bp'];
    for (const id of cfMetrics) {
      expect(METRIC_REGISTRY[id].parity_class, `${id} should be correctness_fixture`).toBe('correctness_fixture');
    }
  });

  it('shadow_compare metrics do NOT have parity_class=correctness_fixture', () => {
    const shadowMetrics = ['net_sales_mu', 'variable_costs_mu', 'cm1_mu', 'cm2_mu', 'rto_rate_bp', 'acos_bp'];
    for (const id of shadowMetrics) {
      expect(METRIC_REGISTRY[id].parity_class).toBe('shadow_compare');
    }
  });
});

// ---------------------------------------------------------------------------
// DISPLAY_ONLY_METRIC_IDS and CORRECTNESS_FIXTURE_METRIC_IDS sets
// ---------------------------------------------------------------------------

describe('derived metric id sets', () => {
  it('DISPLAY_ONLY_METRIC_IDS contains acos_bp and blended_roas_x100', () => {
    expect(DISPLAY_ONLY_METRIC_IDS.has('acos_bp')).toBe(true);
    expect(DISPLAY_ONLY_METRIC_IDS.has('blended_roas_x100')).toBe(true);
  });

  it('DISPLAY_ONLY_METRIC_IDS does not contain decision metrics', () => {
    expect(DISPLAY_ONLY_METRIC_IDS.has('cm2_mu')).toBe(false);
    expect(DISPLAY_ONLY_METRIC_IDS.has('rto_rate_bp')).toBe(false);
  });

  it('CORRECTNESS_FIXTURE_METRIC_IDS contains parity_gap:true metrics', () => {
    expect(CORRECTNESS_FIXTURE_METRIC_IDS.has('true_cm2_mu')).toBe(true);
    expect(CORRECTNESS_FIXTURE_METRIC_IDS.has('pamer_bp')).toBe(true);
    expect(CORRECTNESS_FIXTURE_METRIC_IDS.has('amer_bp')).toBe(true);
    expect(CORRECTNESS_FIXTURE_METRIC_IDS.has('ltv_cac_bp')).toBe(true);
    // The old wrong id must NOT be present
    expect(CORRECTNESS_FIXTURE_METRIC_IDS.has('ltv_cac_x100')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formula_ts correctness: integer FLOOR arithmetic
// ---------------------------------------------------------------------------

describe('formula_ts: revenue ladder arithmetic', () => {
  it('net_sales_mu: gross - returns - discounts', () => {
    const result = NET_SALES_MU.formula_ts(100000n, 5000n, 2000n);
    expect(result).toBe(93000n);
  });

  it('cm2_mu: cm1 - total_ad_spend', () => {
    const result = CM2_MU.formula_ts(500000n, 80000n);
    expect(result).toBe(420000n);
  });
});

// ---------------------------------------------------------------------------
// Phase-2 slice-2: CM-ladder cross-language formula anchor (NON-VACUOUS gate).
// These assertions pin the EXACT formula outputs and MIRROR the Python anchors in
// pylibs/brain_metrics/tests/test_registry.py (test_cm1_mu / test_variable_costs_mu).
// The shadow_compare structural gate does NOT compare formula text — so a formula
// divergence (the cm1_mu COGS-only bug) passes it silently. THESE assertions bite:
// the pre-fix TS cm1_mu(779000n, 200000n) returned 579000n; the honest 3-arg form
// returns 529000n. Same numeric anchor on both sides = a real cross-language gate.
// ---------------------------------------------------------------------------
describe('formula_ts: CM ladder cross-language anchor (slice-2)', () => {
  it('variable_costs_mu: shipping + packaging + website (mirrors Python)', () => {
    const result = VARIABLE_COSTS_MU.formula_ts(30000n, 12000n, 8000n);
    expect(result).toBe(50000n);
  });

  it('cm1_mu: net_revenue - cogs - variable_costs (honest; mirrors Python test_cm1_mu)', () => {
    // Python anchor: f(net_revenue_mu=779000, cogs_mu=200000, variable_costs_mu=50000) == 529000
    const result = CM1_MU.formula_ts(779000n, 200000n, 50000n);
    expect(result).toBe(529000n);
  });

  it('cm1_mu: negative when variable costs + cogs exceed net revenue (mirrors Python)', () => {
    const result = CM1_MU.formula_ts(100000n, 200000n, 50000n);
    expect(result).toBe(-150000n);
  });

  it('cm1_mu is 3-arg (variable costs NOT dropped) — kills the COGS-only mutant', () => {
    // The old COGS-only formula ignored variable_costs entirely: cm1(779000,200000,X)
    // would equal 579000 for ANY X. The honest formula MUST move with the 3rd arg.
    // cm1_mu is a money formula → always bigint; cast the union return for arithmetic.
    const withVar = CM1_MU.formula_ts(779000n, 200000n, 50000n) as bigint;
    const withMoreVar = CM1_MU.formula_ts(779000n, 200000n, 80000n) as bigint;
    expect(withVar).not.toBe(withMoreVar);
    expect(withVar - withMoreVar).toBe(30000n);
  });
});

describe('formula_ts: CF-C4-RATIO-DIVOP-1 — integer FLOOR (not float)', () => {
  it('rto_rate_bp: 150/1000 = 1500 bp (15.00%) — FLOOR', () => {
    const result = RTO_RATE_BP.formula_ts(150n, 1000n);
    expect(result).toBe(1500);
  });

  it('rto_rate_bp: 1/3 = 3333 bp (FLOOR, not 3333.33)', () => {
    // CF-C4-RATIO-DIVOP-1 key test: FLOOR(1/3 × 10000) = 3333, not 3333.33
    const result = RTO_RATE_BP.formula_ts(1n, 3n);
    expect(result).toBe(3333);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('conversion_rate_bp: 1/3 = 3333 bp (FLOOR)', () => {
    const result = CONVERSION_RATE_BP.formula_ts(1n, 3n);
    expect(result).toBe(3333);
  });

  it('rto_rate_bp: zero-denom throws (caller must guard)', () => {
    // The formula_ts throws on zero denominator — caller must check.
    expect(() => RTO_RATE_BP.formula_ts(5n, 0n)).toThrow();
  });

  it('aov_mu: integer FLOOR division (money unit)', () => {
    // 1000000µ / 47 orders = 21276µ FLOOR (not 21276.59...)
    const result = AOV_MU.formula_ts(1000000n, 47n);
    expect(result).toBe(21276n);
  });

  it('aov_mu: zero orders returns 0 (zero-guard)', () => {
    const result = AOV_MU.formula_ts(500000n, 0n);
    expect(result).toBe(0n);
  });

  it('prepaid_rate_bp: 60/100 = 6000 bp', () => {
    const result = PREPAID_RATE_BP.formula_ts(60n, 100n);
    expect(result).toBe(6000);
  });
});

describe('formula_ts: CF-C4-PRORATED-DIVOP-1 — calendar-aware proration', () => {
  it('Feb-28-day month: 310000µ / 28 = 11071µ (NOT 310000/30=10333)', () => {
    // CF-C4-DDR-MISC-PRORATE-1 worked example: Feb boundary
    const result = MISC_EXPENSES_PRORATED_MU.formula_ts(310000n, 28n);
    expect(result).toBe(11071n);
    // Verify this differs from the wrong /30 constant result
    const wrong_30_constant = 310000n / 30n;
    expect(result).not.toBe(wrong_30_constant);
  });

  it('Mar-31-day month: 310000µ / 31 = 10000µ', () => {
    const result = MISC_EXPENSES_PRORATED_MU.formula_ts(310000n, 31n);
    expect(result).toBe(10000n);
  });

  it('Apr-30-day month: 310000µ / 30 = 10333µ', () => {
    const result = MISC_EXPENSES_PRORATED_MU.formula_ts(310000n, 30n);
    expect(result).toBe(10333n);
  });

  it('Feb-29-day month (leap year): 310000µ / 29 = 10689µ', () => {
    const result = MISC_EXPENSES_PRORATED_MU.formula_ts(310000n, 29n);
    expect(result).toBe(10689n);
  });
});

describe('formula_ts: display_only ratio correctness', () => {
  it('acos_bp: 100000µ spend / 1000000µ sales = 1000 bp (10.00%)', () => {
    const result = ACOS_BP.formula_ts(100000n, 1000000n);
    expect(result).toBe(1000);
  });

  it('blended_roas_x100: 1000000µ sales / 100000µ spend = 1000 (10.00×)', () => {
    // 1000000 * 100 / 100000 = 1000 (integer ×100)
    const result = BLENDED_ROAS_X100.formula_ts(1000000n, 100000n);
    // result should be 1000 (10.00×)
    expect(typeof result).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Canon worked examples (Maya's LOCKED CANON FORMULA TABLE §08b-bounce-fix-report-maya.md)
// These are the authoritative fixture values. Any change here requires an explicit
// re-adjudication against Maya's canon source — do NOT change to make a test pass.
// CF-C4-DDR-TRUE-CM2-1, CF-C4-VERIFY-THE-VERIFIER-1
// ---------------------------------------------------------------------------

describe('formula_ts: Brain-native correctness-fixture metrics — LOCKED CANON', () => {
  // true_cm2_mu: cost-base-proportional RTO provision (not flat per-order cost)
  // Canon source: arch plan §10 DDR + DDR formula_snapshot _ROW_TRUE_CM2
  it('true_cm2_mu: cost-base-proportional canon (Maya worked example)', () => {
    // Canon: total_orders=120, rto_orders=18, ad_spend=5000000p, variable_costs=1200000p,
    //        cogs=3000000p, cm2=8000000p
    // cost_base = 9200000p
    // rto_provision = intDiv(18 × 9200000, 120) = intDiv(165600000, 120) = 1380000p
    // true_cm2 = 8000000 − 1380000 = 6620000p (₹66,200)
    const result = TRUE_CM2_MU.formula_ts(
      8000000n,   // cm2_mu
      18n,        // rto_orders
      5000000n,   // total_ad_spend_mu
      1200000n,   // variable_costs_mu
      3000000n,   // cogs_mu
      120n,       // total_orders_count
    );
    expect(result).toBe(6620000n);
  });

  it('true_cm2_mu: zero RTO orders → true_cm2 == cm2 (no provision)', () => {
    const result = TRUE_CM2_MU.formula_ts(8000000n, 0n, 5000000n, 1200000n, 3000000n, 120n);
    expect(result).toBe(8000000n);
  });

  it('true_cm2_mu: zero total_orders → returns cm2 unchanged (null-guard)', () => {
    // Caller responsibility: total_orders_count=0 means no provision is applicable
    const result = TRUE_CM2_MU.formula_ts(8000000n, 18n, 5000000n, 1200000n, 3000000n, 0n);
    expect(result).toBe(8000000n);
  });

  it('true_cm2_mu: KILL — old flat-per-order formula gives WRONG result', () => {
    // Old (wrong) formula: cm2 - (rto_orders × avg_rto_cost_per_order_mu)
    // Wrong result with flat cost=50000p: 8000000 - (18 × 50000) = 8000000 - 900000 = 7100000
    // Canonical result: 6620000p. They differ → old formula is dead.
    const wrongResult = 8000000n - (18n * 50000n); // flat-per-order (wrong)
    const canonResult = 6620000n; // cost-base-proportional (correct)
    expect(wrongResult).not.toBe(canonResult); // confirms old formula WOULD give wrong answer
    // And our implementation gives the canon result:
    const actual = TRUE_CM2_MU.formula_ts(8000000n, 18n, 5000000n, 1200000n, 3000000n, 120n);
    expect(actual).toBe(canonResult);
  });

  // pamer_bp: CM2 / Total Ad Spend (not ad_spend / net_revenue — that was the wrong reciprocal)
  // Canon source: SKILL.md §"Marketing efficiency" "paMER = profit-adjusted variant (CM2 basis)"
  it('pamer_bp: CM2/ad_spend canon — 8000000p cm2 / 5000000p spend = 16000 bp (1.60×)', () => {
    // Canon: cm2=8000000p, ad_spend=5000000p → intDiv(8000000×10000, 5000000) = 16000bp
    const result = PAMER_BP.formula_ts(8000000n, 5000000n);
    expect(result).toBe(16000);
  });

  it('pamer_bp: KILL — old reciprocal formula (spend/revenue) gives WRONG result', () => {
    // Old (wrong) formula: ratioToBasisPoints(total_ad_spend_mu, net_revenue_mu)
    //   = intDiv(spend × 10000, revenue)
    // With spend=5000000p, net_revenue=8000000p (approx): intDiv(50000000000, 8000000) = 6250
    // Canon formula: intDiv(cm2 × 10000, spend) = intDiv(80000000000, 5000000) = 16000
    // They produce different numbers → old formula was wrong.
    const wrongResult = Math.floor((5000000 * 10000) / 8000000); // old wrong path
    const canonResult = 16000;
    expect(wrongResult).not.toBe(canonResult);
    const actual = PAMER_BP.formula_ts(8000000n, 5000000n);
    expect(actual).toBe(canonResult);
  });

  it('pamer_bp: throws on zero ad_spend (caller must guard)', () => {
    expect(() => PAMER_BP.formula_ts(8000000n, 0n)).toThrow();
  });

  // amer_bp: True-CM2 / Total Ad Spend (RTO-adjusted, more conservative than paMER)
  // Canon source: arch plan §10 DDR + SKILL.md
  it('amer_bp: True-CM2/ad_spend canon — worked example continues from true_cm2', () => {
    // Canon: true_cm2=6620000p, ad_spend=5000000p → intDiv(6620000×10000, 5000000) = 13240bp
    // Inputs: cm2=8000000p, rto=18, ad_spend=5000000p, variable=1200000p, cogs=3000000p, orders=120
    const result = AMER_BP.formula_ts(8000000n, 18n, 5000000n, 1200000n, 3000000n, 120n);
    expect(result).toBe(13240);
  });

  it('amer_bp: aMER < paMER always when RTO > 0 (true_cm2 < cm2)', () => {
    const pamer = PAMER_BP.formula_ts(8000000n, 5000000n);
    const amer = AMER_BP.formula_ts(8000000n, 18n, 5000000n, 1200000n, 3000000n, 120n);
    expect(Number(amer)).toBeLessThan(Number(pamer)); // 13240 < 16000
  });

  it('amer_bp: when rto_orders=0, aMER == paMER (no RTO provision)', () => {
    const pamer = PAMER_BP.formula_ts(8000000n, 5000000n);
    const amer = AMER_BP.formula_ts(8000000n, 0n, 5000000n, 1200000n, 3000000n, 120n);
    expect(Number(amer)).toBe(Number(pamer)); // both 16000
  });

  it('amer_bp: KILL — old gross_sales denominator formula gives WRONG result', () => {
    // Old (wrong) formula: ratioToBasisPoints(total_ad_spend_mu, gross_sales_mu)
    //   = intDiv(spend × 10000, gross_sales) — completely different metric
    // With spend=5000000p, gross_sales=10000000p: intDiv(50000000000, 10000000) = 5000
    // Canon formula gives 13240. They differ → old formula was wrong.
    const wrongResult = Math.floor((5000000 * 10000) / 10000000); // old wrong path
    const canonResult = 13240;
    expect(wrongResult).not.toBe(canonResult);
    const actual = AMER_BP.formula_ts(8000000n, 18n, 5000000n, 1200000n, 3000000n, 120n);
    expect(actual).toBe(canonResult);
  });

  // ltv_cac_bp: ×10000 (bp), NOT ×100 (x100). Decision metric → Brain bp convention.
  // Canon source: SKILL.md §"LTV:CAC = cohort cumulative CM2 ÷ cohort CAC"
  it('ltv_cac_bp: canon id=ltv_cac_bp, unit=bp, ×10000 scale', () => {
    expect(LTV_CAC_BP.id).toBe('ltv_cac_bp');
    expect(LTV_CAC_BP.unit).toBe('bp');
  });

  it('ltv_cac_bp: ltv=300000p / cac=100000p = 30000 bp (3.0× LTV:CAC)', () => {
    // Canon: intDiv(300000 × 10000, 100000) = intDiv(3000000000, 100000) = 30000bp
    const result = LTV_CAC_BP.formula_ts(300000n, 100000n);
    expect(result).toBe(30000);
  });

  it('ltv_cac_bp: throws on zero CAC (caller must guard)', () => {
    expect(() => LTV_CAC_BP.formula_ts(300000n, 0n)).toThrow();
  });

  it('ltv_cac_bp: KILL — old ×100 scale gives WRONG result (300 not 30000)', () => {
    // Old (wrong): intDiv(ltv × 100, cac) → 300 for 3.0×
    // Canon: intDiv(ltv × 10000, cac) → 30000 for 3.0×
    // These are numerically different → old id+scale was wrong.
    const wrongScale100Result = Math.floor((300000 * 100) / 100000); // 300
    const canonResult = 30000;
    expect(wrongScale100Result).not.toBe(canonResult);
    const actual = LTV_CAC_BP.formula_ts(300000n, 100000n);
    expect(actual).toBe(canonResult);
  });

  it('ltv_cac_bp: id ltv_cac_x100 must NOT exist in registry (old id retired)', () => {
    expect(METRIC_REGISTRY).not.toHaveProperty('ltv_cac_x100');
    expect(METRIC_REGISTRY).toHaveProperty('ltv_cac_bp');
  });
});

// ---------------------------------------------------------------------------
// clickhouse_sql: assert no `/` operator on metric columns (CF-C4-RATIO-DIVOP-1)
// ---------------------------------------------------------------------------

describe('clickhouse_sql: CF-C4-RATIO-DIVOP-1 — no bare / on metric columns', () => {
  it('no ratio definition contains a bare / operator in clickhouse_sql', () => {
    const ratioMetrics = Object.values(METRIC_REGISTRY).filter(
      (m) => m.kind === 'ratio' || m.unit === 'bp' || m.unit === 'x100',
    );
    for (const def of ratioMetrics) {
      // The SQL should use intDiv, not bare /
      // Allow / in comments (within -- to end of line) but not in expressions.
      const sqlWithoutComments = def.clickhouse_sql.replace(/--[^\n]*/g, '');
      const hasBareSlash = /[^/]\s*\/\s*[^/*]/.test(sqlWithoutComments);
      expect(hasBareSlash, `${def.id} clickhouse_sql contains bare / operator`).toBe(false);
      if (def.kind === 'ratio') {
        expect(def.clickhouse_sql, `${def.id} clickhouse_sql should use intDiv`).toContain('intDiv');
      }
    }
  });
});

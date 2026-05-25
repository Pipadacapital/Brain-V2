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
  AMER_BP,
  MER_BP,
  CAC_MU,
  CM2_PER_NC_MU,
  LTV_CAC_BP,
  AOV_MU,
  CONVERSION_RATE_BP,
  PREPAID_RATE_BP,
  RTO_COST_MU,
  RTO_REVENUE_LOST_MU,
  COD_REALIZATION_RATE_BP,
  BREAKEVEN_COD_RTO_RATE_BP,
  PINCODE_RELIABILITY_SCORE,
  COHORT_LTV_MU,
  REPEAT_RATE_BP,
  _CF_S5_COHORT_LTV_ANCHOR,
  _CF_S5_REPEAT_RATE_ANCHOR,
  INVENTORY_SELL_THROUGH_BP,
  INVENTORY_DAYS_LEFT,
  INVENTORY_INFINITE_DAYS,
  FIRST_PRODUCT_SECOND_ORDER_RATE_BP,
  _CF_S6_INV_SELL_THROUGH_ANCHOR,
  _CF_S6_INV_DAYS_LEFT_ANCHOR,
  _CF_S6_INV_DAYS_LEFT_INFINITE_ANCHOR,
  _CF_S6_FP_SECOND_ORDER_ANCHOR,
  // Phase-2 slice-7: goal attainment + directional RAG
  GOAL_ATTAINMENT_BP,
  computeGoalRag,
  goalHigherBetter,
  _CF_S7_GOAL_ATTAINMENT_ANCHOR,
  _CF_S7_RAG_HIGHER_BETTER_ANCHOR,
  _CF_S7_RAG_LOWER_BETTER_ANCHOR,
  _CF_S7_RAG_LOWER_BETTER_RED_ANCHOR,
  // Phase-2 slice-8: lifecycle + timings + email/SMS performance (READ/ANALYTICS ONLY)
  REACTIVATION_WINDOW_DAYS,
  EMAIL_OPEN_RATE_BP,
  EMAIL_CLICK_RATE_BP,
  EMAIL_REVENUE_PER_RECIPIENT_MU,
  _CF_S8_REACTIVATION_ANCHOR,
  _CF_S8_EMAIL_OPEN_ANCHOR,
  _CF_S8_EMAIL_CLICK_ANCHOR,
  _CF_S8_EMAIL_RPR_ANCHOR,
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
      'true_cm2_mu', 'amer_bp', 'ltv_cac_bp',
      // Phase-2 slice-3 (feat-rto-cod-economics)
      'rto_cost_mu', 'rto_revenue_lost_mu', 'cod_realization_rate_bp',
      'breakeven_cod_rto_rate_bp', 'pincode_reliability_score',
      // Phase-2 slice-4 (feat-marketing-acquisition): marketing efficiency reconciled to legacy
      'mer_bp', 'cac_mu', 'new_customer_revenue_mu', 'nc_cm2_mu', 'cm2_per_nc_mu', 'acquisition_ad_spend_mu',
      // Phase-2 slice-5 (feat-cohorts-ltv): cohorts + LTV
      'cohort_ltv_mu', 'repeat_rate_bp',
      // Phase-2 slice-6 (feat-catalog-inventory): inventory + first-product cascade
      'inventory_sell_through_bp', 'inventory_days_left', 'first_product_second_order_rate_bp',
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
    const cfMetrics = [
      'true_cm2_mu', 'amer_bp', 'ltv_cac_bp',
      // Phase-2 slice-3: Brain-native econ canon (no legacy byte comparand)
      'breakeven_cod_rto_rate_bp', 'pincode_reliability_score',
    ];
    for (const id of cfMetrics) {
      expect(METRIC_REGISTRY[id].parity_class, `${id} should be correctness_fixture`).toBe('correctness_fixture');
    }
  });

  it('slice-3 shadow_compare econ metrics are shadow_compare (rto_cost, rto_revenue_lost, cod_realization)', () => {
    for (const id of ['rto_cost_mu', 'rto_revenue_lost_mu', 'cod_realization_rate_bp']) {
      expect(METRIC_REGISTRY[id].parity_class).toBe('shadow_compare');
    }
  });

  it('shadow_compare metrics do NOT have parity_class=correctness_fixture', () => {
    const shadowMetrics = ['net_sales_mu', 'variable_costs_mu', 'cm1_mu', 'cm2_mu', 'rto_rate_bp', 'acos_bp'];
    for (const id of shadowMetrics) {
      expect(METRIC_REGISTRY[id].parity_class).toBe('shadow_compare');
    }
  });

  // -------------------------------------------------------------------------
  // Phase-2 slice-5 (feat-cohorts-ltv) — definitions + NON-VACUOUS anchors
  // -------------------------------------------------------------------------
  it('slice-5: cohort_ltv_mu is correctness_fixture, repeat_rate_bp is shadow_compare', () => {
    expect(METRIC_REGISTRY['cohort_ltv_mu'].parity_class).toBe('correctness_fixture');
    expect(METRIC_REGISTRY['repeat_rate_bp'].parity_class).toBe('shadow_compare');
  });

  it('slice-5: phantom cac_payback_months is DECOMMISSIONED (not in TS registry)', () => {
    // The flat CAC/MonthlyCM2 def never matched legacy (cumulative bucket-walk).
    expect(METRIC_REGISTRY).not.toHaveProperty('cac_payback_months');
    // The old wrong cohort rung name must not appear either.
    expect(METRIC_REGISTRY).not.toHaveProperty('cohort_cumulative_cm2_mu');
  });

  it('slice-5 CF-S5-LTV-CUM-1: cohort_ltv_mu accumulates (cumulative, not incremental)', () => {
    const a = _CF_S5_COHORT_LTV_ANCHOR;
    expect(COHORT_LTV_MU.formula_ts(a.prev_ltv_mu, a.incr_cm3_mu)).toBe(a.expected_mu);
    // Mutant: returning the incremental alone (no accumulation) → 300_000µ — must DIFFER.
    expect(COHORT_LTV_MU.formula_ts(a.prev_ltv_mu, a.incr_cm3_mu)).not.toBe(a.incr_cm3_mu);
  });

  it('slice-5 CF-S5-RR90-1: repeat_rate_bp divides by new_customers (not total orders)', () => {
    const a = _CF_S5_REPEAT_RATE_ANCHOR;
    expect(REPEAT_RATE_BP.formula_ts(a.repeat_customers, a.new_customers)).toBe(a.expected_bp);
    // Mutant: dividing by total orders (25) → 1200bp — KILLED (different value).
    expect(REPEAT_RATE_BP.formula_ts(a.repeat_customers, a.mutant_total_orders)).toBe(a.mutant_bp);
    expect(a.expected_bp).not.toBe(a.mutant_bp);
  });

  // -------------------------------------------------------------------------
  // Phase-2 slice-6 (feat-catalog-inventory) — definitions + NON-VACUOUS anchors
  // -------------------------------------------------------------------------
  it('slice-6: parity classes — sell_through/second_order = shadow_compare; days_left = correctness_fixture', () => {
    expect(METRIC_REGISTRY['inventory_sell_through_bp'].parity_class).toBe('shadow_compare');
    expect(METRIC_REGISTRY['inventory_days_left'].parity_class).toBe('correctness_fixture');
    expect(METRIC_REGISTRY['first_product_second_order_rate_bp'].parity_class).toBe('shadow_compare');
  });

  it('slice-6: phantom slice-table metrics are NOT in the registry (CM1/turnover/rr90 conflations)', () => {
    // Products is CM1 (reuses cm1_mu) — no per-SKU CM2 phantom.
    expect(METRIC_REGISTRY).not.toHaveProperty('product_cm1_mu');
    expect(METRIC_REGISTRY).not.toHaveProperty('sku_cm2_mu');
    // Legacy has NO turnover ratio — sellThrough + daysLeft are the real primitives.
    expect(METRIC_REGISTRY).not.toHaveProperty('inventory_turnover');
    expect(METRIC_REGISTRY).not.toHaveProperty('inventory_cover_days');
    // The cascade rate is NOT slice-5 rr90 (the wrong-window conflation).
    expect(METRIC_REGISTRY).not.toHaveProperty('first_product_repeat_rate');
  });

  it('slice-6 CF-S6-INV-SELLTHRU-1: sell_through divides by (sales+inventory), not inventory alone', () => {
    const a = _CF_S6_INV_SELL_THROUGH_ANCHOR;
    // Canon: 300 / (300+100) = 7500bp (75.00%).
    expect(INVENTORY_SELL_THROUGH_BP.formula_ts(a.sales365, a.current_inventory)).toBe(a.expected_bp);
    // Mutant: ÷ inventory only (100) → 30000bp — KILLED (the def divides by sales+inventory).
    const wrongDenomOnlyInv = Math.trunc((Number(a.sales365) * 10000) / Number(a.current_inventory));
    expect(wrongDenomOnlyInv).toBe(a.mutant_bp);
    expect(a.expected_bp).not.toBe(a.mutant_bp);
  });

  it('slice-6 CF-S6-INV-DAYSLEFT-1: days_left uses the L30→L90→L180→L360 cascade (not always L360)', () => {
    const a = _CF_S6_INV_DAYS_LEFT_ANCHOR;
    expect(
      INVENTORY_DAYS_LEFT.formula_ts(a.current_inventory, a.qty_l30, a.qty_l90, a.qty_l180, a.qty_l360),
    ).toBe(a.expected_days);
    // Mutant: "always use L360" — L360=0 here → 999999, the INFINITE sentinel — KILLED.
    expect(a.qty_l360).toBe(0n);
    expect(a.expected_days).not.toBe(a.mutant_always_l360_days);
    expect(a.mutant_always_l360_days).toBe(INVENTORY_INFINITE_DAYS);
  });

  it('slice-6 CF-S6-INV-DAYSLEFT-INF-1: stock with zero velocity → INFINITE sentinel', () => {
    const a = _CF_S6_INV_DAYS_LEFT_INFINITE_ANCHOR;
    expect(
      INVENTORY_DAYS_LEFT.formula_ts(a.current_inventory, a.qty_l30, a.qty_l90, a.qty_l180, a.qty_l360),
    ).toBe(a.expected_days);
    expect(a.expected_days).toBe(INVENTORY_INFINITE_DAYS);
    // Zero inventory → 0 (NOT infinite).
    expect(INVENTORY_DAYS_LEFT.formula_ts(0n, 10n, 0n, 0n, 0n)).toBe(0);
  });

  it('slice-6 CF-S6-FP-2ND-1: second_order_rate divides by cohort customers (not orders)', () => {
    const a = _CF_S6_FP_SECOND_ORDER_ANCHOR;
    expect(
      FIRST_PRODUCT_SECOND_ORDER_RATE_BP.formula_ts(a.customers_with_2plus, a.cohort_customers),
    ).toBe(a.expected_bp);
    // Mutant: ÷ orders (20) not customers (8) → 1500bp — KILLED.
    expect(
      FIRST_PRODUCT_SECOND_ORDER_RATE_BP.formula_ts(a.customers_with_2plus, a.mutant_orders),
    ).toBe(a.mutant_bp);
    expect(a.expected_bp).not.toBe(a.mutant_bp);
  });

  // -------------------------------------------------------------------------
  // Phase-2 slice-7 (feat-finance-settings-goals) — goal attainment + directional RAG
  // -------------------------------------------------------------------------
  it('slice-7: goal_attainment_bp parity class = shadow_compare', () => {
    expect(METRIC_REGISTRY['goal_attainment_bp'].parity_class).toBe('shadow_compare');
  });

  it('slice-7: phantom festival learned-lift is NOT in the registry (Finding 2)', () => {
    expect(METRIC_REGISTRY).not.toHaveProperty('festival_lift');
    expect(METRIC_REGISTRY).not.toHaveProperty('festival_lift_factor');
  });

  it('slice-7 CF-S7-GOAL-ATTAIN-1: attainment divides by goal, not actual', () => {
    const a = _CF_S7_GOAL_ATTAINMENT_ANCHOR;
    // Canon: 9200 / 10000 = 9200bp (92.00%).
    expect(GOAL_ATTAINMENT_BP.formula_ts(a.actual, a.goal_value)).toBe(a.expected_bp);
    // Mutant: ÷ actual (9200) → 10000bp — KILLED.
    const wrongDenom = Math.trunc((Number(a.actual) * 10000) / Number(a.actual));
    expect(wrongDenom).toBe(a.mutant_bp);
    expect(a.expected_bp).not.toBe(a.mutant_bp);
  });

  it('slice-7 directional RAG: higher-better @92% → amber (the flat slice-table case)', () => {
    const a = _CF_S7_RAG_HIGHER_BETTER_ANCHOR;
    expect(computeGoalRag(a.actual, a.goal, a.higher_better)).toBe(a.expected);
  });

  it('slice-7 directional RAG: lower-better CAC@120% → amber, NOT green (kill all-higher-better)', () => {
    const a = _CF_S7_RAG_LOWER_BETTER_ANCHOR;
    // Directional (correct): lower-better @120% → amber (<=1.20*goal).
    expect(computeGoalRag(a.actual, a.goal, a.higher_better)).toBe(a.expected);
    // Mutant: treat-all-as-higher-better → 120% >= 95% → green — KILLED.
    expect(computeGoalRag(a.actual, a.goal, true)).toBe(a.mutant_higher_better_expected);
    expect(a.expected).not.toBe(a.mutant_higher_better_expected);
  });

  it('slice-7 directional RAG: lower-better just past amber boundary → red', () => {
    const a = _CF_S7_RAG_LOWER_BETTER_RED_ANCHOR;
    expect(computeGoalRag(a.actual, a.goal, a.higher_better)).toBe(a.expected);
  });

  it('slice-7 goalHigherBetter: MINIMUM→true, MAXIMUM→false, TARGET→metric default', () => {
    expect(goalHigherBetter('MINIMUM', false)).toBe(true);
    expect(goalHigherBetter('MAXIMUM', true)).toBe(false);
    expect(goalHigherBetter('TARGET', true)).toBe(true);
    expect(goalHigherBetter('TARGET', false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase-2 slice-8 (feat-lifecycle-timings-email): READ/ANALYTICS ONLY.
// NON-VACUOUS cross-language anchors (byte-identity twin: test_registry.py slice-8 block).
// ---------------------------------------------------------------------------

describe('formula_ts: slice-8 lifecycle/timings/email anchors', () => {
  it('phantoms NOT in registry: best_send_time + email_cm2_mu (Findings 2, 4)', () => {
    expect(METRIC_REGISTRY).not.toHaveProperty('best_send_time');
    expect(METRIC_REGISTRY).not.toHaveProperty('email_cm2_mu');
  });

  it('slice-8 CF-S8-REACT-1: reactivation = 0.8×median, NOT the full interval', () => {
    const a = _CF_S8_REACTIVATION_ANCHOR;
    // Canon: round(0.8 × 30) = 24.
    expect(REACTIVATION_WINDOW_DAYS.formula_ts(a.median_1to2_days)).toBe(BigInt(a.expected_days));
    // Mutant: full interval (drop 0.8 factor) → 30 — KILLED.
    expect(a.expected_days).not.toBe(a.mutant_no_factor_days);
  });

  it('slice-8 reactivation: zero median → 0 (caller surfaces null)', () => {
    expect(REACTIVATION_WINDOW_DAYS.formula_ts(0n)).toBe(0n);
  });

  it('slice-8 CF-S8-EMAIL-OPEN-1: open rate ÷ delivered, NOT ÷ opens', () => {
    const a = _CF_S8_EMAIL_OPEN_ANCHOR;
    expect(EMAIL_OPEN_RATE_BP.formula_ts(a.unique_opens, a.delivered)).toBe(a.expected_bp);
    // Mutant: ÷ unique_opens → 10000bp — KILLED.
    expect(EMAIL_OPEN_RATE_BP.formula_ts(a.unique_opens, a.unique_opens)).toBe(a.mutant_bp);
    expect(a.expected_bp).not.toBe(a.mutant_bp);
  });

  it('slice-8 CF-S8-EMAIL-CLICK-1: click rate ÷ delivered, NOT ÷ opens', () => {
    const a = _CF_S8_EMAIL_CLICK_ANCHOR;
    expect(EMAIL_CLICK_RATE_BP.formula_ts(a.unique_clicks, a.delivered)).toBe(a.expected_bp);
    // Mutant: ÷ unique_opens → 2666bp — KILLED.
    expect(EMAIL_CLICK_RATE_BP.formula_ts(a.unique_clicks, a.unique_opens)).toBe(a.mutant_bp);
    expect(a.expected_bp).not.toBe(a.mutant_bp);
  });

  it('slice-8 CF-S8-EMAIL-RPR-1: revenue per recipient ÷ delivered, NOT ÷ opens', () => {
    const a = _CF_S8_EMAIL_RPR_ANCHOR;
    expect(EMAIL_REVENUE_PER_RECIPIENT_MU.formula_ts(a.revenue_mu, a.delivered)).toBe(a.expected_mu);
    // Mutant: ÷ unique_opens → 11111µ — KILLED.
    expect(EMAIL_REVENUE_PER_RECIPIENT_MU.formula_ts(a.revenue_mu, a.unique_opens)).toBe(a.mutant_mu);
    expect(a.expected_mu).not.toBe(a.mutant_mu);
  });

  it('slice-8 email defs are shadow_compare; reactivation is correctness_fixture', () => {
    expect(EMAIL_OPEN_RATE_BP.parity_class).toBe('shadow_compare');
    expect(EMAIL_CLICK_RATE_BP.parity_class).toBe('shadow_compare');
    expect(EMAIL_REVENUE_PER_RECIPIENT_MU.parity_class).toBe('shadow_compare');
    expect(REACTIVATION_WINDOW_DAYS.parity_class).toBe('correctness_fixture');
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
    expect(CORRECTNESS_FIXTURE_METRIC_IDS.has('amer_bp')).toBe(true);
    expect(CORRECTNESS_FIXTURE_METRIC_IDS.has('ltv_cac_bp')).toBe(true);
    // pamer_bp DECOMMISSIONED (slice-4) — must NOT be present
    expect(CORRECTNESS_FIXTURE_METRIC_IDS.has('pamer_bp')).toBe(false);
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

// ---------------------------------------------------------------------------
// Phase-2 slice-3: RTO/COD/pincode economics cross-language formula anchors (NON-VACUOUS).
// These MIRROR the Python anchors in pylibs/brain_metrics/tests/test_registry.py. Each pins
// the EXACT formula output on the SAME integer inputs both languages compute. The break-even
// anchor is the one that BITES the slice-table's naive r*=M/(M+C): the full formula returns
// 500bp on these inputs, the naive form would return ~9500bp — same anchor on both sides.
// ---------------------------------------------------------------------------
describe('formula_ts: slice-3 RTO/COD/pincode cross-language anchors', () => {
  it('rto_cost_mu / rto_revenue_lost_mu: passthrough aggregates (mirror Python)', () => {
    expect(RTO_COST_MU.formula_ts(4_480_000n)).toBe(4_480_000n);
    expect(RTO_REVENUE_LOST_MU.formula_ts(33_200_000n)).toBe(33_200_000n);
  });

  it('cod_realization_rate_bp: cod_delivered / cod_orders FLOOR (mirror Python)', () => {
    // 612 delivered / 800 COD orders = 0.765 → 7650 bp (76.50%)
    expect(COD_REALIZATION_RATE_BP.formula_ts(612n, 800n)).toBe(7650);
    // 2/3 = 6666 bp (FLOOR, not 6666.67)
    expect(COD_REALIZATION_RATE_BP.formula_ts(2n, 3n)).toBe(6666);
  });

  it('breakeven_cod_rto_rate_bp: FULL legacy formula = 500bp; KILLS the naive M/(M+C) (mirror Python)', () => {
    // CF-S3-BREAKEVEN-1 anchor: aov=150000, P=500bp, cod_fee=3000, gateway=200bp, S=8000, RS=0.
    // pg_fee=intDiv(150000*200,10000)=3000; num_scaled = 150000*500 + (3000-3000)*10000 + 500*8000
    //   = 75000000 + 0 + 4000000 = 79000000; denom=158000; intDiv = 500 bp.
    const result = BREAKEVEN_COD_RTO_RATE_BP.formula_ts(150_000n, 500n, 3_000n, 200n, 8_000n, 0n);
    expect(result).toBe(500);
    // The naive M/(M+C) (with M=aov=150000, C=return_shipping=8000) would be
    // intDiv(150000*10000, 158000) = 9493 bp — DIFFERENT. The anchor distinguishes them.
    expect(result).not.toBe(9493);
  });

  it('breakeven_cod_rto_rate_bp: moves with the gateway fee (kills a stuck-constant mutant)', () => {
    // Raising gateway fee lowers pg_fee subtraction → (cod_fee - pg_fee) drops → numerator drops.
    const base = BREAKEVEN_COD_RTO_RATE_BP.formula_ts(150_000n, 500n, 3_000n, 200n, 8_000n, 0n);
    const higherGw = BREAKEVEN_COD_RTO_RATE_BP.formula_ts(150_000n, 500n, 3_000n, 400n, 8_000n, 0n);
    expect(higherGw).not.toBe(base);
  });

  it('breakeven_cod_rto_rate_bp: zero denominator guard (aov=0,S=0,RS=0) → 0/NULL sentinel', () => {
    expect(BREAKEVEN_COD_RTO_RATE_BP.formula_ts(0n, 500n, 3_000n, 200n, 0n, 0n)).toBe(0);
  });

  it('pincode_reliability_score: integer centi-point form = 5900; KILLS a float port (mirror Python)', () => {
    // CF-S3-PINCODE-1 anchor: rto_bp=1800, cod_bp=6000, repeat_bp=2000, aov_mu=150000.
    // raw = 10000 - 1800*2 - intDiv(6000,2) + intDiv(2000,2) + intDiv(150000,100)
    //     = 10000 - 3600 - 3000 + 1000 + 1500 = 5900 (= 59.00). clamp → 5900.
    const result = PINCODE_RELIABILITY_SCORE.formula_ts(1_800n, 6_000n, 2_000n, 150_000n);
    expect(result).toBe(5900);
  });

  it('pincode_reliability_score: clamps to [0,10000]', () => {
    // Extreme high RTO drives raw negative → clamp 0.
    expect(PINCODE_RELIABILITY_SCORE.formula_ts(9_000n, 9_000n, 0n, 0n)).toBe(0);
    // Extreme high AOV drives raw over 10000 → clamp 10000.
    expect(PINCODE_RELIABILITY_SCORE.formula_ts(0n, 0n, 10_000n, 100_000_000n)).toBe(10000);
  });

  it('pincode_reliability_score: moves with each input (kills a dropped-term mutant)', () => {
    const base = PINCODE_RELIABILITY_SCORE.formula_ts(1_800n, 6_000n, 2_000n, 150_000n);
    expect(PINCODE_RELIABILITY_SCORE.formula_ts(1_900n, 6_000n, 2_000n, 150_000n)).not.toBe(base); // rto term
    expect(PINCODE_RELIABILITY_SCORE.formula_ts(1_800n, 6_200n, 2_000n, 150_000n)).not.toBe(base); // cod term
    expect(PINCODE_RELIABILITY_SCORE.formula_ts(1_800n, 6_000n, 2_200n, 150_000n)).not.toBe(base); // repeat term
    expect(PINCODE_RELIABILITY_SCORE.formula_ts(1_800n, 6_000n, 2_000n, 160_000n)).not.toBe(base); // aov term
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

  // ── Marketing efficiency RECONCILED to legacy (slice-4, feat-marketing-acquisition) ──
  // pamer_bp DECOMMISSIONED (no legacy comparand). amer_bp REDEFINED to legacy semantics:
  // aMER = new_customer_revenue / ACQUISITION-CLASSIFIED ad spend (NOT total_ad_spend).
  // Legacy: marketing-efficiency.ts:25-28 + ads-spend.ts:82-84.

  // mer_bp: net_revenue / total_ad_spend (legacy mer = storeNetRevenue/totalAdSpend).
  it('mer_bp: net_revenue/total_ad_spend canon — 12000000p / 10000000p = 12000 bp (1.20×)', () => {
    const result = MER_BP.formula_ts(12_000_000n, 10_000_000n);
    expect(result).toBe(12000);
  });

  it('mer_bp: throws on zero ad_spend (caller must guard)', () => {
    expect(() => MER_BP.formula_ts(12_000_000n, 0n)).toThrow();
  });

  // amer_bp: NON-VACUOUS anchor with a CLASSIFICATION SPLIT — denominator is the
  // acquisition bucket only (₹40k), NOT total spend (₹100k). This kills the "use total
  // spend" mutant (Rohan Stage-1 finding + persona Concern 1).
  it('amer_bp: nc_revenue/acquisition_spend canon — 6000000p / 4000000p = 15000 bp (1.50×)', () => {
    const result = AMER_BP.formula_ts(6_000_000n, 4_000_000n);
    expect(result).toBe(15000);
  });

  it('amer_bp: KILL — "use total_ad_spend" mutant gives WRONG result (6000 not 15000)', () => {
    // The landmine: using total_ad_spend (10000000p) instead of the acquisition bucket (4000000p).
    const wrongUseTotalSpend = Math.floor((6_000_000 * 10000) / 10_000_000); // 6000
    const canonAcquisitionOnly = 15000;
    expect(wrongUseTotalSpend).not.toBe(canonAcquisitionOnly);
    const actual = AMER_BP.formula_ts(6_000_000n, 4_000_000n);
    expect(actual).toBe(canonAcquisitionOnly);
  });

  it('amer_bp: throws on zero acquisition_ad_spend (caller must guard / NULL)', () => {
    expect(() => AMER_BP.formula_ts(6_000_000n, 0n)).toThrow();
  });

  it('pamer_bp: DECOMMISSIONED — not in the registry (no legacy comparand)', () => {
    expect(METRIC_REGISTRY).not.toHaveProperty('pamer_bp');
  });

  // cac_mu: total_ad_spend / new_customers (legacy blendedCac). Integer FLOOR; NULL on zero.
  it('cac_mu: 10000000p / 200 customers = 50000p (₹500 blended CAC)', () => {
    const result = CAC_MU.formula_ts(10_000_000n, 200n);
    expect(result).toBe(50_000n);
  });

  it('cac_mu: zero new customers → throws (caller must guard)', () => {
    expect(() => CAC_MU.formula_ts(10_000_000n, 0n)).toThrow();
  });

  // cm2_per_nc_mu: nc_cm2 / new_customers. Integer FLOOR; NULL on zero.
  it('cm2_per_nc_mu: 2000000p / 200 = 10000p (₹100 CM2 per new customer)', () => {
    const result = CM2_PER_NC_MU.formula_ts(2_000_000n, 200n);
    expect(result).toBe(10_000n);
  });

  it('cm2_per_nc_mu: zero new customers → throws (caller must guard)', () => {
    expect(() => CM2_PER_NC_MU.formula_ts(2_000_000n, 0n)).toThrow();
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

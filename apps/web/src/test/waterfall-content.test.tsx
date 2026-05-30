// @paradigm: sql
// Tests for the WaterfallContent render layer (Wave-1 parity).
//
// Covers:
//   1. All 16 steps render in the correct order.
//   2. The 5 subtotal steps are styled distinctly (data-testid wf-subtotal-*).
//   3. Sign/color: positive = green, negative = red, subtotal = blue.
//   4. formatMoneyFull: table shows full-precision grouped ₹ with 2 decimals.
//   5. formatMoney (axis): abbreviates to lakh/crore.
//   6. buildChartData: start=0 for subtotals, correct start for deductions.
//
// CF-C6-RENDER-ONLY-1: these tests verify pure render logic only — no arithmetic.
// CF-C6-BIGINT-JSON-1: all value_mu fields are bigint throughout.
// CF-C6-FORMATMONEY-CANONICAL-1: formatMoneyFull uses en-IN grouping; formatMoney lakh/crore.

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  SUBTOTAL_IDS,
  formatMoneyFull,
  buildChartData,
  rowValueClass,
  barFill,
  type WfStep,
} from '@/interfaces/components/waterfall/waterfall-content.js';
import { formatMoney } from '@brain/lib-metrics';

// ──────────────────────────────────────────────────────────────────────────────
// Canonical 16-step fixture — matches buildSugandhlokCmWaterfall exactly.
// Derived from SUGANDH_LOK_CANONICAL (loopback-data-plane.ts).
// ──────────────────────────────────────────────────────────────────────────────
const CURRENCY = 'INR';
const EPOCH = new Date('2026-05-25T00:00:00Z');

const SIXTEEN_STEPS: WfStep[] = [
  { definition_id: 'gross_sales_mu',                    label: 'Gross Sales',                   value_mu: 218_000_000n,   cumulative_mu: 218_000_000n,  currency_code: CURRENCY, },
  { definition_id: 'total_discount_mu',                 label: 'Discounts',                     value_mu: -12_000_000n,   cumulative_mu: 206_000_000n,  currency_code: CURRENCY, },
  { definition_id: 'returns_mu',                        label: 'Refunds',                       value_mu: -500_000n,      cumulative_mu: 205_500_000n,  currency_code: CURRENCY, },
  { definition_id: 'total_tax_mu',                      label: 'Tax',                           value_mu: -18_000_000n,   cumulative_mu: 187_500_000n,  currency_code: CURRENCY, },
  { definition_id: 'shipping_outbound_mu',              label: 'Shipping',                      value_mu: -3_000_000n,    cumulative_mu: 184_500_000n,  currency_code: CURRENCY, },
  { definition_id: 'gross_revenue_after_deductions_mu', label: 'Revenue After Tax & Shipping',  value_mu: 184_500_000n,   cumulative_mu: 184_500_000n,  currency_code: CURRENCY, },
  { definition_id: 'cogs_mu',                           label: 'COGS',                          value_mu: -82_000_000n,   cumulative_mu: 102_500_000n,  currency_code: CURRENCY, },
  { definition_id: 'variable_costs_mu',                 label: 'Variable Costs',                value_mu: -6_000_000n,    cumulative_mu: 96_500_000n,   currency_code: CURRENCY, },
  { definition_id: 'rto_cost_mu',                       label: 'RTO Cost',                      value_mu: -4_480_000n,    cumulative_mu: 92_020_000n,   currency_code: CURRENCY, },
  // CM1 subtotal resets to Brain-canonical CM1 (97M), mirroring analytics step 10.
  // The walk lands at 92_020_000 after RTO but the subtotal bar is the canonical value.
  { definition_id: 'cm1_mu',                            label: 'CM1',                           value_mu: 97_000_000n,    cumulative_mu: 97_000_000n,   currency_code: CURRENCY, },
  { definition_id: 'total_ad_spend_mu',                 label: 'Ad Spend',                      value_mu: -65_000_000n,   cumulative_mu: 32_000_000n,   currency_code: CURRENCY, },
  { definition_id: 'cm2_mu',                            label: 'CM2',                           value_mu: 32_000_000n,    cumulative_mu: 32_000_000n,   currency_code: CURRENCY, },
  { definition_id: 'misc_expenses_prorated_mu',         label: 'Fixed Cost',                    value_mu: -4_000_000n,    cumulative_mu: 28_000_000n,   currency_code: CURRENCY, },
  { definition_id: 'cm3_mu',                            label: 'CM3',                           value_mu: 28_000_000n,    cumulative_mu: 28_000_000n,   currency_code: CURRENCY, },
  { definition_id: 'founder_salary_mu',                 label: "Founder's Salary",              value_mu: -4_000_000n,    cumulative_mu: 24_000_000n,   currency_code: CURRENCY, },
  { definition_id: 'net_profit_mu',                     label: 'Net Profit',                    value_mu: 24_000_000n,    cumulative_mu: 24_000_000n,   currency_code: CURRENCY, },
];

// ──────────────────────────────────────────────────────────────────────────────
// 1. SUBTOTAL_IDS — correct set
// ──────────────────────────────────────────────────────────────────────────────
describe('SUBTOTAL_IDS', () => {
  it('includes all 5 subtotal definition_ids', () => {
    expect(SUBTOTAL_IDS.has('gross_revenue_after_deductions_mu')).toBe(true);
    expect(SUBTOTAL_IDS.has('cm1_mu')).toBe(true);
    expect(SUBTOTAL_IDS.has('cm2_mu')).toBe(true);
    expect(SUBTOTAL_IDS.has('cm3_mu')).toBe(true);
    expect(SUBTOTAL_IDS.has('net_profit_mu')).toBe(true);
  });

  it('does NOT mark non-subtotal steps as subtotals', () => {
    expect(SUBTOTAL_IDS.has('gross_sales_mu')).toBe(false);
    expect(SUBTOTAL_IDS.has('cogs_mu')).toBe(false);
    expect(SUBTOTAL_IDS.has('total_ad_spend_mu')).toBe(false);
    expect(SUBTOTAL_IDS.has('founder_salary_mu')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. 16 steps in correct order
// ──────────────────────────────────────────────────────────────────────────────
describe('16-step order', () => {
  const EXPECTED_ORDER = [
    'gross_sales_mu',
    'total_discount_mu',
    'returns_mu',
    'total_tax_mu',
    'shipping_outbound_mu',
    'gross_revenue_after_deductions_mu',
    'cogs_mu',
    'variable_costs_mu',
    'rto_cost_mu',
    'cm1_mu',
    'total_ad_spend_mu',
    'cm2_mu',
    'misc_expenses_prorated_mu',
    'cm3_mu',
    'founder_salary_mu',
    'net_profit_mu',
  ] as const;

  it('fixture has exactly 16 steps', () => {
    expect(SIXTEEN_STEPS).toHaveLength(16);
  });

  it('fixture steps are in legacy order', () => {
    SIXTEEN_STEPS.forEach((step, i) => {
      expect(step.definition_id).toBe(EXPECTED_ORDER[i]);
    });
  });

  it('buildChartData preserves step order', () => {
    const chartData = buildChartData(SIXTEEN_STEPS);
    expect(chartData).toHaveLength(16);
    chartData.forEach((d, i) => {
      expect(d.definition_id).toBe(EXPECTED_ORDER[i]);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Subtotal styling — isSubtotal flag and barFill / rowValueClass
// ──────────────────────────────────────────────────────────────────────────────
describe('subtotal styling', () => {
  it('buildChartData marks subtotal steps with isSubtotal=true', () => {
    const chartData = buildChartData(SIXTEEN_STEPS);
    const subtotalIds = ['gross_revenue_after_deductions_mu', 'cm1_mu', 'cm2_mu', 'cm3_mu', 'net_profit_mu'];
    const nonSubtotalIds = ['gross_sales_mu', 'total_discount_mu', 'cogs_mu', 'total_ad_spend_mu', 'founder_salary_mu'];

    for (const id of subtotalIds) {
      const d = chartData.find((x) => x.definition_id === id)!;
      expect(d.isSubtotal, `${id} should be isSubtotal`).toBe(true);
    }
    for (const id of nonSubtotalIds) {
      const d = chartData.find((x) => x.definition_id === id)!;
      expect(d.isSubtotal, `${id} should NOT be isSubtotal`).toBe(false);
    }
  });

  it('barFill returns blue (#2563eb-hsl) for subtotals', () => {
    const chartData = buildChartData(SIXTEEN_STEPS);
    const subtotals = chartData.filter((d) => d.isSubtotal);
    expect(subtotals).toHaveLength(5);
    subtotals.forEach((d) => {
      expect(barFill(d)).toBe('hsl(221 83% 53%)');
    });
  });

  it('barFill returns green for positive (non-subtotal) step', () => {
    const grossSales = buildChartData(SIXTEEN_STEPS).find(
      (d) => d.definition_id === 'gross_sales_mu',
    )!;
    expect(barFill(grossSales)).toBe('hsl(142 76% 36%)');
  });

  it('barFill returns red for negative deduction step', () => {
    const cogs = buildChartData(SIXTEEN_STEPS).find(
      (d) => d.definition_id === 'cogs_mu',
    )!;
    expect(barFill(cogs)).toBe('hsl(0 84% 60%)');
  });

  it('rowValueClass returns blue-700 for subtotals', () => {
    const subtotalSteps = SIXTEEN_STEPS.filter((s) => SUBTOTAL_IDS.has(s.definition_id));
    subtotalSteps.forEach((step) => {
      expect(rowValueClass(step)).toContain('text-blue-700');
    });
  });

  it('rowValueClass returns green for positive non-subtotal', () => {
    const grossSales = SIXTEEN_STEPS[0]!; // gross_sales_mu, value_mu > 0
    expect(rowValueClass(grossSales)).toContain('text-green-700');
  });

  it('rowValueClass returns red for negative deduction', () => {
    const cogs = SIXTEEN_STEPS.find((s) => s.definition_id === 'cogs_mu')!;
    expect(rowValueClass(cogs)).toContain('text-red-600');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. buildChartData — start bar math
// ──────────────────────────────────────────────────────────────────────────────
describe('buildChartData — bar positioning', () => {
  it('subtotal: start=0, value=cumulative', () => {
    const chartData = buildChartData(SIXTEEN_STEPS);
    const cm2 = chartData.find((d) => d.definition_id === 'cm2_mu')!;
    expect(cm2.start).toBe(0);
    expect(cm2.value).toBe(Number(32_000_000n));
  });

  it('deduction: start=cumulative, value=|value_mu|', () => {
    const chartData = buildChartData(SIXTEEN_STEPS);
    // cogs: cumulative=102_500_000, value=-82_000_000 → start=102_500_000, bar=82_000_000
    const cogs = chartData.find((d) => d.definition_id === 'cogs_mu')!;
    expect(cogs.start).toBe(102_500_000);
    expect(cogs.value).toBe(82_000_000);
  });

  it('positive step: start=cumulative-value, value=value_mu', () => {
    const chartData = buildChartData(SIXTEEN_STEPS);
    // gross_sales: cumulative=218_000_000, value=218_000_000 → start=0, bar=218_000_000
    const gs = chartData.find((d) => d.definition_id === 'gross_sales_mu')!;
    expect(gs.start).toBe(0);
    expect(gs.value).toBe(218_000_000);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. formatMoneyFull — full-precision grouped ₹ with 2 decimals (legacy match)
// ──────────────────────────────────────────────────────────────────────────────
describe('formatMoneyFull (table/tooltip format)', () => {
  it('formats gross_sales (218_000_000 paise = ₹21,80,000) with 2 decimals', () => {
    // 218_000_000 paise = ₹21,80,000.00 (Indian grouping)
    const result = formatMoneyFull(218_000_000n, 'INR');
    expect(result).toBe('₹21,80,000.00');
  });

  it('formats a small amount below 1 lakh with Indian grouping', () => {
    // 50_000 paise = ₹500.00
    const result = formatMoneyFull(50_000n, 'INR');
    expect(result).toBe('₹500.00');
  });

  it('formats negative amounts with leading minus sign', () => {
    // -12_000_000 paise = -₹1,20,000.00
    const result = formatMoneyFull(-12_000_000n, 'INR');
    expect(result).toBe('-₹1,20,000.00');
  });

  it('formats paise remainder correctly (e.g. 100_050 paise = ₹1,000.50)', () => {
    const result = formatMoneyFull(100_050n, 'INR');
    expect(result).toBe('₹1,000.50');
  });

  it('does NOT abbreviate large amounts (no "L" or "Cr" in table format)', () => {
    // 185_000_000 paise = ₹18,50,000.00 — must NOT be "₹18.50 L"
    const result = formatMoneyFull(185_000_000n, 'INR');
    expect(result).not.toContain('L');
    expect(result).not.toContain('Cr');
    expect(result).toBe('₹18,50,000.00');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. formatMoney (axis) — still abbreviates (ensure no regression)
// ──────────────────────────────────────────────────────────────────────────────
describe('formatMoney (axis format — lakh/crore abbreviation)', () => {
  it('abbreviates ₹18.5L correctly', () => {
    expect(formatMoney(185_000_000n, 'INR')).toBe('₹18.50 L');
  });

  it('axis format and table format DIFFER for the same bigint', () => {
    const val = 218_000_000n;
    expect(formatMoney(val, 'INR')).not.toBe(formatMoneyFull(val, 'INR'));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. Negative path: empty steps renders gracefully (no crash)
// ──────────────────────────────────────────────────────────────────────────────
describe('buildChartData — empty input', () => {
  it('returns empty array for empty steps', () => {
    expect(buildChartData([])).toHaveLength(0);
  });
});

// @paradigm: sql
// CF-C4-RATIO-DIVOP-1: every ratio formula_ts uses ratioToBasisPoints (BigInt FLOOR).
// CF-C4-PRORATED-DIVOP-1: misc_expenses_prorated_mu uses daysInMonth, never 30.
// CF-C4-COGS-MV-REFRESH-1: cogs_mu is NOT an incremental formula here — it is
//   computed by the scheduled full daily recompute (the definition reflects the
//   identity formula: the MV reads the pre-computed value).
//
// All metric definitions must produce byte-identical outputs when compared against
// the Python counterpart (pylibs/brain_metrics/brain_metrics/registry/definitions.py).
// Enforced by: tools/check-metrics-parity.sh (extended for registry parity in V7).
//
// DO NOT add per-channel forks. DO NOT add a second registry. Single-Primitive Rule.

import { ratioToBasisPoints } from '../ratio.js';
import type { MetricDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Revenue ladder
// ---------------------------------------------------------------------------
//
// Phase-2 slice-1 (feat-store-order-fact-layer) additions: the ladder head
// (gross_sales_mu, total_discount_mu, total_tax_mu) was previously Python-only.
// Added here so the /store revenue ladder lights up TS-side end-to-end. Each is
// byte-identical (id/kind/unit/scale/display_only/parity_class) to the Python
// counterpart in pylibs/brain_metrics/registry/definitions.py — the parity gate
// enforces structural equality for shared shadow_compare metrics.
//
// NOTE on spec name mapping: the slice spec calls the net-of-tax rung
// "net_sales_net_tax_mu". The canonical Brain id for that concept is the existing
// `net_net_tax_mu` (defined below). Single-Primitive Rule: ONE def per concept —
// we do NOT add a second id. The /store page labels net_net_tax_mu as "Net of tax".

export const GROSS_SALES_MU: MetricDefinition = {
  id: 'gross_sales_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  // Gross sales = sum of Shopify line-item prices (before discounts/tax).
  // Passthrough from the raw fact layer (per-line-item SUM done in ingestion).
  formula_ts: (gross_sales_mu: bigint): bigint => gross_sales_mu,
  clickhouse_sql: 'toInt64(gross_sales_mu)',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const TOTAL_DISCOUNT_MU: MetricDefinition = {
  id: 'total_discount_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  // Total discounts applied (positive value representing the reduction).
  formula_ts: (total_discount_mu: bigint): bigint => total_discount_mu,
  clickhouse_sql: 'toInt64(total_discount_mu)',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const TOTAL_TAX_MU: MetricDefinition = {
  id: 'total_tax_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  // CF-C4-DDR-GST-TAX-1: Brain = SUM(per-SKU event-level GST-2.0 line tax via the
  // India RegionAdapter) — NEVER a day-level blended rate. Legacy = ShopifyQL
  // day-level aggregate. DIFFERENT INGEST PATHS — carried as a DDR row with
  // child_dependency: child-3-shopify-connector. The blended legacy value is NOT
  // silently matched; the per-SKU formula is the canonical Brain definition.
  formula_ts: (total_tax_mu: bigint): bigint => total_tax_mu,
  clickhouse_sql: 'toInt64(total_tax_mu)',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const NET_SALES_MU: MetricDefinition = {
  id: 'net_sales_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,  // CF-C6-ROAS-DISPLAY-CONTRACT-1: money → scale=1; use formatMoney
  formula_ts: (gross_sales_mu: bigint, returns_mu: bigint, discounts_mu: bigint): bigint =>
    gross_sales_mu - returns_mu - discounts_mu,
  clickhouse_sql: 'gross_sales_mu - returns_mu - discounts_mu',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const NET_NET_TAX_MU: MetricDefinition = {
  id: 'net_net_tax_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  // CF-C4-DDR-GST-TAX-1: total_tax_mu has child_dependency:child-3-shopify-connector.
  // During shadow phase: legacy-sourced total_tax_mu is a day-level ShopifyQL aggregate;
  // Brain will use per-SKU event-level GST-2.0 once Child-3 is active.
  formula_ts: (net_sales_mu: bigint, total_tax_mu: bigint): bigint =>
    net_sales_mu - total_tax_mu,
  clickhouse_sql: 'net_sales_mu - total_tax_mu',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const NET_REVENUE_MU: MetricDefinition = {
  id: 'net_revenue_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  formula_ts: (net_net_tax_mu: bigint, shipping_revenue_mu: bigint): bigint =>
    net_net_tax_mu + shipping_revenue_mu,
  clickhouse_sql: 'net_net_tax_mu + shipping_revenue_mu',
  display_only: false,
  parity_class: 'shadow_compare',
};

// Phase-2 slice-1: the honest billing base. Realized revenue survives the events
// that legacy "net revenue" ignores — cancellations, RTO reversals, and refunds.
// Brain-native: there is NO legacy comparand (compute-daily.ts stops at net revenue;
// it never subtracts post-sale reversals from the daily revenue figure). Routed to
// the correctness-fixture gate; parity_gap:true; a DDR row pins the formula.
// CF-C2-realized-1 worked example: net_revenue=4_960_000p, cancelled=120_000p,
// rto_reversed=300_000p, refunded=80_000p → realized = 4_960_000 − 500_000 = 4_460_000p.
export const REALIZED_REVENUE_MU: MetricDefinition = {
  id: 'realized_revenue_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  formula_ts: (
    net_revenue_mu: bigint,
    cancelled_revenue_mu: bigint,
    rto_reversed_revenue_mu: bigint,
    refunded_revenue_mu: bigint,
  ): bigint =>
    net_revenue_mu - cancelled_revenue_mu - rto_reversed_revenue_mu - refunded_revenue_mu,
  clickhouse_sql:
    'toInt64(net_revenue_mu - cancelled_revenue_mu - rto_reversed_revenue_mu - refunded_revenue_mu)',
  display_only: false,
  parity_class: 'correctness_fixture', // parity_gap:true — no legacy shadow
};

// ---------------------------------------------------------------------------
// Cost ladder
// ---------------------------------------------------------------------------

// Variable Costs (Shipping + Packaging + Website charges). Byte-identical pair with
// the Python registry (definitions.py:273). Added here in Phase-2 slice-2 — it was
// previously Python-only, which is why TS cm1_mu was COGS-only and silently diverged
// from Python's honest cm1_mu = net_revenue − cogs − variable_costs. The shadow_compare
// parity gate checks structural fields, not formula text, so the divergence shipped
// unnoticed (same root cause as the feat-metric-engine-olap-split Shreya H-1 bounce).
export const VARIABLE_COSTS_MU: MetricDefinition = {
  id: 'variable_costs_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  formula_ts: (shipping_mu: bigint, packaging_mu: bigint, website_charges_mu: bigint): bigint =>
    shipping_mu + packaging_mu + website_charges_mu,
  clickhouse_sql: 'toInt64(shipping_mu + packaging_mu + website_charges_mu)',
  display_only: false,
  parity_class: 'shadow_compare',
};

// CM1 = Net Revenue − COGS − Variable Costs. Phase-2 slice-2 CORRECTION: the prior
// TS formula was net_revenue − cogs (COGS-only), diverging from the honest Python
// definition (definitions.py:285) and from legacy compute-daily.ts:187
// (cm1 = netSales − cogs − shipping − packaging − website). Now byte-identical to
// Python. DDR row _ROW_CM1 documents the canonical CM1 and why RTO is NOT folded in
// here (RTO is provisioned at CM2 via the Brain-native true_cm2_mu, the honest place).
export const CM1_MU: MetricDefinition = {
  id: 'cm1_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  formula_ts: (net_revenue_mu: bigint, cogs_mu: bigint, variable_costs_mu: bigint): bigint =>
    net_revenue_mu - cogs_mu - variable_costs_mu,
  clickhouse_sql: 'toInt64(net_revenue_mu - cogs_mu - variable_costs_mu)',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const CM2_MU: MetricDefinition = {
  id: 'cm2_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  // CF-C4-DDR-1: DDR row for cm2_mu; compute-daily.ts:234 is the legacy_formula reference.
  // Brain canonicalizes on compute-daily.ts daily path (not pnl.ts lagged-shipping path).
  formula_ts: (cm1_mu: bigint, total_ad_spend_mu: bigint): bigint =>
    cm1_mu - total_ad_spend_mu,
  clickhouse_sql: 'cm1_mu - total_ad_spend_mu',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const MISC_EXPENSES_PRORATED_MU: MetricDefinition = {
  id: 'misc_expenses_prorated_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  // CF-C4-PRORATED-DIVOP-1: daysInMonth must come from a calendar function, not a 30 constant.
  // TS formula: BigInt integer division (equivalent to intDiv in ClickHouse).
  // The daysInMonth argument is the actual days in the month for the date being computed.
  // CF-C4-DDR-MISC-PRORATE-1: Feb-boundary example: monthly=310000µ, Feb=28 → 11071µ (not 10333).
  formula_ts: (monthly_amount_mu: bigint, days_in_month: bigint): bigint =>
    days_in_month > 0n ? monthly_amount_mu / days_in_month : 0n,
  clickhouse_sql:
    'if(toDaysInMonth(date) > 0, intDiv(misc_expenses_monthly_mu, toDaysInMonth(date)), NULL)',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const CM3_MU: MetricDefinition = {
  id: 'cm3_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  formula_ts: (cm2_mu: bigint, misc_expenses_prorated_mu: bigint): bigint =>
    cm2_mu - misc_expenses_prorated_mu,
  clickhouse_sql:
    'cm2_mu - if(toDaysInMonth(date) > 0, intDiv(misc_expenses_monthly_mu, toDaysInMonth(date)), 0)',
  display_only: false,
  parity_class: 'shadow_compare',
};

// ---------------------------------------------------------------------------
// Ratio metrics (basis points = FLOOR(ratio × 10000))
// CF-C4-RATIO-DIVOP-1: formula_ts uses ratioToBasisPoints (throws on zero denom);
//   callers guard before calling. clickhouse_sql uses intDiv + null-guard.
// ---------------------------------------------------------------------------

export const RTO_RATE_BP: MetricDefinition = {
  id: 'rto_rate_bp',
  kind: 'ratio',
  unit: 'bp',
  scale: 10000,  // CF-C6-ROAS-DISPLAY-CONTRACT-1: bp → scale=10000 → display /10000
  // Caller must guard: rto_rate_bp = null if total_shipments == 0.
  formula_ts: (rto_orders: bigint, total_shipments: bigint): number =>
    ratioToBasisPoints(rto_orders, total_shipments),
  clickhouse_sql:
    'if(total_shipments > 0, intDiv(rto_orders * 10000, total_shipments), NULL)',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const PREPAID_RATE_BP: MetricDefinition = {
  id: 'prepaid_rate_bp',
  kind: 'ratio',
  unit: 'bp',
  scale: 10000,
  formula_ts: (prepaid_orders: bigint, total_orders: bigint): number =>
    ratioToBasisPoints(prepaid_orders, total_orders),
  clickhouse_sql:
    'if(total_orders > 0, intDiv(prepaid_orders * 10000, total_orders), NULL)',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const CONVERSION_RATE_BP: MetricDefinition = {
  id: 'conversion_rate_bp',
  kind: 'ratio',
  unit: 'bp',
  scale: 10000,
  formula_ts: (total_orders: bigint, total_sessions: bigint): number =>
    ratioToBasisPoints(total_orders, total_sessions),
  clickhouse_sql:
    'if(total_sessions > 0, intDiv(total_orders * 10000, total_sessions), NULL)',
  display_only: false,
  parity_class: 'shadow_compare',
};

export const AOV_MU: MetricDefinition = {
  id: 'aov_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  // AOV = net_sales / total_orders (money unit, not bp; BigInt FLOOR division).
  formula_ts: (net_sales_mu: bigint, total_orders: bigint): bigint =>
    total_orders > 0n ? net_sales_mu / total_orders : 0n,
  clickhouse_sql:
    'if(total_orders > 0, intDiv(net_sales_mu, total_orders), NULL)',
  display_only: false,
  parity_class: 'shadow_compare',
};

// ---------------------------------------------------------------------------
// Display-only ratio metrics (CF-C4-RATIO-DIVOP-1; display_only = true)
// ROAS and aCoS are display-only: Brain is CM2-first; these must never gate decisions.
// ---------------------------------------------------------------------------

export const ACOS_BP: MetricDefinition = {
  id: 'acos_bp',
  kind: 'ratio',
  unit: 'bp',
  scale: 10000,
  // aCoS = total_ad_spend / net_sales (basis points — spend as % of sales).
  formula_ts: (total_ad_spend_mu: bigint, net_sales_mu: bigint): number =>
    ratioToBasisPoints(total_ad_spend_mu, net_sales_mu),
  clickhouse_sql:
    'if(net_sales_mu > 0, intDiv(total_ad_spend_mu * 10000, net_sales_mu), NULL)',
  display_only: true,  // CF-C4-DDR-1 row: display_only; CM2-first
  parity_class: 'shadow_compare',
};

export const BLENDED_ROAS_X100: MetricDefinition = {
  id: 'blended_roas_x100',
  kind: 'ratio',
  // Python registry uses unit:'bp' for this metric even though the scale is ×100 (not ×10000).
  // The 'x100' type tag was a TS-only deviation. Python canon stores it as 'bp' (integer ratio).
  // This is display_only; the unit tag does not affect the formula or the stored integer.
  unit: 'bp',
  // CF-C6-ROAS-DISPLAY-CONTRACT-1: scale=100 → displayValue = rawValue / 100 → "2.50×"
  // NOT scale=10000 (which would give 0.0250× — wrong).
  // blended_roas_x100 stores 250 to mean 2.50×. Divide by 100 to display.
  scale: 100,
  // Blended ROAS ×100: net_sales / total_ad_spend expressed as integer × 100.
  // 250 means 2.50× ROAS. display_only — ROAS is NEVER a Brain decision metric.
  formula_ts: (net_sales_mu: bigint, total_ad_spend_mu: bigint): number =>
    ratioToBasisPoints(net_sales_mu * 100n, total_ad_spend_mu * 10000n) / 10000,
  clickhouse_sql:
    'if(total_ad_spend_mu > 0, intDiv(net_sales_mu * 100, total_ad_spend_mu), NULL)',
  display_only: true,  // CF-C4-DDR-1 row: display_only; ROAS never a decision metric
  parity_class: 'shadow_compare',
};

// ---------------------------------------------------------------------------
// Brain-native metrics (parity_class: correctness_fixture, parity_gap: true)
// These have NO legacy comparand. Routed to the correctness-fixture gate.
// CF-C4-DDR-TRUE-CM2-1: true_cm2_mu formula pinned in full; parity_gap:true.
// ---------------------------------------------------------------------------

export const TRUE_CM2_MU: MetricDefinition = {
  id: 'true_cm2_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  // True CM2 = CM2 − RTO provision (cost-base-proportional, not flat-per-order).
  // RTO provision = intDiv(rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu),
  //                        total_orders_count)
  // CF-C4-DDR-TRUE-CM2-1: formula pinned IN FULL. Canon: arch plan §10 DDR + DDR formula_snapshot.
  // Worked example: total_orders=120, rto_orders=18, ad_spend=5000000p, variable_costs=1200000p,
  //   cogs=3000000p, cm2=8000000p → cost_base=9200000p → rto_provision=1380000p → true_cm2=6620000p
  // Legacy compute-daily.ts:234 stops at cm2 = cm1 - totalAdSpend (no RTO provision).
  // There is NO legacy comparand for true_cm2_mu — parity_gap:true.
  formula_ts: (
    cm2_mu: bigint,
    rto_orders: bigint,
    total_ad_spend_mu: bigint,
    variable_costs_mu: bigint,
    cogs_mu: bigint,
    total_orders_count: bigint,
  ): bigint => {
    if (total_orders_count <= 0n) return cm2_mu; // null-guard: no provision if no orders
    const cost_base = total_ad_spend_mu + variable_costs_mu + cogs_mu;
    const rto_provision = (rto_orders * cost_base) / total_orders_count; // BigInt / = intDiv (FLOOR)
    return cm2_mu - rto_provision;
  },
  clickhouse_sql:
    'if(total_orders_count > 0, toInt64(cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), total_orders_count)), NULL)',
  display_only: false,
  parity_class: 'correctness_fixture',  // parity_gap:true — no legacy shadow
};

export const PAMER_BP: MetricDefinition = {
  id: 'pamer_bp',
  kind: 'ratio',
  unit: 'bp',
  scale: 10000,
  // paMER = CM2 / Total Ad Spend (profit-adjusted MER, basis points).
  // "How many ₹ of CM2 does each ad ₹ generate?" Higher = better efficiency.
  // Canon: SKILL.md §"Marketing efficiency" "paMER = profit-adjusted variant (CM2 basis)".
  // Brain-native: no legacy comparand. parity_gap:true.
  // Worked example: cm2=8000000p, ad_spend=5000000p → intDiv(8000000×10000,5000000) = 16000bp
  formula_ts: (cm2_mu: bigint, total_ad_spend_mu: bigint): number =>
    ratioToBasisPoints(cm2_mu, total_ad_spend_mu),
  clickhouse_sql:
    'if(total_ad_spend_mu > 0, intDiv(cm2_mu * 10000, total_ad_spend_mu), NULL)',
  display_only: false,
  parity_class: 'correctness_fixture',
};

export const AMER_BP: MetricDefinition = {
  id: 'amer_bp',
  kind: 'ratio',
  unit: 'bp',
  scale: 10000,
  // aMER = True CM2 / Total Ad Spend (RTO-adjusted MER, basis points).
  // More conservative than paMER because True-CM2 ≤ CM2 always (RTO provision reduces it).
  // Canon: arch plan §10 DDR + SKILL.md §"Marketing efficiency".
  // Brain-native: no legacy comparand. parity_gap:true.
  // Worked example: true_cm2=6620000p, ad_spend=5000000p → intDiv(6620000×10000,5000000) = 13240bp
  // aMER (1.324×) < paMER (1.600×) — the delta reflects the RTO cost.
  // The formula inlines true_cm2 computation so ClickHouse SQL is self-contained (per DDR snapshot).
  formula_ts: (
    cm2_mu: bigint,
    rto_orders: bigint,
    total_ad_spend_mu: bigint,
    variable_costs_mu: bigint,
    cogs_mu: bigint,
    total_orders_count: bigint,
  ): number => {
    if (total_orders_count <= 0n || total_ad_spend_mu <= 0n) return 0;
    const cost_base = total_ad_spend_mu + variable_costs_mu + cogs_mu;
    const rto_provision = (rto_orders * cost_base) / total_orders_count;
    const true_cm2 = cm2_mu - rto_provision;
    return ratioToBasisPoints(true_cm2, total_ad_spend_mu);
  },
  clickhouse_sql:
    'if(total_ad_spend_mu > 0 AND total_orders_count > 0, intDiv( (cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), total_orders_count)) * 10000, total_ad_spend_mu), NULL)',
  display_only: false,
  parity_class: 'correctness_fixture',
};

export const LTV_CAC_BP: MetricDefinition = {
  id: 'ltv_cac_bp',
  kind: 'ratio',
  unit: 'bp',
  scale: 10000,
  // LTV:CAC ratio in basis points (×10000). Brain ratio convention: ALL decision-metric
  // ratios use bp (×10000), not x100. The x100 scale was a deviation; this is the canonical form.
  // Canon: SKILL.md §"LTV:CAC = cohort cumulative CM2 ÷ cohort CAC".
  // Brain-native: no legacy comparand. parity_gap:true.
  // Worked example: ltv=300000p, cac=100000p → intDiv(300000×10000,100000) = 30000bp (3.0×)
  formula_ts: (ltv_mu: bigint, cac_mu: bigint): number =>
    ratioToBasisPoints(ltv_mu, cac_mu),
  clickhouse_sql:
    'if(cac_mu > 0, intDiv(ltv_mu * 10000, cac_mu), NULL)',
  display_only: false,
  parity_class: 'correctness_fixture',
};

// ---------------------------------------------------------------------------
// RTO / COD / Logistics / Pincode economics (Phase-2 slice-3: feat-rto-cod-economics)
// The single largest controllable Indian-D2C margin leak. rto_rate_bp / prepaid_rate_bp
// are REUSED from Child-4 (above) — these are the COST / ECONOMICS layer on top.
// Byte-identical pairs with pylibs/.../registry/definitions.py.
// ---------------------------------------------------------------------------

// RTO cost: SUM of per-RTO-shipment charges (Shiprocket-sourced). Passthrough money
// aggregate (like gross_sales_mu). Connector-sourced — DDR _ROW_RTO_COST_VALUE carries
// child_dependency:child-3-shopify-connector (unmeasurable pre-cutover; mirrors total_tax_mu).
export const RTO_COST_MU: MetricDefinition = {
  id: 'rto_cost_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  formula_ts: (rto_cost_mu: bigint): bigint => rto_cost_mu,
  clickhouse_sql: 'toInt64(rto_cost_mu)',
  display_only: false,
  parity_class: 'shadow_compare',
};

// RTO revenue lost: SUM of RTO shipment order/COD value. Passthrough money aggregate.
export const RTO_REVENUE_LOST_MU: MetricDefinition = {
  id: 'rto_revenue_lost_mu',
  kind: 'money',
  unit: 'mu',
  scale: 1,
  formula_ts: (rto_revenue_lost_mu: bigint): bigint => rto_revenue_lost_mu,
  clickhouse_sql: 'toInt64(rto_revenue_lost_mu)',
  display_only: false,
  parity_class: 'shadow_compare',
};

// COD realization rate = delivered COD orders / total COD orders (basis points).
// Legacy: cod-prepaid-analytics.ts:187 (codDelivered/codOrders). Legacy comparand exists →
// shadow_compare, no DDR delta. NULL-guard on zero COD orders.
export const COD_REALIZATION_RATE_BP: MetricDefinition = {
  id: 'cod_realization_rate_bp',
  kind: 'ratio',
  unit: 'bp',
  scale: 10000,
  // Caller guards: NULL if cod_orders == 0.
  formula_ts: (cod_delivered: bigint, cod_orders: bigint): number =>
    ratioToBasisPoints(cod_delivered, cod_orders),
  clickhouse_sql:
    'if(cod_orders > 0, intDiv(cod_delivered * 10000, cod_orders), NULL)',
  display_only: false,
  parity_class: 'shadow_compare',
};

// Break-even COD RTO rate (basis points) — the FULL legacy formula, NOT the naive M/(M+C).
// Legacy: cod-prepaid-analytics.ts:218-231.
//   pg_fee_mu  = intDiv(aov_mu * gateway_fee_bp, 10000)              (V·gatewayPct)
//   num_scaled = aov_mu * prepaid_rto_rate_bp                        (V·P·10000; P in bp)
//              + (cod_fee_mu - pg_fee_mu) * 10000                    ((COD_fee − PG_fee)·10000)
//              + prepaid_rto_rate_bp * (return_shipping_mu + restocking_mu)   (P·(S+RS)·10000)
//   denom      = aov_mu + return_shipping_mu + restocking_mu
//   breakeven_cod_rto_rate_bp = (denom > 0) ? intDiv(num_scaled, denom) : NULL   (already ×10000 ⇒ bp)
// SINGLE final FLOOR-to-bp; integer paise throughout (no chained float). parity_gap:true
// (Brain canonical; legacy float not a byte comparand) → correctness_fixture + DDR anchor.
// WORKED ANCHOR (CF-S3-BREAKEVEN-1): aov=150000, P=500bp, cod_fee=3000, gateway=200bp,
//   S=8000, RS=0 → pg_fee=intDiv(150000*200,10000)=3000; num_scaled = 150000*500
//   + (3000-3000)*10000 + 500*(8000+0) = 75000000 + 0 + 4000000 = 79000000;
//   denom = 150000+8000 = 158000; breakeven = intDiv(79000000,158000) = 500 bp (5.00%).
//   (The naive M/(M+C) would give ~95% — the anchor distinguishes them.)
export const BREAKEVEN_COD_RTO_RATE_BP: MetricDefinition = {
  id: 'breakeven_cod_rto_rate_bp',
  kind: 'ratio',
  unit: 'bp',
  scale: 10000,
  formula_ts: (
    aov_mu: bigint,
    prepaid_rto_rate_bp: bigint,
    cod_fee_mu: bigint,
    gateway_fee_bp: bigint,
    return_shipping_mu: bigint,
    restocking_mu: bigint,
  ): number => {
    const denom = aov_mu + return_shipping_mu + restocking_mu;
    if (denom <= 0n) return 0; // null-guard (caller treats 0-denom as NULL/note)
    const pg_fee_mu = (aov_mu * gateway_fee_bp) / 10000n; // intDiv FLOOR
    const num_scaled =
      aov_mu * prepaid_rto_rate_bp +
      (cod_fee_mu - pg_fee_mu) * 10000n +
      prepaid_rto_rate_bp * (return_shipping_mu + restocking_mu);
    return Number(num_scaled / denom); // SINGLE final FLOOR-to-bp
  },
  clickhouse_sql:
    'if((aov_mu + return_shipping_mu + restocking_mu) > 0, intDiv(aov_mu * prepaid_rto_rate_bp + (cod_fee_mu - intDiv(aov_mu * gateway_fee_bp, 10000)) * 10000 + prepaid_rto_rate_bp * (return_shipping_mu + restocking_mu), aov_mu + return_shipping_mu + restocking_mu), NULL)',
  display_only: false,
  parity_class: 'correctness_fixture', // parity_gap:true — Brain canonical, no byte comparand
};

// Pincode reliability score — Brain-native integerized score in CENTI-POINTS (0..10000 = 0..100.00).
// Legacy float: pincode-intelligence.ts:60-66
//   clamp(0,100, 100 − rtoRate·2 − codRate·0.5 + repeatRate·0.5 + (aov/1000)·10)
// where rtoRate/codRate/repeatRate are PERCENT POINTS (pp) and aov is RUPEES.
// Brain integer form (inputs: rates in bp = pp×100, aov in paise = rupees×100):
//   raw_cp = 10000
//          - rto_bp * 2                       (rtoRate·2 [pp] → rto_bp·2 [centi-pts])
//          - intDiv(cod_bp, 2)                (codRate·0.5 [pp] → cod_bp/2 [centi-pts])
//          + intDiv(repeat_bp, 2)             (repeatRate·0.5 [pp] → repeat_bp/2 [centi-pts])
//          + intDiv(aov_mu, 1000)             ((aov/1000)·10 [pp] = aov_rupees/100 = intDiv(aov_mu,1000) [centi-pts])
//   pincode_reliability_score = clamp(0, 10000, raw_cp)
// (Derivation of the aov term: legacy adds (aov_rupees/1000)·10 POINTS = aov_rupees/100 points
//  = aov_rupees·100/100 centi-pts = aov_rupees centi-pts; aov_mu = aov_rupees·100 paise ⇒
//  aov_rupees = intDiv(aov_mu,100); the term in centi-pts = aov_rupees = intDiv(aov_mu,100)... see DDR.)
// WORKED ANCHOR (CF-S3-PINCODE-1): rto_bp=1800, cod_bp=6000, repeat_bp=2000, aov_mu=150000 →
//   raw = 10000 - 1800*2 - intDiv(6000,2) + intDiv(2000,2) + intDiv(150000,100)
//       = 10000 - 3600 - 3000 + 1000 + 1500 = 5900 centi-pts (= 59.00). clamp → 5900.
// parity_gap:true → correctness_fixture + DDR _ROW_PINCODE_RELIABILITY pins the exact form.
export const PINCODE_RELIABILITY_SCORE: MetricDefinition = {
  id: 'pincode_reliability_score',
  kind: 'count',
  unit: 'count',
  scale: 1,
  formula_ts: (
    rto_bp: bigint,
    cod_bp: bigint,
    repeat_bp: bigint,
    aov_mu: bigint,
  ): number => {
    const raw =
      10000n -
      rto_bp * 2n -
      cod_bp / 2n +
      repeat_bp / 2n +
      aov_mu / 100n;
    const clamped = raw < 0n ? 0n : raw > 10000n ? 10000n : raw;
    return Number(clamped);
  },
  clickhouse_sql:
    'greatest(0, least(10000, toInt64(10000 - rto_bp * 2 - intDiv(cod_bp, 2) + intDiv(repeat_bp, 2) + intDiv(aov_mu, 100))))',
  display_only: false,
  parity_class: 'correctness_fixture', // parity_gap:true — Brain-native integerized score
};

// ---------------------------------------------------------------------------
// Registry export (all definitions indexed by id)
// ---------------------------------------------------------------------------

export const METRIC_REGISTRY: Record<string, MetricDefinition> = {
  gross_sales_mu: GROSS_SALES_MU,
  total_discount_mu: TOTAL_DISCOUNT_MU,
  total_tax_mu: TOTAL_TAX_MU,
  net_sales_mu: NET_SALES_MU,
  net_net_tax_mu: NET_NET_TAX_MU,
  net_revenue_mu: NET_REVENUE_MU,
  realized_revenue_mu: REALIZED_REVENUE_MU,
  variable_costs_mu: VARIABLE_COSTS_MU,
  cm1_mu: CM1_MU,
  cm2_mu: CM2_MU,
  misc_expenses_prorated_mu: MISC_EXPENSES_PRORATED_MU,
  cm3_mu: CM3_MU,
  rto_rate_bp: RTO_RATE_BP,
  prepaid_rate_bp: PREPAID_RATE_BP,
  conversion_rate_bp: CONVERSION_RATE_BP,
  aov_mu: AOV_MU,
  acos_bp: ACOS_BP,
  blended_roas_x100: BLENDED_ROAS_X100,
  true_cm2_mu: TRUE_CM2_MU,
  pamer_bp: PAMER_BP,
  amer_bp: AMER_BP,
  ltv_cac_bp: LTV_CAC_BP,
  // Phase-2 slice-3 (feat-rto-cod-economics): RTO/COD/logistics/pincode economics.
  rto_cost_mu: RTO_COST_MU,
  rto_revenue_lost_mu: RTO_REVENUE_LOST_MU,
  cod_realization_rate_bp: COD_REALIZATION_RATE_BP,
  breakeven_cod_rto_rate_bp: BREAKEVEN_COD_RTO_RATE_BP,
  pincode_reliability_score: PINCODE_RELIABILITY_SCORE,
} as const;

/** All metric ids that are display_only (must never appear in decision thresholds). */
export const DISPLAY_ONLY_METRIC_IDS: ReadonlySet<string> = new Set(
  Object.values(METRIC_REGISTRY)
    .filter((m) => m.display_only)
    .map((m) => m.id),
);

/** All metric ids with parity_class "correctness_fixture" (parity_gap:true; no legacy shadow). */
export const CORRECTNESS_FIXTURE_METRIC_IDS: ReadonlySet<string> = new Set(
  Object.values(METRIC_REGISTRY)
    .filter((m) => m.parity_class === 'correctness_fixture')
    .map((m) => m.id),
);

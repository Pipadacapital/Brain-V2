// @paradigm: sql
// CF-C6-DATA-SEAM-1: LoopbackDataPlane — Phase 0-1 in-process / localhost loopback
// implementation of DataPlanePort. In Phase 0-1 the Python data deployable runs
// on localhost; this adapter connects via gRPC on the loopback address.
//
// When Phase 2 arrives: flip GRPC_METRICS_ADDR + GRPC_INTELLIGENCE_ADDR from
// localhost to cross-task endpoints. Zero code change — config flip only.
// That is the "proto-first contract, split is mechanical" guarantee.
//
// For the LOCAL harness (Phase 0 / tests): StubDataPlane provides deterministic
// in-memory responses seeded with Sugandh-Lok data. The stub speaks the SAME
// DataPlanePort contract — not a separate code path.
//
// Production gRPC connectivity:
//   GRPC_METRICS_ADDR     e.g. localhost:50051 (analytics-service gRPC handler)
//   GRPC_INTELLIGENCE_ADDR e.g. localhost:50052 (intelligence-service gRPC handler)

import type {
  DataPlanePort,
  MetricRow,
  KpiSummaryRow,
  PnlWaterfallRow,
  PnlStatementRow,
  StoreSummaryRow,
  StoreRevenueLadderStep,
  MorningBrief,
  SubmitInsightResult,
  RegisterPushTokenResult,
  DateRange,
  RtoAnalyticsResult,
  CodPrepaidResult,
  LogisticsResult,
  PincodeIntelligenceResult,
  PincodeRow,
  PincodeFilterInput,
  MarketingEfficiencyResult,
  AcquisitionSummaryResult,
  AcquisitionDailyRow,
  DistributionsResult,
  DistributionsProductRow,
  DistributionsGraphPoint,
  DistributionsFilterInput,
  CohortMatrixResult,
  CohortRow,
  CohortFilterInput,
  LtvSummaryResult,
  LtvRow,
  LtvFilterInput,
} from '../domain/proto-types.js';

// ---------------------------------------------------------------------------
// StubDataPlane — deterministic in-process implementation for LOCAL harness.
// Seeds the Sugandh-Lok workspace data through the real data path contract.
// CF-C6-RUNNABLE-HARNESS-1: this stub feeds real registry-derived values.
// ---------------------------------------------------------------------------

const SUGANDH_LOK_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const DATA_EPOCH = new Date('2026-05-25T00:00:00Z');

// ---------------------------------------------------------------------------
// CANONICAL SEED — single source of truth for the Sugandh-Lok anchor workspace.
// Phase-2 slice-1 (feat-store-order-fact-layer): BOTH the /store revenue ladder
// AND the dashboard KPI net_revenue derive from THIS one object, so they are
// provably the same canonical facts (not two independent stubs). All paise.
// The revenue ladder is per-SKU-GST-honest: total_tax is the SUM of per-SKU GST,
// not a blended day rate. Realized subtracts post-sale reversals.
// ---------------------------------------------------------------------------

const SUGANDH_LOK_CANONICAL = {
  period: '2026-04-01/2026-04-30',
  currency_code: 'INR',
  // Revenue ladder (April 2026)
  gross_sales_mu: 218_000_000n,      // ₹21.8L gross
  total_discount_mu: 12_000_000n,    // ₹1.2L discounts
  net_sales_mu: 206_000_000n,        // gross - discount = ₹20.6L
  total_tax_mu: 18_000_000n,         // ₹1.8L — SUM of per-SKU GST 2.0 (mixed slabs)
  net_net_tax_mu: 188_000_000n,      // net_sales - tax
  shipping_revenue_mu: 3_000_000n,   // ₹30K shipping collected
  // net_revenue = net_net_tax + shipping = 191_000_000? Seed chosen so the
  // dashboard's existing ₹18.5L net_revenue stays the realized headline:
  net_revenue_mu: 191_000_000n,      // ₹19.1L
  // Post-sale reversals (the honest leak):
  cancelled_revenue_mu: 2_000_000n,  // ₹20K cancelled
  rto_reversed_revenue_mu: 3_500_000n, // ₹35K RTO-reversed
  refunded_revenue_mu: 500_000n,     // ₹5K refunded
  realized_revenue_mu: 185_000_000n, // ₹18.5L — net_revenue − 6_000_000 reversals
  order_count: 1_247n,
  aov_mu: 1_483n,                    // ~₹14.83 mean (display)
  // ---------------------------------------------------------------------
  // Cost ladder (Phase-2 slice-2: feat-pnl-cm-waterfall). All paise.
  // The CM ladder is RE-DERIVED from these via the registry formulas so the
  // /pnl + /waterfall numbers are registry-traced and internally consistent.
  // cm1 = net_revenue − cogs − variable_costs (the HONEST CM1; slice-2 fix).
  // realized_revenue is the head used for the honest waterfall.
  // ---------------------------------------------------------------------
  cogs_mu: 82_000_000n,              // ₹8.2L COGS
  variable_costs_mu: 6_000_000n,     // ₹0.6L shipping + packaging + website
  total_ad_spend_mu: 65_000_000n,    // ₹6.5L ad spend
  misc_expenses_prorated_mu: 4_000_000n, // ₹0.4L fixed overheads (prorated)
  rto_orders: 224n,                  // ~18% of 1247 orders (matches rto_rate_bp 1800)
  // Margin ladder RE-DERIVED via the honest registry formulas from the head
  // (realized_revenue = 185_000_000) and the cost facts above — and pinned here so
  // the existing dashboard KPI seed (cm2=₹3.2L, cm3=₹2.8L) stays consistent:
  //   cm1 = 185_000_000 − 82_000_000 − 6_000_000 = 97_000_000
  //   cm2 = 97_000_000 − 65_000_000             = 32_000_000  (== KPI seed)
  //   cm3 = 32_000_000 − 4_000_000              = 28_000_000  (== KPI seed)
  // The /pnl statement, the /waterfall chart, and the /dashboard KPI strip therefore
  // all show the SAME CM2/CM3 — one canonical fact source (CF: cross-surface consistency).
  cm1_mu: 97_000_000n,
  cm2_mu: 32_000_000n,
  cm3_mu: 28_000_000n,
  rto_rate_bp: 1_800,
  blended_roas_x100: 285,
  conversion_rate_bp: 230,
  // -------------------------------------------------------------------
  // Slice-3 (feat-rto-cod-economics) operational facts. Shiprocket-sourced
  // (held at Child-3 cutover; seeded here for the harness). Chosen so the derived
  // rto_rate stays ~1800bp (cross-surface consistency with the dashboard KPI) and
  // the break-even worked example reproduces 500bp. All money in paise.
  // -------------------------------------------------------------------
  total_shipments: 1_247n,
  rto_cost_mu: 4_480_000n,           // ₹44.8K total RTO charges
  rto_revenue_lost_mu: 33_200_000n,  // ₹3.32L revenue lost to RTO
  cod_orders: 800n,
  prepaid_orders: 200n,              // total 1000; break-even AOV = 150000p
  cod_delivered: 612n,              // cod realization = 7650bp
  prepaid_delivered: 190n,
  cod_rto: 180n,                    // cod rto = 2250bp
  prepaid_rto: 10n,                 // prepaid rto = 500bp (break-even P)
  gross_revenue_cod_mu: 120_000_000n,
  gross_revenue_prepaid_mu: 30_000_000n,  // total gross 150_000_000 → AOV 150000p
  cod_fee_mu: 3_000n,              // ₹30 COD fee
  gateway_fee_bp: 200,            // 2% gateway
  return_shipping_mu: 8_000n,     // ₹80 return shipping per RTO
  // Logistics charge breakdown
  forward_charges_mu: 8_000_000n,
  cod_charges_mu: 1_200_000n,
  rto_charges_mu: 4_480_000n,
  delivered_count: 980n,
  // -------------------------------------------------------------------
  // Slice-4 (feat-marketing-acquisition) facts. Chosen so:
  //   - MER numerator == net_revenue_mu (191_000_000) for cross-surface consistency with /store.
  //   - aMER uses a CLASSIFICATION SPLIT: total spend 65_000_000 but only 26_000_000 acquisition.
  //   - new customers 4000; nc_revenue 78_000_000; nc_cm2 13_000_000.
  // All money in paise.
  // -------------------------------------------------------------------
  new_customers_count: 4_000n,
  new_customer_revenue_mu: 78_000_000n,    // aMER numerator
  acquisition_ad_spend_mu: 26_000_000n,    // aMER denominator (40% of total spend, classified)
  nc_cm2_mu: 13_000_000n,
  meta_spend_mu: 39_000_000n,              // 60% of total spend
  google_spend_mu: 26_000_000n,            // 40% of total spend (== acquisition seed here)
} as const;

/** Sugandh-Lok seed KPI data — DERIVED from the canonical seed (single source). */
const SUGANDH_LOK_KPI: KpiSummaryRow = {
  workspace_id: SUGANDH_LOK_WORKSPACE_ID,
  period: SUGANDH_LOK_CANONICAL.period,
  data_epoch: DATA_EPOCH,
  currency_code: SUGANDH_LOK_CANONICAL.currency_code,
  // CF: net_revenue shown on the dashboard == the realized revenue at the top of
  // the /store ladder — the SAME canonical fact, not a separate stub number.
  net_revenue_mu: SUGANDH_LOK_CANONICAL.realized_revenue_mu, // ₹18.5L (canonical)
  cm2_mu: SUGANDH_LOK_CANONICAL.cm2_mu,
  cm3_mu: SUGANDH_LOK_CANONICAL.cm3_mu,
  rto_rate_bp: SUGANDH_LOK_CANONICAL.rto_rate_bp,
  blended_roas_x100: SUGANDH_LOK_CANONICAL.blended_roas_x100,
  total_orders: SUGANDH_LOK_CANONICAL.order_count,
  aov_mu: Number(SUGANDH_LOK_CANONICAL.aov_mu),
  conversion_rate_bp: SUGANDH_LOK_CANONICAL.conversion_rate_bp,
};

/** Sugandh-Lok store summary — DERIVED from the canonical seed (single source). */
function buildSugandhlokStoreSummary(): {
  summary: StoreSummaryRow;
  ladder: StoreRevenueLadderStep[];
} {
  const c = SUGANDH_LOK_CANONICAL;
  const summary: StoreSummaryRow = {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: c.period,
    data_epoch: DATA_EPOCH,
    currency_code: c.currency_code,
    gross_sales_mu: c.gross_sales_mu,
    total_discount_mu: c.total_discount_mu,
    net_sales_mu: c.net_sales_mu,
    total_tax_mu: c.total_tax_mu,
    net_net_tax_mu: c.net_net_tax_mu,
    shipping_revenue_mu: c.shipping_revenue_mu,
    net_revenue_mu: c.net_revenue_mu,
    realized_revenue_mu: c.realized_revenue_mu,
    order_count: c.order_count,
    aov_mu: c.aov_mu,
  };
  const ladder: StoreRevenueLadderStep[] = [
    { definition_id: 'gross_sales_mu', label: 'Gross Sales', value_mu: c.gross_sales_mu },
    { definition_id: 'net_sales_mu', label: 'Net Sales', value_mu: c.net_sales_mu },
    { definition_id: 'net_net_tax_mu', label: 'Net of Tax', value_mu: c.net_net_tax_mu },
    { definition_id: 'net_revenue_mu', label: 'Net Revenue', value_mu: c.net_revenue_mu },
    { definition_id: 'realized_revenue_mu', label: 'Realized Revenue', value_mu: c.realized_revenue_mu },
  ];
  return { summary, ladder };
}

/**
 * Sugandh-Lok HONEST CM waterfall — Phase-2 slice-2 (feat-pnl-cm-waterfall).
 * Derived from SUGANDH_LOK_CANONICAL so /pnl, /waterfall and /dashboard share ONE
 * fact source. The head is realized_revenue (the honest billing base). cm1 SUBTRACTS
 * variable_costs (the slice-2 correction; the prior seed was COGS-only and used the
 * net_revenue head). RTO is NOT folded into CM1 — it is the Brain-native True-CM2.
 * cumulative_mu at each CM subtotal equals that subtotal (the chart invariant).
 */
function buildSugandhlokCmWaterfall(): PnlWaterfallRow[] {
  const c = SUGANDH_LOK_CANONICAL;
  const epoch = DATA_EPOCH;
  const head = c.realized_revenue_mu;          // 185_000_000
  const cm1 = head - c.cogs_mu - c.variable_costs_mu;       // 97_000_000
  const cm2 = cm1 - c.total_ad_spend_mu;                    // 32_000_000
  const cm3 = cm2 - c.misc_expenses_prorated_mu;            // 28_000_000
  return [
    { definition_id: 'net_revenue_mu', label: 'Realized Revenue', value_mu: head, cumulative_mu: head, currency_code: 'INR', data_epoch: epoch },
    { definition_id: 'cogs_mu', label: 'COGS', value_mu: -c.cogs_mu, cumulative_mu: head - c.cogs_mu, currency_code: 'INR', data_epoch: epoch },
    { definition_id: 'variable_costs_mu', label: 'Variable Costs', value_mu: -c.variable_costs_mu, cumulative_mu: cm1, currency_code: 'INR', data_epoch: epoch },
    { definition_id: 'cm1_mu', label: 'CM1 (Gross Contribution)', value_mu: cm1, cumulative_mu: cm1, currency_code: 'INR', data_epoch: epoch },
    { definition_id: 'total_ad_spend_mu', label: 'Ad Spend', value_mu: -c.total_ad_spend_mu, cumulative_mu: cm2, currency_code: 'INR', data_epoch: epoch },
    { definition_id: 'cm2_mu', label: 'CM2 (After Ads)', value_mu: cm2, cumulative_mu: cm2, currency_code: 'INR', data_epoch: epoch },
    { definition_id: 'misc_expenses_prorated_mu', label: 'Fixed Overheads (Prorated)', value_mu: -c.misc_expenses_prorated_mu, cumulative_mu: cm3, currency_code: 'INR', data_epoch: epoch },
    { definition_id: 'cm3_mu', label: 'CM3 (After Overheads)', value_mu: cm3, cumulative_mu: cm3, currency_code: 'INR', data_epoch: epoch },
  ];
}

/**
 * Sugandh-Lok HONEST P&L statement — Phase-2 slice-2. Derived from the canonical seed.
 * true_cm2 = cm2 − RTO provision (Brain-native), using the same registry formula shape:
 *   rto_provision = intDiv(rto_orders × (ad_spend + variable_costs + cogs), order_count)
 */
function buildSugandhlokPnlStatement(): PnlStatementRow {
  const c = SUGANDH_LOK_CANONICAL;
  const net_revenue = c.realized_revenue_mu;
  const cm1 = net_revenue - c.cogs_mu - c.variable_costs_mu;
  const cm2 = cm1 - c.total_ad_spend_mu;
  const cm3 = cm2 - c.misc_expenses_prorated_mu;
  // True-CM2 (integer FLOOR; mirrors true_cm2_mu registry formula).
  const costBase = c.total_ad_spend_mu + c.variable_costs_mu + c.cogs_mu;
  const rtoProvision = (c.rto_orders * costBase) / c.order_count; // bigint / = FLOOR
  const trueCm2 = cm2 - rtoProvision;
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: c.period,
    data_epoch: DATA_EPOCH,
    currency_code: c.currency_code,
    net_revenue_mu: net_revenue,
    cogs_mu: c.cogs_mu,
    variable_costs_mu: c.variable_costs_mu,
    cm1_mu: cm1,
    total_ad_spend_mu: c.total_ad_spend_mu,
    cm2_mu: cm2,
    misc_expenses_prorated_mu: c.misc_expenses_prorated_mu,
    cm3_mu: cm3,
    true_cm2_mu: trueCm2,
    order_count: c.order_count,
  };
}

// ---------------------------------------------------------------------------
// Slice-3 (feat-rto-cod-economics) builders — derived from SUGANDH_LOK_CANONICAL.
// Mirror the analytics-service use-case math (registry formulas; integer FLOOR).
// ONE seed → /rto-analytics, /cod-prepaid, /logistics, /pincode share consistent facts.
// ---------------------------------------------------------------------------

function _ratioBp(num: bigint, denom: bigint): number | null {
  if (denom <= 0n) return null;
  return Number((num * 10000n) / denom);
}

function buildSugandhlokRtoAnalytics(): RtoAnalyticsResult {
  const c = SUGANDH_LOK_CANONICAL;
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: c.period,
    data_epoch: DATA_EPOCH,
    currency_code: c.currency_code,
    total_shipments: c.total_shipments,
    rto_count: c.rto_orders,
    rto_rate_bp: _ratioBp(c.rto_orders, c.total_shipments), // 224/1247 = 1796bp
    total_rto_cost_mu: c.rto_cost_mu,
    revenue_lost_to_rto_mu: c.rto_revenue_lost_mu,
    // RTO-analytics by-payment counts reconcile to rto_orders (224) — the RTO surface counts
    // ALL RTO shipments. (The /cod-prepaid surface uses its own mapped denominators.)
    by_payment_method: [
      { payment_method: 'COD', rto_count: 180n, rto_cost_mu: 3_600_000n, revenue_lost_mu: 27_000_000n },
      { payment_method: 'Prepaid', rto_count: 44n, rto_cost_mu: 880_000n, revenue_lost_mu: 6_200_000n },
    ],
    by_courier: [
      { courier_name: 'Delhivery', rto_count: 120n, rto_cost_mu: 2_400_000n, revenue_lost_mu: 18_000_000n },
      { courier_name: 'Bluedart', rto_count: 104n, rto_cost_mu: 2_080_000n, revenue_lost_mu: 15_200_000n },
    ],
  };
}

function buildSugandhlokCodPrepaid(): CodPrepaidResult {
  const c = SUGANDH_LOK_CANONICAL;
  const totalOrders = c.cod_orders + c.prepaid_orders;            // 1000
  const totalGross = c.gross_revenue_cod_mu + c.gross_revenue_prepaid_mu; // 150_000_000
  const aov = totalOrders > 0n ? totalGross / totalOrders : 0n;   // 150000
  const codRtoBp = _ratioBp(c.cod_rto, c.cod_orders) ?? 0;        // 2250
  const prepaidRtoBp = _ratioBp(c.prepaid_rto, c.prepaid_orders) ?? 0; // 500
  // Effective revenue (integer FLOOR), mirrors the use-case.
  const codSurvived = c.gross_revenue_cod_mu - (c.gross_revenue_cod_mu * BigInt(codRtoBp)) / 10000n;
  const prepaidSurvived =
    c.gross_revenue_prepaid_mu - (c.gross_revenue_prepaid_mu * BigInt(prepaidRtoBp)) / 10000n;
  const codFeeTotal = c.cod_orders * c.cod_fee_mu;
  const gatewayFeeTotal = (c.gross_revenue_prepaid_mu * BigInt(c.gateway_fee_bp)) / 10000n;
  const codReturnShip = c.cod_rto * c.return_shipping_mu;
  const prepaidReturnShip = c.prepaid_rto * c.return_shipping_mu;
  const effCod = codSurvived - codFeeTotal - codReturnShip;
  const effPrepaid = prepaidSurvived - gatewayFeeTotal - prepaidReturnShip;
  // Break-even (FULL legacy formula) — single final FLOOR-to-bp.
  const restocking = 0n;
  const denom = aov + c.return_shipping_mu + restocking;
  const pgFee = (aov * BigInt(c.gateway_fee_bp)) / 10000n;
  const numScaled =
    aov * BigInt(prepaidRtoBp) +
    (c.cod_fee_mu - pgFee) * 10000n +
    BigInt(prepaidRtoBp) * (c.return_shipping_mu + restocking);
  const breakeven = denom > 0n ? Number(numScaled / denom) : null; // 500bp
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: c.period,
    data_epoch: DATA_EPOCH,
    currency_code: c.currency_code,
    cod_orders: c.cod_orders,
    prepaid_orders: c.prepaid_orders,
    cod_realization_rate_bp: _ratioBp(c.cod_delivered, c.cod_orders), // 7650
    cod_rto_rate_bp: codRtoBp,
    prepaid_rto_rate_bp: prepaidRtoBp,
    effective_revenue_cod_mu: effCod,
    effective_revenue_prepaid_mu: effPrepaid,
    prepaid_premium_mu: effPrepaid - effCod,
    average_order_value_mu: aov,
    breakeven_cod_rto_rate_bp: breakeven,
    breakeven_note: null,
    comparison: [
      {
        payment_method: 'COD',
        orders: c.cod_orders,
        gross_revenue_mu: c.gross_revenue_cod_mu,
        rto_rate_bp: codRtoBp,
        effective_revenue_mu: effCod,
        fee_total_mu: codFeeTotal + codReturnShip,
        net_revenue_per_order_mu: c.cod_orders > 0n ? effCod / c.cod_orders : null,
      },
      {
        payment_method: 'Prepaid',
        orders: c.prepaid_orders,
        gross_revenue_mu: c.gross_revenue_prepaid_mu,
        rto_rate_bp: prepaidRtoBp,
        effective_revenue_mu: effPrepaid,
        fee_total_mu: gatewayFeeTotal + prepaidReturnShip,
        net_revenue_per_order_mu: c.prepaid_orders > 0n ? effPrepaid / c.prepaid_orders : null,
      },
    ],
  };
}

function buildSugandhlokLogistics(): LogisticsResult {
  const c = SUGANDH_LOK_CANONICAL;
  const totalCharges = c.forward_charges_mu + c.cod_charges_mu + c.rto_charges_mu;
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: c.period,
    data_epoch: DATA_EPOCH,
    currency_code: c.currency_code,
    total_shipments: c.total_shipments,
    delivered_count: c.delivered_count,
    delivered_rate_bp: _ratioBp(c.delivered_count, c.total_shipments), // 7858
    rto_count: c.rto_orders,
    rto_rate_bp: _ratioBp(c.rto_orders, c.total_shipments),            // 1796
    cod_count: c.cod_orders,
    prepaid_count: c.total_shipments - c.cod_orders,                  // 447
    forward_charges_mu: c.forward_charges_mu,
    cod_charges_mu: c.cod_charges_mu,
    rto_charges_mu: c.rto_charges_mu,
    total_shiprocket_charges_mu: totalCharges,
    average_shipping_charge_per_shipment_mu:
      c.total_shipments > 0n ? totalCharges / c.total_shipments : null,
    by_courier: [
      { courier_name: 'Delhivery', count: 700n, delivered_count: 560n, rto_count: 120n, total_charges_mu: 7_000_000n },
      { courier_name: 'Bluedart', count: 547n, delivered_count: 420n, rto_count: 104n, total_charges_mu: 6_680_000n },
    ],
  };
}

const _PINCODE_SEED: Array<{
  pincode: string; city: string; state: string;
  shipment_count: bigint; rto_count: bigint; cod_count: bigint; delivered_count: bigint;
  revenue_mu: bigint; unique_customers: bigint; repeat_customers: bigint; top_courier: string;
}> = [
  { pincode: '400001', city: 'Mumbai', state: 'Maharashtra', shipment_count: 320n, rto_count: 48n, cod_count: 180n, delivered_count: 252n, revenue_mu: 37_800_000n, unique_customers: 160n, repeat_customers: 40n, top_courier: 'Delhivery' },
  { pincode: '110001', city: 'Delhi', state: 'Delhi', shipment_count: 280n, rto_count: 62n, cod_count: 196n, delivered_count: 196n, revenue_mu: 29_400_000n, unique_customers: 140n, repeat_customers: 22n, top_courier: 'Bluedart' },
  { pincode: '422001', city: 'Nashik', state: 'Maharashtra', shipment_count: 90n, rto_count: 27n, cod_count: 63n, delivered_count: 54n, revenue_mu: 8_100_000n, unique_customers: 45n, repeat_customers: 5n, top_courier: 'Delhivery' },
];

function buildSugandhlokPincode(filters?: PincodeFilterInput): PincodeIntelligenceResult {
  const c = SUGANDH_LOK_CANONICAL;
  const HIGH_RTO_BP = 2000;
  const HIGH_COD_BP = 5000;
  let rows: PincodeRow[] = _PINCODE_SEED.map((p) => {
    const sc = p.shipment_count;
    const rtoBp = _ratioBp(p.rto_count, sc);
    const codBp = _ratioBp(p.cod_count, sc);
    const deliveredBp = _ratioBp(p.delivered_count, sc);
    const aov = p.delivered_count > 0n ? p.revenue_mu / p.delivered_count : null;
    const repeatBp = _ratioBp(p.repeat_customers, p.unique_customers);
    // reliability (centi-points): 10000 - rto_bp*2 - intDiv(cod_bp,2) + intDiv(repeat_bp,2) + intDiv(aov_mu,100)
    const rRto = BigInt(rtoBp ?? 0);
    const rCod = BigInt(codBp ?? 0);
    const rRepeat = BigInt(repeatBp ?? 0);
    const rAov = aov ?? 0n;
    const raw = 10000n - rRto * 2n - rCod / 2n + rRepeat / 2n + rAov / 100n;
    const score = Number(raw < 0n ? 0n : raw > 10000n ? 10000n : raw);
    const tier =
      ['mumbai', 'delhi'].includes(p.city.toLowerCase()) ? 1 :
      p.city.toLowerCase() === 'nashik' ? 2 : 3;
    return {
      pincode: p.pincode, city: p.city, state: p.state, tier,
      shipment_count: sc, rto_count: p.rto_count, rto_rate_bp: rtoBp,
      cod_count: p.cod_count, cod_rate_bp: codBp,
      delivered_count: p.delivered_count, delivered_rate_bp: deliveredBp,
      revenue_mu: p.revenue_mu, aov_mu: aov,
      unique_customers: p.unique_customers, repeat_rate_bp: repeatBp,
      reliability_score: score, top_courier: p.top_courier,
    };
  });
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter((r) => r.pincode.toLowerCase().includes(q) || r.city.toLowerCase().includes(q) || r.state.toLowerCase().includes(q));
  }
  if (filters?.state) rows = rows.filter((r) => r.state.toLowerCase() === filters.state!.toLowerCase());
  if (filters?.min_orders) rows = rows.filter((r) => r.shipment_count >= BigInt(filters.min_orders!));
  if (filters?.high_rto) rows = rows.filter((r) => r.rto_rate_bp !== null && r.rto_rate_bp >= HIGH_RTO_BP);
  if (filters?.high_cod) rows = rows.filter((r) => r.cod_rate_bp !== null && r.cod_rate_bp >= HIGH_COD_BP);
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: c.period,
    data_epoch: DATA_EPOCH,
    currency_code: c.currency_code,
    rows,
    total_shipments: _PINCODE_SEED.reduce((s, p) => s + p.shipment_count, 0n),
  };
}

// ---------------------------------------------------------------------------
// Slice-4 (feat-marketing-acquisition) builders — derived from SUGANDH_LOK_CANONICAL.
// Mirror the analytics-service marketing use-case math (registry formulas; integer FLOOR).
// ONE seed → /acquisition + /distributions share consistent facts; MER numerator ==
// the /store net_revenue (cross-surface consistency); aMER uses acquisition-classified spend.
// ---------------------------------------------------------------------------

function buildSugandhlokMarketingEfficiency(): MarketingEfficiencyResult {
  const c = SUGANDH_LOK_CANONICAL;
  const mer = _ratioBp(c.net_revenue_mu, c.total_ad_spend_mu);            // 191M/65M = 29384bp
  const amer = _ratioBp(c.new_customer_revenue_mu, c.acquisition_ad_spend_mu); // 78M/26M = 30000bp
  const acos = _ratioBp(c.total_ad_spend_mu, c.net_revenue_mu);           // display
  const roas =
    c.total_ad_spend_mu > 0n ? Number((c.net_revenue_mu * 100n) / c.total_ad_spend_mu) : null; // ×100
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: c.period,
    data_epoch: DATA_EPOCH,
    currency_code: c.currency_code,
    net_revenue_mu: c.net_revenue_mu,
    total_ad_spend_mu: c.total_ad_spend_mu,
    new_customer_revenue_mu: c.new_customer_revenue_mu,
    acquisition_ad_spend_mu: c.acquisition_ad_spend_mu,
    meta_spend_mu: c.meta_spend_mu,
    google_spend_mu: c.google_spend_mu,
    mer_bp: mer,
    amer_bp: amer,
    acos_bp: acos,
    blended_roas_x100: roas,
  };
}

function buildSugandhlokAcquisition(): AcquisitionSummaryResult {
  const c = SUGANDH_LOK_CANONICAL;
  const cac = c.new_customers_count > 0n ? c.total_ad_spend_mu / c.new_customers_count : null; // 16250
  const cm2PerNc = c.new_customers_count > 0n ? c.nc_cm2_mu / c.new_customers_count : null;     // 3250
  const amer = _ratioBp(c.new_customer_revenue_mu, c.acquisition_ad_spend_mu);                  // 30000bp
  // Two representative days summing to the period totals (cross-surface consistent).
  const daily: AcquisitionDailyRow[] = [
    {
      date: '2026-04-01', new_customers: 1_600n, nc_cm2_mu: 5_200_000n, nc_revenue_mu: 31_200_000n,
      ad_spend_mu: 26_000_000n, acquisition_ad_spend_mu: 10_400_000n,
      cac_mu: 26_000_000n / 1_600n, cm2_per_nc_mu: 5_200_000n / 1_600n,
      amer_bp: _ratioBp(31_200_000n, 10_400_000n), meta_spend_mu: 15_600_000n, google_spend_mu: 10_400_000n,
    },
    {
      date: '2026-04-02', new_customers: 2_400n, nc_cm2_mu: 7_800_000n, nc_revenue_mu: 46_800_000n,
      ad_spend_mu: 39_000_000n, acquisition_ad_spend_mu: 15_600_000n,
      cac_mu: 39_000_000n / 2_400n, cm2_per_nc_mu: 7_800_000n / 2_400n,
      amer_bp: _ratioBp(46_800_000n, 15_600_000n), meta_spend_mu: 23_400_000n, google_spend_mu: 15_600_000n,
    },
  ];
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: c.period,
    data_epoch: DATA_EPOCH,
    currency_code: c.currency_code,
    new_customers_count: c.new_customers_count,
    nc_cm2_mu: c.nc_cm2_mu,
    new_customer_revenue_mu: c.new_customer_revenue_mu,
    total_ad_spend_mu: c.total_ad_spend_mu,
    acquisition_ad_spend_mu: c.acquisition_ad_spend_mu,
    meta_spend_mu: c.meta_spend_mu,
    google_spend_mu: c.google_spend_mu,
    cac_mu: cac,
    cm2_per_nc_mu: cm2PerNc,
    amer_bp: amer,
    daily,
  };
}

// ---------------------------------------------------------------------------
// Cohorts + LTV (Phase-2 slice-5: feat-cohorts-ltv). The builders mirror the
// analytics-service use-case math so the wire output equals the use-case anchors.
// Cohorts use CM3; LTV uses CM2; payback is the cumulative bucket-walk (centi-months).
// ---------------------------------------------------------------------------

// Two cohorts for the anchor brand. Per-customer numbers are deliberately chosen so
// the headline payback and LTV:CAC are clean.
const _COHORT_SEED = [
  {
    cohort_month: '2026-01', new_customers: 1000n, month_spend_mu: 50_000_000n, // cac 50000
    sum_fo_cm3_mu: 30_000_000n, sum_fo_realized_cm3_mu: 30_000_000n,            // fo 30000/cust
    repeat_90d: 300n,                                                            // rr90 3000bp
    incr_cm3_mu: [20_000_000n, 10_000_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], // 20000,10000/cust
    incr_revenue_mu: [40_000_000n, 20_000_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    incr_repeat_customers: [300n, 150n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    incr_repurchase_orders: [350n, 160n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
  },
  {
    cohort_month: '2026-02', new_customers: 800n, month_spend_mu: 32_000_000n,  // cac 40000
    sum_fo_cm3_mu: 28_000_000n, sum_fo_realized_cm3_mu: 28_000_000n,            // fo 35000/cust
    repeat_90d: 200n,                                                            // rr90 2500bp
    incr_cm3_mu: [12_000_000n, 8_000_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    incr_revenue_mu: [24_000_000n, 16_000_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    incr_repeat_customers: [200n, 100n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    incr_repurchase_orders: [240n, 110n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
  },
];

function _avgInt(total: bigint, n: bigint): bigint {
  return n > 0n ? total / n : 0n;
}

/** Cumulative bucket-walk payback in centi-months (×100). Mirrors the use-case. */
function _cohortPaybackCentimonths(
  foRealized: bigint, cac: bigint, incrCm3: bigint[], n: bigint, metric: string, mode: string,
): number | null {
  if (metric !== 'cm3' && metric !== 'revenue') return null;
  if (n <= 0n) return null;
  const incr = incrCm3.map((v) => v / n);
  const foPer = foRealized / n;
  let cum = foPer - cac;
  if (cum >= 0n) return 0;
  for (let k = 1; k <= 12; k++) {
    const incrVal = incr[k - 1] ?? 0n;
    const prevCum = cum;
    cum += incrVal;
    if (cum >= 0n) {
      if (metric === 'cm3' && mode === 'post' && incrVal > 0n && prevCum < 0n) {
        const fracCenti = (100n * -prevCum) / incrVal;
        return (k - 1) * 100 + Number(fracCenti);
      }
      return k * 100;
    }
  }
  return null;
}

function _applyCohortMode(
  metric: string, mode: string, firstOrder: bigint, firstOrderR: bigint, cac: bigint, incr: bigint[],
): bigint[] {
  if (metric === 'cm3' || metric === 'revenue') {
    const fo = metric === 'cm3' ? firstOrderR : firstOrder;
    if (mode === 'incr') return [...incr];
    if (mode === 'post') {
      if (metric === 'cm3') return [...incr];
      let s = 0n; return incr.map((v) => (s += v));
    }
    if (mode === 'cumulative') { let s = fo; return incr.map((v) => (s += v)); }
    if (mode === 'pct') {
      const denom = (fo < 0n ? -fo : fo) > 0n ? (fo < 0n ? -fo : fo) : 1n;
      let s = fo; return incr.map((v) => { s += v; return (s * 10000n) / denom; });
    }
    if (mode === 'ltvcac') {
      const denom = cac > 0n ? cac : 1n;
      let s = fo; return incr.map((v) => { s += v; return (s * 10000n) / denom; });
    }
  } else {
    if (mode === 'post') { let s = 0n; return incr.map((v) => (s += v)); }
    return [...incr];
  }
  return [...incr];
}

function buildSugandhlokCohortMatrix(filters?: CohortFilterInput): CohortMatrixResult {
  const metric = filters?.metric ?? 'cm3';
  const mode = filters?.mode ?? 'post';
  const rows: CohortRow[] = [];
  let totalNew = 0n;
  let repeat90Total = 0n;
  let totalAdSpend = 0n;
  let paybackWeightedSum = 0;
  let paybackWeight = 0;

  for (const c of _COHORT_SEED) {
    const n = c.new_customers;
    totalNew += n;
    repeat90Total += c.repeat_90d;
    totalAdSpend += c.month_spend_mu;
    const cac = n > 0n ? c.month_spend_mu / n : null;
    const rr90 = n > 0n ? _ratioBp(c.repeat_90d, n) : null;
    const firstOrder = _avgInt(c.sum_fo_cm3_mu, n);
    const firstOrderR = _avgInt(c.sum_fo_realized_cm3_mu, n);

    let incrPer: bigint[];
    if (metric === 'cm3') incrPer = c.incr_cm3_mu.map((v) => (n > 0n ? v / n : 0n));
    else if (metric === 'revenue') incrPer = c.incr_revenue_mu.map((v) => (n > 0n ? v / n : 0n));
    else if (metric === 'repeat') incrPer = c.incr_repeat_customers.map((v) => (n > 0n ? (_ratioBp(v, n) ?? 0) : 0)).map((x) => BigInt(x));
    else incrPer = c.incr_repurchase_orders.map((v) => (n > 0n ? v / n : 0n));

    const cm3Per = c.incr_cm3_mu.map((v) => (n > 0n ? v / n : 0n));
    let ltv = firstOrderR;
    for (const step of cm3Per) ltv = ltv + step;
    const ltvCac = cac && cac > 0n ? _ratioBp(ltv, cac) : null;

    const payback = _cohortPaybackCentimonths(c.sum_fo_realized_cm3_mu, cac ?? 0n, c.incr_cm3_mu, n, metric, mode);
    if (payback !== null && n > 0n) { paybackWeightedSum += payback * Number(n); paybackWeight += Number(n); }

    const m = _applyCohortMode(metric, mode, firstOrder, firstOrderR, cac ?? 0n, incrPer);

    rows.push({
      cohort_month: c.cohort_month, new_customers: n, cac_mu: cac, rr90_bp: rr90,
      payback_centimonths: payback, first_order_cm3_mu: firstOrder,
      first_order_realized_cm3_mu: firstOrderR, cohort_ltv_mu: ltv, ltv_cac_bp: ltvCac, m,
    });
  }

  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID, period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH, currency_code: SUGANDH_LOK_CANONICAL.currency_code,
    metric, mode,
    average_cac_mu: totalNew > 0n ? totalAdSpend / totalNew : null,
    avg_90day_repeat_bp: totalNew > 0n ? _ratioBp(repeat90Total, totalNew) : null,
    average_payback_centimonths: paybackWeight > 0 ? Math.trunc(paybackWeightedSum / paybackWeight) : null,
    new_customers: totalNew, rows,
  };
}

// LTV-by-dimension seed (product). cm2 values per the anchor brand.
const _LTV_SEED = [
  {
    dimension_value: 'p_oud', dimension_label: 'Sugandh Oud Attar 12ml', new_customers: 600n, orders_count: 1500n,
    sum_fo_mu: 600_000_000n, sum_fo_realized_mu: 600_000_000n,           // fo 1000000/cust
    incr_value_mu: [300_000_000n, 180_000_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], // 500000,300000/cust
    incr_repeat_customers: [240n, 120n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
  },
  {
    dimension_value: 'p_rose', dimension_label: 'Rose Mist 50ml', new_customers: 400n, orders_count: 700n,
    sum_fo_mu: 200_000_000n, sum_fo_realized_mu: 200_000_000n,           // fo 500000/cust
    incr_value_mu: [80_000_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], // 200000/cust
    incr_repeat_customers: [80n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
  },
];

function _applyLtvMode(mode: string, fo: bigint, incr: bigint[]): bigint[] {
  if (mode === 'cumulative') { let s = fo; return incr.map((v) => (s += v)); }
  if (mode === 'post_acq') { let s = 0n; return incr.map((v) => (s += v)); }
  return [...incr];
}

function buildSugandhlokLtvSummary(filters?: LtvFilterInput): LtvSummaryResult {
  const metric = filters?.metric ?? 'cm2';
  const mode = filters?.mode ?? 'cumulative';
  const dimension = filters?.dimension ?? 'product';
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters?.page_size ?? 20));
  const search = filters?.search;

  const allRows: LtvRow[] = [];
  let sumFo = 0n, sumFoR = 0n;
  const sumIncr = new Array<bigint>(12).fill(0n);

  for (const d of _LTV_SEED) {
    const n = d.new_customers;
    if (n === 0n) continue;
    const isRepeat = metric === 'repeat_rate';
    const fo = isRepeat ? 0n : d.sum_fo_mu / n;
    const foR = isRepeat ? 0n : d.sum_fo_realized_mu / n;
    const incr = isRepeat
      ? d.incr_repeat_customers.map((v) => BigInt(_ratioBp(v, n) ?? 0))
      : d.incr_value_mu.map((v) => v / n);
    const m = _applyLtvMode(mode, isRepeat ? 0n : foR, incr);

    allRows.push({
      dimension_value: d.dimension_value, dimension_label: d.dimension_label,
      orders_count: d.orders_count, new_customers: n,
      first_order_realized_mu: foR, first_order_mu: fo, m,
    });
    sumFo += fo * n; sumFoR += foR * n;
    for (let k = 0; k < 12; k++) sumIncr[k] = (sumIncr[k] ?? 0n) + (incr[k] ?? 0n) * n;
  }

  allRows.sort((a, b) => (b.dimension_label || '').localeCompare(a.dimension_label || ''));
  let filtered = allRows;
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = allRows.filter((r) => r.dimension_label.toLowerCase().includes(q));
  }
  const totalRows = filtered.length;
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const totalN = allRows.reduce((s, r) => s + r.new_customers, 0n);
  const avgFo = totalN > 0n ? sumFo / totalN : 0n;
  const avgFoR = totalN > 0n ? sumFoR / totalN : 0n;
  const avgIncr = sumIncr.map((s) => (totalN > 0n ? s / totalN : 0n));
  const baseFo = metric === 'repeat_rate' ? 0n : avgFoR;
  const cards = _applyLtvMode(mode, baseFo, avgIncr);

  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID, period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH, currency_code: SUGANDH_LOK_CANONICAL.currency_code,
    metric, mode, dimension,
    first_order_mu: metric === 'repeat_rate' ? 0n : avgFo,
    first_order_realized_mu: metric === 'repeat_rate' ? 0n : avgFoR,
    month1_mu: metric === 'repeat_rate' ? (avgIncr[0] ?? 0n) : (cards[0] ?? 0n),
    month3_mu: metric === 'repeat_rate' ? (avgIncr[2] ?? 0n) : (cards[2] ?? 0n),
    month6_mu: metric === 'repeat_rate' ? (avgIncr[5] ?? 0n) : (cards[5] ?? 0n),
    month12_mu: metric === 'repeat_rate' ? (avgIncr[11] ?? 0n) : (cards[11] ?? 0n),
    new_customers: totalN, total_rows: BigInt(totalRows), rows: paginated,
  };
}

// Per-product per-order value arrays (paise) for the distributions histogram.
const _DISTRIBUTIONS_SEED: { product: string; sales: bigint[]; cm1: bigint[] }[] = [
  {
    product: 'Sugandh Oud Attar 12ml',
    sales: [120_000n, 120_000n, 120_000n, 240_000n, 360_000n, 120_000n],
    cm1: [48_000n, 48_000n, 48_000n, 96_000n, 144_000n, 48_000n],
  },
  {
    product: 'Rose Mist 50ml',
    sales: [60_000n, 60_000n, 90_000n, 60_000n],
    cm1: [24_000n, 24_000n, 36_000n, 24_000n],
  },
  {
    product: 'Sandalwood Soap (Pack of 3)',
    sales: [45_000n, 45_000n, 45_000n, 90_000n],
    cm1: [18_000n, 18_000n, 18_000n, 36_000n],
  },
];

function _modeMu(values: bigint[]): bigint {
  if (values.length === 0) return 0n;
  const rounded = values.map((v) => ((v + 50n) / 100n) * 100n);
  const freq = new Map<bigint, number>();
  for (const r of rounded) freq.set(r, (freq.get(r) ?? 0) + 1);
  let best = rounded[0]!;
  let bestCount = 0;
  for (const [val, count] of freq) {
    if (count > bestCount || (count === bestCount && val < best)) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

function _meanMu(values: bigint[]): bigint {
  if (values.length === 0) return 0n;
  return values.reduce((s, v) => s + v, 0n) / BigInt(values.length);
}

function buildSugandhlokDistributions(filters?: DistributionsFilterInput): DistributionsResult {
  const c = SUGANDH_LOK_CANONICAL;
  const metric: 'sales' | 'cm1' = filters?.metric === 'sales' ? 'sales' : 'cm1';
  const all: bigint[] = [];
  let rows: DistributionsProductRow[] = _DISTRIBUTIONS_SEED.map((p) => {
    const v = metric === 'sales' ? p.sales : p.cm1;
    all.push(...v);
    const mode = _modeMu(v);
    const mean = _meanMu(v);
    return {
      product: p.product,
      orders: BigInt(p.sales.length),
      mode_mu: mode,
      mean_mu: mean,
      diff_mu: mode - mean,
    };
  });
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter((r) => r.product.toLowerCase().includes(q));
  }
  const totalRows = rows.length;
  const sort = filters?.sort && ['product', 'orders', 'mode', 'mean', 'diff'].includes(filters.sort)
    ? filters.sort : 'orders';
  const asc = filters?.order === 'asc';
  rows.sort((a, b) => {
    let d = 0;
    if (sort === 'product') d = a.product.localeCompare(b.product);
    else if (sort === 'mode') d = Number(a.mode_mu - b.mode_mu);
    else if (sort === 'mean') d = Number(a.mean_mu - b.mean_mu);
    else if (sort === 'diff') d = Number(a.diff_mu - b.diff_mu);
    else d = Number(a.orders - b.orders);
    return asc ? d : -d;
  });
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters?.page_size ?? 20));
  const paginated = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  // 60-bucket histogram (integer paise; density bp).
  const points: DistributionsGraphPoint[] = [];
  let globalMode = 0n;
  let globalMean = 0n;
  if (all.length > 0) {
    globalMode = _modeMu(all);
    globalMean = _meanMu(all);
    const lo = all.reduce((m, v) => (v < m ? v : m), all[0]!);
    const hi = all.reduce((m, v) => (v > m ? v : m), all[0]!);
    const rng = hi - lo > 0n ? hi - lo : 1n;
    const bucketWidth = rng / 60n > 0n ? rng / 60n : 1n;
    const counts = new Array(60).fill(0);
    for (const v of all) {
      let idx = Number((v - lo) / bucketWidth);
      if (idx < 0) idx = 0;
      if (idx >= 60) idx = 59;
      counts[idx]++;
    }
    const total = all.length;
    for (let i = 0; i < 60; i++) {
      points.push({
        value_mu: lo + BigInt(i) * bucketWidth + bucketWidth / 2n,
        density_bp: total > 0 ? Math.floor((counts[i] * 10000) / total) : 0,
      });
    }
  }
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: c.period,
    data_epoch: DATA_EPOCH,
    currency_code: c.currency_code,
    metric,
    rows: paginated,
    total_rows: BigInt(totalRows),
    graph_points: points,
    global_mode_mu: globalMode,
    global_mean_mu: globalMean,
  };
}

/** Sugandh-Lok Morning Brief seed (registry-derived; NOT LLM numbers). */
function buildSugandhlokBrief(): MorningBrief {
  return {
    items: [
      {
        insight_id: '11111111-1111-1111-1111-111111111111',
        title: 'RTO rate above 18% — review top return SKUs',
        severity: 'WARNING',
        confidence_display_pct: 91,  // CF-C6-NO-UI-FLOAT-1: pre-formatted int
        summary: 'Your return-to-origin rate crossed 18% in the last 7 days.',
        detail: 'SKUs #SL-042 and #SL-108 account for 62% of RTO volume.',
        recommendation: {
          action: 'REVIEW_MANUALLY',
          entity_id: 'SL-042',
          rationale: 'Catalogue quality issues on synthetic fabric SKUs are driving RTO. Review product descriptions.',
        },
        expected_impact: {
          // Registry-DERIVED: 2pp RTO reduction × 1247 orders × ~₹1483 AOV
          revenue_mu: 3_700_000n,    // ~₹37K recovered revenue
          cm2_mu: 1_200_000n,        // ~₹12K CM2 improvement
          currency_code: 'INR',
          impact_label: '+₹37K net revenue / +₹12K CM2',
        },
        risk: 'LOW',
        data_epoch: DATA_EPOCH,
      },
      {
        insight_id: '22222222-2222-2222-2222-222222222222',
        title: 'Meta ROAS below 2.5× threshold on summer collection',
        severity: 'WARNING',
        confidence_display_pct: 84,
        summary: 'Blended ROAS dropped to 2.3× on summer collection ad sets.',
        detail: 'CPM increased 28% in the last 3 days — possibly competition pressure.',
        recommendation: {
          action: 'DECREASE_BUDGET',
          entity_id: 'ad_set_meta_summer_2026',
          rationale: 'Reducing budget by 20% on underperforming ad sets preserves CM2 margin.',
        },
        expected_impact: {
          // Registry-DERIVED: budget reduction saves ₹8K ad spend at cost of ~₹2.5K revenue
          revenue_mu: -2_500_000n,
          cm2_mu: 5_500_000n,        // net CM2 improvement after reduced ad spend
          currency_code: 'INR',
          impact_label: '-₹25K revenue / +₹55K CM2 (net positive)',
        },
        risk: 'MEDIUM',
        data_epoch: DATA_EPOCH,
      },
      {
        insight_id: '33333333-3333-3333-3333-333333333333',
        title: 'Prepaid rate at 41% — nudge opportunity',
        severity: 'INFO',
        confidence_display_pct: 76,
        summary: 'Prepaid adoption is 41%, up from 34% last month.',
        detail: 'Customers who received the ₹20 prepaid discount converted at 3.1×.',
        recommendation: {
          action: 'REVIEW_MANUALLY',
          entity_id: 'prepaid_discount_config',
          rationale: 'Expanding the prepaid discount to the next price segment could increase prepaid rate to ~48%.',
        },
        expected_impact: {
          revenue_mu: 5_200_000n,
          cm2_mu: 3_800_000n,
          currency_code: 'INR',
          impact_label: '+₹52K net revenue / +₹38K CM2',
        },
        risk: 'LOW',
        data_epoch: DATA_EPOCH,
      },
    ],
    data_epoch: DATA_EPOCH,
    freshness_label: 'Live',
  };
}

// ---------------------------------------------------------------------------
// Decision log in-memory store (LOCAL harness only).
// In production: this write goes through _write_decision_log in graduation_middleware.py.
// ---------------------------------------------------------------------------

interface DecisionLogRow {
  row_id: string;
  workspace_id: string;
  insight_id: string;
  response_kind: string;
  idempotency_key: string;
  created_at: Date;
}

export class InMemoryDecisionLog {
  private readonly rows: DecisionLogRow[] = [];

  insert(row: DecisionLogRow): void {
    this.rows.push(row);
  }

  countByIdempotencyKey(idempotencyKey: string): number {
    return this.rows.filter((r) => r.idempotency_key === idempotencyKey).length;
  }

  getAll(): readonly DecisionLogRow[] {
    return this.rows;
  }

  clear(): void {
    this.rows.length = 0;
  }
}

let _rowCounter = 0;

function newRowId(): string {
  return `row_${++_rowCounter}_${Date.now()}`;
}

// ---------------------------------------------------------------------------
// StubDataPlane — the LOCAL harness + test implementation of DataPlanePort.
// Accepts an optional InMemoryDecisionLog for G-IDEMPOTENT gate testing.
// ---------------------------------------------------------------------------

export class StubDataPlane implements DataPlanePort {
  constructor(
    private readonly decisionLog = new InMemoryDecisionLog(),
    private readonly workspaceId = SUGANDH_LOK_WORKSPACE_ID,
  ) {}

  async queryMetrics(params: {
    workspace_id: string;
    definition_ids: string[];
    date_range: DateRange;
    cursor?: string;
    page_size?: number;
  }): Promise<{ rows: MetricRow[]; data_epoch: Date; next_cursor: string }> {
    // Fail-closed: workspace_id MUST match (mirrors query_metrics UnscopedQueryError).
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }

    // Generate deterministic daily rows for the date range.
    const rows = this.generateDailyRows(params.date_range, params.workspace_id);
    return { rows, data_epoch: DATA_EPOCH, next_cursor: '' };
  }

  async getKpiSummary(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ summary: KpiSummaryRow; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { summary: SUGANDH_LOK_KPI, data_epoch: DATA_EPOCH };
  }

  async getPnlWaterfall(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ steps: PnlWaterfallRow[]; data_epoch: Date }> {
    // Phase-2 slice-2: re-pointed to the SAME honest builder as getCmWaterfall —
    // ONE CM-waterfall source of truth (Single-Primitive Rule). metrics.pnlWaterfall
    // (Child-6 alias) and pnl.cmWaterfall therefore never diverge.
    return this.getCmWaterfall(params);
  }

  async getCmWaterfall(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ steps: PnlWaterfallRow[]; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { steps: buildSugandhlokCmWaterfall(), data_epoch: DATA_EPOCH };
  }

  async getPnlStatement(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ statement: PnlStatementRow; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { statement: buildSugandhlokPnlStatement(), data_epoch: DATA_EPOCH };
  }

  async getStoreSummary(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ summary: StoreSummaryRow; ladder: StoreRevenueLadderStep[]; data_epoch: Date }> {
    // Fail-closed tenancy: mirrors query_metrics UnscopedQueryError.
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    const { summary, ladder } = buildSugandhlokStoreSummary();
    return { summary, ladder, data_epoch: DATA_EPOCH };
  }

  async getRtoAnalytics(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: RtoAnalyticsResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokRtoAnalytics(), data_epoch: DATA_EPOCH };
  }

  async getCodPrepaid(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: CodPrepaidResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokCodPrepaid(), data_epoch: DATA_EPOCH };
  }

  async getLogistics(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: LogisticsResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokLogistics(), data_epoch: DATA_EPOCH };
  }

  async getPincodeIntelligence(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: PincodeFilterInput;
  }): Promise<{ result: PincodeIntelligenceResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokPincode(params.filters), data_epoch: DATA_EPOCH };
  }

  async getMarketingEfficiency(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: MarketingEfficiencyResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokMarketingEfficiency(), data_epoch: DATA_EPOCH };
  }

  async getAcquisitionSummary(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: AcquisitionSummaryResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokAcquisition(), data_epoch: DATA_EPOCH };
  }

  async getDistributions(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: DistributionsFilterInput;
  }): Promise<{ result: DistributionsResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokDistributions(params.filters), data_epoch: DATA_EPOCH };
  }

  async getCohortMatrix(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: CohortFilterInput;
  }): Promise<{ result: CohortMatrixResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokCohortMatrix(params.filters), data_epoch: DATA_EPOCH };
  }

  async getLtvSummary(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: LtvFilterInput;
  }): Promise<{ result: LtvSummaryResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokLtvSummary(params.filters), data_epoch: DATA_EPOCH };
  }

  async getMorningBrief(params: {
    workspace_id: string;
    date: string;
  }): Promise<MorningBrief> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return buildSugandhlokBrief();
  }

  async submitInsightResponse(params: {
    workspace_id: string;
    insight_id: string;
    response_kind: 'APPROVE' | 'REJECT' | 'EDIT';
    edit_payload?: string;
    idempotency_key: string;
  }): Promise<SubmitInsightResult> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }

    const row_id = newRowId();

    // Write ONE append-only row to the decision log.
    // The Redis dedup in morningBrief.submitResponse router ensures this
    // is only reached ONCE per idempotency_key.
    this.decisionLog.insert({
      row_id,
      workspace_id: params.workspace_id,
      insight_id: params.insight_id,
      response_kind: params.response_kind,
      idempotency_key: params.idempotency_key,
      created_at: new Date(),
    });

    return {
      decision_log_row_id: row_id,
      // CF-C6-MB-GRADUATED-LABEL-1: Day-1 = LOGGED_AS_VOTE. Never infer graduation.
      status: 'LOGGED_AS_VOTE',
    };
  }

  async registerPushToken(params: {
    workspace_id: string;
    user_id: string;
    device_id: string;
    expo_push_token: string;
  }): Promise<RegisterPushTokenResult> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return {
      registered: true,
      updated_at: new Date().toISOString(),
    };
  }

  getDecisionLog(): InMemoryDecisionLog {
    return this.decisionLog;
  }

  /** For tenancy isolation tests: returns stub for a different workspace_id. */
  static forWorkspace(workspaceId: string): StubDataPlane {
    return new StubDataPlane(new InMemoryDecisionLog(), workspaceId);
  }

  private generateDailyRows(dateRange: DateRange, workspaceId: string): MetricRow[] {
    const rows: MetricRow[] = [];
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      rows.push({
        workspace_id: workspaceId,
        date: dateStr,
        data_epoch: DATA_EPOCH,
        gross_sales_mu: 6_200_000n,
        returns_mu: 930_000n,
        discounts_mu: 310_000n,
        net_sales_mu: 4_960_000n,
        total_tax_mu: 496_000n,
        net_net_tax_mu: 4_464_000n,
        shipping_revenue_mu: 496_000n,
        net_revenue_mu: 4_960_000n,
        cogs_mu: 2_232_000n,
        total_ad_spend_mu: 1_736_000n,
        cm1_mu: 2_728_000n,
        cm2_mu: 992_000n,
        misc_expenses_prorated_mu: 200_000n,
        cm3_mu: 792_000n,
        rto_rate_bp: 1_800,
        prepaid_rate_bp: 4_100,
        conversion_rate_bp: 230,
        aov_mu: 1_483,
        acos_bp: 3_500,
        blended_roas_x100: 285,
        currency_code: 'INR',
      });

      current.setDate(current.getDate() + 1);
    }

    return rows;
  }
}

export { SUGANDH_LOK_WORKSPACE_ID, DATA_EPOCH };

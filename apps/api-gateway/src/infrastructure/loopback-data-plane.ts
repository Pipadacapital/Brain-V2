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
  PageInsightResult,
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
  ProductPerformanceResult,
  ProductRow,
  ProductFilterInput,
  ProductGroupBy,
  ProductSort,
  InventoryLevelsResult,
  InventoryRow,
  InventoryFilterInput,
  InventorySort,
  InventoryStatus,
  InventorySetLeadTimeInput,
  InventorySetLeadTimeResult,
  FirstProductCascadeResult,
  FirstProductCascadeRow,
  FirstProductCascadeFilterInput,
  GoalAttainmentResult,
  GoalEvaluationRow,
  GoalUpsertInput,
  GoalUpsertResult,
  CostStackResult,
  CostStackRow,
  FestivalCalendarResult,
  FestivalRow,
  FestivalCalendarFilterInput,
  CalendarReportResult,
  CalendarReportRow,
  CalendarCell,
  CalendarReportFilterInput,
  MarketingActionRow,
  ListMarketingActionsResult,
  CreateMarketingActionInput,
  UpdateMarketingActionInput,
  LifecycleStatesResult,
  LifecycleBucketRow,
  OrderTimingsResult,
  TimingsRow,
  TimingsFilterInput,
  EmailSmsPerformanceResult,
  EmailPerfRow,
  EmailSmsFilterInput,
  // Phase-2 slice-10 (feat-parity-cleanup-pages): thin honest READ surfaces.
  WorkspaceMembersResult,
  WorkspaceSettingsResult,
  IntegrationsResult,
  BackfillStatusResult,
} from '../domain/proto-types.js';
import {
  INVENTORY_DAYS_LEFT,
  INVENTORY_SELL_THROUGH_BP,
  FIRST_PRODUCT_SECOND_ORDER_RATE_BP,
  CM1_MU,
  AOV_MU,
  GOAL_ATTAINMENT_BP,
  computeGoalRag,
  goalHigherBetter,
  type GoalRag,
  // Phase-2 slice-8: READ/ANALYTICS ONLY
  REACTIVATION_WINDOW_DAYS,
  EMAIL_OPEN_RATE_BP,
  EMAIL_CLICK_RATE_BP,
  EMAIL_REVENUE_PER_RECIPIENT_MU,
} from '@brain/lib-metrics';

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
  returns_mu: 500_000n,              // ₹5K refunded orders (matches refunded_revenue_mu below)
  net_sales_mu: 206_000_000n,        // gross - discount = ₹20.6L
  total_tax_mu: 18_000_000n,         // ₹1.8L — SUM of per-SKU GST 2.0 (mixed slabs)
  net_net_tax_mu: 188_000_000n,      // net_sales - tax
  shipping_outbound_mu: 3_000_000n,  // ₹30K outbound shipping charge (= shipping_revenue_mu)
  shipping_revenue_mu: 3_000_000n,   // ₹30K shipping collected
  // gross_revenue_after_deductions = gross_sales − discounts − returns − tax − shipping_outbound
  // 218_000_000 − 12_000_000 − 500_000 − 18_000_000 − 3_000_000 = 184_500_000
  gross_revenue_after_deductions_mu: 184_500_000n, // ₹18.45L — Revenue After Tax & Shipping
  // net_revenue = net_net_tax + shipping = 191_000_000? Seed chosen so the
  // dashboard's existing ₹18.5L net_revenue stays the realized headline:
  net_revenue_mu: 191_000_000n,      // ₹19.1L
  // Post-sale reversals (the honest leak):
  cancelled_revenue_mu: 2_000_000n,  // ₹20K cancelled
  rto_reversed_revenue_mu: 3_500_000n, // ₹35K RTO-reversed
  refunded_revenue_mu: 500_000n,     // ₹5K refunded
  realized_revenue_mu: 185_000_000n, // ₹18.5L — net_revenue − 6_000_000 reversals
  // Founder salary (Wave-1 parity): ₹40K/month prorated
  founder_salary_mu: 4_000_000n,     // ₹40K founder salary (prorated Apr 2026)
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
 * Sugandh-Lok HONEST CM waterfall — Wave-1 parity (2026-05-30): full 16-step ladder.
 * Derived from SUGANDH_LOK_CANONICAL so /pnl, /waterfall and /dashboard share ONE
 * fact source. Steps follow the legacy waterfall.ts order exactly:
 *   Gross Sales → Discounts → Refunds → Tax → Shipping →
 *   Revenue After Tax & Shipping (SUBTOTAL) →
 *   COGS → Variable Costs → RTO Cost → CM1 (SUBTOTAL) →
 *   Ad Spend → CM2 (SUBTOTAL) →
 *   Fixed Cost → CM3 (SUBTOTAL) →
 *   Founder's Salary → Net Profit (SUBTOTAL)
 *
 * cumulative_mu at each step = running total after that step (chart invariant).
 * Zero-valued steps for inputs not yet connector-sourced (e.g. founder_salary = 0
 * if not seeded) are expressed as 0n so the ladder always terminates at Net Profit.
 * CF-C6-RENDER-ONLY-1: zero arithmetic in the render layer — all math is here.
 * CF-C6-REGISTRY-ONLY-BFF-1: every definition_id is in PNL_WATERFALL_DEFINITION_IDS.
 */
function buildSugandhlokCmWaterfall(): PnlWaterfallRow[] {
  const c = SUGANDH_LOK_CANONICAL;
  const epoch = DATA_EPOCH;
  const curr = 'INR';

  // ── Revenue deduction sub-ladder ──────────────────────────────────────────
  const grossSales = c.gross_sales_mu;                               // 218_000_000
  const afterDiscount = grossSales - c.total_discount_mu;            // 206_000_000
  const afterReturns = afterDiscount - c.returns_mu;                 // 205_500_000
  const afterTax = afterReturns - c.total_tax_mu;                    // 187_500_000
  const revenueAfterDeductions = afterTax - c.shipping_outbound_mu;  // 184_500_000 (= gross_revenue_after_deductions_mu)

  // ── Cost deduction ladder ──────────────────────────────────────────────────
  const afterCogs = revenueAfterDeductions - c.cogs_mu;              // 102_500_000
  const afterVarCosts = afterCogs - c.variable_costs_mu;             // 96_500_000
  const afterRto = afterVarCosts - c.rto_cost_mu;                    // 92_020_000
  // CM1 subtotal: Brain-canonical CM1 = net_revenue − cogs − variable_costs.
  // Mirrors cm_waterfall_query.py step 10: value_mu and cumulative_mu both reset
  // to c.cm1_mu (97_000_000), surfacing the DDR delta visually (the walk lands at
  // 92_020_000 but the subtotal bar resets to the canonical 97_000_000). All
  // downstream steps restart from this canonical CM1 so cm2/cm3 subtotals stay
  // consistent with the dashboard KPI seed (cm2_mu=32M, cm3_mu=28M).
  const cm1 = c.cm1_mu;                                              // 97_000_000 (canonical)
  const afterAdSpend = cm1 - c.total_ad_spend_mu;                    // 32_000_000 = cm2_mu
  const cm2 = c.cm2_mu;                                              // 32_000_000
  const afterFixed = cm2 - c.misc_expenses_prorated_mu;              // 28_000_000 = cm3_mu
  const cm3 = c.cm3_mu;                                              // 28_000_000
  const netProfit = cm3 - c.founder_salary_mu;                       // 24_000_000

  return [
    // ── Gross-to-net deduction sub-ladder ─────────────────────────────────
    { definition_id: 'gross_sales_mu',                  label: 'Gross Sales',                      value_mu: grossSales,               cumulative_mu: grossSales,               currency_code: curr, data_epoch: epoch },
    { definition_id: 'total_discount_mu',               label: 'Discounts',                         value_mu: -c.total_discount_mu,     cumulative_mu: afterDiscount,            currency_code: curr, data_epoch: epoch },
    { definition_id: 'returns_mu',                      label: 'Refunds',                           value_mu: -c.returns_mu,            cumulative_mu: afterReturns,             currency_code: curr, data_epoch: epoch },
    { definition_id: 'total_tax_mu',                    label: 'Tax',                               value_mu: -c.total_tax_mu,          cumulative_mu: afterTax,                 currency_code: curr, data_epoch: epoch },
    { definition_id: 'shipping_outbound_mu',            label: 'Shipping',                          value_mu: -c.shipping_outbound_mu,  cumulative_mu: revenueAfterDeductions,   currency_code: curr, data_epoch: epoch },
    { definition_id: 'gross_revenue_after_deductions_mu', label: 'Revenue After Tax & Shipping',  value_mu: revenueAfterDeductions,   cumulative_mu: revenueAfterDeductions,   currency_code: curr, data_epoch: epoch },
    // ── Cost ladder ───────────────────────────────────────────────────────
    { definition_id: 'cogs_mu',                         label: 'COGS',                              value_mu: -c.cogs_mu,               cumulative_mu: afterCogs,                currency_code: curr, data_epoch: epoch },
    { definition_id: 'variable_costs_mu',               label: 'Variable Costs',                    value_mu: -c.variable_costs_mu,     cumulative_mu: afterVarCosts,            currency_code: curr, data_epoch: epoch },
    { definition_id: 'rto_cost_mu',                     label: 'RTO Cost',                          value_mu: -c.rto_cost_mu,           cumulative_mu: afterRto,                 currency_code: curr, data_epoch: epoch },
    // CM1 subtotal resets cumulative to Brain-canonical CM1 (mirrors analytics step 10).
    { definition_id: 'cm1_mu',                          label: 'CM1',                               value_mu: cm1,                      cumulative_mu: cm1,                      currency_code: curr, data_epoch: epoch },
    // ── Ad spend ──────────────────────────────────────────────────────────
    { definition_id: 'total_ad_spend_mu',               label: 'Ad Spend',                          value_mu: -c.total_ad_spend_mu,     cumulative_mu: afterAdSpend,             currency_code: curr, data_epoch: epoch },
    { definition_id: 'cm2_mu',                          label: 'CM2',                               value_mu: cm2,                      cumulative_mu: cm2,                      currency_code: curr, data_epoch: epoch },
    // ── Fixed cost ────────────────────────────────────────────────────────
    { definition_id: 'misc_expenses_prorated_mu',       label: 'Fixed Cost',                        value_mu: -c.misc_expenses_prorated_mu, cumulative_mu: afterFixed,           currency_code: curr, data_epoch: epoch },
    { definition_id: 'cm3_mu',                          label: 'CM3',                               value_mu: cm3,                      cumulative_mu: cm3,                      currency_code: curr, data_epoch: epoch },
    // ── Founder salary → Net Profit ───────────────────────────────────────
    { definition_id: 'founder_salary_mu',               label: "Founder's Salary",                  value_mu: -c.founder_salary_mu,     cumulative_mu: netProfit,                currency_code: curr, data_epoch: epoch },
    { definition_id: 'net_profit_mu',                   label: 'Net Profit',                        value_mu: netProfit,                cumulative_mu: netProfit,                currency_code: curr, data_epoch: epoch },
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
    connected: true,
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
    by_product: [], // Shopify enrichment deferred (no mapped-order join in loopback seed)
  };
}

function buildSugandhlokCodPrepaid(feeOverrides?: import('../domain/proto-types.js').CodPrepaidFeeOverrides): CodPrepaidResult {
  const c = SUGANDH_LOK_CANONICAL;
  const totalOrders = c.cod_orders + c.prepaid_orders;            // 1000
  const totalGross = c.gross_revenue_cod_mu + c.gross_revenue_prepaid_mu; // 150_000_000
  const aov = totalOrders > 0n ? totalGross / totalOrders : 0n;   // 150000
  const codRtoBp = _ratioBp(c.cod_rto, c.cod_orders) ?? 0;        // 2250
  const prepaidRtoBp = _ratioBp(c.prepaid_rto, c.prepaid_orders) ?? 0; // 500
  // Fee assumptions — defaults match legacy (₹30 COD fee, ₹80 return shipping, 2% gateway).
  const codFeePerOrder = feeOverrides?.cod_fee_per_order_mu ?? c.cod_fee_mu;
  const returnShipping = feeOverrides?.return_shipping_per_rto_mu ?? c.return_shipping_mu;
  const gatewayFeeBp = feeOverrides?.gateway_fee_bp ?? c.gateway_fee_bp;
  // Effective revenue (integer FLOOR), mirrors the use-case.
  const codSurvived = c.gross_revenue_cod_mu - (c.gross_revenue_cod_mu * BigInt(codRtoBp)) / 10000n;
  const prepaidSurvived =
    c.gross_revenue_prepaid_mu - (c.gross_revenue_prepaid_mu * BigInt(prepaidRtoBp)) / 10000n;
  const codFeeTotal = c.cod_orders * codFeePerOrder;
  const gatewayFeeTotal = (c.gross_revenue_prepaid_mu * BigInt(gatewayFeeBp)) / 10000n;
  const codReturnShip = c.cod_rto * returnShipping;
  const prepaidReturnShip = c.prepaid_rto * returnShipping;
  const effCod = codSurvived - codFeeTotal - codReturnShip;
  const effPrepaid = prepaidSurvived - gatewayFeeTotal - prepaidReturnShip;
  const codFeeTotalRow = codFeeTotal + codReturnShip;
  const prepaidFeeTotalRow = gatewayFeeTotal + prepaidReturnShip;
  // Break-even (FULL legacy formula) — single final FLOOR-to-bp.
  const restocking = 0n;
  const denom = aov + returnShipping + restocking;
  const pgFee = (aov * BigInt(gatewayFeeBp)) / 10000n;
  const numScaled =
    aov * BigInt(prepaidRtoBp) +
    (codFeePerOrder - pgFee) * 10000n +
    BigInt(prepaidRtoBp) * (returnShipping + restocking);
  const breakeven = denom > 0n ? Number(numScaled / denom) : null; // 500bp
  const appliedOverrides: import('../domain/proto-types.js').CodPrepaidFeeOverrides = {
    cod_fee_per_order_mu: codFeePerOrder,
    return_shipping_per_rto_mu: returnShipping,
    gateway_fee_bp: gatewayFeeBp,
  };
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: c.period,
    data_epoch: DATA_EPOCH,
    currency_code: c.currency_code,
    connected: true,
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
    fee_overrides: appliedOverrides,
    comparison: [
      {
        payment_method: 'COD',
        orders: c.cod_orders,
        gross_revenue_mu: c.gross_revenue_cod_mu,
        rto_rate_bp: codRtoBp,
        effective_revenue_mu: effCod,
        fee_total_mu: codFeeTotalRow,
        net_revenue_mu: effCod - codFeeTotalRow,
        net_revenue_per_order_mu: c.cod_orders > 0n ? effCod / c.cod_orders : null,
      },
      {
        payment_method: 'Prepaid',
        orders: c.prepaid_orders,
        gross_revenue_mu: c.gross_revenue_prepaid_mu,
        rto_rate_bp: prepaidRtoBp,
        effective_revenue_mu: effPrepaid,
        fee_total_mu: prepaidFeeTotalRow,
        net_revenue_mu: effPrepaid - prepaidFeeTotalRow,
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

// ---------------------------------------------------------------------------
// Phase-2 slice-9 (feat-ai-insight-narration): GROUNDED page-level AI narration.
// @paradigm small_llm (Haiku) in production; LOCAL harness uses the deterministic
// grounded narrator below (no live Claude key) BEHIND the same gateway contract.
//
// CF-S9 (LLMs NEVER invent numbers): the narration is built from the SAME canonical
// seed numbers as the /pnl statement (Single source of truth). Every numeric token
// in the narration body is rendered from a signal value via formatMoney/bp, so the
// BFF faithfulness gate (assertInsightFaithfulness) finds every number in the signal
// set. There is NO action/tool field — READ-only (recommendation-only-until-graduated).
//
// The signals are the deterministic /pnl ladder (slices 1-2) PLUS the ad-spend &
// RTO-rate context. The narrator describes the honest CM2/CM3 story (India CM2-first
// framing) — it never computes; it only narrates the precomputed integers.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CF-S9-FAITHFULNESS canonical-unit convention (LOCKED, mirrors Child-5 golden set):
//   The narration cites Indian-lakh strings (e.g. "₹3.2L"). extractNumbers() (BFF)
//   and extract_numbers() (intelligence-service) normalize lakh with LAKH = 100_000,
//   i.e. "₹3.2L" → 320_000.  So the grounding signal's value_canonical is the value
//   in RUPEES (not paise): paise / 100.  This matches the Child-5 golden set
//   (Signal("net_sales_mu", 120_000) ↔ "₹1.2L").  The seed paise values stay the
//   single source of truth; we convert paise→rupee for the grounding set only.
// ---------------------------------------------------------------------------

const PAISE_PER_RUPEE = 100n;
const RUPEE_PER_LAKH = 100_000n; // 1 lakh = 100_000 ₹

/** Render a RUPEE-canonical value (paise/100) as the Indian lakh string the narrator cites.
 *  e.g. 320_000 rupee → "₹3.2L".  Matches extractNumbers("₹3.2L") = 320_000. */
function _lakhStr(rupee: bigint): string {
  const lakhs = Number(rupee) / Number(RUPEE_PER_LAKH); // rupee → lakh
  const oneDp = Math.round(lakhs * 10) / 10;            // seed values are clean to 0.1L
  return `₹${oneDp}L`;
}

/** Build the deterministic grounding signals for the /pnl page from the canonical seed.
 *  value_canonical is in RUPEES (paise/100) so "₹3.2L"→320_000 matches the signal set. */
function buildPnlPageSignals(): PageInsightSignalSeed[] {
  const c = SUGANDH_LOK_CANONICAL;
  const head = c.realized_revenue_mu;                 // 185_000_000 paise
  const cm1 = head - c.cogs_mu - c.variable_costs_mu; // 97_000_000
  const cm2 = cm1 - c.total_ad_spend_mu;              // 32_000_000
  const cm3 = cm2 - c.misc_expenses_prorated_mu;      // 28_000_000
  const toRupee = (paise: bigint): bigint => paise / PAISE_PER_RUPEE;
  return [
    { signal_id: 'realized_revenue_mu', value_canonical: toRupee(head), label: 'Realized Revenue' },
    { signal_id: 'cogs_mu', value_canonical: toRupee(c.cogs_mu), label: 'COGS' },
    { signal_id: 'total_ad_spend_mu', value_canonical: toRupee(c.total_ad_spend_mu), label: 'Ad Spend' },
    { signal_id: 'cm1_mu', value_canonical: toRupee(cm1), label: 'CM1 (Gross Contribution)' },
    { signal_id: 'cm2_mu', value_canonical: toRupee(cm2), label: 'CM2 (After Ads)' },
    { signal_id: 'cm3_mu', value_canonical: toRupee(cm3), label: 'CM3 (After Overheads)' },
    // RTO rate is already basis points; the narration cites "18%" → bp 1800 == value_canonical.
    { signal_id: 'rto_rate_bp', value_canonical: BigInt(c.rto_rate_bp), label: 'RTO Rate' },
  ];
}

interface PageInsightSignalSeed {
  signal_id: string;
  value_canonical: bigint;
  label: string;
}

let _insightCounter = 0;
function _insightId(): string {
  _insightCounter += 1;
  return `insight_${_insightCounter}_${Date.now()}`;
}

/**
 * The deterministic grounded narrator (LOCAL harness). Mirrors what the Haiku
 * gateway produces, but constructs prose ONLY from the signal integers so the
 * faithfulness gate always passes on real values. CM2-first India framing.
 * NO action/tool field anywhere.
 */
function buildSugandhlokPageInsights(page: string): {
  signals: PageInsightSignalSeed[];
  narrations: Array<{
    insight_id: string;
    severity: 'critical' | 'warning' | 'opportunity' | 'positive';
    headline: string;
    body: string;
    grounded_signal_ids: string[];
  }>;
  model_used: string;
} {
  const signals = buildPnlPageSignals();
  const byId = Object.fromEntries(signals.map((s) => [s.signal_id, s.value_canonical] as const));
  const cm2 = byId['cm2_mu']!;
  const cm3 = byId['cm3_mu']!;
  const adSpend = byId['total_ad_spend_mu']!;
  const realized = byId['realized_revenue_mu']!;
  const rtoBp = byId['rto_rate_bp']!;

  // Every numeric token below is an exact echo of a signal integer (Indian-format).
  // ₹6.5L ad spend leaves CM2 at ₹3.2L → CM3 ₹2.8L. RTO 18.00%.
  const narrations = [
    {
      insight_id: _insightId(),
      severity: 'positive' as const,
      headline: `CM2 holds at ${_lakhStr(cm2)} after ${_lakhStr(adSpend)} ad spend`,
      body:
        `On ${_lakhStr(realized)} realized revenue, contribution margin after ads (CM2) is ${_lakhStr(cm2)}. ` +
        `Ad spend of ${_lakhStr(adSpend)} is being earned back — CM2 stays positive.`,
      grounded_signal_ids: ['realized_revenue_mu', 'cm2_mu', 'total_ad_spend_mu'],
    },
    {
      insight_id: _insightId(),
      severity: 'warning' as const,
      headline: `RTO at ${(Number(rtoBp) / 100).toFixed(0)}% is compressing realized revenue`,
      body:
        `Return-to-origin is running at ${(Number(rtoBp) / 100).toFixed(0)}%, which already nets out of the ` +
        `${_lakhStr(realized)} realized base. Lowering RTO flows straight through to CM2 (${_lakhStr(cm2)}).`,
      grounded_signal_ids: ['rto_rate_bp', 'realized_revenue_mu', 'cm2_mu'],
    },
    {
      insight_id: _insightId(),
      severity: 'opportunity' as const,
      headline: `CM3 of ${_lakhStr(cm3)} leaves room after overheads`,
      body:
        `After fixed overheads, contribution margin three (CM3) is ${_lakhStr(cm3)} — close to ` +
        `contribution margin two of ${_lakhStr(cm2)}, so overhead drag is modest. ` +
        `Profitability is led by the after-ads margin, not ad efficiency alone.`,
      grounded_signal_ids: ['cm3_mu', 'cm2_mu'],
    },
  ];

  return { signals, narrations, model_used: 'deterministic-stub' };
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

// ---------------------------------------------------------------------------
// Phase-2 slice-6 (feat-catalog-inventory): product / inventory / first-product cascade.
// Mirrors the Python analytics use-cases TS-side, using the SAME registry formulas so the
// loopback values match the parity-gated definitions. Products = CM1 (reuse CM1_MU); NO
// per-SKU CM2. Inventory = days-left cascade + sell-through (reuse the registry defs).
// Cascade = per-first-product second-order-rate (reuse FIRST_PRODUCT_SECOND_ORDER_RATE_BP).
// ---------------------------------------------------------------------------

// Product seed (paise / counts). cogs + variable already line-share allocated; refunds applied.
const _PRODUCT_SEED = [
  // revenue 900000; cogs 300000, variable 100000 → cm1 500000.
  {
    label: 'Sugandh Oud Attar 12ml', sales: 1_000_000n, refunds: 100_000n, cogs: 300_000n,
    variable: 100_000n, sold: 100n, refunded: 10n, orders: 80n,
    ncOrders: 50n, ecOrders: 30n, ncRevenue: 560_000n, ecRevenue: 340_000n,
  },
  // revenue 300000; cogs 150000, variable 50000 → cm1 100000.
  {
    label: 'Rose Mist 50ml', sales: 320_000n, refunds: 20_000n, cogs: 150_000n,
    variable: 50_000n, sold: 40n, refunded: 2n, orders: 30n,
    ncOrders: 20n, ecOrders: 10n, ncRevenue: 180_000n, ecRevenue: 120_000n,
  },
  // revenue 180000; cogs 100000, variable 30000 → cm1 50000.
  {
    label: 'Sandalwood Soap (Pack of 3)', sales: 190_000n, refunds: 10_000n, cogs: 100_000n,
    variable: 30_000n, sold: 60n, refunded: 5n, orders: 45n,
    ncOrders: 25n, ecOrders: 20n, ncRevenue: 100_000n, ecRevenue: 80_000n,
  },
] as const;

function _ratioBpOrNull(num: bigint, denom: bigint): number | null {
  if (denom <= 0n) return null;
  return Number((num * 10000n) / denom);
}

function _signedShareBp(num: bigint, denom: bigint): number | null {
  if (denom === 0n) return null;
  // truncate toward zero (matches the Python use-case sign behavior).
  const q = num * 10000n;
  const t = q / denom; // BigInt division truncates toward zero
  return Number(t);
}

function _paretoGrade(cm1: bigint, sortedPositive: bigint[], totalPositive: bigint, rank: number): 'A' | 'B' | 'C' | 'F' {
  if (cm1 < 0n) return 'F';
  if (totalPositive <= 0n) return 'C';
  let cum = 0n;
  for (let i = 0; i < sortedPositive.length; i++) {
    cum += sortedPositive[i]!;
    if (i === rank) {
      if (cum * 100n <= totalPositive * 80n) return 'A';
      if (cum * 100n <= totalPositive * 95n) return 'B';
      return 'C';
    }
  }
  return 'C';
}

function buildSugandhlokProductPerformance(filters?: ProductFilterInput): ProductPerformanceResult {
  const groupBy = (filters?.group_by ?? 'product') as ProductGroupBy;
  const sort = (filters?.sort ?? 'cm1') as ProductSort;
  const direction = filters?.direction === 'asc' ? 'asc' : 'desc';

  type Tmp = { f: (typeof _PRODUCT_SEED)[number]; revenue: bigint; cm1: bigint };
  const tmp: Tmp[] = _PRODUCT_SEED.map((f) => {
    const revenue = f.sales - f.refunds;
    const cm1 = CM1_MU.formula_ts(revenue, f.cogs, f.variable) as bigint;
    return { f, revenue, cm1 };
  });
  let totalCm1 = 0n;
  for (const t of tmp) totalCm1 += t.cm1;

  const sortedByCm1 = [...tmp].sort((a, b) => (b.cm1 > a.cm1 ? 1 : b.cm1 < a.cm1 ? -1 : 0));
  const positiveCm1 = sortedByCm1.filter((t) => t.cm1 > 0n).map((t) => t.cm1);
  const totalPositive = positiveCm1.reduce((s, v) => s + v, 0n);

  let rows: ProductRow[] = sortedByCm1.map((t, i) => {
    const positiveRank = sortedByCm1.slice(0, i).filter((x) => x.cm1 > 0n).length;
    const refunded = t.f.refunded > t.f.sold ? t.f.sold : t.f.refunded;
    return {
      label: t.f.label,
      pareto_grade: _paretoGrade(t.cm1, positiveCm1, totalPositive, positiveRank),
      cm1_mu: t.cm1,
      cm1_pct_bp: t.revenue > 0n ? _ratioBpOrNull(t.cm1, t.revenue) : null,
      cm1_total_share_bp: _signedShareBp(t.cm1, totalCm1),
      revenue_mu: t.revenue,
      sales_mu: t.f.sales,
      refunds_mu: t.f.refunds,
      sold: t.f.sold,
      refunded,
      net_quantity: t.f.sold - refunded,
      return_rate_bp: t.f.sold > 0n ? _ratioBpOrNull(refunded, t.f.sold) : 0,
      nc_return_rate_bp: 0,
      ec_return_rate_bp: 0,
      orders: t.f.orders,
      nc_orders: t.f.ncOrders,
      ec_orders: t.f.ecOrders,
      aov_mu: t.f.orders > 0n ? (AOV_MU.formula_ts(t.revenue, t.f.orders) as bigint) : null,
      nc_aov_mu: t.f.ncOrders > 0n ? (AOV_MU.formula_ts(t.f.ncRevenue, t.f.ncOrders) as bigint) : null,
      ec_aov_mu: t.f.ecOrders > 0n ? (AOV_MU.formula_ts(t.f.ecRevenue, t.f.ecOrders) as bigint) : null,
    };
  });

  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    rows = rows.filter((r) => r.label.toLowerCase().includes(q));
  }

  // Multi-column sort honoring the full sort enum.
  const cmp = (a: ProductRow, b: ProductRow): number => {
    let diff = 0;
    switch (sort) {
      case 'label': diff = a.label.localeCompare(b.label); break;
      case 'revenue': diff = Number(a.revenue_mu - b.revenue_mu); break;
      case 'sold': diff = Number(a.sold - b.sold); break;
      case 'refunded': diff = Number(a.refunded - b.refunded); break;
      case 'net_quantity': diff = Number(a.net_quantity - b.net_quantity); break;
      case 'orders': diff = Number(a.orders - b.orders); break;
      case 'aov': diff = Number((a.aov_mu ?? 0n) - (b.aov_mu ?? 0n)); break;
      case 'cm1_pct': diff = (a.cm1_pct_bp ?? 0) - (b.cm1_pct_bp ?? 0); break;
      case 'cm1_total': diff = (a.cm1_total_share_bp ?? 0) - (b.cm1_total_share_bp ?? 0); break;
      case 'return_rate': diff = (a.return_rate_bp ?? 0) - (b.return_rate_bp ?? 0); break;
      case 'pareto_grade': {
        const gradeOrd: Record<string, number> = { A: 3, B: 2, C: 1, F: 0 };
        diff = (gradeOrd[a.pareto_grade] ?? 0) - (gradeOrd[b.pareto_grade] ?? 0);
        break;
      }
      default: diff = Number(a.cm1_mu - b.cm1_mu);
    }
    return direction === 'asc' ? diff : -diff;
  };
  rows = [...rows].sort(cmp);

  const totalRowsBeforePage = rows.length;
  // Apply server-side pagination if requested.
  const pageSize = filters?.page_size ?? 0;
  if (pageSize > 0) {
    const page = Math.max(1, filters?.page ?? 1);
    const start = (page - 1) * pageSize;
    rows = rows.slice(start, start + pageSize);
  }

  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH,
    currency_code: SUGANDH_LOK_CANONICAL.currency_code,
    group_by: groupBy,
    sort,
    direction,
    total_cm1_mu: totalCm1,
    total_rows: BigInt(totalRowsBeforePage),
    rows,
  };
}

// ---------------------------------------------------------------------------
// Wave-4A inventory parity: extended 18-column seed.
// brand, lead_time_days, cost_value_mu, price_mu, compare_at_price_mu,
// qty_n14ly, tags mirror the legacy 18-field InventoryRow contract.
// cost_value_mu is null (requires COGS editor to set) — honest-empty.
// qty_n14ly = units sold in the same 14-day window last year — 0 for new SKUs.
// ---------------------------------------------------------------------------
type _InventorySeedRow = {
  label: string; sku: string; brand: string; inv: bigint;
  l30: bigint; l90: bigint; l180: bigint; l360: bigint; n14ly: bigint;
  price_mu: bigint; compare_at_price_mu: bigint | null;
  lead_time_days: number; tags: string;
};

const _INVENTORY_SEED: _InventorySeedRow[] = [
  {
    label: 'Sugandh Oud Attar 12ml', sku: 'OUD-12', brand: 'Sugandh Lok',
    inv: 300n, l30: 30n, l90: 90n, l180: 180n, l360: 300n, n14ly: 12n,
    price_mu: 149900n, compare_at_price_mu: 199900n,
    lead_time_days: 7, tags: 'attar,oud,bestseller',
  },
  {
    label: 'Rose Mist 50ml', sku: 'ROSE-50', brand: 'Sugandh Lok',
    inv: 10n, l30: 30n, l90: 0n, l180: 0n, l360: 300n, n14ly: 0n,
    price_mu: 89900n, compare_at_price_mu: null,
    lead_time_days: 5, tags: 'rose,mist',
  },
  {
    label: 'Musk 10ml', sku: 'MUSK-10', brand: 'Sugandh Lok',
    inv: 30n, l30: 0n, l90: 90n, l180: 0n, l360: 0n, n14ly: 0n,
    price_mu: 69900n, compare_at_price_mu: null,
    lead_time_days: 10, tags: 'musk',
  },
  {
    label: 'Sandalwood Soap (Pack of 3)', sku: 'SND-BAR', brand: 'Sugandh Lok',
    inv: 1000n, l30: 0n, l90: 0n, l180: 0n, l360: 0n, n14ly: 0n,
    price_mu: 49900n, compare_at_price_mu: 59900n,
    lead_time_days: 14, tags: 'soap,sandalwood',
  },
];

// Mutable in-memory lead-time store (reset on server restart — intentional for a loopback stub).
const _leadTimeOverrides: Map<string, number> = new Map();

const _STATUS_ORDER: Record<InventoryStatus, number> = {
  'Out of stock': 0, 'Restock Soon': 1, 'Healthy': 2, 'Overstocked': 3, 'Severely Overstocked': 4,
};

function _classifyStatus(inv: bigint, daysLeft: number): InventoryStatus {
  if (inv <= 0n) return 'Out of stock';
  if (daysLeft < 21) return 'Restock Soon';
  if (daysLeft >= 365) return 'Severely Overstocked';
  if (daysLeft >= 180) return 'Overstocked';
  return 'Healthy';
}

function buildSugandhlokInventoryLevels(filters?: InventoryFilterInput): InventoryLevelsResult {
  const grain = filters?.grain === 'variant' ? 'variant' : 'product';
  const sort = (filters?.sort ?? 'days_left') as InventorySort;
  const direction = filters?.direction === 'desc' ? 'desc' : 'asc';

  let rows: InventoryRow[] = _INVENTORY_SEED.map((s) => {
    const daysLeft = INVENTORY_DAYS_LEFT.formula_ts(s.inv, s.l30, s.l90, s.l180, s.l360) as number;
    const sellThrough = INVENTORY_SELL_THROUGH_BP.formula_ts(s.l360, s.inv) as number | null;
    const leadTime = _leadTimeOverrides.get(s.sku) ?? s.lead_time_days;
    return {
      label: s.label,
      sku: s.sku,
      brand: s.brand,
      lead_time_days: leadTime,
      // cost_value_mu is null — honest-empty until COGS editor sets it.
      cost_value_mu: null,
      price_mu: s.price_mu,
      compare_at_price_mu: s.compare_at_price_mu,
      qty_l30: s.l30,
      qty_l90: s.l90,
      qty_l180: s.l180,
      qty_l360: s.l360,
      qty_n14ly: s.n14ly,
      tags: s.tags,
      current_inventory: s.inv,
      days_left: BigInt(daysLeft),
      sell_through_bp: sellThrough,
      status: _classifyStatus(s.inv, daysLeft),
    };
  });

  if (filters?.status_filter) {
    rows = rows.filter((r) => r.status === filters.status_filter);
  }

  if (filters?.search) {
    const q = filters.search.trim().toLowerCase();
    rows = rows.filter((r) =>
      r.label.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q));
  }

  const reverse = direction === 'desc';
  rows = [...rows].sort((a, b) => {
    let diff = 0;
    if (sort === 'label') diff = a.label.localeCompare(b.label);
    else if (sort === 'status') diff = _STATUS_ORDER[a.status] - _STATUS_ORDER[b.status];
    else if (sort === 'current_inventory') diff = Number(a.current_inventory - b.current_inventory);
    else if (sort === 'sell_through') diff = (a.sell_through_bp ?? -1) - (b.sell_through_bp ?? -1);
    else diff = Number(a.days_left - b.days_left);
    return reverse ? -diff : diff;
  });

  // Pagination (Wave-4A: page/page_size mirrors legacy server-side pagination).
  const pageSize = filters?.page_size ?? 20;
  const page = filters?.page ?? 1;
  const totalRows = BigInt(rows.length);
  const start = (page - 1) * pageSize;
  rows = rows.slice(start, start + pageSize);

  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH,
    grain,
    sort,
    direction,
    total_rows: totalRows,
    rows,
  };
}

function setLeadTimeLoopback(sku: string, leadTimeDays: number): InventorySetLeadTimeResult {
  _leadTimeOverrides.set(sku, leadTimeDays);
  return { sku, lead_time_days: leadTimeDays };
}

// First-product cascade seed. Cohort assembly already done upstream (deterministic primary
// product, observation-window order counts).
const _CASCADE_SEED = [
  {
    productKey: 'p_oud', productTitle: 'Sugandh Oud Attar 12ml', cohort: 8n,
    with2: 3n, with3: 2n, with4: 1n, sumAdditional: 6n, sumLtv: 8_000_000n,
    sumDaysToSecond: 90n, withSecond: 3n,
  },
  {
    productKey: 'p_rose', productTitle: 'Rose Mist 50ml', cohort: 4n,
    with2: 1n, with3: 0n, with4: 0n, sumAdditional: 1n, sumLtv: 2_000_000n,
    sumDaysToSecond: 45n, withSecond: 1n,
  },
] as const;

function buildSugandhlokFirstProductCascade(filters?: FirstProductCascadeFilterInput): FirstProductCascadeResult {
  const obs = Math.min(730, Math.max(30, filters?.observation_days ?? 365));
  let total = 0n;

  const rows: FirstProductCascadeRow[] = _CASCADE_SEED.map((c) => {
    total += c.cohort;
    const n = c.cohort;
    return {
      product_key: c.productKey,
      product_title: c.productTitle,
      first_order_customers: n,
      customers_with_2nd_order: c.with2,
      customers_with_3rd_order: c.with3,
      customers_with_4th_plus_order: c.with4,
      second_order_rate_bp: n > 0n ? (FIRST_PRODUCT_SECOND_ORDER_RATE_BP.formula_ts(c.with2, n) as number) : null,
      third_order_rate_bp: n > 0n ? (FIRST_PRODUCT_SECOND_ORDER_RATE_BP.formula_ts(c.with3, n) as number) : null,
      fourth_plus_rate_bp: n > 0n ? (FIRST_PRODUCT_SECOND_ORDER_RATE_BP.formula_ts(c.with4, n) as number) : null,
      additional_order_rate_centi: n > 0n ? (c.sumAdditional * 100n) / n : 0n,
      average_ltv_revenue_mu: n > 0n ? c.sumLtv / n : 0n,
      average_days_to_second_deci: c.withSecond > 0n ? (c.sumDaysToSecond * 10n) / c.withSecond : null,
    };
  });

  rows.sort((a, b) => Number(b.first_order_customers - a.first_order_customers));

  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH,
    currency_code: SUGANDH_LOK_CANONICAL.currency_code,
    observation_days: obs,
    total_cohort_customers: total,
    rows,
  };
}

let _rowCounter = 0;

function newRowId(): string {
  return `row_${++_rowCounter}_${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Phase-2 slice-7 (feat-finance-settings-goals): goals / costs / festivals / calendar seeds.
// Goal RAG is DIRECTIONAL (Rohan Finding 1); the band uses the registry computeGoalRag.
// festival learned-lift is a PHANTOM (Finding 2) — only the stored expected_multiplier_bp.
// ---------------------------------------------------------------------------

// Goal-metric directions (mirror legacy GOAL_METRIC_REGISTRY.higherBetter; cac/acos lower-better).
const _GOAL_METRIC_HIGHER_BETTER: Record<string, boolean> = {
  revenue: true, cm3: true, cm3_pct: true, mer: true, amer: true,
  cac: false, aov: true, new_customers: true, acos: false,
  meta_roas: true, google_roas: true,
};

// Seeded goals for the Sugandh-Lok anchor (actual measured vs target). Mixed direction.
const _GOAL_SEED = [
  // higher-better @ 92% → amber
  { metric: 'revenue', period: 'MONTHLY' as const, goal: 30_000_000n, type: 'MINIMUM' as const, actual: 27_600_000n },
  // higher-better @ 98% → green
  { metric: 'cm3', period: 'MONTHLY' as const, goal: 9_000_000n, type: 'MINIMUM' as const, actual: 8_820_000n },
  // lower-better CAC @ 120% → amber (the inverted band — NON-VACUOUS)
  { metric: 'cac', period: 'MONTHLY' as const, goal: 15_000n, type: 'MAXIMUM' as const, actual: 18_000n },
  // higher-better MER @ 104% → green
  { metric: 'mer', period: 'MONTHLY' as const, goal: 48_000n, type: 'MINIMUM' as const, actual: 50_000n },
] as const;

function buildSugandhlokGoalAttainment(): GoalAttainmentResult {
  const rows: GoalEvaluationRow[] = _GOAL_SEED.map((g) => {
    const metricHb = _GOAL_METRIC_HIGHER_BETTER[g.metric] ?? true;
    const higherBetter = goalHigherBetter(g.type, metricHb);
    const goalVal: bigint = g.goal;
    const attainment = goalVal !== 0n
      ? (GOAL_ATTAINMENT_BP.formula_ts(g.actual, goalVal) as number)
      : null;
    const rag = computeGoalRag(g.actual, g.goal, higherBetter) as GoalRag;
    return {
      metric_name: g.metric,
      period_type: g.period,
      period_start: '2026-05-01',
      goal_type: g.type,
      goal_value: g.goal,
      actual: g.actual,
      attainment_bp: attainment,
      variance_abs: g.actual - g.goal,
      higher_better: higherBetter,
      rag,
    };
  });
  const periodRank: Record<string, number> = { DAILY: 0, WEEKLY: 1, MONTHLY: 2 };
  rows.sort((a, b) =>
    a.metric_name === b.metric_name
      ? (periodRank[a.period_type] ?? 9) - (periodRank[b.period_type] ?? 9)
      : a.metric_name.localeCompare(b.metric_name),
  );
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH,
    rows,
    total_rows: BigInt(rows.length),
  };
}

// Cost stack seed — the COGS settings echo + active cost rows + CM landing (one source of truth).
function buildSugandhlokCostStack(): CostStackResult {
  const costRows: CostStackRow[] = ([
    { cost_type: 'PACKAGING', name: 'Box + filler', kind: 'per_order', amount_mu: 2000n, amount_bp: 0, effective_from: '2026-01-01', currency_code: 'INR' },
    { cost_type: 'SHIPPING', name: 'Courier', kind: 'per_order', amount_mu: 6000n, amount_bp: 0, effective_from: '2026-01-01', currency_code: 'INR' },
    { cost_type: 'SOFTWARE', name: 'SaaS stack', kind: 'fixed_monthly', amount_mu: 5_000_000n, amount_bp: 0, effective_from: '2026-01-01', currency_code: 'INR' },
    { cost_type: 'CUSTOM', name: 'Payment gateway', kind: 'percent', amount_mu: 0n, amount_bp: 200, effective_from: '2026-01-01', currency_code: 'INR' },
  ] as CostStackRow[]).sort((a, b) => (a.cost_type === b.cost_type ? a.name.localeCompare(b.name) : a.cost_type.localeCompare(b.cost_type)));

  const totalFixed = costRows.filter((c) => c.kind === 'fixed_monthly').reduce((s, c) => s + c.amount_mu, 0n);
  const totalPerOrder = costRows.filter((c) => c.kind === 'per_order').reduce((s, c) => s + c.amount_mu, 0n);

  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH,
    override_all_bp: 0,        // override OFF → product+fallback mode
    fallback_bp: 2500,        // 25.00%
    markup_bp: 500,           // 5.00%
    cogs_mode: 'product+fallback',
    cost_rows: costRows,
    total_fixed_monthly_mu: totalFixed,
    total_per_order_mu: totalPerOrder,
    // CM landing from the EXISTING slice-2 CM path (read, NOT recomputed).
    net_sales_mu: 30_000_000n,
    resolved_cogs_mu: 9_000_000n,
    variable_costs_mu: 3_200_000n,
    cm1_mu: 17_800_000n,      // = net_sales - cogs - variable
    currency_code: 'INR',
  };
}

// Festival template seed (India calendar subset; multiplier in bp = ×10000). NO learned lift.
function buildSugandhlokFestivalCalendar(filters?: FestivalCalendarFilterInput): FestivalCalendarResult {
  const all: FestivalRow[] = [
    { name: 'Makar Sankranti', start_date: '2026-01-14', end_date: '2026-01-14', expected_multiplier_bp: 13000, regions: [], categories: ['all'], color: '#F59E0B', is_template: true, is_active: true },
    { name: "Valentine's Week", start_date: '2026-02-07', end_date: '2026-02-14', expected_multiplier_bp: 15000, regions: [], categories: ['beauty', 'fashion', 'gifting'], color: '#EC4899', is_template: true, is_active: true },
    { name: 'Holi', start_date: '2026-03-03', end_date: '2026-03-04', expected_multiplier_bp: 18000, regions: [], categories: ['beauty', 'fashion', 'skincare'], color: '#EC4899', is_template: true, is_active: true },
    { name: 'Onam', start_date: '2026-09-13', end_date: '2026-09-23', expected_multiplier_bp: 22000, regions: ['Kerala'], categories: ['all'], color: '#8B5CF6', is_template: true, is_active: true },
    { name: 'Dhanteras', start_date: '2026-11-07', end_date: '2026-11-08', expected_multiplier_bp: 30000, regions: [], categories: ['jewelry', 'electronics', 'home'], color: '#F59E0B', is_template: true, is_active: true },
    { name: 'Diwali', start_date: '2026-11-08', end_date: '2026-11-12', expected_multiplier_bp: 40000, regions: [], categories: ['all'], color: '#F59E0B', is_template: true, is_active: true },
  ];
  const year = filters?.year;
  const rows = (year != null ? all.filter((f) => f.start_date.startsWith(String(year))) : all)
    .slice()
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const peak = rows.reduce((m, f) => Math.max(m, f.expected_multiplier_bp), 0);
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH,
    year: year ?? null,
    rows,
    total_rows: BigInt(rows.length),
    peak_multiplier_bp: peak,
  };
}

// Calendar report seed — period grid (day grain) with overlays + per-cell directional RAG.
function _calCell(metric: string, actual: bigint | null, goal: bigint | null, type: 'MINIMUM' | 'MAXIMUM' | 'TARGET'): CalendarCell {
  if (goal === null || actual === null) return { actual, goal: null, rag: null };
  const metricHb = _GOAL_METRIC_HIGHER_BETTER[metric] ?? true;
  const higherBetter = goalHigherBetter(type, metricHb);
  const rag = computeGoalRag(actual, goal, higherBetter) as GoalRag;
  return { actual, goal, rag };
}

function buildSugandhlokCalendarReport(filters?: CalendarReportFilterInput): CalendarReportResult {
  const grain = filters?.grain ?? 'day';
  // Two seeded days; day 1 carries a Klaviyo overlay. Daily goals (revenue/cm3 prorated to 1 day).
  const days = [
    { key: '2026-05-01', label: 'May 1, 2026', rev: 1_000_000n, cm3: 300_000n, spend: 200_000n, nc: 10n, mer: 50000n, amer: 30000n, cac: 20000n, aov: 100_000n,
      actions: [{ id: 'a1', action_date: '2026-05-01', action_type: 'email_campaign', action_name: 'May Day blast', notes: 'Klaviyo · 5000 delivered', source: 'klaviyo' as const }] },
    { key: '2026-05-02', label: 'May 2, 2026', rev: 800_000n, cm3: 200_000n, spend: 250_000n, nc: 6n, mer: 32000n, amer: 24000n, cac: 41000n, aov: 90_000n,
      actions: [] as CalendarReportRow['actions'] },
  ];
  // Daily goals (revenue MINIMUM 900k/day, cm3 MINIMUM 250k/day, cac MAXIMUM 25k, mer MINIMUM 45000).
  const rows: CalendarReportRow[] = days.map((d) => ({
    period_key: d.key,
    label: d.label,
    actions: d.actions,
    revenue: _calCell('revenue', d.rev, 900_000n, 'MINIMUM'),
    cm3: _calCell('cm3', d.cm3, 250_000n, 'MINIMUM'),
    total_spend_mu: d.spend,
    mer: _calCell('mer', d.mer, 45000n, 'MINIMUM'),
    amer: _calCell('amer', d.amer, 25000n, 'MINIMUM'),
    new_customers: _calCell('new_customers', d.nc, 8n, 'MINIMUM'),
    cac: _calCell('cac', d.cac, 25000n, 'MAXIMUM'),
    aov: _calCell('aov', d.aov, 95_000n, 'MINIMUM'),
  }));
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH,
    grain,
    currency_code: 'INR',
    rows,
    total_rows: BigInt(rows.length),
  };
}

// In-memory marketing action store (parity-38). Keyed by id.
class InMemoryMarketingActionStore {
  private readonly rows = new Map<string, MarketingActionRow>();
  private counter = 0;

  list(dateStart: string, dateEnd: string): MarketingActionRow[] {
    return Array.from(this.rows.values())
      .filter((r) => r.action_date >= dateStart && r.action_date <= dateEnd)
      .sort((a, b) => a.action_date.localeCompare(b.action_date) || a.created_at.localeCompare(b.created_at));
  }

  create(p: CreateMarketingActionInput): MarketingActionRow {
    this.counter++;
    const id = `action_${this.counter}`;
    const now = new Date().toISOString();
    const row: MarketingActionRow = {
      id,
      workspace_id: p.workspace_id,
      action_date: p.action_date,
      action_type: p.action_type,
      action_name: p.action_name,
      notes: p.notes ?? null,
      created_by: p.created_by ?? null,
      created_at: now,
      updated_at: now,
    };
    this.rows.set(id, row);
    return row;
  }

  update(p: UpdateMarketingActionInput): MarketingActionRow {
    const existing = this.rows.get(p.action_id);
    if (!existing || existing.workspace_id !== p.workspace_id) {
      throw new Error(`NotFound: marketing action ${p.action_id}`);
    }
    const updated: MarketingActionRow = {
      ...existing,
      action_date: p.action_date ?? existing.action_date,
      action_type: p.action_type ?? existing.action_type,
      action_name: p.action_name ?? existing.action_name,
      notes: p.notes !== undefined ? p.notes : existing.notes,
      updated_at: new Date().toISOString(),
    };
    this.rows.set(p.action_id, updated);
    return updated;
  }

  delete(workspaceId: string, actionId: string): boolean {
    const existing = this.rows.get(actionId);
    if (!existing || existing.workspace_id !== workspaceId) return false;
    this.rows.delete(actionId);
    return true;
  }

  size(): number {
    return this.rows.size;
  }
}

// In-memory goals write store (the idempotent upsert lands here; the Redis dedup at the
// router ensures one write per idempotency_key). Keyed by (workspace, metric, period, start).
class InMemoryGoalStore {
  private readonly rows = new Map<string, GoalUpsertResult>();

  upsert(p: GoalUpsertInput): GoalUpsertResult {
    const key = `${p.workspace_id}:${p.metric_name}:${p.period_type}:${p.period_start}`;
    const existing = this.rows.get(key);
    const goal_id = existing?.goal_id ?? `goal_${this.rows.size + 1}`;
    const result: GoalUpsertResult = {
      goal_id,
      metric_name: p.metric_name,
      period_type: p.period_type,
      period_start: p.period_start,
      goal_value: p.goal_value,
      goal_type: p.goal_type,
    };
    this.rows.set(key, result);
    return result;
  }

  size(): number {
    return this.rows.size;
  }
}

// ---------------------------------------------------------------------------
// Phase-2 slice-8 (feat-lifecycle-timings-email) seeded builders — READ/ANALYTICS ONLY.
// Every derived value is computed through the canonical registry formula (one source of
// truth). NO outbound send / dispatch / audience push anywhere in these builders (Shreya S4).
// ---------------------------------------------------------------------------

// Customer-lifecycle report: recency-vs-empirical-percentile buckets (NOT RFM scoring).
function buildSugandhlokLifecycleStates(): LifecycleStatesResult {
  // Sugandh Lok empirical churn thresholds (from repeat-gap percentiles): p40=30, p80=75.
  const buckets: LifecycleBucketRow[] = [
    { bucket: 'new',     customer_count: 120n, revenue_mu: 3_600_000n, order_count: 120n },
    { bucket: 'active',  customer_count: 340n, revenue_mu: 18_500_000n, order_count: 520n },
    { bucket: 'at_risk', customer_count: 180n, revenue_mu: 4_200_000n, order_count: 190n },
    { bucket: 'churned', customer_count: 260n, revenue_mu: 0n,          order_count: 0n },
  ];
  const netActive =
    (buckets.find((b) => b.bucket === 'new')?.customer_count ?? 0n) +
    (buckets.find((b) => b.bucket === 'active')?.customer_count ?? 0n);
  const total = buckets.reduce((s, b) => s + b.customer_count, 0n);
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH,
    p40_days: 30,
    p80_days: 75,
    used_fallback: false,
    buckets,
    net_active: netActive,
    total_customers: total,
    unattributed_revenue_mu: 850_000n,
    unattributed_order_count: 14n,
    currency_code: 'INR',
  };
}

// Order-timings: inter-order gap medians + repeat % + reactivation window (0.8×median(1→2)).
function buildSugandhlokOrderTimings(filters?: TimingsFilterInput): OrderTimingsResult {
  const metric = filters?.metric === 'mean' ? 'mean' : 'median';
  const rateBp = (count: number, cohort: number): number =>
    cohort > 0 ? Math.trunc((count * 10000) / cohort) : 0;
  const react = (median1to2: number | null): number | null =>
    median1to2 !== null && median1to2 > 0
      ? Number(REACTIVATION_WINDOW_DAYS.formula_ts(BigInt(median1to2)))
      : null;

  const summaryMedian1to2 = 32;
  const summary: TimingsRow = {
    group_id: '',
    label: 'All products',
    group_by: filters?.group_by ?? 'product',
    first_orders: 700n,
    second_orders_bp: rateBp(308, 700),  // 44.00%
    third_orders_bp: rateBp(126, 700),   // 18.00%
    fourth_orders_bp: rateBp(49, 700),   // 7.00%
    days_1to2: summaryMedian1to2,
    days_2to3: 58,
    days_3to4: 85,
    reactivation_window_days: react(summaryMedian1to2),  // round(0.8×32)=26
  };

  const groupsRaw: Array<{ id: string; label: string; first: number; c2: number; c3: number; c4: number; m12: number; m23: number | null; m34: number | null }> = [
    { id: 'p-oud', label: 'Royal Oud Attar', first: 260, c2: 130, c3: 60, c4: 25, m12: 28, m23: 50, m34: 80 },
    { id: 'p-musk', label: 'White Musk', first: 180, c2: 72, c3: 27, c4: 9, m12: 35, m23: 62, m34: null },
    { id: 'p-rose', label: 'Gulab Rose Mist', first: 120, c2: 42, c3: 12, c4: 0, m12: 40, m23: null, m34: null },
  ];
  const groups: TimingsRow[] = groupsRaw
    .map((g) => ({
      group_id: g.id,
      label: g.label,
      group_by: filters?.group_by ?? 'product',
      first_orders: BigInt(g.first),
      second_orders_bp: rateBp(g.c2, g.first),
      third_orders_bp: rateBp(g.c3, g.first),
      fourth_orders_bp: rateBp(g.c4, g.first),
      days_1to2: g.m12,
      days_2to3: g.m23,
      days_3to4: g.m34,
      reactivation_window_days: react(g.m12),
    }))
    .sort((a, b) => (a.first_orders === b.first_orders ? a.group_id.localeCompare(b.group_id) : Number(b.first_orders - a.first_orders)));

  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH,
    metric,
    summary,
    groups,
    currency_code: 'INR',
  };
}

// Email/SMS PERFORMANCE report — REPORTING on past Klaviyo performance, NEVER sending.
function buildSugandhlokEmailSmsPerformance(filters?: EmailSmsFilterInput): EmailSmsPerformanceResult {
  const groupBy = (['campaign', 'flow', 'date', 'channel', 'dow'] as const).includes(
    (filters?.group_by ?? 'campaign') as 'campaign',
  )
    ? (filters?.group_by ?? 'campaign')
    : 'campaign';

  type Seed = { key: string; label: string; channel: string; delivered: number; opens: number; clicks: number; orders: number; revenue_mu: bigint; unsub: number; spam: number };
  const seedByGroup: Record<string, Seed[]> = {
    campaign: [
      { key: 'c:diwali', label: 'Diwali Dhamaka', channel: 'email', delivered: 12000, opens: 5400, clicks: 1440, orders: 320, revenue_mu: 96_00_000n, unsub: 36, spam: 6 },
      { key: 'c:winter', label: 'Winter Attar Drop', channel: 'email', delivered: 8000, opens: 3120, clicks: 720, orders: 150, revenue_mu: 42_00_000n, unsub: 20, spam: 3 },
      { key: 'c:sms-flash', label: 'Flash Sale SMS', channel: 'sms', delivered: 5000, opens: 0, clicks: 250, orders: 80, revenue_mu: 24_00_000n, unsub: 10, spam: 0 },
    ],
    flow: [
      { key: 'f:welcome', label: 'Welcome Flow', channel: 'email', delivered: 6000, opens: 3600, clicks: 900, orders: 140, revenue_mu: 49_00_000n, unsub: 8, spam: 1 },
      { key: 'f:abandoned', label: 'Abandoned Cart', channel: 'email', delivered: 4200, opens: 1890, clicks: 630, orders: 110, revenue_mu: 38_50_000n, unsub: 12, spam: 2 },
    ],
    channel: [
      { key: 'ch:email', label: 'EMAIL', channel: 'email', delivered: 30200, opens: 13110, clicks: 3690, orders: 720, revenue_mu: 225_50_000n, unsub: 76, spam: 12 },
      { key: 'ch:sms', label: 'SMS', channel: 'sms', delivered: 5000, opens: 0, clicks: 250, orders: 80, revenue_mu: 24_00_000n, unsub: 10, spam: 0 },
    ],
    date: [
      { key: 'd:2026-04-12', label: '2026-04-12', channel: 'email', delivered: 12000, opens: 5400, clicks: 1440, orders: 320, revenue_mu: 96_00_000n, unsub: 36, spam: 6 },
      { key: 'd:2026-04-20', label: '2026-04-20', channel: 'email', delivered: 8000, opens: 3120, clicks: 720, orders: 150, revenue_mu: 42_00_000n, unsub: 20, spam: 3 },
    ],
    dow: [
      { key: 'w:1', label: 'Mon', channel: 'email', delivered: 9000, opens: 4050, clicks: 1080, orders: 210, revenue_mu: 63_00_000n, unsub: 24, spam: 4 },
      { key: 'w:3', label: 'Wed', channel: 'email', delivered: 7000, opens: 2940, clicks: 700, orders: 140, revenue_mu: 42_00_000n, unsub: 16, spam: 2 },
      { key: 'w:5', label: 'Fri', channel: 'email', delivered: 11000, opens: 5060, clicks: 1430, orders: 300, revenue_mu: 89_00_000n, unsub: 32, spam: 5 },
    ],
  };
  const seeds = seedByGroup[groupBy] ?? seedByGroup.campaign;

  const rows: EmailPerfRow[] = seeds.map((s) => ({
    key: s.key,
    label: s.label,
    channel: s.channel,
    delivered: BigInt(s.delivered),
    unique_opens: BigInt(s.opens),
    unique_clicks: BigInt(s.clicks),
    orders: BigInt(s.orders),
    revenue_mu: s.revenue_mu,
    unsubscribes: BigInt(s.unsub),
    spam_complaints: BigInt(s.spam),
    open_rate_bp: s.delivered > 0 ? (EMAIL_OPEN_RATE_BP.formula_ts(BigInt(s.opens), BigInt(s.delivered)) as number) : null,
    click_rate_bp: s.delivered > 0 ? (EMAIL_CLICK_RATE_BP.formula_ts(BigInt(s.clicks), BigInt(s.delivered)) as number) : null,
    revenue_per_recipient_mu: s.delivered > 0 ? (EMAIL_REVENUE_PER_RECIPIENT_MU.formula_ts(s.revenue_mu, BigInt(s.delivered)) as bigint) : null,
  }));

  if (groupBy === 'dow') {
    rows.sort((a, b) => a.key.localeCompare(b.key));
  } else {
    rows.sort((a, b) => (a.revenue_mu === b.revenue_mu ? Number(b.delivered - a.delivered) : Number(b.revenue_mu - a.revenue_mu)));
  }

  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    period: SUGANDH_LOK_CANONICAL.period,
    data_epoch: DATA_EPOCH,
    group_by: groupBy,
    rows,
    total_delivered: rows.reduce((s, r) => s + r.delivered, 0n),
    total_revenue_mu: rows.reduce((s, r) => s + r.revenue_mu, 0n),
    currency_code: 'INR',
  };
}

// ---------------------------------------------------------------------------
// StubDataPlane — the LOCAL harness + test implementation of DataPlanePort.
// Accepts an optional InMemoryDecisionLog for G-IDEMPOTENT gate testing.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase-2 slice-10 (feat-parity-cleanup-pages): HONEST seeds for the parity-cleanup
// pages. The Child-3 connector cutover is HELD, so live connector data is NOT flowing.
// These seeds tell the TRUTH: Shopify CONNECTED (the anchor brand's backfilled facts,
// last-sync == DATA_EPOCH); Meta/Google/Shiprocket/Klaviyo PENDING_CUTOVER with NO
// fake sync time; backfill jobs empty. NEVER a fabricated number (CF-S10-HONEST-STATE-1).
// ---------------------------------------------------------------------------

function buildSugandhlokMembers(): WorkspaceMembersResult {
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    members: [
      { user_id: '00000000-0000-0000-0000-0000000000a1', full_name: 'Aarti Sugandh', email: 'aarti@sugandhlok.in', role: 'OWNER', joined_at: '2026-01-04' },
      { user_id: '00000000-0000-0000-0000-0000000000a2', full_name: 'Rohit Mehta', email: 'rohit@sugandhlok.in', role: 'MANAGER', joined_at: '2026-02-12' },
      { user_id: '00000000-0000-0000-0000-0000000000a3', full_name: 'Neha Sharma', email: 'neha@sugandhlok.in', role: 'ANALYST', joined_at: '2026-03-20' },
    ],
    pending_invitations: 0, // invite (write) is DEFERRED this slice.
  };
}

function buildSugandhlokWorkspaceSettings(): WorkspaceSettingsResult {
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    name: 'Sugandh Lok',
    plan: 'GROWTH',
    timezone: 'Asia/Kolkata',
    region: 'IN',
    currency_code: 'INR',
    created_at: '2026-01-04',
  };
}

function buildSugandhlokIntegrations(): IntegrationsResult {
  const epoch = DATA_EPOCH.toISOString();
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    rows: [
      // Shopify drives the seeded analytics facts — truthfully CONNECTED, last-sync == data epoch.
      { connector: 'Shopify', status: 'CONNECTED', last_sync_at: epoch, last_sync_error: null },
      // The rest are HELD at the Child-3 cutover — honest PENDING_CUTOVER, NO fake sync time.
      { connector: 'Meta Ads', status: 'PENDING_CUTOVER', last_sync_at: null, last_sync_error: null },
      { connector: 'Google Ads', status: 'PENDING_CUTOVER', last_sync_at: null, last_sync_error: null },
      { connector: 'Shiprocket', status: 'PENDING_CUTOVER', last_sync_at: null, last_sync_error: null },
      { connector: 'Klaviyo', status: 'PENDING_CUTOVER', last_sync_at: null, last_sync_error: null },
    ],
  };
}

function buildSugandhlokBackfillStatus(): BackfillStatusResult {
  return {
    workspace_id: SUGANDH_LOK_WORKSPACE_ID,
    jobs: [
      { job_type: 'ads-backfill', status: 'PENDING_CUTOVER', started_at: null, note: 'Available after Meta/Google connector cutover.' },
      { job_type: 'shiprocket-courier', status: 'PENDING_CUTOVER', started_at: null, note: 'Available after Shiprocket connector cutover.' },
      { job_type: 'shiprocket-pincode', status: 'PENDING_CUTOVER', started_at: null, note: 'Available after Shiprocket connector cutover.' },
    ],
    note: 'No backfill jobs have run locally — connector cutover is pending. Triggers become available after cutover.',
  };
}

export class StubDataPlane implements DataPlanePort {
  private readonly goalStore = new InMemoryGoalStore();
  private readonly actionStore = new InMemoryMarketingActionStore();

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
    fee_overrides?: import('../domain/proto-types.js').CodPrepaidFeeOverrides;
  }): Promise<{ result: CodPrepaidResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokCodPrepaid(params.fee_overrides), data_epoch: DATA_EPOCH };
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

  // Phase-2 slice-6 (feat-catalog-inventory): product / inventory / first-product cascade.
  async getProductPerformance(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: ProductFilterInput;
  }): Promise<{ result: ProductPerformanceResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokProductPerformance(params.filters), data_epoch: DATA_EPOCH };
  }

  async getInventoryLevels(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: InventoryFilterInput;
  }): Promise<{ result: InventoryLevelsResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokInventoryLevels(params.filters), data_epoch: DATA_EPOCH };
  }

  async getFirstProductCascade(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: FirstProductCascadeFilterInput;
  }): Promise<{ result: FirstProductCascadeResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokFirstProductCascade(params.filters), data_epoch: DATA_EPOCH };
  }

  // Phase-2 slice-7 (feat-finance-settings-goals): goals / costs / festivals / calendar.
  async getGoalAttainment(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: GoalAttainmentResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokGoalAttainment(), data_epoch: DATA_EPOCH };
  }

  async upsertGoal(params: GoalUpsertInput): Promise<GoalUpsertResult> {
    // Fail-closed tenancy on WRITE (defense in depth; the router also gates role + idempotency).
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return this.goalStore.upsert(params);
  }

  async getCostStack(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: CostStackResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokCostStack(), data_epoch: DATA_EPOCH };
  }

  async getFestivalCalendar(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: FestivalCalendarFilterInput;
  }): Promise<{ result: FestivalCalendarResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokFestivalCalendar(params.filters), data_epoch: DATA_EPOCH };
  }

  async getCalendarReport(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: CalendarReportFilterInput;
  }): Promise<{ result: CalendarReportResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokCalendarReport(params.filters), data_epoch: DATA_EPOCH };
  }

  // Marketing action CRUD — parity-38. In-memory store for test/stub harness.
  async listMarketingActions(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: ListMarketingActionsResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    const rows = this.actionStore.list(params.date_range.start, params.date_range.end);
    return {
      result: {
        workspace_id: params.workspace_id,
        rows,
        total_rows: BigInt(rows.length),
        data_epoch: DATA_EPOCH,
      },
      data_epoch: DATA_EPOCH,
    };
  }

  async createMarketingAction(params: CreateMarketingActionInput): Promise<MarketingActionRow> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return this.actionStore.create(params);
  }

  async updateMarketingAction(params: UpdateMarketingActionInput): Promise<MarketingActionRow> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    try {
      return this.actionStore.update(params);
    } catch {
      throw new Error(`NotFound: marketing action ${params.action_id}`);
    }
  }

  async deleteMarketingAction(params: {
    workspace_id: string;
    action_id: string;
  }): Promise<{ deleted: boolean }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    const deleted = this.actionStore.delete(params.workspace_id, params.action_id);
    if (!deleted) throw new Error(`NotFound: marketing action ${params.action_id}`);
    return { deleted: true };
  }

  // Phase-2 slice-8 (feat-lifecycle-timings-email): READ/ANALYTICS ONLY. Fail-closed on tenancy.
  async getLifecycleStates(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: LifecycleStatesResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokLifecycleStates(), data_epoch: DATA_EPOCH };
  }

  async getOrderTimings(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: TimingsFilterInput;
  }): Promise<{ result: OrderTimingsResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokOrderTimings(params.filters), data_epoch: DATA_EPOCH };
  }

  async getEmailSmsPerformance(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: EmailSmsFilterInput;
  }): Promise<{ result: EmailSmsPerformanceResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    // REPORTING ONLY — no send/dispatch path; reads past Klaviyo performance rows.
    return { result: buildSugandhlokEmailSmsPerformance(params.filters), data_epoch: DATA_EPOCH };
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

  // Phase-2 slice-9 (feat-ai-insight-narration): GROUNDED small_llm page narration.
  // READ-ONLY. The LOCAL harness builds the narration from the canonical seed via the
  // deterministic grounded narrator (no live Claude key) behind the gateway contract;
  // production flips to the real Haiku gateway by config. Fail-closed on tenancy.
  async getPageInsights(params: {
    workspace_id: string;
    page: string;
    date_range: DateRange;
  }): Promise<{ result: PageInsightResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    const { signals, narrations, model_used } = buildSugandhlokPageInsights(params.page);
    const result: PageInsightResult = {
      workspace_id: SUGANDH_LOK_WORKSPACE_ID,
      page: params.page,
      period: SUGANDH_LOK_CANONICAL.period,
      data_epoch: DATA_EPOCH,
      signals,
      narrations,
      // faithfulness_ok is the upstream verdict; the deterministic narrator only ever
      // emits numbers echoed from the signal set, so it is structurally faithful.
      // The BFF re-asserts via assertInsightFaithfulness before render (defense in depth).
      faithfulness_ok: true,
      model_used,
      cached: false,
      paradigm: 'small_llm',
    };
    return { result, data_epoch: DATA_EPOCH };
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

  // Phase-2 slice-10 (feat-parity-cleanup-pages): honest READ surfaces. Fail-closed.
  async getWorkspaceMembers(params: {
    workspace_id: string;
  }): Promise<{ result: WorkspaceMembersResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokMembers(), data_epoch: DATA_EPOCH };
  }

  async getWorkspaceSettings(params: {
    workspace_id: string;
  }): Promise<{ result: WorkspaceSettingsResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokWorkspaceSettings(), data_epoch: DATA_EPOCH };
  }

  async getIntegrations(params: {
    workspace_id: string;
  }): Promise<{ result: IntegrationsResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokIntegrations(), data_epoch: DATA_EPOCH };
  }

  async getBackfillStatus(params: {
    workspace_id: string;
  }): Promise<{ result: BackfillStatusResult; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { result: buildSugandhlokBackfillStatus(), data_epoch: DATA_EPOCH };
  }

  async getDailySales(params: { workspace_id: string; date_range: DateRange }): Promise<{ rows: import('../domain/proto-types.js').DailySalesRow[]; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    // Stub: return empty — no seed daily series for the stub plane.
    return { rows: [], data_epoch: DATA_EPOCH };
  }

  async getDailyAcquisition(params: { workspace_id: string; date_range: DateRange }): Promise<{ rows: import('../domain/proto-types.js').DailyAcquisitionRow[]; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { rows: [], data_epoch: DATA_EPOCH };
  }

  // P&L period grid stub — returns empty rows (Sugandh seed does not have period-level
  // breakdowns seeded; the real read runs in LocalDbDataPlane for connected workspaces).
  async getPnlPeriodGrid(params: {
    workspace_id: string;
    date_range: DateRange;
    granularity: 'day' | 'week' | 'month' | 'quarter';
  }): Promise<{ rows: import('../domain/proto-types.js').PnlPeriodRow[]; currency_code: string; data_epoch: Date }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { rows: [], currency_code: 'INR', data_epoch: DATA_EPOCH };
  }

  async getShipmentRows(params: {
    workspace_id: string;
    date_range: import('../domain/proto-types.js').DateRange;
    filters: import('../domain/proto-types.js').ShipmentRowFilters;
    cursor?: string;
    page_size: number;
  }): Promise<{
    rows: import('../domain/proto-types.js').ShipmentRow[];
    next_cursor: string | null;
    total_count: bigint;
    filtered_count: bigint;
    delivered_count: bigint;
    rto_count: bigint;
    mapped_count: bigint;
    distinct_statuses: string[];
    data_epoch: Date;
  }> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    // Stub returns honest empty — no shipment facts in the loopback plane.
    return {
      rows: [],
      next_cursor: null,
      total_count: 0n,
      filtered_count: 0n,
      delivered_count: 0n,
      rto_count: 0n,
      mapped_count: 0n,
      distinct_statuses: [],
      data_epoch: DATA_EPOCH,
    };
  }

  // Wave-4A: lead-time mutation (MANAGER-gated). In-memory override for the stub plane.
  async setLeadTime(params: InventorySetLeadTimeInput): Promise<InventorySetLeadTimeResult> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return setLeadTimeLoopback(params.sku, params.lead_time_days);
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

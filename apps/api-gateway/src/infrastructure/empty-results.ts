// @paradigm: sql
// Honest EMPTY result factories (Slice E). For a real (non-Sugandh) workspace whose
// surface is NOT yet fed by a connector (RTO/COD/pincode need Shiprocket; cohorts/LTV/
// products/inventory/lifecycle/timings/email need deeper facts), the LocalDbDataPlane
// returns these all-zero / empty-rows results — NEVER the Sugandh seed, NEVER a
// fabricated number (canon acceptance bar + CF-S10-HONEST-STATE-1 + persona P-001).
// The page renders its honest empty-state from these zeros.

import { DATA_EPOCH } from './loopback-data-plane.js';
import type {
  RtoAnalyticsResult,
  CodPrepaidResult,
  LogisticsResult,
  PincodeIntelligenceResult,
  DistributionsResult,
  CohortMatrixResult,
  LtvSummaryResult,
  ProductPerformanceResult,
  InventoryLevelsResult,
  FirstProductCascadeResult,
  GoalAttainmentResult,
  CostStackResult,
  FestivalCalendarResult,
  CalendarReportResult,
  LifecycleStatesResult,
  OrderTimingsResult,
  EmailSmsPerformanceResult,
  TimingsRow,
} from '../domain/proto-types.js';

const base = (ws: string) => ({
  workspace_id: ws,
  period: 'synced',
  data_epoch: DATA_EPOCH,
  currency_code: 'INR',
});

export const emptyRtoAnalytics = (ws: string): RtoAnalyticsResult => ({
  ...base(ws),
  total_shipments: 0n,
  rto_count: 0n,
  rto_rate_bp: null,
  total_rto_cost_mu: 0n,
  revenue_lost_to_rto_mu: 0n,
  by_payment_method: [],
  by_courier: [],
});

export const emptyCodPrepaid = (ws: string): CodPrepaidResult => ({
  ...base(ws),
  cod_orders: 0n,
  prepaid_orders: 0n,
  cod_realization_rate_bp: null,
  cod_rto_rate_bp: null,
  prepaid_rto_rate_bp: null,
  effective_revenue_cod_mu: 0n,
  effective_revenue_prepaid_mu: 0n,
  prepaid_premium_mu: 0n,
  average_order_value_mu: null,
  breakeven_cod_rto_rate_bp: null,
  breakeven_note: null,
  comparison: [],
});

export const emptyLogistics = (ws: string): LogisticsResult => ({
  ...base(ws),
  total_shipments: 0n,
  delivered_count: 0n,
  delivered_rate_bp: null,
  rto_count: 0n,
  rto_rate_bp: null,
  cod_count: 0n,
  prepaid_count: 0n,
  forward_charges_mu: 0n,
  cod_charges_mu: 0n,
  rto_charges_mu: 0n,
  total_shiprocket_charges_mu: 0n,
  average_shipping_charge_per_shipment_mu: null,
  by_courier: [],
});

export const emptyPincode = (ws: string): PincodeIntelligenceResult => ({
  ...base(ws),
  rows: [],
  total_shipments: 0n,
});

export const emptyDistributions = (ws: string): DistributionsResult => ({
  ...base(ws),
  metric: 'sales',
  rows: [],
  total_rows: 0n,
  graph_points: [],
  global_mode_mu: 0n,
  global_mean_mu: 0n,
});

export const emptyCohortMatrix = (ws: string): CohortMatrixResult => ({
  ...base(ws),
  metric: 'cm3',
  mode: 'cumulative',
  average_cac_mu: null,
  avg_90day_repeat_bp: null,
  average_payback_centimonths: null,
  new_customers: 0n,
  rows: [],
});

export const emptyLtvSummary = (ws: string): LtvSummaryResult => ({
  ...base(ws),
  metric: 'cm2',
  mode: 'cumulative',
  dimension: 'product',
  first_order_mu: 0n,
  first_order_realized_mu: 0n,
  month1_mu: 0n,
  month3_mu: 0n,
  month6_mu: 0n,
  month12_mu: 0n,
  new_customers: 0n,
  total_rows: 0n,
  rows: [],
});

export const emptyProductPerformance = (ws: string): ProductPerformanceResult => ({
  ...base(ws),
  group_by: 'product',
  sort: 'cm1',
  direction: 'desc',
  total_cm1_mu: 0n,
  total_rows: 0n,
  rows: [],
});

export const emptyInventoryLevels = (ws: string): InventoryLevelsResult => ({
  workspace_id: ws,
  period: 'synced',
  data_epoch: DATA_EPOCH,
  grain: 'product',
  sort: 'days_left',
  direction: 'asc',
  total_rows: 0n,
  rows: [],
});

export const emptyFirstProductCascade = (ws: string): FirstProductCascadeResult => ({
  ...base(ws),
  observation_days: 90,
  total_cohort_customers: 0n,
  rows: [],
});

export const emptyGoalAttainment = (ws: string): GoalAttainmentResult => ({
  workspace_id: ws,
  period: 'synced',
  data_epoch: DATA_EPOCH,
  rows: [],
  total_rows: 0n,
});

export const emptyCostStack = (ws: string): CostStackResult => ({
  ...base(ws),
  override_all_bp: 0,
  fallback_bp: 0,
  markup_bp: 0,
  cogs_mode: 'product+fallback',
  cost_rows: [],
  total_fixed_monthly_mu: 0n,
  total_per_order_mu: 0n,
  net_sales_mu: 0n,
  resolved_cogs_mu: 0n,
  variable_costs_mu: 0n,
  cm1_mu: 0n,
});

export const emptyFestivalCalendar = (ws: string): FestivalCalendarResult => ({
  workspace_id: ws,
  period: 'synced',
  data_epoch: DATA_EPOCH,
  year: null,
  rows: [],
  total_rows: 0n,
  peak_multiplier_bp: 0,
});

export const emptyCalendarReport = (ws: string): CalendarReportResult => ({
  ...base(ws),
  grain: 'month',
  rows: [],
  total_rows: 0n,
});

export const emptyLifecycleStates = (ws: string): LifecycleStatesResult => ({
  ...base(ws),
  p40_days: 0,
  p80_days: 0,
  used_fallback: true,
  buckets: [],
  net_active: 0n,
  total_customers: 0n,
  unattributed_revenue_mu: 0n,
  unattributed_order_count: 0n,
});

const emptyTimingsRow = (): TimingsRow => ({
  group_id: '',
  label: 'All',
  group_by: 'product',
  first_orders: 0n,
  second_orders_bp: 0,
  third_orders_bp: 0,
  fourth_orders_bp: 0,
  days_1to2: null,
  days_2to3: null,
  days_3to4: null,
  reactivation_window_days: null,
});

export const emptyOrderTimings = (ws: string): OrderTimingsResult => ({
  ...base(ws),
  metric: 'median',
  summary: emptyTimingsRow(),
  groups: [],
});

export const emptyEmailSmsPerformance = (ws: string): EmailSmsPerformanceResult => ({
  ...base(ws),
  group_by: 'campaign',
  rows: [],
  total_delivered: 0n,
  total_revenue_mu: 0n,
});

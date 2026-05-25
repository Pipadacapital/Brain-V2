// @paradigm: sql
// Hand-authored TypeScript mirrors of the gRPC proto contracts.
// These mirror protos/brain/metrics/v1/metrics.proto and
// protos/brain/intelligence/v1/intelligence.proto exactly.
//
// In Phase 0-1 (in-process / localhost loopback), the api-gateway uses these
// types directly. When buf generate produces remote-plugin stubs, these are
// superseded by @brain/proto-ts — the DataPlanePort interface is the adapter seam.
//
// CF-C6-DATA-SEAM-1: one port, one contract. No second code path.
// CF-C6-BIGINT-JSON-1: _mu fields are bigint at the TS edge; superjson serializes
//   them faithfully across tRPC. Never Number() a _mu before the edge.

// ---------------------------------------------------------------------------
// Metrics proto types (brain.metrics.v1)
// ---------------------------------------------------------------------------

/** Mirror of MetricRow from metrics.proto. */
export interface MetricRow {
  workspace_id: string;
  date: string;           // ISO date e.g. "2026-05-01"
  data_epoch: Date;       // CF-C6-AS-OF-STAMP-1

  // Revenue ladder — all _mu are bigint (int64 minor units)
  gross_sales_mu: bigint;
  returns_mu: bigint;
  discounts_mu: bigint;
  net_sales_mu: bigint;
  total_tax_mu: bigint;
  net_net_tax_mu: bigint;
  shipping_revenue_mu: bigint;
  net_revenue_mu: bigint;

  // Cost ladder
  cogs_mu: bigint;
  total_ad_spend_mu: bigint;
  cm1_mu: bigint;
  cm2_mu: bigint;
  misc_expenses_prorated_mu: bigint | null;  // nullable zero-denominator
  cm3_mu: bigint;

  // Ratio metrics (_bp = number | null, nullable on zero-denominator day)
  rto_rate_bp: number | null;
  prepaid_rate_bp: number | null;
  conversion_rate_bp: number | null;
  aov_mu: number | null;          // nullable (typed as number for bp-scale compat)
  acos_bp: number | null;         // display_only
  blended_roas_x100: number | null; // display_only, scale=100 → display /100
  currency_code: string;

  // Optional channel ratios
  meta_ctr_bp?: number | null;
  meta_cpc_mu?: number | null;
  meta_cpm_mu?: number | null;
  google_ctr_bp?: number | null;
  google_avg_cpc_mu?: number | null;
}

/** Mirror of KpiSummaryRow from metrics.proto. */
export interface KpiSummaryRow {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;

  // All fields map to registry definition_ids (CF-C6-REGISTRY-ONLY-BFF-1)
  net_revenue_mu: bigint;
  cm2_mu: bigint;
  cm3_mu: bigint;
  rto_rate_bp: number | null;
  blended_roas_x100: number | null;   // scale=100 → display /100
  total_orders: bigint;
  aov_mu: number | null;
  conversion_rate_bp: number | null;
}

/**
 * StoreRevenueLadderStep — one rung of the /store revenue ladder.
 * Phase-2 slice-1 (feat-store-order-fact-layer). value_mu is bigint (int64 paise).
 * definition_id traces to the metric registry (CF-C6-REGISTRY-ONLY-BFF-1).
 */
export interface StoreRevenueLadderStep {
  definition_id: string;   // registry id, e.g. "realized_revenue_mu"
  label: string;           // display label, e.g. "Realized Revenue"
  value_mu: bigint;        // int64 minor units (CF-C6-BIGINT-JSON-1)
}

/**
 * StoreSummaryRow — workspace store summary over a date range.
 * Phase-2 slice-1. All _mu are bigint (int64 minor units). Every field traces to
 * a registry definition_id (CF-C6-REGISTRY-ONLY-BFF-1).
 */
export interface StoreSummaryRow {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;

  gross_sales_mu: bigint;
  total_discount_mu: bigint;
  net_sales_mu: bigint;
  total_tax_mu: bigint;
  net_net_tax_mu: bigint;
  shipping_revenue_mu: bigint;
  net_revenue_mu: bigint;
  realized_revenue_mu: bigint;   // Brain-native honest billing base
  order_count: bigint;
  aov_mu: bigint | null;
}

/** Mirror of PnlWaterfallRow from metrics.proto. */
export interface PnlWaterfallRow {
  definition_id: string;   // registry id (CF-C6-REGISTRY-ONLY-BFF-1)
  label: string;
  value_mu: bigint;        // signed: negative = cost deduction
  cumulative_mu: bigint;
  currency_code: string;
  data_epoch: Date;
}

/**
 * PnlStatementRow — the honest P&L contribution-margin ladder over a date range.
 * Phase-2 slice-2 (feat-pnl-cm-waterfall). All _mu are bigint (int64 paise).
 * Every field traces to a registry definition_id (CF-C6-REGISTRY-ONLY-BFF-1).
 * cm1_mu = net_revenue − cogs − variable_costs (the honest CM1; slice-2 correction).
 * true_cm2_mu is the Brain-native RTO-honest CM2 (null when there are no orders).
 */
export interface PnlStatementRow {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;

  net_revenue_mu: bigint;
  cogs_mu: bigint;
  variable_costs_mu: bigint;
  cm1_mu: bigint;
  total_ad_spend_mu: bigint;
  cm2_mu: bigint;
  misc_expenses_prorated_mu: bigint;
  cm3_mu: bigint;
  true_cm2_mu: bigint | null;   // Brain-native; null on zero-order range
  order_count: bigint;
}

// ---------------------------------------------------------------------------
// RTO / COD / Logistics / Pincode economics (Phase-2 slice-3: feat-rto-cod-economics)
// All _mu are bigint (int64 paise); _bp are number|null (nullable on zero-denominator).
// Every field traces a registry definition_id (CF-C6-REGISTRY-ONLY-BFF-1).
// ---------------------------------------------------------------------------

export interface RtoByPaymentMethodRow {
  payment_method: 'COD' | 'Prepaid';
  rto_count: bigint;
  rto_cost_mu: bigint;
  revenue_lost_mu: bigint;
}

export interface RtoByCourierRow {
  courier_name: string;
  rto_count: bigint;
  rto_cost_mu: bigint;
  revenue_lost_mu: bigint;
}

export interface RtoAnalyticsResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  total_shipments: bigint;
  rto_count: bigint;
  rto_rate_bp: number | null;       // registry rto_rate_bp
  total_rto_cost_mu: bigint;        // registry rto_cost_mu
  revenue_lost_to_rto_mu: bigint;   // registry rto_revenue_lost_mu
  by_payment_method: RtoByPaymentMethodRow[];
  by_courier: RtoByCourierRow[];
}

export interface CodPrepaidSegmentRow {
  payment_method: 'COD' | 'Prepaid';
  orders: bigint;
  gross_revenue_mu: bigint;
  rto_rate_bp: number | null;
  effective_revenue_mu: bigint;
  fee_total_mu: bigint;
  net_revenue_per_order_mu: bigint | null;
}

export interface CodPrepaidResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  cod_orders: bigint;
  prepaid_orders: bigint;
  cod_realization_rate_bp: number | null;      // registry cod_realization_rate_bp
  cod_rto_rate_bp: number | null;
  prepaid_rto_rate_bp: number | null;
  effective_revenue_cod_mu: bigint;
  effective_revenue_prepaid_mu: bigint;
  prepaid_premium_mu: bigint;
  average_order_value_mu: bigint | null;       // registry aov_mu
  breakeven_cod_rto_rate_bp: number | null;    // registry breakeven_cod_rto_rate_bp
  breakeven_note: string | null;
  comparison: CodPrepaidSegmentRow[];
}

export interface LogisticsCourierRow {
  courier_name: string;
  count: bigint;
  delivered_count: bigint;
  rto_count: bigint;
  total_charges_mu: bigint;
}

export interface LogisticsResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  total_shipments: bigint;
  delivered_count: bigint;
  delivered_rate_bp: number | null;
  rto_count: bigint;
  rto_rate_bp: number | null;
  cod_count: bigint;
  prepaid_count: bigint;
  forward_charges_mu: bigint;
  cod_charges_mu: bigint;
  rto_charges_mu: bigint;
  total_shiprocket_charges_mu: bigint;
  average_shipping_charge_per_shipment_mu: bigint | null;
  by_courier: LogisticsCourierRow[];
}

export interface PincodeRow {
  pincode: string;
  city: string;
  state: string;
  tier: number | null;            // 1 | 2 | 3 | null
  shipment_count: bigint;
  rto_count: bigint;
  rto_rate_bp: number | null;
  cod_count: bigint;
  cod_rate_bp: number | null;
  delivered_count: bigint;
  delivered_rate_bp: number | null;
  revenue_mu: bigint;
  aov_mu: bigint | null;          // registry aov_mu
  unique_customers: bigint;
  repeat_rate_bp: number | null;
  reliability_score: number;      // registry pincode_reliability_score (centi-points 0..10000)
  top_courier: string;
}

export interface PincodeIntelligenceResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  rows: PincodeRow[];
  total_shipments: bigint;
}

export interface PincodeFilterInput {
  search?: string;
  state?: string;
  min_orders?: number;
  high_rto?: boolean;
  high_cod?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Marketing efficiency / acquisition / distributions (Phase-2 slice-4:
// feat-marketing-acquisition). RECONCILED to legacy: aMER uses acquisition-classified
// spend; ROAS/ACOS display_only; pamer_bp decommissioned.
// ---------------------------------------------------------------------------

export interface MarketingEfficiencyResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  net_revenue_mu: bigint;
  total_ad_spend_mu: bigint;
  new_customer_revenue_mu: bigint;
  acquisition_ad_spend_mu: bigint;
  meta_spend_mu: bigint;
  google_spend_mu: bigint;
  mer_bp: number | null;
  amer_bp: number | null;
  acos_bp: number | null;            // display_only
  blended_roas_x100: number | null;  // display_only
}

export interface AcquisitionDailyRow {
  date: string;
  new_customers: bigint;
  nc_cm2_mu: bigint;
  nc_revenue_mu: bigint;
  ad_spend_mu: bigint;
  acquisition_ad_spend_mu: bigint;
  cac_mu: bigint | null;
  cm2_per_nc_mu: bigint | null;
  amer_bp: number | null;
  meta_spend_mu: bigint;
  google_spend_mu: bigint;
}

export interface AcquisitionSummaryResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  new_customers_count: bigint;
  nc_cm2_mu: bigint;
  new_customer_revenue_mu: bigint;
  total_ad_spend_mu: bigint;
  acquisition_ad_spend_mu: bigint;
  meta_spend_mu: bigint;
  google_spend_mu: bigint;
  cac_mu: bigint | null;
  cm2_per_nc_mu: bigint | null;
  amer_bp: number | null;
  daily: AcquisitionDailyRow[];
}

export interface DistributionsProductRow {
  product: string;
  orders: bigint;
  mode_mu: bigint;
  mean_mu: bigint;
  diff_mu: bigint;
}

export interface DistributionsGraphPoint {
  value_mu: bigint;
  density_bp: number;
}

export interface DistributionsResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  metric: 'sales' | 'cm1';
  rows: DistributionsProductRow[];
  total_rows: bigint;
  graph_points: DistributionsGraphPoint[];
  global_mode_mu: bigint;
  global_mean_mu: bigint;
}

export interface DistributionsFilterInput {
  metric?: 'sales' | 'cm1';
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

// ---------------------------------------------------------------------------
// Cohorts + LTV proto types (Phase-2 slice-5: feat-cohorts-ltv)
// Cohorts use CM3 (Finding 1); LTV uses CM2 (Finding 2); payback is the cumulative
// bucket-walk (Finding 3); cohort_ltv feeds ltv_cac_bp (Finding 4).
// ---------------------------------------------------------------------------

export type CohortMetric = 'cm3' | 'revenue' | 'repeat' | 'repurchase';
export type CohortMode = 'post' | 'cumulative' | 'incr' | 'pct' | 'ltvcac';

export interface CohortRow {
  cohort_month: string;          // YYYY-MM
  new_customers: bigint;
  cac_mu: bigint | null;
  rr90_bp: number | null;
  payback_centimonths: number | null;  // null = not reached; 0 = immediate; 100 = 1.0 month
  first_order_cm3_mu: bigint;
  first_order_realized_cm3_mu: bigint;
  cohort_ltv_mu: bigint;         // cumulative realized CM3 at horizon (feeds ltv_cac_bp)
  ltv_cac_bp: number | null;
  m: bigint[];                   // length 12 (display values; bigint for money/bp integer)
}

export interface CohortMatrixResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  metric: CohortMetric;
  mode: CohortMode;
  average_cac_mu: bigint | null;
  avg_90day_repeat_bp: number | null;
  average_payback_centimonths: number | null;
  new_customers: bigint;
  rows: CohortRow[];
}

export interface CohortFilterInput {
  metric?: CohortMetric;
  mode?: CohortMode;
}

export type LtvMetric = 'cm2' | 'revenue' | 'repeat_rate';
export type LtvMode = 'cumulative' | 'post_acq' | 'incremental';
export type LtvDimension =
  | 'product' | 'variant' | 'vendor' | 'collection' | 'product_type'
  | 'product_tags' | 'order_tags' | 'discount_codes' | 'discount_pct' | 'customer_id';

export interface LtvRow {
  dimension_value: string;
  dimension_label: string;
  orders_count: bigint;
  new_customers: bigint;
  first_order_realized_mu: bigint;
  first_order_mu: bigint;
  m: bigint[];  // length 12
}

export interface LtvSummaryResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  metric: LtvMetric;
  mode: LtvMode;
  dimension: LtvDimension;
  first_order_mu: bigint;
  first_order_realized_mu: bigint;
  month1_mu: bigint;
  month3_mu: bigint;
  month6_mu: bigint;
  month12_mu: bigint;
  new_customers: bigint;
  total_rows: bigint;
  rows: LtvRow[];
}

export interface LtvFilterInput {
  metric?: LtvMetric;
  mode?: LtvMode;
  dimension?: LtvDimension;
  search?: string;
  page?: number;
  page_size?: number;
}

// ---------------------------------------------------------------------------
// Catalog / inventory / first-product cascade (Phase-2 slice-6: feat-catalog-inventory)
// Products is CM1 (NOT per-SKU CM2); inventory = sell_through + days_left (NOT turnover);
// cascade second-order-rate is per-first-product (NOT slice-5 rr90).
// ---------------------------------------------------------------------------

export type ProductGroupBy =
  | 'product' | 'variant' | 'collection' | 'vendor' | 'type'
  | 'product_tags' | 'order_tags' | 'discount_codes';
export type ProductSort =
  | 'label' | 'pareto_grade' | 'cm1' | 'cm1_pct' | 'cm1_total'
  | 'revenue' | 'sold' | 'refunded' | 'net_quantity' | 'return_rate' | 'orders' | 'aov';

export interface ProductRow {
  label: string;
  pareto_grade: 'A' | 'B' | 'C' | 'F';
  cm1_mu: bigint;
  cm1_pct_bp: number | null;
  cm1_total_share_bp: number | null;
  revenue_mu: bigint;
  sales_mu: bigint;
  refunds_mu: bigint;
  sold: bigint;
  refunded: bigint;
  net_quantity: bigint;
  return_rate_bp: number | null;
  nc_return_rate_bp: number | null;
  ec_return_rate_bp: number | null;
  orders: bigint;
  nc_orders: bigint;
  ec_orders: bigint;
  aov_mu: bigint | null;
  nc_aov_mu: bigint | null;
  ec_aov_mu: bigint | null;
}

export interface ProductPerformanceResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  group_by: ProductGroupBy;
  sort: ProductSort;
  direction: 'asc' | 'desc';
  total_cm1_mu: bigint;
  total_rows: bigint;
  rows: ProductRow[];
}

export interface ProductFilterInput {
  group_by?: ProductGroupBy;
  sort?: ProductSort;
  direction?: 'asc' | 'desc';
  search?: string;
  page?: number;
  page_size?: number;
}

export type InventoryStatus =
  | 'Out of stock' | 'Restock Soon' | 'Healthy' | 'Overstocked' | 'Severely Overstocked';
export type InventorySort = 'label' | 'current_inventory' | 'days_left' | 'sell_through' | 'status';

export interface InventoryRow {
  label: string;
  sku: string;
  current_inventory: bigint;
  days_left: bigint;            // 999999 = INFINITE (stock but no velocity)
  sell_through_bp: number | null;
  status: InventoryStatus;
}

export interface InventoryLevelsResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  grain: 'product' | 'variant';
  sort: InventorySort;
  direction: 'asc' | 'desc';
  total_rows: bigint;
  rows: InventoryRow[];
}

export interface InventoryFilterInput {
  grain?: 'product' | 'variant';
  sort?: InventorySort;
  direction?: 'asc' | 'desc';
  status_filter?: InventoryStatus;
}

export interface FirstProductCascadeRow {
  product_key: string;
  product_title: string;
  first_order_customers: bigint;
  customers_with_2nd_order: bigint;
  customers_with_3rd_order: bigint;
  customers_with_4th_plus_order: bigint;
  second_order_rate_bp: number | null;
  third_order_rate_bp: number | null;
  fourth_plus_rate_bp: number | null;
  additional_order_rate_centi: bigint;   // mean extra orders ×100
  average_ltv_revenue_mu: bigint;        // mean revenue LTV (paise)
  average_days_to_second_deci: bigint | null;  // mean days ×10; null if no 2nd order
}

export interface FirstProductCascadeResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  currency_code: string;
  observation_days: number;
  total_cohort_customers: bigint;
  rows: FirstProductCascadeRow[];
}

export interface FirstProductCascadeFilterInput {
  observation_days?: number;
}

// ---------------------------------------------------------------------------
// Phase-2 slice-7 (feat-finance-settings-goals): goals / costs / festivals / calendar.
// Goal RAG is DIRECTIONAL (Rohan Finding 1). festival learned-lift is a PHANTOM (Finding 2).
// ---------------------------------------------------------------------------

export type GoalRag = 'green' | 'amber' | 'red';
export type GoalValueType = 'MINIMUM' | 'MAXIMUM' | 'TARGET';
export type GoalPeriodType = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface GoalEvaluationRow {
  metric_name: string;
  period_type: GoalPeriodType;
  period_start: string;
  goal_type: GoalValueType;
  goal_value: bigint;             // mu / bp / count (BIGINT minor units where money)
  actual: bigint;
  attainment_bp: number | null;   // NULL when goal_value == 0
  variance_abs: bigint;
  higher_better: boolean;
  rag: GoalRag;
}

export interface GoalAttainmentResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  rows: GoalEvaluationRow[];
  total_rows: bigint;
}

/** goals.upsert (idempotent write) — input + result. */
export interface GoalUpsertInput {
  workspace_id: string;
  metric_name: string;
  period_type: GoalPeriodType;
  period_start: string;           // ISO yyyy-mm-dd
  goal_value: bigint;
  goal_type: GoalValueType;
  idempotency_key: string;
}

export interface GoalUpsertResult {
  goal_id: string;
  metric_name: string;
  period_type: GoalPeriodType;
  period_start: string;
  goal_value: bigint;
  goal_type: GoalValueType;
}

// /costs — the resolved cost stack feeding CM.
export type CostKind = 'fixed_monthly' | 'per_order' | 'percent';

export interface CostStackRow {
  cost_type: string;
  name: string;
  kind: CostKind;
  amount_mu: bigint;
  amount_bp: number;
  effective_from: string;
  currency_code: string;
}

export interface CostStackResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  override_all_bp: number;
  fallback_bp: number;
  markup_bp: number;
  cogs_mode: 'override' | 'product+fallback';
  cost_rows: CostStackRow[];
  total_fixed_monthly_mu: bigint;
  total_per_order_mu: bigint;
  net_sales_mu: bigint;
  resolved_cogs_mu: bigint;
  variable_costs_mu: bigint;
  cm1_mu: bigint;
  currency_code: string;
}

// /settings/festivals — India template calendar (display; CRUD deferred). NO learned lift.
export interface FestivalRow {
  name: string;
  start_date: string;
  end_date: string;
  expected_multiplier_bp: number;   // 40000 = 4.0× (stored template default, NOT learned)
  regions: string[];
  categories: string[];
  color: string;
  is_template: boolean;
  is_active: boolean;
}

export interface FestivalCalendarResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  year: number | null;
  rows: FestivalRow[];
  total_rows: bigint;
  peak_multiplier_bp: number;
}

export interface FestivalCalendarFilterInput {
  year?: number;
}

// /calendar — period grid with marketing-action overlays + per-cell directional RAG.
export type CalendarGrain = 'day' | 'week' | 'month';

export interface CalendarCell {
  actual: bigint | null;
  goal: bigint | null;
  rag: GoalRag | null;
}

export interface CalendarActionRow {
  id: string;
  action_date: string;
  action_type: string;
  action_name: string;
  notes: string | null;
  source: 'manual' | 'klaviyo';
}

export interface CalendarReportRow {
  period_key: string;
  label: string;
  actions: CalendarActionRow[];
  revenue: CalendarCell;
  cm3: CalendarCell;
  total_spend_mu: bigint;
  mer: CalendarCell;
  amer: CalendarCell;
  new_customers: CalendarCell;
  cac: CalendarCell;
  aov: CalendarCell;
}

export interface CalendarReportResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  grain: CalendarGrain;
  currency_code: string;
  rows: CalendarReportRow[];
  total_rows: bigint;
}

export interface CalendarReportFilterInput {
  grain?: CalendarGrain;
}

// ---------------------------------------------------------------------------
// Phase-2 slice-8 (feat-lifecycle-timings-email): READ/ANALYTICS ONLY.
// Lifecycle states (recency-vs-percentile), order timings (inter-order gaps),
// email/SMS PERFORMANCE reporting. NO outbound-channel surface (Shreya S4).
// best_send_time + email_cm2 are phantoms (Findings 2, 4) — not modelled.
// ---------------------------------------------------------------------------

export type LifecycleBucketName = 'new' | 'active' | 'at_risk' | 'churned';

export interface LifecycleBucketRow {
  bucket: LifecycleBucketName;
  customer_count: bigint;
  revenue_mu: bigint;       // trailing-window revenue attributed to the bucket
  order_count: bigint;
}

export interface LifecycleStatesResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  p40_days: number;
  p80_days: number;
  used_fallback: boolean;
  buckets: LifecycleBucketRow[];
  net_active: bigint;          // new + active
  total_customers: bigint;
  unattributed_revenue_mu: bigint;
  unattributed_order_count: bigint;
  currency_code: string;
}

export type TimingsMetric = 'median' | 'mean';
export type TimingsGroupByName = 'product' | 'variant' | 'vendor' | 'productType';

export interface TimingsRow {
  group_id: string;
  label: string;
  group_by: string;
  first_orders: bigint;
  second_orders_bp: number;
  third_orders_bp: number;
  fourth_orders_bp: number;
  days_1to2: number | null;
  days_2to3: number | null;
  days_3to4: number | null;
  reactivation_window_days: number | null;  // 0.8 × median(1→2); a RECOMMENDATION, never a send
}

export interface OrderTimingsResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  metric: TimingsMetric;
  summary: TimingsRow;
  groups: TimingsRow[];
  currency_code: string;
}

export interface TimingsFilterInput {
  metric?: TimingsMetric;
  group_by?: TimingsGroupByName;
}

export type EmailPerfGroupByName = 'campaign' | 'flow' | 'date' | 'channel' | 'dow';

export interface EmailPerfRow {
  key: string;
  label: string;
  channel: string;                  // "email" | "sms" — REPORTING tag, not a send target
  delivered: bigint;
  unique_opens: bigint;
  unique_clicks: bigint;
  orders: bigint;
  revenue_mu: bigint;               // attributed past performance (REPORTING, never a send)
  unsubscribes: bigint;
  spam_complaints: bigint;
  open_rate_bp: number | null;
  click_rate_bp: number | null;
  revenue_per_recipient_mu: bigint | null;
}

export interface EmailSmsPerformanceResult {
  workspace_id: string;
  period: string;
  data_epoch: Date;
  group_by: EmailPerfGroupByName;
  rows: EmailPerfRow[];
  total_delivered: bigint;
  total_revenue_mu: bigint;
  currency_code: string;
}

export interface EmailSmsFilterInput {
  group_by?: EmailPerfGroupByName;
}

// ---------------------------------------------------------------------------
// Intelligence proto types (brain.intelligence.v1)
// ---------------------------------------------------------------------------

export type RecommendationAction =
  | 'PAUSE_AD_SET'
  | 'INCREASE_BUDGET'
  | 'DECREASE_BUDGET'
  | 'SEND_REFUND'
  | 'REVIEW_MANUALLY'
  | 'NO_ACTION';

export type InsightSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Phase-2 slice-9 page-narration severity scale (DISTINCT from the Morning Brief
 * InsightSeverity). Mirrors the legacy page-insight prompt's 4-value scale
 * (critical → warning → opportunity → positive). Kept separate per the
 * Single-Primitive Rule — narration severity and Morning-Brief severity are
 * different domains; overloading one enum would couple them.
 */
export type PageInsightSeverity = 'critical' | 'warning' | 'opportunity' | 'positive';

/** Server-driven graduation status. CF-C6-MB-GRADUATED-LABEL-1. */
export type GraduationStatus = 'LOGGED_AS_VOTE' | 'QUEUED_FOR_EXECUTION';

export type ResponseKind = 'APPROVE' | 'REJECT' | 'EDIT';

/** Mirror of TypedRecommendation. rationale is render-only. */
export interface TypedRecommendation {
  action: RecommendationAction;
  entity_id: string;
  /** Render-only. NEVER passed to executor or LLM prompt. CF-C5-INJECTION-TYPED-REC-6. */
  rationale: string;
}

/** Mirror of ExpectedImpact. Registry-DERIVED deterministic (Tier-A). CF-C6-MB-CONTRACT-COMPLETENESS-1. */
export interface ExpectedImpact {
  revenue_mu: bigint;     // int64 minor units (CF-C6-BIGINT-JSON-1)
  cm2_mu: bigint;         // int64 minor units
  currency_code: string;
  impact_label: string;   // deterministic label from signal layer
}

/**
 * Mirror of InsightItem (AMENDED — CF-C6-MB-CONTRACT-COMPLETENESS-1).
 * confidence_display_pct is pre-formatted int (CF-C6-NO-UI-FLOAT-1).
 */
export interface InsightItem {
  insight_id: string;
  title: string;
  severity: InsightSeverity;
  /** Pre-formatted integer, e.g. 87 = 87%. UI renders as-is. CF-C6-NO-UI-FLOAT-1. */
  confidence_display_pct: number;
  summary: string;
  detail: string;
  recommendation: TypedRecommendation;
  expected_impact: ExpectedImpact;    // CF-C6-MB-CONTRACT-COMPLETENESS-1
  risk: RiskLevel;                    // CF-C6-MB-CONTRACT-COMPLETENESS-1
  data_epoch: Date;                   // CF-C6-AS-OF-STAMP-1
}

export interface MorningBrief {
  items: InsightItem[];
  data_epoch: Date;
  freshness_label: string;
}

// ---------------------------------------------------------------------------
// Phase-2 slice-9 (feat-ai-insight-narration) — page-level AI narration.
// @paradigm small_llm (Haiku) for narration; the SIGNALS are deterministic sql.
// CF-S9: narration is GROUNDED in the deterministic registry numbers (slices 1-8);
//   the LLM may only DESCRIBE the signals, NEVER produce a metric value.
//   Every number in the narration is a `grounded_value_mu` echoed verbatim from
//   the deterministic signal set — the BFF faithfulness gate set-compares them.
// READ-ONLY: this surface reaches NO write/MCP tool (recommendation-only-until-graduated).
// ---------------------------------------------------------------------------

/**
 * One deterministic grounding signal that the narration is allowed to cite.
 * value_canonical is ALWAYS an integer minor unit (paise / bp / count) — NEVER float.
 * Mirrors intelligence-service domain.faithfulness.validator.Signal.
 */
export interface InsightSignal {
  signal_id: string;
  value_canonical: bigint;   // paise / bp / count — NEVER float
  label: string;             // human label for render (e.g. "CM2 (After Ads)")
}

/**
 * One grounded narrated insight. The `body` is the small_llm narration; every
 * numeric token in `body` MUST appear in `grounded_signal_ids` (faithfulness).
 * severity is a closed enum; there is NO executable action field (READ-only).
 */
export interface PageInsightNarration {
  insight_id: string;
  severity: PageInsightSeverity;    // critical | warning | opportunity | positive (closed)
  headline: string;                 // <= ~10 words, numbers grounded
  body: string;                     // 1-2 sentence narration, numbers grounded
  /** The signal_ids this narration cites — every body number traces to one of these. */
  grounded_signal_ids: string[];
}

/**
 * The /page narration payload. `signals` is the deterministic ground truth set;
 * `narrations` is the small_llm output, faithfulness-validated against `signals`.
 * `faithfulness_ok` is the gateway/BFF verdict (true required before render).
 * `model_used` + `cached` make the cost path observable.
 */
export interface PageInsightResult {
  workspace_id: string;
  page: string;
  period: string;
  data_epoch: Date;
  signals: InsightSignal[];
  narrations: PageInsightNarration[];
  faithfulness_ok: boolean;
  model_used: string;               // e.g. "anthropic/claude-haiku-3-5" or "deterministic-stub"
  cached: boolean;                  // filtersHash cache hit (cost: zero LLM call)
  paradigm: 'small_llm';            // pinned: never frontier per page
}

export interface SubmitInsightResult {
  decision_log_row_id: string;
  /** Server-driven. Day-1 = LOGGED_AS_VOTE. Client renders verbatim. CF-C6-MB-GRADUATED-LABEL-1. */
  status: GraduationStatus;
}

export interface RegisterPushTokenResult {
  registered: boolean;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// DataPlanePort — the single interface the api-gateway speaks.
// Phase 0-1: implemented by LoopbackDataPlane (in-process / localhost gRPC).
// Phase 2+: implemented by RemoteDataPlane (cross-task gRPC, config flip).
// CF-C6-DATA-SEAM-1: ONE port. No second code path.
// ---------------------------------------------------------------------------

export interface DateRange {
  start: string;  // ISO date
  end: string;    // ISO date
}

// ---------------------------------------------------------------------------
// Phase-2 slice-10 (feat-parity-cleanup-pages): thin NET-NEW honest READ surfaces
// for the parity-cleanup pages (/team, /settings, /settings/integrations,
// /settings/backfill). These are OPERATIONAL / membership / connector-status reads
// — NOT metric registry scalars (they do not go through the registry/parity gate).
// READ-only; every method is fail-closed on tenancy. WRITE/OAuth/backfill-trigger
// surfaces are DEFERRED (rendered as disabled affordances on the client).
// ---------------------------------------------------------------------------

/** Workspace role level (mirrors core-auth WORKSPACE_ROLE_LEVEL keys). */
export type WorkspaceMemberRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER';

export interface WorkspaceMemberRow {
  user_id: string;
  full_name: string;
  email: string;            // real PII — READ-only, workspace-scoped, ANALYST-gated.
  role: WorkspaceMemberRole;
  joined_at: string;        // ISO date
}

export interface WorkspaceMembersResult {
  workspace_id: string;
  members: WorkspaceMemberRow[];
  pending_invitations: number; // count only; invite (write) is deferred this slice.
}

export interface WorkspaceSettingsResult {
  workspace_id: string;
  name: string;
  plan: string;
  timezone: string;
  region: string;           // RegionAdapter region code (e.g. 'IN').
  currency_code: string;
  created_at: string;       // ISO date
}

/** Honest connector status. PENDING_CUTOVER is the truthful local state (Child-3 HELD). */
export type ConnectorStatus = 'CONNECTED' | 'PENDING_CUTOVER' | 'DISCONNECTED' | 'ERROR';

export interface IntegrationRow {
  connector: string;        // 'Shopify' | 'Meta Ads' | 'Google Ads' | 'Shiprocket' | 'Klaviyo' | ...
  status: ConnectorStatus;
  last_sync_at: string | null;   // null when never synced — NO fake timestamp.
  last_sync_error: string | null;
}

export interface IntegrationsResult {
  workspace_id: string;
  rows: IntegrationRow[];
}

export interface BackfillJobRow {
  job_type: string;         // 'ads-backfill' | 'shiprocket-courier' | 'shiprocket-pincode' | ...
  status: 'NONE' | 'PENDING_CUTOVER' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  started_at: string | null;
  note: string;             // honest human note ("connector cutover pending").
}

export interface BackfillStatusResult {
  workspace_id: string;
  jobs: BackfillJobRow[];
  note: string;             // page-level honest note.
}

export interface DataPlanePort {
  queryMetrics(params: {
    workspace_id: string;
    definition_ids: string[];
    date_range: DateRange;
    cursor?: string;
    page_size?: number;
  }): Promise<{ rows: MetricRow[]; data_epoch: Date; next_cursor: string }>;

  getKpiSummary(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ summary: KpiSummaryRow; data_epoch: Date }>;

  getPnlWaterfall(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ steps: PnlWaterfallRow[]; data_epoch: Date }>;

  /**
   * Phase-2 slice-2: the honest CM waterfall (signed, cumulative steps).
   * ONE source of truth — getPnlWaterfall delegates to THIS in the stub/loopback,
   * so metrics.pnlWaterfall and pnl.cmWaterfall never diverge (Single-Primitive Rule).
   */
  getCmWaterfall(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ steps: PnlWaterfallRow[]; data_epoch: Date }>;

  /**
   * Phase-2 slice-2: the honest P&L statement ladder over a date range.
   * CF-C6-DATA-SEAM-1: additive method on the SAME port — no second code path.
   */
  getPnlStatement(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ statement: PnlStatementRow; data_epoch: Date }>;

  /**
   * Phase-2 slice-1: workspace store summary + revenue ladder.
   * CF-C6-DATA-SEAM-1: additive method on the SAME port — no second code path.
   * Returns the canonical revenue ladder (Gross→Net→Net-of-tax→Net Revenue→Realized).
   */
  getStoreSummary(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ summary: StoreSummaryRow; ladder: StoreRevenueLadderStep[]; data_epoch: Date }>;

  /**
   * Phase-2 slice-3 (feat-rto-cod-economics): RTO/COD/logistics/pincode economics.
   * CF-C6-DATA-SEAM-1: additive methods on the SAME port — no second code path.
   */
  getRtoAnalytics(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: RtoAnalyticsResult; data_epoch: Date }>;

  getCodPrepaid(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: CodPrepaidResult; data_epoch: Date }>;

  getLogistics(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: LogisticsResult; data_epoch: Date }>;

  getPincodeIntelligence(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: PincodeFilterInput;
  }): Promise<{ result: PincodeIntelligenceResult; data_epoch: Date }>;

  /**
   * Phase-2 slice-4 (feat-marketing-acquisition): MER/aMER/CAC + acquisition + distributions.
   * CF-C6-DATA-SEAM-1: additive methods on the SAME port — no second code path.
   */
  getMarketingEfficiency(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: MarketingEfficiencyResult; data_epoch: Date }>;

  getAcquisitionSummary(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: AcquisitionSummaryResult; data_epoch: Date }>;

  getDistributions(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: DistributionsFilterInput;
  }): Promise<{ result: DistributionsResult; data_epoch: Date }>;

  /**
   * Phase-2 slice-5 (feat-cohorts-ltv): cohort retention/repeat heatmap (CM3) +
   * LTV-by-dimension (CM2). CF-C6-DATA-SEAM-1: additive methods on the SAME port.
   */
  getCohortMatrix(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: CohortFilterInput;
  }): Promise<{ result: CohortMatrixResult; data_epoch: Date }>;

  getLtvSummary(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: LtvFilterInput;
  }): Promise<{ result: LtvSummaryResult; data_epoch: Date }>;

  /**
   * Phase-2 slice-6 (feat-catalog-inventory): product performance (CM1), inventory levels
   * (sell-through + days-left), first-product cascade. CF-C6-DATA-SEAM-1: additive methods
   * on the SAME port.
   */
  getProductPerformance(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: ProductFilterInput;
  }): Promise<{ result: ProductPerformanceResult; data_epoch: Date }>;

  getInventoryLevels(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: InventoryFilterInput;
  }): Promise<{ result: InventoryLevelsResult; data_epoch: Date }>;

  getFirstProductCascade(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: FirstProductCascadeFilterInput;
  }): Promise<{ result: FirstProductCascadeResult; data_epoch: Date }>;

  // Phase-2 slice-7 (feat-finance-settings-goals): goals / costs / festivals / calendar.
  getGoalAttainment(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: GoalAttainmentResult; data_epoch: Date }>;

  /** Idempotent goal upsert. CF-C6-MB-IDEMPOTENCY-1 pattern (Redis dedup at the router). */
  upsertGoal(params: GoalUpsertInput): Promise<GoalUpsertResult>;

  getCostStack(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: CostStackResult; data_epoch: Date }>;

  getFestivalCalendar(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: FestivalCalendarFilterInput;
  }): Promise<{ result: FestivalCalendarResult; data_epoch: Date }>;

  getCalendarReport(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: CalendarReportFilterInput;
  }): Promise<{ result: CalendarReportResult; data_epoch: Date }>;

  // Phase-2 slice-8 (feat-lifecycle-timings-email): READ/ANALYTICS ONLY. Additive read methods
  // on the SAME port (CF-C6-DATA-SEAM-1). NO send/dispatch method is added — Shreya S4.
  getLifecycleStates(params: {
    workspace_id: string;
    date_range: DateRange;
  }): Promise<{ result: LifecycleStatesResult; data_epoch: Date }>;

  getOrderTimings(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: TimingsFilterInput;
  }): Promise<{ result: OrderTimingsResult; data_epoch: Date }>;

  getEmailSmsPerformance(params: {
    workspace_id: string;
    date_range: DateRange;
    filters?: EmailSmsFilterInput;
  }): Promise<{ result: EmailSmsPerformanceResult; data_epoch: Date }>;

  getMorningBrief(params: {
    workspace_id: string;
    date: string;
  }): Promise<MorningBrief>;

  /**
   * Phase-2 slice-9 (feat-ai-insight-narration): page-level AI narration.
   * CF-S9: small_llm (Haiku) narration GROUNDED in the deterministic signals.
   * READ-ONLY — no write/MCP-tool reach. Additive method on the SAME port.
   * In the LOCAL harness this routes to the deterministic grounded narrator
   * (no live Claude key); production flips to the real Haiku gateway by config.
   */
  getPageInsights(params: {
    workspace_id: string;
    page: string;
    date_range: DateRange;
  }): Promise<{ result: PageInsightResult; data_epoch: Date }>;

  submitInsightResponse(params: {
    workspace_id: string;
    insight_id: string;
    response_kind: ResponseKind;
    edit_payload?: string;
    idempotency_key: string;
  }): Promise<SubmitInsightResult>;

  registerPushToken(params: {
    workspace_id: string;
    user_id: string;
    device_id: string;
    expo_push_token: string;
  }): Promise<RegisterPushTokenResult>;

  // Phase-2 slice-10 (feat-parity-cleanup-pages): thin honest READ surfaces.
  // Additive methods on the SAME port (CF-C6-DATA-SEAM-1). All fail-closed on tenancy.
  getWorkspaceMembers(params: {
    workspace_id: string;
  }): Promise<{ result: WorkspaceMembersResult; data_epoch: Date }>;

  getWorkspaceSettings(params: {
    workspace_id: string;
  }): Promise<{ result: WorkspaceSettingsResult; data_epoch: Date }>;

  getIntegrations(params: {
    workspace_id: string;
  }): Promise<{ result: IntegrationsResult; data_epoch: Date }>;

  getBackfillStatus(params: {
    workspace_id: string;
  }): Promise<{ result: BackfillStatusResult; data_epoch: Date }>;
}

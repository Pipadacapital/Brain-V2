// @paradigm: sql
// Registry home for lib-metrics — CF-C4-SCOPE-SPLIT-1.
// Single export point for the metric registry (types + definitions).
// DO NOT re-export from an alternate path — Single-Primitive Rule.

export type { MetricDefinition, MetricKind, MetricUnit, ParityClass } from './types.js';
// Phase-2 slice-7: directional Goal RAG types (classification, not registry metric).
export type { GoalRag, GoalValueType } from './definitions.js';

export {
  // Revenue ladder
  NET_SALES_MU,
  NET_NET_TAX_MU,
  NET_REVENUE_MU,
  // Cost ladder
  VARIABLE_COSTS_MU,
  CM1_MU,
  CM2_MU,
  MISC_EXPENSES_PRORATED_MU,
  CM3_MU,
  // Ratio metrics
  RTO_RATE_BP,
  PREPAID_RATE_BP,
  CONVERSION_RATE_BP,
  AOV_MU,
  // Display-only ratios
  ACOS_BP,
  BLENDED_ROAS_X100,
  // Brain-native correctness-fixture metrics (parity_gap:true)
  TRUE_CM2_MU,
  AMER_BP,
  LTV_CAC_BP,
  // Phase-2 slice-4: marketing efficiency reconciled to legacy (pamer_bp decommissioned)
  MER_BP,
  CAC_MU,
  NEW_CUSTOMER_REVENUE_MU,
  NC_CM2_MU,
  CM2_PER_NC_MU,
  ACQUISITION_AD_SPEND_MU,
  // Phase-2 slice-3: RTO/COD/logistics/pincode economics
  RTO_COST_MU,
  RTO_REVENUE_LOST_MU,
  COD_REALIZATION_RATE_BP,
  BREAKEVEN_COD_RTO_RATE_BP,
  PINCODE_RELIABILITY_SCORE,
  // Phase-2 slice-5: cohorts + LTV
  COHORT_LTV_MU,
  REPEAT_RATE_BP,
  _CF_S5_COHORT_LTV_ANCHOR,
  _CF_S5_REPEAT_RATE_ANCHOR,
  // Phase-2 slice-6: catalog/inventory + first-product cascade
  INVENTORY_SELL_THROUGH_BP,
  INVENTORY_DAYS_LEFT,
  INVENTORY_INFINITE_DAYS,
  FIRST_PRODUCT_SECOND_ORDER_RATE_BP,
  _CF_S6_INV_SELL_THROUGH_ANCHOR,
  _CF_S6_INV_DAYS_LEFT_ANCHOR,
  _CF_S6_INV_DAYS_LEFT_INFINITE_ANCHOR,
  _CF_S6_FP_SECOND_ORDER_ANCHOR,
  // Phase-2 slice-7: goal attainment + directional RAG (festival_lift decommissioned)
  GOAL_ATTAINMENT_BP,
  computeGoalRag,
  goalHigherBetter,
  _CF_S7_GOAL_ATTAINMENT_ANCHOR,
  _CF_S7_RAG_HIGHER_BETTER_ANCHOR,
  _CF_S7_RAG_LOWER_BETTER_ANCHOR,
  _CF_S7_RAG_LOWER_BETTER_RED_ANCHOR,
  // Registry index + derived sets
  METRIC_REGISTRY,
  DISPLAY_ONLY_METRIC_IDS,
  CORRECTNESS_FIXTURE_METRIC_IDS,
} from './definitions.js';

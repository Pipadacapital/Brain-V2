// @paradigm: sql
// Registry home for lib-metrics — CF-C4-SCOPE-SPLIT-1.
// Single export point for the metric registry (types + definitions).
// DO NOT re-export from an alternate path — Single-Primitive Rule.

export type { MetricDefinition, MetricKind, MetricUnit, ParityClass } from './types.js';

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
  PAMER_BP,
  AMER_BP,
  LTV_CAC_BP,
  // Phase-2 slice-3: RTO/COD/logistics/pincode economics
  RTO_COST_MU,
  RTO_REVENUE_LOST_MU,
  COD_REALIZATION_RATE_BP,
  BREAKEVEN_COD_RTO_RATE_BP,
  PINCODE_RELIABILITY_SCORE,
  // Registry index + derived sets
  METRIC_REGISTRY,
  DISPLAY_ONLY_METRIC_IDS,
  CORRECTNESS_FIXTURE_METRIC_IDS,
} from './definitions.js';

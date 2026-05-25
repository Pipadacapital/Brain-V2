// @brain/lib-metrics — v1 internal contract exports.
// CF-C2-PRIMITIVE-1: single TS home for all money primitives; Child 4 imports from here.
// CF-C4-SCOPE-SPLIT-1: metric registry also exported from this home (Child 4 extension).
// CF-C6-FORMATMONEY-CANONICAL-1: formatMoney exported from here — ONE home, no local reimpls.
// DO NOT re-export from an alternate path — the Single-Primitive Rule requires ONE home.

export type { Money } from './money.js';
export { makeMoney } from './money.js';

// CF-C6-FORMATMONEY-CANONICAL-1: canonical display formatter — ONE home.
export { formatMoney } from './format-money.js';

export { decimalToMinorUnits } from './convert.js';

export { ratioToBasisPoints } from './ratio.js';

export { subunitMultiplier } from './subunits.js';

export type { GoalType, GoalValue } from './goal-type.js';

// Child 4: metric registry (TS↔Python byte-identity pair; extends Child-2 home)
export type { MetricDefinition, MetricKind, MetricUnit, ParityClass } from './registry/index.js';
export {
  METRIC_REGISTRY,
  DISPLAY_ONLY_METRIC_IDS,
  CORRECTNESS_FIXTURE_METRIC_IDS,
  NET_SALES_MU,
  NET_NET_TAX_MU,
  NET_REVENUE_MU,
  CM1_MU,
  CM2_MU,
  MISC_EXPENSES_PRORATED_MU,
  CM3_MU,
  RTO_RATE_BP,
  PREPAID_RATE_BP,
  CONVERSION_RATE_BP,
  AOV_MU,
  ACOS_BP,
  BLENDED_ROAS_X100,
  TRUE_CM2_MU,
  PAMER_BP,
  AMER_BP,
  LTV_CAC_BP,
} from './registry/index.js';

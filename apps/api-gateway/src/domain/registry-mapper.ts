// @paradigm: sql
// CF-C6-REGISTRY-ONLY-BFF-1: every KPI tRPC field traces to a MetricDefinition.id.
// NO ad-hoc arithmetic in the gateway read path — any cross-row aggregate must be
// a named registry metric obtained via query_metrics, never a JS reduce.
//
// G-REGISTRY-ONLY gate: a static grep of apps/api-gateway/src finds NO arithmetic
// outside this file's formatMoney import path. Any `reduce((s,r)=>s+r.x_mu,0)`
// anywhere in gateway/web/mobile = traceability violation.
//
// The mapper validates that every field in a response object traces to a
// definition in METRIC_REGISTRY. This is called at runtime to enforce the
// invariant — not just a static type check.

import { METRIC_REGISTRY, type MetricDefinition } from '@brain/lib-metrics';
import type {
  KpiSummaryRow,
  PnlWaterfallRow,
  PnlStatementRow,
  StoreRevenueLadderStep,
} from './proto-types.js';

// _METRIC_COLUMNS mirrors query_gateway.py's _METRIC_COLUMNS tuple.
// Every BFF output field must be in this set (CF-C6-REGISTRY-ONLY-BFF-1).
export const _METRIC_COLUMNS = new Set([
  'workspace_id',
  'date',
  'gross_sales_mu',
  'returns_mu',
  'discounts_mu',
  'net_sales_mu',
  'total_tax_mu',
  'net_net_tax_mu',
  'shipping_revenue_mu',
  'net_revenue_mu',
  'cogs_mu',
  'total_ad_spend_mu',
  'cm1_mu',
  'cm2_mu',
  'misc_expenses_prorated_mu',
  'cm3_mu',
  'rto_rate_bp',
  'prepaid_rate_bp',
  'conversion_rate_bp',
  'aov_mu',
  'acos_bp',
  'blended_roas_x100',
  'meta_ctr_bp',
  'meta_cpc_mu',
  'meta_cpm_mu',
  'google_ctr_bp',
  'google_avg_cpc_mu',
  // count metrics allowed by name
  'total_orders',
]);

// KPI_FIELDS_TO_DEFINITION_ID: maps tRPC KpiSummary fields to registry definition_ids.
// Every entry here MUST have a corresponding MetricDefinition (checked at runtime).
// CF-C6-REGISTRY-ONLY-BFF-1.
export const KPI_FIELDS_TO_DEFINITION_ID: Record<string, string> = {
  net_revenue_mu: 'net_revenue_mu',
  cm2_mu: 'cm2_mu',
  cm3_mu: 'cm3_mu',
  rto_rate_bp: 'rto_rate_bp',
  blended_roas_x100: 'blended_roas_x100',
  total_orders: 'total_orders', // count, no registry entry needed — allowed by convention
  aov_mu: 'aov_mu',
  conversion_rate_bp: 'conversion_rate_bp',
};

// PNL_WATERFALL_DEFINITION_IDS: the ordered set of registry ids for the P&L waterfall.
// Each step MUST trace to a registry definition (CF-C6-REGISTRY-ONLY-BFF-1).
// Phase-2 slice-2 (feat-pnl-cm-waterfall): variable_costs_mu added (the honest CM1 line)
// and true_cm2_mu permitted (the RTO-honest CM2 rung).
export const PNL_WATERFALL_DEFINITION_IDS = [
  'net_revenue_mu',
  'cogs_mu',
  'variable_costs_mu',
  'cm1_mu',
  'total_ad_spend_mu',
  'cm2_mu',
  'misc_expenses_prorated_mu',
  'cm3_mu',
  'true_cm2_mu',
] as const;

// PNL_STATEMENT_DEFINITION_IDS: the registry ids that appear as P&L statement lines.
// Phase-2 slice-2. Every PnlStatementRow money field must trace to one of these.
export const PNL_STATEMENT_DEFINITION_IDS = [
  'net_revenue_mu',
  'cogs_mu',
  'variable_costs_mu',
  'cm1_mu',
  'total_ad_spend_mu',
  'cm2_mu',
  'misc_expenses_prorated_mu',
  'cm3_mu',
  'true_cm2_mu',
] as const;

/**
 * Validate that a KpiSummaryRow output traces every field to a registry definition_id.
 * Called at runtime before returning to the tRPC client.
 *
 * G-REGISTRY-ONLY: throws if any field is not in _METRIC_COLUMNS or KPI_FIELDS_TO_DEFINITION_ID.
 * Mutant probe: add an orphan `reduce` field to the row → this function throws.
 */
export function assertKpiRegistryTraceability(row: KpiSummaryRow): void {
  // Check numeric fields in the response map to a known registry id or column.
  const fieldNames = Object.keys(row).filter(
    (k) => !['workspace_id', 'period', 'data_epoch', 'currency_code'].includes(k),
  );

  for (const field of fieldNames) {
    const isInColumns = _METRIC_COLUMNS.has(field);
    const isInKpiMap = field in KPI_FIELDS_TO_DEFINITION_ID;

    if (!isInColumns && !isInKpiMap) {
      throw new Error(
        `G-REGISTRY-ONLY VIOLATION: KPI field "${field}" does not trace to any ` +
          `registry definition_id or _METRIC_COLUMNS entry. ` +
          `CF-C6-REGISTRY-ONLY-BFF-1. No ad-hoc derived fields in the BFF.`,
      );
    }
  }
}

/**
 * Validate that a PnlWaterfallRow's definition_id is a known registry metric.
 */
export function assertWaterfallDefinitionId(step: PnlWaterfallRow): void {
  const isKnown =
    PNL_WATERFALL_DEFINITION_IDS.includes(step.definition_id as (typeof PNL_WATERFALL_DEFINITION_IDS)[number]) ||
    step.definition_id in METRIC_REGISTRY;

  if (!isKnown) {
    throw new Error(
      `G-REGISTRY-ONLY VIOLATION: P&L waterfall definition_id="${step.definition_id}" ` +
        `is not in the metric registry. CF-C6-REGISTRY-ONLY-BFF-1.`,
    );
  }
}

/**
 * Validate that every money field on a PnlStatementRow traces to a registry definition_id.
 * Phase-2 slice-2 (feat-pnl-cm-waterfall). G-REGISTRY-ONLY: no ad-hoc derived P&L line.
 * Mutant probe: add an orphan `gross_margin_pct` field → this throws.
 */
export function assertPnlStatementTraceability(row: PnlStatementRow): void {
  const nonMetricFields = ['workspace_id', 'period', 'data_epoch', 'currency_code', 'order_count'];
  const fieldNames = Object.keys(row).filter((k) => !nonMetricFields.includes(k));
  const allowed = new Set<string>(PNL_STATEMENT_DEFINITION_IDS);

  for (const field of fieldNames) {
    if (!allowed.has(field) && !(field in METRIC_REGISTRY)) {
      throw new Error(
        `G-REGISTRY-ONLY VIOLATION: P&L statement field "${field}" does not trace to ` +
          `any registry definition_id. CF-C6-REGISTRY-ONLY-BFF-1. No ad-hoc P&L lines.`,
      );
    }
  }
}

// STORE_LADDER_DEFINITION_IDS: the ordered registry ids for the /store revenue ladder.
// Phase-2 slice-1 (feat-store-order-fact-layer). Each MUST trace to a registry def.
export const STORE_LADDER_DEFINITION_IDS = [
  'gross_sales_mu',
  'net_sales_mu',
  'net_net_tax_mu',
  'net_revenue_mu',
  'realized_revenue_mu',
] as const;

/**
 * Validate that a store revenue-ladder step's definition_id is a known registry metric.
 * CF-C6-REGISTRY-ONLY-BFF-1: no ad-hoc derived rung in the BFF.
 * Mutant probe: a step with definition_id "foo_mu" → this throws.
 */
export function assertLadderDefinitionId(step: StoreRevenueLadderStep): void {
  const isKnown =
    STORE_LADDER_DEFINITION_IDS.includes(
      step.definition_id as (typeof STORE_LADDER_DEFINITION_IDS)[number],
    ) || step.definition_id in METRIC_REGISTRY;

  if (!isKnown) {
    throw new Error(
      `G-REGISTRY-ONLY VIOLATION: store ladder definition_id="${step.definition_id}" ` +
        `is not in the metric registry. CF-C6-REGISTRY-ONLY-BFF-1.`,
    );
  }
}

// LOGISTICS_DEFINITION_IDS: registry ids that appear on the slice-3 logistics surfaces.
// Phase-2 slice-3 (feat-rto-cod-economics). Every money/ratio/score field on the RTO / COD /
// logistics / pincode results must trace to one of these (CF-C6-REGISTRY-ONLY-BFF-1).
export const LOGISTICS_DEFINITION_IDS = [
  'rto_rate_bp',
  'rto_cost_mu',
  'rto_revenue_lost_mu',
  'cod_realization_rate_bp',
  'prepaid_rate_bp',
  'breakeven_cod_rto_rate_bp',
  'pincode_reliability_score',
  'aov_mu',
] as const;

/**
 * Validate that a logistics definition_id is a known registry metric.
 * CF-C6-REGISTRY-ONLY-BFF-1: no ad-hoc derived logistics field in the BFF.
 * Mutant probe: an id "foo_mu" → this throws.
 */
export function assertLogisticsDefinitionId(definitionId: string): void {
  const isKnown =
    LOGISTICS_DEFINITION_IDS.includes(definitionId as (typeof LOGISTICS_DEFINITION_IDS)[number]) ||
    definitionId in METRIC_REGISTRY;
  if (!isKnown) {
    throw new Error(
      `G-REGISTRY-ONLY VIOLATION: logistics definition_id="${definitionId}" ` +
        `is not in the metric registry. CF-C6-REGISTRY-ONLY-BFF-1.`,
    );
  }
}

// MARKETING_DEFINITION_IDS: registry ids on the slice-4 marketing surfaces.
// Phase-2 slice-4 (feat-marketing-acquisition). aMER uses acquisition-classified spend;
// ROAS/ACOS are display_only; pamer_bp is DECOMMISSIONED (must NOT appear here).
export const MARKETING_DEFINITION_IDS = [
  'mer_bp',
  'amer_bp',
  'cac_mu',
  'cm2_per_nc_mu',
  'new_customer_revenue_mu',
  'nc_cm2_mu',
  'acquisition_ad_spend_mu',
  'total_ad_spend_mu',
  'net_revenue_mu',
  'aov_mu',
  'acos_bp',
  'blended_roas_x100',
] as const;

/**
 * Validate that a marketing definition_id is a known registry metric.
 * CF-C6-REGISTRY-ONLY-BFF-1: no ad-hoc derived marketing field in the BFF.
 * Mutant probe: id "pamer_bp" (decommissioned) or "foo_mu" → this throws.
 */
export function assertMarketingDefinitionId(definitionId: string): void {
  const isKnown =
    MARKETING_DEFINITION_IDS.includes(definitionId as (typeof MARKETING_DEFINITION_IDS)[number]) ||
    definitionId in METRIC_REGISTRY;
  if (!isKnown) {
    throw new Error(
      `G-REGISTRY-ONLY VIOLATION: marketing definition_id="${definitionId}" ` +
        `is not in the metric registry. CF-C6-REGISTRY-ONLY-BFF-1.`,
    );
  }
}

// COHORT_LTV_DEFINITION_IDS: registry ids on the slice-5 cohorts + LTV surfaces.
// Phase-2 slice-5 (feat-cohorts-ltv). cohort_ltv_mu feeds ltv_cac_bp (cumulative CM3, not CM2);
// repeat_rate_bp covers rr90 + LTV repeat_rate; the phantom cac_payback_months is DECOMMISSIONED
// (must NOT appear here — the real payback is use-case computed, not a registry metric).
export const COHORT_LTV_DEFINITION_IDS = [
  'cac_mu',
  'cohort_ltv_mu',
  'ltv_cac_bp',
  'repeat_rate_bp',
  'cm2_mu',
  'cm3_mu',
] as const;

/**
 * Validate that a cohorts/LTV definition_id is a known registry metric.
 * CF-C6-REGISTRY-ONLY-BFF-1: no ad-hoc derived cohort/LTV field in the BFF.
 * Mutant probe: id "cac_payback_months" (decommissioned phantom) or "foo_mu" → this throws.
 */
export function assertCohortLtvDefinitionId(definitionId: string): void {
  const isKnown =
    COHORT_LTV_DEFINITION_IDS.includes(definitionId as (typeof COHORT_LTV_DEFINITION_IDS)[number]) ||
    definitionId in METRIC_REGISTRY;
  if (!isKnown) {
    throw new Error(
      `G-REGISTRY-ONLY VIOLATION: cohort/ltv definition_id="${definitionId}" ` +
        `is not in the metric registry. CF-C6-REGISTRY-ONLY-BFF-1.`,
    );
  }
}

/**
 * Look up a MetricDefinition by id. Returns undefined for count metrics (no registry entry).
 */
export function getMetricDefinition(id: string): MetricDefinition | undefined {
  return METRIC_REGISTRY[id];
}

/**
 * Get the display scale for a metric id.
 * CF-C6-ROAS-DISPLAY-CONTRACT-1: blended_roas_x100 → scale=100, _bp → scale=10000, _mu/count → scale=1.
 * The display layer uses: displayValue = rawValue / scale.
 */
export function getMetricScale(id: string): 10000 | 100 | 1 {
  const def = METRIC_REGISTRY[id];
  if (!def) return 1; // count metrics
  if (def.unit === 'bp') return 10000;
  if (def.unit === 'x100') return 100;
  return 1; // mu or count
}

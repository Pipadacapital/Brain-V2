// @paradigm: sql
// LocalDbDataPlane (Slice E) — serves a CONNECTED + SYNCED non-Sugandh workspace its
// OWN ingested connector facts (persona P-001), reading via core-service under
// withWorkspace + FORCE RLS (persona P-003). Re-sync is idempotent at the aggregate
// layer because every fact table is keyed on a UNIQUE business key (persona P-002).
//
// It EXTENDS StubDataPlane keyed to the target workspace so the full DataPlanePort
// surface is satisfied with ONE class, and OVERRIDES only the surfaces slice E feeds
// with real data: store summary + revenue ladder, KPI strip, P&L statement, CM
// waterfall, marketing efficiency, acquisition. Every OTHER surface returns an HONEST
// EMPTY result for a real workspace — NEVER the Sugandh seed, NEVER a fabricated
// number (canon acceptance bar + CF-S10-HONEST-STATE-1). Surfaces fed by connectors
// later (RTO/COD/pincode need Shiprocket; cohorts/LTV/products need deeper facts) are
// honestly empty until those connectors land — stated in the slice-E deferrals.

import { readStoreSummary, readPnl, readMarketing } from '@brain/core-connectors';
import type {
  DataPlanePort,
  KpiSummaryRow,
  PnlWaterfallRow,
  PnlStatementRow,
  StoreSummaryRow,
  StoreRevenueLadderStep,
  DateRange,
  MarketingEfficiencyResult,
  AcquisitionSummaryResult,
  MetricRow,
} from '../domain/proto-types.js';
import { StubDataPlane, InMemoryDecisionLog, DATA_EPOCH } from './loopback-data-plane.js';
import {
  emptyRtoAnalytics,
  emptyCodPrepaid,
  emptyLogistics,
  emptyPincode,
  emptyDistributions,
  emptyCohortMatrix,
  emptyLtvSummary,
  emptyProductPerformance,
  emptyInventoryLevels,
  emptyFirstProductCascade,
  emptyGoalAttainment,
  emptyCostStack,
  emptyFestivalCalendar,
  emptyCalendarReport,
  emptyLifecycleStates,
  emptyOrderTimings,
  emptyEmailSmsPerformance,
} from './empty-results.js';

/** Integer basis-points helper (no float): ratio of a/b in bp, or null on zero denom. */
function bp(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  return Number((numerator * 10000n) / denominator);
}

export class LocalDbDataPlane extends StubDataPlane implements DataPlanePort {
  private readonly ws: string;

  constructor(workspaceId: string) {
    // Key the base StubDataPlane to THIS workspace so the inherited tenancy guard
    // (workspace_id === this.workspaceId) passes for the overridden methods.
    super(new InMemoryDecisionLog(), workspaceId);
    this.ws = workspaceId;
  }

  private assertWs(workspace_id: string): void {
    if (!workspace_id || workspace_id !== this.ws) {
      throw new Error(`UnscopedQueryError: workspace_id=${workspace_id} not authorized`);
    }
  }

  // ---- FED BY CONNECTOR INGESTION (real data) --------------------------------

  override async getStoreSummary(params: { workspace_id: string; date_range: DateRange }): Promise<{
    summary: StoreSummaryRow;
    ladder: StoreRevenueLadderStep[];
    data_epoch: Date;
  }> {
    this.assertWs(params.workspace_id);
    const f = await readStoreSummary(this.ws);
    const summary: StoreSummaryRow = {
      workspace_id: this.ws,
      period: 'synced',
      data_epoch: DATA_EPOCH,
      currency_code: f.currencyCode,
      gross_sales_mu: f.grossSalesMu,
      total_discount_mu: f.totalDiscountMu,
      net_sales_mu: f.netSalesMu,
      total_tax_mu: f.totalTaxMu,
      net_net_tax_mu: f.netNetTaxMu,
      shipping_revenue_mu: f.shippingRevenueMu,
      net_revenue_mu: f.netRevenueMu,
      realized_revenue_mu: f.realizedRevenueMu,
      order_count: f.orderCount,
      aov_mu: f.aovMu,
    };
    const ladder: StoreRevenueLadderStep[] = [
      { definition_id: 'gross_sales_mu', label: 'Gross Sales', value_mu: f.grossSalesMu },
      { definition_id: 'net_sales_mu', label: 'Net Sales', value_mu: f.netSalesMu },
      { definition_id: 'net_net_tax_mu', label: 'Net of Tax', value_mu: f.netNetTaxMu },
      { definition_id: 'net_revenue_mu', label: 'Net Revenue', value_mu: f.netRevenueMu },
      { definition_id: 'realized_revenue_mu', label: 'Realized Revenue', value_mu: f.realizedRevenueMu },
    ];
    return { summary, ladder, data_epoch: DATA_EPOCH };
  }

  override async getKpiSummary(params: { workspace_id: string; date_range: DateRange }): Promise<{
    summary: KpiSummaryRow;
    data_epoch: Date;
  }> {
    this.assertWs(params.workspace_id);
    const store = await readStoreSummary(this.ws);
    const mk = await readMarketing(this.ws);
    // CM2 = realized revenue − ad spend (COGS/variable not yet connector-fed → honest 0).
    const totalSpend = mk.metaSpendMu + mk.googleSpendMu;
    const cm2 = store.realizedRevenueMu - totalSpend;
    const summary: KpiSummaryRow = {
      workspace_id: this.ws,
      period: 'synced',
      data_epoch: DATA_EPOCH,
      currency_code: store.currencyCode,
      net_revenue_mu: store.realizedRevenueMu,
      cm2_mu: cm2,
      cm3_mu: cm2,
      rto_rate_bp: null,
      blended_roas_x100: totalSpend > 0n ? Number((store.realizedRevenueMu * 100n) / totalSpend) : null,
      total_orders: store.orderCount,
      aov_mu: store.aovMu === null ? null : Number(store.aovMu),
      conversion_rate_bp: null,
    };
    return { summary, data_epoch: DATA_EPOCH };
  }

  override async getPnlStatement(params: { workspace_id: string; date_range: DateRange }): Promise<{
    statement: PnlStatementRow;
    data_epoch: Date;
  }> {
    this.assertWs(params.workspace_id);
    const f = await readPnl(this.ws);
    // COGS / variable costs are not yet ingested by a connector → 0 (honest); the P&L
    // therefore shows realized revenue − ad spend = CM2. Stated as a slice-E deferral.
    const netRevenue = f.netRevenueMu;
    const cogs = 0n;
    const variable = 0n;
    const cm1 = netRevenue - cogs - variable;
    const cm2 = cm1 - f.totalAdSpendMu;
    const cm3 = cm2; // no prorated overheads ingested
    const statement: PnlStatementRow = {
      workspace_id: this.ws,
      period: 'synced',
      data_epoch: DATA_EPOCH,
      currency_code: f.currencyCode,
      net_revenue_mu: netRevenue,
      cogs_mu: cogs,
      variable_costs_mu: variable,
      cm1_mu: cm1,
      total_ad_spend_mu: f.totalAdSpendMu,
      cm2_mu: cm2,
      misc_expenses_prorated_mu: 0n,
      cm3_mu: cm3,
      true_cm2_mu: f.orderCount > 0n ? cm2 : null,
      order_count: f.orderCount,
    };
    return { statement, data_epoch: DATA_EPOCH };
  }

  override async getCmWaterfall(params: { workspace_id: string; date_range: DateRange }): Promise<{
    steps: PnlWaterfallRow[];
    data_epoch: Date;
  }> {
    this.assertWs(params.workspace_id);
    const f = await readPnl(this.ws);
    const head = f.netRevenueMu;
    const cm1 = head; // no COGS/variable ingested
    const cm2 = cm1 - f.totalAdSpendMu;
    const epoch = DATA_EPOCH;
    const c = f.currencyCode;
    const steps: PnlWaterfallRow[] = [
      { definition_id: 'net_revenue_mu', label: 'Realized Revenue', value_mu: head, cumulative_mu: head, currency_code: c, data_epoch: epoch },
      { definition_id: 'cm1_mu', label: 'CM1 (Gross Contribution)', value_mu: cm1, cumulative_mu: cm1, currency_code: c, data_epoch: epoch },
      { definition_id: 'total_ad_spend_mu', label: 'Ad Spend', value_mu: -f.totalAdSpendMu, cumulative_mu: cm2, currency_code: c, data_epoch: epoch },
      { definition_id: 'cm2_mu', label: 'CM2 (After Ads)', value_mu: cm2, cumulative_mu: cm2, currency_code: c, data_epoch: epoch },
    ];
    return { steps, data_epoch: epoch };
  }

  override async getPnlWaterfall(params: { workspace_id: string; date_range: DateRange }): Promise<{
    steps: PnlWaterfallRow[];
    data_epoch: Date;
  }> {
    // ONE source of truth (Single-Primitive): delegate to getCmWaterfall.
    return this.getCmWaterfall(params);
  }

  override async getMarketingEfficiency(params: { workspace_id: string; date_range: DateRange }): Promise<{
    result: MarketingEfficiencyResult;
    data_epoch: Date;
  }> {
    this.assertWs(params.workspace_id);
    const m = await readMarketing(this.ws);
    const totalSpend = m.metaSpendMu + m.googleSpendMu;
    const result: MarketingEfficiencyResult = {
      workspace_id: this.ws,
      period: 'synced',
      data_epoch: DATA_EPOCH,
      currency_code: m.currencyCode,
      net_revenue_mu: m.netRevenueMu,
      total_ad_spend_mu: totalSpend,
      new_customer_revenue_mu: m.newCustomerRevenueMu,
      acquisition_ad_spend_mu: totalSpend, // all spend treated as acquisition until campaign tagging lands
      meta_spend_mu: m.metaSpendMu,
      google_spend_mu: m.googleSpendMu,
      mer_bp: bp(m.netRevenueMu, totalSpend),
      amer_bp: bp(m.newCustomerRevenueMu, totalSpend),
      acos_bp: bp(totalSpend, m.netRevenueMu),
      blended_roas_x100: totalSpend > 0n ? Number((m.netRevenueMu * 100n) / totalSpend) : null,
    };
    return { result, data_epoch: DATA_EPOCH };
  }

  override async getAcquisitionSummary(params: { workspace_id: string; date_range: DateRange }): Promise<{
    result: AcquisitionSummaryResult;
    data_epoch: Date;
  }> {
    this.assertWs(params.workspace_id);
    const m = await readMarketing(this.ws);
    const totalSpend = m.metaSpendMu + m.googleSpendMu;
    const ncCm2 = m.newCustomerRevenueMu - totalSpend;
    const result: AcquisitionSummaryResult = {
      workspace_id: this.ws,
      period: 'synced',
      data_epoch: DATA_EPOCH,
      currency_code: m.currencyCode,
      new_customers_count: m.newCustomersCount,
      nc_cm2_mu: ncCm2,
      new_customer_revenue_mu: m.newCustomerRevenueMu,
      total_ad_spend_mu: totalSpend,
      acquisition_ad_spend_mu: totalSpend,
      meta_spend_mu: m.metaSpendMu,
      google_spend_mu: m.googleSpendMu,
      cac_mu: m.newCustomersCount > 0n ? totalSpend / m.newCustomersCount : null,
      cm2_per_nc_mu: m.newCustomersCount > 0n ? ncCm2 / m.newCustomersCount : null,
      amer_bp: bp(m.newCustomerRevenueMu, totalSpend),
      daily: [],
    };
    return { result, data_epoch: DATA_EPOCH };
  }

  override async queryMetrics(params: {
    workspace_id: string;
    definition_ids: string[];
    date_range: DateRange;
    cursor?: string;
    page_size?: number;
  }): Promise<{ rows: MetricRow[]; data_epoch: Date; next_cursor: string }> {
    this.assertWs(params.workspace_id);
    // Daily metric rows are not connector-fed in slice E → honest empty series.
    return { rows: [], data_epoch: DATA_EPOCH, next_cursor: '' };
  }

  // ---- NOT YET FED BY CONNECTORS → HONEST EMPTY (never the Sugandh seed) ------

  override async getRtoAnalytics(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyRtoAnalytics(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getCodPrepaid(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyCodPrepaid(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getLogistics(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyLogistics(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getPincodeIntelligence(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyPincode(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getDistributions(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyDistributions(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getCohortMatrix(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyCohortMatrix(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getLtvSummary(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyLtvSummary(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getProductPerformance(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyProductPerformance(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getInventoryLevels(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyInventoryLevels(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getFirstProductCascade(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyFirstProductCascade(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getGoalAttainment(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyGoalAttainment(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getCostStack(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyCostStack(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getFestivalCalendar(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyFestivalCalendar(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getCalendarReport(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyCalendarReport(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getLifecycleStates(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyLifecycleStates(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getOrderTimings(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyOrderTimings(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getEmailSmsPerformance(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyEmailSmsPerformance(this.ws), data_epoch: DATA_EPOCH };
  }
}

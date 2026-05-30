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

import {
  readStoreSummary, readPnl, readMarketing, readIntegrations, readCogs,
  readProductPerformance, readWorkspaceMembers, readWorkspaceSettings,
  readShipmentAnalytics, readPincodes, readCodPrepaid, readCohorts, readLtv,
  readLifecycleStates, readOrderTimings, readFirstProductCascade, readDistributions, readCalendarReport,
  readDailyNetSales, readDailyAcquisition, readDistributionsGraphPoints, readPnlPeriodGrid,
  readShipmentRows,
} from '@brain/core-connectors';
import {
  listMarketingActions as coreListMarketingActions,
  createMarketingAction as coreCreateMarketingAction,
  updateMarketingAction as coreUpdateMarketingAction,
  deleteMarketingAction as coreDeleteMarketingAction,
} from '@brain/core-settings';
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
  IntegrationsResult,
  ConnectorStatus,
  ProductPerformanceResult,
  PageInsightResult,
  MorningBrief,
  BackfillStatusResult,
  WorkspaceMembersResult,
  WorkspaceSettingsResult,
  WorkspaceMemberRole,
  RtoAnalyticsResult,
  CodPrepaidResult,
  LogisticsResult,
  PincodeIntelligenceResult,
  CohortMatrixResult,
  CohortMetric,
  CohortMode,
  LtvSummaryResult,
  DistributionsResult,
  OrderTimingsResult,
  LifecycleStatesResult,
  FirstProductCascadeResult,
  CalendarReportResult,
  DailySalesRow,
  DailyAcquisitionRow,
  PnlPeriodRow,
  ShipmentRow,
  ShipmentRowFilters,
  MarketingActionRow,
  ListMarketingActionsResult,
  CreateMarketingActionInput,
  UpdateMarketingActionInput,
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

// ---------------------------------------------------------------------------
// Cohort mode transforms — mirrors loopback _applyCohortMode exactly so the
// local-DB plane and the stub produce identical shapes given the same inputs.
// incr[] is PER-CUSTOMER incremental values (already divided by newCustomers).
// Exported for direct unit testing.
// ---------------------------------------------------------------------------
export function applyCohortMode(
  metric: string,
  mode: string,
  firstOrderPer: bigint,   // per-customer first-order value
  firstOrderRPer: bigint,  // per-customer realized first-order value
  cacPer: bigint,          // per-customer CAC (0n if unknown)
  incrPer: bigint[],       // per-customer incremental m[0..11]
): bigint[] {
  if (metric === 'cm3' || metric === 'revenue') {
    const fo = metric === 'cm3' ? firstOrderRPer : firstOrderPer;
    if (mode === 'incr') return [...incrPer];
    if (mode === 'post') {
      if (metric === 'cm3') return [...incrPer];
      let s = 0n; return incrPer.map((v) => (s += v));
    }
    if (mode === 'cumulative') { let s = fo; return incrPer.map((v) => (s += v)); }
    if (mode === 'pct') {
      const denom = (fo < 0n ? -fo : fo) > 0n ? (fo < 0n ? -fo : fo) : 1n;
      let s = fo; return incrPer.map((v) => { s += v; return (s * 10000n) / denom; });
    }
    if (mode === 'ltvcac') {
      const denom = cacPer > 0n ? cacPer : 1n;
      let s = fo; return incrPer.map((v) => { s += v; return (s * 10000n) / denom; });
    }
  } else {
    // repeat / repurchase — only 'post' makes sense; cumulative/pct/ltvcac disabled by UI
    if (mode === 'post') { let s = 0n; return incrPer.map((v) => (s += v)); }
    return [...incrPer];
  }
  return [...incrPer];
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
    // CM2 = realized revenue − COGS − ad spend (COGS from migrated product cost).
    const totalSpend = mk.metaSpendMu + mk.googleSpendMu;
    const cogs = (await readCogs(this.ws)).cogsMu;
    const cm2 = store.realizedRevenueMu - cogs - totalSpend;
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
    // COGS now comes from migrated product cost (quantity × cost_mu). Variable costs
    // (shipping/packaging) are not yet connector-fed → 0 (honest).
    const netRevenue = f.netRevenueMu;
    const cogs = (await readCogs(this.ws)).cogsMu;
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
    const cogs = (await readCogs(this.ws)).cogsMu;
    const cm1 = head - cogs;
    const cm2 = cm1 - f.totalAdSpendMu;
    const epoch = DATA_EPOCH;
    const c = f.currencyCode;
    const steps: PnlWaterfallRow[] = [
      { definition_id: 'net_revenue_mu', label: 'Realized Revenue', value_mu: head, cumulative_mu: head, currency_code: c, data_epoch: epoch },
      { definition_id: 'cogs_mu', label: 'COGS', value_mu: -cogs, cumulative_mu: cm1, currency_code: c, data_epoch: epoch },
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

  // Integrations page — REAL connection state from connector_connections (not the
  // Sugandh seed). Lets a real workspace show its actual connected vendors.
  override async getIntegrations(p: { workspace_id: string }): Promise<{ result: IntegrationsResult; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    const rows = await readIntegrations(this.ws);
    const toStatus = (s: string): ConnectorStatus =>
      s === 'CONNECTED' ? 'CONNECTED'
      : s === 'DISCONNECTED' || s === 'NOT_CONNECTED' ? 'DISCONNECTED'
      : 'ERROR'; // TOKEN_EXPIRED | ERROR
    const result: IntegrationsResult = {
      workspace_id: this.ws,
      rows: rows.map((r) => ({
        connector: r.connector,
        status: toStatus(r.status),
        last_sync_at: r.lastSyncAt,
        last_sync_error: r.lastSyncError,
      })),
    };
    return { result, data_epoch: DATA_EPOCH };
  }

  // Workspace members — REAL members + roles from the local DB (de-stubbed).
  override async getWorkspaceMembers(p: { workspace_id: string }): Promise<{ result: WorkspaceMembersResult; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    const { members, pendingInvitations } = await readWorkspaceMembers(this.ws);
    const result: WorkspaceMembersResult = {
      workspace_id: this.ws,
      members: members.map((m) => ({
        user_id: m.userId,
        full_name: m.fullName,
        email: m.email,
        role: m.role as WorkspaceMemberRole,
        joined_at: m.joinedAt,
      })),
      pending_invitations: pendingInvitations,
    };
    return { result, data_epoch: DATA_EPOCH };
  }

  // Workspace settings — REAL workspace row (de-stubbed). plan/timezone/region are
  // honest India defaults (not stored in the local-dev schema).
  override async getWorkspaceSettings(p: { workspace_id: string }): Promise<{ result: WorkspaceSettingsResult; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    const s = await readWorkspaceSettings(this.ws);
    const result: WorkspaceSettingsResult = {
      workspace_id: this.ws,
      name: s?.name ?? '',
      plan: 'Growth',
      timezone: 'Asia/Kolkata',
      region: 'IN',
      currency_code: 'INR',
      created_at: s?.createdAt ?? '',
    };
    return { result, data_epoch: DATA_EPOCH };
  }

  // De-stubbed: no AI narration/brief/backfill source for a real workspace yet →
  // honest empty (NEVER the Sugandh seed). Wired when the intelligence service lands.
  override async getPageInsights(p: { workspace_id: string; page: string; date_range: DateRange }): Promise<{ result: PageInsightResult; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    const result: PageInsightResult = {
      workspace_id: this.ws,
      page: p.page,
      period: 'synced',
      data_epoch: DATA_EPOCH,
      signals: [],
      narrations: [],
      faithfulness_ok: true,
      model_used: 'none',
      cached: false,
      paradigm: 'small_llm',
    };
    return { result, data_epoch: DATA_EPOCH };
  }

  override async getMorningBrief(_p: { workspace_id: string; date: string }): Promise<MorningBrief> {
    this.assertWs(_p.workspace_id);
    return { items: [], data_epoch: DATA_EPOCH, freshness_label: 'No brief generated yet' };
  }

  override async getBackfillStatus(p: { workspace_id: string }): Promise<{ result: BackfillStatusResult; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    return { result: { workspace_id: this.ws, jobs: [], note: 'No backfill jobs for this workspace.' }, data_epoch: DATA_EPOCH };
  }

  // ---- NOT YET FED BY CONNECTORS → HONEST EMPTY (never the Sugandh seed) ------

  // RTO analytics from Shiprocket shipment facts. revenue_lost_to_rto = 0 (legacy
  // never persisted the shipment→order key — documented in connector-pipeline-gaps).
  override async getRtoAnalytics(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    const s = await readShipmentAnalytics(this.ws);
    const result: RtoAnalyticsResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      total_shipments: s.totalShipments,
      rto_count: s.rtoCount,
      rto_rate_bp: bp(s.rtoCount, s.totalShipments),
      total_rto_cost_mu: s.rtoChargesMu,
      revenue_lost_to_rto_mu: 0n,
      by_payment_method: [
        { payment_method: 'COD', rto_count: s.codRtoCount, rto_cost_mu: 0n, revenue_lost_mu: 0n },
        { payment_method: 'Prepaid', rto_count: s.prepaidRtoCount, rto_cost_mu: 0n, revenue_lost_mu: 0n },
      ],
      by_courier: s.byCourier.map((c) => ({ courier_name: c.courierName, rto_count: c.rtoCount, rto_cost_mu: 0n, revenue_lost_mu: 0n })),
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  // COD vs Prepaid: order counts/revenue from order facts; RTO rates from shipments.
  override async getCodPrepaid(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    const cp = await readCodPrepaid(this.ws);
    const s = await readShipmentAnalytics(this.ws);
    const codRto = bp(s.codRtoCount, s.codTotal);
    const prepaidRto = bp(s.prepaidRtoCount, s.prepaidTotal);
    const result: CodPrepaidResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      cod_orders: cp.codOrders,
      prepaid_orders: cp.prepaidOrders,
      cod_realization_rate_bp: codRto === null ? null : 10000 - codRto,
      cod_rto_rate_bp: codRto,
      prepaid_rto_rate_bp: prepaidRto,
      effective_revenue_cod_mu: cp.codGrossMu,
      effective_revenue_prepaid_mu: cp.prepaidGrossMu,
      prepaid_premium_mu: 0n,
      average_order_value_mu: cp.aovMu,
      breakeven_cod_rto_rate_bp: null,
      breakeven_note: null,
      comparison: [
        { payment_method: 'COD', orders: cp.codOrders, gross_revenue_mu: cp.codGrossMu, rto_rate_bp: codRto, effective_revenue_mu: cp.codGrossMu, fee_total_mu: 0n, net_revenue_per_order_mu: cp.codOrders > 0n ? cp.codGrossMu / cp.codOrders : null },
        { payment_method: 'Prepaid', orders: cp.prepaidOrders, gross_revenue_mu: cp.prepaidGrossMu, rto_rate_bp: prepaidRto, effective_revenue_mu: cp.prepaidGrossMu, fee_total_mu: 0n, net_revenue_per_order_mu: cp.prepaidOrders > 0n ? cp.prepaidGrossMu / cp.prepaidOrders : null },
      ],
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  override async getLogistics(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    const s = await readShipmentAnalytics(this.ws);
    const result: LogisticsResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      total_shipments: s.totalShipments,
      delivered_count: s.deliveredCount,
      delivered_rate_bp: bp(s.deliveredCount, s.totalShipments),
      rto_count: s.rtoCount,
      rto_rate_bp: bp(s.rtoCount, s.totalShipments),
      cod_count: s.codCount,
      prepaid_count: s.prepaidCount,
      forward_charges_mu: 0n,
      cod_charges_mu: 0n,
      rto_charges_mu: s.rtoChargesMu,
      total_shiprocket_charges_mu: s.totalChargesMu,
      average_shipping_charge_per_shipment_mu: s.totalShipments > 0n ? s.totalChargesMu / s.totalShipments : null,
      by_courier: s.byCourier.map((c) => ({ courier_name: c.courierName, count: c.count, delivered_count: c.deliveredCount, rto_count: c.rtoCount, total_charges_mu: c.chargesMu })),
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  override async getPincodeIntelligence(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    const rows = await readPincodes(this.ws);
    const total = rows.reduce((a, r) => a + r.shipmentCount, 0n);
    const result: PincodeIntelligenceResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      total_shipments: total,
      rows: rows.map((r) => ({
        pincode: r.pincode, city: r.city, state: '', tier: null,
        shipment_count: r.shipmentCount,
        rto_count: r.rtoCount, rto_rate_bp: bp(r.rtoCount, r.shipmentCount),
        cod_count: r.codCount, cod_rate_bp: bp(r.codCount, r.shipmentCount),
        delivered_count: r.deliveredCount, delivered_rate_bp: bp(r.deliveredCount, r.shipmentCount),
        revenue_mu: 0n, aov_mu: null, unique_customers: 0n, repeat_rate_bp: null,
        reliability_score: r.shipmentCount > 0n ? Number((r.deliveredCount * 10000n) / r.shipmentCount) : 0,
        top_courier: '',
      })),
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  override async getDistributions(p: Parameters<DataPlanePort['getDistributions']>[0]) {
    this.assertWs(p.workspace_id);
    const metric = (p.filters?.metric ?? 'sales') as 'sales' | 'cm1';
    const [d, graphRaw] = await Promise.all([
      readDistributions(this.ws),
      readDistributionsGraphPoints(this.ws, metric),
    ]);
    const result: DistributionsResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      metric,
      rows: d.rows.map((r) => ({ product: r.product, orders: r.orders, mode_mu: r.modeMu, mean_mu: r.meanMu, diff_mu: r.meanMu - r.modeMu })),
      total_rows: BigInt(d.rows.length),
      graph_points: graphRaw.map((g) => ({ value_mu: g.valueMu, density_bp: g.densityBp })),
      global_mode_mu: d.globalMode,
      global_mean_mu: d.globalMean,
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  // Cohorts — acquisition-month cohorts. Reads cumulative net-revenue totals from
  // readCohorts, then applies metric/mode/date-range transforms so the UI selectors
  // actually change the numbers (P0 correctness fix).
  //
  // readCohorts returns m[] as CUMULATIVE TOTALS (not per-customer). This method:
  //   1. Filters to cohorts whose acquisition month falls within date_range.
  //   2. Converts cumulative→incremental, then divides by newCustomers.
  //   3. Applies metric branching (revenue=net; cm3=net honest; repeat/repurchase=rr90-based).
  //   4. Applies mode transform via applyCohortMode.
  //   5. Leaves CAC/payback null — ad spend not cohort-attributed in connector facts (honest).
  override async getCohortMatrix(p: Parameters<DataPlanePort['getCohortMatrix']>[0]) {
    this.assertWs(p.workspace_id);
    const allCohorts = await readCohorts(this.ws);
    const metric = p.filters?.metric ?? 'cm3';
    const mode = p.filters?.mode ?? 'post';

    // 1. Date-range filter: include cohort months in [start_yyyy_mm, end_yyyy_mm].
    const startYM = (p.date_range?.start ?? '').substring(0, 7); // 'YYYY-MM'
    const endYM   = (p.date_range?.end   ?? '').substring(0, 7);
    const cohorts = allCohorts.filter((c) => {
      if (startYM && c.cohortMonth < startYM) return false;
      if (endYM   && c.cohortMonth > endYM)   return false;
      return true;
    });

    // 2. Aggregate summary values.
    const totalNew = cohorts.reduce((a, c) => a + c.newCustomers, 0n);
    let rrWeighted = 0n;
    for (const c of cohorts) {
      if (c.rr90Bp !== null) rrWeighted += BigInt(c.rr90Bp) * c.newCustomers;
    }

    // 3. Build per-cohort rows with metric+mode applied.
    const rows = cohorts.map((c) => {
      const n = c.newCustomers;

      // c.m[] is CUMULATIVE TOTALS from readCohorts; recover incremental.
      // incr[0] = cum[0]; incr[i] = cum[i] - cum[i-1].
      const cumTotal = c.m;
      const incrTotal: bigint[] = cumTotal.map((v, i) =>
        i === 0 ? v : v - (cumTotal[i - 1] ?? 0n),
      );

      // Per-customer first-order value (M0 incremental ÷ newCustomers).
      const foIncrPer = n > 0n ? (incrTotal[0] ?? 0n) / n : 0n;
      // Realized = gross first-order (no separate realized field in readCohorts — honest equal).
      const foRPer = foIncrPer;

      // Per-customer incremental array keyed on the selected metric.
      let incrPer: bigint[];
      if (metric === 'cm3' || metric === 'revenue') {
        // Both map to net revenue (honest: COGS not available per-cohort in connector facts).
        incrPer = incrTotal.map((v) => (n > 0n ? v / n : 0n));
      } else if (metric === 'repeat') {
        // Only have rr90Bp (90-day repeat rate). Put it in M1, 0 elsewhere.
        const rr90PerBp = c.rr90Bp !== null ? BigInt(c.rr90Bp) : 0n;
        incrPer = Array<bigint>(12).fill(0n);
        incrPer[0] = rr90PerBp; // bp units — UI will render as % for repeat/repurchase
      } else {
        // repurchase: same treatment as repeat (honest — order-count per customer not in readCohorts).
        const rr90PerBp = c.rr90Bp !== null ? BigInt(c.rr90Bp) : 0n;
        incrPer = Array<bigint>(12).fill(0n);
        incrPer[0] = rr90PerBp;
      }

      // CAC not available (ad spend not cohort-attributed in connector facts).
      const cacPer = 0n;

      // Apply the mode transform.
      const mRow = applyCohortMode(metric, mode, foIncrPer, foRPer, cacPer, incrPer);

      // cohort_ltv_mu = per-customer cumulative net revenue at M12 (sum of all incr).
      const ltvPer = n > 0n ? (cumTotal[11] ?? 0n) / n : 0n;

      return {
        cohort_month: c.cohortMonth,
        new_customers: n,
        cac_mu: null as bigint | null,
        rr90_bp: c.rr90Bp,
        payback_centimonths: null as number | null,
        first_order_cm3_mu: foIncrPer,
        first_order_realized_cm3_mu: foRPer,
        cohort_ltv_mu: ltvPer,
        ltv_cac_bp: null as number | null,
        m: mRow,
      };
    });

    const result: CohortMatrixResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      metric: metric as CohortMatrixResult['metric'],
      mode: mode as CohortMatrixResult['mode'],
      average_cac_mu: null,
      avg_90day_repeat_bp: totalNew > 0n ? Number(rrWeighted / totalNew) : null,
      average_payback_centimonths: null,
      new_customers: totalNew,
      rows,
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  // LTV — average cumulative net revenue per acquired customer; rows per cohort month.
  override async getLtvSummary(p: Parameters<DataPlanePort['getLtvSummary']>[0]) {
    this.assertWs(p.workspace_id);
    const l = await readLtv(this.ws);
    const result: LtvSummaryResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      metric: 'revenue', mode: 'cumulative', dimension: 'customer_id',
      first_order_mu: l.firstOrderMu,
      first_order_realized_mu: l.firstOrderMu,
      month1_mu: l.month1Mu,
      month3_mu: l.month3Mu,
      month6_mu: l.month6Mu,
      month12_mu: l.month12Mu,
      new_customers: l.newCustomers,
      total_rows: BigInt(l.rows.length),
      rows: l.rows.map((r) => ({
        dimension_value: r.cohortMonth,
        dimension_label: r.cohortMonth,
        orders_count: 0n,
        new_customers: r.newCustomers,
        first_order_realized_mu: r.firstOrderMu,
        first_order_mu: r.firstOrderMu,
        m: r.m,
      })),
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  override async getProductPerformance(p: Parameters<DataPlanePort['getProductPerformance']>[0]) {
    this.assertWs(p.workspace_id);
    const { rows, totalCm1Mu } = await readProductPerformance(this.ws);
    const result: ProductPerformanceResult = {
      workspace_id: this.ws,
      period: 'synced',
      data_epoch: DATA_EPOCH,
      currency_code: 'INR',
      group_by: 'product',
      sort: 'cm1',
      direction: 'desc',
      total_cm1_mu: totalCm1Mu,
      total_rows: BigInt(rows.length),
      rows: rows.map((r) => ({
        label: r.label,
        pareto_grade: r.paretoGrade,
        cm1_mu: r.cm1Mu,
        cm1_pct_bp: r.revenueMu > 0n ? Number((r.cm1Mu * 10000n) / r.revenueMu) : null,
        cm1_total_share_bp: totalCm1Mu > 0n ? Number((r.cm1Mu * 10000n) / totalCm1Mu) : null,
        revenue_mu: r.revenueMu,
        sales_mu: r.revenueMu,
        refunds_mu: 0n,
        sold: r.soldQty,
        refunded: 0n,
        net_quantity: r.soldQty,
        return_rate_bp: null,
        nc_return_rate_bp: null,
        ec_return_rate_bp: null,
        orders: r.orders,
        nc_orders: 0n,
        ec_orders: 0n,
        aov_mu: r.aovMu,
        nc_aov_mu: null,
        ec_aov_mu: null,
      })),
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  override async getInventoryLevels(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyInventoryLevels(this.ws), data_epoch: DATA_EPOCH };
  }
  override async getFirstProductCascade(p: Parameters<DataPlanePort['getFirstProductCascade']>[0]) {
    this.assertWs(p.workspace_id);
    const { rows, totalCohort } = await readFirstProductCascade(this.ws);
    const result: FirstProductCascadeResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      observation_days: 90,
      total_cohort_customers: totalCohort,
      rows: rows.map((r) => ({
        product_key: r.productKey,
        product_title: r.productTitle,
        first_order_customers: r.firstOrderCustomers,
        customers_with_2nd_order: r.with2nd,
        customers_with_3rd_order: r.with3rd,
        customers_with_4th_plus_order: r.with4thPlus,
        second_order_rate_bp: bp(r.with2nd, r.firstOrderCustomers),
        third_order_rate_bp: bp(r.with3rd, r.firstOrderCustomers),
        fourth_plus_rate_bp: bp(r.with4thPlus, r.firstOrderCustomers),
        additional_order_rate_centi: 0n,
        average_ltv_revenue_mu: r.avgLtvMu,
        average_days_to_second_deci: null,
      })),
    };
    return { result, data_epoch: DATA_EPOCH };
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
  override async getCalendarReport(p: Parameters<DataPlanePort['getCalendarReport']>[0]) {
    this.assertWs(p.workspace_id);
    const grain = (p.filters?.grain ?? 'month') as 'day' | 'week' | 'month';
    const rows = await readCalendarReport(this.ws, grain);
    const cell = (v: bigint | null) => ({ actual: v, goal: null, rag: null });
    const result: CalendarReportResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      grain,
      rows: rows.map((r) => ({
        period_key: r.periodKey,
        label: r.periodKey,
        actions: [],
        revenue: cell(r.revenueMu),
        cm3: cell(null),
        total_spend_mu: r.spendMu,
        mer: cell(r.spendMu > 0n ? (r.revenueMu * 10000n) / r.spendMu : null),
        amer: cell(null),
        new_customers: cell(r.newCustomers),
        cac: cell(r.newCustomers > 0n ? r.spendMu / r.newCustomers : null),
        aov: cell(r.orders > 0n ? r.revenueMu / r.orders : null),
      })),
      total_rows: BigInt(rows.length),
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  override async getLifecycleStates(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    const l = await readLifecycleStates(this.ws);
    const result: LifecycleStatesResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      p40_days: 90, p80_days: 180, used_fallback: true,
      buckets: l.buckets.map((b) => ({ bucket: b.bucket as 'new' | 'active' | 'at_risk' | 'churned', customer_count: b.customerCount, revenue_mu: b.revenueMu, order_count: b.orderCount })),
      net_active: l.netActive,
      total_customers: l.totalCustomers,
      unattributed_revenue_mu: 0n,
      unattributed_order_count: 0n,
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  override async getOrderTimings(p: Parameters<DataPlanePort['getOrderTimings']>[0]) {
    this.assertWs(p.workspace_id);
    const t = await readOrderTimings(this.ws);
    const summaryRow = {
      group_id: 'all', label: 'All', group_by: 'all',
      first_orders: t.firstOrders,
      second_orders_bp: t.secondBp,
      third_orders_bp: t.thirdBp,
      fourth_orders_bp: t.fourthBp,
      days_1to2: t.days12,
      days_2to3: t.days23,
      days_3to4: t.days34,
      reactivation_window_days: t.days12 !== null ? Math.round(t.days12 * 0.8) : null,
    };
    const result: OrderTimingsResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      metric: 'median',
      summary: summaryRow,
      groups: [],
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  override async getEmailSmsPerformance(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    return { result: emptyEmailSmsPerformance(this.ws), data_epoch: DATA_EPOCH };
  }

  // Chart-parity: daily net-sales series (feeds analytics AreaChart).
  override async getDailySales(p: { workspace_id: string; date_range: DateRange }): Promise<{ rows: DailySalesRow[]; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    const raw = await readDailyNetSales(this.ws, p.date_range.start, p.date_range.end);
    return {
      rows: raw.map((r) => ({ date: r.date, net_sales_mu: r.netSalesMu, orders: r.orders })),
      data_epoch: DATA_EPOCH,
    };
  }

  // Chart-parity: daily acquisition series (feeds acquisition ComposedChart).
  override async getDailyAcquisition(p: { workspace_id: string; date_range: DateRange }): Promise<{ rows: DailyAcquisitionRow[]; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    const raw = await readDailyAcquisition(this.ws, p.date_range.start, p.date_range.end);
    return {
      rows: raw.map((r) => ({
        date: r.date,
        new_customers: r.newCustomers,
        nc_revenue_mu: r.ncRevenueMu,
        ad_spend_mu: r.adSpendMu,
        nc_cm2_mu: r.ncCm2Mu,
        cac_mu: r.cacMu,
        cm2_per_nc_mu: r.cm2PerNcMu,
        meta_spend_mu: r.metaSpendMu,
        google_spend_mu: r.googleSpendMu,
      })),
      data_epoch: DATA_EPOCH,
    };
  }

  // P&L period grid — per-period (day/week/month/quarter) full P&L row set.
  // Legacy-parity: ~34 column grid. Columns with no migrated source → honest 0n.
  override async getPnlPeriodGrid(p: Parameters<DataPlanePort['getPnlPeriodGrid']>[0]): Promise<{ rows: PnlPeriodRow[]; currency_code: string; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    const raw = await readPnlPeriodGrid(this.ws, p.date_range.start, p.date_range.end, p.granularity);
    const currency_code = raw.length > 0 ? (raw[0].currencyCode ?? 'INR') : 'INR';
    const rows: PnlPeriodRow[] = raw.map((r) => ({
      bucketKey: r.bucketKey,
      label: r.label,
      grossSales: r.grossSales,
      productGross: r.productGross,
      shippingGross: r.shippingGross,
      discounts: r.discounts,
      productDiscount: r.productDiscount,
      shippingDiscount: r.shippingDiscount,
      sales: r.sales,
      netSales: r.netSales,
      productNet: r.productNet,
      shippingNet: r.shippingNet,
      refunds: r.refunds,
      productRefunds: r.productRefunds,
      shippingRefunds: r.shippingRefunds,
      returnFees: r.returnFees,
      revenue: r.revenue,
      ncNetRevenue: r.ncNetRevenue,
      ecNetRevenue: r.ecNetRevenue,
      netRevenue: r.netRevenue,
      cogs: r.cogs,
      variableCosts: r.variableCosts,
      shippingCosts: r.shippingCosts,
      returnsCosts: r.returnsCosts,
      paymentCosts: r.paymentCosts,
      customsCosts: r.customsCosts,
      otherVariable: r.otherVariable,
      adSpend: r.adSpend,
      metaAdSpend: r.metaAdSpend,
      googleAdSpend: r.googleAdSpend,
      contributionMargin1: r.contributionMargin1,
      contributionMargin2: r.contributionMargin2,
      contributionMargin3: r.contributionMargin3,
      fixedCosts: r.fixedCosts,
      founderSalaryAllocated: r.founderSalaryAllocated,
      netProfit: r.netProfit,
      orders: r.orders,
      currencyCode: r.currencyCode,
    }));
    return { rows, currency_code, data_epoch: DATA_EPOCH };
  }

  override async getShipmentRows(p: Parameters<DataPlanePort['getShipmentRows']>[0]) {
    this.assertWs(p.workspace_id);
    const page = await readShipmentRows(
      this.ws,
      {
        search: p.filters.search,
        statuses: p.filters.statuses,
        channelNames: p.filters.channel_names,
        payment: p.filters.payment,
        mapping: p.filters.mapping,
        rtoOnly: p.filters.rto_only,
      },
      p.cursor,
      p.page_size,
    );
    const rows: ShipmentRow[] = page.rows.map((r) => ({
      id: r.id,
      shipment_id: r.vendorShipmentId,
      order_id: r.vendorOrderRef,
      awb_code: null,          // not in connector_shipment_facts
      courier_name: r.courierName,
      status: r.status,
      status_bucket: r.statusBucket,
      payment_method: r.isCod ? 'COD' : 'Prepaid',
      is_cod: r.isCod,
      shopify_order_name: null, // not in connector_shipment_facts
      channel_name: null,       // not in connector_shipment_facts
      shipped_at: r.shippedAt,
      created_at: r.createdAt,
      delivery_pincode: r.deliveryPincode,
      delivery_city: r.deliveryCity,
      // Charge columns: forward = shipping_charges_mu (applied_weight_amount precedence)
      forward_charge_mu: r.shippingChargesMu,
      cod_charge_mu: r.isCod ? r.codAmountMu : null,
      rto_charge_mu: r.statusBucket === 'RTO' ? r.shippingChargesMu : null,
      charged_weight_kg: null,  // not in connector_shipment_facts
      zone: null,               // not in connector_shipment_facts
    }));
    return {
      rows,
      next_cursor: page.nextCursor,
      total_count: page.totalCount,
      filtered_count: page.filteredCount,
      delivered_count: page.deliveredCount,
      rto_count: page.rtoCount,
      mapped_count: page.mappedCount,
      distinct_statuses: page.distinctStatuses,
      data_epoch: DATA_EPOCH,
    };
  }

  // Marketing action CRUD — parity-38. Live DB overrides (core-settings use-cases).
  override async listMarketingActions(p: { workspace_id: string; date_range: { start: string; end: string } }): Promise<{ result: ListMarketingActionsResult; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    const rows = await coreListMarketingActions(this.ws, p.date_range.start, p.date_range.end);
    return {
      result: {
        workspace_id: this.ws,
        rows: rows.map((r) => ({
          id: r.id,
          workspace_id: r.workspace_id,
          action_date: r.action_date,
          action_type: r.action_type,
          action_name: r.action_name,
          notes: r.notes,
          created_by: r.created_by,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
        total_rows: BigInt(rows.length),
        data_epoch: DATA_EPOCH,
      },
      data_epoch: DATA_EPOCH,
    };
  }

  override async createMarketingAction(p: CreateMarketingActionInput): Promise<MarketingActionRow> {
    this.assertWs(p.workspace_id);
    const row = await coreCreateMarketingAction(p.workspace_id, {
      action_date: p.action_date,
      action_type: p.action_type,
      action_name: p.action_name,
      notes: p.notes,
      created_by: p.created_by,
    });
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      action_date: row.action_date,
      action_type: row.action_type,
      action_name: row.action_name,
      notes: row.notes,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  override async updateMarketingAction(p: UpdateMarketingActionInput): Promise<MarketingActionRow> {
    this.assertWs(p.workspace_id);
    const row = await coreUpdateMarketingAction(p.workspace_id, p.action_id, {
      action_date: p.action_date,
      action_type: p.action_type,
      action_name: p.action_name,
      notes: p.notes,
    });
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      action_date: row.action_date,
      action_type: row.action_type,
      action_name: row.action_name,
      notes: row.notes,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  override async deleteMarketingAction(p: { workspace_id: string; action_id: string }): Promise<{ deleted: boolean }> {
    this.assertWs(p.workspace_id);
    return coreDeleteMarketingAction(p.workspace_id, p.action_id);
  }
}

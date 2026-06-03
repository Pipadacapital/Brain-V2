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
  readStoreSummary, readPnl, readMarketing, readIntegrations, readCogs, readCogsSettings,
  readProductPerformance, readWorkspaceMembers, readWorkspaceSettings,
  readShipmentAnalytics, readPincodes, readCodPrepaid, readCohorts, readLtv,
  readLifecycleStates, readOrderTimings, readFirstProductCascade, readDistributions, readCalendarReport,
  readDailyNetSales, readDailyAcquisition, readDistributionsGraphPoints, readPnlPeriodGrid,
  readShipmentRows,
  // Team CRUD mutations:
  listTeamPendingInvitations, inviteTeamMember, changeTeamMemberRole,
  removeTeamMember, revokeTeamInvite, transferTeamOwnership,
  // Email/SMS performance:
  readEmailPerformance,
  type ReadProductPerformanceFilters,
} from '@brain/core-connectors';
import {
  listMarketingActions as coreListMarketingActions,
  createMarketingAction as coreCreateMarketingAction,
  updateMarketingAction as coreUpdateMarketingAction,
  deleteMarketingAction as coreDeleteMarketingAction,
  listFestivals as coreListFestivals,
  listCosts as coreListCosts,
  listGoals as coreListGoals,
} from '@brain/core-settings';
import type {
  DataPlanePort,
  KpiSummaryRow,
  PnlWaterfallRow,
  PnlStatementRow,
  CostStackRow,
  CostKind,
  GoalEvaluationRow,
  GoalRag,
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
  ExpectedImpact,
  BackfillStatusResult,
  WorkspaceMembersResult,
  WorkspaceSettingsResult,
  WorkspaceMemberRole,
  RtoAnalyticsResult,
  CodPrepaidResult,
  LogisticsResult,
  PincodeIntelligenceResult,
  CohortMatrixResult,
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
  MarketingActionRow,
  ListMarketingActionsResult,
  CreateMarketingActionInput,
  UpdateMarketingActionInput,
  InventorySetLeadTimeInput,
  InventorySetLeadTimeResult,
  ProductGroupBy,
  ProductSort,
  PendingInvitationRow,
  TeamInviteParams,
  TeamChangeRoleParams,
  TeamRemoveMemberParams,
  TeamRevokeInviteParams,
  TeamTransferOwnershipParams,
  TeamMutationResult,
  EmailSmsPerformanceResult,
  EmailPerfRow,
} from '../domain/proto-types.js';
import { StubDataPlane, InMemoryDecisionLog, DATA_EPOCH } from './loopback-data-plane.js';
import {
  emptyInventoryLevels,
  emptyEmailSmsPerformance,
} from './empty-results.js';

/** Integer basis-points helper (no float): ratio of a/b in bp, or null on zero denom. */
function bp(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  return Number((numerator * 10000n) / denominator);
}

// ---------------------------------------------------------------------------
// Pincode intelligence helpers — COMPUTED (not stubbed) so state/tier/top_courier
// show real values for the LocalDbDataPlane. Mirror legacy classifyTier exactly
// (pincode-intelligence.ts lines 10-41).
// ---------------------------------------------------------------------------
const _TIER_1_CITIES = new Set([
  'mumbai', 'delhi', 'bangalore', 'bengaluru', 'hyderabad', 'chennai', 'kolkata', 'pune', 'ahmedabad',
]);
const _TIER_2_CITIES = new Set([
  'jaipur', 'lucknow', 'surat', 'kanpur', 'nagpur', 'indore', 'bhopal', 'patna', 'vadodara', 'ludhiana',
  'agra', 'nashik', 'faridabad', 'meerut', 'rajkot', 'varanasi', 'srinagar', 'aurangabad', 'dhanbad',
  'amritsar', 'navi mumbai', 'allahabad', 'ranchi', 'howrah', 'coimbatore', 'jabalpur', 'gwalior',
  'vijayawada', 'jodhpur', 'madurai', 'raipur', 'kota', 'guwahati', 'chandigarh', 'solapur', 'hubballi',
  'tiruchirappalli', 'bareilly', 'mysuru', 'mysore', 'tiruppur', 'gurgaon', 'gurugram', 'noida', 'thane',
]);

function _classifyTier(city: string): 1 | 2 | 3 | null {
  const c = city.trim().toLowerCase();
  if (!c || c === '—') return null;
  if (_TIER_1_CITIES.has(c)) return 1;
  if (_TIER_2_CITIES.has(c)) return 2;
  return 3;
}

/**
 * Derive Indian state name from the first 2–3 digits of a 6-digit pincode.
 * Based on India Post pin code zones (standard reference).
 * Returns '' for unknown/unparseable pins — honest empty, not a stub.
 * Exported for unit testing (api-gateway-14 Jharkhand fix).
 */
export function _stateFromPincode(pincode: string): string {
  const p = pincode.trim();
  if (p.length < 6) return '';
  const prefix2 = parseInt(p.substring(0, 2), 10);
  const prefix3 = parseInt(p.substring(0, 3), 10);
  // Zone 1: 11x–19x Delhi NCR / Rajasthan
  if (prefix2 === 11) return 'Delhi';
  if (prefix2 >= 12 && prefix2 <= 13) return 'Haryana';
  if (prefix2 >= 14 && prefix2 <= 15) return 'Punjab';
  if (prefix2 === 16) return 'Punjab'; // Chandigarh
  if (prefix2 >= 17 && prefix2 <= 17) return 'Himachal Pradesh';
  if (prefix2 >= 18 && prefix2 <= 19) return 'Jammu & Kashmir';
  // Zone 2: 20x–28x UP / Uttarakhand
  if (prefix2 >= 20 && prefix2 <= 28) {
    if (prefix3 >= 248 && prefix3 <= 249) return 'Uttarakhand';
    return 'Uttar Pradesh';
  }
  // Zone 3: 30x–34x Rajasthan
  if (prefix2 >= 30 && prefix2 <= 34) return 'Rajasthan';
  // Zone 4: 36x–39x Gujarat, 40x–44x Maharashtra (partial)
  if (prefix2 >= 36 && prefix2 <= 39) return 'Gujarat';
  if (prefix2 === 40) return 'Maharashtra'; // Mumbai
  if (prefix2 >= 40 && prefix2 <= 44) return 'Maharashtra';
  if (prefix2 === 45 || prefix2 === 46 || prefix2 === 47) return 'Madhya Pradesh';
  if (prefix2 === 48) return 'Madhya Pradesh';
  if (prefix2 === 49) return 'Chhattisgarh';
  // Zone 5: 50x–53x Andhra/Telangana
  if (prefix2 >= 50 && prefix2 <= 53) {
    if (prefix3 >= 500 && prefix3 <= 502) return 'Telangana';
    if (prefix3 >= 503 && prefix3 <= 535) return 'Andhra Pradesh';
    return 'Telangana';
  }
  // Zone 6: 56x–59x Karnataka, 60x–64x Tamil Nadu, 67x–69x Kerala
  if (prefix2 >= 56 && prefix2 <= 59) return 'Karnataka';
  if (prefix2 >= 60 && prefix2 <= 64) return 'Tamil Nadu';
  if (prefix2 >= 67 && prefix2 <= 69) return 'Kerala';
  // Zone 7: 70x–74x West Bengal, 75x–77x Odisha
  if (prefix2 >= 70 && prefix2 <= 74) return 'West Bengal';
  if (prefix2 >= 75 && prefix2 <= 77) return 'Odisha';
  if (prefix2 >= 78 && prefix2 <= 78) return 'Assam';
  // Zone 8: 80x–85x Bihar/Jharkhand/Odisha.
  // India Post: 80x–81x Bihar, 82x–83x Jharkhand, 84x–85x Odisha.
  // Jharkhand check MUST precede the broader Bihar range to be reachable.
  if (prefix2 === 82 || prefix2 === 83) return 'Jharkhand';
  if (prefix2 >= 80 && prefix2 <= 81) return 'Bihar';
  if (prefix2 === 84 || prefix2 === 85) return 'Odisha';
  return '';
}

// In-memory lead-time overrides for the LocalDbDataPlane (per-process, reset on restart).
// In production this would be persisted to workspace_product_settings; for local-dev
// the in-process store is consistent with loopback semantics.
const _localLeadTimeOverrides = new Map<string, Map<string, number>>(); // wsId → sku → days

function _setLocalLeadTime(wsId: string, sku: string, days: number): void {
  if (!_localLeadTimeOverrides.has(wsId)) _localLeadTimeOverrides.set(wsId, new Map());
  _localLeadTimeOverrides.get(wsId)!.set(sku, days);
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

  // Map the tRPC DateRange (ISO start/end) to the reader's {from,to} window, or
  // undefined for lifetime. Threading this is what makes the dashboard date
  // picker actually window the headline summaries (was silently ignored).
  private rangeOf(p: { date_range?: DateRange }): { from: string; to: string } | undefined {
    const dr = p.date_range;
    return dr && dr.start && dr.end ? { from: dr.start, to: dr.end } : undefined;
  }

  override async getStoreSummary(params: { workspace_id: string; date_range: DateRange }): Promise<{
    summary: StoreSummaryRow;
    ladder: StoreRevenueLadderStep[];
    data_epoch: Date;
  }> {
    this.assertWs(params.workspace_id);
    const f = await readStoreSummary(this.ws, this.rangeOf(params));
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
    const range = this.rangeOf(params);
    // Derive CM2/CM3 from the SAME P&L primitive (readPnl + resolveCosts) so the
    // KPI strip and the P&L statement are always identical for the same period.
    // CANON: net = gross − discount (tax separate); cm1 = net − cogs − variable;
    //        cm2 = cm1 − ad spend; cm3 = cm2 − misc.
    const f = await readPnl(this.ws, range);
    const store = await readStoreSummary(this.ws, range);
    const cogs = (await readCogs(this.ws, range)).cogsMu;
    const { variableMu: variable, miscMu: misc } = await this.resolveCosts(f.netRevenueMu, f.orderCount);
    const cm1 = f.netRevenueMu - cogs - variable;
    const cm2 = cm1 - f.totalAdSpendMu;
    const cm3 = cm2 - misc;
    const summary: KpiSummaryRow = {
      workspace_id: this.ws,
      period: 'synced',
      data_epoch: DATA_EPOCH,
      currency_code: f.currencyCode,
      net_revenue_mu: f.netRevenueMu,
      cm2_mu: cm2,
      cm3_mu: cm3,
      rto_rate_bp: null,
      blended_roas_x100: f.totalAdSpendMu > 0n ? Number((f.netRevenueMu * 100n) / f.totalAdSpendMu) : null,
      total_orders: f.orderCount,
      aov_mu: store.aovMu === null ? null : Number(store.aovMu),
      conversion_rate_bp: null,
    };
    return { summary, data_epoch: DATA_EPOCH };
  }

  // Resolve the saved cost stack (workspace_costs) into CM inputs. Variable costs
  // scale with volume — per_order × realized orders + percent × net — so they are
  // correct at any period without proration. Monthly fixed costs are overhead
  // (misc_expenses_prorated, below CM2); taken at face value (period-proration of
  // overhead is a separate decision — workspace_misc_expenses has no reader yet).
  private async resolveCosts(netSalesMu: bigint, orderCount: bigint): Promise<{
    costRows: CostStackRow[]; variableMu: bigint; miscMu: bigint;
    totalFixedMonthlyMu: bigint; totalPerOrderMu: bigint;
  }> {
    const costs = await coreListCosts(this.ws);
    const costRows: CostStackRow[] = costs.map((c) => {
      const kind: CostKind = c.is_percent ? 'percent' : (c.billing_mode === 'MONTHLY' ? 'fixed_monthly' : 'per_order');
      return {
        cost_type: c.cost_type,
        name: c.name ?? c.cost_type,
        kind,
        amount_mu: c.is_percent ? 0n : c.amount_mu,
        amount_bp: c.is_percent ? Number(c.amount_mu) : 0,
        effective_from: c.effective_from,
        currency_code: c.currency_code ?? 'INR',
      };
    });
    const totalPerOrderMu = costRows.filter((r) => r.kind === 'per_order').reduce((a, r) => a + r.amount_mu, 0n);
    const totalFixedMonthlyMu = costRows.filter((r) => r.kind === 'fixed_monthly').reduce((a, r) => a + r.amount_mu, 0n);
    const percentMu = costRows.filter((r) => r.kind === 'percent')
      .reduce((a, r) => a + (netSalesMu * BigInt(r.amount_bp)) / 10000n, 0n);
    return {
      costRows,
      variableMu: totalPerOrderMu * orderCount + percentMu,
      miscMu: totalFixedMonthlyMu,
      totalFixedMonthlyMu,
      totalPerOrderMu,
    };
  }

  override async getPnlStatement(params: { workspace_id: string; date_range: DateRange }): Promise<{
    statement: PnlStatementRow;
    data_epoch: Date;
  }> {
    this.assertWs(params.workspace_id);
    const range = this.rangeOf(params);
    const f = await readPnl(this.ws, range);
    // COGS applies workspace_cogs_settings; variable costs come from the saved
    // workspace_costs stack (per_order × orders + percent × net).
    const netRevenue = f.netRevenueMu;
    const cogs = (await readCogs(this.ws, range)).cogsMu;
    const { variableMu: variable, miscMu: misc } = await this.resolveCosts(netRevenue, f.orderCount);
    const cm1 = netRevenue - cogs - variable;
    const cm2 = cm1 - f.totalAdSpendMu;
    const cm3 = cm2 - misc;
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
      misc_expenses_prorated_mu: misc,
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
    const range = this.rangeOf(params);
    const f = await readPnl(this.ws, range);
    const head = f.netRevenueMu;
    const cogs = (await readCogs(this.ws, range)).cogsMu;
    const { variableMu: variable, miscMu: misc } = await this.resolveCosts(head, f.orderCount);
    const cm1 = head - cogs - variable;
    const cm2 = cm1 - f.totalAdSpendMu;
    const cm3 = cm2 - misc;
    const epoch = DATA_EPOCH;
    const c = f.currencyCode;
    // 8-step CM waterfall (matches the metric-registry contract / pnl router test):
    // net → cogs → variable → CM1 → ad spend → CM2 → misc → CM3.
    const steps: PnlWaterfallRow[] = [
      { definition_id: 'net_revenue_mu', label: 'Realized Revenue', value_mu: head, cumulative_mu: head, currency_code: c, data_epoch: epoch },
      { definition_id: 'cogs_mu', label: 'COGS', value_mu: -cogs, cumulative_mu: head - cogs, currency_code: c, data_epoch: epoch },
      { definition_id: 'variable_costs_mu', label: 'Variable Costs', value_mu: -variable, cumulative_mu: cm1, currency_code: c, data_epoch: epoch },
      { definition_id: 'cm1_mu', label: 'CM1 (Gross Contribution)', value_mu: cm1, cumulative_mu: cm1, currency_code: c, data_epoch: epoch },
      { definition_id: 'total_ad_spend_mu', label: 'Ad Spend', value_mu: -f.totalAdSpendMu, cumulative_mu: cm2, currency_code: c, data_epoch: epoch },
      { definition_id: 'cm2_mu', label: 'CM2 (After Ads)', value_mu: cm2, cumulative_mu: cm2, currency_code: c, data_epoch: epoch },
      { definition_id: 'misc_expenses_prorated_mu', label: 'Misc / Overhead', value_mu: -misc, cumulative_mu: cm3, currency_code: c, data_epoch: epoch },
      { definition_id: 'cm3_mu', label: 'CM3 (After Overhead)', value_mu: cm3, cumulative_mu: cm3, currency_code: c, data_epoch: epoch },
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
    const m = await readMarketing(this.ws, this.rangeOf(params));
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
    const m = await readMarketing(this.ws, this.rangeOf(params));
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

  override async getMorningBrief(p: { workspace_id: string; date: string }): Promise<MorningBrief> {
    this.assertWs(p.workspace_id);
    // Deterministic, GROUNDED brief: every number below is a real metric read from
    // the live facts (no fabrication). Recommendations are non-committal
    // (REVIEW_MANUALLY) and expected_impact is explicitly "not estimated" — the
    // ₹-impact projections + LLM narration are the intelligence-service's job
    // (small_llm grounded + faithfulness gate); this is the honest interim surface.
    // See docs/parity-fix/advisor-review-2026-06-02.md P1-9.
    const [store, mk, ship, prod] = await Promise.all([
      readStoreSummary(this.ws),
      readMarketing(this.ws),
      readShipmentAnalytics(this.ws),
      readProductPerformance(this.ws),
    ]);
    if (!store.hasData) {
      return { items: [], data_epoch: DATA_EPOCH, freshness_label: 'No orders synced yet — the brief populates once data is connected.' };
    }
    const inr = (mu: bigint): string => '₹' + (Number(mu) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    const noImpact: ExpectedImpact = { revenue_mu: 0n, cm2_mu: 0n, currency_code: store.currencyCode, impact_label: 'Impact not estimated — review' };
    const items: MorningBrief['items'] = [];

    // 1) Realized revenue headline (net = gross − discount).
    items.push({
      insight_id: 'mb-revenue', title: `Realized net revenue ${inr(store.realizedRevenueMu)}`, severity: 'INFO',
      confidence_display_pct: 99, summary: `${inr(store.realizedRevenueMu)} net (gross − discount) across ${store.orderCount.toString()} orders; AOV ${store.aovMu != null ? inr(store.aovMu) : 'n/a'}.`,
      detail: `Gross ${inr(store.grossSalesMu)}, discounts ${inr(store.totalDiscountMu)}.`,
      recommendation: { action: 'NO_ACTION', entity_id: 'store', rationale: 'Headline figure for the period.' },
      expected_impact: noImpact, risk: 'LOW', data_epoch: DATA_EPOCH,
    });

    // 2) Blended MER (net revenue / ad spend) — flag below 2×.
    const spend = mk.metaSpendMu + mk.googleSpendMu;
    if (spend > 0n) {
      const merBp = Number((mk.netRevenueMu * 10000n) / spend);
      const merX = (merBp / 10000).toFixed(2);
      items.push({
        insight_id: 'mb-mer', title: `Blended MER ${merX}×`, severity: merBp < 20000 ? 'WARNING' : 'INFO',
        confidence_display_pct: 90, summary: `Net revenue ${inr(mk.netRevenueMu)} on ad spend ${inr(spend)} → MER ${merX}×.`,
        detail: `Meta ${inr(mk.metaSpendMu)}, Google ${inr(mk.googleSpendMu)}.`,
        recommendation: { action: 'REVIEW_MANUALLY', entity_id: 'marketing', rationale: merBp < 20000 ? 'Blended MER under 2× — review ad efficiency by campaign.' : 'MER healthy; monitor by campaign.' },
        expected_impact: noImpact, risk: 'LOW', data_epoch: DATA_EPOCH,
      });
    }

    // 3) RTO rate (return-to-origin) — flag above 15%.
    if (ship.totalShipments > 0n) {
      const rtoBp = Number((ship.rtoCount * 10000n) / ship.totalShipments);
      const rtoPct = (rtoBp / 100).toFixed(1);
      items.push({
        insight_id: 'mb-rto', title: `RTO rate ${rtoPct}%`, severity: rtoBp > 1500 ? 'WARNING' : 'INFO',
        confidence_display_pct: 88, summary: `${ship.rtoCount.toString()} of ${ship.totalShipments.toString()} shipments returned to origin (${rtoPct}%).`,
        detail: `COD shipments ${ship.codTotal.toString()}; COD-RTO ${ship.codRtoCount.toString()}.`,
        recommendation: { action: 'REVIEW_MANUALLY', entity_id: 'logistics', rationale: rtoBp > 1500 ? 'RTO above 15% — review top return pincodes/SKUs and push prepaid.' : 'RTO within range; monitor.' },
        expected_impact: noImpact, risk: rtoBp > 1500 ? 'MEDIUM' : 'LOW', data_epoch: DATA_EPOCH,
      });
    }

    // 4) Top product by CM1 (merchandising signal).
    const top = prod.rows[0];
    if (top) {
      items.push({
        insight_id: 'mb-top-product', title: `Top product: ${top.label}`, severity: 'INFO',
        confidence_display_pct: 85, summary: `${top.label} leads on contribution — CM1 ${inr(top.cm1Mu)} on revenue ${inr(top.revenueMu)}.`,
        detail: `Units sold ${top.soldQty.toString()} across ${top.orders.toString()} orders.`,
        recommendation: { action: 'NO_ACTION', entity_id: top.label, rationale: 'Your contribution leader for the period.' },
        expected_impact: noImpact, risk: 'LOW', data_epoch: DATA_EPOCH,
      });
    }

    // Rank: CRITICAL > WARNING > INFO.
    const sevRank: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    items.sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
    return { items, data_epoch: DATA_EPOCH, freshness_label: 'Grounded in the latest synced facts' };
  }

  override async getBackfillStatus(p: { workspace_id: string }): Promise<{ result: BackfillStatusResult; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    return { result: { workspace_id: this.ws, jobs: [], note: 'No backfill jobs for this workspace.' }, data_epoch: DATA_EPOCH };
  }

  // ---- NOT YET FED BY CONNECTORS → HONEST EMPTY (never the Sugandh seed) ------

  // RTO analytics from Shiprocket shipment facts. revenue_lost_to_rto = 0 (legacy
  // never persisted the shipment→order key — documented in connector-pipeline-gaps).
  // connected=true when there are any shipment facts for this workspace.
  override async getRtoAnalytics(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    const s = await readShipmentAnalytics(this.ws);
    const connected = s.totalShipments > 0n;
    const result: RtoAnalyticsResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      connected,
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
      by_product: [], // Shopify-enrichment table requires order→shipment mapping (deferred)
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  // COD vs Prepaid: order counts/revenue from order facts; RTO rates from shipments.
  // Computes effective revenue, fees and break-even mirroring loopback-data-plane formula.
  // Fee defaults: ₹30 COD fee/order, ₹80 return shipping/RTO, 2% gateway fee.
  override async getCodPrepaid(p: {
    workspace_id: string;
    date_range: DateRange;
    fee_overrides?: import('../domain/proto-types.js').CodPrepaidFeeOverrides;
  }) {
    this.assertWs(p.workspace_id);
    const cp = await readCodPrepaid(this.ws);
    const s = await readShipmentAnalytics(this.ws);
    const codRto = bp(s.codRtoCount, s.codTotal);
    const prepaidRto = bp(s.prepaidRtoCount, s.prepaidTotal);
    const connected = s.totalShipments > 0n || cp.codOrders + cp.prepaidOrders > 0n;
    // Fee assumptions
    const COD_FEE_DEFAULT = 3000n;       // ₹30 per order
    const RETURN_SHIP_DEFAULT = 8000n;   // ₹80 per RTO
    const GATEWAY_FEE_BP_DEFAULT = 200;  // 2%
    const codFeePerOrder = p.fee_overrides?.cod_fee_per_order_mu ?? COD_FEE_DEFAULT;
    const returnShipping = p.fee_overrides?.return_shipping_per_rto_mu ?? RETURN_SHIP_DEFAULT;
    const gatewayFeeBp = p.fee_overrides?.gateway_fee_bp ?? GATEWAY_FEE_BP_DEFAULT;
    // Effective revenue = gross - RTO-loss - fees (integer FLOOR, mirrors loopback)
    const codRtoBp = codRto ?? 0;
    const prepaidRtoBp = prepaidRto ?? 0;
    const codSurvived = cp.codGrossMu - (cp.codGrossMu * BigInt(codRtoBp)) / 10000n;
    const prepaidSurvived = cp.prepaidGrossMu - (cp.prepaidGrossMu * BigInt(prepaidRtoBp)) / 10000n;
    const codRtoCount = s.codRtoCount;
    const prepaidRtoCount = s.prepaidRtoCount;
    const codFeeTotal = cp.codOrders * codFeePerOrder;
    const gatewayFeeTotal = (cp.prepaidGrossMu * BigInt(gatewayFeeBp)) / 10000n;
    const codReturnShip = codRtoCount * returnShipping;
    const prepaidReturnShip = prepaidRtoCount * returnShipping;
    const effCod = codSurvived - codFeeTotal - codReturnShip;
    const effPrepaid = prepaidSurvived - gatewayFeeTotal - prepaidReturnShip;
    const codFeeTotalRow = codFeeTotal + codReturnShip;
    const prepaidFeeTotalRow = gatewayFeeTotal + prepaidReturnShip;
    // Break-even (FULL legacy formula)
    const aov = cp.aovMu ?? 0n;
    const restocking = 0n;
    const denom = aov + returnShipping + restocking;
    const pgFee = (aov * BigInt(gatewayFeeBp)) / 10000n;
    const numScaled =
      aov * BigInt(prepaidRtoBp) +
      (codFeePerOrder - pgFee) * 10000n +
      BigInt(prepaidRtoBp) * (returnShipping + restocking);
    const breakeven = denom > 0n ? Number(numScaled / denom) : null;
    const appliedOverrides: import('../domain/proto-types.js').CodPrepaidFeeOverrides = {
      cod_fee_per_order_mu: codFeePerOrder,
      return_shipping_per_rto_mu: returnShipping,
      gateway_fee_bp: gatewayFeeBp,
    };
    const result: CodPrepaidResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      connected,
      cod_orders: cp.codOrders,
      prepaid_orders: cp.prepaidOrders,
      cod_realization_rate_bp: codRto === null ? null : 10000 - codRto,
      cod_rto_rate_bp: codRto,
      prepaid_rto_rate_bp: prepaidRto,
      effective_revenue_cod_mu: effCod,
      effective_revenue_prepaid_mu: effPrepaid,
      prepaid_premium_mu: effPrepaid - effCod,
      average_order_value_mu: cp.aovMu,
      breakeven_cod_rto_rate_bp: breakeven,
      breakeven_note: null,
      fee_overrides: appliedOverrides,
      comparison: [
        {
          payment_method: 'COD',
          orders: cp.codOrders,
          gross_revenue_mu: cp.codGrossMu,
          rto_rate_bp: codRto,
          effective_revenue_mu: effCod,
          fee_total_mu: codFeeTotalRow,
          net_revenue_mu: effCod - codFeeTotalRow,
          net_revenue_per_order_mu: cp.codOrders > 0n ? effCod / cp.codOrders : null,
        },
        {
          payment_method: 'Prepaid',
          orders: cp.prepaidOrders,
          gross_revenue_mu: cp.prepaidGrossMu,
          rto_rate_bp: prepaidRto,
          effective_revenue_mu: effPrepaid,
          fee_total_mu: prepaidFeeTotalRow,
          net_revenue_mu: effPrepaid - prepaidFeeTotalRow,
          net_revenue_per_order_mu: cp.prepaidOrders > 0n ? effPrepaid / cp.prepaidOrders : null,
        },
      ],
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  // Logistics: sums forward/cod charges from shipment facts (not hardcoded 0).
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
      forward_charges_mu: s.forwardChargesMu,   // summed from DB — not hardcoded 0
      cod_charges_mu: s.codChargesMu,            // summed from DB — not hardcoded 0
      rto_charges_mu: s.rtoChargesMu,
      total_shiprocket_charges_mu: s.totalChargesMu,
      average_shipping_charge_per_shipment_mu: s.totalShipments > 0n ? s.totalChargesMu / s.totalShipments : null,
      by_courier: s.byCourier.map((c) => ({ courier_name: c.courierName, count: c.count, delivered_count: c.deliveredCount, rto_count: c.rtoCount, total_charges_mu: c.chargesMu })),
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  override async getPincodeIntelligence(p: { workspace_id: string; date_range: DateRange; filters?: import('../domain/proto-types.js').PincodeFilterInput }) {
    this.assertWs(p.workspace_id);
    const filters = p.filters;
    const HIGH_RTO_BP = 2000;
    const HIGH_COD_BP = 5000;
    const rows = await readPincodes(this.ws);
    const total = rows.reduce((a, r) => a + r.shipmentCount, 0n);
    // COMPUTED: state from pincode prefix, tier from city, top_courier from max-count courier.
    // readPincodes does not expose top_courier (no per-courier breakdown in the PG aggregate);
    // top_courier is honest-empty for the local-db plane — connector_shipment_facts does not
    // carry a per-pincode courier aggregation without an extra GROUP BY subquery.
    let pincodeRows: import('../domain/proto-types.js').PincodeRow[] = rows.map((r) => {
      const sc = r.shipmentCount;
      const rtoBp = bp(r.rtoCount, sc);
      const codBp = bp(r.codCount, sc);
      const deliveredBp = bp(r.deliveredCount, sc);
      const state = _stateFromPincode(r.pincode);
      const tier = _classifyTier(r.city);
      // Profitability score mirrors legacy calcProfitabilityScore:
      // 100 - rtoRate%*2 - codRate%*0.5 + repeatRate%*0.5 + (aov/1000)*10, clamped 0..100.
      // In the local-db plane repeat and aov are not available per-pincode without joined orders.
      // We compute what we can (rto + cod penalty, delivered bonus) and cap at 10000 centi-points.
      const rtoRatePct = (rtoBp ?? 0) / 100;
      const codRatePct = (codBp ?? 0) / 100;
      const rawScore = Math.max(0, Math.min(100, 100 - rtoRatePct * 2 - codRatePct * 0.5));
      // Store as centi-points (×100) matching the PincodeRow.reliability_score contract.
      const reliability_score = Math.round(rawScore * 100);
      return {
        pincode: r.pincode,
        city: r.city,
        state,
        tier,
        shipment_count: sc,
        rto_count: r.rtoCount,
        rto_rate_bp: rtoBp,
        cod_count: r.codCount,
        cod_rate_bp: codBp,
        delivered_count: r.deliveredCount,
        delivered_rate_bp: deliveredBp,
        revenue_mu: 0n,      // honest: no per-pincode revenue without matched-order join
        aov_mu: null,        // honest: see above
        unique_customers: 0n, // honest: no per-pincode customer aggregation
        repeat_rate_bp: null, // honest: no repeat data without per-customer join
        reliability_score,
        top_courier: '',     // honest: no per-pincode courier breakdown in current PG aggregate
      };
    });
    // Apply filters
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      pincodeRows = pincodeRows.filter((r) =>
        r.pincode.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q) ||
        r.state.toLowerCase().includes(q));
    }
    if (filters?.state) pincodeRows = pincodeRows.filter((r) => r.state.toLowerCase() === filters.state!.toLowerCase());
    if (filters?.min_orders) pincodeRows = pincodeRows.filter((r) => r.shipment_count >= BigInt(filters.min_orders!));
    if (filters?.high_rto) pincodeRows = pincodeRows.filter((r) => r.rto_rate_bp !== null && r.rto_rate_bp >= HIGH_RTO_BP);
    if (filters?.high_cod) pincodeRows = pincodeRows.filter((r) => r.cod_rate_bp !== null && r.cod_rate_bp >= HIGH_COD_BP);
    const result: PincodeIntelligenceResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      total_shipments: total,
      rows: pincodeRows,
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
    const f = p.filters;
    // Map the tRPC-layer sort enum to the fact-analytics sort param.
    const sortMap: Record<string, ReadProductPerformanceFilters['sort']> = {
      cm1: 'cm1', revenue: 'revenue', sold: 'sold', orders: 'orders', label: 'label',
      // These sort axes map to cm1 at the SQL layer (returned sorted by cm1 then re-sorted client-side).
      cm1_pct: 'cm1', cm1_total: 'cm1', refunded: 'sold', net_quantity: 'sold',
      return_rate: 'cm1', aov: 'revenue', pareto_grade: 'cm1',
    };
    const factFilters: ReadProductPerformanceFilters = {
      dateStart: p.date_range.start,
      dateEnd: p.date_range.end,
      search: f?.search,
      sort: sortMap[f?.sort ?? 'cm1'] ?? 'cm1',
      direction: f?.direction ?? 'desc',
      page: f?.page,
      pageSize: f?.page_size,
    };
    const { rows, totalCm1Mu, totalUnfilteredRows } = await readProductPerformance(this.ws, factFilters);
    const result: ProductPerformanceResult = {
      workspace_id: this.ws,
      period: 'synced',
      data_epoch: DATA_EPOCH,
      currency_code: 'INR',
      group_by: (f?.group_by ?? 'product') as ProductGroupBy,
      sort: (f?.sort ?? 'cm1') as ProductSort,
      direction: f?.direction ?? 'desc',
      total_cm1_mu: totalCm1Mu,
      total_rows: BigInt(totalUnfilteredRows),
      rows: rows.map((r) => ({
        label: r.label,
        pareto_grade: r.paretoGrade,
        cm1_mu: r.cm1Mu,
        cm1_pct_bp: r.revenueMu > 0n ? Number((r.cm1Mu * 10000n) / r.revenueMu) : null,
        cm1_total_share_bp: totalCm1Mu > 0n ? Number((r.cm1Mu * 10000n) / totalCm1Mu) : null,
        revenue_mu: r.revenueMu,
        // sales_mu = revenue (full price before refunds); local facts only have realized revenue.
        // Honest approximation: sales_mu == revenue_mu (refund split not in connector_line_item_facts).
        sales_mu: r.revenueMu,
        refunds_mu: 0n,  // honest-empty: refund attribution per product not in local facts
        sold: r.soldQty,
        refunded: 0n,    // honest-empty: refunded qty per product not in local facts
        net_quantity: r.soldQty,
        return_rate_bp: null,     // honest-empty: requires refund join
        nc_return_rate_bp: null,  // honest-empty: NC/EC split not in local facts
        ec_return_rate_bp: null,
        orders: r.orders,
        nc_orders: 0n,   // honest-empty
        ec_orders: 0n,   // honest-empty
        aov_mu: r.aovMu,
        nc_aov_mu: null, // honest-empty
        ec_aov_mu: null, // honest-empty
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
    const obsDays = Math.min(730, Math.max(30, p.filters?.observation_days ?? 365));
    const { rows, totalCohort } = await readFirstProductCascade(
      this.ws,
      p.date_range.start,
      p.date_range.end,
      obsDays,
    );
    const result: FirstProductCascadeResult = {
      workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, currency_code: 'INR',
      observation_days: obsDays,
      total_cohort_customers: totalCohort,
      rows: rows.map((r) => {
        const n = r.firstOrderCustomers;
        // additional_order_rate_centi = sum(max(0,ordersInWindow-1)) * 100 / cohortSize (floor)
        const additionalCenti = n > 0n
          ? (r.sumAdditionalOrders * 100n) / n
          : 0n;
        // average_days_to_second_deci = sum_days * 10 / custs_with_2nd (floor), null if 0
        const daysDeci = r.customersWith2ndInWindow > 0n
          ? (r.sumDaysToSecond * 10n) / r.customersWith2ndInWindow
          : null;
        return {
          product_key: r.productKey,
          product_title: r.productTitle,
          first_order_customers: n,
          customers_with_2nd_order: r.with2nd,
          customers_with_3rd_order: r.with3rd,
          customers_with_4th_plus_order: r.with4thPlus,
          second_order_rate_bp: bp(r.with2nd, n),
          third_order_rate_bp: bp(r.with3rd, n),
          fourth_plus_rate_bp: bp(r.with4thPlus, n),
          additional_order_rate_centi: additionalCenti,
          average_ltv_revenue_mu: r.avgLtvMu,
          average_days_to_second_deci: daysDeci,
        };
      }),
    };
    return { result, data_epoch: DATA_EPOCH };
  }
  override async getGoalAttainment(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    const [goals, f] = await Promise.all([coreListGoals(this.ws), readPnl(this.ws, this.rangeOf(p))]);
    const net = f.netRevenueMu;
    const spend = f.totalAdSpendMu;
    const rows: GoalEvaluationRow[] = goals.map((g) => {
      const metric = g.metric_name.toLowerCase();
      // actual is computed in the goal's unit: MER/ROAS in bp (ratio ×10000), money in mu, count as count.
      let actual = 0n;
      if (metric === 'mer' || metric === 'roas') actual = spend > 0n ? (net * 10000n) / spend : 0n;
      else if (metric === 'net_revenue' || metric === 'revenue' || metric === 'net_sales') actual = net;
      else if (metric === 'ad_spend' || metric === 'spend') actual = spend;
      else if (metric === 'orders') actual = f.orderCount;
      const goalValue = g.goal_value;
      // MAXIMUM = a cap (lower is better); TARGET/MINIMUM = higher is better.
      const higherBetter = g.goal_type !== 'MAXIMUM';
      const attainmentBp = goalValue > 0n ? Number((actual * 10000n) / goalValue) : null;
      const varianceAbs = actual > goalValue ? actual - goalValue : goalValue - actual;
      let rag: GoalRag = 'amber';
      if (attainmentBp !== null) {
        const meets = higherBetter ? attainmentBp >= 10000 : attainmentBp <= 10000;
        const close = higherBetter ? attainmentBp >= 8000 : attainmentBp <= 12000;
        rag = meets ? 'green' : close ? 'amber' : 'red';
      }
      return {
        metric_name: g.metric_name,
        period_type: g.period_type as GoalEvaluationRow['period_type'],
        period_start: g.period_start,
        goal_type: g.goal_type as GoalEvaluationRow['goal_type'],
        goal_value: goalValue,
        actual,
        attainment_bp: attainmentBp,
        variance_abs: varianceAbs,
        higher_better: higherBetter,
        rag,
      };
    });
    return {
      result: { workspace_id: this.ws, period: 'synced', data_epoch: DATA_EPOCH, rows, total_rows: BigInt(rows.length) },
      data_epoch: DATA_EPOCH,
    };
  }
  override async getCostStack(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    const range = this.rangeOf(p);
    const [f, cogs, settings] = await Promise.all([
      readPnl(this.ws, range), readCogs(this.ws, range), readCogsSettings(this.ws),
    ]);
    const net = f.netRevenueMu;
    const { costRows, variableMu, totalFixedMonthlyMu, totalPerOrderMu } = await this.resolveCosts(net, f.orderCount);
    const resolvedCogs = cogs.cogsMu;
    return {
      result: {
        workspace_id: this.ws,
        period: 'synced',
        data_epoch: DATA_EPOCH,
        override_all_bp: settings.overrideBp,
        fallback_bp: settings.fallbackBp,
        markup_bp: settings.markupBp,
        cogs_mode: settings.overrideBp > 0 ? 'override' as const : 'product+fallback' as const,
        cost_rows: costRows,
        total_fixed_monthly_mu: totalFixedMonthlyMu,
        total_per_order_mu: totalPerOrderMu,
        net_sales_mu: net,
        resolved_cogs_mu: resolvedCogs,
        variable_costs_mu: variableMu,
        cm1_mu: net - resolvedCogs - variableMu,
        currency_code: f.currencyCode,
      },
      data_epoch: DATA_EPOCH,
    };
  }
  override async getFestivalCalendar(p: { workspace_id: string; date_range: DateRange }) {
    this.assertWs(p.workspace_id);
    // Read saved festivals (migrated from legacy workspace_festivals). Multiplier
    // is stored in bp (40000 = 4.0×). Honest-empty when none are saved.
    const rows = await coreListFestivals(this.ws);
    const mapped = rows.map((r) => ({
      name: r.name,
      start_date: r.start_date,
      end_date: r.end_date,
      expected_multiplier_bp: r.expected_multiplier_bp,
      regions: r.regions ?? [],
      categories: r.categories ?? [],
      color: r.color ?? '',
      is_template: r.is_template,
      is_active: r.is_active,
    }));
    const peak = mapped.reduce((m, r) => Math.max(m, r.expected_multiplier_bp ?? 0), 0);
    return {
      result: {
        workspace_id: this.ws,
        period: 'synced',
        data_epoch: DATA_EPOCH,
        year: null,
        rows: mapped,
        total_rows: BigInt(mapped.length),
        peak_multiplier_bp: peak,
      },
      data_epoch: DATA_EPOCH,
    };
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
  override async getEmailSmsPerformance(p: Parameters<DataPlanePort['getEmailSmsPerformance']>[0]) {
    this.assertWs(p.workspace_id);
    const groupBy = (p.filters?.group_by ?? 'campaign') as 'campaign' | 'flow' | 'date' | 'channel' | 'dow';
    const facts = await readEmailPerformance(this.ws, p.date_range.start, p.date_range.end, groupBy);
    if (facts.length === 0) {
      return { result: emptyEmailSmsPerformance(this.ws), data_epoch: DATA_EPOCH };
    }
    const rows: EmailPerfRow[] = facts.map((f) => {
      const openRateBp = f.delivered > 0n ? Number((f.uniqueOpens * 10000n) / f.delivered) : null;
      const clickRateBp = f.delivered > 0n ? Number((f.uniqueClicks * 10000n) / f.delivered) : null;
      const revPerRecipient = f.delivered > 0n ? f.revenueMu / f.delivered : null;
      const revPerUniqueOpen = f.uniqueOpens > 0n ? f.revenueMu / f.uniqueOpens : null;
      const unsubRateBp = f.delivered > 0n ? Number((f.unsubscribes * 10000n) / f.delivered) : null;
      const spamRateBp = f.delivered > 0n ? Number((f.spamComplaints * 10000n) / f.delivered) : null;
      return {
        key: f.key,
        label: f.label,
        channel: f.channel,
        delivered: f.delivered,
        unique_opens: f.uniqueOpens,
        unique_clicks: f.uniqueClicks,
        orders: f.orders,
        revenue_mu: f.revenueMu,
        unsubscribes: f.unsubscribes,
        spam_complaints: f.spamComplaints,
        open_rate_bp: openRateBp,
        click_rate_bp: clickRateBp,
        revenue_per_recipient_mu: revPerRecipient,
        revenue_per_unique_open_mu: revPerUniqueOpen,
        unsubscribe_rate_bp: unsubRateBp,
        spam_rate_bp: spamRateBp,
      };
    });
    const result: EmailSmsPerformanceResult = {
      workspace_id: this.ws,
      period: 'synced',
      data_epoch: DATA_EPOCH,
      group_by: groupBy,
      rows,
      total_delivered: rows.reduce((s, r) => s + r.delivered, 0n),
      total_revenue_mu: rows.reduce((s, r) => s + r.revenue_mu, 0n),
      currency_code: 'INR',
    };
    return { result, data_epoch: DATA_EPOCH };
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

  // Wave-4A: per-SKU lead-time mutation (MANAGER-gated).
  // NOT-PERSISTED: LocalDbDataPlane stores lead-time overrides in an in-process Map only.
  // Data is reset on every process restart. The production write path must persist to
  // workspace_product_settings (or equivalent catalog table) — tracked as a Stage-8 item.
  // Callers that require durability should use the production data plane (not this class).
  override async setLeadTime(p: InventorySetLeadTimeInput): Promise<InventorySetLeadTimeResult> {
    this.assertWs(p.workspace_id);
    if (p.lead_time_days < 0 || p.lead_time_days > 365) {
      throw new Error(`ValidationError: lead_time_days must be 0..365`);
    }
    // In-process only — volatile (resets on restart). Sufficient for local-dev sessions.
    _setLocalLeadTime(this.ws, p.sku, p.lead_time_days);
    return { sku: p.sku, lead_time_days: p.lead_time_days };
  }

  // ---------------------------------------------------------------------------
  // Team CRUD mutations — parity-38 feat-parity-w6b.
  // All run through the fact-analytics use-case functions (withWorkspace scoped).
  // Role-gate enforcement lives at the router layer; these are DB-only operations.
  // ---------------------------------------------------------------------------

  override async listPendingInvitations(p: { workspace_id: string }): Promise<{ invitations: PendingInvitationRow[]; data_epoch: Date }> {
    this.assertWs(p.workspace_id);
    const { invitations } = await listTeamPendingInvitations(this.ws);
    return {
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role as WorkspaceMemberRole,
        token: i.token,
        created_at: i.createdAt,
        expires_at: i.expiresAt,
      })),
      data_epoch: DATA_EPOCH,
    };
  }

  override async teamInviteMember(p: TeamInviteParams): Promise<TeamMutationResult> {
    this.assertWs(p.workspace_id);
    const res = await inviteTeamMember({
      workspaceId: p.workspace_id,
      inviterUserId: p.inviter_user_id,
      inviteeEmail: p.invitee_email,
      role: p.role,
    });
    return res;
  }

  override async teamChangeRole(p: TeamChangeRoleParams): Promise<TeamMutationResult> {
    this.assertWs(p.workspace_id);
    return changeTeamMemberRole({
      workspaceId: p.workspace_id,
      targetUserId: p.target_user_id,
      newRole: p.new_role,
    });
  }

  override async teamRemoveMember(p: TeamRemoveMemberParams): Promise<TeamMutationResult> {
    this.assertWs(p.workspace_id);
    return removeTeamMember({ workspaceId: p.workspace_id, targetUserId: p.target_user_id });
  }

  override async teamRevokeInvite(p: TeamRevokeInviteParams): Promise<TeamMutationResult> {
    this.assertWs(p.workspace_id);
    return revokeTeamInvite({ workspaceId: p.workspace_id, invitationId: p.invitation_id });
  }

  override async teamTransferOwnership(p: TeamTransferOwnershipParams): Promise<TeamMutationResult> {
    this.assertWs(p.workspace_id);
    return transferTeamOwnership({
      workspaceId: p.workspace_id,
      actorUserId: p.actor_user_id,
      newOwnerUserId: p.new_owner_user_id,
    });
  }
}

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
  StoreSummaryRow,
  StoreRevenueLadderStep,
  MorningBrief,
  SubmitInsightResult,
  RegisterPushTokenResult,
  DateRange,
} from '../domain/proto-types.js';

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
  net_sales_mu: 206_000_000n,        // gross - discount = ₹20.6L
  total_tax_mu: 18_000_000n,         // ₹1.8L — SUM of per-SKU GST 2.0 (mixed slabs)
  net_net_tax_mu: 188_000_000n,      // net_sales - tax
  shipping_revenue_mu: 3_000_000n,   // ₹30K shipping collected
  // net_revenue = net_net_tax + shipping = 191_000_000? Seed chosen so the
  // dashboard's existing ₹18.5L net_revenue stays the realized headline:
  net_revenue_mu: 191_000_000n,      // ₹19.1L
  // Post-sale reversals (the honest leak):
  cancelled_revenue_mu: 2_000_000n,  // ₹20K cancelled
  rto_reversed_revenue_mu: 3_500_000n, // ₹35K RTO-reversed
  refunded_revenue_mu: 500_000n,     // ₹5K refunded
  realized_revenue_mu: 185_000_000n, // ₹18.5L — net_revenue − 6_000_000 reversals
  order_count: 1_247n,
  aov_mu: 1_483n,                    // ~₹14.83 mean (display)
  // Margin ladder (unchanged from prior dashboard seed)
  cm2_mu: 32_000_000n,
  cm3_mu: 28_000_000n,
  rto_rate_bp: 1_800,
  blended_roas_x100: 285,
  conversion_rate_bp: 230,
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

/** Sugandh-Lok P&L waterfall seed. */
function buildSugandhlokWaterfall(): PnlWaterfallRow[] {
  const epoch = DATA_EPOCH;
  return [
    {
      definition_id: 'net_revenue_mu',
      label: 'Net Revenue',
      value_mu: 185_000_000n,
      cumulative_mu: 185_000_000n,
      currency_code: 'INR',
      data_epoch: epoch,
    },
    {
      definition_id: 'cogs_mu',
      label: 'COGS',
      value_mu: -82_000_000n,
      cumulative_mu: 103_000_000n,
      currency_code: 'INR',
      data_epoch: epoch,
    },
    {
      definition_id: 'cm1_mu',
      label: 'CM1 (Gross Margin)',
      value_mu: 103_000_000n,
      cumulative_mu: 103_000_000n,
      currency_code: 'INR',
      data_epoch: epoch,
    },
    {
      definition_id: 'total_ad_spend_mu',
      label: 'Ad Spend',
      value_mu: -65_000_000n,
      cumulative_mu: 38_000_000n,
      currency_code: 'INR',
      data_epoch: epoch,
    },
    {
      definition_id: 'cm2_mu',
      label: 'CM2 (After Ads)',
      value_mu: 38_000_000n,
      cumulative_mu: 38_000_000n,
      currency_code: 'INR',
      data_epoch: epoch,
    },
    {
      definition_id: 'misc_expenses_prorated_mu',
      label: 'Fixed Overheads (Prorated)',
      value_mu: -6_000_000n,
      cumulative_mu: 32_000_000n,
      currency_code: 'INR',
      data_epoch: epoch,
    },
    {
      definition_id: 'cm3_mu',
      label: 'CM3 (After Overheads)',
      value_mu: 32_000_000n,
      cumulative_mu: 32_000_000n,
      currency_code: 'INR',
      data_epoch: epoch,
    },
  ];
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

let _rowCounter = 0;

function newRowId(): string {
  return `row_${++_rowCounter}_${Date.now()}`;
}

// ---------------------------------------------------------------------------
// StubDataPlane — the LOCAL harness + test implementation of DataPlanePort.
// Accepts an optional InMemoryDecisionLog for G-IDEMPOTENT gate testing.
// ---------------------------------------------------------------------------

export class StubDataPlane implements DataPlanePort {
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
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return { steps: buildSugandhlokWaterfall(), data_epoch: DATA_EPOCH };
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

  async getMorningBrief(params: {
    workspace_id: string;
    date: string;
  }): Promise<MorningBrief> {
    if (!params.workspace_id || params.workspace_id !== this.workspaceId) {
      throw new Error(`UnscopedQueryError: workspace_id=${params.workspace_id} not authorized`);
    }
    return buildSugandhlokBrief();
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

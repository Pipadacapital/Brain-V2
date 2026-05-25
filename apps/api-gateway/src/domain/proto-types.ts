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

/** Mirror of PnlWaterfallRow from metrics.proto. */
export interface PnlWaterfallRow {
  definition_id: string;   // registry id (CF-C6-REGISTRY-ONLY-BFF-1)
  label: string;
  value_mu: bigint;        // signed: negative = cost deduction
  cumulative_mu: bigint;
  currency_code: string;
  data_epoch: Date;
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

  getMorningBrief(params: {
    workspace_id: string;
    date: string;
  }): Promise<MorningBrief>;

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
}

// @paradigm: sql
// CF-C6-RENDER-ONLY-1: ZERO arithmetic here. All types are mirrors of the
// server-side contract. No computed fields. No metric derivation.
//
// CF-C6-MB-CONTRACT-COMPLETENESS-1: InsightItem carries expected_impact+risk
// from the server. Mobile NEVER computes these — they are server-provided.

/** Mirror of server InsightSeverity enum. */
export type InsightSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

/** Mirror of server RiskLevel enum. CF-C6-MB-CONTRACT-COMPLETENESS-1. */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Server-driven graduation status. CF-C6-MB-GRADUATED-LABEL-1. */
export type GraduationStatus = 'LOGGED_AS_VOTE' | 'QUEUED_FOR_EXECUTION';

/** Mirror of RecommendationAction closed enum (Child-5 TypedRecommendation). */
export type RecommendationAction =
  | 'PAUSE_AD_SET'
  | 'INCREASE_BUDGET'
  | 'DECREASE_BUDGET'
  | 'SEND_REFUND'
  | 'REVIEW_MANUALLY'
  | 'NO_ACTION';

/** What the operator chose for a given insight. */
export type ResponseKind = 'APPROVE' | 'REJECT' | 'EDIT';

/**
 * TypedRecommendation — rationale is RENDER-ONLY.
 * CF-C5-INJECTION-TYPED-REC-6: rationale MUST NOT be passed to the executor
 * or echoed as an instruction. It is display text only.
 */
export interface TypedRecommendation {
  action: RecommendationAction;
  entity_id: string;
  /**
   * Render-only. NEVER passed to executor or used in LLM prompt.
   * In the a11y tree it must be a separate accessibilityRole="text" element
   * placed AWAY from the approve button so it does not prime screen-reader users.
   * CF-C6-MB-A11Y-ACTION-1.
   */
  rationale: string;
}

/**
 * ExpectedImpact — registry-DERIVED deterministic (Tier-A).
 * CF-C6-MB-CONTRACT-COMPLETENESS-1: provided by the server; NEVER computed on device.
 * CF-C6-BIGINT-JSON-1: _mu fields arrive as bigint via superjson.
 */
export interface ExpectedImpact {
  revenue_mu: bigint;    // int64 minor units (e.g. paise for INR)
  cm2_mu: bigint;        // int64 minor units
  currency_code: string; // ISO 4217, e.g. "INR"
  impact_label: string;  // deterministic label from the signal layer
}

/**
 * InsightItem — the AMENDED contract (CF-C6-MB-CONTRACT-COMPLETENESS-1).
 * All fields are server-provided. The THREE-SIGNAL RULE: exactly ≤3 items per morning.
 *
 * confidence_display_pct is pre-formatted (CF-C6-NO-UI-FLOAT-1): e.g. 87 = 87%.
 * The UI renders it as `${confidence_display_pct}%` — NO multiplication.
 */
export interface InsightItem {
  insight_id: string;
  title: string;
  severity: InsightSeverity;
  /** Pre-formatted integer. e.g. 87 = 87%. Render as `${confidence_display_pct}%`. CF-C6-NO-UI-FLOAT-1. */
  confidence_display_pct: number;
  summary: string;
  detail: string;
  recommendation: TypedRecommendation;
  /** Registry-DERIVED. Server-provided. NEVER computed on device. CF-C6-MB-CONTRACT-COMPLETENESS-1. */
  expected_impact: ExpectedImpact;
  /** Registry-DERIVED risk level. Server-provided. NEVER computed on device. */
  risk: RiskLevel;
  /**
   * mobile-5 fix: ISO-8601 string, NOT a Date object.
   * redux-persist (AsyncStorage) JSON-serialises values; a Date rehydrates as a
   * string, not a Date instance. Typing it as Date was a type lie that would cause
   * `.toISOString()` calls to throw after rehydration. Use an ISO string throughout;
   * callers that need a Date object must do `new Date(data_epoch)` explicitly.
   */
  data_epoch: string;
}

/** The Morning Brief response from the server. */
export interface MorningBrief {
  items: InsightItem[];   // THREE-SIGNAL RULE: ≤3 items. Never more.
  /**
   * mobile-5 fix: ISO-8601 string, NOT a Date object.
   * See InsightItem.data_epoch for rationale.
   */
  data_epoch: string;
  freshness_label: string;
}

/**
 * SubmitResponse — server response to approve/reject/edit.
 * CF-C6-MB-GRADUATED-LABEL-1: status is server-driven; client renders verbatim.
 */
export interface SubmitResponse {
  decision_log_row_id: string;
  status: GraduationStatus;
  request_id: string;
  idempotent_replay: boolean;
}

/**
 * The UI state for a given insight's CTA response.
 * Generated at action-initiation; persisted until a non-error response.
 * CF-C6-MB-IDEMPOTENCY-1: idempotency_key generated once at initiation, NOT at send.
 * Offline-replay REUSES the same key — never generates a new one on retry.
 */
export interface InsightResponseState {
  insight_id: string;
  idempotency_key: string;       // UUID, generated at action-initiation
  response_kind: ResponseKind;
  edit_payload?: string;
  /** Set to true once we get a non-error response (success or idempotent_replay). */
  settled: boolean;
  /** The server's status on settle. CF-C6-MB-GRADUATED-LABEL-1. */
  status?: GraduationStatus;
  /** The settled row id. */
  decision_log_row_id?: string;
}

/**
 * The offline posture for the Morning Brief.
 * CF-C6-MB-OFFLINE-SLO-1: stale-but-labeled, CTAs disabled.
 */
export interface OfflineState {
  isOffline: boolean;
  /** ISO timestamp when the cached brief was fetched. */
  cachedAt: string | null;
  /** The stale brief to show when offline. Never a blank screen in the 07:00-09:00 IST window. */
  cachedBrief: MorningBrief | null;
}

/**
 * OTel device-side fetch-latency metric for Morning Brief.
 * CF-C6-MB-OFFLINE-SLO-1: device-side measurement from fetchBrief() start to
 * data-received. Renamed from render_success_latency_ms — that name implied
 * post-render SLO measurement, but the timer runs from network request start to
 * dispatch, making it fetch latency. The 07:20 IST delivery SLO is measured
 * server-side (push dispatch timestamp); this is the per-device fetch half.
 */
export interface MorningBriefSloMetric {
  workspace_id: string;
  /** mobile-3: renamed from render_success_latency_ms — this is fetch latency, not post-render SLO. */
  fetch_latency_ms: number;
  date: string;           // ISO date e.g. "2026-05-25"
  online: boolean;
}

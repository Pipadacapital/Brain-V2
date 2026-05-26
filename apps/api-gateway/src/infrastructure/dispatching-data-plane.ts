// @paradigm: sql
// DispatchingDataPlane (Slice E) — the ONE DataPlanePort the router talks to. It
// routes per call by workspace_id:
//   • Sugandh-Lok anchor  → the shared StubDataPlane (the DEMO seed — Founder: keep it).
//   • any other workspace → a per-workspace LocalDbDataPlane reading its OWN ingested
//     connector facts from local Postgres (persona P-001/P-003).
// Both speak the SAME DataPlanePort contract (Single-Primitive Rule) — there is no
// second code path in the router. The non-data methods (upsertGoal, push token,
// insights submit, members/settings/integrations/backfill, morning brief) are
// delegated to the routed plane unchanged.

import type {
  DataPlanePort,
  DateRange,
  GoalUpsertInput,
  ResponseKind,
} from '../domain/proto-types.js';
import { StubDataPlane, SUGANDH_LOK_WORKSPACE_ID } from './loopback-data-plane.js';
import { LocalDbDataPlane } from './local-db-data-plane.js';

export class DispatchingDataPlane implements DataPlanePort {
  private readonly local = new Map<string, LocalDbDataPlane>();

  constructor(private readonly sugandh: StubDataPlane) {}

  /** Route to the seed plane for Sugandh, else a per-workspace local-DB plane. */
  private plane(workspaceId: string): DataPlanePort {
    if (workspaceId === SUGANDH_LOK_WORKSPACE_ID) return this.sugandh;
    let p = this.local.get(workspaceId);
    if (!p) {
      p = new LocalDbDataPlane(workspaceId);
      this.local.set(workspaceId, p);
    }
    return p;
  }

  // --- analytics reads (routed by params.workspace_id) ------------------------
  queryMetrics(p: { workspace_id: string; definition_ids: string[]; date_range: DateRange; cursor?: string; page_size?: number }) {
    return this.plane(p.workspace_id).queryMetrics(p);
  }
  getKpiSummary(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getKpiSummary(p);
  }
  getPnlWaterfall(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getPnlWaterfall(p);
  }
  getCmWaterfall(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getCmWaterfall(p);
  }
  getPnlStatement(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getPnlStatement(p);
  }
  getStoreSummary(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getStoreSummary(p);
  }
  getRtoAnalytics(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getRtoAnalytics(p);
  }
  getCodPrepaid(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getCodPrepaid(p);
  }
  getLogistics(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getLogistics(p);
  }
  getPincodeIntelligence(p: Parameters<DataPlanePort['getPincodeIntelligence']>[0]) {
    return this.plane(p.workspace_id).getPincodeIntelligence(p);
  }
  getMarketingEfficiency(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getMarketingEfficiency(p);
  }
  getAcquisitionSummary(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getAcquisitionSummary(p);
  }
  getDistributions(p: Parameters<DataPlanePort['getDistributions']>[0]) {
    return this.plane(p.workspace_id).getDistributions(p);
  }
  getCohortMatrix(p: Parameters<DataPlanePort['getCohortMatrix']>[0]) {
    return this.plane(p.workspace_id).getCohortMatrix(p);
  }
  getLtvSummary(p: Parameters<DataPlanePort['getLtvSummary']>[0]) {
    return this.plane(p.workspace_id).getLtvSummary(p);
  }
  getProductPerformance(p: Parameters<DataPlanePort['getProductPerformance']>[0]) {
    return this.plane(p.workspace_id).getProductPerformance(p);
  }
  getInventoryLevels(p: Parameters<DataPlanePort['getInventoryLevels']>[0]) {
    return this.plane(p.workspace_id).getInventoryLevels(p);
  }
  getFirstProductCascade(p: Parameters<DataPlanePort['getFirstProductCascade']>[0]) {
    return this.plane(p.workspace_id).getFirstProductCascade(p);
  }
  getGoalAttainment(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getGoalAttainment(p);
  }
  upsertGoal(p: GoalUpsertInput) {
    return this.plane(p.workspace_id).upsertGoal(p);
  }
  getCostStack(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getCostStack(p);
  }
  getFestivalCalendar(p: Parameters<DataPlanePort['getFestivalCalendar']>[0]) {
    return this.plane(p.workspace_id).getFestivalCalendar(p);
  }
  getCalendarReport(p: Parameters<DataPlanePort['getCalendarReport']>[0]) {
    return this.plane(p.workspace_id).getCalendarReport(p);
  }
  getLifecycleStates(p: { workspace_id: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getLifecycleStates(p);
  }
  getOrderTimings(p: Parameters<DataPlanePort['getOrderTimings']>[0]) {
    return this.plane(p.workspace_id).getOrderTimings(p);
  }
  getEmailSmsPerformance(p: Parameters<DataPlanePort['getEmailSmsPerformance']>[0]) {
    return this.plane(p.workspace_id).getEmailSmsPerformance(p);
  }
  getMorningBrief(p: { workspace_id: string; date: string }) {
    return this.plane(p.workspace_id).getMorningBrief(p);
  }
  getPageInsights(p: { workspace_id: string; page: string; date_range: DateRange }) {
    return this.plane(p.workspace_id).getPageInsights(p);
  }
  submitInsightResponse(p: {
    workspace_id: string;
    insight_id: string;
    response_kind: ResponseKind;
    edit_payload?: string;
    idempotency_key: string;
  }) {
    return this.plane(p.workspace_id).submitInsightResponse(p);
  }
  registerPushToken(p: { workspace_id: string; user_id: string; device_id: string; expo_push_token: string }) {
    return this.plane(p.workspace_id).registerPushToken(p);
  }
  getWorkspaceMembers(p: { workspace_id: string }) {
    return this.plane(p.workspace_id).getWorkspaceMembers(p);
  }
  getWorkspaceSettings(p: { workspace_id: string }) {
    return this.plane(p.workspace_id).getWorkspaceSettings(p);
  }
  getIntegrations(p: { workspace_id: string }) {
    return this.plane(p.workspace_id).getIntegrations(p);
  }
  getBackfillStatus(p: { workspace_id: string }) {
    return this.plane(p.workspace_id).getBackfillStatus(p);
  }
  getDailySales(p: Parameters<DataPlanePort['getDailySales']>[0]) {
    return this.plane(p.workspace_id).getDailySales(p);
  }
  getDailyAcquisition(p: Parameters<DataPlanePort['getDailyAcquisition']>[0]) {
    return this.plane(p.workspace_id).getDailyAcquisition(p);
  }
}

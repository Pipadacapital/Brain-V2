// @paradigm: sql
// Brain api-gateway tRPC router — the V1 handshake contract.
// This file is the HANDSHAKE POINT: typed client exports unblock Ananya + Karan.
//
// Paradigm enforcement (CF-C6-RENDER-ONLY-1): ZERO arithmetic in this file.
// All numeric values come from the data plane (DataPlanePort). The only
// transformation allowed is formatMoney() at the edge.
//
// CF-C6-REGISTRY-ONLY-BFF-1: every KPI output field traces to a registry
// definition_id via assertKpiRegistryTraceability().
//
// CF-C6-BIGINT-JSON-1: bigint fields round-trip faithfully via superjson.
//   _mu fields are typed as bigint; the transformer handles serialization.
//
// CF-C6-MB-IDEMPOTENCY-1: morningBrief.submitResponse uses Redis dedup
//   before writing to ai.decision_log.
//
// Cursor pagination ONLY (no offset) — CF-API-CURSOR-1.

import { router } from './trpc.js';
import type { IdempotencyStore } from '../domain/idempotency.js';
import type { DataPlanePort } from '../domain/proto-types.js';
// Phase-E router split: every domain router is a thin factory under interfaces/trpc/.
import { makeAuthRouter } from '../interfaces/trpc/make-auth-router.js';
import { makeWorkspaceRouter } from '../interfaces/trpc/make-workspace-router.js';
import { makeUserRouter } from '../interfaces/trpc/make-user-router.js';
import { makeOnboardingRouter } from '../interfaces/trpc/make-onboarding-router.js';
import { makeInvitationRouter } from '../interfaces/trpc/make-invitation-router.js';
import { makeNotificationsRouter } from '../interfaces/trpc/make-notifications-router.js';
import { makeMetricsRouter } from '../interfaces/trpc/make-metrics-router.js';
import { makeStoreRouter } from '../interfaces/trpc/make-store-router.js';
import { makePnlRouter } from '../interfaces/trpc/make-pnl-router.js';
import { makeLogisticsRouter } from '../interfaces/trpc/make-logistics-router.js';
import { makeMarketingRouter } from '../interfaces/trpc/make-marketing-router.js';
import { makeCohortsRouter } from '../interfaces/trpc/make-cohorts-router.js';
import { makeLtvRouter } from '../interfaces/trpc/make-ltv-router.js';
import { makeCatalogRouter } from '../interfaces/trpc/make-catalog-router.js';
import { makeSettingsRouter } from '../interfaces/trpc/make-settings-router.js';
import { makeTeamRouter } from '../interfaces/trpc/make-team-router.js';
import { makeCalendarRouter } from '../interfaces/trpc/make-calendar-router.js';
import { makeLifecycleRouter } from '../interfaces/trpc/make-lifecycle-router.js';
import { makeMorningBriefRouter } from '../interfaces/trpc/make-morning-brief-router.js';
import { makeDeviceRouter } from '../interfaces/trpc/make-device-router.js';
import { makeInsightsRouter } from '../interfaces/trpc/make-insights-router.js';
import { makeConnectorsRouter } from '../interfaces/trpc/make-connectors-router.js';
import { makeAdminRouter } from '../interfaces/trpc/make-admin-router.js';

export function createBrainRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  // -------------------------------------------------------------------
  // auth router — extracted to interfaces/trpc/make-auth-router.ts (Phase-E split)
  // -------------------------------------------------------------------
  const authRouter = makeAuthRouter();

  // -------------------------------------------------------------------
  // workspace router
  // -------------------------------------------------------------------
  const workspaceRouter = makeWorkspaceRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // user router (Slice C) — identity tier: works for a no-membership user.
  // -------------------------------------------------------------------
  const userRouter = makeUserRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // onboarding router (Slice C) — identity tier: the user has no workspace yet.
  // -------------------------------------------------------------------
  const onboardingRouter = makeOnboardingRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // invitation router (Slice C) — identity tier: a joiner may have no membership.
  // -------------------------------------------------------------------
  const invitationRouter = makeInvitationRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // notifications router — identity tier (user-scoped, workspace-optional).
  // Notifications belong to a USER and may target a workspace OR be global.
  // RLS-safe: every query in core-notifications filters by user_id = ctx.sub.
  // -------------------------------------------------------------------
  const notificationsRouter = makeNotificationsRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // metrics router — workspace tier, requireRole(ANALYST)
  // CF-C6-REGISTRY-ONLY-BFF-1: all fields trace to registry definition_ids.
  // CF-C6-BIGINT-JSON-1: _mu fields are bigint (superjson handles wire format).
  // -------------------------------------------------------------------
  const metricsRouter = makeMetricsRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // store router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-1 (feat-store-order-fact-layer): the canonical store/order
  // fact layer + revenue ladder. CF-C6-RENDER-ONLY-1: zero arithmetic here —
  // all values from the data plane. CF-C6-REGISTRY-ONLY-BFF-1: every ladder
  // step traces to a registry definition_id. CF-C6-BIGINT-JSON-1: _mu = bigint.
  // -------------------------------------------------------------------
  const storeRouter = makeStoreRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // pnl router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-2 (feat-pnl-cm-waterfall): the honest P&L statement + CM waterfall.
  // CF-C6-RENDER-ONLY-1: zero arithmetic here — values from the data plane.
  // CF-C6-REGISTRY-ONLY-BFF-1: every line/step traces to a registry definition_id.
  // CF-C6-BIGINT-JSON-1: _mu = bigint over superjson.
  // -------------------------------------------------------------------
  const pnlRouter = makePnlRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // logistics router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-3 (feat-rto-cod-economics): RTO/COD/logistics/pincode economics.
  // CF-C6-RENDER-ONLY-1: zero arithmetic here — values from the data plane.
  // CF-C6-REGISTRY-ONLY-BFF-1: every metric field traces a registry definition_id.
  // CF-C6-BIGINT-JSON-1: _mu = bigint over superjson.
  // -------------------------------------------------------------------
  const logisticsRouter = makeLogisticsRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // marketing router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-4 (feat-marketing-acquisition): MER/aMER/CAC + acquisition + distributions.
  // aMER uses acquisition-classified spend; ROAS/ACOS display_only; pamer_bp decommissioned.
  // -------------------------------------------------------------------
  const marketingRouter = makeMarketingRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // cohorts router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-5 (feat-cohorts-ltv): cohort retention/repeat heatmap (CM3).
  // Cohorts use CM3 (Finding 1); payback = cumulative bucket-walk (Finding 3);
  // cohort_ltv feeds ltv_cac_bp (Finding 4). The phantom cac_payback_months is gone.
  // -------------------------------------------------------------------
  const cohortsRouter = makeCohortsRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // ltv router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-5 (feat-cohorts-ltv): LTV-by-dimension (CM2). NO CAC/payback here
  // (those are cohort concepts — Finding 2). Dimensioned + weighted + paginated.
  // -------------------------------------------------------------------
  const ltvRouter = makeLtvRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // catalog router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-6 (feat-catalog-inventory): product performance (CM1, NOT per-SKU CM2),
  // inventory levels (sell-through + days-left, NOT turnover), first-product cascade
  // (per-first-product second-order-rate, NOT slice-5 rr90).
  // -------------------------------------------------------------------
  const catalogRouter = makeCatalogRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // settings router — workspace tier (Phase-2 slice-7, feat-finance-settings-goals)
  // goals (directional RAG + idempotent upsert), costs (resolved stack feeding CM),
  // festivals (India template calendar; CRUD deferred). festival learned-lift is a
  // PHANTOM (Rohan Finding 2) — never computed.
  // -------------------------------------------------------------------
  const settingsRouter = makeSettingsRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // team router — workspace tier.
  // Phase-2 parity-38 feat-parity-w6b: full CRUD (invite/changeRole/remove/revokeInvite/transfer).
  // 🚨 PII: member email/name. Reads ANALYST-gated, writes MANAGER/OWNER-gated.
  // Role invariants (per legacy):
  //   - OWNER/MANAGER can invite; only OWNER can change/remove another OWNER's role.
  //   - MANAGER cannot remove an OWNER.
  //   - Only OWNER can transfer ownership.
  // Email SENDING is honest-deferred: invite creates the DB row + token only.
  // -------------------------------------------------------------------
  const teamRouter = makeTeamRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // calendar router — workspace tier (Phase-2 slice-7)
  // The period grid (day/week/month) with marketing-action overlays + per-cell directional RAG.
  // Reuses slice-1/2/4 primitives (net_revenue/cm3/mer/amer/cac/aov) — no new metric.
  // -------------------------------------------------------------------
  const calendarRouter = makeCalendarRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // lifecycle router — workspace tier, requireRole(ANALYST). READ/ANALYTICS ONLY.
  // Phase-2 slice-8 (feat-lifecycle-timings-email): customer-lifecycle states
  // (recency-vs-empirical-percentile, NOT RFM scoring), order timings (inter-order
  // gaps + reactivation window), email/SMS PERFORMANCE reporting.
  // 🚨 COMPLIANCE (Shreya S4): every procedure is a READ .query — there is NO .mutation,
  // NO send/dispatch/audience surface. These report on PAST performance, never send.
  // -------------------------------------------------------------------
  const lifecycleRouter = makeLifecycleRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // morningBrief router — workspace tier
  // CF-C6-MB-IDEMPOTENCY-1: submitResponse uses Redis dedup.
  // CF-C6-MB-GRADUATED-LABEL-1: status is server-driven.
  // -------------------------------------------------------------------
  const morningBriefRouter = makeMorningBriefRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // device router — workspace tier (mobile-additive)
  // CF-C6-MB-PUSH-TOKEN-1: token registration only; SEND is out of scope.
  // -------------------------------------------------------------------
  const deviceRouter = makeDeviceRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // insights router — Phase-2 slice-9 (feat-ai-insight-narration).
  // @paradigm small_llm (Haiku) narration; signals are deterministic sql.
  // 🚨 READ-ONLY: every procedure is a `.query`. There is NO `.mutation`, no
  //    send/dispatch/execute path. The narration reaches NO write/MCP tool
  //    (recommendation-only-until-graduated). A structural test asserts no mutation.
  // CF-S9-FAITHFULNESS-1: assertPageInsightGates re-validates that every narrated
  //    number is grounded in the deterministic signal set BEFORE render
  //    (defense in depth over the intelligence-service gateway).
  // CF-S9-NO-TOOL-REACH-1 + CF-S9-INJECTION-1 enforced in the same gate.
  // -------------------------------------------------------------------
  const insightsRouter = makeInsightsRouter(dataPlane, idempotencyStore);

  // -------------------------------------------------------------------
  // connectors router (Slice D) — live integrations OAuth + token custody.
  // @paradigm io. READ integrations (Shopify/Meta/Google) — NO outbound send,
  // NO DLT/NCPR/WhatsApp surface. Tokens are SECRET: persisted ENCRYPTED at rest
  // (AES-256-GCM, RLS-scoped) via core-service custody; the token VALUE is NEVER
  // returned by any procedure here (status only). core-service owns the logic.
  // -------------------------------------------------------------------
  const connectorsRouter = makeConnectorsRouter(dataPlane, idempotencyStore);

  // Platform-admin (SUPERADMIN) — the one cross-tenant surface; argless (imports
  // core-service cross-workspace use-cases directly, no data-plane/idempotency).
  const adminRouter = makeAdminRouter();

  // -------------------------------------------------------------------
  // Root router
  // -------------------------------------------------------------------
  return router({
    auth: authRouter,
    workspace: workspaceRouter,
    user: userRouter,
    onboarding: onboardingRouter,
    invitation: invitationRouter,
    notifications: notificationsRouter,
    metrics: metricsRouter,
    store: storeRouter,
    pnl: pnlRouter,
    logistics: logisticsRouter,
    marketing: marketingRouter,
    cohorts: cohortsRouter,
    ltv: ltvRouter,
    catalog: catalogRouter,
    settings: settingsRouter,
    team: teamRouter,
    calendar: calendarRouter,
    lifecycle: lifecycleRouter,
    morningBrief: morningBriefRouter,
    insights: insightsRouter,
    device: deviceRouter,
    connectors: connectorsRouter,
    admin: adminRouter,
  });
}

export type BrainRouter = ReturnType<typeof createBrainRouter>;

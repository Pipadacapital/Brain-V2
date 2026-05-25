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

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { WORKSPACE_ROLE_LEVEL } from '@brain/core-auth';
import { requireRole } from '@brain/core-auth';
import {
  router,
  workspaceProc,
  authedProc,
  publicProc,
} from './trpc.js';
import {
  assertKpiRegistryTraceability,
  assertWaterfallDefinitionId,
  assertLadderDefinitionId,
  getMetricScale,
} from '../domain/registry-mapper.js';
import {
  checkIdempotency,
  storeIdempotencyResult,
  type IdempotencyStore,
} from '../domain/idempotency.js';
import type { DataPlanePort } from '../domain/proto-types.js';

// ---------------------------------------------------------------------------
// Router factory — accepts the DataPlanePort and IdempotencyStore as deps.
// This enables clean test injection without module mocking.
// CF-C6-DATA-SEAM-1: DataPlanePort is the ONLY data path. No direct DB access.
// ---------------------------------------------------------------------------

export function createBrainRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  // -------------------------------------------------------------------
  // auth router
  // -------------------------------------------------------------------
  const authRouter = router({
    /** Return the current session claim (authed tier). */
    session: authedProc.query(({ ctx }) => {
      return {
        userId: ctx.claim.userId,
        workspaceId: ctx.claim.workspaceId,
        workspaceRole: ctx.claim.workspaceRole,
        requestId: ctx.requestId,
      };
    }),
  });

  // -------------------------------------------------------------------
  // workspace router
  // -------------------------------------------------------------------
  const workspaceRouter = router({
    /** List workspaces the caller has access to (authed tier). */
    list: authedProc.query(async ({ ctx }) => {
      // Production: query core-service workspace membership.
      // For Phase-0 harness: returns the single workspace from the claim.
      return {
        workspaces: [
          {
            workspaceId: ctx.claim.workspaceId,
            role: ctx.claim.workspaceRole,
          },
        ],
        requestId: ctx.requestId,
      };
    }),

    /** Switch active workspace (authed tier). */
    switch: authedProc
      .input(
        z.object({
          workspaceId: z.string().uuid('workspace_id must be a UUID'),
        }),
      )
      .mutation(({ ctx, input }) => {
        // In Phase-0: accept if workspaceId matches claim (tenancy enforced at callers).
        // Production: validate workspace membership in core-service.
        return {
          workspaceId: input.workspaceId,
          requestId: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // metrics router — workspace tier, requireRole(ANALYST)
  // CF-C6-REGISTRY-ONLY-BFF-1: all fields trace to registry definition_ids.
  // CF-C6-BIGINT-JSON-1: _mu fields are bigint (superjson handles wire format).
  // -------------------------------------------------------------------
  const metricsRouter = router({
    /** KPI summary strip for a date range. */
    kpiSummary: workspaceProc
      .input(
        z.object({
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        // CF-C6-GATEWAY-TENANCY-1: requireRole before data-plane call.
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `metrics.kpiSummary requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.getKpiSummary({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });

        // G-REGISTRY-ONLY: assert every field traces to registry (runtime check).
        assertKpiRegistryTraceability(result.summary);

        return {
          summary: result.summary,
          data_epoch: result.data_epoch,       // CF-C6-AS-OF-STAMP-1
          request_id: ctx.requestId,
        };
      }),

    /** P&L / CM waterfall steps (Visx chart data). */
    pnlWaterfall: workspaceProc
      .input(
        z.object({
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `metrics.pnlWaterfall requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.getPnlWaterfall({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });

        // G-REGISTRY-ONLY: validate each waterfall step's definition_id.
        for (const step of result.steps) {
          assertWaterfallDefinitionId(step);
        }

        return {
          steps: result.steps,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    /** Cursor-paginated raw metric rows. OFFSET BANNED. CF-API-CURSOR-1. */
    queryRange: workspaceProc
      .input(
        z.object({
          definition_ids: z.array(z.string()).min(1),
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          cursor: z.string().optional(),
          page_size: z.number().int().min(1).max(365).default(90),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `metrics.queryRange requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.queryMetrics({
          workspace_id: ctx.workspaceId,
          definition_ids: input.definition_ids,
          date_range: { start: input.date_start, end: input.date_end },
          cursor: input.cursor,
          page_size: input.page_size,
        });

        return {
          rows: result.rows,
          data_epoch: result.data_epoch,
          next_cursor: result.next_cursor,
          request_id: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // store router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-1 (feat-store-order-fact-layer): the canonical store/order
  // fact layer + revenue ladder. CF-C6-RENDER-ONLY-1: zero arithmetic here —
  // all values from the data plane. CF-C6-REGISTRY-ONLY-BFF-1: every ladder
  // step traces to a registry definition_id. CF-C6-BIGINT-JSON-1: _mu = bigint.
  // -------------------------------------------------------------------
  const storeRouter = router({
    /** Store summary + revenue ladder for a date range. requireRole(ANALYST). */
    summary: workspaceProc
      .input(
        z.object({
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        // CF-C6-GATEWAY-TENANCY-1: requireRole before data-plane call.
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `store.summary requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.getStoreSummary({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });

        // G-REGISTRY-ONLY: every ladder step must trace to a registry definition_id.
        for (const step of result.ladder) {
          assertLadderDefinitionId(step);
        }

        return {
          summary: result.summary,
          ladder: result.ladder,
          data_epoch: result.data_epoch,   // CF-C6-AS-OF-STAMP-1
          request_id: ctx.requestId,
        };
      }),

    /** Revenue ladder only (the /store strip). requireRole(ANALYST). */
    revenueLadder: workspaceProc
      .input(
        z.object({
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `store.revenueLadder requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.getStoreSummary({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });

        for (const step of result.ladder) {
          assertLadderDefinitionId(step);
        }

        return {
          ladder: result.ladder,
          currency_code: result.summary.currency_code,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // morningBrief router — workspace tier
  // CF-C6-MB-IDEMPOTENCY-1: submitResponse uses Redis dedup.
  // CF-C6-MB-GRADUATED-LABEL-1: status is server-driven.
  // -------------------------------------------------------------------
  const morningBriefRouter = router({
    /** Get the Morning Brief for a workspace+date. requireRole(ANALYST). */
    get: workspaceProc
      .input(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `morningBrief.get requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const brief = await dataPlane.getMorningBrief({
          workspace_id: ctx.workspaceId,
          date: input.date,
        });

        return {
          items: brief.items,
          data_epoch: brief.data_epoch,     // CF-C6-AS-OF-STAMP-1
          freshness_label: brief.freshness_label,
          request_id: ctx.requestId,
        };
      }),

    /**
     * Submit approve/reject/edit response to a Morning Brief insight.
     * CF-C6-MB-IDEMPOTENCY-1: idempotency_key required; Redis dedup guards the write.
     * CF-C6-MB-GRADUATED-LABEL-1: status is server-driven (Day-1 = LOGGED_AS_VOTE).
     * requireRole(MANAGER): logging an approval requires at least MANAGER.
     */
    submitResponse: workspaceProc
      .input(
        z.object({
          insight_id: z.string().uuid('insight_id must be a UUID'),
          response_kind: z.enum(['APPROVE', 'REJECT', 'EDIT']),
          edit_payload: z.string().optional(),
          /** CF-C6-MB-IDEMPOTENCY-1: caller-generated, generated at action-initiation. */
          idempotency_key: z.string().uuid('idempotency_key must be a UUID'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // requireRole(MANAGER) to log an approval-vote.
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `morningBrief.submitResponse requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }

        // CF-C6-MB-IDEMPOTENCY-1: check Redis dedup BEFORE writing to ai.decision_log.
        // G-IDEMPOTENT gate: this is the dedup check — removing it = double-write = RED.
        const cached = await checkIdempotency(
          idempotencyStore as Parameters<typeof checkIdempotency>[0],
          ctx.workspaceId,
          input.idempotency_key,
        );

        if (cached !== null) {
          // Return cached response — same key, same result, no second write.
          // idempotent_replay is flipped to true so the caller knows this was a replay.
          const parsed = JSON.parse(cached) as {
            decision_log_row_id: string;
            status: 'LOGGED_AS_VOTE' | 'QUEUED_FOR_EXECUTION';
            request_id: string;
            idempotent_replay: boolean;
          };
          return { ...parsed, idempotent_replay: true };
        }

        // Not cached: call the data plane to write the decision log.
        const result = await dataPlane.submitInsightResponse({
          workspace_id: ctx.workspaceId,
          insight_id: input.insight_id,
          response_kind: input.response_kind as 'APPROVE' | 'REJECT' | 'EDIT',
          edit_payload: input.edit_payload,
          idempotency_key: input.idempotency_key,
        });

        const response = {
          decision_log_row_id: result.decision_log_row_id,
          status: result.status,
          request_id: ctx.requestId,
          idempotent_replay: false,
        };

        // Store in Redis for dedup TTL 24h.
        await storeIdempotencyResult(
          idempotencyStore as Parameters<typeof storeIdempotencyResult>[0],
          ctx.workspaceId,
          input.idempotency_key,
          JSON.stringify(response),
        );

        return response;
      }),
  });

  // -------------------------------------------------------------------
  // device router — workspace tier (mobile-additive)
  // CF-C6-MB-PUSH-TOKEN-1: token registration only; SEND is out of scope.
  // -------------------------------------------------------------------
  const deviceRouter = router({
    /** Register / rotate an Expo push token. Idempotent upsert. */
    registerPushToken: workspaceProc
      .input(
        z.object({
          user_id: z.string().uuid('user_id must be a UUID'),
          device_id: z.string().min(1),
          expo_push_token: z.string().startsWith('ExponentPushToken'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'VIEWER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `device.registerPushToken requires VIEWER role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.registerPushToken({
          workspace_id: ctx.workspaceId,
          user_id: input.user_id,
          device_id: input.device_id,
          expo_push_token: input.expo_push_token,
        });

        return {
          registered: result.registered,
          updated_at: result.updated_at,
          request_id: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // Root router
  // -------------------------------------------------------------------
  return router({
    auth: authRouter,
    workspace: workspaceRouter,
    metrics: metricsRouter,
    store: storeRouter,
    morningBrief: morningBriefRouter,
    device: deviceRouter,
  });
}

export type BrainRouter = ReturnType<typeof createBrainRouter>;

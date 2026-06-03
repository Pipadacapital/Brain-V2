// @paradigm: sql
// Thin tRPC router — morningBrief domain (Phase-E router split). Extracted verbatim from
// application/router.ts; behaviour byte-identical. createBrainRouter composes this factory.
// CF-C6-RENDER-ONLY-1 + CF-C6-REGISTRY-ONLY-BFF-1 preserved (no arithmetic; registry-traced).

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { requireRole } from '@brain/core-auth';
import {
  router,
  workspaceProc,
} from '../../application/trpc.js';
import {
  checkIdempotency,
  storeIdempotencyResult,
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import type { DataPlanePort } from '../../domain/proto-types.js';

export function makeMorningBriefRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
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
}

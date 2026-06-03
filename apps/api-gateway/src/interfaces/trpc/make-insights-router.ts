// @paradigm: sql
// Thin tRPC router — insights domain (Phase-E router split). Extracted verbatim from
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
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import { assertPageInsightGates } from '../../domain/insight-gates.js';
import type { DataPlanePort } from '../../domain/proto-types.js';

export function makeInsightsRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** Grounded AI narration for a page (READ). requireRole(ANALYST). */
    forPage: workspaceProc
      .input(
        z.object({
          page: z.enum(['pnl', 'store', 'dashboard']),
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `insights.forPage requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const { result } = await dataPlane.getPageInsights({
          workspace_id: ctx.workspaceId,
          page: input.page,
          date_range: { start: input.date_start, end: input.date_end },
        });

        // CF-S9: fail-closed BEFORE render — faithfulness + injection + no-tool-reach.
        // Throws (→ INTERNAL error, no narration leaves the BFF) if ANY number in a
        // narration is not in the deterministic signal set, if a fence/role-control
        // sequence survived into output, or if any narration exposes an executable field.
        assertPageInsightGates(result);

        return {
          page: result.page,
          period: result.period,
          signals: result.signals,
          narrations: result.narrations,
          faithfulness_ok: result.faithfulness_ok,
          model_used: result.model_used,
          cached: result.cached,
          paradigm: result.paradigm,
          data_epoch: result.data_epoch, // CF-C6-AS-OF-STAMP-1
          request_id: ctx.requestId,
        };
      }),
  });
}

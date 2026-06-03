// @paradigm: sql
// Thin tRPC router — cohorts domain (Phase-E router split). Extracted verbatim from
// application/router.ts; behaviour byte-identical. createBrainRouter composes this factory.
// CF-C6-RENDER-ONLY-1 + CF-C6-REGISTRY-ONLY-BFF-1 preserved (no arithmetic; registry-traced).

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { requireRole } from '@brain/core-auth';
import {
  router,
  workspaceProc,
} from '../../application/trpc.js';
import { assertCohortLtvDefinitionId } from '../../domain/registry-mapper.js';
import {
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import type { DataPlanePort } from '../../domain/proto-types.js';
import { dateInput } from './shared-inputs.js';

export function makeCohortsRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** Cohort retention/repeat matrix. requireRole(ANALYST). */
    matrix: workspaceProc
      .input(
        dateInput.extend({
          metric: z.enum(['cm3', 'revenue', 'repeat', 'repurchase']).optional(),
          mode: z.enum(['post', 'cumulative', 'incr', 'pct', 'ltvcac']).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `cohorts.matrix requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getCohortMatrix({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: { metric: input.metric, mode: input.mode },
        });
        assertCohortLtvDefinitionId('cac_mu');
        assertCohortLtvDefinitionId('cohort_ltv_mu');
        assertCohortLtvDefinitionId('ltv_cac_bp');
        assertCohortLtvDefinitionId('repeat_rate_bp');
        return {
          result: result.result,
          rows: result.result.rows,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),
  });
}

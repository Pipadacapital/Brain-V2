// @paradigm: sql
// Thin tRPC router — ltv domain (Phase-E router split). Extracted verbatim from
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

export function makeLtvRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** LTV curve by dimension. requireRole(ANALYST). */
    summary: workspaceProc
      .input(
        dateInput.extend({
          metric: z.enum(['cm2', 'revenue', 'repeat_rate']).optional(),
          mode: z.enum(['cumulative', 'post_acq', 'incremental']).optional(),
          dimension: z
            .enum([
              'product', 'variant', 'vendor', 'collection', 'product_type',
              'product_tags', 'order_tags', 'discount_codes', 'discount_pct', 'customer_id',
            ])
            .optional(),
          search: z.string().optional(),
          page: z.number().int().min(1).optional(),
          page_size: z.number().int().min(10).max(100).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `ltv.summary requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getLtvSummary({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: {
            metric: input.metric,
            mode: input.mode,
            dimension: input.dimension,
            search: input.search,
            page: input.page,
            page_size: input.page_size,
          },
        });
        assertCohortLtvDefinitionId('cm2_mu');
        assertCohortLtvDefinitionId('repeat_rate_bp');
        return {
          result: result.result,
          rows: result.result.rows,
          total_rows: result.result.total_rows,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),
  });
}

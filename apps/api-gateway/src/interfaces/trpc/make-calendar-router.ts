// @paradigm: sql
// Thin tRPC router — calendar domain (Phase-E router split). Extracted verbatim from
// application/router.ts; behaviour byte-identical. createBrainRouter composes this factory.
// CF-C6-RENDER-ONLY-1 + CF-C6-REGISTRY-ONLY-BFF-1 preserved (no arithmetic; registry-traced).

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { requireRole } from '@brain/core-auth';
import {
  router,
  workspaceProc,
} from '../../application/trpc.js';
import { assertSettingsDefinitionId } from '../../domain/registry-mapper.js';
import {
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import type { DataPlanePort } from '../../domain/proto-types.js';
import { dateInput } from './shared-inputs.js';

export function makeCalendarRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    report: workspaceProc
      .input(dateInput.extend({ grain: z.enum(['day', 'week', 'month']).optional() }))
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `calendar.report requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getCalendarReport({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: { grain: input.grain },
        });
        // Calendar reuses the canonical revenue/cm3 primitives — no learned festival lift.
        assertSettingsDefinitionId('net_revenue_mu');
        return {
          result: result.result,
          rows: result.result.rows,
          total_rows: result.result.total_rows,
          grain: result.result.grain,
          currency_code: result.result.currency_code,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),
  });
}

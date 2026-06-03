// @paradigm: sql
// Thin tRPC router — metrics domain (Phase-E router split). Extracted verbatim from
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
  assertKpiRegistryTraceability,
  assertWaterfallDefinitionId,
} from '../../domain/registry-mapper.js';
import {
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import type { DataPlanePort } from '../../domain/proto-types.js';

export function makeMetricsRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
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

        // Phase-2 slice-2: getPnlWaterfall now delegates to the honest getCmWaterfall
        // (ONE CM-waterfall source of truth). metrics.pnlWaterfall is the Child-6 alias
        // kept so the existing web component query key keeps working; pnl.cmWaterfall is
        // the canonical name. No second computation path.
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
}

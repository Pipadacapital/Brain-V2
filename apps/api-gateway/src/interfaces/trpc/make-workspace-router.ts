// @paradigm: sql
// Thin tRPC router — workspace domain (Phase-E router split). Extracted verbatim from
// application/router.ts; behaviour byte-identical. createBrainRouter composes this factory.
// CF-C6-RENDER-ONLY-1 + CF-C6-REGISTRY-ONLY-BFF-1 preserved (no arithmetic; registry-traced).

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  router,
  workspaceProc,
  identityProc,
} from '../../application/trpc.js';
import { listWorkspaces } from '@brain/core-onboarding';
import {
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import type { DataPlanePort } from '../../domain/proto-types.js';

export function makeWorkspaceRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /**
     * List the workspaces the verified caller belongs to (identity tier — works
     * even mid-onboarding). Slice C: REAL multi-workspace list from the local DB
     * (core-service listWorkspaces), keyed on the verified sub. NOT the claim.
     */
    list: identityProc.query(async ({ ctx }) => {
      const workspaces = await listWorkspaces(ctx.identity.sub);
      return {
        workspaces: workspaces.map((w) => ({
          workspaceId: w.workspaceId,
          slug: w.slug,
          name: w.name,
          role: w.role,
          // plan is not stored per-workspace in the local schema yet;
          // 'Growth' is the honest default (matches getWorkspaceSettings).
          plan: 'Growth' as string,
        })),
        requestId: ctx.requestId,
      };
    }),

    /**
     * Data-reconciliation signal. The dashboard asks: does this workspace have
     * ANY analytics data yet? If not, it renders the honest
     * "no data yet — connect a store" empty-state instead of empty rows.
     *
     * Production behaviour: probes the store summary on a wide date range and
     * returns hasSeedData=true iff at least one order has been ingested. The
     * old `workspaceId === SUGANDH_LOK_WORKSPACE_ID` shortcut was the seed-plane
     * marker; it is gone (Founder destub 2026-05-26). The field name stays
     * for backward-compat with the dashboard component.
     */
    dataAvailability: workspaceProc.query(async ({ ctx }) => {
      // A wide window: any orders since the start of Brain time. We don't need
      // to count them — getStoreSummary surfaces hasData based on order count.
      const result = await dataPlane.getStoreSummary({
        workspace_id: ctx.workspaceId,
        date_range: { start: '2020-01-01', end: '2099-12-31' },
      });
      return {
        hasSeedData: (result?.summary?.order_count ?? 0n) > 0n,
        workspaceId: ctx.workspaceId,
        requestId: ctx.requestId,
      };
    }),

    /**
     * Switch active workspace (identity tier). Slice C: validates REAL membership
     * from the DB (multi-workspace capable). FORBIDDEN for a workspace the verified
     * user is NOT a member of. (Replaces the slice-A claim-equality check, which
     * was a single-workspace stopgap.)
     */
    switch: identityProc
      .input(
        z.object({
          workspaceId: z.string().uuid('workspace_id must be a UUID'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const workspaces = await listWorkspaces(ctx.identity.sub);
        const match = workspaces.find((w) => w.workspaceId === input.workspaceId);
        if (!match) {
          // Not a member of the requested workspace → spoof / unauthorized switch.
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              `workspace.switch denied: the verified user is not a member of the ` +
              `requested workspace. request_id=${ctx.requestId}`,
          });
        }
        return {
          workspaceId: match.workspaceId,
          role: match.role,
          requestId: ctx.requestId,
        };
      }),
  });
}

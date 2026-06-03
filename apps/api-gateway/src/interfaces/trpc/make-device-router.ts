// @paradigm: sql
// Thin tRPC router — device domain (Phase-E router split). Extracted verbatim from
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
import type { DataPlanePort } from '../../domain/proto-types.js';

export function makeDeviceRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** Register / rotate an Expo push token. Idempotent upsert. */
    registerPushToken: workspaceProc
      // S4 (Slice A): user_id is NOT a client input — it is derived from the
      // verified claim. A client must not be able to register a push token on
      // behalf of another user.
      .input(
        z.object({
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
          user_id: ctx.claim.userId, // S4: from verified claim, never client input
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
}

// @paradigm: sql
// Thin tRPC router — notifications domain (Phase-E router split). Extracted verbatim from
// application/router.ts; behaviour byte-identical. createBrainRouter composes this factory.
// CF-C6-RENDER-ONLY-1 + CF-C6-REGISTRY-ONLY-BFF-1 preserved (no arithmetic; registry-traced).

import { z } from 'zod';
import {
  router,
  identityProc,
} from '../../application/trpc.js';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '@brain/core-notifications';
import {
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import type { DataPlanePort } from '../../domain/proto-types.js';

export function makeNotificationsRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** List the caller's notifications, newest first. Optional unread filter + ws scope. */
    list: identityProc
      .input(
        z.object({
          filter:      z.enum(['all', 'unread']).optional().default('all'),
          workspaceId: z.string().uuid().optional().nullable(),
          limit:       z.number().int().min(1).max(200).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const items = await listNotifications(ctx.identity.sub, {
          filter:      input.filter,
          workspaceId: input.workspaceId ?? null,
          limit:       input.limit,
        });
        return { items, requestId: ctx.requestId };
      }),

    /** Unread count for the shell badge — separate proc keeps it cheap to poll. */
    unreadCount: identityProc
      .input(z.object({ workspaceId: z.string().uuid().optional().nullable() }).optional())
      .query(async ({ ctx, input }) => {
        const count = await getUnreadCount(ctx.identity.sub, input?.workspaceId ?? null);
        return { count, requestId: ctx.requestId };
      }),

    /** Mark a single notification read (no-op if already read or not yours). */
    markRead: identityProc
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const changed = await markNotificationRead(ctx.identity.sub, input.id);
        return { changed, requestId: ctx.requestId };
      }),

    /** Mark every unread notification (optionally scoped to a workspace) read. */
    markAllRead: identityProc
      .input(z.object({ workspaceId: z.string().uuid().optional().nullable() }).optional())
      .mutation(async ({ ctx, input }) => {
        const updated = await markAllNotificationsRead(
          ctx.identity.sub,
          input?.workspaceId ?? null,
        );
        return { updated, requestId: ctx.requestId };
      }),
  });
}

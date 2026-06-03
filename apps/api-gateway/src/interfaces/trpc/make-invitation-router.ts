// @paradigm: sql
// Thin tRPC router — invitation domain (Phase-E router split). Extracted verbatim from
// application/router.ts; behaviour byte-identical. createBrainRouter composes this factory.
// CF-C6-RENDER-ONLY-1 + CF-C6-REGISTRY-ONLY-BFF-1 preserved (no arithmetic; registry-traced).

import { z } from 'zod';
import {
  router,
  identityProc,
} from '../../application/trpc.js';
import { acceptInvitation } from '@brain/core-onboarding';
import {
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import type { DataPlanePort } from '../../domain/proto-types.js';
import { mapOnboardingError } from './error-mappers.js';

export function makeInvitationRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /**
     * Accept an invitation by token (idempotent, RLS-scoped, role-mapped
     * EDITOR→MANAGER). Member-invite SENDING (email) is DEFERRED (honest affordance).
     */
    accept: identityProc
      .input(z.object({ token: z.string().min(1, 'invitation token required').max(200) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await acceptInvitation(input.token, {
            sub: ctx.identity.sub,
            email: ctx.identity.email,
          });
          return { ...result, requestId: ctx.requestId };
        } catch (err) {
          throw mapOnboardingError(err, ctx.requestId);
        }
      }),
  });
}

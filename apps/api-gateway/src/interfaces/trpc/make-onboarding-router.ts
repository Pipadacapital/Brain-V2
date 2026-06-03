// @paradigm: sql
// Thin tRPC router — onboarding domain (Phase-E router split). Extracted verbatim from
// application/router.ts; behaviour byte-identical. createBrainRouter composes this factory.
// CF-C6-RENDER-ONLY-1 + CF-C6-REGISTRY-ONLY-BFF-1 preserved (no arithmetic; registry-traced).

import { z } from 'zod';
import {
  router,
  identityProc,
} from '../../application/trpc.js';
import { completeOnboarding } from '@brain/core-onboarding';
import {
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import type { DataPlanePort } from '../../domain/proto-types.js';
import { mapOnboardingError } from './error-mappers.js';

export function makeOnboardingRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /**
     * Complete onboarding: in ONE transaction upsert the user, create the workspace
     * + OWNER membership in the LOCAL dev DB, then return the new workspaceId/slug.
     * The actual Shopify/Woo OAuth connect is DEFERRED to slice D — we persist the
     * store handle only.
     */
    complete: identityProc
      .input(
        z.object({
          fullName: z.string().max(200),
          jobRole: z.string().max(120).default(''),
          brandName: z.string().min(1, 'Brand name is required').max(200),
          slug: z.string().min(1, 'Workspace URL is required').max(80),
          industry: z.string().max(120).default(''),
          monthlyRevenue: z.string().max(60).default(''),
          platform: z.enum(['SHOPIFY', 'WOOCOMMERCE']),
          storeHandle: z.string().max(255).optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { workspaceId, slug } = await completeOnboarding({
            identity: { sub: ctx.identity.sub, email: ctx.identity.email, fullName: input.fullName },
            fullName: input.fullName,
            jobRole: input.jobRole,
            brandName: input.brandName,
            slug: input.slug,
            industry: input.industry,
            monthlyRevenue: input.monthlyRevenue,
            platform: input.platform,
            storeHandle: input.storeHandle ?? null,
          });
          // Return the workspace-scoped URL so the user lands inside the workspace they
          // just created (parity with legacy backend redirectTo `/w/${normalizedSlug}/dashboard`).
          return { workspaceId, slug, redirectTo: `/w/${slug}/dashboard`, requestId: ctx.requestId };
        } catch (err) {
          throw mapOnboardingError(err, ctx.requestId);
        }
      }),
  });
}

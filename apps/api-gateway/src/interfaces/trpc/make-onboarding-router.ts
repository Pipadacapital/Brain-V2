// @paradigm: sql
// Thin tRPC router — onboarding domain (Phase-E router split). Extracted verbatim from
// application/router.ts; behaviour byte-identical. createBrainRouter composes this factory.
// CF-C6-RENDER-ONLY-1 + CF-C6-REGISTRY-ONLY-BFF-1 preserved (no arithmetic; registry-traced).

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { requireRole } from '@brain/core-auth';
import {
  router,
  workspaceProc,
  authedProc,
  identityProc,
  publicProc,
} from '../../application/trpc.js';
import {
  ensureUser,
  completeOnboarding,
  acceptInvitation,
  listWorkspaces,
} from '@brain/core-onboarding';
import {
  initiateConnect,
  completeCallback,
  listConnectors,
  disconnect,
  syncConnector,
} from '@brain/core-connectors';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '@brain/core-notifications';
import {
  getProfile,
  updateProfile,
  deleteAccount,
  UserProfileError,
} from '@brain/core-user-profile';
import {
  listProductsForCogs,
  updateProductCogs,
  bulkUpdateProductCogs,
} from '@brain/core-product-cogs';
import {
  listOrders,
  listStoreProducts,
  listStoreCustomers,
} from '@brain/core-store-browser';
import {
  listCampaigns,
  listAdAccounts,
  spendByIntent,
  type AdVendor,
} from '@brain/core-platform-ads';
import {
  createCost,
  updateCost,
  deleteCost,
  createMiscExpense,
  updateMiscExpense,
  deleteMiscExpense,
  getFounderSalary,
  setFounderSalary,
  updateWorkspaceSettings,
  deleteWorkspace,
  createGoal,
  updateGoal,
  deleteGoal,
  upsertAdCampaignClassification,
  createFestival,
  updateFestival,
  deleteFestival,
  resetFestivalDefaults,
  MARKETING_ACTION_TYPES,
} from '@brain/core-settings';
import {
  assertKpiRegistryTraceability,
  assertWaterfallDefinitionId,
  assertLadderDefinitionId,
  assertPnlStatementTraceability,
  assertLogisticsDefinitionId,
  assertMarketingDefinitionId,
  assertCohortLtvDefinitionId,
  assertCatalogDefinitionId,
  assertSettingsDefinitionId,
  assertLifecycleDefinitionId,
  getMetricScale,
} from '../../domain/registry-mapper.js';
import {
  checkIdempotency,
  storeIdempotencyResult,
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import { assertPageInsightGates } from '../../domain/insight-gates.js';
import type { DataPlanePort } from '../../domain/proto-types.js';
import { mapOnboardingError, mapSettingsError, mapConnectorError } from './error-mappers.js';
import { dateInput, connectorVendor } from './shared-inputs.js';

/* eslint-disable @typescript-eslint/no-unused-vars */

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

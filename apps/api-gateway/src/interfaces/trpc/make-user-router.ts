// @paradigm: sql
// Thin tRPC router — user domain (Phase-E router split). Extracted verbatim from
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

export function makeUserRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /**
     * /me Brain-native equivalent. Used by /auth/callback + /auth/confirm to upsert
     * the user and decide onboarding-vs-dashboard. Returns the verified identity +
     * the user's memberships; `needsOnboarding` is true when there are zero.
     */
    me: identityProc.query(async ({ ctx }) => {
      // Idempotent upsert of the users row (id = verified sub, email = verified JWT).
      await ensureUser({ sub: ctx.identity.sub, email: ctx.identity.email });
      const workspaces = await listWorkspaces(ctx.identity.sub);
      return {
        userId: ctx.identity.sub,
        memberships: workspaces.map((w) => ({
          workspaceId: w.workspaceId,
          slug: w.slug,
          name: w.name,
          role: w.role,
        })),
        needsOnboarding: workspaces.length === 0,
        // Platform role for the /admin guard. Present on the claim only when the user
        // has a resolved membership; absent (e.g. mid-onboarding) ⇒ 'USER' (never
        // assume SUPERADMIN). The real gate is server-side (admin.* on superadminProc);
        // this only drives UX (show/hide the admin area).
        systemRole: ctx.claim?.systemRole ?? 'USER',
        requestId: ctx.requestId,
      };
    }),

    /**
     * Ensure-user: idempotent upsert of the public users row for the caller. Ports
     * legacy POST /api/user/ensure. Identity tier (no workspace needed).
     */
    ensure: identityProc.mutation(async ({ ctx }) => {
      const { userId, created } = await ensureUser({
        sub: ctx.identity.sub,
        email: ctx.identity.email,
      });
      return { userId, created, requestId: ctx.requestId };
    }),

    /** Return the caller's account profile (full_name, job_role, avatar_url, …). */
    account: identityProc.query(async ({ ctx }) => {
      try {
        const profile = await getProfile(ctx.identity.sub);
        return { ...profile, requestId: ctx.requestId };
      } catch (err) {
        if (err instanceof UserProfileError && err.code === 'NOT_FOUND') {
          // Lazy upsert: if a Supabase user has never touched core, ensureUser
          // creates the row. Then re-read so the page renders on first visit.
          await ensureUser({ sub: ctx.identity.sub, email: ctx.identity.email });
          const profile = await getProfile(ctx.identity.sub);
          return { ...profile, requestId: ctx.requestId };
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (err as Error).message });
      }
    }),

    /** Update the caller's profile (name / role / avatar). */
    updateProfile: identityProc
      .input(
        z.object({
          fullName:  z.string().trim().min(1).max(200).optional(),
          jobRole:   z.string().trim().max(200).optional(),
          avatarUrl: z.string().url().max(2000).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const profile = await updateProfile(ctx.identity.sub, input);
          return { ...profile, requestId: ctx.requestId };
        } catch (err) {
          if (err instanceof UserProfileError) {
            throw new TRPCError({
              code: err.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
              message: err.message,
            });
          }
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (err as Error).message });
        }
      }),

    /**
     * Delete the caller's account. Blocked if they're sole owner of a non-empty
     * workspace. Solo-owned empty workspaces are deleted too. Auth row (Supabase
     * auth.users) is left for ops cleanup; the client signs out after.
     */
    deleteAccount: identityProc.mutation(async ({ ctx }) => {
      try {
        const result = await deleteAccount(ctx.identity.sub);
        return { ...result, requestId: ctx.requestId };
      } catch (err) {
        if (err instanceof UserProfileError && err.code === 'OWNER_CONFLICT') {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
        }
        if (err instanceof UserProfileError && err.code === 'NOT_FOUND') {
          throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (err as Error).message });
      }
    }),
  });
}

// @paradigm: sql
// Thin tRPC router — team domain (Phase-E router split). Extracted verbatim from
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

export function makeTeamRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** Workspace members + pending-invitation count. requireRole(ANALYST). READ. */
    members: workspaceProc.query(async ({ ctx }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `team.members requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getWorkspaceMembers({ workspace_id: ctx.workspaceId });
      return {
        result: result.result,
        members: result.result.members,
        pending_invitations: result.result.pending_invitations,
        data_epoch: result.data_epoch,
        request_id: ctx.requestId,
      };
    }),

    /** List pending invitations. requireRole(MANAGER). READ. */
    pendingInvitations: workspaceProc.query(async ({ ctx }) => {
      if (!requireRole(ctx.claim, 'MANAGER')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `team.pendingInvitations requires MANAGER role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.listPendingInvitations({ workspace_id: ctx.workspaceId });
      return { invitations: result.invitations, data_epoch: result.data_epoch, request_id: ctx.requestId };
    }),

    /** Invite a new member (creates DB row + token; email is honest-deferred). requireRole(MANAGER). */
    invite: workspaceProc
      .input(z.object({
        email: z.string().email(),
        role: z.enum(['MANAGER', 'ANALYST', 'VIEWER']),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `team.invite requires MANAGER role. request_id=${ctx.requestId}` });
        }
        const res = await dataPlane.teamInviteMember({
          workspace_id: ctx.workspaceId,
          inviter_user_id: ctx.identity.sub,
          inviter_role: ctx.claim.workspaceRole as import('../../domain/proto-types.js').WorkspaceMemberRole,
          invitee_email: input.email,
          role: input.role,
        });
        return { ...res, request_id: ctx.requestId };
      }),

    /** Change a member's role. OWNER can change anyone; MANAGER cannot change an OWNER. requireRole(MANAGER). */
    changeRole: workspaceProc
      .input(z.object({
        user_id: z.string().uuid(),
        new_role: z.enum(['MANAGER', 'ANALYST', 'VIEWER']),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `team.changeRole requires MANAGER role. request_id=${ctx.requestId}` });
        }
        const res = await dataPlane.teamChangeRole({
          workspace_id: ctx.workspaceId,
          actor_user_id: ctx.identity.sub,
          actor_role: ctx.claim.workspaceRole as import('../../domain/proto-types.js').WorkspaceMemberRole,
          target_user_id: input.user_id,
          new_role: input.new_role,
        });
        return { ...res, request_id: ctx.requestId };
      }),

    /** Remove a member. MANAGER cannot remove an OWNER. requireRole(MANAGER). */
    removeMember: workspaceProc
      .input(z.object({ user_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `team.removeMember requires MANAGER role. request_id=${ctx.requestId}` });
        }
        // Fetch target role to enforce the MANAGER-cannot-remove-OWNER rule.
        const membersResult = await dataPlane.getWorkspaceMembers({ workspace_id: ctx.workspaceId });
        const target = membersResult.result.members.find((m) => m.user_id === input.user_id);
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: `Member not found. request_id=${ctx.requestId}` });
        if (target.role === 'OWNER' && ctx.claim.workspaceRole !== 'OWNER') {
          throw new TRPCError({ code: 'FORBIDDEN', message: `MANAGER cannot remove an OWNER. request_id=${ctx.requestId}` });
        }
        const res = await dataPlane.teamRemoveMember({
          workspace_id: ctx.workspaceId,
          actor_user_id: ctx.identity.sub,
          actor_role: ctx.claim.workspaceRole as import('../../domain/proto-types.js').WorkspaceMemberRole,
          target_user_id: input.user_id,
        });
        return { ...res, request_id: ctx.requestId };
      }),

    /** Revoke a pending invitation. requireRole(MANAGER). */
    revokeInvite: workspaceProc
      .input(z.object({ invitation_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `team.revokeInvite requires MANAGER role. request_id=${ctx.requestId}` });
        }
        const res = await dataPlane.teamRevokeInvite({
          workspace_id: ctx.workspaceId,
          actor_role: ctx.claim.workspaceRole as import('../../domain/proto-types.js').WorkspaceMemberRole,
          invitation_id: input.invitation_id,
        });
        return { ...res, request_id: ctx.requestId };
      }),

    /** Transfer ownership to another member. requireRole(OWNER) — OWNER-only. */
    transferOwnership: workspaceProc
      .input(z.object({ new_owner_user_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.claim.workspaceRole !== 'OWNER') {
          throw new TRPCError({ code: 'FORBIDDEN', message: `team.transferOwnership is OWNER-only. request_id=${ctx.requestId}` });
        }
        const res = await dataPlane.teamTransferOwnership({
          workspace_id: ctx.workspaceId,
          actor_user_id: ctx.identity.sub,
          actor_role: 'OWNER',
          new_owner_user_id: input.new_owner_user_id,
        });
        return { ...res, request_id: ctx.requestId };
      }),
  });
}

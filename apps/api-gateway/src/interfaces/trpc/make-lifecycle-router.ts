// @paradigm: sql
// Thin tRPC router — lifecycle domain (Phase-E router split). Extracted verbatim from
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

export function makeLifecycleRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** Customer-lifecycle bucket report. requireRole(ANALYST). READ-ONLY. */
    states: workspaceProc.input(dateInput).query(async ({ ctx, input }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `lifecycle.states requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getLifecycleStates({
        workspace_id: ctx.workspaceId,
        date_range: { start: input.date_start, end: input.date_end },
      });
      return {
        result: result.result,
        buckets: result.result.buckets,
        net_active: result.result.net_active,
        data_epoch: result.data_epoch,
        request_id: ctx.requestId,
      };
    }),

    /** Order-timing report (inter-order gaps + reactivation window). requireRole(ANALYST). READ-ONLY. */
    timings: workspaceProc
      .input(
        dateInput.extend({
          metric: z.enum(['median', 'mean']).optional(),
          group_by: z.enum(['product', 'variant', 'vendor', 'productType']).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `lifecycle.timings requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getOrderTimings({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: { metric: input.metric, group_by: input.group_by },
        });
        assertLifecycleDefinitionId('reactivation_window_days');
        return {
          result: result.result,
          summary: result.result.summary,
          groups: result.result.groups,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    /** Email/SMS PERFORMANCE report (REPORTING on past sends — never sends). requireRole(ANALYST). READ-ONLY. */
    emailSms: workspaceProc
      .input(
        dateInput.extend({
          group_by: z.enum(['campaign', 'flow', 'date', 'channel', 'dow']).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `lifecycle.emailSms requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getEmailSmsPerformance({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: { group_by: input.group_by },
        });
        assertLifecycleDefinitionId('email_open_rate_bp');
        assertLifecycleDefinitionId('email_revenue_per_recipient_mu');
        return {
          result: result.result,
          rows: result.result.rows,
          total_delivered: result.result.total_delivered,
          total_revenue_mu: result.result.total_revenue_mu,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),
  });
}

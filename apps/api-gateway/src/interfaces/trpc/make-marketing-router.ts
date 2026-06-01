// @paradigm: sql
// Thin tRPC router — marketing domain (Phase-E router split). Extracted verbatim from
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

export function makeMarketingRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** MER / aMER / ACOS / blended-ROAS. requireRole(ANALYST). */
    efficiency: workspaceProc.input(dateInput).query(async ({ ctx, input }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `marketing.efficiency requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getMarketingEfficiency({
        workspace_id: ctx.workspaceId,
        date_range: { start: input.date_start, end: input.date_end },
      });
      assertMarketingDefinitionId('mer_bp');
      assertMarketingDefinitionId('amer_bp');
      assertMarketingDefinitionId('acos_bp');
      assertMarketingDefinitionId('blended_roas_x100');
      return { result: result.result, data_epoch: result.data_epoch, request_id: ctx.requestId };
    }),

    /** New-customer acquisition: CAC, CM2-per-NC, aMER, meta/google split, daily. requireRole(ANALYST). */
    acquisition: workspaceProc.input(dateInput).query(async ({ ctx, input }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `marketing.acquisition requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getAcquisitionSummary({
        workspace_id: ctx.workspaceId,
        date_range: { start: input.date_start, end: input.date_end },
      });
      assertMarketingDefinitionId('cac_mu');
      assertMarketingDefinitionId('cm2_per_nc_mu');
      assertMarketingDefinitionId('amer_bp');
      assertMarketingDefinitionId('new_customer_revenue_mu');
      return {
        summary: result.result,
        daily: result.result.daily,
        data_epoch: result.data_epoch,
        request_id: ctx.requestId,
      };
    }),

    /**
     * Chart-parity: daily acquisition series for the ComposedChart.
     * Per-day: new customers, NC CM2, ad spend, CAC, CM2-per-NC, meta/google split.
     * requireRole(ANALYST).
     */
    dailyAcquisition: workspaceProc
      .input(dateInput)
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `marketing.dailyAcquisition requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getDailyAcquisition({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });
        return { rows: result.rows, data_epoch: result.data_epoch, request_id: ctx.requestId };
      }),

    /** Per-product distributions (mode/mean/diff + histogram). requireRole(ANALYST). */
    distributions: workspaceProc
      .input(
        dateInput.extend({
          metric: z.enum(['sales', 'cm1']).optional(),
          search: z.string().optional(),
          sort: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().int().min(1).optional(),
          page_size: z.number().int().min(10).max(100).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `marketing.distributions requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getDistributions({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: {
            metric: input.metric,
            search: input.search,
            sort: input.sort,
            order: input.order,
            page: input.page,
            page_size: input.page_size,
          },
        });
        assertMarketingDefinitionId('aov_mu');
        return {
          rows: result.result.rows,
          total_rows: result.result.total_rows,
          graph_points: result.result.graph_points,
          global_mode_mu: result.result.global_mode_mu,
          global_mean_mu: result.result.global_mean_mu,
          metric: result.result.metric,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    // -----------------------------------------------------------------
    // Platform-ads breakdown (Slice 5 of the parity epic): campaign-level
    // table + intent breakdown for /meta-ads & /google-ads. Funnel / Creative
    // tabs render ConnectorPending stubs (ad-level + creative facts not
    // ingested yet — honest affordance per CF-S10-HONEST-STATE-1).
    // -----------------------------------------------------------------
    platformCampaigns: workspaceProc
      .input(
        z.object({
          vendor:      z.enum(['META', 'GOOGLE']),
          date_start:  z.string(),
          date_end:    z.string(),
          adAccountId: z.string().optional().nullable(),
          intent:      z.string().optional().nullable(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `marketing.platformCampaigns requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const r = await listCampaigns(ctx.workspaceId, input.vendor as AdVendor, input.date_start, input.date_end, {
          adAccountId: input.adAccountId ?? null,
          intent: input.intent ?? null,
        });
        return {
          rows: r.rows.map((row) => ({
            ...row,
            spendMu:   row.spendMu.toString(),
            revenueMu: row.revenueMu.toString(),
            cpcMu:     row.cpcMu.toString(),
            cpmMu:     row.cpmMu.toString(),
          })),
          totalSpendMu:       r.totalSpendMu.toString(),
          totalRevenueMu:     r.totalRevenueMu.toString(),
          totalImpressions:   r.totalImpressions,
          totalClicks:        r.totalClicks,
          totalConversions:   r.totalConversions,
          currencyCode:       r.currencyCode,
          request_id:         ctx.requestId,
        };
      }),

    platformAccounts: workspaceProc
      .input(z.object({ vendor: z.enum(['META', 'GOOGLE']) }))
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `marketing.platformAccounts requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const rows = await listAdAccounts(ctx.workspaceId, input.vendor as AdVendor);
        return { rows, request_id: ctx.requestId };
      }),

    spendByIntent: workspaceProc
      .input(
        z.object({
          vendor:     z.enum(['META', 'GOOGLE']),
          date_start: z.string(),
          date_end:   z.string(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `marketing.spendByIntent requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const r = await spendByIntent(ctx.workspaceId, input.vendor as AdVendor, input.date_start, input.date_end);
        return {
          rows: r.rows.map((row) => ({ ...row, spendMu: row.spendMu.toString() })),
          totalSpendMu: r.totalSpendMu.toString(),
          request_id:   ctx.requestId,
        };
      }),

    // -----------------------------------------------------------------
    // parity-38: marketing-action CRUD (calendar overlay annotations).
    // READ: requireRole(ANALYST); WRITE: requireRole(MANAGER).
    // No money fields: the marketing_actions table has no spend column.
    // Source 'klaviyo' rows are read-only (sync-created); CRUD is for 'manual' only.
    // -----------------------------------------------------------------

    /** List marketing actions in a date range. requireRole(ANALYST). */
    listActions: workspaceProc
      .input(dateInput)
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `marketing.listActions requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.listMarketingActions({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });
        return {
          rows: result.result.rows,
          total_rows: result.result.total_rows,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    /** Create a marketing action annotation. requireRole(MANAGER). */
    createAction: workspaceProc
      .input(
        z.object({
          action_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          action_type: z.string().trim().min(1).max(50),
          action_name: z.string().trim().min(1).max(500),
          notes:       z.string().trim().max(2000).optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `marketing.createAction requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }
        if (!(MARKETING_ACTION_TYPES as readonly string[]).includes(input.action_type)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid action_type: ${input.action_type}. request_id=${ctx.requestId}` });
        }
        const row = await dataPlane.createMarketingAction({
          workspace_id: ctx.workspaceId,
          action_date:  input.action_date,
          action_type:  input.action_type,
          action_name:  input.action_name,
          notes:        input.notes ?? null,
          created_by:   ctx.identity.sub,
        });
        return { ...row, request_id: ctx.requestId };
      }),

    /** Update a marketing action annotation (partial). requireRole(MANAGER). */
    updateAction: workspaceProc
      .input(
        z.object({
          action_id:   z.string().uuid(),
          action_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          action_type: z.string().trim().min(1).max(50).optional(),
          action_name: z.string().trim().min(1).max(500).optional(),
          notes:       z.string().trim().max(2000).optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `marketing.updateAction requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }
        if (input.action_type !== undefined && !(MARKETING_ACTION_TYPES as readonly string[]).includes(input.action_type)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid action_type: ${input.action_type}. request_id=${ctx.requestId}` });
        }
        const row = await dataPlane.updateMarketingAction({
          workspace_id: ctx.workspaceId,
          action_id:    input.action_id,
          action_date:  input.action_date,
          action_type:  input.action_type,
          action_name:  input.action_name,
          notes:        input.notes,
        });
        return { ...row, request_id: ctx.requestId };
      }),

    /** Delete a marketing action annotation. requireRole(MANAGER). */
    deleteAction: workspaceProc
      .input(z.object({ action_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `marketing.deleteAction requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.deleteMarketingAction({
          workspace_id: ctx.workspaceId,
          action_id:    input.action_id,
        });
        return { ...result, action_id: input.action_id, request_id: ctx.requestId };
      }),
  });
}

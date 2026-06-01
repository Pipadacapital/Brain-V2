// @paradigm: sql
// Thin tRPC router — store domain (Phase-E router split). Extracted verbatim from
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

export function makeStoreRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** Store summary + revenue ladder for a date range. requireRole(ANALYST). */
    summary: workspaceProc
      .input(
        z.object({
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        // CF-C6-GATEWAY-TENANCY-1: requireRole before data-plane call.
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `store.summary requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.getStoreSummary({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });

        // G-REGISTRY-ONLY: every ladder step must trace to a registry definition_id.
        for (const step of result.ladder) {
          assertLadderDefinitionId(step);
        }

        return {
          summary: result.summary,
          ladder: result.ladder,
          data_epoch: result.data_epoch,   // CF-C6-AS-OF-STAMP-1
          request_id: ctx.requestId,
        };
      }),

    /** Revenue ladder only (the /store strip). requireRole(ANALYST). */
    revenueLadder: workspaceProc
      .input(
        z.object({
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `store.revenueLadder requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.getStoreSummary({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });

        for (const step of result.ladder) {
          assertLadderDefinitionId(step);
        }

        return {
          ladder: result.ladder,
          currency_code: result.summary.currency_code,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    /**
     * Chart-parity: daily net-sales series for the analytics AreaChart.
     * Aggregates connector_order_facts by day for the requested date range.
     * requireRole(ANALYST).
     */
    dailySales: workspaceProc
      .input(
        z.object({
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `store.dailySales requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getDailySales({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });
        return { rows: result.rows, data_epoch: result.data_epoch, request_id: ctx.requestId };
      }),

    // -----------------------------------------------------------------
    // Store-browser tabs (Slice 4 of the parity epic): Orders / Products
    // / Customers data tables on the /store page. RLS-isolated through the
    // store-browser use-case module; ANALYST+ to read.
    // PII posture: Customers returns aggregates + has_email/has_name flags;
    // decryption is a separate audited operation (deferred).
    // -----------------------------------------------------------------
    orders: workspaceProc
      .input(
        z.object({
          search:    z.string().max(200).optional(),
          status:    z.enum(['all', 'paid', 'pending', 'refunded', 'voided', 'partially_refunded']).optional(),
          cod:       z.enum(['all', 'cod', 'prepaid']).optional(),
          page:      z.number().int().min(1).optional(),
          pageSize:  z.number().int().min(10).max(100).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `store.orders requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const r = await listOrders(ctx.workspaceId, input);
        return {
          rows: r.rows.map((row) => ({ ...row, totalMu: row.totalMu.toString() })),
          total: r.total, page: r.page, pageSize: r.pageSize, totalPages: r.totalPages,
          request_id: ctx.requestId,
        };
      }),

    productsTable: workspaceProc
      .input(
        z.object({
          search:    z.string().max(200).optional(),
          status:    z.enum(['all', 'ACTIVE', 'DRAFT', 'ARCHIVED']).optional(),
          page:      z.number().int().min(1).optional(),
          pageSize:  z.number().int().min(10).max(100).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `store.productsTable requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const r = await listStoreProducts(ctx.workspaceId, input);
        return {
          rows: r.rows.map((row) => ({
            ...row, costMu: row.costMu.toString(), mrpMu: row.mrpMu.toString(),
          })),
          total: r.total, page: r.page, pageSize: r.pageSize, totalPages: r.totalPages,
          request_id: ctx.requestId,
        };
      }),

    customers: workspaceProc
      .input(
        z.object({
          search:    z.string().max(200).optional(),
          minOrders: z.number().int().min(0).optional(),
          consent:   z.enum(['all', 'opted_in', 'opted_out', 'unknown']).optional(),
          page:      z.number().int().min(1).optional(),
          pageSize:  z.number().int().min(10).max(100).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `store.customers requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const r = await listStoreCustomers(ctx.workspaceId, input);
        return {
          rows: r.rows.map((row) => ({ ...row, lifetimeSpentMu: row.lifetimeSpentMu.toString() })),
          total: r.total, page: r.page, pageSize: r.pageSize, totalPages: r.totalPages,
          request_id: ctx.requestId,
        };
      }),
  });
}

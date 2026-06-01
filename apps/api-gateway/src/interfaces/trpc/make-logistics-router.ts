// @paradigm: sql
// Thin tRPC router — logistics domain (Phase-E router split). Extracted verbatim from
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

export function makeLogisticsRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** RTO analytics: rate/cost/revenue-lost + by-payment + by-courier. requireRole(ANALYST). */
    rto: workspaceProc.input(dateInput).query(async ({ ctx, input }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `logistics.rto requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getRtoAnalytics({
        workspace_id: ctx.workspaceId,
        date_range: { start: input.date_start, end: input.date_end },
      });
      // G-REGISTRY-ONLY: the result's metric fields trace to registry defs.
      assertLogisticsDefinitionId('rto_rate_bp');
      assertLogisticsDefinitionId('rto_cost_mu');
      assertLogisticsDefinitionId('rto_revenue_lost_mu');
      return { analytics: result.result, data_epoch: result.data_epoch, request_id: ctx.requestId };
    }),

    /** COD vs prepaid economics + break-even. requireRole(ANALYST).
     * Optional fee overrides drive the break-even what-if (P1 parity):
     *   cod_fee_per_order_mu  — COD handling fee (paise, default 3000 = ₹30)
     *   return_shipping_per_rto_mu — return freight per RTO (paise, default 8000 = ₹80)
     *   gateway_fee_bp        — prepaid gateway % in bp (default 200 = 2%)
     */
    codPrepaid: workspaceProc.input(dateInput.extend({
      cod_fee_per_order_mu: z.bigint().optional(),
      return_shipping_per_rto_mu: z.bigint().optional(),
      gateway_fee_bp: z.number().int().min(0).max(10000).optional(),
    })).query(async ({ ctx, input }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `logistics.codPrepaid requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getCodPrepaid({
        workspace_id: ctx.workspaceId,
        date_range: { start: input.date_start, end: input.date_end },
        fee_overrides: {
          cod_fee_per_order_mu: input.cod_fee_per_order_mu,
          return_shipping_per_rto_mu: input.return_shipping_per_rto_mu,
          gateway_fee_bp: input.gateway_fee_bp,
        },
      });
      assertLogisticsDefinitionId('cod_realization_rate_bp');
      assertLogisticsDefinitionId('breakeven_cod_rto_rate_bp');
      assertLogisticsDefinitionId('aov_mu');
      return { result: result.result, data_epoch: result.data_epoch, request_id: ctx.requestId };
    }),

    /** Logistics operational summary. requireRole(ANALYST). */
    summary: workspaceProc.input(dateInput).query(async ({ ctx, input }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `logistics.summary requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getLogistics({
        workspace_id: ctx.workspaceId,
        date_range: { start: input.date_start, end: input.date_end },
      });
      assertLogisticsDefinitionId('rto_rate_bp');
      return { result: result.result, data_epoch: result.data_epoch, request_id: ctx.requestId };
    }),

    /** Pincode intelligence (filterable/sortable). requireRole(ANALYST). */
    pincode: workspaceProc
      .input(
        dateInput.extend({
          search: z.string().optional(),
          state: z.string().optional(),
          min_orders: z.number().int().min(0).optional(),
          high_rto: z.boolean().optional(),
          high_cod: z.boolean().optional(),
          sort: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `logistics.pincode requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getPincodeIntelligence({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: {
            search: input.search,
            state: input.state,
            min_orders: input.min_orders,
            high_rto: input.high_rto,
            high_cod: input.high_cod,
            sort: input.sort,
            order: input.order,
          },
        });
        assertLogisticsDefinitionId('pincode_reliability_score');
        assertLogisticsDefinitionId('aov_mu');
        return {
          rows: result.result.rows,
          total_shipments: result.result.total_shipments,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    /**
     * Wave-1 parity: per-shipment operational console table. requireRole(ANALYST).
     * Cursor pagination (no OFFSET — CF-API-CURSOR-1). Reads connector_shipment_facts.
     * charge precedence: forward_charge_mu = shipping_charges_mu (applied_weight_amount
     * first in the legacy rawJson fallback chain). CF-C6-RENDER-ONLY-1: zero math here.
     */
    shipments: workspaceProc
      .input(
        dateInput.extend({
          cursor: z.string().optional(),
          page_size: z.number().int().min(1).max(200).default(50),
          search: z.string().optional(),
          statuses: z.array(z.string()).optional(),
          channel_names: z.array(z.string()).optional(),
          payment: z.enum(['COD', 'PREPAID']).nullable().optional(),
          mapping: z.enum(['MATCHED', 'UNMATCHED']).nullable().optional(),
          rto_only: z.boolean().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `logistics.shipments requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getShipmentRows({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: {
            search: input.search,
            statuses: input.statuses,
            channel_names: input.channel_names,
            payment: input.payment ?? null,
            mapping: input.mapping ?? null,
            rto_only: input.rto_only,
          },
          cursor: input.cursor,
          page_size: input.page_size,
        });
        // G-REGISTRY-ONLY: shipments are operational rows, not derived analytics metrics.
        // charge fields trace to registry shipping_charges_mu (rto_cost_mu for RTO rows).
        assertLogisticsDefinitionId('rto_rate_bp'); // proves logistics surface is registry-connected
        return {
          rows: result.rows,
          next_cursor: result.next_cursor,
          total_count: result.total_count,
          filtered_count: result.filtered_count,
          delivered_count: result.delivered_count,
          rto_count: result.rto_count,
          mapped_count: result.mapped_count,
          distinct_statuses: result.distinct_statuses,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),
  });
}

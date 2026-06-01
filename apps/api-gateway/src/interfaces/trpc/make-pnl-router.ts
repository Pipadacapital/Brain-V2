// @paradigm: sql
// Thin tRPC router — pnl domain (Phase-E router split). Extracted verbatim from
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

export function makePnlRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /** Honest P&L statement ladder (net_revenue → cm3 + True-CM2). requireRole(ANALYST). */
    statement: workspaceProc
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
            message: `pnl.statement requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.getPnlStatement({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });

        // G-REGISTRY-ONLY: every P&L line must trace to a registry definition_id.
        assertPnlStatementTraceability(result.statement);

        return {
          statement: result.statement,
          data_epoch: result.data_epoch,   // CF-C6-AS-OF-STAMP-1
          request_id: ctx.requestId,
        };
      }),

    /** Honest CM waterfall steps (signed, cumulative; Visx chart data). requireRole(ANALYST). */
    cmWaterfall: workspaceProc
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
            message: `pnl.cmWaterfall requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.getCmWaterfall({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });

        for (const step of result.steps) {
          assertWaterfallDefinitionId(step);
        }

        return {
          steps: result.steps,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    /**
     * P&L period grid — per-period (day/week/month/quarter) full P&L row set.
     * Legacy-parity: ~34 column grid matching COLUMN_CONFIG. requireRole(ANALYST).
     * CF-C6-RENDER-ONLY-1: zero arithmetic here — all values from the data plane.
     * CF-C6-BIGINT-JSON-1: every _mu field is bigint over superjson.
     */
    periodGrid: workspaceProc
      .input(
        z.object({
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          granularity: z.enum(['day', 'week', 'month', 'quarter']).default('day'),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `pnl.periodGrid requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.getPnlPeriodGrid({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          granularity: input.granularity,
        });

        return {
          rows: result.rows,
          currency_code: result.currency_code,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),
  });
}

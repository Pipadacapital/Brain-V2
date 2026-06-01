// @paradigm: sql
// Thin tRPC router — connectors domain (Phase-E router split). Extracted verbatim from
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

export function makeConnectorsRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
    /**
     * Begin an OAuth connect: create the CSRF state nonce + return the provider
     * consent URL. requireRole(MANAGER) — connecting a store is a managerial config
     * change (mirrors legacy requireWorkspaceAdmin). Workspace tier (the connecting
     * workspace is the authenticated claim).
     */
    initiate: workspaceProc
      .input(
        z.object({
          vendor: connectorVendor,
          // Shopify is per-store OAuth → the *.myshopify.com host. Ignored for Meta/Google.
          shopDomain: z.string().max(255).optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `connectors.initiate requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }
        try {
          const { authUrl } = await initiateConnect({
            vendor: input.vendor,
            workspaceId: ctx.workspaceId,
            userId: ctx.claim.userId,
            shopDomain: input.shopDomain ?? null,
          });
          return { authUrl, requestId: ctx.requestId };
        } catch (err) {
          throw mapConnectorError(err, ctx.requestId);
        }
      }),

    /**
     * Complete the OAuth callback (called by the web redirect route handler after it
     * has validated the Supabase session). Identity tier: the workspace is derived
     * from the CONSUMED state record (CSRF), NOT a spoofable header/claim — the state
     * was bound to the workspace at initiate. Exchange → custody.put (encrypted) →
     * UPSERT connection. Idempotent + RLS-scoped. Returns NON-secret outcome only.
     */
    completeCallback: identityProc
      .input(
        z.object({
          vendor: connectorVendor,
          code: z.string().min(1).max(4096),
          state: z.string().min(1).max(256),
          // Full provider callback query (Shopify HMAC validation needs it). NON-secret.
          query: z.record(z.string()).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await completeCallback({
            vendor: input.vendor,
            code: input.code,
            state: input.state,
            query: input.query,
          });
          // NEVER return the token — only the non-secret outcome.
          return {
            vendor: result.vendor,
            status: result.status,
            accountRef: result.accountRef,
            requestId: ctx.requestId,
          };
        } catch (err) {
          throw mapConnectorError(err, ctx.requestId);
        }
      }),

    /** Per-vendor connection status (connected / not-connected / token-expired). READ.
     *  requireRole(ANALYST). NEVER returns a token. */
    list: workspaceProc.query(async ({ ctx }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `connectors.list requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const rows = await listConnectors(ctx.workspaceId);
      return { rows, requestId: ctx.requestId };
    }),

    /** Disconnect a connector: seal (delete) the credential + mark DISCONNECTED.
     *  requireRole(MANAGER). */
    disconnect: workspaceProc
      .input(z.object({ vendor: connectorVendor }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `connectors.disconnect requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }
        const result = await disconnect({ vendor: input.vendor, workspaceId: ctx.workspaceId });
        return { ...result, requestId: ctx.requestId };
      }),

    /**
     * Slice E — "Sync now": pull the connector's data using the custody token, normalize
     * to canonical facts, idempotently UPSERT, advance last_sync_at. requireRole(MANAGER)
     * (config-class action, mirrors initiate). RLS-scoped + workspace-scoped + idempotent.
     * Returns row COUNTS only — NEVER the token, NEVER a provider body. A NOT_CONNECTED
     * vendor returns a clean {status:'not_connected'} (no crash, no token read).
     */
    sync: workspaceProc
      .input(z.object({ vendor: connectorVendor }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `connectors.sync requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }
        try {
          const result = await syncConnector({ vendor: input.vendor, workspaceId: ctx.workspaceId });
          return { ...result, requestId: ctx.requestId };
        } catch (err) {
          throw mapConnectorError(err, ctx.requestId);
        }
      }),
  });
}

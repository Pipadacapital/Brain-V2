// @paradigm: sql
// Brain api-gateway tRPC router — the V1 handshake contract.
// This file is the HANDSHAKE POINT: typed client exports unblock Ananya + Karan.
//
// Paradigm enforcement (CF-C6-RENDER-ONLY-1): ZERO arithmetic in this file.
// All numeric values come from the data plane (DataPlanePort). The only
// transformation allowed is formatMoney() at the edge.
//
// CF-C6-REGISTRY-ONLY-BFF-1: every KPI output field traces to a registry
// definition_id via assertKpiRegistryTraceability().
//
// CF-C6-BIGINT-JSON-1: bigint fields round-trip faithfully via superjson.
//   _mu fields are typed as bigint; the transformer handles serialization.
//
// CF-C6-MB-IDEMPOTENCY-1: morningBrief.submitResponse uses Redis dedup
//   before writing to ai.decision_log.
//
// Cursor pagination ONLY (no offset) — CF-API-CURSOR-1.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { WORKSPACE_ROLE_LEVEL } from '@brain/core-auth';
import { requireRole } from '@brain/core-auth';
import {
  router,
  workspaceProc,
  authedProc,
  identityProc,
  publicProc,
} from './trpc.js';
import {
  ensureUser,
  completeOnboarding,
  acceptInvitation,
  listWorkspaces,
  OnboardingError,
} from '@brain/core-onboarding';
import {
  initiateConnect,
  completeCallback,
  listConnectors,
  disconnect,
  syncConnector,
  ConnectorError,
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
  SettingsError,
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
} from '../domain/registry-mapper.js';
import {
  checkIdempotency,
  storeIdempotencyResult,
  type IdempotencyStore,
} from '../domain/idempotency.js';
import { assertPageInsightGates } from '../domain/insight-gates.js';
import type { DataPlanePort } from '../domain/proto-types.js';
// Phase-E router split: thin per-domain routers + shared error mappers under interfaces/trpc/.
import { makeAuthRouter } from '../interfaces/trpc/make-auth-router.js';
import {
  mapOnboardingError,
  mapSettingsError,
  mapConnectorError,
} from '../interfaces/trpc/error-mappers.js';
import { dateInput, connectorVendor } from '../interfaces/trpc/shared-inputs.js';

// ---------------------------------------------------------------------------
// Router factory — accepts the DataPlanePort and IdempotencyStore as deps.
// This enables clean test injection without module mocking.
// CF-C6-DATA-SEAM-1: DataPlanePort is the ONLY data path. No direct DB access.
// ---------------------------------------------------------------------------

// Error mappers extracted to interfaces/trpc/error-mappers.ts (Phase-E split) — imported above.

export function createBrainRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  // -------------------------------------------------------------------
  // auth router — extracted to interfaces/trpc/make-auth-router.ts (Phase-E split)
  // -------------------------------------------------------------------
  const authRouter = makeAuthRouter();

  // -------------------------------------------------------------------
  // workspace router
  // -------------------------------------------------------------------
  const workspaceRouter = router({
    /**
     * List the workspaces the verified caller belongs to (identity tier — works
     * even mid-onboarding). Slice C: REAL multi-workspace list from the local DB
     * (core-service listWorkspaces), keyed on the verified sub. NOT the claim.
     */
    list: identityProc.query(async ({ ctx }) => {
      const workspaces = await listWorkspaces(ctx.identity.sub);
      return {
        workspaces: workspaces.map((w) => ({
          workspaceId: w.workspaceId,
          slug: w.slug,
          name: w.name,
          role: w.role,
          // plan is not stored per-workspace in the local schema yet;
          // 'Growth' is the honest default (matches getWorkspaceSettings).
          plan: 'Growth' as string,
        })),
        requestId: ctx.requestId,
      };
    }),

    /**
     * Data-reconciliation signal. The dashboard asks: does this workspace have
     * ANY analytics data yet? If not, it renders the honest
     * "no data yet — connect a store" empty-state instead of empty rows.
     *
     * Production behaviour: probes the store summary on a wide date range and
     * returns hasSeedData=true iff at least one order has been ingested. The
     * old `workspaceId === SUGANDH_LOK_WORKSPACE_ID` shortcut was the seed-plane
     * marker; it is gone (Founder destub 2026-05-26). The field name stays
     * for backward-compat with the dashboard component.
     */
    dataAvailability: workspaceProc.query(async ({ ctx }) => {
      // A wide window: any orders since the start of Brain time. We don't need
      // to count them — getStoreSummary surfaces hasData based on order count.
      const result = await dataPlane.getStoreSummary({
        workspace_id: ctx.workspaceId,
        date_range: { start: '2020-01-01', end: '2099-12-31' },
      });
      return {
        hasSeedData: (result?.summary?.order_count ?? 0n) > 0n,
        workspaceId: ctx.workspaceId,
        requestId: ctx.requestId,
      };
    }),

    /**
     * Switch active workspace (identity tier). Slice C: validates REAL membership
     * from the DB (multi-workspace capable). FORBIDDEN for a workspace the verified
     * user is NOT a member of. (Replaces the slice-A claim-equality check, which
     * was a single-workspace stopgap.)
     */
    switch: identityProc
      .input(
        z.object({
          workspaceId: z.string().uuid('workspace_id must be a UUID'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const workspaces = await listWorkspaces(ctx.identity.sub);
        const match = workspaces.find((w) => w.workspaceId === input.workspaceId);
        if (!match) {
          // Not a member of the requested workspace → spoof / unauthorized switch.
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              `workspace.switch denied: the verified user is not a member of the ` +
              `requested workspace. request_id=${ctx.requestId}`,
          });
        }
        return {
          workspaceId: match.workspaceId,
          role: match.role,
          requestId: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // user router (Slice C) — identity tier: works for a no-membership user.
  // -------------------------------------------------------------------
  const userRouter = router({
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

  // -------------------------------------------------------------------
  // onboarding router (Slice C) — identity tier: the user has no workspace yet.
  // -------------------------------------------------------------------
  const onboardingRouter = router({
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

  // -------------------------------------------------------------------
  // invitation router (Slice C) — identity tier: a joiner may have no membership.
  // -------------------------------------------------------------------
  const invitationRouter = router({
    /**
     * Accept an invitation by token (idempotent, RLS-scoped, role-mapped
     * EDITOR→MANAGER). Member-invite SENDING (email) is DEFERRED (honest affordance).
     */
    accept: identityProc
      .input(z.object({ token: z.string().min(1, 'invitation token required').max(200) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await acceptInvitation(input.token, {
            sub: ctx.identity.sub,
            email: ctx.identity.email,
          });
          return { ...result, requestId: ctx.requestId };
        } catch (err) {
          throw mapOnboardingError(err, ctx.requestId);
        }
      }),
  });

  // -------------------------------------------------------------------
  // notifications router — identity tier (user-scoped, workspace-optional).
  // Notifications belong to a USER and may target a workspace OR be global.
  // RLS-safe: every query in core-notifications filters by user_id = ctx.sub.
  // -------------------------------------------------------------------
  const notificationsRouter = router({
    /** List the caller's notifications, newest first. Optional unread filter + ws scope. */
    list: identityProc
      .input(
        z.object({
          filter:      z.enum(['all', 'unread']).optional().default('all'),
          workspaceId: z.string().uuid().optional().nullable(),
          limit:       z.number().int().min(1).max(200).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const items = await listNotifications(ctx.identity.sub, {
          filter:      input.filter,
          workspaceId: input.workspaceId ?? null,
          limit:       input.limit,
        });
        return { items, requestId: ctx.requestId };
      }),

    /** Unread count for the shell badge — separate proc keeps it cheap to poll. */
    unreadCount: identityProc
      .input(z.object({ workspaceId: z.string().uuid().optional().nullable() }).optional())
      .query(async ({ ctx, input }) => {
        const count = await getUnreadCount(ctx.identity.sub, input?.workspaceId ?? null);
        return { count, requestId: ctx.requestId };
      }),

    /** Mark a single notification read (no-op if already read or not yours). */
    markRead: identityProc
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const changed = await markNotificationRead(ctx.identity.sub, input.id);
        return { changed, requestId: ctx.requestId };
      }),

    /** Mark every unread notification (optionally scoped to a workspace) read. */
    markAllRead: identityProc
      .input(z.object({ workspaceId: z.string().uuid().optional().nullable() }).optional())
      .mutation(async ({ ctx, input }) => {
        const updated = await markAllNotificationsRead(
          ctx.identity.sub,
          input?.workspaceId ?? null,
        );
        return { updated, requestId: ctx.requestId };
      }),
  });

  // -------------------------------------------------------------------
  // metrics router — workspace tier, requireRole(ANALYST)
  // CF-C6-REGISTRY-ONLY-BFF-1: all fields trace to registry definition_ids.
  // CF-C6-BIGINT-JSON-1: _mu fields are bigint (superjson handles wire format).
  // -------------------------------------------------------------------
  const metricsRouter = router({
    /** KPI summary strip for a date range. */
    kpiSummary: workspaceProc
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
            message: `metrics.kpiSummary requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.getKpiSummary({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });

        // G-REGISTRY-ONLY: assert every field traces to registry (runtime check).
        assertKpiRegistryTraceability(result.summary);

        return {
          summary: result.summary,
          data_epoch: result.data_epoch,       // CF-C6-AS-OF-STAMP-1
          request_id: ctx.requestId,
        };
      }),

    /** P&L / CM waterfall steps (Visx chart data). */
    pnlWaterfall: workspaceProc
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
            message: `metrics.pnlWaterfall requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        // Phase-2 slice-2: getPnlWaterfall now delegates to the honest getCmWaterfall
        // (ONE CM-waterfall source of truth). metrics.pnlWaterfall is the Child-6 alias
        // kept so the existing web component query key keeps working; pnl.cmWaterfall is
        // the canonical name. No second computation path.
        const result = await dataPlane.getPnlWaterfall({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
        });

        // G-REGISTRY-ONLY: validate each waterfall step's definition_id.
        for (const step of result.steps) {
          assertWaterfallDefinitionId(step);
        }

        return {
          steps: result.steps,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    /** Cursor-paginated raw metric rows. OFFSET BANNED. CF-API-CURSOR-1. */
    queryRange: workspaceProc
      .input(
        z.object({
          definition_ids: z.array(z.string()).min(1),
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          cursor: z.string().optional(),
          page_size: z.number().int().min(1).max(365).default(90),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `metrics.queryRange requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.queryMetrics({
          workspace_id: ctx.workspaceId,
          definition_ids: input.definition_ids,
          date_range: { start: input.date_start, end: input.date_end },
          cursor: input.cursor,
          page_size: input.page_size,
        });

        return {
          rows: result.rows,
          data_epoch: result.data_epoch,
          next_cursor: result.next_cursor,
          request_id: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // store router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-1 (feat-store-order-fact-layer): the canonical store/order
  // fact layer + revenue ladder. CF-C6-RENDER-ONLY-1: zero arithmetic here —
  // all values from the data plane. CF-C6-REGISTRY-ONLY-BFF-1: every ladder
  // step traces to a registry definition_id. CF-C6-BIGINT-JSON-1: _mu = bigint.
  // -------------------------------------------------------------------
  const storeRouter = router({
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

  // -------------------------------------------------------------------
  // pnl router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-2 (feat-pnl-cm-waterfall): the honest P&L statement + CM waterfall.
  // CF-C6-RENDER-ONLY-1: zero arithmetic here — values from the data plane.
  // CF-C6-REGISTRY-ONLY-BFF-1: every line/step traces to a registry definition_id.
  // CF-C6-BIGINT-JSON-1: _mu = bigint over superjson.
  // -------------------------------------------------------------------
  const pnlRouter = router({
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

  // -------------------------------------------------------------------
  // logistics router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-3 (feat-rto-cod-economics): RTO/COD/logistics/pincode economics.
  // CF-C6-RENDER-ONLY-1: zero arithmetic here — values from the data plane.
  // CF-C6-REGISTRY-ONLY-BFF-1: every metric field traces a registry definition_id.
  // CF-C6-BIGINT-JSON-1: _mu = bigint over superjson.
  // -------------------------------------------------------------------
  const logisticsRouter = router({
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

  // -------------------------------------------------------------------
  // marketing router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-4 (feat-marketing-acquisition): MER/aMER/CAC + acquisition + distributions.
  // aMER uses acquisition-classified spend; ROAS/ACOS display_only; pamer_bp decommissioned.
  // -------------------------------------------------------------------
  const marketingRouter = router({
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

  // -------------------------------------------------------------------
  // cohorts router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-5 (feat-cohorts-ltv): cohort retention/repeat heatmap (CM3).
  // Cohorts use CM3 (Finding 1); payback = cumulative bucket-walk (Finding 3);
  // cohort_ltv feeds ltv_cac_bp (Finding 4). The phantom cac_payback_months is gone.
  // -------------------------------------------------------------------
  const cohortsRouter = router({
    /** Cohort retention/repeat matrix. requireRole(ANALYST). */
    matrix: workspaceProc
      .input(
        dateInput.extend({
          metric: z.enum(['cm3', 'revenue', 'repeat', 'repurchase']).optional(),
          mode: z.enum(['post', 'cumulative', 'incr', 'pct', 'ltvcac']).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `cohorts.matrix requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getCohortMatrix({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: { metric: input.metric, mode: input.mode },
        });
        assertCohortLtvDefinitionId('cac_mu');
        assertCohortLtvDefinitionId('cohort_ltv_mu');
        assertCohortLtvDefinitionId('ltv_cac_bp');
        assertCohortLtvDefinitionId('repeat_rate_bp');
        return {
          result: result.result,
          rows: result.result.rows,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // ltv router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-5 (feat-cohorts-ltv): LTV-by-dimension (CM2). NO CAC/payback here
  // (those are cohort concepts — Finding 2). Dimensioned + weighted + paginated.
  // -------------------------------------------------------------------
  const ltvRouter = router({
    /** LTV curve by dimension. requireRole(ANALYST). */
    summary: workspaceProc
      .input(
        dateInput.extend({
          metric: z.enum(['cm2', 'revenue', 'repeat_rate']).optional(),
          mode: z.enum(['cumulative', 'post_acq', 'incremental']).optional(),
          dimension: z
            .enum([
              'product', 'variant', 'vendor', 'collection', 'product_type',
              'product_tags', 'order_tags', 'discount_codes', 'discount_pct', 'customer_id',
            ])
            .optional(),
          search: z.string().optional(),
          page: z.number().int().min(1).optional(),
          page_size: z.number().int().min(10).max(100).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `ltv.summary requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getLtvSummary({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: {
            metric: input.metric,
            mode: input.mode,
            dimension: input.dimension,
            search: input.search,
            page: input.page,
            page_size: input.page_size,
          },
        });
        assertCohortLtvDefinitionId('cm2_mu');
        assertCohortLtvDefinitionId('repeat_rate_bp');
        return {
          result: result.result,
          rows: result.result.rows,
          total_rows: result.result.total_rows,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // catalog router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-6 (feat-catalog-inventory): product performance (CM1, NOT per-SKU CM2),
  // inventory levels (sell-through + days-left, NOT turnover), first-product cascade
  // (per-first-product second-order-rate, NOT slice-5 rr90).
  // -------------------------------------------------------------------
  const catalogRouter = router({
    /** Product performance table (CM1 + pareto + return-rate + AOV). requireRole(ANALYST). */
    products: workspaceProc
      .input(
        dateInput.extend({
          group_by: z
            .enum(['product', 'variant', 'collection', 'vendor', 'type', 'product_tags', 'order_tags', 'discount_codes'])
            .optional(),
          sort: z
            .enum(['label', 'pareto_grade', 'cm1', 'cm1_pct', 'cm1_total', 'revenue', 'sold', 'refunded', 'net_quantity', 'return_rate', 'orders', 'aov'])
            .optional(),
          direction: z.enum(['asc', 'desc']).optional(),
          search: z.string().optional(),
          page: z.number().int().min(1).optional(),
          page_size: z.number().int().min(10).max(100).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `catalog.products requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getProductPerformance({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: {
            group_by: input.group_by,
            sort: input.sort,
            direction: input.direction,
            search: input.search,
            page: input.page,
            page_size: input.page_size,
          },
        });
        // Products is CM1 (reuse cm1_mu) + AOV — NEVER per-SKU CM2.
        assertCatalogDefinitionId('cm1_mu');
        assertCatalogDefinitionId('aov_mu');
        return {
          result: result.result,
          rows: result.result.rows,
          total_rows: result.result.total_rows,
          total_cm1_mu: result.result.total_cm1_mu,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    /** Inventory levels (days-left cascade + sell-through + status). requireRole(ANALYST). */
    inventory: workspaceProc
      .input(
        dateInput.extend({
          grain: z.enum(['product', 'variant']).optional(),
          sort: z.enum(['label', 'current_inventory', 'days_left', 'sell_through', 'status']).optional(),
          direction: z.enum(['asc', 'desc']).optional(),
          status_filter: z
            .enum(['Out of stock', 'Restock Soon', 'Healthy', 'Overstocked', 'Severely Overstocked'])
            .optional(),
          // Wave-4A parity additions: search, as-of snapshot date, server-side pagination.
          search: z.string().max(200).optional(),
          as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
          page: z.number().int().min(1).optional(),
          page_size: z.number().int().min(10).max(200).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `catalog.inventory requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getInventoryLevels({
          workspace_id: ctx.workspaceId,
          date_range: {
            start: input.as_of_date ?? input.date_start,
            end: input.as_of_date ?? input.date_end,
          },
          filters: {
            grain: input.grain,
            sort: input.sort,
            direction: input.direction,
            status_filter: input.status_filter,
            search: input.search,
            as_of_date: input.as_of_date,
            page: input.page,
            page_size: input.page_size,
          },
        });
        assertCatalogDefinitionId('inventory_days_left');
        assertCatalogDefinitionId('inventory_sell_through_bp');
        return {
          result: result.result,
          rows: result.result.rows,
          total_rows: result.result.total_rows,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    /** First-product cascade (per-first-product repeat behavior + revenue LTV). requireRole(ANALYST). */
    firstProductCascade: workspaceProc
      .input(
        dateInput.extend({
          observation_days: z.number().int().min(30).max(730).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `catalog.firstProductCascade requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getFirstProductCascade({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: { observation_days: input.observation_days },
        });
        // The cascade rate is its OWN def — NEVER slice-5 repeat_rate_bp (rr90 conflation).
        assertCatalogDefinitionId('first_product_second_order_rate_bp');
        return {
          result: result.result,
          rows: result.result.rows,
          total_cohort_customers: result.result.total_cohort_customers,
          observation_days: result.result.observation_days,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    // -----------------------------------------------------------------
    // Per-product COGS editor — Slice 3 of the parity epic. UI lets
    // operators set cost_mu per product (paise). Shopify never sends COGS,
    // so this field is user-owned; connector syncs leave it untouched.
    // requireRole(EDITOR) because it mutates a metric input (CM1 changes).
    // -----------------------------------------------------------------

    /** List products for the COGS editor, paginated + filterable. */
    cogsList: workspaceProc
      .input(
        z.object({
          search:     z.string().max(200).optional(),
          status:     z.enum(['all', 'ACTIVE', 'DRAFT', 'ARCHIVED']).optional(),
          cogsFilter: z.enum(['all', 'set', 'not_set']).optional(),
          page:       z.number().int().min(1).optional(),
          pageSize:   z.number().int().min(10).max(100).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `catalog.cogsList requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const r = await listProductsForCogs(ctx.workspaceId, input);
        // BigInt → string at the seam so superjson serializes safely on every
        // client (superjson handles bigint, but we type the wire as string for
        // older RN clients per CF-C6-BIGINT-JSON-1).
        // costMu null (unset) stays null on the wire — do NOT coerce to '0'.
        return {
          rows: r.rows.map((row) => ({
            ...row,
            costMu: row.costMu != null ? row.costMu.toString() : null,
            mrpMu:  row.mrpMu.toString(),
          })),
          total: r.total,
          page: r.page,
          pageSize: r.pageSize,
          totalPages: r.totalPages,
          request_id: ctx.requestId,
        };
      }),

    /**
     * Update one product's COGS (paise minor units).
     *
     * costMu: null  → write NULL (unset / "not configured").
     * costMu: "0"   → explicit ₹0 COGS (valid; used for zero-margin products).
     * costMu: "N"   → N paise.
     *
     * The UI converts the rupee text-input: empty → null, number → paise string.
     */
    updateCogs: workspaceProc
      .input(
        z.object({
          productId: z.string().uuid(),
          // null = unset COGS (writes NULL to DB); digits-only string = paise value.
          costMu: z.string().regex(/^\d+$/, 'cost_mu must be non-negative integer (paise)').nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `catalog.updateCogs requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }
        const r = await updateProductCogs(
          ctx.workspaceId,
          input.productId,
          input.costMu != null ? BigInt(input.costMu) : null,
        );
        if (!r.updated) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `product not found in workspace. request_id=${ctx.requestId}`,
          });
        }
        return {
          updated: true,
          costMu: r.costMu != null ? r.costMu.toString() : null,
          request_id: ctx.requestId,
        };
      }),

    /** Bulk-update COGS for many products in one transaction.
     *  costMu: null clears the COGS (writes NULL). "0" sets explicit ₹0.
     */
    bulkUpdateCogs: workspaceProc
      .input(
        z.object({
          updates: z.array(
            z.object({
              productId: z.string().uuid(),
              costMu:    z.string().regex(/^\d+$/).nullable(),
            }),
          ).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `catalog.bulkUpdateCogs requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }
        const r = await bulkUpdateProductCogs(
          ctx.workspaceId,
          input.updates.map((u) => ({
            productId: u.productId,
            costMu: u.costMu != null ? BigInt(u.costMu) : null,
          })),
        );
        return { ...r, request_id: ctx.requestId };
      }),

    /**
     * Wave-4A: set lead time for a single SKU (parity-28 inline lead-time editor).
     * MANAGER-gated. Idempotent (last-write-wins per SKU). lead_time_days 0..365.
     * Persisted in the local-db plane in-process (production will write workspace_product_settings).
     * CF-C6-DATA-SEAM-1: additive method on the SAME port.
     */
    setLeadTime: workspaceProc
      .input(
        z.object({
          sku: z.string().min(1).max(200),
          lead_time_days: z.number().int().min(0).max(365),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `catalog.setLeadTime requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }
        assertCatalogDefinitionId('inventory_days_left'); // lead time feeds the days-left cascade
        const result = await dataPlane.setLeadTime({
          workspace_id: ctx.workspaceId,
          sku: input.sku,
          lead_time_days: input.lead_time_days,
        });
        return { ...result, request_id: ctx.requestId };
      }),
  });

  // -------------------------------------------------------------------
  // settings router — workspace tier (Phase-2 slice-7, feat-finance-settings-goals)
  // goals (directional RAG + idempotent upsert), costs (resolved stack feeding CM),
  // festivals (India template calendar; CRUD deferred). festival learned-lift is a
  // PHANTOM (Rohan Finding 2) — never computed.
  // -------------------------------------------------------------------
  const settingsRouter = router({
    /** Directional goal attainment + RAG. requireRole(ANALYST). READ. */
    goals: workspaceProc.input(dateInput).query(async ({ ctx, input }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `settings.goals requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getGoalAttainment({
        workspace_id: ctx.workspaceId,
        date_range: { start: input.date_start, end: input.date_end },
      });
      // Goal attainment is goal_attainment_bp; the RAG band is its classification.
      assertSettingsDefinitionId('goal_attainment_bp');
      return {
        result: result.result,
        rows: result.result.rows,
        total_rows: result.result.total_rows,
        data_epoch: result.data_epoch,
        request_id: ctx.requestId,
      };
    }),

    /**
     * Upsert a metric goal. IDEMPOTENT (Redis dedup), RLS-scoped on write, MANAGER-gated, Zod-validated.
     * CF-C6-MB-IDEMPOTENCY-1 pattern: idempotency_key dedup BEFORE the write.
     */
    upsertGoal: workspaceProc
      .input(
        z.object({
          metric_name: z.enum([
            'revenue', 'cm3', 'cm3_pct', 'mer', 'amer', 'cac', 'aov',
            'new_customers', 'acos', 'meta_roas', 'google_roas',
          ]),
          period_type: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
          period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          goal_value: z.bigint().nonnegative('goal_value must be >= 0'),
          goal_type: z.enum(['MINIMUM', 'MAXIMUM', 'TARGET']),
          idempotency_key: z.string().uuid('idempotency_key must be a UUID'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // requireRole(MANAGER): editing a goal is a managerial config change.
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `settings.upsertGoal requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }

        // CF-C6-MB-IDEMPOTENCY-1: dedup BEFORE the write. Removing this = double-write = RED.
        const cached = await checkIdempotency(
          idempotencyStore as Parameters<typeof checkIdempotency>[0],
          ctx.workspaceId,
          input.idempotency_key,
        );
        if (cached !== null) {
          const parsed = JSON.parse(cached) as {
            goal_id: string;
            metric_name: string;
            period_type: 'DAILY' | 'WEEKLY' | 'MONTHLY';
            period_start: string;
            goal_value: string;          // bigint serialized as string in the dedup cache
            goal_type: 'MINIMUM' | 'MAXIMUM' | 'TARGET';
            request_id: string;
            idempotent_replay: boolean;
          };
          return {
            goal_id: parsed.goal_id,
            metric_name: parsed.metric_name,
            period_type: parsed.period_type,
            period_start: parsed.period_start,
            goal_value: BigInt(parsed.goal_value),
            goal_type: parsed.goal_type,
            request_id: ctx.requestId,
            idempotent_replay: true,
          };
        }

        // Not cached: scoped write (workspace_id from the authenticated claim — fail-closed).
        const result = await dataPlane.upsertGoal({
          workspace_id: ctx.workspaceId,
          metric_name: input.metric_name,
          period_type: input.period_type,
          period_start: input.period_start,
          goal_value: input.goal_value,
          goal_type: input.goal_type,
          idempotency_key: input.idempotency_key,
        });

        const response = {
          goal_id: result.goal_id,
          metric_name: result.metric_name,
          period_type: result.period_type,
          period_start: result.period_start,
          goal_value: result.goal_value,
          goal_type: result.goal_type,
          request_id: ctx.requestId,
          idempotent_replay: false,
        };

        // Store for dedup (bigint → string; cache is plain JSON).
        await storeIdempotencyResult(
          idempotencyStore as Parameters<typeof storeIdempotencyResult>[0],
          ctx.workspaceId,
          input.idempotency_key,
          JSON.stringify({ ...response, goal_value: response.goal_value.toString() }),
        );

        return response;
      }),

    /** Resolved cost stack (COGS settings + cost rows + CM landing). requireRole(ANALYST). READ. */
    costs: workspaceProc.input(dateInput).query(async ({ ctx, input }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `settings.costs requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getCostStack({
        workspace_id: ctx.workspaceId,
        date_range: { start: input.date_start, end: input.date_end },
      });
      // The cost stack lands in the EXISTING cm1_mu (one source of truth — NOT a new COGS def).
      assertSettingsDefinitionId('cm1_mu');
      return {
        result: result.result,
        rows: result.result.cost_rows,
        data_epoch: result.data_epoch,
        request_id: ctx.requestId,
      };
    }),

    /** India festival template calendar (display; CRUD deferred). requireRole(ANALYST). READ. */
    festivals: workspaceProc
      .input(dateInput.extend({ year: z.number().int().min(2020).max(2100).optional() }))
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `settings.festivals requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getFestivalCalendar({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: { year: input.year },
        });
        return {
          result: result.result,
          rows: result.result.rows,
          total_rows: result.result.total_rows,
          peak_multiplier_bp: result.result.peak_multiplier_bp,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),

    // -----------------------------------------------------------------
    // Phase-2 slice-10 (feat-parity-cleanup-pages): thin honest READ surfaces.
    // 🚨 READ-ONLY: each is a `.query`. There is NO write/connect/backfill-trigger
    // mutation here — those are DEFERRED (rendered as disabled affordances). A
    // structural test (CF-S10-NO-WRITE-1) asserts no mutation on these surfaces.
    // -----------------------------------------------------------------

    /** Workspace settings display (name/plan/timezone/region). requireRole(ANALYST). READ. */
    workspace: workspaceProc.query(async ({ ctx }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `settings.workspace requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getWorkspaceSettings({ workspace_id: ctx.workspaceId });
      return { result: result.result, data_epoch: result.data_epoch, request_id: ctx.requestId };
    }),

    /** Connector list + health/status/last-sync. requireRole(ANALYST). READ. Honest (connector cutover HELD). */
    integrations: workspaceProc.query(async ({ ctx }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `settings.integrations requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getIntegrations({ workspace_id: ctx.workspaceId });
      return {
        result: result.result,
        rows: result.result.rows,
        data_epoch: result.data_epoch,
        request_id: ctx.requestId,
      };
    }),

    /** Ads-backfill job status. requireRole(ANALYST). READ. Honest (triggers deferred). */
    backfill: workspaceProc.query(async ({ ctx }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `settings.backfill requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getBackfillStatus({ workspace_id: ctx.workspaceId });
      return {
        result: result.result,
        jobs: result.result.jobs,
        note: result.result.note,
        data_epoch: result.data_epoch,
        request_id: ctx.requestId,
      };
    }),

    // -----------------------------------------------------------------
    // Wave-3 CRUD mutations — all requireRole(MANAGER) or OWNER-only.
    // RLS-scoped via withWorkspace; money in BIGINT minor units.
    // -----------------------------------------------------------------

    /** Create a workspace cost row. requireRole(MANAGER). */
    createCost: workspaceProc
      .input(
        z.object({
          cost_type:    z.enum(['SHIPPING', 'PACKAGING', 'WEBSITE', 'CUSTOM']),
          name:         z.string().trim().max(200).optional().nullable(),
          amount_mu:    z.bigint().nonnegative(),
          is_percent:   z.boolean().optional(),
          currency_code:z.string().trim().max(10).optional().nullable(),
          billing_mode: z.enum(['MONTHLY', 'PER_ORDER']),
          effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          effective_to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.createCost requires MANAGER role. request_id=${ctx.requestId}` });
        }
        try {
          const row = await createCost(ctx.workspaceId, input);
          return { ...row, amount_mu: row.amount_mu.toString(), request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Update a workspace cost row (partial). requireRole(MANAGER). */
    updateCost: workspaceProc
      .input(
        z.object({
          cost_id:      z.string().uuid(),
          cost_type:    z.enum(['SHIPPING', 'PACKAGING', 'WEBSITE', 'CUSTOM']).optional(),
          name:         z.string().trim().max(200).optional().nullable(),
          amount_mu:    z.bigint().nonnegative().optional(),
          is_percent:   z.boolean().optional(),
          currency_code:z.string().trim().max(10).optional().nullable(),
          billing_mode: z.enum(['MONTHLY', 'PER_ORDER']).optional(),
          effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          effective_to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.updateCost requires MANAGER role. request_id=${ctx.requestId}` });
        }
        const { cost_id, ...fields } = input;
        try {
          const row = await updateCost(ctx.workspaceId, cost_id, fields);
          return { ...row, amount_mu: row.amount_mu.toString(), request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Delete a workspace cost row. requireRole(MANAGER). */
    deleteCost: workspaceProc
      .input(z.object({ cost_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.deleteCost requires MANAGER role. request_id=${ctx.requestId}` });
        }
        try {
          const result = await deleteCost(ctx.workspaceId, input.cost_id);
          return { ...result, request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Create a misc expense. requireRole(MANAGER). Idempotent on (name, effective_start_date). */
    createMiscExpense: workspaceProc
      .input(
        z.object({
          name:                 z.string().trim().min(1).max(200),
          amount_mu:            z.bigint().nonnegative(),
          currency_code:        z.string().trim().max(10).optional(),
          effective_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.createMiscExpense requires MANAGER role. request_id=${ctx.requestId}` });
        }
        try {
          const row = await createMiscExpense(ctx.workspaceId, input);
          return { ...row, amount_mu: row.amount_mu.toString(), request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Update a misc expense (partial). requireRole(MANAGER). */
    updateMiscExpense: workspaceProc
      .input(
        z.object({
          expense_id:           z.string().uuid(),
          name:                 z.string().trim().min(1).max(200).optional(),
          amount_mu:            z.bigint().nonnegative().optional(),
          currency_code:        z.string().trim().max(10).optional(),
          effective_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.updateMiscExpense requires MANAGER role. request_id=${ctx.requestId}` });
        }
        const { expense_id, ...fields } = input;
        try {
          const row = await updateMiscExpense(ctx.workspaceId, expense_id, fields);
          return { ...row, amount_mu: row.amount_mu.toString(), request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Delete a misc expense. requireRole(MANAGER). */
    deleteMiscExpense: workspaceProc
      .input(z.object({ expense_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.deleteMiscExpense requires MANAGER role. request_id=${ctx.requestId}` });
        }
        try {
          const result = await deleteMiscExpense(ctx.workspaceId, input.expense_id);
          return { ...result, request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Get founder monthly salary. requireRole(ANALYST). */
    getFounderSalary: workspaceProc.query(async ({ ctx }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: `settings.getFounderSalary requires ANALYST role. request_id=${ctx.requestId}` });
      }
      try {
        const row = await getFounderSalary(ctx.workspaceId);
        return {
          founder_salary_monthly_mu: row.founder_salary_monthly_mu?.toString() ?? null,
          founder_salary_currency:   row.founder_salary_currency,
          request_id: ctx.requestId,
        };
      } catch (err) { throw mapSettingsError(err, ctx.requestId); }
    }),

    /** Set founder monthly salary (OWNER-only). */
    setFounderSalary: workspaceProc
      .input(
        z.object({
          amount_mu:    z.bigint().nonnegative(),
          currency_code:z.string().trim().min(1).max(10),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'OWNER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.setFounderSalary requires OWNER role. request_id=${ctx.requestId}` });
        }
        try {
          const row = await setFounderSalary(ctx.workspaceId, input);
          return {
            founder_salary_monthly_mu: row.founder_salary_monthly_mu?.toString() ?? null,
            founder_salary_currency:   row.founder_salary_currency,
            request_id: ctx.requestId,
          };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /**
     * Update workspace settings (timezone, tax_percent_bp, skip_zero_sales, tags, COGS bp).
     * requireRole(MANAGER).
     */
    updateWorkspaceSettings: workspaceProc
      .input(
        z.object({
          timezone:                    z.string().trim().max(60).optional(),
          tax_percent_bp:              z.number().int().min(0).max(10000).optional(),
          skip_zero_sales_orders:      z.boolean().optional(),
          skipped_shopify_order_tags:  z.array(z.string().trim().max(100)).optional(),
          override_all_cogs_bp:        z.number().int().min(0).max(10000).optional(),
          cogs_markup_bp:              z.number().int().min(0).max(10000).optional(),
          fallback_cogs_bp:            z.number().int().min(0).max(10000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.updateWorkspaceSettings requires MANAGER role. request_id=${ctx.requestId}` });
        }
        try {
          const row = await updateWorkspaceSettings(ctx.workspaceId, input);
          return { ...row, request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /**
     * Delete workspace (OWNER-only). The client must confirm the user's password
     * BEFORE calling this endpoint (Supabase re-auth). Gateway enforces role only —
     * the password-confirm flow is the client's responsibility.
     */
    deleteWorkspace: workspaceProc
      .input(z.object({ confirm: z.literal(true) }))
      .mutation(async ({ ctx, input: _input }) => {
        if (!requireRole(ctx.claim, 'OWNER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.deleteWorkspace requires OWNER role. request_id=${ctx.requestId}` });
        }
        try {
          const result = await deleteWorkspace(ctx.workspaceId);
          return { ...result, request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Create a metric goal. requireRole(MANAGER). Idempotent on (metric, period_type, period_start). */
    createGoal: workspaceProc
      .input(
        z.object({
          metric_name:  z.string().trim().min(1).max(80),
          period_type:  z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
          period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          goal_value:   z.bigint().nonnegative(),
          goal_unit:    z.enum(['mu', 'bp', 'count']).optional(),
          goal_type:    z.enum(['MINIMUM', 'MAXIMUM', 'TARGET']),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.createGoal requires MANAGER role. request_id=${ctx.requestId}` });
        }
        try {
          const row = await createGoal(ctx.workspaceId, input);
          return { ...row, goal_value: row.goal_value.toString(), request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Update a metric goal (partial). requireRole(MANAGER). */
    updateGoal: workspaceProc
      .input(
        z.object({
          goal_id:    z.string().uuid(),
          goal_value: z.bigint().nonnegative().optional(),
          goal_type:  z.enum(['MINIMUM', 'MAXIMUM', 'TARGET']).optional(),
          goal_unit:  z.enum(['mu', 'bp', 'count']).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.updateGoal requires MANAGER role. request_id=${ctx.requestId}` });
        }
        const { goal_id, ...fields } = input;
        try {
          const row = await updateGoal(ctx.workspaceId, goal_id, fields);
          return { ...row, goal_value: row.goal_value.toString(), request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Delete a metric goal. requireRole(MANAGER). */
    deleteGoal: workspaceProc
      .input(z.object({ goal_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.deleteGoal requires MANAGER role. request_id=${ctx.requestId}` });
        }
        try {
          const result = await deleteGoal(ctx.workspaceId, input.goal_id);
          return { ...result, request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /**
     * Classify a campaign's intent (acquisition/retargeting/brand/unclassified).
     * Idempotent UPSERT keyed on (platform, campaign_id). requireRole(MANAGER).
     */
    classifyCampaign: workspaceProc
      .input(
        z.object({
          platform:     z.enum(['meta', 'google']),
          campaign_id:  z.string().trim().min(1).max(200),
          intent:       z.enum(['acquisition', 'retargeting', 'brand', 'unclassified']),
          campaign_name:z.string().trim().max(500).optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.classifyCampaign requires MANAGER role. request_id=${ctx.requestId}` });
        }
        try {
          const row = await upsertAdCampaignClassification(ctx.workspaceId, input);
          return { ...row, request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Create a festival row. requireRole(MANAGER). */
    createFestival: workspaceProc
      .input(
        z.object({
          name:                   z.string().trim().min(1).max(200),
          start_date:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          end_date:               z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          color:                  z.string().trim().max(20).optional(),
          expected_multiplier_bp: z.number().int().min(0),
          regions:                z.array(z.string().trim()).optional(),
          categories:             z.array(z.string().trim()).optional(),
          is_template:            z.boolean().optional(),
          is_active:              z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.createFestival requires MANAGER role. request_id=${ctx.requestId}` });
        }
        try {
          const row = await createFestival(ctx.workspaceId, input);
          return { ...row, request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Update a festival row (partial). requireRole(MANAGER). */
    updateFestival: workspaceProc
      .input(
        z.object({
          festival_id:            z.string().uuid(),
          name:                   z.string().trim().min(1).max(200).optional(),
          start_date:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          end_date:               z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          color:                  z.string().trim().max(20).optional(),
          expected_multiplier_bp: z.number().int().min(0).optional(),
          regions:                z.array(z.string().trim()).optional(),
          categories:             z.array(z.string().trim()).optional(),
          is_active:              z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.updateFestival requires MANAGER role. request_id=${ctx.requestId}` });
        }
        const { festival_id, ...fields } = input;
        try {
          const row = await updateFestival(ctx.workspaceId, festival_id, fields);
          return { ...row, request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /** Delete a festival row. requireRole(MANAGER). */
    deleteFestival: workspaceProc
      .input(z.object({ festival_id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `settings.deleteFestival requires MANAGER role. request_id=${ctx.requestId}` });
        }
        try {
          const result = await deleteFestival(ctx.workspaceId, input.festival_id);
          return { ...result, request_id: ctx.requestId };
        } catch (err) { throw mapSettingsError(err, ctx.requestId); }
      }),

    /**
     * Reset festivals to workspace defaults (delete all non-template rows).
     * Idempotent. requireRole(MANAGER).
     */
    resetFestivals: workspaceProc.mutation(async ({ ctx }) => {
      if (!requireRole(ctx.claim, 'MANAGER')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: `settings.resetFestivals requires MANAGER role. request_id=${ctx.requestId}` });
      }
      try {
        const result = await resetFestivalDefaults(ctx.workspaceId);
        return { ...result, request_id: ctx.requestId };
      } catch (err) { throw mapSettingsError(err, ctx.requestId); }
    }),
  });

  // -------------------------------------------------------------------
  // team router — workspace tier.
  // Phase-2 parity-38 feat-parity-w6b: full CRUD (invite/changeRole/remove/revokeInvite/transfer).
  // 🚨 PII: member email/name. Reads ANALYST-gated, writes MANAGER/OWNER-gated.
  // Role invariants (per legacy):
  //   - OWNER/MANAGER can invite; only OWNER can change/remove another OWNER's role.
  //   - MANAGER cannot remove an OWNER.
  //   - Only OWNER can transfer ownership.
  // Email SENDING is honest-deferred: invite creates the DB row + token only.
  // -------------------------------------------------------------------
  const teamRouter = router({
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
          inviter_role: ctx.claim.workspaceRole as import('../domain/proto-types.js').WorkspaceMemberRole,
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
          actor_role: ctx.claim.workspaceRole as import('../domain/proto-types.js').WorkspaceMemberRole,
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
          actor_role: ctx.claim.workspaceRole as import('../domain/proto-types.js').WorkspaceMemberRole,
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
          actor_role: ctx.claim.workspaceRole as import('../domain/proto-types.js').WorkspaceMemberRole,
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

  // -------------------------------------------------------------------
  // calendar router — workspace tier (Phase-2 slice-7)
  // The period grid (day/week/month) with marketing-action overlays + per-cell directional RAG.
  // Reuses slice-1/2/4 primitives (net_revenue/cm3/mer/amer/cac/aov) — no new metric.
  // -------------------------------------------------------------------
  const calendarRouter = router({
    report: workspaceProc
      .input(dateInput.extend({ grain: z.enum(['day', 'week', 'month']).optional() }))
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `calendar.report requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }
        const result = await dataPlane.getCalendarReport({
          workspace_id: ctx.workspaceId,
          date_range: { start: input.date_start, end: input.date_end },
          filters: { grain: input.grain },
        });
        // Calendar reuses the canonical revenue/cm3 primitives — no learned festival lift.
        assertSettingsDefinitionId('net_revenue_mu');
        return {
          result: result.result,
          rows: result.result.rows,
          total_rows: result.result.total_rows,
          grain: result.result.grain,
          currency_code: result.result.currency_code,
          data_epoch: result.data_epoch,
          request_id: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // lifecycle router — workspace tier, requireRole(ANALYST). READ/ANALYTICS ONLY.
  // Phase-2 slice-8 (feat-lifecycle-timings-email): customer-lifecycle states
  // (recency-vs-empirical-percentile, NOT RFM scoring), order timings (inter-order
  // gaps + reactivation window), email/SMS PERFORMANCE reporting.
  // 🚨 COMPLIANCE (Shreya S4): every procedure is a READ .query — there is NO .mutation,
  // NO send/dispatch/audience surface. These report on PAST performance, never send.
  // -------------------------------------------------------------------
  const lifecycleRouter = router({
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

  // -------------------------------------------------------------------
  // morningBrief router — workspace tier
  // CF-C6-MB-IDEMPOTENCY-1: submitResponse uses Redis dedup.
  // CF-C6-MB-GRADUATED-LABEL-1: status is server-driven.
  // -------------------------------------------------------------------
  const morningBriefRouter = router({
    /** Get the Morning Brief for a workspace+date. requireRole(ANALYST). */
    get: workspaceProc
      .input(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `morningBrief.get requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const brief = await dataPlane.getMorningBrief({
          workspace_id: ctx.workspaceId,
          date: input.date,
        });

        return {
          items: brief.items,
          data_epoch: brief.data_epoch,     // CF-C6-AS-OF-STAMP-1
          freshness_label: brief.freshness_label,
          request_id: ctx.requestId,
        };
      }),

    /**
     * Submit approve/reject/edit response to a Morning Brief insight.
     * CF-C6-MB-IDEMPOTENCY-1: idempotency_key required; Redis dedup guards the write.
     * CF-C6-MB-GRADUATED-LABEL-1: status is server-driven (Day-1 = LOGGED_AS_VOTE).
     * requireRole(MANAGER): logging an approval requires at least MANAGER.
     */
    submitResponse: workspaceProc
      .input(
        z.object({
          insight_id: z.string().uuid('insight_id must be a UUID'),
          response_kind: z.enum(['APPROVE', 'REJECT', 'EDIT']),
          edit_payload: z.string().optional(),
          /** CF-C6-MB-IDEMPOTENCY-1: caller-generated, generated at action-initiation. */
          idempotency_key: z.string().uuid('idempotency_key must be a UUID'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // requireRole(MANAGER) to log an approval-vote.
        if (!requireRole(ctx.claim, 'MANAGER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `morningBrief.submitResponse requires MANAGER role. request_id=${ctx.requestId}`,
          });
        }

        // CF-C6-MB-IDEMPOTENCY-1: check Redis dedup BEFORE writing to ai.decision_log.
        // G-IDEMPOTENT gate: this is the dedup check — removing it = double-write = RED.
        const cached = await checkIdempotency(
          idempotencyStore as Parameters<typeof checkIdempotency>[0],
          ctx.workspaceId,
          input.idempotency_key,
        );

        if (cached !== null) {
          // Return cached response — same key, same result, no second write.
          // idempotent_replay is flipped to true so the caller knows this was a replay.
          const parsed = JSON.parse(cached) as {
            decision_log_row_id: string;
            status: 'LOGGED_AS_VOTE' | 'QUEUED_FOR_EXECUTION';
            request_id: string;
            idempotent_replay: boolean;
          };
          return { ...parsed, idempotent_replay: true };
        }

        // Not cached: call the data plane to write the decision log.
        const result = await dataPlane.submitInsightResponse({
          workspace_id: ctx.workspaceId,
          insight_id: input.insight_id,
          response_kind: input.response_kind as 'APPROVE' | 'REJECT' | 'EDIT',
          edit_payload: input.edit_payload,
          idempotency_key: input.idempotency_key,
        });

        const response = {
          decision_log_row_id: result.decision_log_row_id,
          status: result.status,
          request_id: ctx.requestId,
          idempotent_replay: false,
        };

        // Store in Redis for dedup TTL 24h.
        await storeIdempotencyResult(
          idempotencyStore as Parameters<typeof storeIdempotencyResult>[0],
          ctx.workspaceId,
          input.idempotency_key,
          JSON.stringify(response),
        );

        return response;
      }),
  });

  // -------------------------------------------------------------------
  // device router — workspace tier (mobile-additive)
  // CF-C6-MB-PUSH-TOKEN-1: token registration only; SEND is out of scope.
  // -------------------------------------------------------------------
  const deviceRouter = router({
    /** Register / rotate an Expo push token. Idempotent upsert. */
    registerPushToken: workspaceProc
      // S4 (Slice A): user_id is NOT a client input — it is derived from the
      // verified claim. A client must not be able to register a push token on
      // behalf of another user.
      .input(
        z.object({
          device_id: z.string().min(1),
          expo_push_token: z.string().startsWith('ExponentPushToken'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'VIEWER')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `device.registerPushToken requires VIEWER role. request_id=${ctx.requestId}`,
          });
        }

        const result = await dataPlane.registerPushToken({
          workspace_id: ctx.workspaceId,
          user_id: ctx.claim.userId, // S4: from verified claim, never client input
          device_id: input.device_id,
          expo_push_token: input.expo_push_token,
        });

        return {
          registered: result.registered,
          updated_at: result.updated_at,
          request_id: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // insights router — Phase-2 slice-9 (feat-ai-insight-narration).
  // @paradigm small_llm (Haiku) narration; signals are deterministic sql.
  // 🚨 READ-ONLY: every procedure is a `.query`. There is NO `.mutation`, no
  //    send/dispatch/execute path. The narration reaches NO write/MCP tool
  //    (recommendation-only-until-graduated). A structural test asserts no mutation.
  // CF-S9-FAITHFULNESS-1: assertPageInsightGates re-validates that every narrated
  //    number is grounded in the deterministic signal set BEFORE render
  //    (defense in depth over the intelligence-service gateway).
  // CF-S9-NO-TOOL-REACH-1 + CF-S9-INJECTION-1 enforced in the same gate.
  // -------------------------------------------------------------------
  const insightsRouter = router({
    /** Grounded AI narration for a page (READ). requireRole(ANALYST). */
    forPage: workspaceProc
      .input(
        z.object({
          page: z.enum(['pnl', 'store', 'dashboard']),
          date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (!requireRole(ctx.claim, 'ANALYST')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `insights.forPage requires ANALYST role. request_id=${ctx.requestId}`,
          });
        }

        const { result } = await dataPlane.getPageInsights({
          workspace_id: ctx.workspaceId,
          page: input.page,
          date_range: { start: input.date_start, end: input.date_end },
        });

        // CF-S9: fail-closed BEFORE render — faithfulness + injection + no-tool-reach.
        // Throws (→ INTERNAL error, no narration leaves the BFF) if ANY number in a
        // narration is not in the deterministic signal set, if a fence/role-control
        // sequence survived into output, or if any narration exposes an executable field.
        assertPageInsightGates(result);

        return {
          page: result.page,
          period: result.period,
          signals: result.signals,
          narrations: result.narrations,
          faithfulness_ok: result.faithfulness_ok,
          model_used: result.model_used,
          cached: result.cached,
          paradigm: result.paradigm,
          data_epoch: result.data_epoch, // CF-C6-AS-OF-STAMP-1
          request_id: ctx.requestId,
        };
      }),
  });

  // -------------------------------------------------------------------
  // connectors router (Slice D) — live integrations OAuth + token custody.
  // @paradigm io. READ integrations (Shopify/Meta/Google) — NO outbound send,
  // NO DLT/NCPR/WhatsApp surface. Tokens are SECRET: persisted ENCRYPTED at rest
  // (AES-256-GCM, RLS-scoped) via core-service custody; the token VALUE is NEVER
  // returned by any procedure here (status only). core-service owns the logic.
  // -------------------------------------------------------------------
  const connectorsRouter = router({
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

  // -------------------------------------------------------------------
  // Root router
  // -------------------------------------------------------------------
  return router({
    auth: authRouter,
    workspace: workspaceRouter,
    user: userRouter,
    onboarding: onboardingRouter,
    invitation: invitationRouter,
    notifications: notificationsRouter,
    metrics: metricsRouter,
    store: storeRouter,
    pnl: pnlRouter,
    logistics: logisticsRouter,
    marketing: marketingRouter,
    cohorts: cohortsRouter,
    ltv: ltvRouter,
    catalog: catalogRouter,
    settings: settingsRouter,
    team: teamRouter,
    calendar: calendarRouter,
    lifecycle: lifecycleRouter,
    morningBrief: morningBriefRouter,
    insights: insightsRouter,
    device: deviceRouter,
    connectors: connectorsRouter,
  });
}

export type BrainRouter = ReturnType<typeof createBrainRouter>;

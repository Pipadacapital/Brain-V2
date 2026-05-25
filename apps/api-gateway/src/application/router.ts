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
import { SUGANDH_LOK_WORKSPACE_ID } from '../infrastructure/loopback-data-plane.js';

// ---------------------------------------------------------------------------
// Router factory — accepts the DataPlanePort and IdempotencyStore as deps.
// This enables clean test injection without module mocking.
// CF-C6-DATA-SEAM-1: DataPlanePort is the ONLY data path. No direct DB access.
// ---------------------------------------------------------------------------

/**
 * Map a core-service OnboardingError to a tRPC error (Slice C). Validation/slug
 * issues → BAD_REQUEST; invitation issues → NOT_FOUND/CONFLICT/GONE. A non-
 * OnboardingError (e.g. a DB fault) is re-wrapped as INTERNAL_SERVER_ERROR with a
 * GENERIC message — the underlying error detail is NEVER surfaced (no PII / no DB
 * internals leak), only the requestId for correlation.
 */
function mapOnboardingError(err: unknown, requestId: string): TRPCError {
  if (err instanceof OnboardingError) {
    const codeMap: Record<string, 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND'> = {
      VALIDATION: 'BAD_REQUEST',
      SLUG_INVALID: 'BAD_REQUEST',
      SLUG_TAKEN: 'CONFLICT',
      INVITATION_NOT_FOUND: 'NOT_FOUND',
      INVITATION_NOT_PENDING: 'CONFLICT',
      INVITATION_EXPIRED: 'CONFLICT',
    };
    return new TRPCError({
      code: codeMap[err.code] ?? 'BAD_REQUEST',
      message: `${err.message} request_id=${requestId}`,
    });
  }
  // Unknown / DB fault: generic message only (never echo the raw error).
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `Operation failed. request_id=${requestId}`,
  });
}

export function createBrainRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  // -------------------------------------------------------------------
  // auth router
  // -------------------------------------------------------------------
  const authRouter = router({
    /** Return the current session claim (authed tier). */
    session: authedProc.query(({ ctx }) => {
      return {
        userId: ctx.claim.userId,
        workspaceId: ctx.claim.workspaceId,
        workspaceRole: ctx.claim.workspaceRole,
        requestId: ctx.requestId,
      };
    }),
  });

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
        })),
        requestId: ctx.requestId,
      };
    }),

    /**
     * Data-reconciliation signal (Slice C). The StubDataPlane analytics are keyed
     * to the seeded Sugandh-Lok workspace (the demo). A freshly-onboarded workspace
     * has a brand-new UUID and NO analytics data — and the LIVE data plane is slice
     * D. Rather than fabricate numbers or crash, the dashboard asks here whether the
     * active workspace has seed data; if not it renders the honest
     * "no data yet — connect a store (coming in integrations)" empty-state.
     * Workspace tier: workspaceId === claim.workspaceId is already asserted.
     */
    dataAvailability: workspaceProc.query(({ ctx }) => {
      return {
        hasSeedData: ctx.workspaceId === SUGANDH_LOK_WORKSPACE_ID,
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
          return { workspaceId, slug, redirectTo: '/dashboard', requestId: ctx.requestId };
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
  });

  // -------------------------------------------------------------------
  // logistics router — workspace tier, requireRole(ANALYST)
  // Phase-2 slice-3 (feat-rto-cod-economics): RTO/COD/logistics/pincode economics.
  // CF-C6-RENDER-ONLY-1: zero arithmetic here — values from the data plane.
  // CF-C6-REGISTRY-ONLY-BFF-1: every metric field traces a registry definition_id.
  // CF-C6-BIGINT-JSON-1: _mu = bigint over superjson.
  // -------------------------------------------------------------------
  const dateInput = z.object({
    date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
    date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date required'),
  });

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

    /** COD vs prepaid economics + break-even. requireRole(ANALYST). */
    codPrepaid: workspaceProc.input(dateInput).query(async ({ ctx, input }) => {
      if (!requireRole(ctx.claim, 'ANALYST')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `logistics.codPrepaid requires ANALYST role. request_id=${ctx.requestId}`,
        });
      }
      const result = await dataPlane.getCodPrepaid({
        workspace_id: ctx.workspaceId,
        date_range: { start: input.date_start, end: input.date_end },
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
          date_range: { start: input.date_start, end: input.date_end },
          filters: {
            grain: input.grain,
            sort: input.sort,
            direction: input.direction,
            status_filter: input.status_filter,
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
  });

  // -------------------------------------------------------------------
  // team router — workspace tier, requireRole(ANALYST). READ-ONLY.
  // Phase-2 slice-10 (feat-parity-cleanup-pages): workspace member list.
  // 🚨 PII: member email/name. READ-only, workspace-scoped, ANALYST-gated, fail-closed.
  //    Member invite (which emails a person, ADMIN-gated) is DEFERRED — NO mutation here.
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
  // Root router
  // -------------------------------------------------------------------
  return router({
    auth: authRouter,
    workspace: workspaceRouter,
    user: userRouter,
    onboarding: onboardingRouter,
    invitation: invitationRouter,
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
  });
}

export type BrainRouter = ReturnType<typeof createBrainRouter>;

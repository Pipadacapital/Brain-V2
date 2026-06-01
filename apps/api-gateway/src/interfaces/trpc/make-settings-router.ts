// @paradigm: sql
// Thin tRPC router — settings domain (Phase-E router split). Extracted verbatim from
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

export function makeSettingsRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
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
}

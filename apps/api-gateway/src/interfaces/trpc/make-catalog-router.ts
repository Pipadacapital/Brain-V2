// @paradigm: sql
// Thin tRPC router — catalog domain (Phase-E router split). Extracted verbatim from
// application/router.ts; behaviour byte-identical. createBrainRouter composes this factory.
// CF-C6-RENDER-ONLY-1 + CF-C6-REGISTRY-ONLY-BFF-1 preserved (no arithmetic; registry-traced).

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { requireRole } from '@brain/core-auth';
import {
  router,
  workspaceProc,
} from '../../application/trpc.js';
import {
  listProductsForCogs,
  updateProductCogs,
  bulkUpdateProductCogs,
} from '@brain/core-product-cogs';
import { assertCatalogDefinitionId } from '../../domain/registry-mapper.js';
import {
  type IdempotencyStore,
} from '../../domain/idempotency.js';
import type { DataPlanePort } from '../../domain/proto-types.js';
import { dateInput } from './shared-inputs.js';

export function makeCatalogRouter(
  dataPlane: DataPlanePort,
  idempotencyStore: IdempotencyStore,
) {
  return router({
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
}

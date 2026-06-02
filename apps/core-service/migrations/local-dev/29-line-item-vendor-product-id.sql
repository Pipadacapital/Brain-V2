-- =============================================================================
-- 29 — line-item vendor_product_id (production-readiness P0 #1).
--
-- The original slice-E connector_line_item_facts schema (migration 05) omitted
-- the line-item -> product join key. Without it, COGS / CM1 / CM2 / product
-- performance / product cohorts / distributions all compute to ZERO (the join
-- to connector_product_facts has nothing to match on), and the PG read-path
-- fallback references a column that does not exist -> live HTTP 500s on
-- catalog.products, marketing.distributions, pnl.periodGrid.
--
-- The legacy source carries it: shopify_line_items.product_shopify_id and
-- woocommerce_line_items.product_id. This migration adds the column; the data
-- backfill lives in tools/migrate-legacy (one-shot ETL) and the CH side in
-- tools/migrate-legacy/phase8-ch-backfill.sql (connector_line_item_facts already
-- has the column; it must be populated, not left '').
--
-- connector_line_item_facts is a VIEW over _hot, so the view is recreated to
-- expose the new column. Money: none. RLS: inherited from the _hot table.
-- =============================================================================

ALTER TABLE public.connector_line_item_facts_hot
  ADD COLUMN IF NOT EXISTS vendor_product_id text;

CREATE INDEX IF NOT EXISTS connector_line_item_facts_product_idx
  ON public.connector_line_item_facts_hot (workspace_id, vendor, vendor_product_id);

CREATE OR REPLACE VIEW public.connector_line_item_facts AS
  SELECT id, workspace_id, vendor, vendor_order_id, vendor_line_id,
         sku, title, quantity, unit_price_mu, gst_slab_bp, synced_at,
         vendor_product_id
    FROM public.connector_line_item_facts_hot;

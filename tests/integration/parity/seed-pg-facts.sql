-- =============================================================================
-- PG facts seed for the PG↔CH parity gate.
--
-- Workspace: f165da80-e6d5-4c58-9aff-ec654b873bd7 (Sugandhlok)
--
-- Design: seed only Postgres; ClickHouse is derived by phase8-ch-backfill.sql
-- pointing at the disposable PG container. Parity by construction.
--
-- Inserts run as postgres (superuser, BYPASSRLS). The RLS policies on the _hot
-- tables enforce workspace_id at runtime for the app role (rls_app) — seeding
-- as postgres is RLS-exempt and correct for a disposable test DB.
--
-- Money: all amounts in integer minor units (paise = INR×100). No floats.
-- Dates: all orders in 2025 so readDailyNetSales(WS, '2025-01-01', '2025-12-31')
-- returns rows.
--
-- PARITY DESIGN NOTES:
--
-- 1) readCodPrepaid: PG filters the entire result set with WHERE CANCELLED
--    (only non-cancelled orders in the aggregate), while CH's readCodPrepaidCH
--    counts ALL rows for the COD/Prepaid counts (no CANCELLED outer filter) and
--    applies CANCELLED_OK only to the aov/net sub-expressions. To make both
--    planes agree, the cancelled order uses payment_method=NULL so it does not
--    affect codOrders or prepaidOrders in either plane regardless of filtering.
--
-- 2) readDistributions: PG uses mode() WITHIN GROUP, CH uses topK(1). For
--    deterministic parity, each product's line items all use the same unit_price_mu
--    so mode()=topK(1)=that single price (clear dominant value).
--
-- 3) COGS join: vendor_product_id on line items must match connector_product_facts
--    for covered lines > 0. All line items use prod-001/002/003 which have cost_mu>0.
-- =============================================================================

-- The workspace requires a created_by_id → users.id FK.
-- Insert a stub user first, then the workspace.
-- Both are inserted as postgres (superuser, RLS-exempt).
INSERT INTO public.users (id, email, full_name, system_role, created_at, updated_at)
VALUES (
  'e0000000-0000-0000-0000-000000000001',
  'seed@brain.internal',
  'Seed User',
  'USER',
  '2024-01-01 00:00:00Z',
  '2024-01-01 00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspaces (id, name, slug, platform, created_by_id, created_at, updated_at)
VALUES (
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'Sugandhlok',
  'sugandhlok',
  'SHOPIFY',
  'e0000000-0000-0000-0000-000000000001',
  '2024-01-01 00:00:00Z',
  '2024-01-01 00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1) connector_product_facts — 3 products with cost_mu > 0 so COGS join works.
--    Vendor: SHOPIFY.
--    vendor_product_id must match the line items' vendor_product_id for the join.
-- ---------------------------------------------------------------------------
INSERT INTO public.connector_product_facts
  (id, workspace_id, vendor, vendor_product_id, title, cost_mu, mrp_mu,
   inventory_qty, handle, image_url, tags, synced_at)
VALUES
  (
    'a1000000-0000-0000-0000-000000000001',
    'f165da80-e6d5-4c58-9aff-ec654b873bd7',
    'SHOPIFY', 'prod-001', 'Rose Water Toner', 12000, 45000,
    100, 'rose-water-toner', '', '{}',
    '2025-01-02 00:00:00Z'
  ),
  (
    'a1000000-0000-0000-0000-000000000002',
    'f165da80-e6d5-4c58-9aff-ec654b873bd7',
    'SHOPIFY', 'prod-002', 'Sandalwood Face Wash', 8000, 35000,
    200, 'sandalwood-face-wash', '', '{}',
    '2025-01-02 00:00:00Z'
  ),
  (
    'a1000000-0000-0000-0000-000000000003',
    'f165da80-e6d5-4c58-9aff-ec654b873bd7',
    'SHOPIFY', 'prod-003', 'Turmeric Serum', 15000, 60000,
    50, 'turmeric-serum', '', '{}',
    '2025-01-02 00:00:00Z'
  )
ON CONFLICT (workspace_id, vendor, vendor_product_id) DO UPDATE
  SET cost_mu   = EXCLUDED.cost_mu,
      mrp_mu    = EXCLUDED.mrp_mu,
      title     = EXCLUDED.title,
      synced_at = EXCLUDED.synced_at;

-- ---------------------------------------------------------------------------
-- 2) connector_order_facts_hot — 8 orders across 2025.
--
--    Customer refs (opaque strings for new-vs-returning):
--      cust-a: orders 1, 3, 5  (3 orders — tests cohort rr90 + multi-order LTV)
--      cust-b: orders 2, 4     (2 orders — tests rr90 within 90d)
--      cust-c: order 6         (single order — new customer, no repeat)
--      cust-d: order 7         (single order, COD)
--      (no customer for order 8 — cancelled order, payment_method=NULL)
--
--    Payment methods: COD / Prepaid / NULL (cancelled order).
--
--    Cancelled order 8: financial_status='voided', cancelled_at IS NOT NULL,
--    payment_method=NULL. Because payment_method is NULL:
--      - PG: excluded by WHERE CANCELLED (cancelled_at IS NOT NULL) → no effect
--      - CH: countIf(payment_method='COD')=0, countIf(payment_method='Prepaid')=0
--            for this row in either case → same result as PG
--    This ensures readCodPrepaid gives the same counts on both planes.
--
--    Non-cancelled orders by payment_method:
--      Prepaid: 1, 3, 5, 6   (4 orders)
--      COD:     2, 4, 7      (3 orders)
-- ---------------------------------------------------------------------------

-- Order 1: cust-a first order, 2025-02-15, Prepaid, not cancelled
INSERT INTO public.connector_order_facts_hot
  (id, workspace_id, vendor, vendor_order_id, financial_status, fulfillment_status,
   payment_method, currency_code,
   gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
   customer_ref, is_new_customer, delivery_pincode, delivery_city,
   processed_at, cancelled_at, is_cod, total_refund_mu, synced_at)
VALUES (
  'b1000000-0000-0000-0000-000000000001',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-001', 'paid', 'fulfilled',
  'Prepaid', 'INR',
  45000, 2000, 3000, 5000,
  'cust-a', TRUE, '110001', 'Delhi',
  '2025-02-15 10:00:00Z', NULL, FALSE, 0,
  '2025-02-15 10:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id) DO NOTHING;

-- Order 2: cust-b first order, 2025-03-10, COD, not cancelled
INSERT INTO public.connector_order_facts_hot
  (id, workspace_id, vendor, vendor_order_id, financial_status, fulfillment_status,
   payment_method, currency_code,
   gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
   customer_ref, is_new_customer, delivery_pincode, delivery_city,
   processed_at, cancelled_at, is_cod, total_refund_mu, synced_at)
VALUES (
  'b1000000-0000-0000-0000-000000000002',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-002', 'paid', 'fulfilled',
  'COD', 'INR',
  35000, 0, 1800, 0,
  'cust-b', TRUE, '400001', 'Mumbai',
  '2025-03-10 12:00:00Z', NULL, TRUE, 0,
  '2025-03-10 12:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id) DO NOTHING;

-- Order 3: cust-a second order, 2025-04-20 (64d after first → within 90d rr90), Prepaid
INSERT INTO public.connector_order_facts_hot
  (id, workspace_id, vendor, vendor_order_id, financial_status, fulfillment_status,
   payment_method, currency_code,
   gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
   customer_ref, is_new_customer, delivery_pincode, delivery_city,
   processed_at, cancelled_at, is_cod, total_refund_mu, synced_at)
VALUES (
  'b1000000-0000-0000-0000-000000000003',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-003', 'paid', 'fulfilled',
  'Prepaid', 'INR',
  60000, 5000, 4000, 0,
  'cust-a', FALSE, '110001', 'Delhi',
  '2025-04-20 09:00:00Z', NULL, FALSE, 0,
  '2025-04-20 09:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id) DO NOTHING;

-- Order 4: cust-b second order, 2025-05-01 (52d from first → within 90d rr90), COD
INSERT INTO public.connector_order_facts_hot
  (id, workspace_id, vendor, vendor_order_id, financial_status, fulfillment_status,
   payment_method, currency_code,
   gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
   customer_ref, is_new_customer, delivery_pincode, delivery_city,
   processed_at, cancelled_at, is_cod, total_refund_mu, synced_at)
VALUES (
  'b1000000-0000-0000-0000-000000000004',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-004', 'paid', 'fulfilled',
  'COD', 'INR',
  28000, 1000, 900, 0,
  'cust-b', FALSE, '400001', 'Mumbai',
  '2025-05-01 15:00:00Z', NULL, TRUE, 0,
  '2025-05-01 15:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id) DO NOTHING;

-- Order 5: cust-a third order, 2025-07-10, Prepaid
INSERT INTO public.connector_order_facts_hot
  (id, workspace_id, vendor, vendor_order_id, financial_status, fulfillment_status,
   payment_method, currency_code,
   gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
   customer_ref, is_new_customer, delivery_pincode, delivery_city,
   processed_at, cancelled_at, is_cod, total_refund_mu, synced_at)
VALUES (
  'b1000000-0000-0000-0000-000000000005',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-005', 'paid', 'fulfilled',
  'Prepaid', 'INR',
  72000, 0, 5000, 5000,
  'cust-a', FALSE, '110001', 'Delhi',
  '2025-07-10 11:00:00Z', NULL, FALSE, 0,
  '2025-07-10 11:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id) DO NOTHING;

-- Order 6: cust-c single order, 2025-08-05, Prepaid
INSERT INTO public.connector_order_facts_hot
  (id, workspace_id, vendor, vendor_order_id, financial_status, fulfillment_status,
   payment_method, currency_code,
   gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
   customer_ref, is_new_customer, delivery_pincode, delivery_city,
   processed_at, cancelled_at, is_cod, total_refund_mu, synced_at)
VALUES (
  'b1000000-0000-0000-0000-000000000006',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-006', 'paid', 'fulfilled',
  'Prepaid', 'INR',
  50000, 3000, 2500, 0,
  'cust-c', TRUE, '560001', 'Bangalore',
  '2025-08-05 14:00:00Z', NULL, FALSE, 0,
  '2025-08-05 14:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id) DO NOTHING;

-- Order 7: cust-d single order, 2025-09-15, COD
INSERT INTO public.connector_order_facts_hot
  (id, workspace_id, vendor, vendor_order_id, financial_status, fulfillment_status,
   payment_method, currency_code,
   gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
   customer_ref, is_new_customer, delivery_pincode, delivery_city,
   processed_at, cancelled_at, is_cod, total_refund_mu, synced_at)
VALUES (
  'b1000000-0000-0000-0000-000000000007',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-007', 'paid', 'fulfilled',
  'COD', 'INR',
  40000, 0, 2000, 0,
  'cust-d', TRUE, '700001', 'Kolkata',
  '2025-09-15 10:00:00Z', NULL, TRUE, 0,
  '2025-09-15 10:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id) DO NOTHING;

-- Order 8: cancelled order (voided), 2025-10-01.
-- payment_method=NULL so it does not affect readCodPrepaid COD/Prepaid counts
-- on either plane — see PARITY DESIGN NOTES above.
-- customer_ref=NULL so it is excluded from cohort/LTV/marketing queries by both
-- planes (PG: customer_ref IS NOT NULL; CH: customer_ref != '').
INSERT INTO public.connector_order_facts_hot
  (id, workspace_id, vendor, vendor_order_id, financial_status, fulfillment_status,
   payment_method, currency_code,
   gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
   customer_ref, is_new_customer, delivery_pincode, delivery_city,
   processed_at, cancelled_at, is_cod, total_refund_mu, synced_at)
VALUES (
  'b1000000-0000-0000-0000-000000000008',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-008', 'voided', 'unfulfilled',
  NULL, 'INR',
  25000, 0, 1500, 0,
  NULL, TRUE, '110001', 'Delhi',
  '2025-10-01 09:00:00Z', '2025-10-01 10:00:00Z', FALSE, 25000,
  '2025-10-01 10:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) connector_line_item_facts_hot
--
--    PARITY DESIGN FOR readDistributions:
--    PG mode() WITHIN GROUP and CH topK(1) both return the most-frequent value.
--    For deterministic parity, each product uses the SAME unit_price_mu across
--    all its line items (no price variation per product), making the mode and
--    topK unambiguous.
--
--    Product prices (fixed per product):
--      prod-001 (Rose Water Toner):    45000 mu per unit
--      prod-002 (Sandalwood Face Wash): 35000 mu per unit
--      prod-003 (Turmeric Serum):       30000 mu per unit
--
--    Note: some order gross_sales_mu differ from line totals because real orders
--    have discounts/taxes applied differently — the readers do not cross-validate
--    order total vs line total, so this is fine.
-- ---------------------------------------------------------------------------

-- order-001 line items: 1 unit of prod-001 at 45000
INSERT INTO public.connector_line_item_facts_hot
  (id, workspace_id, vendor, vendor_order_id, vendor_line_id,
   sku, title, quantity, unit_price_mu, gst_slab_bp, vendor_product_id, synced_at)
VALUES (
  'c1000000-0000-0000-0000-000000000001',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-001', 'line-001-a',
  'SKU-001', 'Rose Water Toner', 1, 45000, 1800, 'prod-001',
  '2025-02-15 10:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

-- order-002 line items: 1 unit of prod-002 at 35000
INSERT INTO public.connector_line_item_facts_hot
  (id, workspace_id, vendor, vendor_order_id, vendor_line_id,
   sku, title, quantity, unit_price_mu, gst_slab_bp, vendor_product_id, synced_at)
VALUES (
  'c1000000-0000-0000-0000-000000000002',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-002', 'line-002-a',
  'SKU-002', 'Sandalwood Face Wash', 1, 35000, 1800, 'prod-002',
  '2025-03-10 12:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

-- order-003 line items: 1×prod-001 + 1×prod-003
INSERT INTO public.connector_line_item_facts_hot
  (id, workspace_id, vendor, vendor_order_id, vendor_line_id,
   sku, title, quantity, unit_price_mu, gst_slab_bp, vendor_product_id, synced_at)
VALUES (
  'c1000000-0000-0000-0000-000000000003',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-003', 'line-003-a',
  'SKU-001', 'Rose Water Toner', 1, 45000, 1800, 'prod-001',
  '2025-04-20 09:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

INSERT INTO public.connector_line_item_facts_hot
  (id, workspace_id, vendor, vendor_order_id, vendor_line_id,
   sku, title, quantity, unit_price_mu, gst_slab_bp, vendor_product_id, synced_at)
VALUES (
  'c1000000-0000-0000-0000-000000000004',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-003', 'line-003-b',
  'SKU-003', 'Turmeric Serum', 1, 30000, 1800, 'prod-003',
  '2025-04-20 09:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

-- order-004 line items: 1×prod-002 at 35000
INSERT INTO public.connector_line_item_facts_hot
  (id, workspace_id, vendor, vendor_order_id, vendor_line_id,
   sku, title, quantity, unit_price_mu, gst_slab_bp, vendor_product_id, synced_at)
VALUES (
  'c1000000-0000-0000-0000-000000000005',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-004', 'line-004-a',
  'SKU-002', 'Sandalwood Face Wash', 1, 35000, 1800, 'prod-002',
  '2025-05-01 15:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

-- order-005 line items: 1×prod-001 at 45000 + 1×prod-003 at 30000
INSERT INTO public.connector_line_item_facts_hot
  (id, workspace_id, vendor, vendor_order_id, vendor_line_id,
   sku, title, quantity, unit_price_mu, gst_slab_bp, vendor_product_id, synced_at)
VALUES (
  'c1000000-0000-0000-0000-000000000006',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-005', 'line-005-a',
  'SKU-001', 'Rose Water Toner', 1, 45000, 1800, 'prod-001',
  '2025-07-10 11:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

INSERT INTO public.connector_line_item_facts_hot
  (id, workspace_id, vendor, vendor_order_id, vendor_line_id,
   sku, title, quantity, unit_price_mu, gst_slab_bp, vendor_product_id, synced_at)
VALUES (
  'c1000000-0000-0000-0000-000000000007',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-005', 'line-005-b',
  'SKU-003', 'Turmeric Serum', 1, 30000, 1800, 'prod-003',
  '2025-07-10 11:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

-- order-006 line items: 1×prod-002 at 35000
INSERT INTO public.connector_line_item_facts_hot
  (id, workspace_id, vendor, vendor_order_id, vendor_line_id,
   sku, title, quantity, unit_price_mu, gst_slab_bp, vendor_product_id, synced_at)
VALUES (
  'c1000000-0000-0000-0000-000000000008',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-006', 'line-006-a',
  'SKU-002', 'Sandalwood Face Wash', 1, 35000, 1800, 'prod-002',
  '2025-08-05 14:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

-- order-007 line items: 1×prod-003 at 30000
INSERT INTO public.connector_line_item_facts_hot
  (id, workspace_id, vendor, vendor_order_id, vendor_line_id,
   sku, title, quantity, unit_price_mu, gst_slab_bp, vendor_product_id, synced_at)
VALUES (
  'c1000000-0000-0000-0000-000000000009',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-007', 'line-007-a',
  'SKU-003', 'Turmeric Serum', 1, 30000, 1800, 'prod-003',
  '2025-09-15 10:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

-- order-008 (cancelled) line items: 1×prod-001 at 45000.
-- Phase8 backfills this; CH includes it. Both PG and CH COGS readers join
-- line items without cancellation filter (the cancelled_at filter is on orders).
-- Having this line present exercises coveredLines counting on BOTH planes.
INSERT INTO public.connector_line_item_facts_hot
  (id, workspace_id, vendor, vendor_order_id, vendor_line_id,
   sku, title, quantity, unit_price_mu, gst_slab_bp, vendor_product_id, synced_at)
VALUES (
  'c1000000-0000-0000-0000-000000000010',
  'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  'SHOPIFY', 'order-008', 'line-008-a',
  'SKU-001', 'Rose Water Toner', 1, 45000, 1800, 'prod-001',
  '2025-10-01 10:01:00Z'
)
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) connector_ad_spend_facts — Meta + Google spend for readMarketing/readPnl.
--    Spread across months in 2025.
-- ---------------------------------------------------------------------------

-- META: 3 campaign-day rows spread across Feb, Mar, Apr 2025
INSERT INTO public.connector_ad_spend_facts
  (id, workspace_id, vendor, campaign_id, campaign_name,
   spend_date, spend_mu, impressions, clicks, currency_code, synced_at)
VALUES
  (
    'd1000000-0000-0000-0000-000000000001',
    'f165da80-e6d5-4c58-9aff-ec654b873bd7',
    'META', 'meta-camp-001', 'Brand Awareness Feb',
    '2025-02-14', 5000, 10000, 250, 'INR',
    '2025-02-15 00:01:00Z'
  ),
  (
    'd1000000-0000-0000-0000-000000000002',
    'f165da80-e6d5-4c58-9aff-ec654b873bd7',
    'META', 'meta-camp-001', 'Brand Awareness Mar',
    '2025-03-09', 6000, 12000, 300, 'INR',
    '2025-03-10 00:01:00Z'
  ),
  (
    'd1000000-0000-0000-0000-000000000003',
    'f165da80-e6d5-4c58-9aff-ec654b873bd7',
    'META', 'meta-camp-002', 'Retargeting Apr',
    '2025-04-19', 4000, 8000, 200, 'INR',
    '2025-04-20 00:01:00Z'
  )
ON CONFLICT (workspace_id, vendor, campaign_id, spend_date) DO NOTHING;

-- GOOGLE: 2 campaign-day rows
INSERT INTO public.connector_ad_spend_facts
  (id, workspace_id, vendor, campaign_id, campaign_name,
   spend_date, spend_mu, impressions, clicks, currency_code, synced_at)
VALUES
  (
    'd1000000-0000-0000-0000-000000000004',
    'f165da80-e6d5-4c58-9aff-ec654b873bd7',
    'GOOGLE', 'goog-camp-001', 'Search Feb',
    '2025-02-14', 3000, 5000, 120, 'INR',
    '2025-02-15 00:02:00Z'
  ),
  (
    'd1000000-0000-0000-0000-000000000005',
    'f165da80-e6d5-4c58-9aff-ec654b873bd7',
    'GOOGLE', 'goog-camp-001', 'Search May',
    '2025-05-01', 2500, 4500, 100, 'INR',
    '2025-05-01 00:02:00Z'
  )
ON CONFLICT (workspace_id, vendor, campaign_id, spend_date) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verification — row counts (informational; non-zero confirms seed applied).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  product_count  bigint;
  order_count    bigint;
  line_count     bigint;
  spend_count    bigint;
BEGIN
  SELECT count(*) INTO product_count FROM public.connector_product_facts
    WHERE workspace_id = 'f165da80-e6d5-4c58-9aff-ec654b873bd7';
  SELECT count(*) INTO order_count FROM public.connector_order_facts_hot
    WHERE workspace_id = 'f165da80-e6d5-4c58-9aff-ec654b873bd7';
  SELECT count(*) INTO line_count FROM public.connector_line_item_facts_hot
    WHERE workspace_id = 'f165da80-e6d5-4c58-9aff-ec654b873bd7';
  SELECT count(*) INTO spend_count FROM public.connector_ad_spend_facts
    WHERE workspace_id = 'f165da80-e6d5-4c58-9aff-ec654b873bd7';
  RAISE NOTICE 'parity seed: products=% orders=% lines=% spend=%',
    product_count, order_count, line_count, spend_count;
END $$;

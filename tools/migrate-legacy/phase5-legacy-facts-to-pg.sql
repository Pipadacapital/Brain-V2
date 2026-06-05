-- =============================================================================
-- Phase 5 (Slice-E) — Legacy raw facts → local brain_dev connector_*_facts tables
-- =============================================================================
-- Purpose : Reconstruct the ad-hoc ETL that was lost with /tmp/brain_mig so the
--           local app has real revenue data for all 3 data-bearing workspaces
--           (Sugandhlok / Boddactive / Boddactive UAE).
--
-- Read-only contract on legacy_src.* — no INSERT/UPDATE/DELETE on the FDW side.
-- All writes are to local brain_dev tables only.
--
-- FDW prerequisite : Phase-0 established SERVER legacy_supa + the legacy_src schema.
--   Phase 2 added FDW tables for workspaces/users/members/invitations.
--   This script adds FDW tables for the six raw-data source tables and executes
--   the transformation INSERT.
--
-- MONEY UNIT FINDING (verified 2026-06-03):
--   Legacy Shopify tables store money as DECIMAL(12,2) in RUPEE major units.
--   E.g. total_price = 509.00 means INR 509.00.
--   Target connector_*_facts tables store money as BIGINT in PAISA (minor units).
--   CONVERSION: multiply by 100 and ROUND to nearest integer (ROUND(x * 100)::bigint).
--   Do NOT skip this multiply — legacy is NOT already in minor units.
--
-- Meta/Google ad spend (spend column) is also in major units (INR or AED).
--   Same ×100 conversion applies.
--
-- Shiprocket cod_amount and charges are in major units. Same ×100 applies.
--
-- IDEMPOTENT: every INSERT uses ON CONFLICT DO NOTHING on the unique key.
--   Re-running is safe; it will skip already-loaded rows.
--
-- DOES NOT EXIST in local PG — created here:
--   connector_shipment_facts  (phase8-ch-backfill.sql reads it; it was missing locally)
--
-- Workspaces with fact data:
--   f165da80-e6d5-4c58-9aff-ec654b873bd7  Sugandhlok   (60 170 orders, 4 158 meta rows, 2 266 Google rows)
--   f7f275b0-c209-40ff-b930-5060ed3940b9  Boddactive   (23 412 orders, 3 590 meta rows, 2 516 shipments)
--   86a6d893-3b3a-4939-b44f-492287db7aa1  Boddactive UAE (27 orders, 37 meta rows)
--   ca620099-f6b3-4e59-8fd1-f5620ad71cd1  Ulinen       (5 188 Google rows)
--
-- Apply via:
--   docker exec -i brain-postgres-dev psql -U postgres -d brain_dev \
--     < tools/migrate-legacy/phase5-legacy-facts-to-pg.sql
-- =============================================================================

SET TIME ZONE 'UTC';

-- ---------------------------------------------------------------------------
-- 0) FDW foreign tables for legacy source tables (idempotent DROP IF EXISTS)
-- ---------------------------------------------------------------------------

-- careful-ok: DROP FOREIGN TABLE is intentional for idempotent re-run
DROP FOREIGN TABLE IF EXISTS legacy_src.shopify_connections;
CREATE FOREIGN TABLE legacy_src.shopify_connections (
    id uuid,
    workspace_id uuid,
    shop_domain text,
    status text,
    last_sync_at timestamp with time zone,
    installed_at timestamp with time zone,
    updated_at timestamp with time zone
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'shopify_connections');

DROP FOREIGN TABLE IF EXISTS legacy_src.shopify_orders;
CREATE FOREIGN TABLE legacy_src.shopify_orders (
    id uuid,
    connection_id uuid,
    shopify_id text,
    order_number text,
    name text,
    email text,
    total_price numeric,
    subtotal_price numeric,
    total_tax numeric,
    total_discount numeric,
    currency text,
    financial_status text,
    fulfillment_status text,
    customer_shopify_id text,
    processed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    tags text[],
    created_at timestamp with time zone,
    updated_at timestamp with time zone
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'shopify_orders');

DROP FOREIGN TABLE IF EXISTS legacy_src.shopify_line_items;
CREATE FOREIGN TABLE legacy_src.shopify_line_items (
    id uuid,
    order_id uuid,
    connection_id uuid,
    shopify_id text,
    title text,
    quantity integer,
    price numeric,
    sku text,
    variant_title text,
    product_shopify_id text,
    processed_at timestamp with time zone
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'shopify_line_items');

DROP FOREIGN TABLE IF EXISTS legacy_src.shopify_products;
CREATE FOREIGN TABLE legacy_src.shopify_products (
    id uuid,
    connection_id uuid,
    shopify_id text,
    title text,
    handle text,
    vendor text,
    product_type text,
    status text,
    tags text[],
    image_url text,
    total_inventory integer,
    published_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    coq numeric
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'shopify_products');

DROP FOREIGN TABLE IF EXISTS legacy_src.shopify_refund_line_items;
CREATE FOREIGN TABLE legacy_src.shopify_refund_line_items (
    id uuid,
    connection_id uuid,
    shopify_refund_id text,
    shopify_refund_line_id text,
    shopify_order_id text,
    order_id uuid,
    shopify_line_item_id text,
    line_item_id uuid,
    product_shopify_id text,
    sku text,
    quantity integer,
    subtotal_amount numeric,
    total_tax_amount numeric,
    processed_at timestamp with time zone
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'shopify_refund_line_items');

DROP FOREIGN TABLE IF EXISTS legacy_src.meta_ads_connections;
CREATE FOREIGN TABLE legacy_src.meta_ads_connections (
    id uuid,
    workspace_id uuid,
    ad_account_ids text[],
    selected_ad_account_ids text[],
    selected_ad_account_id text,
    currency text,
    status text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'meta_ads_connections');

DROP FOREIGN TABLE IF EXISTS legacy_src.meta_ads_daily_metrics;
CREATE FOREIGN TABLE legacy_src.meta_ads_daily_metrics (
    id uuid,
    connection_id uuid,
    ad_account_id text,
    campaign_id text,
    campaign_name text,
    adset_id text,
    adset_name text,
    date date,
    impressions integer,
    clicks integer,
    spend numeric,
    conversions integer,
    revenue numeric,
    ctr numeric,
    cpc numeric,
    cpm numeric,
    created_at timestamp with time zone
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'meta_ads_daily_metrics');

DROP FOREIGN TABLE IF EXISTS legacy_src.google_ads_connections;
CREATE FOREIGN TABLE legacy_src.google_ads_connections (
    id uuid,
    workspace_id uuid,
    customer_ids text[],
    selected_customer_ids text[],
    selected_customer_id text,
    currency text,
    status text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'google_ads_connections');

DROP FOREIGN TABLE IF EXISTS legacy_src.google_ads_daily_metrics;
CREATE FOREIGN TABLE legacy_src.google_ads_daily_metrics (
    id uuid,
    connection_id uuid,
    customer_id text,
    campaign_id text,
    campaign_name text,
    ad_group_id text,
    ad_group_name text,
    date date,
    impressions integer,
    clicks integer,
    spend numeric,
    conversions numeric,
    conversion_value numeric,
    ctr numeric,
    average_cpc numeric,
    created_at timestamp with time zone
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'google_ads_daily_metrics');

DROP FOREIGN TABLE IF EXISTS legacy_src.shiprocket_connections;
CREATE FOREIGN TABLE legacy_src.shiprocket_connections (
    id uuid,
    workspace_id uuid,
    status text,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'shiprocket_connections');

DROP FOREIGN TABLE IF EXISTS legacy_src.shiprocket_shipments;
CREATE FOREIGN TABLE legacy_src.shiprocket_shipments (
    id uuid,
    connection_id uuid,
    shipment_id text,
    order_id text,
    status text,
    status_code integer,
    courier_name text,
    awb_code text,
    is_cod boolean,
    cod_amount numeric,
    shipped_at timestamp with time zone,
    delivered_at timestamp with time zone,
    rto_initiated_at timestamp with time zone,
    charges numeric,
    channel_order_id text,
    tracking_status text,
    tracking_status_code integer,
    payment_method text,
    shopify_order_name text,
    delivery_pincode text,
    delivery_city text,
    delivery_state text,
    synced_at timestamp with time zone
) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'shiprocket_shipments');

-- ---------------------------------------------------------------------------
-- 0b) Create connector_shipment_facts locally (missing from brain_dev schema;
--     required by phase8-ch-backfill.sql step 5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connector_shipment_facts (
    id                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
    workspace_id       uuid                     NOT NULL,
    vendor             TEXT         NOT NULL,
    vendor_shipment_id text                     NOT NULL,
    vendor_order_ref   text,
    status             text,
    status_bucket      text,
    is_cod             boolean,
    cod_amount_mu      bigint,
    shipping_charges_mu bigint,
    courier_name       text,
    delivery_pincode   text,
    delivery_city      text,
    shipped_at         timestamp with time zone,
    delivered_at       timestamp with time zone,
    rto_initiated_at   timestamp with time zone,
    synced_at          timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT connector_shipment_facts_pkey PRIMARY KEY (id),
    CONSTRAINT connector_shipment_facts_ws_vendor_ship_key UNIQUE (workspace_id, vendor, vendor_shipment_id),
    CONSTRAINT connector_shipment_facts_workspace_id_fkey
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

ALTER TABLE public.connector_shipment_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ws_isolation ON public.connector_shipment_facts;
CREATE POLICY ws_isolation ON public.connector_shipment_facts
    USING (workspace_id = (NULLIF(current_setting('app.workspace_id', true), ''))::uuid)
    WITH CHECK (workspace_id = (NULLIF(current_setting('app.workspace_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS connector_shipment_facts_ws_idx
    ON public.connector_shipment_facts (workspace_id, shipped_at);

-- ---------------------------------------------------------------------------
-- 0c) STAGE legacy sources into local UNLOGGED tables (THE load pattern).
--     A direct FDW join on the big tables (esp. the 3-way line-items join over
--     ~347k rows) does per-row remote fetches and stalls on a slow link (12min+
--     hang observed). Instead: pull each source table ONCE with a plain batched
--     SELECT, then join LOCALLY below — turns the hang into ~9s end-to-end.
--     fetch_size is bumped on the server so the pulls batch (default 100 crawls);
--     idempotent add-or-set. The stg_ tables are dropped at the end of this file.
--     The fact-load INSERTs below read FROM stg_*; the verification counts at the
--     bottom intentionally still read legacy_src.* (count pushes down — cheap —
--     and verifies loaded-vs-REAL-source, not vs the staged copy).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER SERVER legacy_supa OPTIONS (ADD fetch_size '50000');
EXCEPTION WHEN OTHERS THEN
  BEGIN ALTER SERVER legacy_supa OPTIONS (SET fetch_size '50000'); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

DROP TABLE IF EXISTS stg_shopify_connections;       CREATE UNLOGGED TABLE stg_shopify_connections       AS SELECT * FROM legacy_src.shopify_connections;
DROP TABLE IF EXISTS stg_shopify_orders;            CREATE UNLOGGED TABLE stg_shopify_orders            AS SELECT * FROM legacy_src.shopify_orders;
DROP TABLE IF EXISTS stg_shopify_line_items;        CREATE UNLOGGED TABLE stg_shopify_line_items        AS SELECT * FROM legacy_src.shopify_line_items;
DROP TABLE IF EXISTS stg_shopify_products;          CREATE UNLOGGED TABLE stg_shopify_products          AS SELECT * FROM legacy_src.shopify_products;
DROP TABLE IF EXISTS stg_shopify_refund_line_items; CREATE UNLOGGED TABLE stg_shopify_refund_line_items AS SELECT * FROM legacy_src.shopify_refund_line_items;
DROP TABLE IF EXISTS stg_meta_ads_connections;      CREATE UNLOGGED TABLE stg_meta_ads_connections      AS SELECT * FROM legacy_src.meta_ads_connections;
DROP TABLE IF EXISTS stg_meta_ads_daily_metrics;    CREATE UNLOGGED TABLE stg_meta_ads_daily_metrics    AS SELECT * FROM legacy_src.meta_ads_daily_metrics;
DROP TABLE IF EXISTS stg_google_ads_connections;    CREATE UNLOGGED TABLE stg_google_ads_connections    AS SELECT * FROM legacy_src.google_ads_connections;
DROP TABLE IF EXISTS stg_google_ads_daily_metrics;  CREATE UNLOGGED TABLE stg_google_ads_daily_metrics  AS SELECT * FROM legacy_src.google_ads_daily_metrics;
DROP TABLE IF EXISTS stg_shiprocket_connections;    CREATE UNLOGGED TABLE stg_shiprocket_connections    AS SELECT * FROM legacy_src.shiprocket_connections;
DROP TABLE IF EXISTS stg_shiprocket_shipments;      CREATE UNLOGGED TABLE stg_shiprocket_shipments      AS SELECT * FROM legacy_src.shiprocket_shipments;

-- ---------------------------------------------------------------------------
-- 1) connector_order_facts_hot
-- Legacy source  : shopify_orders JOIN shopify_connections (for workspace_id)
-- Money columns  : total_price, total_tax, total_discount, (shipping not stored
--                  per-order in legacy — default 0)
-- Unit conversion: ROUND(col * 100)::bigint  (rupees → paisa)
-- is_cod         : legacy shopify_orders has no payment_method; derive from
--                  shiprocket (COD flag) or default NULL — phase8 coalesces to 0
-- order_type     : 'shopify' per the realtime consumer convention
-- total_refund_mu: 0 (refunds are loaded separately into connector_refund_facts)
-- billing_pincode: NULL (legacy doesn't store it per order)
-- Unique key     : (workspace_id, vendor, vendor_order_id)
-- ---------------------------------------------------------------------------
INSERT INTO public.connector_order_facts_hot (
    workspace_id,
    vendor,
    vendor_order_id,
    order_number,
    financial_status,
    fulfillment_status,
    payment_method,
    currency_code,
    gross_sales_mu,
    total_discount_mu,
    total_tax_mu,
    shipping_mu,
    customer_ref,
    is_new_customer,
    delivery_pincode,
    delivery_city,
    processed_at,
    cancelled_at,
    synced_at,
    billing_pincode,
    is_cod,
    order_type,
    total_refund_mu
)
SELECT
    c.workspace_id,
    'SHOPIFY'::TEXT                     AS vendor,
    o.shopify_id                                    AS vendor_order_id,
    o.order_number,
    o.financial_status,
    o.fulfillment_status,
    NULL::text                                      AS payment_method,
    COALESCE(o.currency, 'INR')                    AS currency_code,
    ROUND(o.total_price    * 100)::bigint           AS gross_sales_mu,
    ROUND(o.total_discount * 100)::bigint           AS total_discount_mu,
    ROUND(o.total_tax      * 100)::bigint           AS total_tax_mu,
    0::bigint                                       AS shipping_mu,
    o.customer_shopify_id                           AS customer_ref,
    NULL::boolean                                   AS is_new_customer,
    NULL::text                                      AS delivery_pincode,
    NULL::text                                      AS delivery_city,
    o.processed_at,
    o.cancelled_at,
    NOW()                                           AS synced_at,
    NULL::text                                      AS billing_pincode,
    NULL::boolean                                   AS is_cod,
    'shopify'                                       AS order_type,
    0::bigint                                       AS total_refund_mu
FROM stg_shopify_orders o
JOIN stg_shopify_connections c ON c.id = o.connection_id
ON CONFLICT (workspace_id, vendor, vendor_order_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) connector_line_item_facts_hot
-- Legacy source  : shopify_line_items JOIN shopify_orders (via order_id) →
--                  shopify_connections (via connection_id for workspace_id)
-- Money          : price is per-unit in rupees → ROUND(price*100)::bigint
-- gst_slab_bp    : not stored in legacy; NULL
-- vendor_product_id: product_shopify_id
-- Unique key     : (workspace_id, vendor, vendor_order_id, vendor_line_id)
-- ---------------------------------------------------------------------------
INSERT INTO public.connector_line_item_facts_hot (
    workspace_id,
    vendor,
    vendor_order_id,
    vendor_line_id,
    sku,
    title,
    quantity,
    unit_price_mu,
    gst_slab_bp,
    synced_at,
    vendor_product_id
)
SELECT
    c.workspace_id,
    'SHOPIFY'::TEXT                     AS vendor,
    o.shopify_id                                    AS vendor_order_id,
    li.shopify_id                                   AS vendor_line_id,
    li.sku,
    li.title,
    li.quantity::bigint,
    ROUND(li.price * 100)::bigint                   AS unit_price_mu,
    NULL::integer                                   AS gst_slab_bp,
    NOW()                                           AS synced_at,
    li.product_shopify_id                           AS vendor_product_id
FROM stg_shopify_line_items li
JOIN stg_shopify_orders o    ON o.id = li.order_id
JOIN stg_shopify_connections c ON c.id = li.connection_id
ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) connector_product_facts
-- Legacy source  : shopify_products JOIN shopify_connections (for workspace_id)
-- Money          : coq (cost of goods) is in rupees → ROUND(coq*100)::bigint
--                  mrp_mu: no MRP in legacy, NULL
-- tags           : text[] passthrough (empty array default if null)
-- Unique key     : (workspace_id, vendor, vendor_product_id)
-- ---------------------------------------------------------------------------
INSERT INTO public.connector_product_facts (
    workspace_id,
    vendor,
    vendor_product_id,
    title,
    product_type,
    status,
    synced_at,
    cost_mu,
    mrp_mu,
    inventory_qty,
    handle,
    image_url,
    tags
)
SELECT
    c.workspace_id,
    'SHOPIFY'::TEXT                     AS vendor,
    p.shopify_id                                    AS vendor_product_id,
    p.title,
    p.product_type,
    p.status,
    NOW()                                           AS synced_at,
    CASE WHEN p.coq IS NOT NULL
         THEN ROUND(p.coq * 100)::bigint
         ELSE NULL::bigint END                      AS cost_mu,
    NULL::bigint                                    AS mrp_mu,
    p.total_inventory                               AS inventory_qty,
    p.handle,
    p.image_url,
    COALESCE(p.tags, '{}')                          AS tags
FROM stg_shopify_products p
JOIN stg_shopify_connections c ON c.id = p.connection_id
ON CONFLICT (workspace_id, vendor, vendor_product_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) connector_ad_spend_facts — Meta
-- Legacy source  : meta_ads_daily_metrics JOIN meta_ads_connections (workspace_id)
-- Money          : spend is in major units (INR or AED) → ROUND(spend*100)::bigint
-- Unique key     : (workspace_id, vendor, campaign_id, spend_date)
-- ---------------------------------------------------------------------------
INSERT INTO public.connector_ad_spend_facts (
    workspace_id,
    vendor,
    campaign_id,
    campaign_name,
    spend_date,
    spend_mu,
    impressions,
    clicks,
    currency_code,
    synced_at
)
SELECT
    m.workspace_id,
    'META'::TEXT                        AS vendor,
    d.campaign_id,
    d.campaign_name,
    d.date                                          AS spend_date,
    ROUND(d.spend * 100)::bigint                    AS spend_mu,
    COALESCE(d.impressions, 0)::bigint,
    COALESCE(d.clicks, 0)::bigint,
    COALESCE(m.currency, 'INR')                    AS currency_code,
    NOW()                                           AS synced_at
FROM stg_meta_ads_daily_metrics d
JOIN stg_meta_ads_connections m ON m.id = d.connection_id
ON CONFLICT (workspace_id, vendor, campaign_id, spend_date) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4b) connector_ad_spend_facts — Google
-- Legacy source  : google_ads_daily_metrics JOIN google_ads_connections (workspace_id)
-- Money          : spend is in major units → ROUND(spend*100)::bigint
-- campaign_id uniqueness: google campaign_ids can collide across customers,
--   so prefix with customer_id: campaign_id = customer_id||'_'||campaign_id
-- Unique key     : (workspace_id, vendor, campaign_id, spend_date)
-- ---------------------------------------------------------------------------
INSERT INTO public.connector_ad_spend_facts (
    workspace_id,
    vendor,
    campaign_id,
    campaign_name,
    spend_date,
    spend_mu,
    impressions,
    clicks,
    currency_code,
    synced_at
)
SELECT
    g.workspace_id,
    'GOOGLE'::TEXT                      AS vendor,
    d.customer_id || '_' || d.campaign_id           AS campaign_id,
    d.campaign_name,
    d.date                                          AS spend_date,
    ROUND(d.spend * 100)::bigint                    AS spend_mu,
    COALESCE(d.impressions, 0)::bigint,
    COALESCE(d.clicks, 0)::bigint,
    COALESCE(g.currency, 'INR')                    AS currency_code,
    NOW()                                           AS synced_at
FROM stg_google_ads_daily_metrics d
JOIN stg_google_ads_connections g ON g.id = d.connection_id
ON CONFLICT (workspace_id, vendor, campaign_id, spend_date) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5) connector_shipment_facts (created in step 0b above)
-- Legacy source  : shiprocket_shipments JOIN shiprocket_connections (workspace_id)
-- Money          : cod_amount, charges in major units → ×100
-- status_bucket  : derived from tracking_status_code:
--                    40 = DELIVERED, 9 = RTO, 6/99 = SHIPPED, else IN_TRANSIT
-- Unique key     : (workspace_id, vendor, vendor_shipment_id)
-- ---------------------------------------------------------------------------
INSERT INTO public.connector_shipment_facts (
    workspace_id,
    vendor,
    vendor_shipment_id,
    vendor_order_ref,
    status,
    status_bucket,
    is_cod,
    cod_amount_mu,
    shipping_charges_mu,
    courier_name,
    delivery_pincode,
    delivery_city,
    shipped_at,
    delivered_at,
    rto_initiated_at,
    synced_at
)
SELECT
    sc.workspace_id,
    'SHIPROCKET'::TEXT                  AS vendor,
    s.shipment_id                                   AS vendor_shipment_id,
    s.channel_order_id                              AS vendor_order_ref,
    COALESCE(s.tracking_status, s.status)           AS status,
    CASE
        WHEN s.tracking_status_code = 40  THEN 'DELIVERED'
        WHEN s.tracking_status_code = 9   THEN 'RTO'
        WHEN s.tracking_status_code IN (6, 99) THEN 'SHIPPED'
        WHEN s.rto_initiated_at IS NOT NULL THEN 'RTO'
        WHEN s.delivered_at IS NOT NULL     THEN 'DELIVERED'
        WHEN s.shipped_at IS NOT NULL       THEN 'SHIPPED'
        ELSE 'IN_TRANSIT'
    END                                             AS status_bucket,
    s.is_cod,
    CASE WHEN s.cod_amount IS NOT NULL
         THEN ROUND(s.cod_amount * 100)::bigint
         ELSE NULL::bigint END                      AS cod_amount_mu,
    CASE WHEN s.charges IS NOT NULL
         THEN ROUND(s.charges * 100)::bigint
         ELSE NULL::bigint END                      AS shipping_charges_mu,
    s.courier_name,
    s.delivery_pincode,
    s.delivery_city,
    s.shipped_at,
    s.delivered_at,
    s.rto_initiated_at,
    COALESCE(s.synced_at, NOW())                   AS synced_at
FROM stg_shiprocket_shipments s
JOIN stg_shiprocket_connections sc ON sc.id = s.connection_id
ON CONFLICT (workspace_id, vendor, vendor_shipment_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6) connector_refund_facts
-- Legacy source  : shopify_refund_line_items JOIN shopify_orders (shopify_order_id
--                  maps to shopify_orders.shopify_id) →  shopify_connections
-- Money          : subtotal_amount, total_tax_amount in rupees → ×100
--                  vendor_product_id: product_shopify_id from refund line
-- Unique key     : (workspace_id, vendor, vendor_refund_line_id)
-- ---------------------------------------------------------------------------
INSERT INTO public.connector_refund_facts (
    workspace_id,
    vendor,
    vendor_order_id,
    vendor_refund_id,
    vendor_refund_line_id,
    sku,
    quantity,
    subtotal_mu,
    tax_mu,
    processed_at,
    synced_at,
    vendor_product_id
)
SELECT
    c.workspace_id,
    'SHOPIFY'::TEXT                     AS vendor,
    r.shopify_order_id                              AS vendor_order_id,
    r.shopify_refund_id                             AS vendor_refund_id,
    r.shopify_refund_line_id                        AS vendor_refund_line_id,
    r.sku,
    r.quantity::bigint,
    ROUND(r.subtotal_amount  * 100)::bigint         AS subtotal_mu,
    ROUND(r.total_tax_amount * 100)::bigint         AS tax_mu,
    r.processed_at,
    NOW()                                           AS synced_at,
    r.product_shopify_id                            AS vendor_product_id
FROM stg_shopify_refund_line_items r
JOIN stg_shopify_connections c ON c.id = r.connection_id
ON CONFLICT (workspace_id, vendor, vendor_refund_line_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- VALIDATION — compare local vs legacy counts and sample money values
-- ---------------------------------------------------------------------------
SELECT '=== VALIDATION: local vs legacy row counts ===' AS section;

SELECT
    'connector_order_facts_hot'     AS target_table,
    (SELECT count(*) FROM public.connector_order_facts_hot)          AS local_count,
    (SELECT count(*) FROM legacy_src.shopify_orders)                 AS legacy_count;

SELECT
    'connector_line_item_facts_hot' AS target_table,
    (SELECT count(*) FROM public.connector_line_item_facts_hot)      AS local_count,
    (SELECT count(*) FROM legacy_src.shopify_line_items)             AS legacy_count;

SELECT
    'connector_product_facts'       AS target_table,
    (SELECT count(*) FROM public.connector_product_facts)            AS local_count,
    (SELECT count(*) FROM legacy_src.shopify_products)               AS legacy_count;

SELECT
    'connector_ad_spend_facts (META)' AS target_table,
    (SELECT count(*) FROM public.connector_ad_spend_facts WHERE vendor = 'META') AS local_count,
    (SELECT count(*) FROM legacy_src.meta_ads_daily_metrics)                     AS legacy_count;

SELECT
    'connector_ad_spend_facts (GOOGLE)' AS target_table,
    (SELECT count(*) FROM public.connector_ad_spend_facts WHERE vendor = 'GOOGLE') AS local_count,
    (SELECT count(*) FROM legacy_src.google_ads_daily_metrics)                      AS legacy_count;

SELECT
    'connector_shipment_facts'      AS target_table,
    (SELECT count(*) FROM public.connector_shipment_facts)           AS local_count,
    (SELECT count(*) FROM legacy_src.shiprocket_shipments)           AS legacy_count;

SELECT
    'connector_refund_facts'        AS target_table,
    (SELECT count(*) FROM public.connector_refund_facts)             AS local_count,
    (SELECT count(*) FROM legacy_src.shopify_refund_line_items)      AS legacy_count;

SELECT '=== VALIDATION: 3-sample money comparison (Sugandhlok orders) ===' AS section;

-- Compare gross_sales_mu local vs legacy total_price×100
SELECT
    local.vendor_order_id,
    local.gross_sales_mu                            AS local_gross_mu,
    ROUND(leg.total_price * 100)::bigint            AS legacy_gross_mu_expected,
    local.gross_sales_mu = ROUND(leg.total_price * 100)::bigint AS match
FROM public.connector_order_facts_hot local
JOIN legacy_src.shopify_orders leg
    ON leg.shopify_id = local.vendor_order_id
WHERE local.workspace_id = 'f165da80-e6d5-4c58-9aff-ec654b873bd7'
ORDER BY local.processed_at DESC
LIMIT 3;

SELECT '=== Sugandhlok order count ===' AS section;
SELECT count(*) AS sugandhlok_order_count
FROM public.connector_order_facts_hot
WHERE workspace_id = 'f165da80-e6d5-4c58-9aff-ec654b873bd7';

-- ---------------------------------------------------------------------------
-- 0c-cleanup) Drop the local staging tables — the facts are loaded; the stg_
--             copies (incl. ~347k line-items) are no longer needed. A re-run
--             re-stages them (DROP IF EXISTS + CREATE above), so this is safe.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS
    stg_shopify_connections, stg_shopify_orders, stg_shopify_line_items,
    stg_shopify_products, stg_shopify_refund_line_items,
    stg_meta_ads_connections, stg_meta_ads_daily_metrics,
    stg_google_ads_connections, stg_google_ads_daily_metrics,
    stg_shiprocket_connections, stg_shiprocket_shipments;

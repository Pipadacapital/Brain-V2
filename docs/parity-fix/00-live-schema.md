# Live DB schema snapshot (brain_dev PG + brain CH) — 2026-06-02T04:51Z
Generated for the parity read-path audit. Source of truth for what columns/tables EXIST.

## PostgreSQL (brain_dev) — connector_* + analytics tables
```
connector_ad_spend_facts (id uuid, workspace_id uuid, vendor USER-DEFINED, campaign_id text, campaign_name text, spend_date date, spend_mu bigint, impressions bigint, clicks bigint, currency_code text, synced_at timestamp with time zone)
connector_connections (id uuid, workspace_id uuid, vendor USER-DEFINED, status USER-DEFINED, scopes ARRAY, account_ref text, external_metadata jsonb, token_expires_at timestamp with time zone, connected_at timestamp with time zone, last_sync_at timestamp with time zone, last_sync_error text, created_at timestamp with time zone, updated_at timestamp with time zone)
connector_credentials (workspace_id uuid, vendor USER-DEFINED, credential_enc bytea, updated_at timestamp with time zone)
connector_definitions (vendor USER-DEFINED, display_name text, category text, capabilities jsonb, oauth_config jsonb, api_config jsonb, polling_cadence_min integer, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
connector_line_item_facts (id uuid, workspace_id uuid, vendor USER-DEFINED, vendor_order_id text, vendor_line_id text, sku text, title text, quantity bigint, unit_price_mu bigint, gst_slab_bp integer, synced_at timestamp with time zone)
connector_line_item_facts_hot (id uuid, workspace_id uuid, vendor USER-DEFINED, vendor_order_id text, vendor_line_id text, sku text, title text, quantity bigint, unit_price_mu bigint, gst_slab_bp integer, synced_at timestamp with time zone)
connector_oauth_states (state_hash text, workspace_id uuid, vendor USER-DEFINED, user_id uuid, shop_domain text, expires_at timestamp with time zone, created_at timestamp with time zone)
connector_order_facts (id uuid, workspace_id uuid, vendor USER-DEFINED, vendor_order_id text, order_number text, financial_status text, fulfillment_status text, payment_method text, currency_code text, gross_sales_mu bigint, total_discount_mu bigint, total_tax_mu bigint, shipping_mu bigint, customer_ref text, is_new_customer boolean, delivery_pincode text, delivery_city text, processed_at timestamp with time zone, cancelled_at timestamp with time zone, synced_at timestamp with time zone, billing_pincode text, is_cod boolean, order_type text, total_refund_mu bigint)
connector_order_facts_hot (id uuid, workspace_id uuid, vendor USER-DEFINED, vendor_order_id text, order_number text, financial_status text, fulfillment_status text, payment_method text, currency_code text, gross_sales_mu bigint, total_discount_mu bigint, total_tax_mu bigint, shipping_mu bigint, customer_ref text, is_new_customer boolean, delivery_pincode text, delivery_city text, processed_at timestamp with time zone, cancelled_at timestamp with time zone, synced_at timestamp with time zone, billing_pincode text, is_cod boolean, order_type text, total_refund_mu bigint)
connector_product_facts (id uuid, workspace_id uuid, vendor USER-DEFINED, vendor_product_id text, title text, product_type text, status text, synced_at timestamp with time zone, cost_mu bigint, mrp_mu bigint, inventory_qty integer, handle text, image_url text, tags ARRAY)
connector_refund_facts (id uuid, workspace_id uuid, vendor USER-DEFINED, vendor_order_id text, vendor_refund_id text, vendor_refund_line_id text, sku text, quantity bigint, subtotal_mu bigint, tax_mu bigint, processed_at timestamp with time zone, synced_at timestamp with time zone, vendor_product_id text)
workspace_ad_campaign_classifications (id uuid, workspace_id uuid, platform text, campaign_id text, intent text, campaign_name text, created_at timestamp with time zone, updated_at timestamp with time zone)
workspace_cogs_settings (workspace_id uuid, override_all_cogs_bp integer, fallback_cogs_bp integer, cogs_markup_bp integer, updated_at timestamp with time zone)
workspace_costs (id uuid, workspace_id uuid, cost_type USER-DEFINED, name text, amount_mu bigint, is_percent boolean, currency_code text, billing_mode USER-DEFINED, effective_from date, effective_to date, created_at timestamp with time zone)
workspace_festivals (id uuid, workspace_id uuid, name text, start_date date, end_date date, color text, expected_multiplier_bp integer, regions ARRAY, categories ARRAY, is_template boolean, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
workspace_members (id uuid, workspace_id uuid, user_id uuid, role USER-DEFINED, joined_at timestamp with time zone, updated_at timestamp with time zone)
workspace_metric_goals (id uuid, workspace_id uuid, metric_name text, period_type USER-DEFINED, period_start date, goal_value bigint, goal_unit USER-DEFINED, goal_type USER-DEFINED, created_at timestamp with time zone, updated_at timestamp with time zone)
workspace_misc_expenses (id uuid, workspace_id uuid, name text, amount_mu bigint, currency_code text, effective_start_date date, created_at timestamp with time zone, updated_at timestamp with time zone)
workspaces (id uuid, name text, slug text, industry text, monthly_revenue text, store_url text, platform USER-DEFINED, created_by_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, features jsonb, logo_url text, plan USER-DEFINED, tax_percent_bp integer, timezone text, founder_salary_currency text, founder_salary_monthly_mu bigint, skip_zero_sales_orders boolean, skipped_shopify_order_tags ARRAY, product_data_source text)
```

## PostgreSQL row counts (loaded tables)
```
connector_product_facts=981
connector_refund_facts=1373
connector_ad_spend_facts=16937
connector_order_facts_hot=85447
connector_order_facts(non-hot)=85447
connector_line_item_facts(non-hot)=350352
connector_line_item_facts_hot=350352
```

## ClickHouse (brain) — table schemas
```
--- brain.connector_order_facts ---
CREATE TABLE brain.connector_order_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `vendor_order_id` String,
    `order_date` Date,
    `placed_at` DateTime64(3, \'UTC\'),
    `customer_ref` String,
    `delivery_pincode` LowCardinality(String),
    `delivery_city` LowCardinality(String),
    `gross_sales_mu` Int64 DEFAULT 0,
    `discount_mu` Int64 DEFAULT 0,
    `tax_mu` Int64 DEFAULT 0,
    `shipping_mu` Int64 DEFAULT 0,
    `net_sales_mu` Int64 DEFAULT 0,
    `total_refund_mu` Int64 DEFAULT 0,
    `currency_code` LowCardinality(String),
    `payment_method` LowCardinality(String),
    `is_cod` UInt8,
    `order_type` LowCardinality(String),
    `financial_status` LowCardinality(String),
    `fulfillment_status` LowCardinality(String),
    `cancelled_at` Nullable(DateTime),
    `tags` Array(String) DEFAULT [],
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_order_id)
SETTINGS index_granularity = 8192

--- brain.connector_line_item_facts ---
CREATE TABLE brain.connector_line_item_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `vendor_order_id` String,
    `vendor_line_id` String,
    `vendor_product_id` String,
    `vendor_variant_id` String,
    `sku` String,
    `title` String,
    `quantity` Int32 DEFAULT 0,
    `price_mu` Int64 DEFAULT 0,
    `line_total_mu` Int64 DEFAULT 0,
    `discount_mu` Int64 DEFAULT 0,
    `tax_mu` Int64 DEFAULT 0,
    `cogs_mu` Int64 DEFAULT 0,
    `currency_code` LowCardinality(String),
    `order_date` Date,
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_order_id, vendor_line_id)
SETTINGS index_granularity = 8192

--- brain.connector_ad_spend_facts ---
CREATE TABLE brain.connector_ad_spend_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `ad_account_id` String,
    `campaign_id` String,
    `campaign_name` String,
    `date` Date,
    `impressions` Int64 DEFAULT 0,
    `clicks` Int64 DEFAULT 0,
    `spend_mu` Int64 DEFAULT 0,
    `conversions` Int32 DEFAULT 0,
    `revenue_mu` Int64 DEFAULT 0,
    `currency_code` LowCardinality(String),
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, ad_account_id, campaign_id, date)
SETTINGS index_granularity = 8192

--- brain.connector_product_facts ---
CREATE TABLE brain.connector_product_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `vendor_product_id` String,
    `sku` String,
    `title` String,
    `handle` String,
    `image_url` String,
    `cost_mu` Int64 DEFAULT 0,
    `mrp_mu` Int64 DEFAULT 0,
    `inventory_qty` Int32,
    `tags` Array(String) DEFAULT [],
    `currency_code` LowCardinality(String),
    `synced_date` Date DEFAULT today(),
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(synced_date)
ORDER BY (workspace_id, vendor, vendor_product_id)
SETTINGS index_granularity = 8192

--- brain.connector_shipment_facts ---
CREATE TABLE brain.connector_shipment_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `vendor_shipment_id` String,
    `vendor_order_id` String,
    `status` LowCardinality(String),
    `courier_name` LowCardinality(String),
    `delivery_pincode` LowCardinality(String),
    `is_rto` UInt8,
    `shipped_at` Nullable(DateTime),
    `delivered_at` Nullable(DateTime),
    `rto_at` Nullable(DateTime),
    `date` Date,
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, vendor_shipment_id)
SETTINGS index_granularity = 8192

--- brain.connector_refund_facts ---
CREATE TABLE brain.connector_refund_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `vendor_refund_id` String,
    `vendor_refund_line_id` String,
    `vendor_order_id` String,
    `vendor_product_id` String,
    `sku` String,
    `quantity` Int32 DEFAULT 0,
    `refund_amount_mu` Int64 DEFAULT 0,
    `tax_mu` Int64 DEFAULT 0,
    `currency_code` LowCardinality(String),
    `date` Date,
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, vendor_refund_id, vendor_refund_line_id)
SETTINGS index_granularity = 8192

```
## ClickHouse other tables present
```
connector_ad_creative_facts
connector_ad_funnel_facts
connector_ad_spend_facts
connector_email_send_facts
connector_line_item_facts
connector_logistics_order_facts
connector_order_facts
connector_product_facts
connector_raw_events
connector_refund_facts
connector_shipment_facts
connector_variant_facts
product_daily_aggregates
shopify_analytics_daily
workspace_daily_metrics_base
workspace_daily_metrics_computed
workspace_daily_metrics_legacy
```

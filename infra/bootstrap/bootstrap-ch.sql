-- =============================================================================
-- Brain — ClickHouse bootstrap schema (SINGLE SOURCE OF TRUTH).
--
-- Creates the `brain` OLAP database + all silver/bronze/aggregate fact tables
-- and the workspace_daily_metrics materialized view. Idempotent (IF NOT EXISTS).
-- Apply with:  clickhouse-client -n  (multiquery).
--
-- Derived from the verified-healthy `brain` database (SHOW CREATE TABLE).
-- Replaces the retired apps/analytics-service/migrations/clickhouse pipeline.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS brain;


-- ===== connector_ad_creative_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_ad_creative_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `ad_account_id` String,
    `ad_id` String,
    `ad_name` String,
    `campaign_id` String,
    `adset_id` String,
    `date` Date,
    `impressions` Int64 DEFAULT 0,
    `clicks` Int64 DEFAULT 0,
    `spend_mu` Int64 DEFAULT 0,
    `video_thruplay` Int32 DEFAULT 0,
    `avg_watch_sec_x100` Int32 DEFAULT 0,
    `video_p25` Int32 DEFAULT 0,
    `video_p50` Int32 DEFAULT 0,
    `video_p75` Int32 DEFAULT 0,
    `video_p95` Int32 DEFAULT 0,
    `conversions` Int32 DEFAULT 0,
    `revenue_mu` Int64 DEFAULT 0,
    `currency_code` LowCardinality(String),
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, ad_account_id, ad_id, date)
SETTINGS index_granularity = 8192;

-- ===== connector_ad_funnel_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_ad_funnel_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `customer_id` String,
    `campaign_id` String,
    `date` Date,
    `stage` LowCardinality(String),
    `conversions_x1000` Int64 DEFAULT 0,
    `conversion_value_mu` Int64 DEFAULT 0,
    `currency_code` LowCardinality(String),
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, customer_id, campaign_id, date, stage)
SETTINGS index_granularity = 8192;

-- ===== connector_ad_spend_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_ad_spend_facts
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
    `ingested_at` DateTime DEFAULT now(),
    `raw_event_id` String DEFAULT '',
    `provenance` LowCardinality(String) DEFAULT 'legacy_etl'
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, ad_account_id, campaign_id, date)
SETTINGS index_granularity = 8192;

-- ===== connector_email_send_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_email_send_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `source_type` LowCardinality(String),
    `vendor_resource_id` String,
    `name` String,
    `channel` LowCardinality(String),
    `send_date` Date,
    `delivered` Int32 DEFAULT 0,
    `unique_opens` Int32 DEFAULT 0,
    `unique_clicks` Int32 DEFAULT 0,
    `orders` Int32 DEFAULT 0,
    `revenue_mu` Int64 DEFAULT 0,
    `currency_code` LowCardinality(String),
    `unsubscribes` Int32 DEFAULT 0,
    `spam_complaints` Int32 DEFAULT 0,
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(send_date)
ORDER BY (workspace_id, vendor, source_type, vendor_resource_id, send_date)
SETTINGS index_granularity = 8192;

-- ===== connector_line_item_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_line_item_facts
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
    `ingested_at` DateTime DEFAULT now(),
    `raw_event_id` String DEFAULT '',
    `provenance` LowCardinality(String) DEFAULT 'legacy_etl'
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_order_id, vendor_line_id)
SETTINGS index_granularity = 8192;

-- ===== connector_logistics_order_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_logistics_order_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `vendor_logistics_order_id` String,
    `channel_order_id` String,
    `channel_name` LowCardinality(String),
    `status` LowCardinality(String),
    `payment_method` LowCardinality(String),
    `total_mu` Int64 DEFAULT 0,
    `currency_code` LowCardinality(String),
    `order_date` Date,
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_logistics_order_id)
SETTINGS index_granularity = 8192;

-- ===== connector_order_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_order_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `vendor_order_id` String,
    `order_date` Date,
    `placed_at` DateTime64(3, 'UTC'),
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
    `ingested_at` DateTime DEFAULT now(),
    `raw_event_id` String DEFAULT '',
    `provenance` LowCardinality(String) DEFAULT 'legacy_etl',
    INDEX idx_raw_event_id raw_event_id TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_order_id)
SETTINGS index_granularity = 8192;

-- ===== connector_product_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_product_facts
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
SETTINGS index_granularity = 8192;

-- ===== connector_raw_events =====
CREATE TABLE IF NOT EXISTS brain.connector_raw_events
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `event_type` LowCardinality(String),
    `idempotency_key` String,
    `received_at` DateTime64(3, 'UTC'),
    `event_at` Nullable(DateTime64(3, 'UTC')),
    `payload` String,
    `payload_version` LowCardinality(String) DEFAULT '',
    `ingested_at` DateTime DEFAULT now(),
    `customer_ref` String DEFAULT '',
    `lawful_basis` LowCardinality(String) DEFAULT '',
    `purpose_code` LowCardinality(String) DEFAULT '',
    INDEX idx_event_at event_at TYPE minmax GRANULARITY 4,
    INDEX idx_customer_ref customer_ref TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(received_at)
ORDER BY (workspace_id, vendor, event_type, idempotency_key, received_at)
SETTINGS index_granularity = 8192;

-- ===== connector_refund_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_refund_facts
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
SETTINGS index_granularity = 8192;

-- ===== connector_shipment_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_shipment_facts
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
    `ingested_at` DateTime DEFAULT now(),
    `is_cod` UInt8 DEFAULT 0,
    `payment_method` LowCardinality(String) DEFAULT '',
    `delivery_city` LowCardinality(String) DEFAULT '',
    `delivery_state` LowCardinality(String) DEFAULT ''
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, vendor_shipment_id)
SETTINGS index_granularity = 8192;

-- ===== connector_variant_facts =====
CREATE TABLE IF NOT EXISTS brain.connector_variant_facts
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `vendor_variant_id` String,
    `vendor_product_id` String,
    `sku` String,
    `title` String,
    `price_mu` Int64 DEFAULT 0,
    `compare_at_price_mu` Int64 DEFAULT 0,
    `inventory_qty` Int32,
    `synced_date` Date DEFAULT today(),
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(synced_date)
ORDER BY (workspace_id, vendor, vendor_variant_id)
SETTINGS index_granularity = 8192;

-- ===== product_daily_aggregates =====
CREATE TABLE IF NOT EXISTS brain.product_daily_aggregates
(
    `workspace_id` String,
    `vendor` LowCardinality(String),
    `vendor_product_id` String,
    `date` Date,
    `quantity_sold` Int32,
    `gross_sales_mu` Int64,
    `orders_count` Int32,
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, vendor_product_id, date)
SETTINGS index_granularity = 8192;

-- ===== shopify_analytics_daily =====
CREATE TABLE IF NOT EXISTS brain.shopify_analytics_daily
(
    `workspace_id` String,
    `shop_domain` LowCardinality(String),
    `date` Date,
    `net_sales_mu` Int64,
    `gross_sales_mu` Int64,
    `orders_count` Int32,
    `aov_mu` Int64,
    `total_tax_mu` Int64,
    `total_discount_mu` Int64,
    `currency_code` LowCardinality(String),
    `conversion_rate_bp` Nullable(Int32),
    `sessions` Nullable(Int32),
    `returns_mu` Nullable(Int64),
    `total_returns_mu` Nullable(Int64),
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, shop_domain, date)
SETTINGS index_granularity = 8192;

-- ===== silver_freshness_log =====
CREATE TABLE IF NOT EXISTS brain.silver_freshness_log
(
    `workspace_id` String,
    `date` Date,
    `rows_written` UInt64 DEFAULT 0,
    `source` LowCardinality(String) DEFAULT 'transform_worker',
    `refreshed_at` DateTime64(3) DEFAULT now64()
)
ENGINE = ReplacingMergeTree(refreshed_at)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, date)
SETTINGS index_granularity = 8192;

-- ===== workspace_daily_metrics_base =====
CREATE TABLE IF NOT EXISTS brain.workspace_daily_metrics_base
(
    `workspace_id` String,
    `date` Date,
    `gross_sales_mu` Int64 DEFAULT 0,
    `returns_mu` Int64 DEFAULT 0,
    `discounts_mu` Int64 DEFAULT 0,
    `net_sales_mu` Int64 DEFAULT 0,
    `total_tax_mu` Int64 DEFAULT 0,
    `net_net_tax_mu` Int64 DEFAULT 0,
    `shipping_revenue_mu` Int64 DEFAULT 0,
    `net_revenue_mu` Int64 DEFAULT 0,
    `cogs_mu` Int64 DEFAULT 0,
    `total_ad_spend_mu` Int64 DEFAULT 0,
    `meta_ad_spend_mu` Int64 DEFAULT 0,
    `google_ad_spend_mu` Int64 DEFAULT 0,
    `misc_expenses_monthly_mu` Int64 DEFAULT 0,
    `cm1_mu` Int64 DEFAULT 0,
    `cm2_mu` Int64 DEFAULT 0,
    `cm3_mu` Int64 DEFAULT 0,
    `total_orders` Int64 DEFAULT 0,
    `cod_orders` Int64 DEFAULT 0,
    `prepaid_orders` Int64 DEFAULT 0,
    `rto_orders` Int64 DEFAULT 0,
    `total_shipments` Int64 DEFAULT 0,
    `total_sessions` Int64 DEFAULT 0,
    `meta_impressions` Int64 DEFAULT 0,
    `meta_clicks` Int64 DEFAULT 0,
    `google_impressions` Int64 DEFAULT 0,
    `google_clicks` Int64 DEFAULT 0,
    `fx_rate_inr_x100` Int64 DEFAULT 8350,
    `inserted_at` DateTime DEFAULT now(),
    `source` String DEFAULT 'brain-analytics-service'
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, date)
SETTINGS index_granularity = 8192;

-- ===== workspace_daily_metrics_computed =====
CREATE TABLE IF NOT EXISTS brain.workspace_daily_metrics_computed
(
    `workspace_id` String,
    `date` Date,
    `gross_sales_mu` Int64,
    `returns_mu` Int64,
    `discounts_mu` Int64,
    `net_sales_mu` Int64,
    `total_tax_mu` Int64,
    `net_net_tax_mu` Int64,
    `shipping_revenue_mu` Int64,
    `net_revenue_mu` Int64,
    `cogs_mu` Int64,
    `total_ad_spend_mu` Int64,
    `meta_ad_spend_mu` Int64,
    `google_ad_spend_mu` Int64,
    `cm1_mu` Int64,
    `cm2_mu` Int64,
    `misc_expenses_prorated_mu` Nullable(Int64),
    `cm3_mu` Int64,
    `total_orders` Int64,
    `rto_rate_bp` Nullable(Int32),
    `prepaid_rate_bp` Nullable(Int32),
    `conversion_rate_bp` Nullable(Int32),
    `aov_mu` Nullable(Int64),
    `acos_bp` Nullable(Int32),
    `blended_roas_x100` Nullable(Int32),
    `meta_ctr_bp` Nullable(Int32),
    `meta_cpc_mu` Nullable(Int64),
    `meta_cpm_mu` Nullable(Int64),
    `google_ctr_bp` Nullable(Int32),
    `google_avg_cpc_mu` Nullable(Int64),
    `computed_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(computed_at)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, date)
SETTINGS index_granularity = 8192;

-- ===== workspace_daily_metrics_legacy =====
CREATE TABLE IF NOT EXISTS brain.workspace_daily_metrics_legacy
(
    `workspace_id` String,
    `date` Date,
    `net_sales_mu` Int64,
    `gross_sales_mu` Int64,
    `total_tax_mu` Int64,
    `total_discount_mu` Int64,
    `orders_count` Int32,
    `aov_mu` Int64,
    `currency_code` LowCardinality(String),
    `cogs_mu` Int64,
    `shipping_mu` Int64,
    `packaging_mu` Int64,
    `website_charges_mu` Int64,
    `cm1_mu` Int64,
    `meta_ad_spend_mu` Int64,
    `google_ad_spend_mu` Int64,
    `total_ad_spend_mu` Int64,
    `cm2_mu` Int64,
    `misc_expenses_prorated_mu` Int64,
    `cm3_mu` Int64,
    `acos_bp` Nullable(Int32),
    `blended_roas_x100` Nullable(Int32),
    `sessions` Nullable(Int32),
    `conversion_rate_bp` Nullable(Int32),
    `rto_orders` Nullable(Int32),
    `rto_value_mu` Nullable(Int64),
    `rto_percent_bp` Nullable(Int32),
    `rto_mapped` Nullable(Int32),
    `rto_unmapped` Nullable(Int32),
    `total_shipments` Nullable(Int32),
    `prepaid_orders_count` Nullable(Int32),
    `prepaid_percentage_bp` Nullable(Int32),
    `version` UInt64,
    `ingested_at` DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, date)
SETTINGS index_granularity = 8192;

-- ===== workspace_daily_metrics_mv =====
CREATE MATERIALIZED VIEW IF NOT EXISTS brain.workspace_daily_metrics_mv TO brain.workspace_daily_metrics_computed
(
    `workspace_id` String,
    `date` Date,
    `gross_sales_mu` Int64,
    `returns_mu` Int64,
    `discounts_mu` Int64,
    `net_sales_mu` Int64,
    `total_tax_mu` Int64,
    `net_net_tax_mu` Int64,
    `shipping_revenue_mu` Int64,
    `net_revenue_mu` Int64,
    `cogs_mu` Int64,
    `total_ad_spend_mu` Int64,
    `meta_ad_spend_mu` Int64,
    `google_ad_spend_mu` Int64,
    `cm1_mu` Int64,
    `cm2_mu` Int64,
    `total_orders` Int64,
    `misc_expenses_prorated_mu` Nullable(Int64),
    `cm3_mu` Int64,
    `rto_rate_bp` Nullable(Int64),
    `prepaid_rate_bp` Nullable(Int64),
    `conversion_rate_bp` Nullable(Int64),
    `aov_mu` Nullable(Int64),
    `acos_bp` Nullable(Int64),
    `blended_roas_x100` Nullable(Int64),
    `meta_ctr_bp` Nullable(Int64),
    `meta_cpc_mu` Nullable(Int64),
    `meta_cpm_mu` Nullable(Int64),
    `google_ctr_bp` Nullable(Int64),
    `google_avg_cpc_mu` Nullable(Int64)
)
AS SELECT
    workspace_id,
    date,
    gross_sales_mu,
    returns_mu,
    discounts_mu,
    net_sales_mu,
    total_tax_mu,
    net_net_tax_mu,
    shipping_revenue_mu,
    net_revenue_mu,
    cogs_mu,
    total_ad_spend_mu,
    meta_ad_spend_mu,
    google_ad_spend_mu,
    cm1_mu,
    cm2_mu,
    total_orders,
    if(dateDiff('day', toStartOfMonth(date), addMonths(toStartOfMonth(date), 1)) > 0, intDiv(misc_expenses_monthly_mu, dateDiff('day', toStartOfMonth(date), addMonths(toStartOfMonth(date), 1))), NULL) AS misc_expenses_prorated_mu,
    cm2_mu - if(dateDiff('day', toStartOfMonth(date), addMonths(toStartOfMonth(date), 1)) > 0, intDiv(misc_expenses_monthly_mu, dateDiff('day', toStartOfMonth(date), addMonths(toStartOfMonth(date), 1))), 0) AS cm3_mu,
    if(total_shipments > 0, intDiv(rto_orders * 10000, total_shipments), NULL) AS rto_rate_bp,
    if(total_orders > 0, intDiv(prepaid_orders * 10000, total_orders), NULL) AS prepaid_rate_bp,
    if(total_sessions > 0, intDiv(total_orders * 10000, total_sessions), NULL) AS conversion_rate_bp,
    if(total_orders > 0, intDiv(net_sales_mu, total_orders), NULL) AS aov_mu,
    if(net_sales_mu > 0, intDiv(total_ad_spend_mu * 10000, net_sales_mu), NULL) AS acos_bp,
    if(total_ad_spend_mu > 0, intDiv(net_sales_mu * 100, total_ad_spend_mu), NULL) AS blended_roas_x100,
    if(meta_impressions > 0, intDiv(meta_clicks * 10000, meta_impressions), NULL) AS meta_ctr_bp,
    if(meta_clicks > 0, intDiv(meta_ad_spend_mu, meta_clicks), NULL) AS meta_cpc_mu,
    if(meta_impressions > 0, intDiv(meta_ad_spend_mu * 1000, meta_impressions), NULL) AS meta_cpm_mu,
    if(google_impressions > 0, intDiv(google_clicks * 10000, google_impressions), NULL) AS google_ctr_bp,
    if(google_clicks > 0, intDiv(google_ad_spend_mu, google_clicks), NULL) AS google_avg_cpc_mu
FROM brain.workspace_daily_metrics_base;

-- =============================================================================
-- Phase 8 — backfill slice-E PG facts into ClickHouse via postgresql() table function.
-- Plan: docs/data-architecture-plan-v2.md §5 (Slice-E backfill option (a)).
--
-- Apply via:  docker exec brain-clickhouse-dev clickhouse-client \
--               --user brain_app --password brain_app_pw --database brain \
--               --multiquery --queries-file /dev/stdin < tools/migrate-legacy/phase8-ch-backfill.sql
--
-- Idempotent: ReplacingMergeTree(version) collapses re-ingests on the unique key.
-- Money: BIGINT minor units → Int64 (passthrough). Network: CH→PG via host.docker.internal:5432.
-- =============================================================================

-- 1) connector_product_facts (957)
INSERT INTO brain.connector_product_facts
  (workspace_id, vendor, vendor_product_id, sku, title, handle, image_url,
   cost_mu, mrp_mu, inventory_qty, tags, currency_code, synced_date, version, ingested_at)
SELECT
  toString(workspace_id), toString(vendor), vendor_product_id,
  '' AS sku, coalesce(title, ''), coalesce(handle, ''), coalesce(image_url, ''),
  coalesce(cost_mu, 0), coalesce(mrp_mu, 0), inventory_qty,
  coalesce(tags, []), 'INR',
  toDate(synced_at), toUInt64(toUnixTimestamp(synced_at)), now()
FROM postgresql('host.docker.internal:5432','brain_dev','connector_product_facts','postgres','postgres');

-- 2) connector_order_facts (83K)
INSERT INTO brain.connector_order_facts
  (workspace_id, vendor, vendor_order_id, order_date, placed_at, customer_ref,
   delivery_pincode, delivery_city, gross_sales_mu, discount_mu, tax_mu, shipping_mu,
   net_sales_mu, total_refund_mu, currency_code, payment_method, is_cod, order_type,
   financial_status, fulfillment_status, tags, version, ingested_at)
SELECT
  toString(workspace_id), toString(vendor), vendor_order_id,
  toDate(processed_at), toDateTime64(processed_at, 3, 'UTC'),
  coalesce(customer_ref, ''),
  coalesce(delivery_pincode, ''), coalesce(delivery_city, ''),
  gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
  gross_sales_mu - total_discount_mu - total_tax_mu,
  coalesce(total_refund_mu, 0),
  currency_code, coalesce(payment_method, ''),
  coalesce(toUInt8(is_cod), 0), coalesce(order_type, ''),
  coalesce(financial_status, ''), coalesce(fulfillment_status, ''),
  [],
  toUInt64(toUnixTimestamp(synced_at)), now()
FROM postgresql('host.docker.internal:5432','brain_dev','connector_order_facts','postgres','postgres');

-- 3) connector_line_item_facts (346K)
INSERT INTO brain.connector_line_item_facts
  (workspace_id, vendor, vendor_order_id, vendor_line_id, vendor_product_id, vendor_variant_id,
   sku, title, quantity, price_mu, line_total_mu, discount_mu, tax_mu, cogs_mu,
   currency_code, order_date, version, ingested_at)
SELECT
  toString(workspace_id), toString(vendor), vendor_order_id, vendor_line_id,
  coalesce(vendor_product_id, ''), '' AS vendor_variant_id,
  coalesce(sku, ''), coalesce(title, ''),
  toInt32(quantity), unit_price_mu, quantity * unit_price_mu, 0, 0, 0,
  'INR', toDate(synced_at),
  toUInt64(toUnixTimestamp(synced_at)), now()
FROM postgresql('host.docker.internal:5432','brain_dev','connector_line_item_facts','postgres','postgres');

-- 4) connector_ad_spend_facts (10K)
INSERT INTO brain.connector_ad_spend_facts
  (workspace_id, vendor, ad_account_id, campaign_id, campaign_name, date,
   impressions, clicks, spend_mu, conversions, revenue_mu, currency_code, version, ingested_at)
SELECT
  toString(workspace_id), toString(vendor),
  '' AS ad_account_id, campaign_id, coalesce(campaign_name, ''), spend_date,
  impressions, clicks, spend_mu, 0, 0, currency_code,
  toUInt64(toUnixTimestamp(synced_at)), now()
FROM postgresql('host.docker.internal:5432','brain_dev','connector_ad_spend_facts','postgres','postgres');

-- 5) connector_shipment_facts (2.5K)
INSERT INTO brain.connector_shipment_facts
  (workspace_id, vendor, vendor_shipment_id, vendor_order_id, status, courier_name,
   delivery_pincode, is_rto, shipped_at, delivered_at, rto_at, date, version, ingested_at)
SELECT
  toString(workspace_id), toString(vendor), vendor_shipment_id,
  coalesce(vendor_order_ref, ''), coalesce(status, ''), coalesce(courier_name, ''),
  coalesce(delivery_pincode, ''),
  if(status_bucket = 'RTO', toUInt8(1), toUInt8(0)),
  shipped_at, delivered_at, rto_initiated_at,
  toDate(coalesce(shipped_at, synced_at)),
  toUInt64(toUnixTimestamp(synced_at)), now()
FROM postgresql('host.docker.internal:5432','brain_dev','connector_shipment_facts','postgres','postgres');

-- 6) connector_refund_facts (1.4K) — LINE grain (vendor_refund_line_id in key)
INSERT INTO brain.connector_refund_facts
  (workspace_id, vendor, vendor_refund_id, vendor_refund_line_id, vendor_order_id,
   vendor_product_id, sku, quantity, refund_amount_mu, tax_mu, currency_code, date,
   version, ingested_at)
SELECT
  toString(workspace_id), toString(vendor), vendor_refund_id, vendor_refund_line_id,
  coalesce(vendor_order_id, ''), coalesce(vendor_product_id, ''), coalesce(sku, ''),
  toInt32(coalesce(quantity, 0)), subtotal_mu, coalesce(tax_mu, 0),
  'INR', toDate(processed_at),
  toUInt64(toUnixTimestamp(synced_at)), now()
FROM postgresql('host.docker.internal:5432','brain_dev','connector_refund_facts','postgres','postgres');

-- Verification
SELECT 'product='||toString(count()) FROM brain.connector_product_facts;
SELECT 'order='||toString(count()) FROM brain.connector_order_facts;
SELECT 'line='||toString(count()) FROM brain.connector_line_item_facts;
SELECT 'ad_spend='||toString(count()) FROM brain.connector_ad_spend_facts;
SELECT 'shipment='||toString(count()) FROM brain.connector_shipment_facts;
SELECT 'refund='||toString(count()) FROM brain.connector_refund_facts;

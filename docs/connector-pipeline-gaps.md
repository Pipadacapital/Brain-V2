# Connector-pipeline gaps — surfaced from real legacy/integration data (2026-05-26)

**Context.** While migrating the live legacy production data (Supabase) into the local
Brain-native dev DB, the *real* shape of integration data exposed input gaps between
what the **metric engine + ClickHouse fact** are designed to consume and what the
**connector ingestion layer (slice E `connector_*_facts`)** actually produces.

The metric registry (`packages/lib-metrics`, `pylibs/brain_metrics`) and
`apps/analytics-service/migrations/clickhouse/0001_base_workspace_daily_metrics.sql`
declare inputs: `cogs_mu`, `returns_mu`, `rto_orders`, `total_shipments`,
`refunded_revenue_mu`, `rto_reversed_revenue_mu`, `shipping_revenue_mu`. The connector
facts only emit gross/discount/tax, orders, line-items, products, ad-spend. So on real
data, **CM1/CM2/True-CM2, Realized Revenue (the billing base), and RTO rate compute to ~0.**

A **local-only accommodation** has already been applied to `brain_dev` to make these
testable today (see `/tmp/brain_mig/03*.sql`). This doc is the **production requirement**
for Rohan/EOS to make it real with full parity, proto, RLS, and security/QA gates.

## Required production changes (prioritized)

### P0-1 — Shiprocket connector + shipment fact (realized GMV + RTO)
- New `connector_vendor` value `SHIPROCKET` (proto enum + TS/Python + migration).
- New `connector_shipment_facts` (workspace-scoped, fail-closed RLS): status →
  normalized bucket (DELIVERED/RTO/CANCELLED/UNDELIVERED/IN_TRANSIT), `is_cod`,
  `cod_amount_mu`, `shipping_charges_mu`, `delivered_at`, `rto_initiated_at`,
  `delivery_pincode/city`.
- **Order↔shipment key.** Legacy never persisted the Shiprocket→Shopify order link
  (`order_id` was Shiprocket's internal id; `channel_order_id`/`shopify_order_name`
  100% NULL). The connector MUST capture and normalize the channel order id/name so
  realized-GMV-by-order is computable. **This is the gating decision.**
- Feeds: `realized_revenue_mu`, `rto_rate_bp`, `true_cm2_mu`, `total_shipments`,
  pincode intelligence, shipping cost into CM2.

### P0-2 — COGS source + line→product link (contribution margin)
- Per-product/variant cost input (`cost_mu`). Source options: Shopify `coq`-equivalent,
  Brain finance-settings (`workspace_cogs_settings`/`workspace_costs` analog), manual.
- **`connector_line_item_facts` must carry `vendor_product_id`** (legacy had
  `product_shopify_id`; Brain facts dropped it → per-SKU COGS can't be joined). Free-text
  `sku` alone is insufficient (blank for "Free Product" lines, no product-fact SKU key).
- Consider a `connector_variant_facts` table (legacy `shopify_variants`, SKU↔product↔cost).
- Data-quality gate: report "estimated" until ≥80% SKU-cost coverage (real Sugandhlok
  data hit 88.7%, 49.3% GM — the gate is realistic).

### P1 — Refund/return fact (revenue ladder)
- New `connector_refund_facts` (per-SKU): `subtotal_mu`, `tax_mu`, `quantity`,
  `vendor_order_id`, `processed_at`. Feeds `returns_mu` (net sales) and
  `refunded_revenue_mu` (realized). Cancellations already derivable from
  `order.cancelled_at`.

### P2 — Platform + granularity coverage
- `connector_vendor` lacks `WOOCOMMERCE` (real Woo store "Ulinen"), `UNICOMMERCE` (OMS),
  `KLAVIYO` (lifecycle/email) — while `store_platform` already has `WOOCOMMERCE`
  (enum inconsistency).
- Ad facts are campaign-level only (no creative/adset, no platform conversions/revenue).
  Likely intentional (Brain is MER-first, ROAS display-only) — confirm + document.
- Shopify order fact lost `shipping_mu` + delivery pincode/city from the *legacy* table;
  the live Shopify pull (`normalizers.ts`) DOES capture both, so this is legacy-data-only.

## What already works on real data (no change needed)
Revenue ladder (gross/discount/tax/net), orders, AOV, new-vs-returning, MER/aMER/CAC,
products, multi-currency (INR + AED), RLS tenant isolation. Money is exact BIGINT paise.

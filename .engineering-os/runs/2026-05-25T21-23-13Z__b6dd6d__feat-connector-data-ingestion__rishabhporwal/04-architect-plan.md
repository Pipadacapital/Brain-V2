# Stage 2 — Architect Plan (Aryan) — Slice E: connector data ingestion

**Paradigm:** sql/io (provider pull + deterministic SQL UPSERT + per-SKU GST; NO LLM/ML).
**Synthesizes:** connector-ingest-to-analytics-parity-realist (P-001..P-007, all ACCEPTED).

## Architectural ruling (load-bearing): where slice E lives, and why TS not Python

The **analytics read path is the TS gateway `StubDataPlane`** (loopback-data-plane.ts → DataPlanePort).
The Python `ingestion-service` exists with a mature `ingest_batch` primitive, BUT it has no running
runtime here, writes to its OWN raw_* tables, and its output is consumed via Kafka/ClickHouse which are
NOT stood up locally (Phase-3 graduation, trigger not fired). Wiring Python ingest → Kafka → ClickHouse →
TS read for a LOCAL dev pull would be massive over-engineering (canon §1: "run the infra at the smallest
footprint; graduate a heavy layer only when its trigger fires").

**Decision:** implement slice E **in TS, in core-service (sync/ACL/fact write) + api-gateway (read seam)**,
against the SAME local dev Postgres (:5432 brain_dev) slices C/D use, reusing slice-D `withWorkspace` +
custody. We **replicate the Child-3 ingest CONTRACT** (idempotent UPSERT keyed on `(workspace_id, vendor,
vendor_event_id)`; RLS via withWorkspace; injectable fetch seam; PII minimization), NOT its Python runtime.
This is the Single-Primitive Rule applied honestly: ONE language for the local read+write path, no second
runtime, no broker, no OLAP cluster. The Python framework remains the Phase-3 production ingestion path
(unchanged, HOLD). This boundary is stated on the page and in the retro.

## New local-dev fact tables (additive migration `05-schema-connector-facts.sql` + `06-enable-rls-connector-facts.sql`)

All FORCE RLS, `ws_isolation` policy shape from slice C/D (`workspace_id = NULLIF(current_setting(
'app.workspace_id', true), '')::uuid`), GRANT DML to `rls_app`. Money = **BIGINT minor units** + currency.

1. **`connector_order_facts`** (canonical order, post-ACL):
   `id uuid pk`, `workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`,
   `vendor connector_vendor NOT NULL`, `vendor_order_id text NOT NULL`, `order_number text`,
   `financial_status text`, `fulfillment_status text`, `payment_method text` (COD/Prepaid via adapter),
   `currency_code text NOT NULL`,
   `gross_sales_mu bigint NOT NULL`, `total_discount_mu bigint NOT NULL`, `total_tax_mu bigint NOT NULL`,
   `shipping_mu bigint NOT NULL DEFAULT 0`,
   `customer_ref text` (hashed/opaque customer id — NOT email; for new-vs-returning), `is_new_customer boolean`,
   `delivery_pincode text`, `delivery_city text`,   -- India RTO/pincode metric ONLY (no full address/phone)
   `processed_at timestamptz`, `cancelled_at timestamptz`,
   `synced_at timestamptz NOT NULL DEFAULT now()`,
   **`UNIQUE (workspace_id, vendor, vendor_order_id)`** ← the idempotency key (P-002).
   - **NO email/first_name/last_name stored** (DPDP minimization, P-006): the raw landing keeps PII under
     manifest; the canonical FACT keeps only an opaque `customer_ref` (sha256 of vendor customer id) for
     new-vs-returning. The analytics never need the name/email.
2. **`connector_line_item_facts`** (per-SKU, drives per-SKU GST extraction — P-004):
   `id uuid pk`, `workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`,
   `vendor connector_vendor NOT NULL`, `vendor_order_id text NOT NULL`, `vendor_line_id text NOT NULL`,
   `sku text`, `title text`, `quantity bigint NOT NULL`, `unit_price_mu bigint NOT NULL`,
   `gst_slab_bp int` (resolved by the India adapter from sku/product → 0/500/1800/4000 bp),
   `synced_at timestamptz NOT NULL DEFAULT now()`,
   **`UNIQUE (workspace_id, vendor, vendor_order_id, vendor_line_id)`** ← idempotency key.
3. **`connector_product_facts`**: `id`, `workspace_id` (FK+RLS), `vendor`, `vendor_product_id text`,
   `title text`, `product_type text`, `status text`, `synced_at`,
   **`UNIQUE (workspace_id, vendor, vendor_product_id)`**.
4. **`connector_ad_spend_facts`** (Meta + Google daily spend — P-001/P-002 for marketing):
   `id`, `workspace_id` (FK+RLS), `vendor connector_vendor NOT NULL`, `campaign_id text NOT NULL`,
   `campaign_name text`, `spend_date date NOT NULL`, `spend_mu bigint NOT NULL`,
   `impressions bigint NOT NULL DEFAULT 0`, `clicks bigint NOT NULL DEFAULT 0`, `currency_code text NOT NULL`,
   `synced_at`, **`UNIQUE (workspace_id, vendor, campaign_id, spend_date)`** ← idempotency key
   (re-syncing the same day's spend UPSERTs the same row → no double-count, P-002).

> No new ENUMs (reuse `connector_vendor`). No proto change for local (the TS DataPlanePort already
> carries the analytics shapes; proto codegen is Phase-3). No new dependency.

## The ACL (raw vendor → canonical fact) — `apps/core-service/src/application/connectors/sync/acl.ts`

- **Money:** decimal-STRING → minor units WITHOUT float (P-004). Helper `rupeesStringToMinorUnits('4999.00')`:
  split on '.', pad/truncate the fraction to the currency's subunit exponent (subunitMultiplier from
  lib-metrics), assemble as BigInt. NO `parseFloat()*100`. Reuse lib-metrics `makeMoney`.
- **Per-SKU GST:** `gst_slab_bp` resolved per line item. For slice E (no product→HSN map locally), the
  India adapter default applies a per-line slab; line items carry `sku` so the EXISTING slice-1 revenue
  ladder per-SKU extraction runs. Documented: real HSN→slab mapping is a later slice (slice E lands the
  per-SKU structure the extractor needs, not a new GST engine).
- **Payment method:** Shopify `gateway`/`payment_gateway_names` → COD vs Prepaid via the India adapter
  classifier (reuse the existing one). Drives slice-3 COD/RTO and slice-4 acquisition.
- **new-vs-returning:** opaque `customer_ref = sha256(vendor_customer_id)`; first-seen in the workspace →
  is_new_customer. (No PII; supports aMER/CAC.)

## Provider fetch — injectable seam (P-005) — `apps/core-service/src/application/connectors/sync/provider-fetch.ts`

Mirror slice-D's `ProviderHttp` pattern. `interface ConnectorFetch { fetchShopify(token, shop, window),
fetchMetaSpend(token, window), fetchGoogleSpend(token, window) }`. Real impl uses `fetch` against:
- **Shopify Admin GraphQL** `https://{shop}/admin/api/2024-10/graphql.json` with the legacy `ORDERS_QUERY`
  + `PRODUCTS_QUERY` shapes (the SOURCE OF TRUTH — `totalPriceSet.shopMoney.amount`, `lineItems.edges`,
  `sku`, `variant.product.id`, `pageInfo.endCursor` cursor). Window = `SHOPIFY_ORDER_BACKFILL_DAYS`.
- **Meta** `graph.facebook.com/v21.0/act_{id}/insights` fields `campaign_id,campaign_name,impressions,
  clicks,spend,date_start,date_stop`. Window = `ADS_BACKFILL_DAYS`.
- **Google Ads** GAQL `metrics.cost_micros, segments.date, campaign.id, campaign.name, metrics.impressions,
  metrics.clicks` (cost_micros → minor units = micros/10000 for INR). Refresh-token flow (offline).
Tests inject a FIXTURE returning these exact JSON shapes (real shapes from legacy). The custody token is
read INSIDE the use-case and passed to the fetch seam; **never logged, never returned, never in an error**.

## Sync use-case — `apps/core-service/src/application/connectors/sync/sync-use-cases.ts`

`syncConnector({ vendor, workspaceId, window? })`:
1. requireRole MANAGER (enforced at the gateway, P-006) — config-class action, mirrors slice-D initiate.
2. Read the connection row under `withWorkspace`. If NOT CONNECTED → return clean `{ status:'not_connected' }`
   (NO custody read, NO crash — P-006).
3. Set status → `syncing` (P-007).
4. `custody.get(ws, vendor)` → token (slice-D custody; AES-GCM decrypt).
5. `fetch.*(token, window)` → raw vendor rows.
6. ACL: normalize → canonical facts (money minor-units, per-SKU, payment-method, customer_ref).
7. **In ONE `withWorkspace` transaction (P-002/P-007):** idempotent UPSERT every fact (ON CONFLICT on the
   UNIQUE idempotency key DO UPDATE), THEN set `last_sync_at = now()`, `last_sync_error = NULL`,
   `status = 'CONNECTED'`. If anything throws: rollback (facts + last_sync_at unchanged), set
   `last_sync_error`, status stays CONNECTED (NOT a fake "synced"). Generic error only.
8. Return `{ status, ordersSynced, lineItemsSynced, productsSynced, adRowsSynced, lastSyncAt }` — counts,
   never the token. Re-sync → counts reflect dedup (upserted vs no-op), analytics numbers unchanged.

## Read seam — connected workspace reads its OWN facts (P-001/P-003)

Refactor `loopback-data-plane.ts`: introduce **`LocalDbDataPlane implements DataPlanePort`** that, for a
NON-Sugandh workspace, reads the connector_*_facts under `withWorkspace(workspace_id)` and computes the
analytics result shapes (StoreSummaryRow + ladder, PnlStatement, MarketingEfficiency/Acquisition, KPI) via
the EXISTING lib-metrics registry definitions (per-SKU GST extraction, CM waterfall) — NO new metric defs,
NO LLM. A **dispatcher** keeps Sugandh-Lok on `StubDataPlane` (seed, regression guard) and routes other
workspaces to `LocalDbDataPlane`. Both speak the SAME DataPlanePort contract (Single-Primitive).
- **Honest empty-state (P-001/P-007):** a workspace with NO synced facts → the dataAvailability empty-state
  (slice-C `workspace.dataAvailability` pattern), NOT a fabricated number and NOT the Sugandh seed.
- **Tenancy (P-003):** every fact read is `withWorkspace(ws)` under FORCE RLS → context-less read = 0 rows;
  a foreign workspace_id at the tRPC layer throws UnscopedQueryError (the DataPlanePort contract already
  fails closed on workspace_id mismatch).

## Sync trigger UI — `/settings/integrations` (reuse slice-D IntegrationsContent)

Add a "Sync now" button per CONNECTED vendor → `connectors.sync` mutation (MANAGER). Show per-connector
status: idle / syncing / `last_sync_at` / error (reuse slice-D status payload; `syncPending` already there).
After sync success → invalidate the analytics queries so the pages re-render with real numbers.

## Gateway — extend `connectorsRouter`

- `connectors.sync` (mutation, requireRole MANAGER): `{ vendor }` → `syncConnector(...)`. Maps
  ConnectorError → tRPC (generic message + request_id; never a provider body/token).
- `connectors.list` already returns status (slice D) — extend status to surface `lastSyncAt`/`syncing`.

## Verification plan (Stage 5 — mechanical, fixture-driven; all at the ANALYTICS layer)
- **P-001:** sync a fixture Shopify order of a KNOWN total for workspace B → `store.summary` for B returns
  THAT realized revenue (not ₹18.5L). Sugandh still returns its seed.
- **P-002:** sync the SAME fixture batch twice → analytics revenue/spend/CM2 BYTE-IDENTICAL after run 2.
- **P-003:** two synced workspaces → A's summary ≠ B's; context-less fact read = 0 rows; foreign ws → throw.
- **P-004:** two-SKU fixture at different GST slabs → correct blended net-of-tax; assert NO float drift
  (4999.00 → 499900 exactly).
- **P-005:** fixture-injected fetch exercises the full sync; assert GraphQL/insights/GAQL shapes parsed.
- **P-006:** sync NOT_CONNECTED vendor → clean error, no token read; grep gate: no token field in any
  console/return/throw across slice-E files; MANAGER role enforced.
- **P-007:** forced fetch failure → last_sync_error set, last_sync_at unchanged, status not "synced".
- typecheck 0; existing parity gate green; RLS + idempotency proven at the wire on local Postgres.

## Deferrals (named, stated on pages)
ClickHouse OLAP read (local stays Postgres); Shopify webhooks/CDC; refund-sync; Klaviyo/Shiprocket/Woo/
Unicommerce connectors; multi-ad-account/MCC selection (store account_ref); scheduled/cron sync (manual
"Sync now" + on-connect only); the live pull itself (needs Founder OAuth consent — fixture-verified now).

## Over-engineering guard (Single-Primitive)
ONE sync path consumed per-vendor (per-vendor quirks behind the fetch seam + ACL config), ONE custody seam
(slice D), ONE withWorkspace primitive, ONE read-seam dispatcher, ZERO new metric defs (reuse the registry),
ZERO new deps (node:crypto + pg + lib-metrics present), NO Kafka/ClickHouse/Python runtime for local.

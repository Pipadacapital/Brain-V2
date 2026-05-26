# Data-architecture plan v2 — OLTP/OLAP split honoring Brain canon
**Author:** Aryan (architect, EOS Stage 2 redo) · **Date:** 2026-05-26 · **Status:** design-only, no schema/code changes yet
**Supersedes:** `docs/data-architecture-plan.md` (v1) — kept on disk for diff.

**What changed since v1.** v1 put every domain into Postgres `brain_dev`. Canon (TECH/01 §3, `technical-context.md` lines 23/29/44–45/99–103/143) says: **Postgres = OLTP (identity, config, PII, RLS, 90-day hot mirror); ClickHouse = OLAP (historical facts, aggregates, time-series, append-mostly via `ReplacingMergeTree(version)`)**. v1 ignored this. v2 re-routes every domain to the correct store, lands a local ClickHouse alongside the existing Postgres, and is explicit about the read-path move.

> **Reading order.** §1 binding rules + the split principle. §2 per-domain store assignment. §3 ClickHouse DDL. §4 local CH setup. §5 slice-E backfill recommendation. §6 read-path move. §7 what of Phase 1 to roll back. §8 phase plan v2. §9 risks. §10 open questions. §11 persona stress-test.

---

## 0. Anchors (canon honored)

| Rule | Where | How v2 honors it |
|---|---|---|
| **OLTP/OLAP split** | `requirements/technical-context.md` lines 23, 29, 44–45, 99–103 | Postgres holds identity/config/PII/audit + a **90-day hot mirror** of facts; ClickHouse holds the **historical facts** + computed aggregates + MVs. v1's mistake (all-Postgres) is corrected. |
| Money = integer minor units (BIGINT in PG, Int64 in CH) | TECH/01 §6 | Every money column is `BIGINT/Int64 *_mu` + `currency_code TEXT/String`. No NUMERIC, no float, in either store. |
| ClickHouse query gateway (Layer 4 of tenancy) | `pylibs/brain_clickhouse/__init__.py`, `technical-context.md` line 92 | Every CH query goes through the gateway, which rejects any query lacking a `workspace_id` predicate. ORDER BY always `(workspace_id, date, …)`. |
| ReplacingMergeTree(version) for idempotency | `technical-context.md` line 143 | Every CH fact table uses `ReplacingMergeTree(version)` where `version` = `ingested_at` or a monotonic sequence. Re-running ETL on the same payload deduplicates by the ORDER BY tuple. |
| RLS-FORCE, workspace_id-leading, fail-closed (PG) | Child-1 CF-C1-RLS-DEFAULT-1.a | Postgres tables that **remain** PG (identity/config/PII/app-data + 90d hot mirror) keep the v1 `ws_isolation` policy. CH has no RLS — the gateway is the enforcement. |
| Single-Primitive Rule | architect skill | One fact "kind" = one CH table. Vendor = a `LowCardinality(String)` column, never a fork. |
| RegionAdapter | TECH/04 | Same as v1 — `currency_code` + raw pincode strings, no India-specific column names. |
| Reversibility | architect skill | Every CH table has a `DROP TABLE IF EXISTS … ON CLUSTER … SYNC` down; every PG drop has a snapshot. CH compose is `docker compose down -v` clean. |

---

## 1. The store-split principle (binding)

A row belongs in **POSTGRES (OLTP)** if it answers YES to ANY of:
1. **Identity / membership** — a user, workspace, member, invitation; the source of truth for "who can access what."
2. **Configuration** — workspace settings, COGS rules, cost rules, goals, festivals, classification overrides; mutable, low-volume, hand-edited via the UI.
3. **PII / consent state** — anything subject to DPDP minimization + RTBE-erasure. Single-row erasure must be cheap and exact.
4. **Audit / append-only ledger required for legal compliance** — `audit_log`, `ai.decision_log`. These need ACID semantics + per-row UPDATE-deny triggers, not CH's eventually-merged tree.
5. **RLS-enforced cross-tenant guarantee at the storage layer** — the row's tenancy must be enforced by the database itself (not just the gateway). PG RLS is the right tool.
6. **Strong consistency required for the next read** — onboarding writes a workspace; the next page-load must see it. Read-after-write on CH is "eventually consistent after merge"; PG is read-your-writes.

A row belongs in **CLICKHOUSE (OLAP)** if it answers YES to ANY of:
1. **High-volume fact, append-mostly** — orders, line items, shipments, refunds, ad-spend, creative-day, funnel-day, email-send, variants-as-time-series, customer-event-stream.
2. **Aggregated/derived from facts** — `workspace_daily_metrics`, `product_daily_aggregates`, `shopify_analytics_daily`. These are materialized views over the facts.
3. **Time-series / analytical query** — ranged by `date`, filtered by `workspace_id`, scanned across millions of rows for dashboards.
4. **Read pattern is `SUM/COUNT/AVG over (workspace_id, date, dim)`** — the canonical CH access shape.

**Hybrid (90-day hot mirror)** — per `technical-context.md` line 99, "Postgres keeps a **90-day hot mirror** for fast joins + webhook reconciliation." This is the *only* legitimate "fact also in Postgres" pattern, and only for the most recent 90 days, and only for facts that participate in webhook reconciliation or join-to-config. We use it sparingly (`connector_order_facts_hot`, `connector_line_item_facts_hot` only — webhook reconciles into these; everything else is CH-only).

---

## 2. Domain inventory v2 — per table, store assignment

Format: `[domain] · [target store] · [one-line why]`. Tables that already exist in PG (slice E + Phase 1) carry their current path; tables proposed in v1 carry their v1 §3 path.

### 2A. POSTGRES (OLTP) — identity / config / PII / audit / app-data

| # | Table | Status | Why PG |
|---|---|---|---|
| O1 | `users` | EXISTS (`01-schema-onboarding.sql`) | Identity. Must FK to RLS context. |
| O2 | `workspaces` | EXISTS + v1 additive columns (`20-extend-workspaces.sql` applied) | Identity + per-tenant config. |
| O3 | `workspace_members` | EXISTS | Identity. |
| O4 | `invitations` | EXISTS | Identity / lifecycle. |
| O5 | `connector_connections` (12 rows live) | EXISTS (`03-schema-connectors.sql`) | OAuth custody + tenancy state. KMS-encrypted credentials. PG. |
| O6 | `customer_pii` | v1 Phase 1 applied (`07-…sql`) | PII + consent state + per-row erasure. **PG.** Stays. |
| O7 | `workspace_cogs_settings` | v1 Phase 1 applied (`16-…sql`) | Config. PG. |
| O8 | `workspace_costs` | v1 Phase 1 applied | Config. PG. |
| O9 | `workspace_misc_expenses` | v1 Phase 1 applied | Config. PG. |
| O10 | `workspace_metric_goals` | v1 Phase 1 applied | Config. PG. |
| O11 | `workspace_festivals` | v1 Phase 1 applied | Config. PG. |
| O12 | `workspace_ad_campaign_classifications` | v1 Phase 1 applied | Config (classifies CH ad data). PG. |
| O13 | `notifications` | v1 Phase 1 applied (`18-…sql`) | App state, per-user read flag, UPDATE-heavy. PG. |
| O14 | `ai_insights` | v1 Phase 1 applied | LLM result cache; mutated as status transitions pending→processing→done. UPDATE-heavy. PG. |
| O15 | `marketing_actions` | v1 Phase 1 applied | User-authored, UPDATE-heavy, low volume. PG. |
| O16 | `audit_log` | v1 Phase 1 applied | Append-only legal ledger; needs ACID + deny-triggers; low volume; joined with users. PG. |
| O17 | `connector_order_facts_hot` (90d slice) | NEW name; today's `connector_order_facts` (83K rows) **renames** to this | 90-day hot mirror for webhook reconciliation (Shopify webhook arrives → look up the existing order to update status). Beyond 90d, CH is authoritative. |
| O18 | `connector_line_item_facts_hot` (90d slice) | NEW name; today's `connector_line_item_facts` (346K rows) renames | Joined to `connector_order_facts_hot` during webhook reconciliation. 90d only. |

### 2B. CLICKHOUSE (OLAP) — facts + aggregates

All in CH database `brain`, all `ReplacingMergeTree(version)`, all `PARTITION BY toYYYYMM(date)`, all `ORDER BY (workspace_id, …)`.

| # | Table (CH) | Source / replaces | Why CH |
|---|---|---|---|
| C1 | `brain.connector_order_facts` | slice-E PG `connector_order_facts` (83K) — **CH becomes authoritative beyond 90d** | High-volume fact, append-mostly, time-series. |
| C2 | `brain.connector_line_item_facts` | slice-E PG (346K) | Higher-volume fact (per-SKU), pure analytical. |
| C3 | `brain.connector_product_facts` | slice-E PG (957) | Low volume **today** but the catalog grows + we need `JOIN` to facts inside CH. Co-locate. |
| C4 | `brain.connector_variant_facts` | v1 D3 (was PG `connector_variant_facts`, Phase 1 applied) | Per-SKU child of product; joined to facts; CH-native. |
| C5 | `brain.connector_ad_spend_facts` | slice-E PG (10K) | Time-series ad-day fact. |
| C6 | `brain.connector_ad_creative_facts` | v1 D7a (Phase 1 applied in PG) | 46K rows growing; pure analytical. |
| C7 | `brain.connector_ad_funnel_facts` | v1 D7b (Phase 1 applied in PG) | Time-series funnel-day. |
| C8 | `brain.connector_shipment_facts` | slice-E PG (2.5K) | Logistics time-series; joined to orders by `vendor_order_id`. |
| C9 | `brain.connector_refund_facts` | slice-E PG (1.4K) | Refund-day fact. |
| C10 | `brain.connector_logistics_order_facts` | v1 D9 (Phase 1 applied in PG) | Shiprocket order layer; analytical join key. |
| C11 | `brain.connector_email_send_facts` | v1 D6 (Phase 1 applied in PG) | Send-day time-series. |
| C12 | `brain.workspace_daily_metrics_base` | **ALREADY DESIGNED in `0001_base_workspace_daily_metrics.sql`** — keep as-is | The master aggregate. |
| C13 | `brain.workspace_daily_metrics_computed` + MV | **ALREADY DESIGNED in `0002_mv_computed_ratios.sql`** — keep as-is | The ratio MV. |
| C14 | `brain.shopify_analytics_daily` | v1 D20 `legacy_aggregates.shopify_analytics_daily` (Phase 1 applied in PG) | Daily aggregate; CH-native. |
| C15 | `brain.product_daily_aggregates` | v1 D20 `legacy_aggregates.product_daily_aggregates` (Phase 1 applied in PG) | 71K-row product-day aggregate; CH-native. |
| C16 | `brain.workspace_daily_metrics_legacy` | v1 D20 `legacy_aggregates.workspace_daily_metrics` (Phase 1 applied in PG) | Transitional mirror of the legacy table (the 122 hand-rolled rows). Lives in CH alongside the canonical `workspace_daily_metrics_base` (C12). Two tables, two roles: C16 = transitional read source for legacy parity; C12 = Brain-native metric engine output. |

---

## 3. ClickHouse DDL — concrete (sized for the existing canon)

> **File placement.** Each goes in `apps/analytics-service/migrations/clickhouse/` as `0003_*.sql` through `0014_*.sql`, mirroring the existing `0001`/`0002` discipline. Same runbook-gated apply pattern (`README.md`). Same `_divop_template.sql` guardrail.

### 3.1 Convention block (top of every new CH file)

```
-- @paradigm: sql
-- workspace_id LEADING in ORDER BY (CH query gateway requires the predicate)
-- ReplacingMergeTree(version) for idempotent re-ingest
-- All money: Int64 minor units (mu). All ratios: Int32 basis points (bp).
-- All currencies: LowCardinality(String) (cardinality ≤ ~50 globally).
-- All vendors: LowCardinality(String) — mirrors the PG connector_vendor enum.
```

### 3.2 Order facts (C1)

```sql
CREATE TABLE IF NOT EXISTS brain.connector_order_facts (
    workspace_id        String          NOT NULL,
    vendor              LowCardinality(String) NOT NULL,   -- SHOPIFY | WOOCOMMERCE | …
    vendor_order_id     String          NOT NULL,
    order_date          Date            NOT NULL,
    placed_at           DateTime64(3, 'UTC'),
    customer_ref        String,                            -- sha256 hash; joined to PG customer_pii by (workspace_id, customer_ref)
    delivery_pincode    LowCardinality(String),
    delivery_city       LowCardinality(String),

    -- Revenue ladder (Int64 minor units)
    gross_sales_mu      Int64           DEFAULT 0,
    discount_mu         Int64           DEFAULT 0,
    tax_mu              Int64           DEFAULT 0,
    shipping_mu         Int64           DEFAULT 0,
    net_sales_mu        Int64           DEFAULT 0,
    total_refund_mu     Int64           DEFAULT 0,
    currency_code       LowCardinality(String) NOT NULL,

    -- Payment / status
    payment_method      LowCardinality(String),
    is_cod              UInt8,
    order_type          LowCardinality(String),
    financial_status    LowCardinality(String),
    fulfillment_status  LowCardinality(String),

    -- Tags
    tags                Array(String)   DEFAULT [],

    -- Versioning (idempotent re-ingest)
    version             UInt64          NOT NULL,           -- monotonic; use toUnixTimestamp(synced_at) * 1000 + seq
    ingested_at         DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_order_id)
SETTINGS index_granularity = 8192;
```

**Idempotency.** Re-ingesting the same `(workspace_id, vendor, vendor_order_id)` with a higher `version` supersedes the prior row (CH merges in background; `FINAL` keyword on read-time returns the latest). The gateway adds `FINAL` for any reads of facts.

### 3.3 Line item facts (C2)

```sql
CREATE TABLE IF NOT EXISTS brain.connector_line_item_facts (
    workspace_id        String          NOT NULL,
    vendor              LowCardinality(String) NOT NULL,
    vendor_order_id     String          NOT NULL,
    vendor_line_id      String          NOT NULL,
    vendor_product_id   String,
    vendor_variant_id   String,
    sku                 String,
    title               String,
    quantity            Int32           DEFAULT 0,
    price_mu            Int64           DEFAULT 0,           -- per-unit
    line_total_mu       Int64           DEFAULT 0,
    discount_mu         Int64           DEFAULT 0,
    tax_mu              Int64           DEFAULT 0,
    cogs_mu             Int64           DEFAULT 0,
    currency_code       LowCardinality(String) NOT NULL,
    order_date          Date            NOT NULL,            -- denormalized for partitioning
    version             UInt64          NOT NULL,
    ingested_at         DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_order_id, vendor_line_id)
SETTINGS index_granularity = 8192;
```

### 3.4 Product + variant (C3, C4)

```sql
CREATE TABLE IF NOT EXISTS brain.connector_product_facts (
    workspace_id        String          NOT NULL,
    vendor              LowCardinality(String) NOT NULL,
    vendor_product_id   String          NOT NULL,
    sku                 String,
    title               String,
    handle              String,
    image_url           String,
    cost_mu             Int64           DEFAULT 0,
    mrp_mu              Int64           DEFAULT 0,
    inventory_qty       Int32,
    tags                Array(String)   DEFAULT [],
    currency_code       LowCardinality(String),
    synced_date         Date            DEFAULT today(),     -- partition pseudo-date (catalog isn't time-series; one partition per month of sync)
    version             UInt64          NOT NULL,
    ingested_at         DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(synced_date)
ORDER BY (workspace_id, vendor, vendor_product_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS brain.connector_variant_facts (
    workspace_id           String          NOT NULL,
    vendor                 LowCardinality(String) NOT NULL,
    vendor_variant_id      String          NOT NULL,
    vendor_product_id      String          NOT NULL,
    sku                    String,
    title                  String,
    price_mu               Int64           DEFAULT 0,
    compare_at_price_mu    Int64           DEFAULT 0,
    inventory_qty          Int32,
    synced_date            Date            DEFAULT today(),
    version                UInt64          NOT NULL,
    ingested_at            DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(synced_date)
ORDER BY (workspace_id, vendor, vendor_variant_id)
SETTINGS index_granularity = 8192;
```

### 3.5 Ad spend / creative / funnel (C5, C6, C7)

```sql
CREATE TABLE IF NOT EXISTS brain.connector_ad_spend_facts (
    workspace_id    String          NOT NULL,
    vendor          LowCardinality(String) NOT NULL,   -- META | GOOGLE
    ad_account_id   String          NOT NULL,
    campaign_id     String          NOT NULL,
    campaign_name   String,
    date            Date            NOT NULL,
    impressions     Int64           DEFAULT 0,
    clicks          Int64           DEFAULT 0,
    spend_mu        Int64           DEFAULT 0,
    conversions     Int32           DEFAULT 0,
    revenue_mu      Int64           DEFAULT 0,
    currency_code   LowCardinality(String) NOT NULL,
    version         UInt64          NOT NULL,
    ingested_at     DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, ad_account_id, campaign_id, date);

CREATE TABLE IF NOT EXISTS brain.connector_ad_creative_facts (
    workspace_id        String          NOT NULL,
    vendor              LowCardinality(String) NOT NULL,
    ad_account_id       String          NOT NULL,
    ad_id               String          NOT NULL,
    ad_name             String,
    campaign_id         String,
    adset_id            String,
    date                Date            NOT NULL,
    impressions         Int64           DEFAULT 0,
    clicks              Int64           DEFAULT 0,
    spend_mu            Int64           DEFAULT 0,
    video_thruplay      Int32           DEFAULT 0,
    avg_watch_sec_x100  Int32           DEFAULT 0,
    video_p25           Int32           DEFAULT 0,
    video_p50           Int32           DEFAULT 0,
    video_p75           Int32           DEFAULT 0,
    video_p95           Int32           DEFAULT 0,
    conversions         Int32           DEFAULT 0,
    revenue_mu          Int64           DEFAULT 0,
    currency_code       LowCardinality(String) NOT NULL,
    version             UInt64          NOT NULL,
    ingested_at         DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, ad_account_id, ad_id, date);

CREATE TABLE IF NOT EXISTS brain.connector_ad_funnel_facts (
    workspace_id         String          NOT NULL,
    vendor               LowCardinality(String) NOT NULL,
    customer_id          String          NOT NULL,            -- Google Ads "customer" = account
    campaign_id          String          NOT NULL,
    date                 Date            NOT NULL,
    stage                LowCardinality(String) NOT NULL,
    conversions_x1000    Int64           DEFAULT 0,
    conversion_value_mu  Int64           DEFAULT 0,
    currency_code        LowCardinality(String) NOT NULL,
    version              UInt64          NOT NULL,
    ingested_at          DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, customer_id, campaign_id, date, stage);
```

### 3.6 Shipment / refund / logistics-order (C8, C9, C10)

```sql
CREATE TABLE IF NOT EXISTS brain.connector_shipment_facts (
    workspace_id            String          NOT NULL,
    vendor                  LowCardinality(String) NOT NULL,   -- SHIPROCKET
    vendor_shipment_id      String          NOT NULL,
    vendor_order_id         String,                              -- join to connector_order_facts
    status                  LowCardinality(String),
    courier_name            LowCardinality(String),
    delivery_pincode        LowCardinality(String),
    is_rto                  UInt8,
    shipped_at              Nullable(DateTime),
    delivered_at            Nullable(DateTime),
    rto_at                  Nullable(DateTime),
    date                    Date            NOT NULL,            -- partition pseudo-date (= ship date OR creation)
    version                 UInt64          NOT NULL,
    ingested_at             DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, vendor_shipment_id);

CREATE TABLE IF NOT EXISTS brain.connector_refund_facts (
    workspace_id        String          NOT NULL,
    vendor              LowCardinality(String) NOT NULL,
    vendor_refund_id    String          NOT NULL,
    vendor_order_id     String,
    vendor_product_id   String,
    refund_amount_mu    Int64           DEFAULT 0,
    currency_code       LowCardinality(String) NOT NULL,
    date                Date            NOT NULL,
    version             UInt64          NOT NULL,
    ingested_at         DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, vendor, vendor_refund_id);

CREATE TABLE IF NOT EXISTS brain.connector_logistics_order_facts (
    workspace_id                String          NOT NULL,
    vendor                      LowCardinality(String) NOT NULL,
    vendor_logistics_order_id   String          NOT NULL,
    channel_order_id            String,                          -- join to connector_order_facts.vendor_order_id
    channel_name                LowCardinality(String),
    status                      LowCardinality(String),
    payment_method              LowCardinality(String),
    total_mu                    Int64           DEFAULT 0,
    currency_code               LowCardinality(String) NOT NULL,
    order_date                  Date            NOT NULL,
    version                     UInt64          NOT NULL,
    ingested_at                 DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (workspace_id, vendor, vendor_logistics_order_id);
```

### 3.7 Email send (C11)

```sql
CREATE TABLE IF NOT EXISTS brain.connector_email_send_facts (
    workspace_id          String          NOT NULL,
    vendor                LowCardinality(String) NOT NULL,   -- KLAVIYO
    source_type           LowCardinality(String) NOT NULL,   -- campaign | flow
    vendor_resource_id    String          NOT NULL,
    name                  String,
    channel               LowCardinality(String),
    send_date             Date            NOT NULL,
    delivered             Int32           DEFAULT 0,
    unique_opens          Int32           DEFAULT 0,
    unique_clicks         Int32           DEFAULT 0,
    orders                Int32           DEFAULT 0,
    revenue_mu            Int64           DEFAULT 0,
    currency_code         LowCardinality(String),
    unsubscribes          Int32           DEFAULT 0,
    spam_complaints       Int32           DEFAULT 0,
    version               UInt64          NOT NULL,
    ingested_at           DateTime        DEFAULT now()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(send_date)
ORDER BY (workspace_id, vendor, source_type, vendor_resource_id, send_date);
```

### 3.8 Legacy aggregate mirrors (C14, C15, C16)

`shopify_analytics_daily`, `product_daily_aggregates`, `workspace_daily_metrics_legacy` — same shape as v1 §3.12 but in CH with `ReplacingMergeTree(version)`, `PARTITION BY toYYYYMM(date)`, `ORDER BY (workspace_id, …, date)`. Omitted here for brevity — they're a mechanical port of the v1 DDL (PG types → CH types: `BIGINT → Int64`, `INT → Int32`, `TEXT → String` or `LowCardinality(String)` where the cardinality is bounded, `DATE → Date`, `TIMESTAMPTZ → DateTime`). All three carry the same `version + ingested_at` audit columns.

### 3.9 90-day hot-mirror PG tables (O17, O18)

`connector_order_facts_hot` and `connector_line_item_facts_hot` are the **renames** of today's `connector_order_facts` and `connector_line_item_facts` in PG (the 83K + 346K rows that already exist), trimmed to 90 days by a nightly purge job. Same DDL, same RLS, same constraints — just a rename + a `DELETE FROM … WHERE order_date < now() - interval '90 days'` cron. No new tables.

```sql
ALTER TABLE connector_order_facts RENAME TO connector_order_facts_hot;
ALTER TABLE connector_line_item_facts RENAME TO connector_line_item_facts_hot;
-- (RLS policies/grants ride along under the new name.)
```

A nightly job (`tools/purge-hot-mirror.sql`) deletes rows older than 90 days. The hot-mirror is a *cache* + *webhook reconciliation surface*, not a source of truth — CH is.

---

## 4. Local ClickHouse setup

### 4.1 Compose service

Add a new compose file `apps/analytics-service/docker-compose.dev.yml` mirroring `apps/core-service/docker-compose.dev.yml`:

```yaml
# LOCAL DEV ClickHouse for the analytics-service (OLAP plane).
#
# Founder-binding decision (2026-05-26, v2 redo): facts live in ClickHouse per canon
# (technical-context.md §99–§103). This compose stands up a single-node clickhouse-server
# on :8123 (HTTP) / :9000 (native) so the analytics-service + ETL can land facts locally.
#
# Usage:
#   docker compose -f apps/analytics-service/docker-compose.dev.yml up -d
#   # wait until healthy (~10s), then apply DDL:
#   clickhouse-client --host localhost --port 9000 \
#     --queries-file apps/analytics-service/migrations/clickhouse/0001_base_workspace_daily_metrics.sql
#   # …repeat for 0002..0014
#
# The analytics-service connects via:
#   CLICKHOUSE_URL=http://localhost:8123
#   CLICKHOUSE_DATABASE=brain
#   CLICKHOUSE_USER=brain_app
#   CLICKHOUSE_PASSWORD=brain_app_pw
#
# Teardown:
#   docker compose -f apps/analytics-service/docker-compose.dev.yml down -v

services:
  clickhouse-dev:
    image: clickhouse/clickhouse-server:24.8-alpine     # pin a real LTS; verify-and-pin latest LTS at build time
    container_name: brain-clickhouse-dev
    environment:
      CLICKHOUSE_DB: brain
      CLICKHOUSE_USER: brain_app
      CLICKHOUSE_PASSWORD: brain_app_pw
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1
    ports:
      - "8123:8123"     # HTTP
      - "9000:9000"     # native TCP
    ulimits:
      nofile:
        soft: 262144
        hard: 262144
    volumes:
      - brain-chdata-dev:/var/lib/clickhouse
      - ./docker/clickhouse-initdb-dev:/docker-entrypoint-initdb.d:ro    # ensures `brain` DB + `brain_app` user; idempotent
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8123/ping"]
      interval: 5s
      timeout: 5s
      retries: 12

volumes:
  brain-chdata-dev:
```

> **Version-pin note.** `24.8-alpine` is a placeholder for the latest LTS at build time. **Builder: resolve + pin the latest stable LTS tag** (`docker pull clickhouse/clickhouse-server:<TAG>` succeeds + `clickhouse-client --version` matches); do NOT hardcode without verifying.

### 4.2 Bootstrap (idempotent)

`tools/clickhouse-bootstrap.sh`:
```bash
#!/usr/bin/env bash
# Apply CH DDL in order, idempotent. Uses CLICKHOUSE_URL/USER/PASSWORD env.
set -euo pipefail
for f in apps/analytics-service/migrations/clickhouse/0*.sql; do
  echo ">>> $f"
  clickhouse-client --host "${CH_HOST:-localhost}" --port "${CH_PORT:-9000}" \
    --user "${CH_USER:-brain_app}" --password "${CH_PASSWORD:-brain_app_pw}" \
    --database brain \
    --queries-file "$f"
done
```

The script is idempotent because every CH file uses `CREATE TABLE IF NOT EXISTS … ON CLUSTER` (single-node local = no `ON CLUSTER`, but the IF NOT EXISTS handles re-runs).

### 4.3 Gateway placement

Use the existing `pylibs/brain_clickhouse` package (the canonical query-gateway primitive; the `__init__.py` is a stub today). The Python analytics-service imports `brain_clickhouse.gateway.query(sql, workspace_id=…)` which enforces:
- workspace_id is bound as a parameter (no string interpolation),
- the SQL's parsed predicate set includes `workspace_id = :workspace_id` (lint-time, then runtime defensive check),
- adds `FINAL` for fact reads to honor `ReplacingMergeTree` dedup semantics.

The Node side (api-gateway / core-service) needs an analog: `packages/lib-clickhouse-ts` exposing the same contract for TS reads (used only by the read-path move in §6).

---

## 5. Slice-E backfill — recommendation

**Three options:**

| | (a) **Migrate to CH** | (b) **Mirror via CDC** | (c) **Stay in PG locally; new ETL goes to CH** |
|---|---|---|---|
| What | Run a one-shot ETL: PG facts → CH facts; PG keeps only the 90-day hot mirror | Stand up Debezium → MSK → ClickHouse consumer; PG keeps writing, CH gets the stream | Document the slice-E PG facts as "local-dev shortcut"; new connectors write to CH directly |
| Pros | Cleanest end state; matches canon today; the read-path move (§6) becomes a single switch | Future-proof; matches the Phase 2–3 production CDC pattern | Zero migration risk to the runnable app; smallest immediate change |
| Cons | Big lift; the runnable app stops reading PG facts for the duration of the cut; risk of subtle Int64-vs-BIGINT count mismatches | Wildly over-built for local dev (need MSK Serverless + Debezium + a CH consumer locally; Debezium against local PG is fiddly) | Cements two sources of truth; every new connector engineer asks "which one is real?"; the read-path stays wrong |

**Recommendation: (a) migrate to CH.** Reasons:
1. The app is local-dev. No customer is reading from PG facts today. Migration risk is bounded to the local Founder demo.
2. The plan calls for the read-path move (§6) anyway. Option (c) defers the same work + creates a forked codebase.
3. The CH DDL is already designed (§3) and the canonical aggregate tables (`0001`/`0002`) already exist. The hard work is done.
4. Option (b) is the **production** answer (Phase 2–3 per canon). For local dev we don't need Debezium — a one-shot ETL via `clickhouse-client INSERT … SELECT` (over a PG↔CH bridge, see below) is enough.

**Mechanic.** ClickHouse can read directly from Postgres via the `postgresql()` table function — no Debezium needed for one-shot. Per CH:
```sql
INSERT INTO brain.connector_order_facts
SELECT
    workspace_id, vendor, vendor_order_id, order_date, /* … */
    toUInt64(toUnixTimestamp(synced_at) * 1000) AS version,
    now() AS ingested_at
FROM postgresql('host.docker.internal:5432', 'brain_dev', 'connector_order_facts_hot',
                'rls_app', 'rls_app_pw');
```

This runs in seconds for 83K orders and minutes for 346K line items. **No streaming infra needed.** Backfill becomes a single migration file per fact: `tools/migrate-pg-to-ch/01-orders.sql`, `02-line-items.sql`, etc.

> **Caveat.** The `postgresql()` table function ignores RLS on the Postgres side (it connects as `rls_app`, which IS RLS-enforced — but with no `app.workspace_id` context set, the read returns **zero rows**). The migrate script must either (i) connect as the postgres superuser (LOCAL-DEV ONLY — never in prod) or (ii) loop per-workspace setting `app.workspace_id` between selects. Option (i) is fine for local; option (ii) is the right shape for the prod port.

---

## 6. Read-path implications — the real cost

`fact-analytics.ts` is **1283 lines** of `withWorkspace(workspaceId, async (tx: PoolClient) => { SELECT … })` against Postgres. To honor canon, the historical (>90d) reads must go to ClickHouse. The within-90-day reads CAN stay on PG hot mirror (fast, no cross-store join), but new code should prefer the gateway uniformly.

### 6.1 The 3-tier scheme

| Read | Tier 1 (PG hot mirror) | Tier 2 (CH gateway) | Notes |
|---|---|---|---|
| Within 90 days | YES | YES | Either works. Default to PG for webhook reconciliation paths (read-your-writes); CH for analytical scans. |
| Beyond 90 days | NO | YES | CH only. |
| Aggregates (`workspace_daily_metrics`) | NO | YES | CH only. |
| Per-row PII / config | YES | NO | PG only. |

### 6.2 Concrete file plan

Goal: keep `fact-analytics.ts` callers unchanged; route them through a new abstraction.

1. **Rename `fact-analytics.ts` → `fact-analytics-pg.ts`** (the PG-tier implementation).
2. **New file `apps/analytics-service/src/reads/fact-analytics-ch.ts`** (Python service is the canonical home, but for the local-dev runnable app we need a TS reader). Actually — given the runnable app is a Node monolith today, place the TS reader inside `apps/core-service/src/infrastructure/clickhouse/` as `fact-analytics-ch.ts`, using the official `@clickhouse/client` npm package. When we split per canon (Phase 2), this code moves to `apps/analytics-service/` as Python and the api-gateway calls it over gRPC. The contract (the `Fact*` interfaces) is preserved across the move.
3. **New file `apps/core-service/src/infrastructure/clickhouse/gateway.ts`** — the TS analog of `pylibs/brain_clickhouse`. Single entry point: `chQuery({ workspace_id, sql, params })` that (a) asserts the SQL contains `{workspace_id}` placeholder, (b) substitutes it as a bound parameter, (c) appends `SETTINGS readonly=1` for safety on read paths.
4. **New file `apps/core-service/src/infrastructure/data-plane/fact-router.ts`** — the dispatcher. For each `read*` function, decide tier (PG / CH) based on the date-range of the call. Default: if the call has a `date_from < now() - 90d`, route to CH; else route to PG hot mirror. Eventually all calls move to CH; the router lets us cut over function-by-function.
5. **Per-function migration order** (smallest blast radius first):
   - `readDailyNetSales`, `readPnl`, `readMarketing`, `readShipmentAnalytics` → CH first (these are pure aggregations; the natural CH access pattern).
   - `readStoreSummary`, `readProductPerformance`, `readDistributions` → CH second (per-SKU rollups).
   - `readCohorts`, `readLtv`, `readLifecycleStates` → CH third (heavier; will benefit most from CH's columnar engine).
   - `readWorkspaceMembers`, `readWorkspaceSettings`, `readIntegrations`, `readCogs` → **stay PG** (identity/config — these are OLTP by design).

### 6.3 The non-trivial parts

- **`bigint` vs `Int64`.** PG returns `bigint` as JS `BigInt`; the `@clickhouse/client` returns `Int64` as JS `BigInt` (configurable). The `Fact*` interfaces already use `bigint` — no change needed at the call site.
- **`FINAL` on every fact read.** The gateway appends `SETTINGS final=1` (or the read uses the `… FINAL` syntax) so `ReplacingMergeTree` dedup is honored. Performance cost on local dev (83K rows) = negligible; in prod the analytics-service uses MV's that have already dedup'd.
- **Cross-store JOINs.** Some `fact-analytics.ts` functions JOIN facts to `workspace_costs` (PG config). In CH, do the fact SELECT first, then a small in-memory PG SELECT for the config rows, then merge in TS. **Never** cross-store JOIN at the database layer. This is a real refactor cost (~30 lines per function); documented as part of each function's migration.
- **Tests.** Every migrated `read*` function gets a **dual-source equality test**: run against PG hot mirror + against CH, assert identical output for a known fixture workspace. Built into `apps/core-service/test/integration/fact-analytics.parity.test.ts`.

### 6.4 Cost estimate of the read-path move

Rough sizing — based on 1283 lines, ~25 `read*` functions, ~30 lines refactor avg:
- ~750 LOC change in PG-side (rename + minor cleanup).
- ~1000 LOC new in CH-side (gateway + per-function CH SQL).
- ~500 LOC tests (parity + isolation).
- ~3–5 days of build work behind a feature flag; cut over function-by-function.

---

## 7. What of Phase 1 to roll back

Phase 1 applied 16 SQL files. We **do NOT roll back the OLTP-correct tables** — that would lose real work. We **DO drop and re-create in CH** the OLAP-belonging tables.

### 7.1 STAYS (correctly PG — no change)
- `01-…` / `02-…` onboarding (`users`, `workspaces`, `workspace_members`, `invitations`).
- `03-…` / `04-…` `connector_connections`.
- `07-…` / `08-…` `customer_pii`.
- `16-…` / `17-…` workspace config (cogs/costs/misc/goals/festivals/classifications).
- `18-…` / `19-…` app data (notifications/ai_insights/marketing_actions/audit_log).
- `20-…` workspaces additive columns.

### 7.2 DROPS from PG + RECREATE in CH

| File | PG table to DROP | CH replacement (§3) |
|---|---|---|
| `10-schema-variants-and-extensions.sql` (the variant_facts table) | `connector_variant_facts` | `brain.connector_variant_facts` (C4) |
| `12-schema-email-and-ad-detail.sql` | `connector_email_send_facts`, `connector_ad_creative_facts`, `connector_ad_funnel_facts` | `brain.connector_email_send_facts` (C11), `brain.connector_ad_creative_facts` (C6), `brain.connector_ad_funnel_facts` (C7) |
| `14-schema-logistics-order.sql` | `connector_logistics_order_facts` | `brain.connector_logistics_order_facts` (C10) |
| `21-schema-legacy-aggregates.sql` | `legacy_aggregates.workspace_daily_metrics`, `legacy_aggregates.shopify_analytics_daily`, `legacy_aggregates.product_daily_aggregates` | `brain.workspace_daily_metrics_legacy` (C16), `brain.shopify_analytics_daily` (C14), `brain.product_daily_aggregates` (C15) |

Explicit `DROP TABLE` list (Postgres-side, in a single rollback migration `apps/core-service/migrations/local-dev/23-rollback-olap-tables.sql`):

```sql
BEGIN;
-- §7.2 rollback: these tables were created in Phase 1 by mistake (OLAP belongs in CH).
DROP TABLE IF EXISTS legacy_aggregates.product_daily_aggregates CASCADE;
DROP TABLE IF EXISTS legacy_aggregates.shopify_analytics_daily CASCADE;
DROP TABLE IF EXISTS legacy_aggregates.workspace_daily_metrics CASCADE;
DROP SCHEMA IF EXISTS legacy_aggregates;

DROP TABLE IF EXISTS connector_logistics_order_facts CASCADE;
DROP TABLE IF EXISTS connector_ad_funnel_facts CASCADE;
DROP TABLE IF EXISTS connector_ad_creative_facts CASCADE;
DROP TABLE IF EXISTS connector_email_send_facts CASCADE;
DROP TABLE IF EXISTS connector_variant_facts CASCADE;
COMMIT;
```

The enum extensions from `09-extend-connector-vendor-enum.sql` STAY (enums don't hurt; they're now mirrored as `LowCardinality(String)` values in CH).

### 7.3 RENAMES (slice-E facts that become the 90-day hot mirror)

```sql
ALTER TABLE connector_order_facts        RENAME TO connector_order_facts_hot;
ALTER TABLE connector_line_item_facts    RENAME TO connector_line_item_facts_hot;
```

Other slice-E PG facts (`connector_product_facts`, `connector_ad_spend_facts`, `connector_shipment_facts`, `connector_refund_facts`) — **drop after CH backfill verifies parity**. These are not part of the webhook hot-path; they don't need a 90d mirror.

---

## 8. Phase plan v2

### Phase 0 — Pre-flight (no changes)
- Snapshot current `brain_dev` + ensure `pre-phase-0.sql` exists (v1 already did this).
- Verify Phase 2 ETL `tools/migrate-legacy/phase2-foundations.sql` is still UNAPPLIED.

### Phase 1' — OLTP rollback of misplaced tables
Apply `23-rollback-olap-tables.sql` (§7.2). Apply renames (§7.3 — orders + line items only). RLS rides along via the rename.

**Gate (Founder):** confirm only the 6 PG-misplaced tables are gone; the 13 correctly-PG tables remain; renames succeeded; RLS still FORCEd on the renamed tables.

### Phase 2 — Foundations (OLTP) — UNCHANGED from v1
Apply `tools/migrate-legacy/phase2-foundations.sql` AS-IS. The Phase 2 ETL loads users/workspaces/members/invitations into Postgres — **legitimately OLTP**. **YES this is OK to run as-is.**

**Gate:** 13 workspaces + users + members + invitations visible in PG under `rls_app`.

### Phase 3 — Local ClickHouse provisioning
- Add `apps/analytics-service/docker-compose.dev.yml` (§4.1).
- Add bootstrap script (§4.2).
- Apply CH DDL files: `0001_…sql`, `0002_…sql` (existing), `0003_…sql` … `0014_…sql` (new from §3).

**Gate:** `clickhouse-client -q "SHOW TABLES FROM brain"` returns the 14 fact + aggregate tables; gateway smoke-test query (with workspace_id) returns 0 rows (empty); gateway rejects a no-workspace-id query.

### Phase 4 — Workspace config (OLTP) — UNCHANGED from v1
The 5 config tables (cogs/costs/misc/goals/festivals/classifications) — load all 13 workspaces' rows. PG only.

**Gate:** spot-check a known workspace's costs via the UI.

### Phase 5 — Customer PII (OLTP) — UNCHANGED from v1
PG, AES-GCM, Node script. Unchanged.

### Phase 6 — Slice-E facts: PG → CH backfill (the big move)
- For each existing PG fact (`connector_order_facts_hot` 83K, `connector_line_item_facts_hot` 346K, `connector_product_facts` 957, `connector_ad_spend_facts` 10K, `connector_shipment_facts` 2.5K, `connector_refund_facts` 1.4K):
  - Run `INSERT INTO brain.<table> SELECT … FROM postgresql(…)` from the ETL script (`tools/migrate-pg-to-ch/`).
  - Verify row count + SUM(money_mu) equality between PG and CH (assertion script per table).
- Apply nightly purge job for `connector_order_facts_hot` + `connector_line_item_facts_hot`.
- Drop the 4 non-hot slice-E PG facts (product/ad_spend/shipment/refund) after CH verification.

**Gate:** per-table row+sum parity report; Founder sign-off.

### Phase 7 — Legacy aggregates → CH (D20, transitional)
Load `legacy_src.workspace_daily_metrics` (122) → `brain.workspace_daily_metrics_legacy` via the `postgresql()` table function (cross-DB; FDW + CH on the same network).

Same for `shopify_analytics_daily` (2,728) and `product_daily_aggregates` (71,562).

### Phase 8 — Read-path move (§6)
Behind a feature flag `READ_FROM_CH=true`. Function-by-function migration with parity tests. Default OFF until parity proven on all 25 functions.

**Gate (Founder):** parity report green for all migrated functions → enable flag in dev. Production cutover is a separate EOS run.

### Phase 9 — Late connectors (Klaviyo / Unicommerce / WooCommerce) write directly to CH
Schemas already exist (Phase 3). When the ACL is written, it writes to CH facts, not PG.

### Phase 10 — Cleanup
- Drop the PG `legacy_aggregates` schema (already dropped in Phase 1').
- Archive migrate scripts under `tools/migrate-legacy/runs/v2-<date>/`.

---

## 9. Rollback / risks

### Rollback story
- Phase 1' is reversible: `pg_restore` the pre-phase-0 snapshot.
- Phase 3 (CH provisioning) is reversible: `docker compose down -v` wipes the CH volume; the PG side is untouched.
- Phase 6 (PG → CH backfill) is reversible: CH tables `DROP TABLE`; the PG hot-mirror still has the 83K + 346K rows (we never deleted them).
- Phase 8 (read-path move) is reversible: the feature flag flips back to `READ_FROM_CH=false` and the PG reader path takes over (we kept it).

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | CH `postgresql()` table function fails for a complex column (BYTEA, jsonb) | Med | Med | The slice-E facts don't have BYTEA columns (those are in `customer_pii`, which stays in PG). Test once on `connector_order_facts_hot`; fall back to a Node-side row pump if it fails. |
| R2 | `Int64` overflow on a money sum-aggregation | Low | High | Same as v1 — assert post-load SUM equality between PG `BIGINT` and CH `Int64`. Both are 64-bit signed, no overflow risk in practice. |
| R3 | Read-path parity test fails on one function (CH ≠ PG for a known fixture) | High | Low (we have the flag) | Expected. Each function migration is a separate PR with its own parity report. Discrepancies are explained or fixed before enabling the flag for that function. |
| R4 | `LowCardinality(String)` vendor column accidentally accepts a typo (`SHOPFY`) — CH doesn't enforce enum constraints | Med | Low | Gateway-side allowlist: the gateway lints the SQL parameters against `enum connector_vendor`. PG ACL writes via the gateway, same check. |
| R5 | `FINAL` performance on CH reads during local dev | Low | Low | 83K rows → `FINAL` adds milliseconds. Not a concern. Production uses `OPTIMIZE FINAL` nightly + MV's that pre-aggregate. |
| R6 | Hot-mirror 90-day purge job deletes rows that webhook reconciliation needed | Low | Med | Purge runs at 03:00 local; webhook reconciliation jobs run during business hours; window is wide. Document in the purge script header. |
| R7 | The runnable app breaks during Phase 6 (the cutover window) | Med | High | Read-path stays on PG until Phase 8. Phase 6 only **adds** data to CH; nothing reads from CH until Phase 8 flips the flag. The app never breaks. |
| R8 | Builder pins a wrong CH version (e.g. EOL `clickhouse-server:22.x`) | Med | Med | Phase 3 task explicitly says "resolve + pin latest stable LTS"; not "use 24.8" verbatim. |

---

## 10. Open questions for Founder

| # | Question | Why it matters | My recommendation |
|---|---|---|---|
| Q1 | **Slice-E backfill — confirm (a) migrate to CH, not (b) CDC mirror or (c) stay-PG-shortcut?** | The single biggest cost in the plan. | (a) Migrate. Reasoning in §5. |
| Q2 | **Read-path — confirm the function-by-function cutover behind `READ_FROM_CH` flag, with PG fallback kept** vs a big-bang switch? | Affects how long Phase 8 takes (~5d gradual vs 1d risky). | Gradual + flag. The parity tests are the value; rushing past them re-creates the v1 mistake. |
| Q3 | **The 4 RLS-correct PG fact tables (product / ad_spend / shipment / refund) — drop after CH parity, or keep indefinitely?** | If we keep them, three writers (live sync, ETL, CH) must stay in sync. | Drop after parity. CH is authoritative beyond 90d; hot mirror is justified only for orders + line items (webhook reconciliation). |
| Q4 | **`connector_logistics_order_facts` — Phase 1 already created the PG table; v2 says drop + recreate in CH. OK?** | Wipes the table (it's empty today — the legacy data hasn't been loaded). | Drop. The table was created empty; no data lost. |
| Q5 | **Local CH version pin** — accept `24.8` placeholder, or do you want me to pin a specific LTS now? | Affects whether Phase 3 starts immediately or after a version-pin task. | Builder resolves at start of Phase 3. The plan is store-shape-correct regardless of CH minor version. |
| Q6 | **Gateway placement — `pylibs/brain_clickhouse` (Python) + a parallel TS gateway in `packages/lib-clickhouse-ts`, or only the Python one?** | Determines whether the Node monolith reads CH directly (needs the TS gateway) or via the analytics-service over HTTP. | TS gateway for the local-dev monolith (smaller cost than spinning up a Python service locally); when we split per canon Phase 2, the Node side calls the Python analytics-service over gRPC and the TS gateway is deleted. |
| Q7 | **Founder gates — same cadence as v1 (gates at Phase 1', 3, 5, 6, 8) or only at Phase 6 + 8?** | More gates = more friction, fewer = more risk. | Five gates. Phase 6 (the backfill) and Phase 8 (the read-path) are the irreversible ones. |
| Q8 | **Production custody decision for `customer_pii` (CF-C7-CUSTODY-PROOF-1)** — still held? | Doesn't block this plan, but the Phase 5 LOCAL-DEV AES key is the same v1 used. | Held — this plan doesn't unblock it. |

---

## 11. Persona stress-test v2

**P-001 — Data correctness.** Money path is unchanged: legacy `Decimal(12,2) → ETL × subunit_multiplier(currency) → BIGINT(PG) / Int64(CH)`. The new PG↔CH boundary preserves the integer all the way through. Post-Phase-6 assertion: per workspace + per table, `SUM(money_mu)` is identical in PG hot mirror and CH. Aggregate parity: the transitional `workspace_daily_metrics_legacy` in CH carries the legacy numbers; the canonical `workspace_daily_metrics_base` is recomputed by the metric engine; the parity report is filed. **PASS.**

**P-002 — Idempotency.** PG keeps `ON CONFLICT DO UPDATE`; CH uses `ReplacingMergeTree(version)` with `version = toUnixTimestamp(synced_at) * 1000 + seq`. Re-ingesting the same `(workspace_id, vendor, vendor_*_id, …)` tuple supersedes the prior row at merge time + at read time via `FINAL`. Phase scripts re-runnable. **PASS.**

**P-003 — Tenant isolation.** Postgres tables that remain PG keep the v1 `ws_isolation` FORCE-RLS policy. ClickHouse has no RLS — the **gateway is the enforcement layer 4**. Every CH query asserts a `workspace_id = :workspace_id` predicate; a context-less query is rejected at the gateway. Gateway tests added in Phase 3 (`pylibs/brain_clickhouse/tests/test_gateway_rejects_no_workspace.py` + a TS analog). **PASS** (with the gateway tests as a Phase-3 deliverable; without them this is FAIL).

**P-006 — DPDP.** Facts in CH hold no PII (only `customer_ref` hash + pincode/city, all LowCardinality where bounded). The opt-in `customer_pii` table stays in PG (per Phase 5). Erasure is a PG single-row DELETE; CH facts retain only the hash + non-PII derived fields. The hash is salted per-vendor (R5 from v1). Logs are redacted at `pylibs/brain_logger`; verify CH query logs (`system.query_log`) don't capture parameter values that include PII — they shouldn't (we don't pass PII as CH parameters; only `workspace_id` + `customer_ref` hash + dates). **PASS.**

**P-OLAP — Right store for right access pattern.** Every domain re-checked against §1 principle:
- Identity / config / PII / audit / app-data → PG. (O1-O16). PASS.
- 90-day hot mirror for webhook-reconciled facts → PG. (O17-O18). PASS — explicit justification per row.
- Historical facts + aggregates → CH. (C1-C16). PASS.
- Cross-store JOIN handled in TS (never in DB). PASS.
- Strong consistency: writes to OLTP are read-your-writes; writes to OLAP (analytics) tolerate eventual consistency via `FINAL`. Aligns with use cases. PASS.

**Overall verdict.** v2 honors canon; v1 didn't. The biggest cost is the read-path move (Phase 8), which is real work — but it's the work canon already requires and v1 was deferring. We pay it now while the app is local-dev with no customer data dependency.

---

## 12. What changed vs v1 (one-screen diff)

1. **Store split principle (§1) added.** v1 implicitly said "Postgres for everything in local dev"; v2 says "OLTP/OLAP per canon, no exceptions."
2. **14 CH tables designed (§3).** v1 designed 19 PG fact/aggregate tables; v2 keeps 13 PG (identity/config/PII/audit/app-data + 2 hot-mirror) and creates 14 CH (facts + 3 legacy aggregates + the 2 already-designed canonical aggregates).
3. **Slice-E facts move to CH (§5, §6).** The 83K orders + 346K line items + everything stays in PG as a 90-day hot mirror; CH becomes authoritative beyond 90d. The 4 non-hot slice-E PG facts (product/ad_spend/shipment/refund) drop after parity.
4. **Read-path is the real cost (§6).** `fact-analytics.ts` (1283 LOC) gets re-routed via a CH gateway, function-by-function behind a feature flag, with parity tests.
5. **Phase plan re-ordered (§8).** Phase 1' rolls back the 6 OLAP-misplaced PG tables. Phase 3 stands up local CH. Phase 6 backfills PG → CH. Phase 8 cuts the read path. Phase 2 ETL (`phase2-foundations.sql`) is OK to run as-is — it's legitimately OLTP.

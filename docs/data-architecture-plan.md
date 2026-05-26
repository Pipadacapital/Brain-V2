# Data-architecture plan — full legacy parity into Brain-native local DB
**Author:** Aryan (architect, EOS Stage 2) · **Date:** 2026-05-26 · **Status:** design-only, no schema/code changes yet
**Scope:** local `brain_dev` Postgres (docker, :5432) — the runnable Brain app gets parity with the legacy Supabase prod data (host `db.pavcgecgciamejdcysjx.supabase.co`, region ap-south-1), all 13 workspaces, no data loss, *thoughtful* Brain-native model (not a raw dump).
**Out of scope (explicit):** ClickHouse mirror (designed to land later via CDC — TECH/01 §4), live two-way sync (one-shot migrate + future incremental), production custody (CF-C7-CUSTODY-PROOF-1 still held), the live-Supabase zero-RLS P0.

> **Reading order.** §1 = the PII/vendor decisions (read first). §2 = per-domain inventory. §3 = concrete CREATE TABLE outlines. §4 = vendor abstraction. §5 = ETL phasing (this is the implementation script). §6 = reversibility/risks. §7 = deferrals. §8 = persona stress-test.

---

## 0. Anchors (the locked Brain canon this plan honors)

| Rule | Where | How this plan honors it |
|---|---|---|
| Money = integer minor units (BIGINT paise) | TECH/01 §6, `connector-pipeline-gaps.md` | Every new money column is `BIGINT` *_mu suffix; conversion happens once in the ETL (`numeric * subunit_multiplier(currency)::bigint`), never at read. No `NUMERIC`/float on the fact path. |
| DPDP minimization | TECH/16 §4.1 | Facts store `customer_ref` (sha256 of vendor customer id) + pincode/city only. Email/phone/name go into an OPT-IN `customer_pii` dim, not the facts. No card/CVV/Aadhaar anywhere. PII can be erased without touching facts. |
| FORCE RLS, workspace_id-leading, fail-closed | Child-1 CF-C1-RLS-DEFAULT-1.a, `02-enable-rls-onboarding.sql` | Every new workspace-scoped table gets the SAME `ws_isolation` policy: `(workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)` + `ENABLE` + `FORCE` RLS + no `OR ... IS NULL`/`COALESCE`/`USING (true)`. |
| Single-Primitive Rule | architect skill | One fact table per *kind* of fact (orders, line-items, shipments, refunds, ad-spend, **variants**, **email-send**, **funnel-stage**, **creative**). Vendor = a column (enum), NEVER a fork. |
| RegionAdapter | TECH/04 | All region-varying logic (currency subunit-multiplier, GST slab default, pincode shape, fiscal year) stays in the adapter — schemas carry the raw `currency_code` and `delivery_pincode` strings, no India-specific column names. |
| Reversibility | architect skill | Every phase has a `down.sql`; every truncate-and-reload phase is idempotent. |
| `connector_*_facts` template | slice E `05-schema-connector-facts.sql` | New facts MIRROR the existing shape: `id UUID PK`, `workspace_id UUID FK`, `vendor connector_vendor`, `(workspace_id, vendor, vendor_*_id)` UNIQUE, `synced_at` default `now()`, FORCE RLS. Extend — don't fork. |

---

## 1. The two binding decisions (read before §2)

### 1.1 PII policy — recommended: **minimization + opt-in PII dim**

Two viable options:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Pure canon minimization** (drop legacy PII at the ETL boundary; facts hold only `customer_ref` hash + pincode/city). | Cleanest DPDP posture; zero PII in DB; matches TECH/16 §4.1. | Loses legacy email/name on 110K customers. Brand operator pages that *display* customer email (Orders page; Customer drilldown) lose that field. RTO outreach (legacy capability) becomes impossible without re-fetch. | Insufficient for product parity. |
| **B. Minimization + opt-in PII dim (RECOMMENDED).** Facts stay minimized (canon). A separate `customer_pii` dimension table holds email/phone/full_name, RLS-scoped, **enrichment-only**, with `consent_status` + `withdrawn_at`. Erasure tombs the dim row; facts survive. | Preserves legacy PII at parity; aggregation paths use facts only; erasure is a single-row DELETE; the *dimension* is the obvious revoke point. Future Consent-Manager hook (TECH/16 §3) attaches here. | More schema. One more table to RLS. PII is in the DB (must encrypt at rest + Fluent-Bit redact in logs). | **RECOMMENDED — adopt.** |

**Decision (binding):** Option B. The `customer_pii` dim is **separate** from `connector_*_facts` so:
- Facts NEVER FK to PII (a fact has `customer_ref` not `customer_pii_id`). Erasure breaks no analytics.
- The PII dim is keyed `(workspace_id, customer_ref)` — same join key the facts already carry.
- `consent_status` defaults to `unknown` on legacy backfill (legacy never captured per-channel consent). Outbound (lifecycle-service) treats `unknown` as `not-opted-in` per TECH/16 §3 — so we don't accidentally turn this into a marketing list.
- Logs/OpenSearch redact `email|phone|full_name` (already done at `pylibs/brain_logger`; verify on this table too).

### 1.2 Vendor abstraction — extend `connector_vendor`, no fork

Legacy has separate tables per vendor (`shopify_*`, `woocommerce_*`, `meta_ads_*`, `google_ads_*`, `shiprocket_*`, `unicommerce_*`, `klaviyo_*`). The Brain canon already collapsed this to one fact + vendor column. This plan **extends** that.

**New `connector_vendor` enum values to add:** `WOOCOMMERCE`, `UNICOMMERCE`, `KLAVIYO`.
Final enum: `SHOPIFY | META | GOOGLE | SHIPROCKET | WOOCOMMERCE | UNICOMMERCE | KLAVIYO`.

**Proto/canon impact** (call-out, deferred to a separate EOS run when we leave local):
- `apps/api-gateway` and `packages/proto-ts` carry an enum mirror — when we promote past local, the proto enum gets the same three values.
- TECH/02 (Integrations) and TECH/00 trigger ladder are unaffected (still smallest footprint until each vendor crosses its own trigger).
- The `store_platform` enum (`SHOPIFY | WOOCOMMERCE`) on `workspaces` is a *different* concern (it answers "what storefront does this brand sell on") and stays separate. Unicommerce (OMS) and Klaviyo (email) are NOT storefronts; they don't go on `store_platform`.

**One-fact-N-vendors decisions** (which existing fact extends vs which new fact is justified):

| Domain | Existing fact extends? | New fact justified? | Why |
|---|---|---|---|
| WooCommerce orders | YES → `connector_order_facts` (`vendor = WOOCOMMERCE`) | — | Same shape: order header + revenue ladder. |
| WooCommerce line items | YES → `connector_line_item_facts` | — | Same shape. |
| WooCommerce products | YES → `connector_product_facts` | — | Same shape (cost_mu via `coq` legacy column — same as Shopify). |
| Unicommerce products (OMS catalog/inventory) | YES → `connector_product_facts` (`vendor = UNICOMMERCE`) — vendor_product_id = `sku_code` | — | Unicommerce is a catalog/inventory source, not a sales source. Folds into product fact. |
| Shopify variants | NO — separate fact (`connector_variant_facts`) | YES | A variant is a child of product (per-SKU price/inventory). Shape doesn't fit `connector_product_facts` (1:N). Cited in `connector-pipeline-gaps.md` P0-2. |
| Shiprocket orders | NO — separate fact (`connector_logistics_order_facts`) | YES (minimal) | Shiprocket order ≠ Shopify order (it's the shipping-platform's own order ledger). Most fields don't overlap with `connector_order_facts`. Will be small (1,346 rows). Worth it for the `channel_order_id ↔ Shopify order_name` link the metric engine needs (the gating decision from `connector-pipeline-gaps.md` P0-1). |
| Meta creative-day, Google funnel-day | NO — separate fact (`connector_ad_creative_facts`, `connector_ad_funnel_facts`) | YES | `connector_ad_spend_facts` is campaign-day only. Creative-day (per-ad-id) and funnel-day (per-stage) are 10x granularity. A single mega-table with all NULLs would be wasteful + lose the per-grain UNIQUE key. Two thin sibling tables. |
| Refund line items | YES → `connector_refund_facts` (already exists from `03b_accommodate.sql`) | — | Already in place; this plan promotes it from accommodation to canonical and adds `vendor_product_id` link. |
| Klaviyo email performance | NO — separate fact (`connector_email_send_facts`) | YES | Email send-day ≠ order/ad/shipment. Single primitive for "lifecycle/email performance". When Klaviyo grows to a full lifecycle vendor, this fact already exists. |
| Shopify analytics-daily, product-daily, workspace-daily-metrics | NO — separate **aggregates** schema | YES | These are DERIVED rollups, not raw facts. Brain-native should compute them from the facts (per TECH/01 §3 "derived aggregate tables"). But for **parity at migration time**, we land the legacy values into `legacy_aggregates.*` (a separate schema, kept read-only) so existing pages keep working until the metric engine catches up. **Phased deprecation** — see §5 phase 6. |

---

## 2. Domain inventory (per missing domain → target)

Format: `[source table(s)] → [Brain-native target] · PII · vendor · RLS · money · unique key`.

| # | Domain | Legacy source | Brain-native target | PII | Vendor | RLS | Money | Unique key |
|---|---|---|---|---|---|---|---|---|
| D1 | All 13 workspaces + members + invitations | `workspaces`, `workspace_members`, `invitations`, `users` (24) | EXISTING `workspaces`, `workspace_members`, `invitations`, `users` (already in `01-schema-onboarding.sql`). **Lift the 3-workspace WHERE filter from `02_migrate.sql`.** Add the missing legacy columns from `workspaces` not yet in Brain-native: `tax_percent`, `timezone`, `features` (jsonb), `logo_url`, `plan` (subscription enum). | None new | — | Existing | — | Existing unique keys |
| D2 | Customer dim (opt-in PII — Decision 1.1B) | `shopify_customers` (110,082) | **NEW** `customer_pii` (workspace_id-scoped) + an enrichment update to fill `customer_ref` lookup. | Email + first/last + tags (encrypted at rest column-level OR rely on cluster-level encryption; default = column-level for `email_ct`, `phone_ct` per TECH/16 §4.2) | — (no vendor enum; the dim is vendor-agnostic, vendor recorded in source_vendor column) | FORCE RLS, ws_isolation | `lifetime_spent_mu BIGINT` | `(workspace_id, customer_ref)` |
| D3 | Variants | `shopify_variants` (4,970) | **NEW** `connector_variant_facts` | None | `vendor` enum | FORCE RLS | `price_mu`, `compare_at_price_mu` BIGINT | `(workspace_id, vendor, vendor_variant_id)` |
| D4a | WooCommerce orders | `woocommerce_orders` (1,807) | EXISTING `connector_order_facts` (`vendor=WOOCOMMERCE`) | `customer_email/phone` dropped at ACL (goes into `customer_pii`); facts keep `customer_ref` only | extends enum | existing | existing money cols + new `shipping_mu` already present | existing `(workspace_id, vendor, vendor_order_id)` |
| D4b | WooCommerce line items | `woocommerce_line_items` (3,375) | EXISTING `connector_line_item_facts` | None | extends enum | existing | existing | existing |
| D4c | WooCommerce products | `woocommerce_products` (7) | EXISTING `connector_product_facts` (with `cost_mu`) | None | extends enum | existing | `cost_mu` from `coq` | existing |
| D5 | Unicommerce catalog | `unicommerce_products` (sparse) | EXISTING `connector_product_facts` (vendor=UNICOMMERCE, `vendor_product_id = sku_code`) + a new optional `inventory_qty INT` column on the fact | None | extends enum | existing | `mrp_mu` BIGINT (new column) | existing |
| D6 | Klaviyo email performance | `email_performance` (legacy) + `klaviyo_connections` | **NEW** `connector_email_send_facts` | None (send-day aggregates, no per-recipient PII) | `vendor=KLAVIYO` | FORCE RLS | `revenue_mu` BIGINT | `(workspace_id, vendor, source_type, klaviyo_resource_id, send_date)` |
| D7a | Meta ad creative-day | `meta_ads_creative_daily` (46,171) | **NEW** `connector_ad_creative_facts` | None | `vendor=META` (future GOOGLE) | FORCE RLS | `spend_mu`, `revenue_mu` BIGINT | `(workspace_id, vendor, ad_account_id, ad_id, date)` |
| D7b | Google ad funnel-day | `google_ads_funnel_daily` (1,751) | **NEW** `connector_ad_funnel_facts` | None | `vendor=GOOGLE` (future META) | FORCE RLS | `conversion_value_mu` BIGINT | `(workspace_id, vendor, customer_id, campaign_id, date, stage)` |
| D8 | Refund-line detail | `shopify_refund_line_items` (1,373) | EXISTING `connector_refund_facts` (from `03b_accommodate.sql`, **promote to canonical**) — add `vendor_product_id` column | None | `vendor=SHOPIFY` | already FORCE RLS | existing | existing |
| D9 | Shiprocket order layer | `shiprocket_orders` (1,346) | **NEW** `connector_logistics_order_facts` | None (the channel_order_id is the join key — non-PII) | `vendor=SHIPROCKET` | FORCE RLS | `total_mu` BIGINT | `(workspace_id, vendor, vendor_logistics_order_id)` |
| D10 | Workspace config — COGS | `workspace_cogs_settings` (2) | **NEW** `workspace_cogs_settings` (Brain-native) | None | — | FORCE RLS | `override_all_cogs_bp INT` (basis points, 0..10000) | `workspace_id` PK |
| D11 | Workspace config — fixed costs | `workspace_costs` (5) | **NEW** `workspace_costs` | None | — | FORCE RLS | `amount_mu BIGINT` | `(workspace_id, cost_type, effective_from)` |
| D12 | Workspace config — misc expenses | `workspace_misc_expenses` (2) | **NEW** `workspace_misc_expenses` | None | — | FORCE RLS | `amount_mu BIGINT` | `(workspace_id, name, effective_start_date)` |
| D13 | Workspace config — goals | `workspace_metric_goals` (2) | **NEW** `workspace_metric_goals` | None | — | FORCE RLS | `goal_value_mu BIGINT` (where metric is monetary; for non-monetary metrics like `roas`, use `goal_value_bp INT` basis points). Discriminator: `goal_unit ENUM('mu', 'bp', 'count')`. | `(workspace_id, metric_name, period_type, period_start)` |
| D14 | Workspace config — festivals | `workspace_festivals` (570) | **NEW** `workspace_festivals` | None | — | FORCE RLS | `expected_multiplier_bp INT` (basis points, e.g. 1.5x = 15000) | `(workspace_id, name, start_date)` |
| D15 | Workspace config — campaign classification | `workspace_ad_campaign_classifications` (3) | **NEW** `workspace_ad_campaign_classifications` | None | — | FORCE RLS | n/a | `(workspace_id, platform, campaign_id)` |
| D16 | App data — notifications | `notifications` (85) | **NEW** `notifications` | None (title/body are system-generated, never customer PII) | — | FORCE RLS (workspace_id nullable for user-only) → use a `ws_or_user` policy variant (see §3.10) | n/a | `id` |
| D17 | App data — ai_insights | `ai_insights` (6) | **NEW** `ai_insights` (matches TECH/01 `ai.insights`) | None | — | FORCE RLS | `tokens_used INT` (already int) | `id` |
| D18 | App data — marketing actions | `marketing_actions` (6) | **NEW** `marketing_actions` | None | — | FORCE RLS | n/a | `id` |
| D19 | App data — audit log | `audit_logs` (empty in legacy prod, but schema exists) | **NEW** `audit_log` (PII-free) | None | — | FORCE RLS | n/a | `id` |
| D20 | Daily aggregates (legacy-format, transitional) | `workspace_daily_metrics` (122), `shopify_analytics_daily` (2,728), `product_daily_aggregates` (71,562) | **NEW** schema `legacy_aggregates.*` — read-only mirror, isolated namespace. **Marked transitional in §5 phase 6.** | None | — | FORCE RLS | All money in `*_mu BIGINT` | per-table |

---

## 3. Schema design — concrete CREATE TABLE outlines

> All tables go in `apps/core-service/migrations/local-dev/` as new files `07-…` → `15-…` (numbering keeps slice E's 05/06 stable). Apply order at the end of §3. All grant DML to `rls_app`. RLS is enabled via a companion `XX-enable-rls-….sql` file that always carries:
>
> ```sql
> ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
> DROP POLICY IF EXISTS ws_isolation ON <t>;
> CREATE POLICY ws_isolation ON <t>
>   USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
>   WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
> ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
> ```

### 3.0 Enum extensions (must run in own statement before use — see `03a_enum_fdw.sql` precedent)

```sql
ALTER TYPE connector_vendor ADD VALUE IF NOT EXISTS 'WOOCOMMERCE';
ALTER TYPE connector_vendor ADD VALUE IF NOT EXISTS 'UNICOMMERCE';
ALTER TYPE connector_vendor ADD VALUE IF NOT EXISTS 'KLAVIYO';
-- SHIPROCKET already added in 03a_enum_fdw.sql (promote that migration into local-dev/).

-- Two new enums for the app-data domain:
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'WORKSPACE_INVITE','INVITE_ACCEPTED','MEMBER_JOINED','MEMBER_REMOVED','ROLE_CHANGED',
    'CONNECTOR_CONNECTED','CONNECTOR_DISCONNECTED','SYNC_COMPLETED','SYNC_FAILED','SYSTEM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE workspace_cost_type AS ENUM ('SHIPPING','PACKAGING','WEBSITE','CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE workspace_cost_billing_mode AS ENUM ('MONTHLY','PER_ORDER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE goal_period_type AS ENUM ('DAILY','WEEKLY','MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE goal_value_type AS ENUM ('MINIMUM','MAXIMUM','TARGET');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE goal_unit AS ENUM ('mu','bp','count');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE customer_consent_status AS ENUM ('unknown','opted_in','opted_out','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_plan AS ENUM ('FREE','STARTER','GROWTH','ENTERPRISE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### 3.1 Customer PII dim (D2) — the only PII home

```sql
CREATE TABLE IF NOT EXISTS customer_pii (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_ref      TEXT NOT NULL,               -- sha256(vendor customer id), the SAME join key the facts use
  source_vendor     connector_vendor NOT NULL,   -- which connector first observed this customer
  vendor_customer_id TEXT NOT NULL,              -- raw vendor id (e.g. Shopify customer.shopifyId)

  -- PII (encrypted at rest at the column level — _ct = ciphertext bytea, AES-256-GCM via
  -- the same custody pattern as connector_credentials.credential_enc). NEVER plaintext.
  email_ct          BYTEA,
  phone_ct          BYTEA,
  full_name_ct      BYTEA,

  -- Non-PII derived (safe to read everywhere — facts can reuse without consent gate)
  first_seen_at     TIMESTAMPTZ,
  last_seen_at      TIMESTAMPTZ,
  orders_count      INT NOT NULL DEFAULT 0,
  lifetime_spent_mu BIGINT NOT NULL DEFAULT 0,
  currency_code     TEXT,
  tags              TEXT[] NOT NULL DEFAULT '{}',

  -- Consent (per TECH/16 §3 — opt-in default OFF). Per-channel state is too granular for
  -- now; one row = one customer × one consent verdict. When we wire the consent primitive
  -- (lifecycle.consent_event) we'll back-fill from there. Legacy backfill = 'unknown'.
  consent_status    customer_consent_status NOT NULL DEFAULT 'unknown',
  consent_recorded_at TIMESTAMPTZ,
  withdrawn_at      TIMESTAMPTZ,

  -- Erasure tombstone — keep the row but zero the PII columns + set tombstoned_at.
  tombstoned_at     TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, customer_ref),
  UNIQUE (workspace_id, source_vendor, vendor_customer_id)
);
CREATE INDEX customer_pii_workspace_idx ON customer_pii (workspace_id, last_seen_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_pii TO rls_app;
```

**PII encryption note.** `email_ct`, `phone_ct`, `full_name_ct` are AES-256-GCM `(iv(12) || authTag(16) || ciphertext)` blobs — same shape as `connector_credentials.credential_enc`. Decrypt happens in the app via the existing `local-aesgcm-custody.ts` backing. For the local one-shot migrate, the key can be the same dev key used for OAuth tokens (LOCAL ONLY — production custody is a separate decision, CF-C7-CUSTODY-PROOF-1). **In logs, never decrypt — log only `email_hash` (FixedString-64-equivalent) per TECH/16 §4.2.**

### 3.2 Variants (D3)

```sql
CREATE TABLE IF NOT EXISTS connector_variant_facts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor             connector_vendor NOT NULL,
  vendor_variant_id  TEXT NOT NULL,
  vendor_product_id  TEXT NOT NULL,                 -- FK-by-business-key to connector_product_facts.vendor_product_id
  sku                TEXT,
  title              TEXT,
  price_mu           BIGINT,
  compare_at_price_mu BIGINT,
  inventory_qty      INT,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, vendor_variant_id)
);
CREATE INDEX connector_variant_facts_product_idx
  ON connector_variant_facts (workspace_id, vendor, vendor_product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_variant_facts TO rls_app;
```

### 3.3 `connector_product_facts` — additive columns

```sql
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS mrp_mu      BIGINT;
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS inventory_qty INT;
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS handle      TEXT;
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS image_url   TEXT;
ALTER TABLE connector_product_facts ADD COLUMN IF NOT EXISTS tags        TEXT[] NOT NULL DEFAULT '{}';
-- cost_mu already exists (from 03b_accommodate.sql — promote that ALTER into local-dev/)
```

### 3.4 `connector_order_facts` — additive columns (for WooCommerce parity)

```sql
ALTER TABLE connector_order_facts ADD COLUMN IF NOT EXISTS billing_pincode TEXT;
ALTER TABLE connector_order_facts ADD COLUMN IF NOT EXISTS is_cod          BOOLEAN;       -- denormalized from payment_method for fast filtering
ALTER TABLE connector_order_facts ADD COLUMN IF NOT EXISTS order_type      TEXT;          -- WooCommerce order_type meta
ALTER TABLE connector_order_facts ADD COLUMN IF NOT EXISTS total_refund_mu BIGINT NOT NULL DEFAULT 0;  -- WooCommerce ladder (Shopify uses connector_refund_facts)
```

### 3.5 Email/lifecycle (D6)

```sql
CREATE TABLE IF NOT EXISTS connector_email_send_facts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor                connector_vendor NOT NULL,           -- KLAVIYO (future: MAILCHIMP etc.)
  source_type           TEXT NOT NULL,                        -- 'campaign' | 'flow'
  vendor_resource_id    TEXT NOT NULL,                        -- klaviyo campaign/flow id
  name                  TEXT NOT NULL,
  channel               TEXT NOT NULL,                        -- 'email' | 'sms' (Klaviyo SMS later)
  send_date             DATE NOT NULL,
  delivered             INT NOT NULL DEFAULT 0,
  unique_opens          INT NOT NULL DEFAULT 0,
  unique_clicks         INT NOT NULL DEFAULT 0,
  orders                INT NOT NULL DEFAULT 0,
  revenue_mu            BIGINT NOT NULL DEFAULT 0,
  currency_code         TEXT,
  unsubscribes          INT NOT NULL DEFAULT 0,
  spam_complaints       INT NOT NULL DEFAULT 0,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, source_type, vendor_resource_id, send_date)
);
CREATE INDEX connector_email_send_facts_ws_date_idx
  ON connector_email_send_facts (workspace_id, send_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_email_send_facts TO rls_app;
```

### 3.6 Ad creative + funnel (D7a, D7b)

```sql
CREATE TABLE IF NOT EXISTS connector_ad_creative_facts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor          connector_vendor NOT NULL,         -- META (future GOOGLE)
  ad_account_id   TEXT NOT NULL,
  ad_id           TEXT NOT NULL,
  ad_name         TEXT,
  campaign_id     TEXT,
  campaign_name   TEXT,
  adset_id        TEXT,
  adset_name      TEXT,
  date            DATE NOT NULL,
  impressions     BIGINT NOT NULL DEFAULT 0,
  clicks          BIGINT NOT NULL DEFAULT 0,
  spend_mu        BIGINT NOT NULL DEFAULT 0,
  video_3s_views  INT,
  video_thruplay  INT NOT NULL DEFAULT 0,
  avg_watch_sec_x100 INT NOT NULL DEFAULT 0,         -- store as int (seconds × 100) to avoid float
  video_p25       INT NOT NULL DEFAULT 0,
  video_p50       INT NOT NULL DEFAULT 0,
  video_p75       INT NOT NULL DEFAULT 0,
  video_p95       INT NOT NULL DEFAULT 0,
  conversions     INT NOT NULL DEFAULT 0,
  revenue_mu      BIGINT NOT NULL DEFAULT 0,
  currency_code   TEXT NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, ad_account_id, ad_id, date)
);
CREATE INDEX connector_ad_creative_facts_ws_date_idx
  ON connector_ad_creative_facts (workspace_id, date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_ad_creative_facts TO rls_app;

CREATE TABLE IF NOT EXISTS connector_ad_funnel_facts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor             connector_vendor NOT NULL,      -- GOOGLE (future META)
  customer_id        TEXT NOT NULL,                   -- google ads customer id (account)
  campaign_id        TEXT NOT NULL,
  date               DATE NOT NULL,
  stage              TEXT NOT NULL,                   -- 'add_to_cart' | 'checkout_initiated' | 'purchase'
  conversions_x1000  BIGINT NOT NULL DEFAULT 0,       -- store decimal × 1000 (Google reports fractional conversions)
  conversion_value_mu BIGINT NOT NULL DEFAULT 0,
  currency_code      TEXT NOT NULL,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, customer_id, campaign_id, date, stage)
);
CREATE INDEX connector_ad_funnel_facts_ws_date_idx
  ON connector_ad_funnel_facts (workspace_id, date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_ad_funnel_facts TO rls_app;
```

### 3.7 Refund-line additive — vendor_product_id

```sql
ALTER TABLE connector_refund_facts ADD COLUMN IF NOT EXISTS vendor_product_id TEXT;
CREATE INDEX IF NOT EXISTS connector_refund_facts_prod_idx
  ON connector_refund_facts (workspace_id, vendor_product_id);
```

### 3.8 Shiprocket order layer (D9)

```sql
CREATE TABLE IF NOT EXISTS connector_logistics_order_facts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor                      connector_vendor NOT NULL,     -- SHIPROCKET
  vendor_logistics_order_id   TEXT NOT NULL,                 -- shiprocket internal order id
  channel_order_id            TEXT,                          -- the join key into connector_order_facts.vendor_order_id
  channel_name                TEXT,
  channel_id                  TEXT,
  status                      TEXT,
  status_code                 INT,
  payment_method              TEXT,
  total_mu                    BIGINT,
  currency_code               TEXT,
  order_date                  TIMESTAMPTZ,
  synced_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, vendor_logistics_order_id)
);
CREATE INDEX connector_logistics_order_facts_chref_idx
  ON connector_logistics_order_facts (workspace_id, channel_order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_logistics_order_facts TO rls_app;
```

### 3.9 Workspace config (D10–D15)

```sql
-- D10 — cogs settings
CREATE TABLE IF NOT EXISTS workspace_cogs_settings (
  workspace_id              UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  override_all_cogs_bp      INT NOT NULL DEFAULT 0,    -- 0..10000 (0..100%)
  fallback_cogs_bp          INT NOT NULL DEFAULT 0,
  cogs_markup_bp            INT NOT NULL DEFAULT 0,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_cogs_settings TO rls_app;

-- D11 — workspace costs (effective-dated)
CREATE TABLE IF NOT EXISTS workspace_costs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cost_type       workspace_cost_type NOT NULL,
  name            TEXT,
  amount_mu       BIGINT NOT NULL,                   -- if is_percent=true, amount_mu is interpreted as bp (rename via CHECK?). We split:
  is_percent      BOOLEAN NOT NULL DEFAULT FALSE,    -- when TRUE, amount_mu IS basis points (0..10000), NOT minor units. The column is reused (legacy did the same).
  currency_code   TEXT,
  billing_mode    workspace_cost_billing_mode NOT NULL DEFAULT 'MONTHLY',
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workspace_costs_ws_idx ON workspace_costs (workspace_id, cost_type, effective_from, effective_to);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_costs TO rls_app;
```

> **Note on `amount_mu` + `is_percent` overload.** This mirrors the legacy "one column, two meanings" trick. Brain canon prefers a discriminator (`amount_unit ENUM('mu','bp')`). For local parity I keep the simpler boolean (one less type to add); the production version (when we leave local) should switch to `amount_unit`. Logged as a deferred follow-up.

```sql
-- D12 — misc expenses
CREATE TABLE IF NOT EXISTS workspace_misc_expenses (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  amount_mu            BIGINT NOT NULL,
  currency_code        TEXT NOT NULL DEFAULT 'INR',
  effective_start_date DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name, effective_start_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_misc_expenses TO rls_app;

-- D13 — metric goals
CREATE TABLE IF NOT EXISTS workspace_metric_goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric_name   TEXT NOT NULL,
  period_type   goal_period_type NOT NULL,
  period_start  DATE NOT NULL,
  goal_value    BIGINT NOT NULL,                 -- interpreted by goal_unit (mu/bp/count). Brain doesn't store Decimal here.
  goal_unit     goal_unit NOT NULL,
  goal_type     goal_value_type NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, metric_name, period_type, period_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_metric_goals TO rls_app;

-- D14 — festivals (570 rows: Indian festival calendar templates + workspace overrides)
CREATE TABLE IF NOT EXISTS workspace_festivals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  start_date               DATE NOT NULL,
  end_date                 DATE NOT NULL,
  color                    TEXT NOT NULL DEFAULT '#F59E0B',
  expected_multiplier_bp   INT NOT NULL DEFAULT 15000,    -- 1.5x = 15000 bp
  regions                  TEXT[] NOT NULL DEFAULT '{}',
  categories               TEXT[] NOT NULL DEFAULT '{}',
  is_template              BOOLEAN NOT NULL DEFAULT FALSE,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name, start_date)
);
CREATE INDEX workspace_festivals_ws_date_idx ON workspace_festivals (workspace_id, start_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_festivals TO rls_app;

-- D15 — campaign classification (which campaign = "acquisition" vs "retargeting")
CREATE TABLE IF NOT EXISTS workspace_ad_campaign_classifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,                            -- 'meta' | 'google'
  campaign_id   TEXT NOT NULL,
  intent        TEXT NOT NULL,                            -- 'acquisition' | 'retargeting' | 'brand'
  campaign_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, campaign_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_ad_campaign_classifications TO rls_app;
```

### 3.10 App data (D16–D19)

```sql
-- D16 — notifications. workspace_id is nullable (system-wide notifications),
-- user_id is required. RLS policy variant accepts either ws-scoped or user-scoped.
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  type          notification_type NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  action_url    TEXT,
  read          BOOLEAN NOT NULL DEFAULT FALSE,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read, created_at DESC);
CREATE INDEX notifications_ws_idx   ON notifications (workspace_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO rls_app;
```

**Notifications RLS.** This one is a special case (workspace_id nullable). Policy:

```sql
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_or_user_isolation ON notifications;
CREATE POLICY ws_or_user_isolation ON notifications
  USING      ((workspace_id IS NOT NULL
               AND workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
              OR
              (workspace_id IS NULL
               AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK ((workspace_id IS NOT NULL
               AND workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
              OR
              (workspace_id IS NULL
               AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
```

> ⚠ **This is the only policy that uses an OR + IS NULL pattern** — normally banned. Justification: a notification is either workspace-scoped OR user-scoped. Both halves carry an `=` predicate (no `IS NULL` as a tenancy-pass-through), so it remains fail-closed (a context-less connection returns 0 rows). The static gate has to whitelist this exact pattern for `notifications` only. Document it as a one-off in the migration header.

```sql
-- D17 — ai_insights (matches TECH/01 ai.insights, simplified for local — no separate `ai` schema, kept in public)
CREATE TABLE IF NOT EXISTS ai_insights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page          TEXT NOT NULL,
  date_from     TIMESTAMPTZ NOT NULL,
  date_to       TIMESTAMPTZ NOT NULL,
  filters_hash  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'done',     -- pending | processing | done | failed
  content       TEXT NOT NULL DEFAULT '',
  provider      TEXT NOT NULL DEFAULT '',
  model         TEXT NOT NULL DEFAULT '',
  tokens_used   INT NOT NULL DEFAULT 0,
  latency_ms    INT NOT NULL DEFAULT 0,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX ai_insights_ws_page_idx ON ai_insights (workspace_id, page, date_from, date_to);
CREATE INDEX ai_insights_expires_idx ON ai_insights (expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_insights TO rls_app;

-- D18 — marketing actions
CREATE TABLE IF NOT EXISTS marketing_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action_date   DATE NOT NULL,
  action_type   TEXT NOT NULL,
  action_name   TEXT NOT NULL,
  notes         TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX marketing_actions_ws_date_idx ON marketing_actions (workspace_id, action_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON marketing_actions TO rls_app;

-- D19 — audit_log (PII-free; legal record; ws_id nullable for system events)
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE SET NULL,   -- NOT cascade (legal record outlives ws)
  user_id       UUID NOT NULL REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  metadata      JSONB,
  ip_hash       TEXT,                                  -- store sha256(ip) not raw ip — PII-free per TECH/16
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_ws_idx ON audit_log (workspace_id, created_at DESC);
CREATE INDEX audit_log_user_idx ON audit_log (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log TO rls_app;
```

**Audit_log RLS.** Same `ws_or_user_isolation` pattern as notifications (since `workspace_id` can be NULL). Document the exception in the migration header.

### 3.11 `workspaces` — additive columns

```sql
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS features         JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo_url         TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan             subscription_plan NOT NULL DEFAULT 'FREE';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS tax_percent_bp   INT NOT NULL DEFAULT 0;           -- legacy stored as Decimal(5,2); migrate as bp (0..10000)
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS timezone         TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS founder_salary_currency TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS founder_salary_monthly_mu BIGINT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS skip_zero_sales_orders BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS skipped_shopify_order_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS product_data_source TEXT NOT NULL DEFAULT 'SHOPIFY';   -- 'SHOPIFY' | 'UNICOMMERCE'
```

### 3.12 Legacy aggregates (D20) — separate namespace, transitional

```sql
CREATE SCHEMA IF NOT EXISTS legacy_aggregates;
GRANT USAGE ON SCHEMA legacy_aggregates TO rls_app;

-- workspace_daily_metrics — 1:1 mirror with money columns as BIGINT mu
CREATE TABLE IF NOT EXISTS legacy_aggregates.workspace_daily_metrics (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  date                     DATE NOT NULL,
  net_sales_mu             BIGINT NOT NULL,
  gross_sales_mu           BIGINT NOT NULL,
  total_tax_mu             BIGINT NOT NULL,
  total_discount_mu        BIGINT NOT NULL,
  orders_count             INT    NOT NULL,
  aov_mu                   BIGINT NOT NULL,
  currency_code            TEXT   NOT NULL,
  cogs_mu                  BIGINT NOT NULL,
  shipping_mu              BIGINT NOT NULL,
  packaging_mu             BIGINT NOT NULL,
  website_charges_mu       BIGINT NOT NULL,
  cm1_mu                   BIGINT NOT NULL,
  meta_ad_spend_mu         BIGINT NOT NULL,
  google_ad_spend_mu       BIGINT NOT NULL,
  total_ad_spend_mu        BIGINT NOT NULL,
  cm2_mu                   BIGINT NOT NULL,
  misc_expenses_prorated_mu BIGINT NOT NULL,
  cm3_mu                   BIGINT NOT NULL,
  acos_bp                  INT,
  blended_roas_x100        INT,                          -- roas × 100 (so 4.50 = 450)
  sessions                 INT,
  conversion_rate_bp       INT,
  rto_orders               INT,
  rto_value_mu             BIGINT,
  rto_percent_bp           INT,
  rto_mapped               INT,
  rto_unmapped             INT,
  total_shipments          INT,
  prepaid_orders_count     INT,
  prepaid_percentage_bp    INT,
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, date)
);
CREATE INDEX wdm_ws_date_idx ON legacy_aggregates.workspace_daily_metrics (workspace_id, date);
GRANT SELECT, INSERT, UPDATE, DELETE ON legacy_aggregates.workspace_daily_metrics TO rls_app;
-- Same FORCE RLS as other workspace-scoped tables.

-- shopify_analytics_daily — keyed by workspace via the shopify connection's workspace_id (not connection id)
CREATE TABLE IF NOT EXISTS legacy_aggregates.shopify_analytics_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shop_domain     TEXT NOT NULL,                       -- denormalized from shopify_connections so the row is self-describing
  date            DATE NOT NULL,
  net_sales_mu    BIGINT NOT NULL,
  gross_sales_mu  BIGINT NOT NULL,
  orders_count    INT NOT NULL,
  aov_mu          BIGINT NOT NULL,
  total_tax_mu    BIGINT NOT NULL,
  total_discount_mu BIGINT NOT NULL,
  currency_code   TEXT NOT NULL,
  conversion_rate_bp INT,
  sessions        INT,
  returns_mu      BIGINT,
  total_returns_mu BIGINT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, shop_domain, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON legacy_aggregates.shopify_analytics_daily TO rls_app;

-- product_daily_aggregates — similar; workspace_id-leading, product key denormalized
CREATE TABLE IF NOT EXISTS legacy_aggregates.product_daily_aggregates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor             connector_vendor NOT NULL,        -- SHOPIFY for the legacy 71K rows
  vendor_product_id  TEXT NOT NULL,
  date               DATE NOT NULL,
  quantity_sold      INT NOT NULL,
  gross_sales_mu     BIGINT NOT NULL,
  orders_count       INT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, vendor_product_id, date)
);
CREATE INDEX pda_ws_date_idx ON legacy_aggregates.product_daily_aggregates (workspace_id, date);
GRANT SELECT, INSERT, UPDATE, DELETE ON legacy_aggregates.product_daily_aggregates TO rls_app;
```

### 3.13 Apply-order summary (the migration files this plan adds)

```
07-schema-customer-pii.sql              + 08-enable-rls-customer-pii.sql
09-extend-connector-vendor-enum.sql     (own session: ADD VALUE)
10-schema-variants-and-extensions.sql   (variant_facts + ALTERs on product/order/refund) + 11-enable-rls-*.sql
12-schema-email-and-ad-detail.sql       (email_send + ad_creative + ad_funnel) + 13-enable-rls-*.sql
14-schema-logistics-order.sql           + 15-enable-rls-logistics.sql
16-schema-workspace-config.sql          (cogs/costs/misc/goals/festivals/classifications) + 17-enable-rls-config.sql
18-schema-app-data.sql                  (notifications/ai_insights/marketing_actions/audit_log) + 19-enable-rls-app-data.sql
20-extend-workspaces.sql                (additive columns on workspaces)
21-schema-legacy-aggregates.sql         + 22-enable-rls-legacy-aggregates.sql
down-*.sql for each
```

---

## 4. Vendor abstraction — Single-Primitive view (summary)

```
                                    ┌───────────────────────────────────────────┐
ORDERS (header + revenue ladder)    │ connector_order_facts                     │  SHOPIFY | WOOCOMMERCE | (future)
LINE ITEMS (per-SKU)                │ connector_line_item_facts                 │  SHOPIFY | WOOCOMMERCE
VARIANTS (per-SKU child of product) │ connector_variant_facts                   │  SHOPIFY | (future)
PRODUCTS (catalog)                  │ connector_product_facts                   │  SHOPIFY | WOOCOMMERCE | UNICOMMERCE
REFUNDS (per-SKU returns ladder)    │ connector_refund_facts                    │  SHOPIFY | WOOCOMMERCE-future
SHIPMENTS (delivery lifecycle)      │ connector_shipment_facts                  │  SHIPROCKET | (future delhivery etc.)
LOGISTICS ORDER (shipping platform) │ connector_logistics_order_facts           │  SHIPROCKET | (future)
AD SPEND (campaign-day)             │ connector_ad_spend_facts                  │  META | GOOGLE
AD CREATIVE (ad-day)                │ connector_ad_creative_facts               │  META | (future GOOGLE)
AD FUNNEL (stage-day)               │ connector_ad_funnel_facts                 │  GOOGLE | (future META)
EMAIL/LIFECYCLE (send-day)          │ connector_email_send_facts                │  KLAVIYO | (future)
                                    └───────────────────────────────────────────┘
```

**Rule re-stated.** When a new vendor lands in an existing domain, **add a value to `connector_vendor`** and write the ACL/normalizer that maps its rows into the existing fact. Do **not** add a new table per vendor. New tables are justified only when the *grain* differs (the variant↔product 1:N; creative-day vs campaign-day; funnel-stage vs campaign-day; send-day vs none of the above).

---

## 5. ETL plan (the implementation script — phased Founder gates)

**Bridge.** Use `postgres_fdw` to project the live Supabase prod DB as `legacy_src.*` in `brain_dev`. The IPv6 direct host is unusable from docker — use the **IPv4 pooler `aws-1-ap-south-1.pooler.supabase.com:5432`** (this is empirically established in `/tmp/brain_mig/`). Credentials live in a one-time-loaded server option, never committed. After each phase, the foreign tables are kept for a re-run; only at the end of all phases do we `DROP SERVER legacy_supa CASCADE` (the irreversible step).

> **Idempotency invariant** (P-002): every `INSERT` is `... ON CONFLICT (<unique key>) DO UPDATE SET ...`. No `TRUNCATE + INSERT` except inside an explicit phase that is itself the unit-of-replay. Every phase is re-runnable to the same end state.

### Phase 0 — Pre-flight (no DDL, no data)

- [ ] Snapshot current `brain_dev` schema + data (`pg_dump --schema-only` + `pg_dump --data-only`) into `tools/migrate-legacy/snapshots/pre-phase-0.sql`. Reversibility ground truth.
- [ ] Verify the FDW connectivity to `aws-1-ap-south-1.pooler.supabase.com:5432` from inside the docker container.
- [ ] Verify all 13 legacy workspaces are reachable (a `SELECT count(*) FROM legacy_src.workspaces` returns 13).
- [ ] Verify `legacy_aggregates` and `customer_pii` *don't* exist (we want fail-loud not silent-overwrite).

### Phase 1 — Schema (all DDL, zero data)

Run files 07 → 22 from §3.13. Apply in order. RLS-enabled but no data yet.

**Gate (Founder):** review the diff vs `pre-phase-0.sql`. If approved → phase 2.

### Phase 2 — Foundations (all workspaces + users + members + invitations)

Lift the 3-workspace filter. Load ALL 13 legacy workspaces.

```sql
-- users — already done by current 02_migrate.sql; idempotent re-run is safe.
INSERT INTO users (...) SELECT ... FROM legacy_src.users ON CONFLICT (id) DO UPDATE SET ...;

-- workspaces — DROP the WHERE id IN (:ws1,:ws2,:ws3) filter. Map ALL 13.
-- Legacy `features jsonb`, `tax_percent decimal(5,2)`, `timezone`, `plan`, `logo_url`,
-- `founder_salary_*`, `skip_zero_sales_orders`, `skipped_shopify_order_tags`,
-- `product_data_source` → the new columns on workspaces (§3.11).
INSERT INTO workspaces (id, name, slug, industry, monthly_revenue, store_url, platform,
                        created_by_id, features, logo_url, plan, tax_percent_bp, timezone,
                        founder_salary_currency, founder_salary_monthly_mu, skip_zero_sales_orders,
                        skipped_shopify_order_tags, product_data_source, created_at, updated_at)
SELECT id, name, slug, industry, monthly_revenue, store_url,
       (CASE WHEN platform = 'WOOCOMMERCE' THEN 'WOOCOMMERCE' ELSE 'SHOPIFY' END)::store_platform,
       created_by_id,
       coalesce(features, '{}'::jsonb),
       logo_url,
       upper(plan)::subscription_plan,
       (tax_percent * 100)::int,                                 -- 5.00% → 500 bp
       coalesce(timezone, 'Asia/Kolkata'),
       founder_salary_currency,
       CASE WHEN founder_salary_monthly IS NOT NULL
            THEN (founder_salary_monthly * subunit_multiplier(coalesce(founder_salary_currency,'INR')))::bigint
            ELSE NULL END,
       skip_zero_sales_orders, skipped_shopify_order_tags,
       coalesce(product_data_source::text, 'SHOPIFY'),
       created_at AT TIME ZONE 'UTC', updated_at AT TIME ZONE 'UTC'
FROM legacy_src.workspaces
ON CONFLICT (id) DO UPDATE SET <every column>;

-- workspace_members (lift the WHERE filter) + invitations.
```

> `subunit_multiplier(currency)` is a SQL helper (`CASE WHEN upper(currency) IN ('KWD','BHD') THEN 1000 WHEN upper(currency)='JPY' THEN 1 ELSE 100 END`) — reused from `02_migrate.sql`. Promote it into a stable SQL function at phase 1, file `09b-fn-subunit-multiplier.sql`.

**Gate (Founder):** sign 13 workspaces visible, users mapped, RLS still fail-closed under `rls_app`. → phase 3.

### Phase 3 — Workspace config (D10–D15)

Small, no PII, validates the new tables before we touch heavy facts.

- `workspace_cogs_settings`: 2 rows → upsert (`override_all_cogs_percent` 5.00 → 500 bp).
- `workspace_costs`: 5 rows → upsert.
- `workspace_misc_expenses`: 2 rows → upsert.
- `workspace_metric_goals`: 2 rows → upsert with `goal_unit` discriminator (route to `mu`/`bp`/`count` per metric_name).
- `workspace_festivals`: 570 rows → upsert (`expected_multiplier 1.5 → 15000 bp`).
- `workspace_ad_campaign_classifications`: 3 rows → upsert.

**Gate:** spot-check a known workspace's costs/festivals via the UI. → phase 4.

### Phase 4 — Customer PII dim (D2)

Encrypt at the ETL boundary. Use the same dev custody key as OAuth tokens (LOCAL-ONLY, recorded in the migration header).

```sql
-- Pseudocode (real version uses pgcrypto + a precomputed dev key OR a one-shot Node-side script):
INSERT INTO customer_pii (workspace_id, customer_ref, source_vendor, vendor_customer_id,
                          email_ct, phone_ct, full_name_ct,
                          first_seen_at, last_seen_at, orders_count, lifetime_spent_mu,
                          currency_code, tags, created_at, updated_at)
SELECT c.workspace_id,
       substr(encode(sha256(sc.shopify_id::bytea), 'hex'), 1, 32) AS customer_ref,
       'SHOPIFY'::connector_vendor,
       sc.shopify_id,
       aesgcm_encrypt(sc.email, :dev_key)        AS email_ct,
       NULL                                       AS phone_ct,
       aesgcm_encrypt(sc.first_name || ' ' || sc.last_name, :dev_key) AS full_name_ct,
       sc.shopify_created_at,
       sc.updated_at,
       sc.orders_count,
       (sc.total_spent * subunit_multiplier(sc.currency))::bigint,
       sc.currency, sc.tags, now(), now()
FROM legacy_src.shopify_customers sc
JOIN legacy_src.shopify_connections c ON c.id = sc.connection_id
ON CONFLICT (workspace_id, customer_ref) DO UPDATE SET ...;
```

> **`aesgcm_encrypt`** doesn't exist in pgcrypto in the exact AES-256-GCM blob shape Brain uses. Two implementation paths:
> 1. **Preferred:** run the PII migrate as a one-shot Node script that calls `local-aesgcm-custody.ts` row-by-row (110K rows ≈ 5-10 min, acceptable for a one-shot).
> 2. **Alternative:** use pgcrypto `pgp_sym_encrypt` for this LOCAL-ONLY migrate and document that the production version must adopt the canonical AES-256-GCM blob shape. (Don't conflate: pgp_sym_encrypt is non-blob — different format.)
> 
> **Decision: path 1.** Reuse the proven custody backing; one consistent blob shape across `connector_credentials` and `customer_pii`. The Node script reads from `legacy_src.shopify_customers` via the same pool, encrypts, upserts into `customer_pii`. **For builder: this is the recommended approach.**

**Gate:** verify a) PII columns are bytea ciphertext (no plaintext), b) RLS prevents context-less reads, c) decrypt round-trip works on a known customer. → phase 5.

### Phase 5 — Facts (raw vendor data)

Each sub-phase is its own re-runnable unit.

#### 5a. Shopify (existing, lift filter)
- Orders, line items, products, refund line items, ad-spend (Meta + Google campaign-day) — already in `02_migrate.sql` and `03b/03c`. **Lift the `WHERE workspace_id IN (:ws1,:ws2,:ws3)` filter** to capture all 7 Shopify connections × all workspaces.
- Promote `03a/03b/03c` from `/tmp/brain_mig/` into committed `apps/core-service/migrations/local-dev/` files (the enum extension, shipment/refund table create, COGS update, line-item product_id link). These already work on real data per `connector-pipeline-gaps.md`.

#### 5b. Shopify variants (D3)
- Map `legacy_src.shopify_variants` → `connector_variant_facts` (vendor=SHOPIFY).

#### 5c. WooCommerce (D4a/b/c)
- Map `woocommerce_orders` → `connector_order_facts` (vendor=WOOCOMMERCE). Customer PII (`customer_email/phone`) goes through the same PII-encryption step as 5d (separate vendor source).
- Map `woocommerce_line_items` → `connector_line_item_facts`.
- Map `woocommerce_products` (with `coq` → `cost_mu`) → `connector_product_facts`.

#### 5d. WooCommerce customer PII (extends D2)
- For each WC order, derive `customer_ref = sha256(coalesce(customer_email, customer_phone, 'wc-' || wc_order_id))` and upsert into `customer_pii` with `source_vendor=WOOCOMMERCE`.

#### 5e. Shiprocket order layer (D9)
- Map `legacy_src.shiprocket_orders` → `connector_logistics_order_facts` (vendor=SHIPROCKET).

#### 5f. Meta creative-day + Google funnel-day (D7a/b)
- Map `meta_ads_creative_daily` → `connector_ad_creative_facts`.
- Map `google_ads_funnel_daily` → `connector_ad_funnel_facts`.

#### 5g. Unicommerce catalog (D5)
- Map `unicommerce_products` → `connector_product_facts` (vendor=UNICOMMERCE).

#### 5h. Klaviyo email performance (D6)
- Map `email_performance` → `connector_email_send_facts`. Empty in legacy prod today but the schema lands now for future Klaviyo connector activation.

**Gate after each sub-phase:** spot-check a known workspace's metric on the page that consumes that fact.

### Phase 6 — Aggregates (D20, transitional)

Two paths run in parallel:
- **Transitional:** mirror the legacy `workspace_daily_metrics`, `shopify_analytics_daily`, `product_daily_aggregates` rows into `legacy_aggregates.*`. Pages that today read these continue to work.
- **Native:** the metric engine (`packages/lib-metrics`, `pylibs/brain_metrics`) recomputes daily metrics from the facts. The TECH/03 metric registry is the authority. Initially they may not match (legacy had hand-rolled SQL); ANY mismatch is logged in `findings/metric_parity_<date>.md` for triage. **Cutover to native is OUT OF SCOPE for this migrate** — it's a separate Stage-1/2 EOS run.

**Gate (Founder):** the transitional path makes pages work; the native vs legacy comparison report is filed. → phase 7.

### Phase 7 — App data (D16–D19)

- `notifications` (85), `ai_insights` (6), `marketing_actions` (6), `audit_logs` (empty schema only).

### Phase 8 — Cleanup

- `DROP SERVER legacy_supa CASCADE` (removes foreign tables; the live legacy DB is untouched).
- Archive the migration scripts under `tools/migrate-legacy/runs/<date>/` for the EOS audit trail.

---

## 6. Reversibility + risks

### Reversibility

- Every phase has a `down-<n>.sql` that drops what it added (table DROPs are cascade-safe inside the local docker).
- Phase-0 snapshot (`pre-phase-0.sql`) restores `brain_dev` to its pre-migrate state (`pg_restore` on the docker volume).
- Live legacy Supabase is **never written** — FDW is read-only by virtue of the legacy DB role being read-only (must verify pre-flight: the FDW user has `USAGE` on `public`, `SELECT` on all tables, no `INSERT/UPDATE/DELETE`).

### Risks (and the mitigation)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Currency subunit multiplier wrong for an exotic legacy currency (KWD/BHD/JPY edge cases) → off-by-1000× money | Med | High | Reuse the proven `subunit_multiplier()` helper from `02_migrate.sql`; assert `SUM(gross_sales_mu) BETWEEN known_min AND known_max` for each workspace post-load. |
| R2 | `ALTER TYPE ADD VALUE` inside a transaction blocks → migrate fails halfway | Med | Med | File `09-extend-connector-vendor-enum.sql` runs in its own connection/transaction, COMMIT immediately, then `10-…` references the new values. (Precedent in `03a_enum_fdw.sql`.) |
| R3 | PII migrate (110K customers, AES-GCM per row) is slow or fails partway | Low | Med | One-shot Node script with checkpointed `customer_ref` cursor; `ON CONFLICT DO UPDATE` so a re-run resumes; estimated 5-10 min. |
| R4 | RLS policy on `notifications` (the OR pattern) accidentally leaks rows | Low | High | Add a dedicated test case in `pool-isolation.test.ts` (P-003): context-less connection sees 0; user-only context sees only own user_id rows where workspace_id IS NULL; ws context sees only that ws's rows. |
| R5 | `customer_ref` collision across vendors (Shopify customer id `42` ≠ Woo customer id `42`) | Low | Med | Hash inputs are vendor-prefixed: `sha256('shopify:' \|\| shopify_id)` for Shopify, `sha256('woo:' \|\| email_or_phone_or_id)` for Woo. Document the hash recipe per vendor in the ETL header. Already implied by `source_vendor` column; making the hash input also vendor-prefixed is the belt-and-braces. |
| R6 | Legacy `workspace_daily_metrics` doesn't match what Brain's metric engine computes | High | Low (it's transitional) | Log parity report; gate cutover behind explicit Founder approval. |
| R7 | A legacy workspace has a slug collision with an existing local workspace | Low | Low | `slug UNIQUE` on `workspaces` — load fails loud, operator picks a rename. |
| R8 | FDW credentials accidentally committed | Low | High | The CREATE SERVER + USER MAPPING goes in a `*.local.sql` not checked in; the committed file references env vars (`:'legacy_password'`). |

---

## 7. Out-of-scope / explicit deferrals

- **Live two-way sync** — this is a one-shot migrate. Future incremental (CDC or polled) is a separate Stage-1/2 EOS run.
- **ClickHouse mirror** (TECH/01 §3, §4) — the local app does not have ClickHouse. The Brain-native facts are designed so they can later land in CH `*_local` tables via CDC (`ReplacingMergeTree(version)`). Nothing in this plan blocks that.
- **Production custody for `customer_pii`** — local uses the same dev AES key as connector_credentials. Production decision (CF-C7-CUSTODY-PROOF-1) is still held; this migrate doesn't unblock or block it.
- **Native metric-engine cutover** — `legacy_aggregates.*` is transitional. Replacing it with the metric engine's computed aggregates is a separate epic.
- **`workspace_costs.amount_unit` discriminator** — local keeps the boolean `is_percent` overload (legacy compat). Switching to `amount_unit ENUM('mu','bp')` is a tiny follow-up before going production.
- **Klaviyo / Unicommerce / WooCommerce live connectors** — schemas land now (parity); writing the live OAuth + ACL is a separate Stage-1/2 EOS run per vendor.
- **`audit_log` as a tamper-evident chain** — for now it's a plain table. TECH/16 §4 implies append-only; achievable with a `BEFORE DELETE/UPDATE` deny-trigger, deferred.
- **Live Supabase zero-RLS P0** — this migrate does not touch live Supabase. The P0 is a separate Founder-tracked item.

---

## 8. Persona stress-test

**P-001 — Data correctness.** Money path: legacy `Decimal(12,2)` → ETL `* subunit_multiplier(currency)` → BIGINT minor units, never float, validated by post-load SUM-equals assertions per workspace. Aggregate parity: legacy `workspace_daily_metrics` goes into `legacy_aggregates.*` keeping legacy numbers intact; Brain-native metric engine recomputes separately and a parity report is filed (not auto-cutover). **PASS** (with the parity report as the open follow-up).

**P-002 — Idempotency.** Every INSERT uses `ON CONFLICT DO UPDATE` on a documented unique key (the `(workspace_id, vendor, vendor_*_id)` or `(workspace_id, name, period_start)` patterns). Phase scripts are re-runnable to the same end state. `connector_*_facts.synced_at` always refreshed on update. **PASS.**

**P-003 — Tenant isolation.** Every workspace-scoped table gets the identical fail-closed `ws_isolation` policy (`NULLIF` + `=`-only, FORCE RLS, no `OR ... IS NULL`/`COALESCE`/`USING(true)`/session SET). Two documented exceptions (`notifications`, `audit_log`) use `ws_or_user_isolation` (OR between two `=` predicates, both fail-closed under `NULLIF`); the migration header flags them and a `pool-isolation.test.ts` case proves the closure. The `customer_pii` table is RLS-scoped — erasure or RLS bypass both fail safely. **PASS (with the two flagged exceptions documented).**

**P-006 — DPDP.** Facts hold no PII (customer_ref hash + pincode/city only). The opt-in `customer_pii` dim stores email/phone/full_name encrypted at the column level (AES-256-GCM blob, same shape as connector_credentials). Consent defaults `unknown`, treated as "not opted in" by lifecycle-service. Erasure tombs the dim row, leaves facts intact. IP addresses go into `audit_log` as `ip_hash` (sha256), never raw. Logs already redact at `pylibs/brain_logger`; verify the redaction list includes the new `email_ct/phone_ct/full_name_ct` columns (these are bytea so unlikely to leak as strings, but the redactor should still skip them). **PASS.**

---

## 9. Open questions for Founder

| # | Question | Why it matters | Default if no answer |
|---|---|---|---|
| Q1 | Confirm PII path: **opt-in `customer_pii` dim (Option B)** vs pure minimization (Option A)? | Binding decision §1.1. Option B is the recommendation but the trade-off is "PII is back in the DB". | Proceed with B (the recommendation), encrypted-at-rest, consent-default-`unknown`. |
| Q2 | OK to use the same local AES-256-GCM dev key for `customer_pii` as for `connector_credentials`? | Simplifies the local migrate. Production custody is a separate decision. | Yes. |
| Q3 | Approve the two RLS-policy exceptions (`notifications`, `audit_log` use OR pattern)? | Both schemas allow workspace_id NULL; the OR is between two `=` predicates and remains fail-closed under `NULLIF`. The static gate has to whitelist these two. | Approve with the inline justification + pool-isolation test case. |
| Q4 | Accept the legacy_aggregates **transitional** schema (kept until metric engine matches)? | A separate `legacy_aggregates` schema makes the deprecation cliff obvious. | Yes. |
| Q5 | Phasing — Founder gate after EVERY phase, or only at phase 1 (schema), phase 5 (facts), phase 8 (cleanup)? | More gates = more friction but safer. | Default to gates at phase 1, 2, 4, 5, 8 (the five with the most rollback cost). |
| Q6 | The legacy DB user — confirm it's read-only (cannot INSERT/UPDATE/DELETE)? | A bug in our migrate must not be able to corrupt live prod. | I'll assert this in the phase-0 pre-flight; abort if the user has write privileges. |

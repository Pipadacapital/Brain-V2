# Raw Event Store DDL — HOLD-AT-CUTOVER / RUNBOOK-GATED / MANUAL (CF-BN-DDL-GATING-1)

**THIS DIRECTORY IS NOT SCANNED BY ANY MIGRATION RUNNER.**

No file in this directory will ever be executed by `prisma migrate deploy`,
`migrate up`, Flyway, or any other automated runner. The SQL here is
**Stage-8 HOLD-AT-CUTOVER only**, executed manually by a human operator
following `runbooks/cutover/per-connector-ceremony.md` exactly.

## Hold state: HOLD-AT-CUTOVER (Child-3)

The raw event store DDL is present as Brain code but NOT applied to any live DB
this child. It is applied per-connector at the Stage-8 HOLD-AT-CUTOVER ceremony,
one connector at a time, lowest-risk first, Shiprocket last.

**The DDL must NOT be applied to the live Supabase ap-south-1 DB until:**
1. The Founder's Option A/B custody decision is on record (CF-C3-SECRETS-INTERIM-1)
2. The Shopify connector's pre-conditions are all met (see shopify-cutover-runbook.md STEP 0)
3. Founder + CTOA sign-off

## DDL files

These files are authored by Track M (Maya, intelligence-engineer).
Track V (Vikram) provides this README as V12.

| File | What it does | When to apply |
|------|-------------|---------------|
| `step-a-enable-create.sql` | Raw landing tables + non-nullable consent columns + UNIQUE (workspace_id, vendor_event_id) + Child-1 ws_isolation policy (ENABLE+CREATE) | Runbook STEP 3 — after startup gates GREEN |
| `step-b-force.sql` | FORCE ROW LEVEL SECURITY per table (Stage-8 only) | **HELD** — same HOLD-AT-FORCE preconditions as Child-1 |
| `down.sql` | Symmetric rollback: NO FORCE → DISABLE → DROP POLICY → DROP TABLE | Rollback only |

## Consent columns (CF-C3-CONSENT-COLUMN-1)

Every PII-bearing raw table carries these NON-NULLABLE columns from day one:

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `workspace_id` | UUID NOT NULL | required | RLS scope key |
| `lawful_basis` | TEXT NOT NULL | 'owner_brand_controller' | DPDP §7 lawful basis |
| `purpose_code` | TEXT NOT NULL | 'analytics_performance' | One of: analytics_performance, logistics_tracking, email_performance, catalog_sync |
| `ingested_at` | TIMESTAMPTZ NOT NULL | now() | Stamped at ingest-write, NEVER backfilled |

Retroactive backfill of consent columns across millions of rows is irreversibly
expensive AND is itself a §4 processing act under DPDP. These columns must be
present from day one — NOT added later.

## Tables covered

- `shopify_orders` — PII: email, first_name, last_name
- `shopify_line_items`
- `shopify_customers` — PII: email, first_name, last_name, phone
- `shopify_products`
- `woocommerce_orders` — PII: customer_email, customer_phone, billing_*, shipping_*
- `meta_ads_daily` — NO individual PII (aggregates only)
- `google_ads_daily` — NO individual PII (aggregates only)
- `klaviyo_email_performance` — NO individual PII (aggregates only)
- `shiprocket_shipments` — PII: delivery_pincode, delivery_city, delivery_state
- `unicommerce_products`
- `connector_cursor` — no PII; tracks per-(workspace_id, vendor) ingest cursor

## RLS policy shape (mirrors Child-1)

All tables use the Child-1 `ws_isolation` fail-closed shape:
```sql
ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON <table>
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
```

Banned shapes (same as Child-1 CF-C1-RLS-DEFAULT-1.a):
- `OR ... IS NULL` (null-context bypass)
- `COALESCE(...)` (bypass risk)
- `USING (true)` (open policy)
- Session-level `SET` (leaks across pgbouncer txn-pool)

## Reversibility

Nothing applied to any live DB this child → `git revert` is the rollback.
The Stage-8 DDL application is symmetric: `down.sql` = NO FORCE → DISABLE →
DROP POLICY IF EXISTS → DROP TABLE.

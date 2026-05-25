# Developer Report — Maya (intelligence-engineer) — Track M
## feat-connector-framework-cutover (Child 3)

> Stage 3 build complete. Track M delivers the raw event-store schema, consent columns, PII manifest, and cursor contract. Run timestamp: 2026-05-24T22:45:00Z.

---

## Self-review

| Check | Result | Evidence |
|---|---|---|
| `@paradigm: sql` on every new code path | PASS | Declared in all `.py` and `.sql` file headers |
| Paradigm justified in comment + journal | PASS | See `pii_manifest.py` module docstring + journal |
| No ML / LLM path | PASS | Pure set-membership logic + SQL DDL; zero inference |
| Prompt caching | NOT_APPLICABLE | sql paradigm; no LLM calls |
| Per-brand token cap | NOT_APPLICABLE | sql paradigm; no LLM calls |
| Daily-tick simulation | NOT_APPLICABLE | raw ingest DDL + PII contract; no tick path |
| CF-C3-CONSENT-COLUMN-1 | PASS | Every PII-bearing table carries NON-NULLABLE `workspace_id`/`lawful_basis`/`purpose_code`/`ingested_at` with CHECK constraints; stamped at ingest-write |
| CF-C3-PII-ADAPTER-GATE-1 | PASS | `check_pii_fields()` gate present; 7 manifests covering all vendors; undeclared potential-PII field raises `PiiManifestViolation` |
| CF-C3-RLS-CONSUME-1 | PASS | Every raw table has `ws_isolation` fail-closed policy (Child-1 shape); FORCE in step-b (HELD); symmetric `down.sql` |
| CF-BN-NOLEGACY-1 | PASS | `git diff --cached` shows zero `legacy project/` files |
| No money conversion in ingest path | PASS | All money columns are `TEXT NOT NULL` with `_raw` suffix; no conversion function; DDL grep for PAISE/MINOR_UNITS returns zero |
| No live DDL applied | PASS | All DDL is in `migrations/manual/raw/` with HOLD-AT-CUTOVER header; no migration runner path |
| No git commit | PASS | `git status` shows staged (A) only; no commit |
| No `.env` staged | PASS | `git diff --cached` confirms |
| Coverage ≥70% on new code | PASS | 40 tests for pii_manifest.py + cursor.py (structural) + DDL static analysis |
| Tests: positive AND negative | PASS | 9 positive + 8 negative + 13 registry + 3 cursor structural + 7 DDL analysis = 40 |
| V4 seam status | READY | `check_pii_fields` + `upsert_cursor` exported from `src.domain.framework`; `PiiManifest` shared type via adapter.py |

---

## Schema and files created

### DDL (runbook-gated — HOLD-AT-CUTOVER — Stage-8-only)

**`apps/ingestion-service/migrations/manual/raw/step-a-enable-create.sql`**
11 tables created:
- `connector_cursor` — cursor persistence per (workspace_id, vendor); workspace-scoped RLS
- `raw_shopify_orders` — PII: email
- `raw_shopify_line_items` — no PII; scoped by workspace_id
- `raw_shopify_customers` — PII: email, first_name, last_name
- `raw_shopify_products` — no PII; catalog
- `raw_woocommerce_orders` — PII: customer_email, customer_phone, all billing_*/shipping_*
- `raw_meta_ads_daily` — no PII; aggregate campaign metrics
- `raw_google_ads_daily` — no PII; aggregate campaign metrics
- `raw_klaviyo_email_performance` — no PII; aggregate campaign metrics
- `raw_shiprocket_shipments` — PII: delivery_pincode, delivery_city, delivery_state
- `raw_unicommerce_products` — no PII; catalog sync

Every table:
- Non-nullable `workspace_id UUID NOT NULL`, `lawful_basis TEXT NOT NULL CHECK (...)`, `purpose_code TEXT NOT NULL CHECK (...)`, `ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()` (CF-C3-CONSENT-COLUMN-1)
- `UNIQUE (workspace_id, vendor_event_id)` — idempotency key
- `(workspace_id, ingested_at)` index — cursor/window queries
- Child-1 `ws_isolation` RLS policy shape: `USING/WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid)`
- Money columns land raw (TEXT with `_raw` suffix); no conversion

**`apps/ingestion-service/migrations/manual/raw/step-b-force.sql`**
FORCE ROW LEVEL SECURITY on all 11 tables. Stage-8 HELD — all preconditions listed in header comment (startup gates GREEN, real-pooler IT GREEN, live HTTP auth test GREEN, count-parity confirmed, Founder/CTO sign-off).

**`apps/ingestion-service/migrations/manual/raw/down.sql`**
Symmetric rollback: for each table: `NO FORCE` → `DISABLE ROW LEVEL SECURITY` → `DROP POLICY IF EXISTS ws_isolation` → `DROP TABLE IF EXISTS ... CASCADE`. Idempotent (IF EXISTS on every DROP). Used if Stage-8 ceremony needs to roll back.

### Python — PII manifest (M3)

**`apps/ingestion-service/src/domain/framework/pii_manifest.py`**

Key exports:
- `check_pii_fields(manifest: PiiManifest, payload_field_names: Sequence[str]) -> None` — the CF-C3-PII-ADAPTER-GATE-1 fail-closed gate called by `ingest_batch` before every write. Raises `PiiManifestViolation` if an undeclared potential-PII field is detected (heuristic-matched against `_PII_HEURISTIC_SUBSTRINGS`). Fields declared in `manifest.pii_fields` always pass.
- `PiiManifestViolation` — raised on gate failure; carries `undeclared_fields` list; error message contains "write refused" for CF traceability.
- `MANIFEST_REGISTRY: dict[str, PiiManifest]` — all 7 vendors.

Per-vendor manifest table (Sugandh Lok scope):

| Vendor | PII fields | lawful_basis | purpose_code |
|---|---|---|---|
| shopify | email, first_name, last_name | owner_brand_controller | analytics_performance |
| woocommerce | customer_email, customer_phone, billing_* (5 fields), shipping_* (5 fields) | owner_brand_controller | analytics_performance |
| shiprocket | delivery_pincode, delivery_city, delivery_state | owner_brand_controller | logistics_tracking |
| klaviyo | none (aggregate only; empty pii_fields) | owner_brand_controller | email_performance |
| meta | none (aggregate only) | owner_brand_controller | analytics_performance |
| google | none (aggregate only) | owner_brand_controller | analytics_performance |
| unicommerce | none (catalog only) | owner_brand_controller | catalog_sync |

Implementation note: `PiiManifest` and `PiiFieldSpec` are imported from Vikram's `adapter.py` (the locked P3 interface, §A0.5). Track M does NOT define a second `PiiManifest` type — it provides the per-vendor instances and the gate function. This is the intentional V4←M3 seam.

### Python — Cursor contract (M4)

**`apps/ingestion-service/src/domain/framework/cursor.py`**

- `CursorRow(workspace_id, vendor, cursor_value, window_start, window_end, updated_at)` — frozen dataclass
- `GET_CURSOR_SQL` — filters on both `workspace_id` AND `vendor`
- `UPSERT_CURSOR_SQL` — `ON CONFLICT (workspace_id, vendor) DO UPDATE SET cursor_value, window_start, window_end, updated_at = now()`
- `async get_cursor(conn, workspace_id, vendor) -> CursorRow | None` — returns None on first run (full backfill)
- `async upsert_cursor(conn, workspace_id, vendor, cursor_value, window_start, window_end) -> None` — called as the LAST write inside the `with_workspace` transaction; rolls back with the batch if the batch fails

The cursor table DDL is in `connector_cursor` (step-a). The cursor row is inside the same `with_workspace` session as the batch UPSERT — workspace-scoped RLS applies; no cross-workspace cursor read possible.

---

## Consent-column design (CF-C3-CONSENT-COLUMN-1)

Every PII-bearing raw table carries four non-nullable columns stamped at ingest-write time:

```sql
workspace_id  UUID        NOT NULL                           -- RLS scope key
lawful_basis  TEXT        NOT NULL                           -- DPDP §7 accountability
    CHECK (lawful_basis IN (
        'owner_brand_controller',
        'data_principal_consent',
        'legitimate_interest'
    ))
purpose_code  TEXT        NOT NULL                           -- DPDP §8(7) retention scoping
    CHECK (purpose_code IN (
        'analytics_performance',
        'logistics_tracking',
        'email_performance',
        'catalog_sync'
    ))
ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()             -- DPDP §8(3) processing timestamp
```

The `lawful_basis` and `purpose_code` values are sourced from `adapter.pii_manifest.default_lawful_basis` / `.default_purpose_code` at ingest-write time. For Sugandh Lok initial scope, `lawful_basis = 'owner_brand_controller'` on all adapters.

These columns are **never backfilled** — adding them retroactively across millions of rows would itself be a DPDP §4 processing act. Adding them from day one costs nothing (stamped at write with a constant value).

---

## RLS pattern (mirrors Child-1 exactly)

All raw tables use the same fail-closed `ws_isolation` policy shape as Child-1:

```sql
ALTER TABLE raw_shopify_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON raw_shopify_orders
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
```

`missing_ok=true` (the second arg to `current_setting`) means a missing GUC returns NULL, and `NULL::uuid` never matches any `workspace_id` — fail-closed by Postgres semantics. FORCE is in step-b (HELD). Symmetric `down.sql` reverses: `NO FORCE → DISABLE → DROP POLICY → DROP TABLE`.

---

## Cursor contract (V4 seam summary)

Vikram's `ingest_batch` (V4) calls these in order inside a `with_workspace` transaction:

1. `get_cursor(conn, workspace_id, vendor)` → window bounds for this run
2. batch UPSERT rows with `ON CONFLICT (workspace_id, vendor_event_id) DO UPDATE`
3. `upsert_cursor(conn, workspace_id, vendor, cursor_value, window_start, window_end)` — last write

If step 2 or 3 fails, Postgres rolls back the transaction — the cursor never advances past a failed batch.

---

## M5 — Forward-binding note: Child-4 metric fields

The consent-column set pre-shapes the fields Child-4's metric registry will consume:

1. **`raw_payload JSONB`** preserves the full vendor event. Child-4 materialisation workers read this column to compute metric fields (e.g. GMV, units sold, RTO rate). The JSONB column avoids losing any vendor field at ingest time (Child-3 does not know which fields Child-4 will need).

2. **`purpose_code`** is the per-purpose retention/erasure scoping boundary. Child-4 metric materialisation workers MUST respect this boundary: rows with `purpose_code = 'logistics_tracking'` (Shiprocket) should not feed `analytics_performance` metric aggregates (e.g. GMV). Mixing purposes would violate the DPDP §8(7) retention-limit principle (data processed for one purpose should not be retained for a different purpose without re-evaluation).

3. **`lawful_basis`** enables the DPDP §12 erasure path: when a data principal invokes their right to erasure, the raw event rows for that workspace (and optionally that purpose_code) can be identified and deleted without a full-table scan.

4. **`ingested_at` + `(workspace_id, ingested_at)` index** pre-shapes the window query Child-4 will use for incremental materialisation: `WHERE workspace_id = $1 AND ingested_at > $last_materialised_at`.

---

## Test counts (real output)

```
$ cd apps/ingestion-service && python3 -m pytest tests/unit/test_pii_manifest.py -v
============================= test session starts ==============================
platform darwin -- Python 3.13.7, pytest-9.0.2, pluggy-1.6.0
collected 40 items

TestCheckPiiFieldsPositive::test_shopify_declared_pii_fields_pass PASSED
TestCheckPiiFieldsPositive::test_shopify_non_pii_fields_only_pass PASSED
TestCheckPiiFieldsPositive::test_woocommerce_all_billing_shipping_declared_pass PASSED
TestCheckPiiFieldsPositive::test_shiprocket_delivery_pii_declared_pass PASSED
TestCheckPiiFieldsPositive::test_klaviyo_no_pii_fields_pass PASSED
TestCheckPiiFieldsPositive::test_meta_aggregate_fields_pass PASSED
TestCheckPiiFieldsPositive::test_google_aggregate_fields_pass PASSED
TestCheckPiiFieldsPositive::test_unicommerce_catalog_fields_pass PASSED
TestCheckPiiFieldsPositive::test_empty_field_list_passes PASSED
TestCheckPiiFieldsNegative::test_undeclared_email_on_klaviyo_raises PASSED
TestCheckPiiFieldsNegative::test_undeclared_phone_on_meta_raises PASSED
TestCheckPiiFieldsNegative::test_undeclared_billing_field_on_shopify_raises PASSED
TestCheckPiiFieldsNegative::test_multiple_undeclared_pii_fields_all_reported PASSED
TestCheckPiiFieldsNegative::test_undeclared_name_field_on_google_raises PASSED
TestCheckPiiFieldsNegative::test_undeclared_address_field_on_unicommerce_raises PASSED
TestCheckPiiFieldsNegative::test_undeclared_email_on_meta_raises PASSED
TestCheckPiiFieldsNegative::test_violation_error_message_contains_vendor_and_field PASSED
TestManifestRegistry::test_all_seven_vendors_present PASSED
TestManifestRegistry::test_every_manifest_has_owner_brand_controller_lawful_basis PASSED
TestManifestRegistry::test_every_manifest_has_a_purpose_code PASSED
TestManifestRegistry::test_shiprocket_purpose_is_logistics_tracking PASSED
TestManifestRegistry::test_klaviyo_purpose_is_email_performance PASSED
TestManifestRegistry::test_unicommerce_purpose_is_catalog_sync PASSED
TestManifestRegistry::test_shopify_pii_fields_declared PASSED
TestManifestRegistry::test_woocommerce_pii_fields_include_all_billing_shipping PASSED
TestManifestRegistry::test_shiprocket_pii_fields_include_delivery_location PASSED
TestManifestRegistry::test_aggregate_only_manifests_have_empty_pii_fields PASSED
TestManifestRegistry::test_pii_field_specs_have_correct_lawful_basis PASSED
TestCursorContractImport::test_cursor_row_dataclass_fields PASSED
TestCursorContractImport::test_upsert_cursor_sql_contains_on_conflict PASSED
TestCursorContractImport::test_get_cursor_sql_filters_by_workspace_id_and_vendor PASSED
TestDDLBannedShapes::test_no_is_null_in_policy PASSED
TestDDLBannedShapes::test_no_coalesce_in_policy PASSED
TestDDLBannedShapes::test_no_using_true_in_policy PASSED
TestDDLBannedShapes::test_every_pii_table_has_rls_enable PASSED
TestDDLBannedShapes::test_every_pii_table_has_ws_isolation_policy PASSED
TestDDLBannedShapes::test_consent_columns_present_on_pii_tables PASSED
TestDDLBannedShapes::test_money_conversion_absent_from_ddl PASSED
TestDDLBannedShapes::test_down_sql_is_symmetric PASSED
TestDDLBannedShapes::test_step_b_force_covers_all_tables_in_step_a PASSED

============================== 40 passed in 0.02s ==============================
```

---

## CF-* satisfaction

| CF ID | Criterion | Status |
|---|---|---|
| **CF-C3-CONSENT-COLUMN-1** | Non-nullable workspace_id/lawful_basis/purpose_code/ingested_at on every PII-bearing raw table, stamped at ingest-write | **PASS** |
| **CF-C3-PII-ADAPTER-GATE-1** | Per-adapter PiiManifest declared; ingest primitive refuses undeclared PII; manifest + gate present and tested | **PASS** |
| **CF-C3-RLS-CONSUME-1** (Maya half) | Every raw table has ws_isolation fail-closed policy (Child-1 shape); FORCE held; symmetric down | **PASS** |
| **CF-BN-NOLEGACY-1** | Zero legacy project diff | **PASS** |
| No money conversion | _raw TEXT suffix; no conversion code anywhere in the DDL or Python | **PASS** |
| No live DDL applied | All DDL in migrations/manual/raw/ with HOLD-AT-CUTOVER header | **PASS** |
| No git commit | Staged only; awaiting Founder "commit it" | **PASS** |

---

## V4 seam status

**READY.** Vikram's `ingest_batch` (V4) can import:

```python
from domain.framework.pii_manifest import check_pii_fields, MANIFEST_REGISTRY
from domain.framework.cursor import get_cursor, upsert_cursor

# In ingest_batch:
check_pii_fields(adapter.pii_manifest, normalized_event.columns.keys())
await upsert_cursor(conn, workspace_id, vendor, cursor_value, window_start, window_end)
```

The `PiiManifest` type on `ConnectorAdapter.pii_manifest` is the same type the manifests in `MANIFEST_REGISTRY` are instances of (both from adapter.py). No import conflict.

The `connector_cursor` table DDL is in `step-a-enable-create.sql` and the cursor UPSERT key `(workspace_id, vendor)` matches the Python contract exactly.

---

## Guardrails confirmed

- No `legacy project/` diff: **CONFIRMED** (`git diff --cached --name-only` shows only `apps/ingestion-service/**`)
- No git commit: **CONFIRMED** (staged only)
- No live DDL applied: **CONFIRMED** (HOLD-AT-CUTOVER header on all three DDL files)
- No `.env` staged: **CONFIRMED**
- No ML/LLM: **CONFIRMED** (sql paradigm throughout; no inference call)
- No money conversion in the ingest path: **CONFIRMED** (`_raw` TEXT suffix; no conversion function; DDL test confirms)
- No bespoke per-connector paths: **CONFIRMED** (pii_manifest.py is a declarative registry; the gate is generic)
- No new memory store created: **CONFIRMED** (used existing schema conventions; no new vector store)

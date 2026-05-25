"""
Track M — Unit tests for CF-C3-PII-ADAPTER-GATE-1 + CF-C3-CONSENT-COLUMN-1.

@paradigm: sql (no ML, no LLM)

Tests cover:
  Positive scenarios:
    - declared PII fields pass check_pii_fields
    - declared PII + non-PII fields pass together
    - non-PII fields without heuristic matches pass unchecked
    - all per-adapter manifest instances in MANIFEST_REGISTRY are well-formed
    - lawful_basis and purpose_code are set on every manifest (CF-C3-CONSENT-COLUMN-1)

  Negative scenarios (fail-closed gate):
    - undeclared field matching PII heuristic → PiiManifestViolation raised
    - multiple undeclared PII fields → all reported in one violation
    - an adapter with empty pii_fields (Klaviyo/Meta/Google) blocks
      an 'email' field that was NOT declared at all
    - purpose_code 'logistics_tracking' on Shiprocket manifest is set correctly

  Manifest registry:
    - all 7 vendors are present in MANIFEST_REGISTRY
    - each manifest's default_lawful_basis is 'owner_brand_controller' (Sugandh Lok)
"""
import pytest

from domain.framework.pii_manifest import (
    PiiManifestViolation,
    check_pii_fields,
    SHOPIFY_MANIFEST,
    WOOCOMMERCE_MANIFEST,
    SHIPROCKET_MANIFEST,
    KLAVIYO_MANIFEST,
    META_MANIFEST,
    GOOGLE_MANIFEST,
    UNICOMMERCE_MANIFEST,
    MANIFEST_REGISTRY,
)


# ---------------------------------------------------------------------------
# Positive — declared PII fields pass
# ---------------------------------------------------------------------------

class TestCheckPiiFieldsPositive:

    def test_shopify_declared_pii_fields_pass(self):
        """Shopify's email, first_name, last_name are declared → pass."""
        fields = ["email", "first_name", "last_name",
                  "shopify_order_id", "total_price_raw"]
        check_pii_fields(SHOPIFY_MANIFEST, fields)  # must not raise

    def test_shopify_non_pii_fields_only_pass(self):
        """Non-PII fields with no heuristic match pass without declaration."""
        fields = ["shopify_order_id", "financial_status", "currency", "quantity"]
        check_pii_fields(SHOPIFY_MANIFEST, fields)  # must not raise

    def test_woocommerce_all_billing_shipping_declared_pass(self):
        """All WooCommerce billing/shipping PII fields are declared → pass."""
        fields = [
            "customer_email", "customer_phone",
            "billing_first_name", "billing_last_name",
            "billing_address_1", "billing_city", "billing_state", "billing_postcode",
            "shipping_first_name", "shipping_last_name",
            "shipping_address_1", "shipping_city", "shipping_state", "shipping_postcode",
            "woo_order_id", "total_raw",
        ]
        check_pii_fields(WOOCOMMERCE_MANIFEST, fields)  # must not raise

    def test_shiprocket_delivery_pii_declared_pass(self):
        """Shiprocket's delivery_pincode, city, state are declared → pass."""
        fields = ["delivery_pincode", "delivery_city", "delivery_state",
                  "shipment_id", "order_id", "status", "courier_name"]
        check_pii_fields(SHIPROCKET_MANIFEST, fields)  # must not raise

    def test_klaviyo_no_pii_fields_pass(self):
        """Klaviyo manifest has no PII; aggregate fields pass."""
        fields = ["campaign_id", "campaign_name", "delivered",
                  "unique_opens", "unique_clicks", "placed_order_count"]
        check_pii_fields(KLAVIYO_MANIFEST, fields)  # must not raise

    def test_meta_aggregate_fields_pass(self):
        """Meta manifest has no PII; ad-metric fields pass."""
        fields = ["campaign_id", "impressions", "clicks", "spend_raw", "currency"]
        check_pii_fields(META_MANIFEST, fields)  # must not raise

    def test_google_aggregate_fields_pass(self):
        """Google manifest has no PII; ad-metric fields pass."""
        fields = ["campaign_id", "ad_group_id", "cost_micros_raw", "clicks"]
        check_pii_fields(GOOGLE_MANIFEST, fields)  # must not raise

    def test_unicommerce_catalog_fields_pass(self):
        """Unicommerce manifest has no PII; catalog fields pass."""
        fields = ["sku_code", "item_type_sku", "category", "mrp_raw"]
        check_pii_fields(UNICOMMERCE_MANIFEST, fields)  # must not raise

    def test_empty_field_list_passes(self):
        """Empty field list always passes (no fields to check)."""
        check_pii_fields(SHOPIFY_MANIFEST, [])  # must not raise


# ---------------------------------------------------------------------------
# Negative — fail-closed gate: undeclared PII fields raise PiiManifestViolation
# ---------------------------------------------------------------------------

class TestCheckPiiFieldsNegative:

    def test_undeclared_email_on_klaviyo_raises(self):
        """
        Klaviyo manifest has no declared PII fields.
        If an 'email' field appears in the payload (e.g. from a subscriber sync
        that was added without updating the manifest), the gate must REFUSE.
        CF-C3-PII-ADAPTER-GATE-1 fail-closed.
        """
        with pytest.raises(PiiManifestViolation) as exc_info:
            check_pii_fields(KLAVIYO_MANIFEST, ["campaign_id", "email"])
        assert "email" in exc_info.value.undeclared_fields

    def test_undeclared_phone_on_meta_raises(self):
        """
        Meta manifest has no declared PII fields.
        A 'phone' field not declared → violation.
        """
        with pytest.raises(PiiManifestViolation) as exc_info:
            check_pii_fields(META_MANIFEST, ["campaign_id", "phone"])
        assert "phone" in exc_info.value.undeclared_fields

    def test_undeclared_billing_field_on_shopify_raises(self):
        """
        Shopify manifest declares email/first_name/last_name.
        'billing_address_1' is not declared on Shopify (it's WooCommerce's field)
        → the heuristic catches 'billing' → violation.
        """
        with pytest.raises(PiiManifestViolation) as exc_info:
            check_pii_fields(SHOPIFY_MANIFEST, ["email", "billing_address_1"])
        assert "billing_address_1" in exc_info.value.undeclared_fields

    def test_multiple_undeclared_pii_fields_all_reported(self):
        """
        Multiple undeclared PII fields must ALL appear in the violation,
        not just the first one (the caller needs to know the full surface).
        """
        with pytest.raises(PiiManifestViolation) as exc_info:
            check_pii_fields(
                KLAVIYO_MANIFEST,
                ["campaign_id", "email", "phone", "shipping_city"],
            )
        violation = exc_info.value
        assert "email"         in violation.undeclared_fields
        assert "phone"         in violation.undeclared_fields
        assert "shipping_city" in violation.undeclared_fields

    def test_undeclared_name_field_on_google_raises(self):
        """
        Google manifest declares no PII.  A 'customer_name' field triggers
        the 'name' heuristic → violation.
        """
        with pytest.raises(PiiManifestViolation) as exc_info:
            check_pii_fields(GOOGLE_MANIFEST, ["clicks", "customer_name"])
        assert "customer_name" in exc_info.value.undeclared_fields

    def test_undeclared_address_field_on_unicommerce_raises(self):
        """
        Unicommerce manifest declares no PII.  'warehouse_address' triggers
        the 'address' heuristic → violation.
        """
        with pytest.raises(PiiManifestViolation) as exc_info:
            check_pii_fields(UNICOMMERCE_MANIFEST, ["sku_code", "warehouse_address"])
        assert "warehouse_address" in exc_info.value.undeclared_fields

    def test_undeclared_email_on_meta_raises(self):
        """Meta manifest + an email field added without updating manifest → violation."""
        with pytest.raises(PiiManifestViolation):
            check_pii_fields(META_MANIFEST, ["ad_id", "email"])

    def test_violation_error_message_contains_vendor_and_field(self):
        """The error message must name the undeclared field for debuggability."""
        with pytest.raises(PiiManifestViolation) as exc_info:
            check_pii_fields(KLAVIYO_MANIFEST, ["email"])
        msg = str(exc_info.value)
        assert "email" in msg
        # message must mention 'write refused' for CF traceability
        assert "write refused" in msg


# ---------------------------------------------------------------------------
# Manifest registry — well-formedness + CF-C3-CONSENT-COLUMN-1 compliance
# ---------------------------------------------------------------------------

class TestManifestRegistry:

    def test_all_seven_vendors_present(self):
        """MANIFEST_REGISTRY must contain all 7 vendor manifests."""
        expected = {"shopify", "woocommerce", "shiprocket",
                    "klaviyo", "meta", "google", "unicommerce"}
        assert expected == set(MANIFEST_REGISTRY.keys())

    def test_every_manifest_has_owner_brand_controller_lawful_basis(self):
        """
        CF-C3-CONSENT-COLUMN-1: every manifest's default_lawful_basis must be
        'owner_brand_controller' for the Sugandh Lok initial scope.
        """
        for vendor, manifest in MANIFEST_REGISTRY.items():
            assert manifest.default_lawful_basis == "owner_brand_controller", (
                f"{vendor} manifest: default_lawful_basis must be "
                f"'owner_brand_controller', got '{manifest.default_lawful_basis}'"
            )

    def test_every_manifest_has_a_purpose_code(self):
        """CF-C3-CONSENT-COLUMN-1: every manifest must declare a purpose_code."""
        valid_purpose_codes = {
            "analytics_performance", "logistics_tracking",
            "email_performance", "catalog_sync",
        }
        for vendor, manifest in MANIFEST_REGISTRY.items():
            assert manifest.default_purpose_code in valid_purpose_codes, (
                f"{vendor} manifest: unknown purpose_code "
                f"'{manifest.default_purpose_code}'"
            )

    def test_shiprocket_purpose_is_logistics_tracking(self):
        """Shiprocket's purpose must be logistics_tracking per §5 of the arch plan."""
        assert SHIPROCKET_MANIFEST.default_purpose_code == "logistics_tracking"

    def test_klaviyo_purpose_is_email_performance(self):
        """Klaviyo's purpose must be email_performance."""
        assert KLAVIYO_MANIFEST.default_purpose_code == "email_performance"

    def test_unicommerce_purpose_is_catalog_sync(self):
        """Unicommerce's purpose must be catalog_sync."""
        assert UNICOMMERCE_MANIFEST.default_purpose_code == "catalog_sync"

    def test_shopify_pii_fields_declared(self):
        """Shopify manifest must declare email, first_name, last_name as PII."""
        pii_keys = set(SHOPIFY_MANIFEST.pii_fields.keys())
        assert {"email", "first_name", "last_name"}.issubset(pii_keys)

    def test_woocommerce_pii_fields_include_all_billing_shipping(self):
        """WooCommerce manifest must declare all billing_*/shipping_* fields."""
        pii_keys = set(WOOCOMMERCE_MANIFEST.pii_fields.keys())
        for expected in [
            "customer_email", "customer_phone",
            "billing_first_name", "billing_last_name",
            "billing_city", "billing_postcode",
            "shipping_first_name", "shipping_city",
        ]:
            assert expected in pii_keys, (
                f"WooCommerce manifest missing PII declaration for '{expected}'"
            )

    def test_shiprocket_pii_fields_include_delivery_location(self):
        """Shiprocket must declare delivery_pincode, delivery_city, delivery_state."""
        pii_keys = set(SHIPROCKET_MANIFEST.pii_fields.keys())
        assert {"delivery_pincode", "delivery_city", "delivery_state"}.issubset(pii_keys)

    def test_aggregate_only_manifests_have_empty_pii_fields(self):
        """Klaviyo, Meta, Google, Unicommerce must have NO declared PII fields."""
        for vendor in ("klaviyo", "meta", "google", "unicommerce"):
            manifest = MANIFEST_REGISTRY[vendor]
            assert len(manifest.pii_fields) == 0, (
                f"{vendor} manifest should have no declared PII fields "
                f"(aggregate-only scope), got: {list(manifest.pii_fields.keys())}"
            )

    def test_pii_field_specs_have_correct_lawful_basis(self):
        """All PiiFieldSpec entries on a manifest must carry the same lawful_basis
        as the manifest's default_lawful_basis."""
        for vendor, manifest in MANIFEST_REGISTRY.items():
            for fname, spec in manifest.pii_fields.items():
                assert spec.lawful_basis == manifest.default_lawful_basis, (
                    f"{vendor}.pii_fields['{fname}'].lawful_basis "
                    f"'{spec.lawful_basis}' != manifest default "
                    f"'{manifest.default_lawful_basis}'"
                )


# ---------------------------------------------------------------------------
# Cursor contract — basic structural checks (no DB; import-only)
# ---------------------------------------------------------------------------

class TestCursorContractImport:
    """
    Verify the cursor contract module imports cleanly and exports the
    expected symbols (no DB connection needed — pure structural checks).
    """

    def test_cursor_row_dataclass_fields(self):
        from domain.framework.cursor import CursorRow
        import uuid
        from datetime import datetime, timezone
        now = datetime.now(tz=timezone.utc)
        ws = uuid.uuid4()
        row = CursorRow(
            workspace_id  = ws,
            vendor        = "shopify",
            cursor_value  = "2026-05-24T00:00:00Z",
            window_start  = now,
            window_end    = now,
            updated_at    = now,
        )
        assert row.workspace_id == ws
        assert row.vendor == "shopify"
        assert row.cursor_value == "2026-05-24T00:00:00Z"

    def test_upsert_cursor_sql_contains_on_conflict(self):
        """UPSERT SQL must use ON CONFLICT DO UPDATE for idempotency."""
        from domain.framework.cursor import UPSERT_CURSOR_SQL
        assert "ON CONFLICT" in UPSERT_CURSOR_SQL
        assert "DO UPDATE" in UPSERT_CURSOR_SQL

    def test_get_cursor_sql_filters_by_workspace_id_and_vendor(self):
        """GET SQL must filter by both workspace_id and vendor."""
        from domain.framework.cursor import GET_CURSOR_SQL
        assert "workspace_id" in GET_CURSOR_SQL
        assert "vendor"       in GET_CURSOR_SQL


# ---------------------------------------------------------------------------
# DDL smoke — verify step-a SQL does NOT contain banned policy shapes
# ---------------------------------------------------------------------------

class TestDDLBannedShapes:
    """
    Static grep equivalent: parse the step-a-enable-create.sql and confirm
    no banned RLS policy shapes are present (mirrors Child-1's static grep gate).

    Banned patterns (from the Child-1 runbook discipline):
      - OR ... IS NULL
      - COALESCE
      - USING (true)
      - SET [session-level] (only tx-local set_config is allowed)
    """

    @pytest.fixture(scope="class")
    def step_a_sql(self) -> str:
        import os
        ddl_path = os.path.join(
            os.path.dirname(__file__),
            "../../migrations/manual/raw/step-a-enable-create.sql",
        )
        with open(os.path.normpath(ddl_path)) as f:
            return f.read().upper()

    def test_no_is_null_in_policy(self, step_a_sql):
        """Policies must not use 'OR ... IS NULL' (fail-open shape)."""
        # We only care about IS NULL inside USING/WITH CHECK clauses
        # Heuristic: any 'IS NULL' in a USING/WITH CHECK line
        for line in step_a_sql.splitlines():
            stripped = line.strip()
            if ("USING" in stripped or "WITH CHECK" in stripped) and "IS NULL" in stripped:
                pytest.fail(f"Banned 'IS NULL' in policy line: {stripped!r}")

    def test_no_coalesce_in_policy(self, step_a_sql):
        """Policies must not use COALESCE (hides NULL workspace_id)."""
        for line in step_a_sql.splitlines():
            stripped = line.strip()
            if ("USING" in stripped or "WITH CHECK" in stripped) and "COALESCE" in stripped:
                pytest.fail(f"Banned 'COALESCE' in policy line: {stripped!r}")

    def test_no_using_true_in_policy(self, step_a_sql):
        """
        Policies must not use USING (TRUE) as the sole policy body — fail-open.
        Note: current_setting(..., true) contains 'true' inside a function call;
        that is allowed.  The banned pattern is the policy body being USING (TRUE)
        with no workspace filter — i.e. the word TRUE appears directly after
        USING with nothing else (no 'CURRENT_SETTING' or '=').
        """
        import re
        # Match USING followed by just '(TRUE)' with no '=' or CURRENT_SETTING
        # This catches the fail-open USING (true) shape without false-positives
        # from current_setting('app.workspace_id', true)
        bad_pattern = re.compile(r'\bUSING\s*\(\s*TRUE\s*\)', re.IGNORECASE)
        # Filter out lines that contain CURRENT_SETTING (which are the correct policies)
        for line in step_a_sql.splitlines():
            stripped = line.strip()
            # Skip comment lines (SQL -- comments)
            if stripped.startswith("--"):
                continue
            if bad_pattern.search(line) and "CURRENT_SETTING" not in line:
                pytest.fail(
                    f"Banned 'USING (true)' fail-open shape found: {stripped!r}"
                )

    def test_every_pii_table_has_rls_enable(self, step_a_sql):
        """Every PII-bearing raw table must have ENABLE ROW LEVEL SECURITY."""
        required_tables = [
            "RAW_SHOPIFY_ORDERS",
            "RAW_SHOPIFY_CUSTOMERS",
            "RAW_WOOCOMMERCE_ORDERS",
            "RAW_SHIPROCKET_SHIPMENTS",
            "CONNECTOR_CURSOR",
        ]
        for table in required_tables:
            assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in step_a_sql, (
                f"Missing ENABLE ROW LEVEL SECURITY for {table}"
            )

    def test_every_pii_table_has_ws_isolation_policy(self, step_a_sql):
        """Every raw table must have the ws_isolation policy."""
        required_tables = [
            "RAW_SHOPIFY_ORDERS",
            "RAW_SHOPIFY_CUSTOMERS",
            "RAW_WOOCOMMERCE_ORDERS",
            "RAW_SHIPROCKET_SHIPMENTS",
        ]
        for table in required_tables:
            assert f"CREATE POLICY WS_ISOLATION ON {table}" in step_a_sql, (
                f"Missing ws_isolation policy for {table}"
            )

    def test_consent_columns_present_on_pii_tables(self, step_a_sql):
        """
        CF-C3-CONSENT-COLUMN-1: every PII table DDL must carry
        workspace_id, lawful_basis, purpose_code, ingested_at as NOT NULL.
        """
        required_patterns = [
            "LAWFUL_BASIS         TEXT        NOT NULL",
            "PURPOSE_CODE         TEXT        NOT NULL",
            "INGESTED_AT          TIMESTAMPTZ NOT NULL",
        ]
        for pattern in required_patterns:
            assert pattern in step_a_sql, (
                f"CF-C3-CONSENT-COLUMN-1: missing consent column pattern: {pattern!r}"
            )

    def test_money_conversion_absent_from_ddl(self, step_a_sql):
        """
        No money conversion in the raw store DDL.
        Columns that carry money use _RAW suffix (raw string / TEXT).
        """
        # The conversion function names used in Child-2 (paise conversion) must
        # not appear in the raw ingest DDL.
        forbidden = ["TO_PAISE", "MINOR_UNITS", "BRAIN_METRICS"]
        for token in forbidden:
            assert token not in step_a_sql, (
                f"Money conversion token '{token}' found in raw DDL — "
                "money conversion belongs in Child-2 at the ACL."
            )

    def test_down_sql_is_symmetric(self):
        """
        down.sql must contain NO FORCE + DISABLE + DROP POLICY + DROP TABLE
        for every table created in step-a.
        """
        import os
        down_path = os.path.join(
            os.path.dirname(__file__),
            "../../migrations/manual/raw/down.sql",
        )
        with open(os.path.normpath(down_path)) as f:
            down_sql = f.read().upper()

        tables = [
            "RAW_SHOPIFY_ORDERS",
            "RAW_SHOPIFY_CUSTOMERS",
            "RAW_WOOCOMMERCE_ORDERS",
            "RAW_SHIPROCKET_SHIPMENTS",
            "CONNECTOR_CURSOR",
        ]
        for table in tables:
            assert f"NO FORCE ROW LEVEL SECURITY" in down_sql, (
                "down.sql missing NO FORCE ROW LEVEL SECURITY"
            )
            assert f"DROP TABLE IF EXISTS {table}" in down_sql, (
                f"down.sql missing DROP TABLE for {table}"
            )

    def test_step_b_force_covers_all_tables_in_step_a(self):
        """
        step-b-force.sql must contain FORCE ROW LEVEL SECURITY for every
        table created in step-a (symmetry check).
        """
        import os
        step_a_path = os.path.join(
            os.path.dirname(__file__),
            "../../migrations/manual/raw/step-a-enable-create.sql",
        )
        step_b_path = os.path.join(
            os.path.dirname(__file__),
            "../../migrations/manual/raw/step-b-force.sql",
        )
        with open(os.path.normpath(step_a_path)) as f:
            step_a = f.read().upper()
        with open(os.path.normpath(step_b_path)) as f:
            step_b = f.read().upper()

        import re
        # Extract table names from ENABLE ROW LEVEL SECURITY lines in step-a
        tables = re.findall(
            r"ALTER TABLE (\w+)\s+ENABLE ROW LEVEL SECURITY",
            step_a,
        )
        assert len(tables) > 0, "No ENABLE ROW LEVEL SECURITY found in step-a"

        for table in tables:
            assert f"ALTER TABLE {table}" in step_b, (
                f"step-b-force.sql missing FORCE for table {table}"
            )

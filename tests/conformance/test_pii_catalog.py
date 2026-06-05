"""
test_pii_catalog.py — Tests for docs/pii-catalog.yaml + check_pii_catalog.py (P1-E).

@paradigm: sql
Cost-routing: pure Python/YAML, zero LLM tokens.

Tests both positive and negative scenarios:
  POSITIVE: all connectors in MANIFEST_REGISTRY have catalog entries
  POSITIVE: all PII fields in manifests appear in the catalog
  NEGATIVE: a connector NOT in catalog fails the gate (exit 1)
  NEGATIVE: a PII field missing from catalog fails the gate
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# POSITIVE: pii-catalog.yaml is present and well-formed
# ---------------------------------------------------------------------------

class TestPiiCatalogPresent:
    """POSITIVE: docs/pii-catalog.yaml exists and has the required structure."""

    def _load_catalog(self) -> dict:
        import yaml
        path = _REPO / "docs" / "pii-catalog.yaml"
        assert path.exists(), f"pii-catalog.yaml must exist at {path}"
        return yaml.safe_load(path.read_text(encoding="utf-8"))

    def test_catalog_file_exists(self) -> None:
        assert (_REPO / "docs" / "pii-catalog.yaml").exists(), (
            "docs/pii-catalog.yaml must exist. Create it per P1-E task 5."
        )

    def test_catalog_has_connectors_key(self) -> None:
        data = self._load_catalog()
        assert "connectors" in data, (
            "pii-catalog.yaml must have a top-level 'connectors' key."
        )

    def test_all_expected_connectors_present(self) -> None:
        data = self._load_catalog()
        connectors = data["connectors"]
        expected = ["shopify", "woocommerce", "shiprocket", "klaviyo", "meta", "google", "unicommerce"]
        for vendor in expected:
            assert vendor in connectors, (
                f"Connector '{vendor}' must have an entry in pii-catalog.yaml."
            )

    def test_each_connector_has_required_keys(self) -> None:
        data = self._load_catalog()
        for vendor, entry in data["connectors"].items():
            assert "pii_fields" in entry, (
                f"Connector '{vendor}' must have 'pii_fields' key in pii-catalog.yaml "
                f"(can be empty dict for non-PII connectors)."
            )
            assert "lawful_basis" in entry, (
                f"Connector '{vendor}' must declare 'lawful_basis' in pii-catalog.yaml."
            )
            assert "purpose_code" in entry, (
                f"Connector '{vendor}' must declare 'purpose_code' in pii-catalog.yaml."
            )

    def test_shopify_pii_fields_declared(self) -> None:
        data = self._load_catalog()
        shopify = data["connectors"]["shopify"]
        pii = shopify["pii_fields"]
        for field in ["email", "first_name", "last_name"]:
            assert field in pii, (
                f"Shopify PII field '{field}' must be in pii-catalog.yaml."
            )

    def test_woocommerce_address_fields_removed(self) -> None:
        """P0-B DPDP gate: billing_address_1 / shipping_address_1 removed from WooCommerce."""
        data = self._load_catalog()
        woo = data["connectors"]["woocommerce"]
        pii = woo.get("pii_fields", {})
        assert "billing_address_1" not in pii, (
            "P0-B DPDP GATE: billing_address_1 must NOT be in woocommerce pii_fields. "
            "Full street addresses are prohibited."
        )
        assert "shipping_address_1" not in pii, (
            "P0-B DPDP GATE: shipping_address_1 must NOT be in woocommerce pii_fields."
        )
        # But the removed_fields section should document why
        removed = woo.get("removed_fields", {})
        assert "billing_address_1" in removed, (
            "billing_address_1 removal must be documented in woocommerce.removed_fields."
        )

    def test_non_pii_connectors_have_empty_fields(self) -> None:
        """Klaviyo, Meta, Google, Unicommerce are non-PII connectors."""
        data = self._load_catalog()
        non_pii = ["klaviyo", "meta", "google", "unicommerce"]
        for vendor in non_pii:
            if vendor in data["connectors"]:
                pii = data["connectors"][vendor].get("pii_fields", {})
                assert pii == {} or pii is None or len(pii) == 0, (
                    f"Connector '{vendor}' is a non-PII connector; pii_fields must be empty. "
                    f"If individual PII is added, update this test + get Security (Shreya) VETO."
                )

    def test_shiprocket_location_fields_declared(self) -> None:
        data = self._load_catalog()
        ship = data["connectors"]["shiprocket"]
        pii = ship["pii_fields"]
        for field in ["delivery_pincode", "delivery_city", "delivery_state"]:
            assert field in pii, (
                f"Shiprocket location field '{field}' must be in pii-catalog.yaml."
            )


# ---------------------------------------------------------------------------
# POSITIVE: check_pii_catalog.py gates pass on actual catalog
# ---------------------------------------------------------------------------

class TestPiiCatalogGatePass:
    """POSITIVE: check_pii_catalog.py returns 0 on the actual catalog."""

    def test_catalog_gate_passes(self) -> None:
        sys.path.insert(0, str(_REPO))
        try:
            from tools.ci.check_pii_catalog import main as catalog_main
            result = catalog_main()
            assert result == 0, (
                "check_pii_catalog.py must pass (exit 0) on the actual Brain codebase. "
                "A connector's PII fields are missing from docs/pii-catalog.yaml. "
                "Run: python tools/ci/check_pii_catalog.py for details."
            )
        finally:
            if str(_REPO) in sys.path:
                sys.path.remove(str(_REPO))


# ---------------------------------------------------------------------------
# NEGATIVE: missing connector entry fails the gate
# ---------------------------------------------------------------------------

class TestPiiCatalogGateFail:
    """NEGATIVE: gate fails when a connector is missing from the catalog."""

    def test_gate_fails_when_connector_missing_from_catalog(self, tmp_path: Path, monkeypatch) -> None:
        """A connector in MANIFEST_REGISTRY not in pii-catalog.yaml → CI fail."""
        import yaml

        # Create a catalog that's missing 'shopify'
        catalog_data = {
            "connectors": {
                "meta": {
                    "display_name": "Meta Ads",
                    "lawful_basis": "owner_brand_controller",
                    "purpose_code": "analytics_performance",
                    "pii_fields": {},
                }
            }
        }
        catalog_path = tmp_path / "pii-catalog.yaml"
        catalog_path.write_text(yaml.dump(catalog_data))

        sys.path.insert(0, str(_REPO))
        try:
            from tools.ci import check_pii_catalog as module_ref
            # Monkeypatch the catalog path
            original_catalog = module_ref._CATALOG
            module_ref._CATALOG = catalog_path
            try:
                result = module_ref.main()
            finally:
                module_ref._CATALOG = original_catalog
        finally:
            if str(_REPO) in sys.path:
                sys.path.remove(str(_REPO))

        assert result == 1, (
            "check_pii_catalog must return 1 when a connector (shopify) is missing "
            "from the catalog. P1-E acceptance: 'a new adapter without a catalog entry fails CI'."
        )

    def test_gate_fails_when_pii_field_missing_from_catalog(self, tmp_path: Path, monkeypatch) -> None:
        """A PII field in pii_manifest not in catalog → CI fail."""
        import yaml

        # Catalog that declares shopify but is missing 'email' field
        catalog_data = {
            "connectors": {
                "shopify": {
                    "display_name": "Shopify",
                    "lawful_basis": "owner_brand_controller",
                    "purpose_code": "analytics_performance",
                    "pii_fields": {
                        # Missing: email, first_name, last_name
                        "some_other_field": {
                            "category": "contact",
                            "description": "Not a real Shopify field",
                            "dpdp_category": "contact_data",
                        }
                    },
                },
                # Add all other connectors with empty pii_fields to avoid cascade failures
                "woocommerce": {"display_name": "Woo", "lawful_basis": "x", "purpose_code": "y", "pii_fields": {
                    "customer_email": {"category": "contact", "description": "x", "dpdp_category": "c"},
                    "customer_phone": {"category": "contact", "description": "x", "dpdp_category": "c"},
                    "billing_first_name": {"category": "contact", "description": "x", "dpdp_category": "c"},
                    "billing_last_name": {"category": "contact", "description": "x", "dpdp_category": "c"},
                    "billing_city": {"category": "location", "description": "x", "dpdp_category": "l"},
                    "billing_state": {"category": "location", "description": "x", "dpdp_category": "l"},
                    "billing_postcode": {"category": "location", "description": "x", "dpdp_category": "l"},
                    "shipping_first_name": {"category": "contact", "description": "x", "dpdp_category": "c"},
                    "shipping_last_name": {"category": "contact", "description": "x", "dpdp_category": "c"},
                    "shipping_city": {"category": "location", "description": "x", "dpdp_category": "l"},
                    "shipping_state": {"category": "location", "description": "x", "dpdp_category": "l"},
                    "shipping_postcode": {"category": "location", "description": "x", "dpdp_category": "l"},
                }},
                "shiprocket": {"display_name": "Ship", "lawful_basis": "x", "purpose_code": "y", "pii_fields": {
                    "delivery_pincode": {"category": "location", "description": "x", "dpdp_category": "l"},
                    "delivery_city": {"category": "location", "description": "x", "dpdp_category": "l"},
                    "delivery_state": {"category": "location", "description": "x", "dpdp_category": "l"},
                }},
                "klaviyo": {"display_name": "Klaviyo", "lawful_basis": "x", "purpose_code": "y", "pii_fields": {}},
                "meta": {"display_name": "Meta", "lawful_basis": "x", "purpose_code": "y", "pii_fields": {}},
                "google": {"display_name": "Google", "lawful_basis": "x", "purpose_code": "y", "pii_fields": {}},
                "unicommerce": {"display_name": "Uni", "lawful_basis": "x", "purpose_code": "y", "pii_fields": {}},
            }
        }
        catalog_path = tmp_path / "pii-catalog.yaml"
        catalog_path.write_text(yaml.dump(catalog_data))

        sys.path.insert(0, str(_REPO))
        try:
            from tools.ci import check_pii_catalog as module_ref
            original_catalog = module_ref._CATALOG
            module_ref._CATALOG = catalog_path
            try:
                result = module_ref.main()
            finally:
                module_ref._CATALOG = original_catalog
        finally:
            if str(_REPO) in sys.path:
                sys.path.remove(str(_REPO))

        assert result == 1, (
            "check_pii_catalog must return 1 when a PII field (email, first_name, last_name) "
            "is declared in pii_manifest but missing from the catalog."
        )

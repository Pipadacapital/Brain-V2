"""
Unit tests for domain/transform/transform_registry.py (P1-B Task 2).

Acceptance contract (c): a new (vendor, event_type) is added by a registry
row + a mapper only — no consumer edit.

Covers:
  POSITIVE:
    - Register + dispatch a mapper → correct SilverFact returned.
    - Dispatch with no mapper → None (skip, not DLQ).
    - Dispatcher injects raw_event_id into MapperResult.
    - Two different (vendor, event_type) pairs coexist.
    - Shopify "orders/create" mapper built-in (canonical first mapper).
    - Registry key is case-insensitive (SHOPIFY == shopify; Orders/Create == orders/create).

  NEGATIVE:
    - Duplicate (vendor, event_type) registration raises ValueError.
    - Mapper returning None → dispatch returns None (skip).
    - Mapper raising exception propagates up (caller DLQ-routes it).
    - Registry key with mixed case normalises correctly.
"""

from __future__ import annotations

import pytest

from src.domain.transform.transform_registry import (
    TransformRegistry,
    MapperResult,
    get_registry,
    _REGISTRY,
    _shopify_order_mapper,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def fresh_registry() -> TransformRegistry:
    """Return a new (empty) TransformRegistry for isolation."""
    return TransformRegistry()


def _make_order_mapper():
    """Simple mapper that returns a fixed SilverFact dict."""
    def mapper(raw):
        return {
            "workspace_id": raw.get("workspace_id", "ws-1"),
            "vendor_order_id": raw.get("id", "ord-1"),
            "gross_sales_mu": 100,
        }
    return mapper


# ---------------------------------------------------------------------------
# POSITIVE — registration + dispatch
# ---------------------------------------------------------------------------

class TestRegistration:
    def test_register_and_get(self, fresh_registry: TransformRegistry) -> None:
        fresh_registry.register("SHOPIFY", "orders/create", "connector_order_facts", _make_order_mapper())
        entry = fresh_registry.get("SHOPIFY", "orders/create")
        assert entry is not None
        table, fn = entry
        assert table == "connector_order_facts"
        assert callable(fn)

    def test_register_case_insensitive_vendor(self, fresh_registry: TransformRegistry) -> None:
        """Vendor is stored uppercase; lookup is case-insensitive."""
        fresh_registry.register("shopify", "orders/create", "connector_order_facts", _make_order_mapper())
        assert fresh_registry.get("SHOPIFY", "orders/create") is not None
        assert fresh_registry.get("shopify", "orders/create") is not None

    def test_register_case_insensitive_event_type(self, fresh_registry: TransformRegistry) -> None:
        """Event type is stored lowercase; lookup is case-insensitive."""
        fresh_registry.register("SHOPIFY", "Orders/Create", "connector_order_facts", _make_order_mapper())
        assert fresh_registry.get("SHOPIFY", "orders/create") is not None
        assert fresh_registry.get("SHOPIFY", "Orders/Create") is not None

    def test_two_pairs_coexist(self, fresh_registry: TransformRegistry) -> None:
        """Two different (vendor, event_type) pairs can be registered independently."""
        def mapper_a(raw): return {"key": "a"}
        def mapper_b(raw): return {"key": "b"}
        fresh_registry.register("SHOPIFY", "orders/create", "order_facts", mapper_a)
        fresh_registry.register("META", "campaign.daily", "ad_facts", mapper_b)
        assert len(fresh_registry) == 2
        assert fresh_registry.get("SHOPIFY", "orders/create") is not None
        assert fresh_registry.get("META", "campaign.daily") is not None

    def test_registered_keys(self, fresh_registry: TransformRegistry) -> None:
        fresh_registry.register("SHOPIFY", "order", "connector_order_facts", _make_order_mapper())
        fresh_registry.register("META", "campaign.daily", "ad_facts", _make_order_mapper())
        keys = fresh_registry.registered_keys
        assert ("SHOPIFY", "order") in keys
        assert ("META", "campaign.daily") in keys


class TestDispatch:
    def test_dispatch_returns_mapper_result(self, fresh_registry: TransformRegistry) -> None:
        def my_mapper(raw):
            return {"vendor_order_id": raw.get("id", "x"), "gross_sales_mu": 42}
        fresh_registry.register("SHOPIFY", "orders/create", "connector_order_facts", my_mapper)

        result = fresh_registry.dispatch("SHOPIFY", "orders/create", {"id": "order-1"}, raw_event_id="raw-abc")
        assert isinstance(result, MapperResult)
        assert result.silver_table == "connector_order_facts"
        assert result.fact["vendor_order_id"] == "order-1"
        assert result.raw_event_id == "raw-abc"
        assert result.provenance == "transform_worker"

    def test_dispatch_no_mapper_returns_none(self, fresh_registry: TransformRegistry) -> None:
        """Unknown (vendor, event_type) → None (skip, not DLQ)."""
        result = fresh_registry.dispatch("UNKNOWN", "some/event", {})
        assert result is None

    def test_dispatch_raw_event_id_embedded(self, fresh_registry: TransformRegistry) -> None:
        def mapper(raw): return {"key": "val"}
        fresh_registry.register("SHOPIFY", "test.event", "some_table", mapper)
        result = fresh_registry.dispatch("SHOPIFY", "test.event", {}, raw_event_id="idem-key-123")
        assert result is not None
        assert result.raw_event_id == "idem-key-123"

    def test_global_registry_has_shopify_orders_create(self) -> None:
        """The global registry must have the built-in Shopify orders/create mapper."""
        result = _REGISTRY.dispatch(
            "SHOPIFY", "orders/create",
            {"vendor_order_id": "123", "currency_code": "INR"},
            raw_event_id="idem-xyz",
        )
        assert result is not None
        assert result.silver_table == "connector_order_facts"
        assert result.raw_event_id == "idem-xyz"

    def test_global_registry_has_shopify_order_variant(self) -> None:
        """The global registry must also handle 'order' (alias variant)."""
        result = _REGISTRY.dispatch(
            "SHOPIFY", "order",
            {"id": "456", "currency_code": "INR"},
            raw_event_id="idem-order",
        )
        assert result is not None
        assert result.silver_table == "connector_order_facts"


# ---------------------------------------------------------------------------
# NEGATIVE — validation + error propagation
# ---------------------------------------------------------------------------

class TestNegativeCases:
    def test_duplicate_registration_raises_value_error(self, fresh_registry: TransformRegistry) -> None:
        """Second register() for same key must raise ValueError (Single-Primitive Rule)."""
        fresh_registry.register("SHOPIFY", "orders/create", "table_a", _make_order_mapper())
        with pytest.raises(ValueError, match="duplicate mapper"):
            fresh_registry.register("SHOPIFY", "orders/create", "table_b", _make_order_mapper())

    def test_dispatch_mapper_raises_propagates(self, fresh_registry: TransformRegistry) -> None:
        """Mapper exceptions propagate up (caller DLQ-routes them)."""
        def broken_mapper(raw):
            raise KeyError("missing required field")
        fresh_registry.register("SHOPIFY", "broken.event", "table", broken_mapper)
        with pytest.raises(KeyError, match="missing required field"):
            fresh_registry.dispatch("SHOPIFY", "broken.event", {})

    def test_dispatch_mapper_returns_none_skips(self, fresh_registry: TransformRegistry) -> None:
        """Mapper returning None → dispatch returns None (skip without error)."""
        def none_mapper(raw): return None
        fresh_registry.register("SHOPIFY", "null.event", "table", none_mapper)
        result = fresh_registry.dispatch("SHOPIFY", "null.event", {})
        assert result is None

    def test_get_returns_none_for_unknown_key(self, fresh_registry: TransformRegistry) -> None:
        result = fresh_registry.get("COMPLETELY_UNKNOWN_VENDOR", "no_such_event")
        assert result is None


# ---------------------------------------------------------------------------
# Shopify mapper unit tests
# ---------------------------------------------------------------------------

class TestShopifyOrderMapper:
    def test_basic_mapping(self) -> None:
        raw = {
            "vendor_order_id": "gid://shopify/Order/123",
            "currency_code": "INR",
            "gross_sales_mu": 50000,
            "total_discount_mu": 5000,
            "total_tax_mu": 900,
            "shipping_mu": 99,
            "financial_status": "paid",
            "customer_ref": "tok:abc123",
        }
        result = _shopify_order_mapper(raw)
        assert result is not None
        assert result["vendor_order_id"] == "gid://shopify/Order/123"
        assert result["gross_sales_mu"] == 50000
        assert result["vendor"] == "SHOPIFY"
        assert result["customer_ref"] == "tok:abc123"

    def test_missing_vendor_order_id_returns_none(self) -> None:
        """If vendor_order_id missing, mapper returns None (cannot form unique key)."""
        result = _shopify_order_mapper({"currency_code": "INR"})
        assert result is None

    def test_defaults_filled(self) -> None:
        """Optional fields get safe defaults rather than raising."""
        raw = {"vendor_order_id": "ord-1", "currency_code": "INR"}
        result = _shopify_order_mapper(raw)
        assert result is not None
        assert result["gross_sales_mu"] == 0
        assert result["is_cod"] is False
        assert result["financial_status"] == ""

    def test_id_field_as_fallback(self) -> None:
        """If vendor_order_id not present, falls back to 'id' field."""
        raw = {"id": "123456", "currency_code": "INR"}
        result = _shopify_order_mapper(raw)
        assert result is not None
        assert result["vendor_order_id"] == "123456"

"""
Unit tests for application/use_cases/graduate_raw_event.py (P1-B Task 1,3).

Acceptance contract:
  (d) re-run over the same bronze rows is idempotent (silver UPSERT keyed).
  (e) raw_event_id on every silver row.

Covers:
  POSITIVE:
    - Valid Shopify order payload → GraduationResult with success=True + silver_table set.
    - raw_event_id stamped on the UPSERT parameters.
    - provenance='transform_worker' stamped on every new row.
    - Unknown (vendor, event_type) → GraduationResult skipped=True (not an error).
    - Re-running with same raw_event_id → still success (idempotent contract).

  NEGATIVE:
    - Malformed JSON → ValueError raised (DLQ-able).
    - Mapper error (KeyError) → re-raised (DLQ-able).
    - DB error → re-raised (cursor must NOT advance on DB failure).
    - Missing silver_table in _UPSERT_SQL_BY_TABLE → ValueError raised.
"""

from __future__ import annotations

import json
from typing import Any, Optional
import pytest

from src.domain.transform.transform_registry import TransformRegistry
from src.application.use_cases.graduate_raw_event import (
    graduate_raw_event,
    GraduationResult,
    _UPSERT_SQL_BY_TABLE,
)


# ---------------------------------------------------------------------------
# Fake PG connection for unit tests
# ---------------------------------------------------------------------------

class _FakeCursor:
    """Records execute calls."""
    def __init__(self):
        self.calls: list[tuple] = []
        self.should_raise: Optional[Exception] = None

    def execute(self, sql: str, params: Any = None) -> None:
        if self.should_raise:
            raise self.should_raise
        self.calls.append((sql, params))

    def __enter__(self): return self
    def __exit__(self, *args): pass


class _FakePGConn:
    """Sync fake PG connection (graduate_raw_event has a sync fallback for tests)."""
    def __init__(self, should_raise: Optional[Exception] = None):
        self._cursor = _FakeCursor()
        self._cursor.should_raise = should_raise

    def cursor(self):
        return self._cursor

    @property
    def last_cursor(self) -> _FakeCursor:
        return self._cursor


# ---------------------------------------------------------------------------
# Helper fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def registry() -> TransformRegistry:
    """Return a fresh registry with a working Shopify order mapper."""
    r = TransformRegistry()
    def shopify_mapper(raw):
        vendor_order_id = raw.get("vendor_order_id") or raw.get("id")
        if not vendor_order_id:
            return None
        return {
            "workspace_id": raw.get("workspace_id", ""),
            "vendor": "SHOPIFY",
            "vendor_order_id": str(vendor_order_id),
            "order_number": raw.get("order_number", ""),
            "financial_status": raw.get("financial_status", "paid"),
            "fulfillment_status": "",
            "payment_method": "Prepaid",
            "currency_code": "INR",
            "gross_sales_mu": int(raw.get("gross_sales_mu", 0)),
            "total_discount_mu": 0,
            "total_tax_mu": 0,
            "shipping_mu": 0,
            "customer_ref": raw.get("customer_ref", ""),
            "is_new_customer": False,
            "delivery_pincode": "",
            "delivery_city": "",
            "processed_at": None,
            "cancelled_at": None,
            "is_cod": False,
            "order_type": "",
            "total_refund_mu": 0,
        }
    r.register("SHOPIFY", "orders/create", "connector_order_facts", shopify_mapper)
    return r


@pytest.fixture()
def shopify_payload() -> str:
    return json.dumps({
        "vendor_order_id": "gid://shopify/Order/12345",
        "currency_code": "INR",
        "gross_sales_mu": 99900,
        "customer_ref": "tok:abc123",
        "financial_status": "paid",
    })


# ---------------------------------------------------------------------------
# POSITIVE
# ---------------------------------------------------------------------------

class TestGraduateRawEventPositive:
    @pytest.mark.asyncio
    async def test_successful_graduation(
        self, registry: TransformRegistry, shopify_payload: str
    ) -> None:
        pg = _FakePGConn()
        result = await graduate_raw_event(
            workspace_id="ws-uuid-1",
            vendor="SHOPIFY",
            event_type="orders/create",
            payload_json=shopify_payload,
            raw_event_id="idem-key-001",
            pg_conn=pg,
            registry=registry,
        )
        assert isinstance(result, GraduationResult)
        assert result.success is True
        assert result.skipped is False
        assert result.silver_table == "connector_order_facts"
        assert result.raw_event_id == "idem-key-001"
        assert result.error is None

    @pytest.mark.asyncio
    async def test_raw_event_id_stamped_in_upsert(
        self, registry: TransformRegistry, shopify_payload: str
    ) -> None:
        """raw_event_id must appear in the UPSERT params (acceptance e)."""
        pg = _FakePGConn()
        await graduate_raw_event(
            workspace_id="ws-uuid-1",
            vendor="SHOPIFY",
            event_type="orders/create",
            payload_json=shopify_payload,
            raw_event_id="idem-stamp-test",
            pg_conn=pg,
            registry=registry,
        )
        # The UPSERT params should contain raw_event_id
        assert pg.last_cursor.calls, "Expected at least one DB execute call"
        _sql, params = pg.last_cursor.calls[0]
        assert params is not None
        assert params.get("raw_event_id") == "idem-stamp-test"

    @pytest.mark.asyncio
    async def test_provenance_stamped(
        self, registry: TransformRegistry, shopify_payload: str
    ) -> None:
        pg = _FakePGConn()
        await graduate_raw_event(
            workspace_id="ws-uuid-1",
            vendor="SHOPIFY",
            event_type="orders/create",
            payload_json=shopify_payload,
            raw_event_id="idem-prov",
            pg_conn=pg,
            registry=registry,
        )
        _sql, params = pg.last_cursor.calls[0]
        assert params.get("provenance") == "transform_worker"

    @pytest.mark.asyncio
    async def test_unknown_event_type_skips(
        self, registry: TransformRegistry
    ) -> None:
        """(vendor, event_type) with no mapper → skipped=True, success=True, no DB call."""
        pg = _FakePGConn()
        payload = json.dumps({"id": "ord-1", "currency_code": "INR"})
        result = await graduate_raw_event(
            workspace_id="ws-uuid-1",
            vendor="SHOPIFY",
            event_type="customers/create",  # no mapper registered
            payload_json=payload,
            raw_event_id="idem-skip",
            pg_conn=pg,
            registry=registry,
        )
        assert result.skipped is True
        assert result.success is True
        assert result.silver_table is None
        assert not pg.last_cursor.calls, "No DB call expected for skipped event"

    @pytest.mark.asyncio
    async def test_idempotent_rerun(
        self, registry: TransformRegistry, shopify_payload: str
    ) -> None:
        """Re-running with same raw_event_id is idempotent (ON CONFLICT DO UPDATE)."""
        pg = _FakePGConn()
        result1 = await graduate_raw_event(
            workspace_id="ws-uuid-1", vendor="SHOPIFY", event_type="orders/create",
            payload_json=shopify_payload, raw_event_id="idem-key-001", pg_conn=pg, registry=registry,
        )
        result2 = await graduate_raw_event(
            workspace_id="ws-uuid-1", vendor="SHOPIFY", event_type="orders/create",
            payload_json=shopify_payload, raw_event_id="idem-key-001", pg_conn=pg, registry=registry,
        )
        assert result1.success is True
        assert result2.success is True
        # Both runs execute the ON CONFLICT upsert (2 calls total is idempotent)
        assert len(pg.last_cursor.calls) == 2

    @pytest.mark.asyncio
    async def test_workspace_id_injected_into_fact(
        self, registry: TransformRegistry
    ) -> None:
        """workspace_id from the function arg is set in the fact even if not in payload."""
        pg = _FakePGConn()
        payload = json.dumps({"vendor_order_id": "ord-99", "currency_code": "INR"})
        await graduate_raw_event(
            workspace_id="ws-injected-123",
            vendor="SHOPIFY",
            event_type="orders/create",
            payload_json=payload,
            raw_event_id="idem-ws-inject",
            pg_conn=pg,
            registry=registry,
        )
        _sql, params = pg.last_cursor.calls[0]
        assert params.get("workspace_id") == "ws-injected-123"


# ---------------------------------------------------------------------------
# NEGATIVE
# ---------------------------------------------------------------------------

class TestGraduateRawEventNegative:
    @pytest.mark.asyncio
    async def test_malformed_json_raises_value_error(
        self, registry: TransformRegistry
    ) -> None:
        """Malformed JSON → ValueError (DLQ-able, terminal)."""
        pg = _FakePGConn()
        with pytest.raises(ValueError, match="JSON decode failed"):
            await graduate_raw_event(
                workspace_id="ws-uuid-1",
                vendor="SHOPIFY",
                event_type="orders/create",
                payload_json="{this is not json",
                raw_event_id="idem-bad-json",
                pg_conn=pg,
                registry=registry,
            )

    @pytest.mark.asyncio
    async def test_mapper_exception_propagates(self) -> None:
        """Mapper raising an exception → re-raised for DLQ routing."""
        r = TransformRegistry()
        def broken_mapper(raw):
            raise KeyError("vendor_order_id is required")
        r.register("SHOPIFY", "orders/create", "connector_order_facts", broken_mapper)
        pg = _FakePGConn()

        with pytest.raises(KeyError, match="vendor_order_id is required"):
            await graduate_raw_event(
                workspace_id="ws-uuid-1",
                vendor="SHOPIFY",
                event_type="orders/create",
                payload_json=json.dumps({"some": "data"}),
                raw_event_id="idem-mapper-error",
                pg_conn=pg,
                registry=r,
            )

    @pytest.mark.asyncio
    async def test_db_error_propagates(
        self, registry: TransformRegistry, shopify_payload: str
    ) -> None:
        """DB error → re-raised (caller must NOT advance cursor)."""
        from psycopg import OperationalError
        pg = _FakePGConn(should_raise=OperationalError("connection lost"))
        with pytest.raises(OperationalError):
            await graduate_raw_event(
                workspace_id="ws-uuid-1",
                vendor="SHOPIFY",
                event_type="orders/create",
                payload_json=shopify_payload,
                raw_event_id="idem-db-error",
                pg_conn=pg,
                registry=registry,
            )

    @pytest.mark.asyncio
    async def test_unknown_silver_table_raises_value_error(self) -> None:
        """If mapper returns a silver_table not in _UPSERT_SQL_BY_TABLE → ValueError."""
        r = TransformRegistry()
        r.register("SHOPIFY", "orders/create", "unknown_table_xyz",
                   lambda raw: {"key": "val"})
        pg = _FakePGConn()
        with pytest.raises(ValueError, match="no UPSERT SQL registered"):
            await graduate_raw_event(
                workspace_id="ws-uuid-1",
                vendor="SHOPIFY",
                event_type="orders/create",
                payload_json=json.dumps({"vendor_order_id": "x"}),
                raw_event_id="idem-no-sql",
                pg_conn=pg,
                registry=r,
            )

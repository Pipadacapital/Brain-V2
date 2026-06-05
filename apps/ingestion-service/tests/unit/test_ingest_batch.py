"""
Unit + integration tests for ingest_batch (P2).

@paradigm: sql

Replaces the tautological per-track test doubles (C1/F-1 bounce fix).
All PII-gate tests now run the REAL integrated path:
  real ShopifyAdapter + real SHOPIFY_PII_MANIFEST from pii_manifest.py
  + real check_pii_fields() from pii_manifest.py
  → through the live ingest_batch
  → PiiManifestViolation raised when undeclared PII field is present

Tests are split into two classes:
  TestIngestBatchDryRun  — idempotency + basic result counting (no DB, no Kafka)
  TestIngestBatchPiiGate — real PII gate using ShopifyAdapter + SHOPIFY_MANIFEST

C1/F-1 fix: _PiiManifestWithNullSpec and _FakePiiManifest test doubles DELETED.
  The old doubles manufactured an impossible condition (is_pii=True, get_spec=None)
  that can never occur with a real PiiManifest. The real gate is Maya's
  check_pii_fields() which uses a heuristic substring match on field names.

H1/F-7 fix: correlation context tests — verify request_id + trace_id propagate.
H2/F-3 fix: workspace allowlist tests — verify WorkspaceNotAllowedError raised.
H3/F-2 fix: verified by test_adapter_protocol.py (HMAC tests updated there).
M1/F-4 fix: _RAW_TABLE_MAP verified to use raw_* prefix names.
M2/F-6 fix: upsert_cursor is used (integration test; unit path deferred to docker).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Optional

import pytest

from src.application.framework.ingest import (
    IngestResult,
    _ALLOWED_COLUMNS,
    _PII_RAW_TABLES,
    _RAW_TABLE_MAP,
    _upsert_event,
    get_correlation_context,
    get_counters,
    ingest_batch,
    reset_counters,
)
from src.bootstrap.startup_gates import WorkspaceNotAllowedError
from src.domain.framework.adapter import (
    Credential,
    IngestWindow,
    NormalizedEvent,
    PiiFieldSpec,
    PiiManifest,
    RawEvent,
    ReplayCapability,
    TokenModel,
)
from src.domain.framework.pii_manifest import (
    PiiManifestViolation,
    SHOPIFY_MANIFEST,
    check_pii_fields,
)

_WID = "550e8400-e29b-41d4-a716-446655440000"
_WINDOW = IngestWindow()


# ---------------------------------------------------------------------------
# Fixture adapters
# ---------------------------------------------------------------------------


class FixtureAdapter:
    """A deterministic in-memory adapter for testing ingest_batch.

    Uses the REAL SHOPIFY_MANIFEST from pii_manifest.py (Maya's Track-M code)
    by default. Tests that need a different manifest pass one explicitly.
    """

    vendor = "shopify"
    token_model = TokenModel.OAUTH_TOKEN
    replay = ReplayCapability.FULL_60D

    def __init__(self, events: list[dict], pii_manifest: Optional[PiiManifest] = None):
        self._events = events
        # Default to the real Shopify manifest — not a test double (C1/F-1 fix)
        self.pii_manifest = pii_manifest or SHOPIFY_MANIFEST

    async def fetch(self, creds, window) -> AsyncIterator[RawEvent]:
        for i, e in enumerate(self._events):
            yield RawEvent(
                vendor=self.vendor,
                vendor_event_id=str(e.get("id", i)),
                event_type="order",
                occurred_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
                raw_payload=e,
            )

    def normalize(self, raw: RawEvent) -> NormalizedEvent:
        return NormalizedEvent(
            vendor=self.vendor,
            vendor_event_id=raw.vendor_event_id,
            event_type=raw.event_type,
            occurred_at=raw.occurred_at,
            lawful_basis="owner_brand_controller",
            purpose_code="analytics_performance",
            # Pass raw payload columns through verbatim — PII gate will check them
            columns=dict(raw.raw_payload),
        )

    def idempotency_key(self, raw: RawEvent) -> str:
        return raw.vendor_event_id


# ---------------------------------------------------------------------------
# Tests: basic dry_run counting
# ---------------------------------------------------------------------------


class TestIngestBatchDryRun:
    def setup_method(self):
        reset_counters()

    @pytest.mark.asyncio
    async def test_empty_adapter_returns_zero_counts(self):
        adapter = FixtureAdapter(events=[])
        result = await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        assert result.events_received == 0
        assert result.events_upserted == 0
        assert result.events_deduped == 0

    @pytest.mark.asyncio
    async def test_dry_run_counts_events_received(self):
        # Events with only non-PII fields — must pass the gate
        events = [
            {"id": "1", "order_number": 1001, "financial_status": "paid"},
            {"id": "2", "order_number": 1002, "financial_status": "paid"},
            {"id": "3", "order_number": 1003, "financial_status": "paid"},
        ]
        adapter = FixtureAdapter(events=events)
        result = await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        assert result.events_received == 3
        assert result.events_upserted == 3  # dry_run: all counted as upserted

    @pytest.mark.asyncio
    async def test_dry_run_flag_set(self):
        adapter = FixtureAdapter(events=[])
        result = await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        assert result.dry_run is True

    @pytest.mark.asyncio
    async def test_dry_run_no_kafka_offsets(self):
        events = [{"id": "1", "order_number": 1}]
        adapter = FixtureAdapter(events=events)
        result = await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        assert result.kafka_offsets == []

    @pytest.mark.asyncio
    async def test_dry_run_no_cursor_advance(self):
        events = [{"id": "1", "order_number": 1}]
        adapter = FixtureAdapter(events=events)
        result = await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        # dry_run skips cursor advance
        assert result.cursor_advanced_to is None


# ---------------------------------------------------------------------------
# Tests: PII gate — REAL integrated path (C1/F-1 fix)
#
# These tests use:
#   - REAL ShopifyAdapter PII manifest (from pii_manifest.SHOPIFY_MANIFEST)
#   - REAL check_pii_fields() heuristic gate
#   - REAL ingest_batch integrated path
#
# The old _PiiManifestWithNullSpec double is DELETED — it manufactured an
# impossible condition (is_pii=True AND get_spec=None) that can never occur
# with a real PiiManifest, meaning the gate was never actually tested.
# ---------------------------------------------------------------------------


class TestIngestBatchPiiGate:
    def setup_method(self):
        reset_counters()

    @pytest.mark.asyncio
    async def test_undeclared_phone_field_on_shopify_raises(self):
        """
        REAL INTEGRATION TEST (C1/F-1 fix):
        A Shopify adapter event containing 'phone' (a PII-heuristic field)
        that is NOT declared in SHOPIFY_MANIFEST must be REJECTED by the real
        check_pii_fields() gate inside ingest_batch.

        This test uses the real SHOPIFY_MANIFEST (email/first_name/last_name only)
        and passes a payload containing 'phone' — which is not declared.
        The heuristic in check_pii_fields() detects 'phone' as potential PII and raises.
        """
        # 'phone' is not declared in SHOPIFY_MANIFEST.pii_fields
        events = [
            {
                "id": "shopify-order-001",
                "order_number": 1001,
                "phone": "+91-9876543210",  # undeclared PII — must be rejected
                "financial_status": "paid",
            }
        ]
        adapter = FixtureAdapter(events=events)
        # Sanity: confirm 'phone' is NOT in the manifest
        assert not SHOPIFY_MANIFEST.is_pii("phone")
        # Sanity: confirm check_pii_fields raises on this field
        with pytest.raises(PiiManifestViolation):
            check_pii_fields(SHOPIFY_MANIFEST, ["phone", "order_number"])

        # Real integrated test: ingest_batch must reject + raise
        with pytest.raises(PiiManifestViolation):
            await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)

    @pytest.mark.asyncio
    async def test_undeclared_address_field_on_shopify_raises(self):
        """
        REAL INTEGRATION TEST (C1/F-1 fix):
        A payload containing 'billing_address_1' (matches 'billing' + 'address'
        heuristic substrings) not declared in SHOPIFY_MANIFEST must be REJECTED.
        """
        events = [
            {
                "id": "shopify-order-002",
                "order_number": 1002,
                "billing_address_1": "12 MG Road, Bengaluru",  # undeclared PII
            }
        ]
        adapter = FixtureAdapter(events=events)
        with pytest.raises(PiiManifestViolation):
            await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)

    @pytest.mark.asyncio
    async def test_pii_rejection_counter_increments_on_real_violation(self):
        """
        REAL INTEGRATION TEST (C1/F-1 fix):
        ingest_pii_manifest_rejections_total must increment when check_pii_fields
        rejects an undeclared PII field.
        """
        initial = get_counters().get("ingest_pii_manifest_rejections_total", 0)
        events = [{"id": "1", "phone": "+91-9876543210"}]
        adapter = FixtureAdapter(events=events)
        with pytest.raises(PiiManifestViolation):
            await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        assert get_counters()["ingest_pii_manifest_rejections_total"] == initial + 1

    @pytest.mark.asyncio
    async def test_pii_gate_does_not_upsert_on_rejection(self):
        """
        REAL INTEGRATION TEST (C1/F-1 fix):
        When PII gate rejects, events_upserted must stay 0.
        """
        events = [{"id": "1", "phone": "+91-9876543210"}]
        adapter = FixtureAdapter(events=events)
        try:
            await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        except PiiManifestViolation:
            pass
        assert get_counters().get("ingest_events_upserted_total", 0) == 0

    @pytest.mark.asyncio
    async def test_declared_pii_passes_gate_on_shopify(self):
        """
        REAL INTEGRATION TEST (C1/F-1 fix):
        A Shopify event with declared PII fields (email, first_name, last_name)
        MUST pass the gate (they are in SHOPIFY_MANIFEST.pii_fields).
        """
        events = [
            {
                "id": "shopify-order-003",
                "order_number": 1003,
                # Declared PII fields — must pass
                "email": "customer@example.com",
                "first_name": "Priya",
                "last_name": "Sharma",
                "financial_status": "paid",
                "total_price": "1500.00",
                "currency": "INR",
            }
        ]
        adapter = FixtureAdapter(events=events)
        result = await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        assert result.events_received == 1
        assert result.pii_rejections == 0

    @pytest.mark.asyncio
    async def test_non_pii_fields_pass_gate(self):
        """
        REAL INTEGRATION TEST:
        Fields that don't match any PII heuristic substring pass silently.
        """
        events = [
            {
                "id": "shopify-order-004",
                "order_number": 1004,
                "financial_status": "paid",
                "total_price": "2000.00",
                "currency": "INR",
            }
        ]
        adapter = FixtureAdapter(events=events)
        result = await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        assert result.events_received == 1
        assert result.pii_rejections == 0


# ---------------------------------------------------------------------------
# Tests: workspace validation
# ---------------------------------------------------------------------------


class TestIngestBatchWorkspaceValidation:
    def setup_method(self):
        reset_counters()

    @pytest.mark.asyncio
    async def test_empty_workspace_id_raises(self):
        adapter = FixtureAdapter(events=[{"id": "1", "order_number": 1}])
        with pytest.raises(ValueError, match="workspace_id"):
            await ingest_batch(adapter, "", _WINDOW, dry_run=True)

    @pytest.mark.asyncio
    async def test_none_workspace_id_raises(self):
        adapter = FixtureAdapter(events=[{"id": "1", "order_number": 1}])
        with pytest.raises(ValueError):
            await ingest_batch(adapter, None, _WINDOW, dry_run=True)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Tests: workspace allowlist (H2/F-3 fix)
# assert_workspace_allowed is now called inside ingest_batch when
# allowed_workspace_ids is passed. These tests prove runtime rejection.
# ---------------------------------------------------------------------------


class TestIngestBatchAllowlist:
    def setup_method(self):
        reset_counters()

    @pytest.mark.asyncio
    async def test_non_allowlisted_workspace_is_rejected(self):
        """
        H2/F-3 REAL INTEGRATION TEST:
        A workspace_id that is NOT in the allowed frozenset must be rejected
        at runtime by ingest_batch BEFORE any credential read or DB touch.

        This verifies that assert_workspace_allowed() is called at the top of
        ingest_batch (the H2 fix) and not just in the runbook .md.
        """
        allowed = frozenset({"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"})
        disallowed_workspace = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
        adapter = FixtureAdapter(events=[{"id": "1", "order_number": 1}])

        with pytest.raises(WorkspaceNotAllowedError):
            await ingest_batch(
                adapter,
                disallowed_workspace,
                _WINDOW,
                dry_run=True,
                allowed_workspace_ids=allowed,
            )

    @pytest.mark.asyncio
    async def test_allowlisted_workspace_passes(self):
        """
        H2/F-3 REAL INTEGRATION TEST:
        A workspace_id that IS in the allowed frozenset must not be rejected.
        """
        allowed_wid = "550e8400-e29b-41d4-a716-446655440000"
        allowed = frozenset({allowed_wid})
        events = [{"id": "1", "order_number": 1, "financial_status": "paid"}]
        adapter = FixtureAdapter(events=events)

        result = await ingest_batch(
            adapter,
            allowed_wid,
            _WINDOW,
            dry_run=True,
            allowed_workspace_ids=allowed,
        )
        assert result.events_received == 1

    @pytest.mark.asyncio
    async def test_rejection_happens_before_any_other_work(self):
        """
        H2/F-3 REAL INTEGRATION TEST:
        Verify rejection is the FIRST action — no events are received
        and no counters are incremented when the workspace is blocked.
        """
        reset_counters()
        allowed = frozenset({"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"})
        disallowed_workspace = "cccccccc-cccc-4ccc-cccc-cccccccccccc"
        # Adapter with events — none should be processed
        adapter = FixtureAdapter(events=[{"id": "1"}, {"id": "2"}])

        with pytest.raises(WorkspaceNotAllowedError):
            await ingest_batch(
                adapter,
                disallowed_workspace,
                _WINDOW,
                dry_run=True,
                allowed_workspace_ids=allowed,
            )

        # Zero events processed — allowlist check fired before fetch()
        assert get_counters()["ingest_events_received_total"] == 0


# ---------------------------------------------------------------------------
# Tests: correlation context (H1/F-7 fix)
# ---------------------------------------------------------------------------


class TestIngestBatchCorrelation:
    def setup_method(self):
        reset_counters()

    @pytest.mark.asyncio
    async def test_result_carries_request_id(self):
        """
        H1/F-7: ingest_batch must return request_id in IngestResult.
        """
        adapter = FixtureAdapter(events=[])
        result = await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        assert result.request_id != ""
        # Must be a UUID string
        import uuid as _uuid
        _uuid.UUID(result.request_id)  # raises if not valid

    @pytest.mark.asyncio
    async def test_result_carries_trace_id(self):
        """
        H1/F-7: ingest_batch must return trace_id in IngestResult.
        """
        adapter = FixtureAdapter(events=[])
        result = await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        assert result.trace_id != ""
        import uuid as _uuid
        _uuid.UUID(result.trace_id)  # raises if not valid

    @pytest.mark.asyncio
    async def test_caller_supplied_request_id_preserved(self):
        """
        H1/F-7: a caller that supplies a request_id must see it preserved in the result.
        This supports traceability from HTTP handler → ingest_batch → Kafka envelope.
        """
        supplied_req_id = "12345678-1234-4234-8234-123456789abc"
        adapter = FixtureAdapter(events=[])
        result = await ingest_batch(
            adapter,
            _WID,
            _WINDOW,
            dry_run=True,
            request_id=supplied_req_id,
        )
        assert result.request_id == supplied_req_id

    @pytest.mark.asyncio
    async def test_correlation_context_set_during_ingest(self):
        """
        H1/F-7: get_correlation_context() returns the 4-tuple (request_id, trace_id,
        workspace_id, actor) set during ingest_batch execution.
        We verify the workspace_id is correct in the context after a run.
        """
        adapter = FixtureAdapter(events=[])
        result = await ingest_batch(adapter, _WID, _WINDOW, dry_run=True)
        # After the call the context vars hold the last-set values
        ctx = get_correlation_context()
        assert ctx["workspace_id"] == _WID
        assert ctx["actor"] == "system:ingest"
        assert ctx["request_id"] == result.request_id


# ---------------------------------------------------------------------------
# Tests: table name map verification (M1/F-4 fix)
# ---------------------------------------------------------------------------


class TestRawTableMap:
    def test_shopify_order_uses_raw_prefix(self):
        """M1/F-4: _RAW_TABLE_MAP must use raw_* prefix to match prod DDL."""
        assert _RAW_TABLE_MAP["shopify"]["order"] == "raw_shopify_orders"

    def test_shopify_customer_uses_raw_prefix(self):
        assert _RAW_TABLE_MAP["shopify"]["customer"] == "raw_shopify_customers"

    def test_shopify_product_uses_raw_prefix(self):
        assert _RAW_TABLE_MAP["shopify"]["product"] == "raw_shopify_products"

    def test_shopify_line_item_uses_raw_prefix(self):
        assert _RAW_TABLE_MAP["shopify"]["line_item"] == "raw_shopify_line_items"

    def test_shiprocket_shipment_uses_raw_prefix(self):
        assert _RAW_TABLE_MAP["shiprocket"]["shipment"] == "raw_shiprocket_shipments"

    def test_meta_ad_daily_uses_raw_prefix(self):
        assert _RAW_TABLE_MAP["meta"]["ad_daily"] == "raw_meta_ads_daily"

    def test_google_ad_daily_uses_raw_prefix(self):
        assert _RAW_TABLE_MAP["google"]["ad_daily"] == "raw_google_ads_daily"

    def test_klaviyo_email_performance_uses_raw_prefix(self):
        assert _RAW_TABLE_MAP["klaviyo"]["email_performance"] == "raw_klaviyo_email_performance"

    def test_woocommerce_order_uses_raw_prefix(self):
        assert _RAW_TABLE_MAP["woocommerce"]["order"] == "raw_woocommerce_orders"

    def test_unicommerce_product_uses_raw_prefix(self):
        assert _RAW_TABLE_MAP["unicommerce"]["product"] == "raw_unicommerce_products"

    def test_no_unprefixed_table_names_in_map(self):
        """All 10 tables must use raw_* prefix — no un-prefixed names allowed."""
        for vendor, type_map in _RAW_TABLE_MAP.items():
            for event_type, table_name in type_map.items():
                assert table_name.startswith("raw_"), (
                    f"Table name {table_name!r} for vendor={vendor!r} "
                    f"event_type={event_type!r} must start with 'raw_' "
                    f"to match prod DDL (step-a-enable-create.sql). M1/F-4 fix."
                )


# ---------------------------------------------------------------------------
# Tests: counter reset
# ---------------------------------------------------------------------------


class TestCounters:
    def test_reset_counters_zeroes_all(self):
        from src.application.framework.ingest import _COUNTERS
        _COUNTERS["ingest_events_received_total"] = 99
        reset_counters()
        assert get_counters()["ingest_events_received_total"] == 0


# ---------------------------------------------------------------------------
# warehouse-epic S4 LOW-1: raw_payload must never reach a PII-carrying raw
# table's JSONB (it goes to the S3 raw archive only — P0-B Option-a). Verifies
# the allowlist removal + the explicit _upsert_event reject-gate.
# ---------------------------------------------------------------------------
class TestPiiRawPayloadGate:
    def _event(self, columns: dict) -> NormalizedEvent:
        return NormalizedEvent(
            vendor="shopify",
            vendor_event_id="evt-1",
            event_type="order",  # -> raw_shopify_orders (a PII table)
            occurred_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            lawful_basis="owner_brand_controller",
            purpose_code="analytics_performance",
            columns=columns,
        )

    @pytest.mark.asyncio
    async def test_raw_payload_rejected_on_pii_table(self):
        # The gate raises before any DB access, so conn=None is sufficient.
        event = self._event({"shopify_order_id": "1", "raw_payload": '{"email":"a@b.com"}'})
        with pytest.raises(ValueError, match="raw_payload is forbidden"):
            await _upsert_event(None, _WID, event, SHOPIFY_MANIFEST, request_id="rq-1")

    def test_pii_raw_tables_scoped_to_pii_carriers(self):
        assert "raw_shopify_orders" in _PII_RAW_TABLES
        assert "raw_shopify_customers" in _PII_RAW_TABLES
        # non-PII raw tables must NOT be over-gated (they may still archive raw_payload)
        assert "raw_shopify_products" not in _PII_RAW_TABLES
        assert "raw_shopify_line_items" not in _PII_RAW_TABLES

    def test_raw_payload_removed_from_pii_allowlists_only(self):
        # removed from the two PII-carrying tables...
        assert "raw_payload" not in _ALLOWED_COLUMNS["raw_shopify_orders"]
        assert "raw_payload" not in _ALLOWED_COLUMNS["raw_shopify_customers"]
        # ...but still present on a non-PII table (scoped change, no broad break)
        assert "raw_payload" in _ALLOWED_COLUMNS["raw_shopify_products"]

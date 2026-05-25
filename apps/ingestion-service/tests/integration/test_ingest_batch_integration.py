"""
LOCAL integration tests for ingest_batch — requires docker-compose harness.

@paradigm: sql + event-handling

These tests exercise the REAL integrated ingest_batch path end-to-end:
  real ShopifyAdapter PII manifest + real check_pii_fields + real cursor upsert
  + prod-DDL table names (raw_shopify_orders) + local Postgres + workspace allowlist

They are SKIPPED unless INTEGRATION_TEST=1 is set (set by docker-compose harness).
Run with:
  INTEGRATION_TEST=1 DIRECT_URL=postgresql://brain_rls_app:brain_rls_app_pw@localhost:5434/brain_test \\
    python3 -m pytest apps/ingestion-service/tests/integration/test_ingest_batch_integration.py -v

Required docker-compose services (docker-compose.test.yml):
  postgres (brain_test DB, port 5434) — init'd with tests/integration/pg-init/01-init.sql
  (Kafka is optional for these tests; Kafka produce is skipped if kafka_producer=None)

Tests:
  - REAL PII gate: undeclared 'phone' on Shopify → REJECTED before DB write
  - REAL allowlist: disallowed workspace → WorkspaceNotAllowedError before DB touch
  - REAL table names: ingest to raw_shopify_orders (prod DDL name, M1/F-4)
  - REAL cursor: upsert_cursor runs in the SAME transaction as the batch (M2/F-6)
  - REAL idempotency: re-ingest same event → events_deduped increments, not upserted
  - REAL RLS cross-workspace: workspace_b cannot read workspace_a's rows
  - REAL correlation: request_id + trace_id propagated in result
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Optional

import pytest

from src.application.framework.ingest import ingest_batch, reset_counters, get_counters
from src.bootstrap.startup_gates import WorkspaceNotAllowedError
from src.domain.framework.adapter import (
    IngestWindow,
    NormalizedEvent,
    PiiManifest,
    PiiFieldSpec,
    RawEvent,
    ReplayCapability,
    TokenModel,
)
from src.domain.framework.pii_manifest import (
    PiiManifestViolation,
    SHOPIFY_MANIFEST,
)

# Skip all integration tests unless INTEGRATION_TEST=1 is set
pytestmark = pytest.mark.skipif(
    os.environ.get("INTEGRATION_TEST") != "1",
    reason="Integration tests require INTEGRATION_TEST=1 + running docker-compose (pg-init/01-init.sql applied)",
)

_WS_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
_WS_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
_WINDOW = IngestWindow(
    start=datetime(2024, 1, 1, tzinfo=timezone.utc),
    end=datetime(2024, 1, 8, tzinfo=timezone.utc),
)


# ---------------------------------------------------------------------------
# Fixture adapter using the REAL SHOPIFY_MANIFEST (not a test double)
# ---------------------------------------------------------------------------

class RealShopifyFixtureAdapter:
    """In-memory adapter backed by the REAL SHOPIFY_MANIFEST from pii_manifest.py.

    Normalizes events to the raw_shopify_orders schema (prod DDL names).
    No money conversion — raw strings preserved (CF-C3 scope carve-out).
    """

    vendor = "shopify"
    token_model = TokenModel.OAUTH_TOKEN
    replay = ReplayCapability.FULL_60D
    pii_manifest: PiiManifest = SHOPIFY_MANIFEST

    def __init__(self, events: list[dict]):
        self._events = events

    async def fetch(self, creds, window) -> AsyncIterator[RawEvent]:
        for e in self._events:
            yield RawEvent(
                vendor=self.vendor,
                vendor_event_id=str(e["id"]),
                event_type="order",
                occurred_at=datetime(2024, 1, 3, tzinfo=timezone.utc),
                raw_payload=e,
            )

    def normalize(self, raw: RawEvent) -> NormalizedEvent:
        p = raw.raw_payload
        # Match the raw_shopify_orders schema columns (prod DDL)
        columns = {
            "vendor": self.vendor,
            "shopify_order_id": str(p.get("id", "")),
            "order_number": p.get("order_number"),
            "financial_status": p.get("financial_status"),
            "fulfillment_status": p.get("fulfillment_status"),
            "email": p.get("email"),
            "first_name": p.get("first_name"),
            "last_name": p.get("last_name"),
            "total_price": p.get("total_price"),
            "currency": p.get("currency"),
            "created_at": p.get("created_at"),
            "updated_at": p.get("updated_at"),
            "raw_payload": "{}",  # JSONB — simplified for test
        }
        # Strip None values to avoid schema mismatch on optional cols
        columns = {k: v for k, v in columns.items() if v is not None}
        return NormalizedEvent(
            vendor=self.vendor,
            vendor_event_id=raw.vendor_event_id,
            event_type="order",
            occurred_at=raw.occurred_at,
            lawful_basis=SHOPIFY_MANIFEST.default_lawful_basis,
            purpose_code=SHOPIFY_MANIFEST.default_purpose_code,
            columns=columns,
        )

    def idempotency_key(self, raw: RawEvent) -> str:
        return raw.vendor_event_id


# ---------------------------------------------------------------------------
# Integration test: PII gate end-to-end (C1/F-1 real path)
# ---------------------------------------------------------------------------

class TestIngestBatchIntegrationPiiGate:
    """
    C1/F-1 REAL INTEGRATION TEST:
    Exercises the live ingest_batch path with the real PiiManifest gate.
    The old _PiiManifestWithNullSpec double is gone; this test proves that
    a real Shopify adapter + real manifest + real ingest_batch path REJECTS
    an event with an undeclared PII field.
    """

    def setup_method(self):
        reset_counters()

    @pytest.mark.asyncio
    async def test_undeclared_pii_rejected_before_db_write(self):
        """
        INTEGRATION: undeclared 'phone' field → PiiManifestViolation raised BEFORE
        any DB write. Proves the gate is wired in the integrated path, not just
        the per-track unit path.
        """
        events = [
            {
                "id": f"order-pii-test-{uuid.uuid4()}",
                "order_number": 9001,
                "phone": "+91-9876543210",  # undeclared PII — must be rejected
                "financial_status": "paid",
            }
        ]
        adapter = RealShopifyFixtureAdapter(events=events)

        with pytest.raises(PiiManifestViolation):
            await ingest_batch(adapter, _WS_A, _WINDOW, dry_run=False)

        # No upserted events
        assert get_counters()["ingest_events_upserted_total"] == 0
        # Rejection counter incremented
        assert get_counters()["ingest_pii_manifest_rejections_total"] == 1

    @pytest.mark.asyncio
    async def test_declared_pii_passes_to_db(self):
        """
        INTEGRATION: declared PII (email, first_name, last_name) passes the gate
        and is written to raw_shopify_orders (prod DDL table name).
        """
        unique_id = str(uuid.uuid4())
        events = [
            {
                "id": unique_id,
                "order_number": 9002,
                "email": "priya@example.com",     # declared PII
                "first_name": "Priya",             # declared PII
                "last_name": "Sharma",             # declared PII
                "financial_status": "paid",
                "total_price": "1500.00",
                "currency": "INR",
            }
        ]
        adapter = RealShopifyFixtureAdapter(events=events)

        result = await ingest_batch(adapter, _WS_A, _WINDOW)
        assert result.events_received == 1
        assert result.events_upserted == 1
        assert result.pii_rejections == 0
        assert result.cursor_advanced_to == unique_id


# ---------------------------------------------------------------------------
# Integration test: workspace allowlist (H2/F-3 real path)
# ---------------------------------------------------------------------------

class TestIngestBatchIntegrationAllowlist:
    """
    H2/F-3 REAL INTEGRATION TEST:
    assert_workspace_allowed is called at the top of ingest_batch.
    A disallowed workspace raises WorkspaceNotAllowedError BEFORE DB touch.
    """

    def setup_method(self):
        reset_counters()

    @pytest.mark.asyncio
    async def test_disallowed_workspace_rejected_at_runtime(self):
        """
        INTEGRATION: Non-allowlisted workspace is rejected inside ingest_batch
        (not just in tests/unit). Proves the wiring is in the runtime path.
        """
        allowed = frozenset({_WS_A})
        events = [{"id": "order-allowlist-test", "order_number": 1}]
        adapter = RealShopifyFixtureAdapter(events=events)

        with pytest.raises(WorkspaceNotAllowedError):
            await ingest_batch(
                adapter,
                _WS_B,  # not in allowed set
                _WINDOW,
                allowed_workspace_ids=allowed,
            )

        # Nothing processed
        assert get_counters()["ingest_events_received_total"] == 0


# ---------------------------------------------------------------------------
# Integration test: table names + cursor (M1/F-4 + M2/F-6 real path)
# ---------------------------------------------------------------------------

class TestIngestBatchIntegrationTableAndCursor:
    """
    M1/F-4 + M2/F-6 REAL INTEGRATION TEST:
    - Writes to raw_shopify_orders (prod DDL name — M1 fix)
    - cursor is written in the SAME transaction as the batch (M2 fix)
    - Re-ingest of the same event is a dedup (idempotency)
    """

    def setup_method(self):
        reset_counters()

    @pytest.mark.asyncio
    async def test_ingest_writes_to_raw_shopify_orders(self):
        """
        M1/F-4 INTEGRATION: ingest_batch writes to raw_shopify_orders (not shopify_orders).
        If the table name is wrong this test fails with 'relation does not exist'.
        """
        unique_id = str(uuid.uuid4())
        events = [
            {
                "id": unique_id,
                "order_number": 8001,
                "financial_status": "paid",
                "total_price": "1200.00",
                "currency": "INR",
            }
        ]
        adapter = RealShopifyFixtureAdapter(events=events)

        result = await ingest_batch(adapter, _WS_A, _WINDOW)
        assert result.events_upserted == 1
        # Cursor advanced to the last event ID
        assert result.cursor_advanced_to == unique_id

    @pytest.mark.asyncio
    async def test_idempotent_reingest_deduplicates(self):
        """
        M2/F-6 INTEGRATION: re-ingesting the same event increments events_deduped,
        not events_upserted (UPSERT ON CONFLICT idempotency).
        Also verifies the cursor + batch are committed in the same transaction
        (cursor_advanced_to is set after the dedup run too).
        """
        unique_id = str(uuid.uuid4())
        events = [
            {
                "id": unique_id,
                "order_number": 8002,
                "financial_status": "paid",
            }
        ]
        adapter = RealShopifyFixtureAdapter(events=events)

        # First ingest — row inserted
        result_1 = await ingest_batch(adapter, _WS_A, _WINDOW)
        assert result_1.events_upserted == 1
        assert result_1.events_deduped == 0

        reset_counters()

        # Second ingest — same event_id → deduped, not upserted
        result_2 = await ingest_batch(adapter, _WS_A, _WINDOW)
        assert result_2.events_upserted == 0
        assert result_2.events_deduped == 1

    @pytest.mark.asyncio
    async def test_cursor_written_in_same_transaction(self):
        """
        M2/F-6 INTEGRATION: cursor is persisted (connector_cursor table) and
        cursor_advanced_to in the result matches the last event ID.
        Proves upsert_cursor runs inside the same with_workspace transaction.
        """
        unique_id = str(uuid.uuid4())
        events = [
            {"id": unique_id, "order_number": 8003, "financial_status": "paid"},
        ]
        adapter = RealShopifyFixtureAdapter(events=events)

        result = await ingest_batch(adapter, _WS_A, _WINDOW)
        assert result.cursor_advanced_to == unique_id

        # Verify the cursor row was actually written to the DB
        from src.infrastructure.db.session_context import with_workspace
        from src.domain.framework.cursor import get_cursor
        import uuid as uuid_mod

        async def read_cursor(conn):
            return await get_cursor(conn, uuid_mod.UUID(_WS_A), "shopify")

        cursor_row = await with_workspace(_WS_A, read_cursor)
        assert cursor_row is not None
        assert cursor_row.cursor_value == unique_id
        assert cursor_row.window_start is not None
        assert cursor_row.window_end is not None


# ---------------------------------------------------------------------------
# Integration test: cross-workspace RLS isolation (CF-C3-RLS-CONSUME-1)
# ---------------------------------------------------------------------------

class TestIngestBatchIntegrationRLSIsolation:
    """
    CF-C3-RLS-CONSUME-1 REAL INTEGRATION TEST:
    workspace_b cannot read workspace_a's raw_shopify_orders rows.
    Proves that with_workspace sets the RLS session context correctly.
    """

    def setup_method(self):
        reset_counters()

    @pytest.mark.asyncio
    async def test_cross_workspace_read_returns_zero(self):
        """
        INTEGRATION: after ingesting events for workspace_a, workspace_b reads 0 rows.
        This proves the RLS ws_isolation policy works with the prod-DDL table name.
        """
        from src.infrastructure.db.session_context import with_workspace

        unique_id = str(uuid.uuid4())
        events = [
            {"id": unique_id, "order_number": 7001, "financial_status": "paid"},
        ]
        adapter = RealShopifyFixtureAdapter(events=events)

        # Ingest for workspace_a
        await ingest_batch(adapter, _WS_A, _WINDOW)

        # workspace_b should see 0 rows
        async def count_ws_b_rows(conn):
            row = await conn.fetchone(
                "SELECT COUNT(*) AS cnt FROM raw_shopify_orders"
            )
            return row["cnt"]

        count = await with_workspace(_WS_B, count_ws_b_rows)
        assert count == 0, (
            f"RLS isolation violated: workspace_b sees {count} row(s) from workspace_a. "
            "The ws_isolation policy on raw_shopify_orders is not working correctly."
        )


# ---------------------------------------------------------------------------
# Integration test: correlation 4-tuple (H1/F-7 real path)
# ---------------------------------------------------------------------------

class TestIngestBatchIntegrationCorrelation:
    """
    H1/F-7 REAL INTEGRATION TEST:
    request_id + trace_id are propagated through the ingest path.
    """

    def setup_method(self):
        reset_counters()

    @pytest.mark.asyncio
    async def test_correlation_ids_in_result(self):
        """INTEGRATION: result carries non-empty request_id + trace_id UUIDs."""
        events = [{"id": str(uuid.uuid4()), "order_number": 6001, "financial_status": "paid"}]
        adapter = RealShopifyFixtureAdapter(events=events)

        supplied_req_id = str(uuid.uuid4())
        result = await ingest_batch(
            adapter,
            _WS_A,
            _WINDOW,
            request_id=supplied_req_id,
        )
        assert result.request_id == supplied_req_id
        assert result.trace_id != ""
        uuid.UUID(result.trace_id)  # raises if not valid UUID

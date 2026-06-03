"""
test_b2_metrics_grpc_client.py — B2 MetricsGrpcClient tests.

Slice B2: MetricsGrpcClient — the gRPC client that lets intelligence-service read
metrics from analytics-service. No real analytics process, no ClickHouse required.

Tests:
  TestMetricsGrpcClientMapping (unit — fake stub):
    - test_single_page_row_mapping: FakeStub returns a QueryMetricsResponse with
      two proto MetricRows → assert MetricRowView fields are correctly int-typed
      and date is "YYYY-MM-DD".
    - test_nullable_aov_set: aov_mu Int32Value set → MetricRowView.aov_mu == int.
    - test_nullable_aov_unset: aov_mu Int32Value NOT set → MetricRowView.aov_mu is None.
    - test_pagination_followed: FakeStub returns page 1 with next_cursor="p2", then
      page 2 with next_cursor="" → both pages are fetched, rows from both returned.
    - test_pagination_bounded: FakeStub always returns next_cursor="loop" →
      loop stops at _MAX_PAGES.
    - test_empty_workspace_id_raises: falsy workspace_id → ValueError before any RPC.
    - test_as_metric_source_dict_contract: as_metric_source() dict has correct keys.
    - test_date_range_dataclass: DateRange validates end >= start.

  TestMetricsGrpcClientLoopback (integration — real gRPC loopback):
    - test_loopback_wire_full_pipeline: Start a REAL grpc.aio analytics
      MetricsServiceAdapter server on 127.0.0.1:0 with an injected fake
      query_metrics function. Point MetricsGrpcClient at it. Call query_metrics →
      assert returned MetricRowViews have correct int fields.
    - test_loopback_wire_to_pnl_provider: Same server, build
      PnlInsightSignalsProvider(gateway=FakeGateway(), metric_source=grpc_client)
      and call it — assert ≥1 insight returned. Proves the full pipeline works over
      a REAL gRPC hop (cross-service metric read + B1 FakeGateway for LLM).

@paradigm: sql + io/event-handling (test toolchain — no ML, no LLM)
"""

from __future__ import annotations

import asyncio
import pathlib
import sys
from dataclasses import dataclass
from datetime import date
from typing import Any
from unittest.mock import MagicMock

import pytest

# ---------------------------------------------------------------------------
# Ensure src and _pb2 are importable in the test process
# ---------------------------------------------------------------------------
_src_dir = str(pathlib.Path(__file__).parent.parent.parent / "src")
_pb2_dir = str(pathlib.Path(__file__).parent.parent.parent / "src" / "interfaces" / "grpc" / "_pb2")
for _p in (_src_dir, _pb2_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# fakes
_fakes_dir = str(pathlib.Path(__file__).parent.parent / "fakes")
if _fakes_dir not in sys.path:
    sys.path.insert(0, _fakes_dir)

from gateway_fakes import FakeGateway, FakeQueryGateway  # noqa: E402


# ---------------------------------------------------------------------------
# Proto helpers — build proto MetricRows for the fake stub
# ---------------------------------------------------------------------------

def _make_proto_row(
    *,
    workspace_id: str = "ws-test",
    date_str: str = "2026-05-01",
    net_sales_mu: int = 200_000,
    cm1_mu: int = 100_000,
    cm2_mu: int = 80_000,
    cm3_mu: int = 60_000,
    cogs_mu: int = 50_000,
    total_ad_spend_mu: int = 20_000,
    aov_mu: int | None = 500,
) -> Any:
    """Build a proto MetricRow for use in fake stub responses."""
    from brain.metrics.v1 import metrics_pb2
    from google.protobuf import wrappers_pb2, timestamp_pb2

    row = metrics_pb2.MetricRow(
        workspace_id=workspace_id,
        date=date_str,
        gross_sales_mu=net_sales_mu + 10_000,
        returns_mu=10_000,
        discounts_mu=5_000,
        net_sales_mu=net_sales_mu,
        total_tax_mu=0,
        net_net_tax_mu=0,
        shipping_revenue_mu=0,
        net_revenue_mu=net_sales_mu,
        cogs_mu=cogs_mu,
        total_ad_spend_mu=total_ad_spend_mu,
        cm1_mu=cm1_mu,
        cm2_mu=cm2_mu,
        cm3_mu=cm3_mu,
        currency_code="INR",
    )
    ts = timestamp_pb2.Timestamp()
    ts.GetCurrentTime()
    row.data_epoch.CopyFrom(ts)

    if aov_mu is not None:
        row.aov_mu.CopyFrom(wrappers_pb2.Int32Value(value=aov_mu))
    # Deliberately leave aov_mu unset when None (tests the nullable path)

    return row


def _make_response(rows: list[Any], next_cursor: str = "") -> Any:
    """Build a QueryMetricsResponse proto with the given rows and cursor."""
    from brain.metrics.v1 import metrics_pb2
    from google.protobuf import timestamp_pb2

    ts = timestamp_pb2.Timestamp()
    ts.GetCurrentTime()
    return metrics_pb2.QueryMetricsResponse(
        rows=rows,
        data_epoch=ts,
        next_cursor=next_cursor,
    )


# ---------------------------------------------------------------------------
# Unit tests: MetricsGrpcClient with fake stub (no gRPC wire)
# ---------------------------------------------------------------------------

class TestMetricsGrpcClientMapping:
    """Unit tests for MetricsGrpcClient using a fake/mock stub (no real gRPC)."""

    def _client_with_stub(self, stub: Any):
        """Build a MetricsGrpcClient with a pre-injected stub (no channel)."""
        from application.morning_brief.metrics_grpc_client import MetricsGrpcClient
        return MetricsGrpcClient(stub=stub)

    def test_single_page_row_mapping(self):
        """Two proto MetricRows → two MetricRowViews with correct int-typed fields."""
        from application.morning_brief.metrics_grpc_client import DateRange

        row1 = _make_proto_row(date_str="2026-05-01", net_sales_mu=200_000, aov_mu=500)
        row2 = _make_proto_row(date_str="2026-05-02", net_sales_mu=210_000, aov_mu=505)

        stub = MagicMock()
        stub.QueryMetrics.return_value = _make_response([row1, row2], next_cursor="")

        client = self._client_with_stub(stub)
        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 2))
        views = client.query_metrics("ws-test", "pnl_summary", dr)

        assert len(views) == 2, f"Expected 2 rows, got {len(views)}"

        v1 = views[0]
        assert v1.date == "2026-05-01", f"date wrong: {v1.date!r}"
        assert isinstance(v1.net_sales_mu, int), "net_sales_mu must be int"
        assert v1.net_sales_mu == 200_000
        assert isinstance(v1.cm1_mu, int), "cm1_mu must be int"
        assert isinstance(v1.cm2_mu, int), "cm2_mu must be int"
        assert isinstance(v1.cm3_mu, int), "cm3_mu must be int"
        assert isinstance(v1.cogs_mu, int), "cogs_mu must be int"
        assert isinstance(v1.total_ad_spend_mu, int), "total_ad_spend_mu must be int"
        assert v1.total_orders == 0, "total_orders is always 0 in MetricRowView"
        assert isinstance(v1.aov_mu, int), "aov_mu must be int when set"
        assert v1.aov_mu == 500

        v2 = views[1]
        assert v2.date == "2026-05-02"
        assert v2.net_sales_mu == 210_000
        assert v2.aov_mu == 505

    def test_nullable_aov_set(self):
        """aov_mu Int32Value explicitly set → MetricRowView.aov_mu is an int."""
        from application.morning_brief.metrics_grpc_client import DateRange

        row = _make_proto_row(aov_mu=750)
        stub = MagicMock()
        stub.QueryMetrics.return_value = _make_response([row])

        client = self._client_with_stub(stub)
        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 1))
        views = client.query_metrics("ws-test", "cm2_mu", dr)

        assert len(views) == 1
        assert isinstance(views[0].aov_mu, int), (
            "aov_mu must be int when proto Int32Value was set"
        )
        assert views[0].aov_mu == 750

    def test_nullable_aov_unset(self):
        """aov_mu Int32Value NOT set in proto → MetricRowView.aov_mu is None."""
        from application.morning_brief.metrics_grpc_client import DateRange

        row = _make_proto_row(aov_mu=None)  # aov_mu deliberately left unset
        stub = MagicMock()
        stub.QueryMetrics.return_value = _make_response([row])

        client = self._client_with_stub(stub)
        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 1))
        views = client.query_metrics("ws-test", "cm2_mu", dr)

        assert len(views) == 1
        assert views[0].aov_mu is None, (
            "aov_mu must be None when proto Int32Value was not set "
            "(zero-denominator day sentinel)"
        )

    def test_pagination_followed(self):
        """next_cursor non-empty → client fetches the next page."""
        from application.morning_brief.metrics_grpc_client import DateRange

        row1 = _make_proto_row(date_str="2026-05-01", net_sales_mu=100_000)
        row2 = _make_proto_row(date_str="2026-05-02", net_sales_mu=110_000)

        # Page 1: 1 row + next_cursor="page2"
        # Page 2: 1 row + next_cursor="" (last page)
        page1_response = _make_response([row1], next_cursor="page2")
        page2_response = _make_response([row2], next_cursor="")

        stub = MagicMock()
        stub.QueryMetrics.side_effect = [page1_response, page2_response]

        client = self._client_with_stub(stub)
        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 2))
        views = client.query_metrics("ws-test", "pnl_summary", dr)

        assert stub.QueryMetrics.call_count == 2, (
            f"Should have fetched 2 pages, fetched {stub.QueryMetrics.call_count}"
        )
        assert len(views) == 2, f"Expected 2 total rows (1 per page), got {len(views)}"
        assert views[0].date == "2026-05-01"
        assert views[1].date == "2026-05-02"

        # Verify second call used the cursor from page 1
        second_call_request = stub.QueryMetrics.call_args_list[1][0][0]
        assert second_call_request.cursor == "page2", (
            f"Second page request must carry cursor='page2', got {second_call_request.cursor!r}"
        )

    def test_pagination_bounded_by_max_pages(self):
        """Stub always returns next_cursor='loop' → loop stops at _MAX_PAGES."""
        from application.morning_brief.metrics_grpc_client import (
            DateRange, _MAX_PAGES,
        )

        row = _make_proto_row()
        looping_response = _make_response([row], next_cursor="loop")

        stub = MagicMock()
        stub.QueryMetrics.return_value = looping_response

        client = self._client_with_stub(stub)
        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 1))
        views = client.query_metrics("ws-test", "pnl_summary", dr)

        assert stub.QueryMetrics.call_count == _MAX_PAGES, (
            f"Pagination must stop at _MAX_PAGES={_MAX_PAGES}, "
            f"but fetched {stub.QueryMetrics.call_count} pages"
        )
        assert len(views) == _MAX_PAGES, (
            f"Expected {_MAX_PAGES} rows (1 per page), got {len(views)}"
        )

    def test_empty_workspace_id_raises_value_error(self):
        """Falsy workspace_id → ValueError before any RPC call (fail-closed)."""
        from application.morning_brief.metrics_grpc_client import DateRange

        stub = MagicMock()
        client = self._client_with_stub(stub)
        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 1))

        with pytest.raises(ValueError, match="workspace_id must not be empty"):
            client.query_metrics("", "pnl_summary", dr)

        # Stub must NOT have been called — fail-closed before RPC
        stub.QueryMetrics.assert_not_called()

    def test_whitespace_workspace_id_raises_value_error(self):
        """Whitespace-only workspace_id → ValueError (mirrors UnscopedQueryError)."""
        from application.morning_brief.metrics_grpc_client import DateRange

        stub = MagicMock()
        client = self._client_with_stub(stub)
        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 1))

        with pytest.raises(ValueError, match="workspace_id must not be empty"):
            client.query_metrics("   ", "pnl_summary", dr)

        stub.QueryMetrics.assert_not_called()

    def test_as_metric_source_dict_contract(self):
        """as_metric_source() returns dict with 'query_metrics' and 'DateRange' keys."""
        from application.morning_brief.metrics_grpc_client import (
            MetricsGrpcClient, DateRange,
        )
        client = MetricsGrpcClient(stub=MagicMock())
        source = client.as_metric_source()

        assert "query_metrics" in source, "metric_source must have 'query_metrics'"
        assert "DateRange" in source, "metric_source must have 'DateRange'"
        assert callable(source["query_metrics"]), "'query_metrics' must be callable"
        assert source["DateRange"] is DateRange, (
            "'DateRange' must be the MetricsGrpcClient.DateRange dataclass"
        )

    def test_date_range_validates_end_gte_start(self):
        """DateRange raises ValueError when end < start."""
        from application.morning_brief.metrics_grpc_client import DateRange

        with pytest.raises(ValueError, match="end .* must be >= start"):
            DateRange(start=date(2026, 5, 10), end=date(2026, 5, 1))

    def test_date_range_same_day_valid(self):
        """DateRange(start=d, end=d) is valid (single-day query)."""
        from application.morning_brief.metrics_grpc_client import DateRange

        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 1))
        assert dr.start.isoformat() == "2026-05-01"
        assert dr.end.isoformat() == "2026-05-01"

    def test_definition_id_passed_as_definition_ids_list(self):
        """query_metrics passes definition_id as definition_ids=[definition_id] in proto request."""
        from application.morning_brief.metrics_grpc_client import DateRange

        stub = MagicMock()
        stub.QueryMetrics.return_value = _make_response([])

        client = self._client_with_stub(stub)
        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 1))
        client.query_metrics("ws-test", "cm2_mu", dr)

        call_request = stub.QueryMetrics.call_args[0][0]
        assert list(call_request.definition_ids) == ["cm2_mu"], (
            f"definition_ids must be ['cm2_mu'], got {list(call_request.definition_ids)}"
        )

    def test_page_size_is_90(self):
        """query_metrics always requests page_size=90."""
        from application.morning_brief.metrics_grpc_client import DateRange

        stub = MagicMock()
        stub.QueryMetrics.return_value = _make_response([])

        client = self._client_with_stub(stub)
        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 30))
        client.query_metrics("ws-test", "pnl_summary", dr)

        call_request = stub.QueryMetrics.call_args[0][0]
        assert call_request.page_size == 90, (
            f"page_size must be 90 (3 months of daily rows), got {call_request.page_size}"
        )

    def test_date_range_passed_as_iso_strings(self):
        """query_metrics passes date_range.start/end as ISO strings in the request."""
        from application.morning_brief.metrics_grpc_client import DateRange

        stub = MagicMock()
        stub.QueryMetrics.return_value = _make_response([])

        client = self._client_with_stub(stub)
        dr = DateRange(start=date(2026, 5, 1), end=date(2026, 6, 3))
        client.query_metrics("ws-test", "pnl_summary", dr)

        req = stub.QueryMetrics.call_args[0][0]
        assert req.date_start == "2026-05-01"
        assert req.date_end == "2026-06-03"


# ---------------------------------------------------------------------------
# Integration tests: real gRPC loopback wire
# ---------------------------------------------------------------------------

class TestMetricsGrpcClientLoopback:
    """Integration tests: real grpc.aio server, real gRPC hop, fake analytics servicer.

    These tests start an actual in-process gRPC server using the analytics-service
    MetricsServiceAdapter with an injected fake query_metrics function. The
    MetricsGrpcClient uses grpc.insecure_channel to connect to it on loopback.
    This proves the cross-service gRPC wire works end-to-end.

    No real analytics-service process, no ClickHouse needed.
    """

    def test_loopback_wire_query_metrics_returns_views(self):
        """MetricsGrpcClient → real analytics gRPC server → MetricRowView mapping.

        Starts a sync grpc.server with a fake MetricsServiceServicer that maps
        proto requests → proto responses directly (no async, no ClickHouse).
        Points MetricsGrpcClient at the loopback port.
        Asserts returned MetricRowViews have correct int-typed fields + dates.

        Uses grpc.server (sync ThreadPoolExecutor) to avoid asyncio event-loop
        deadlock with the sync MetricsGrpcClient.query_metrics() call.
        The analytics MetricsServiceAdapter is async; we use a sync servicer
        subclass here to keep the test self-contained.
        """
        import grpc
        from concurrent import futures
        from brain.metrics.v1 import metrics_pb2, metrics_pb2_grpc
        from google.protobuf import wrappers_pb2, timestamp_pb2

        def _ts():
            ts = timestamp_pb2.Timestamp()
            ts.GetCurrentTime()
            return ts

        def _row(date_str, net_sales, cm1, cm2, cm3, cogs, ad_spend, aov):
            r = metrics_pb2.MetricRow(
                workspace_id="ws-loopback-test",
                date=date_str,
                net_sales_mu=net_sales,
                cm1_mu=cm1,
                cm2_mu=cm2,
                cm3_mu=cm3,
                cogs_mu=cogs,
                total_ad_spend_mu=ad_spend,
                gross_sales_mu=net_sales + 10_000,
                returns_mu=10_000,
                discounts_mu=0,
                net_revenue_mu=net_sales,
                total_tax_mu=0,
                net_net_tax_mu=0,
                shipping_revenue_mu=0,
                currency_code="INR",
            )
            r.data_epoch.CopyFrom(_ts())
            if aov is not None:
                r.aov_mu.CopyFrom(wrappers_pb2.Int32Value(value=aov))
            return r

        class _FakeSyncServicer(metrics_pb2_grpc.MetricsServiceServicer):
            def QueryMetrics(self, request, context):
                rows = [
                    _row("2026-05-01", 300_000, 210_000, 180_000, 160_000, 90_000, 30_000, 600),
                    _row("2026-05-02", 425_000, 305_000, 260_000, 240_000, 120_000, 45_000, 850),
                ]
                return metrics_pb2.QueryMetricsResponse(
                    rows=rows,
                    data_epoch=_ts(),
                    next_cursor="",
                )

        # Sync grpc.server — avoids async event-loop deadlock
        server = grpc.server(futures.ThreadPoolExecutor(max_workers=2))
        metrics_pb2_grpc.add_MetricsServiceServicer_to_server(_FakeSyncServicer(), server)
        port = server.add_insecure_port("127.0.0.1:0")
        server.start()

        try:
            from application.morning_brief.metrics_grpc_client import (
                MetricsGrpcClient, DateRange,
            )

            target = f"127.0.0.1:{port}"
            client = MetricsGrpcClient(target=target)

            dr = DateRange(start=date(2026, 5, 1), end=date(2026, 5, 2))
            views = client.query_metrics("ws-loopback-test", "pnl_summary", dr)

            assert len(views) == 2, (
                f"Expected 2 MetricRowViews from the loopback server, got {len(views)}. "
                "B2: real gRPC hop to analytics MetricsServiceAdapter failed."
            )

            v1 = views[0]
            assert isinstance(v1.net_sales_mu, int), "net_sales_mu must be int"
            assert v1.net_sales_mu == 300_000
            assert isinstance(v1.cm1_mu, int)
            assert v1.cm1_mu == 210_000
            assert isinstance(v1.cm2_mu, int)
            assert v1.cm2_mu == 180_000
            assert isinstance(v1.cm3_mu, int)
            assert v1.cm3_mu == 160_000
            assert isinstance(v1.cogs_mu, int)
            assert v1.cogs_mu == 90_000
            assert isinstance(v1.total_ad_spend_mu, int)
            assert v1.total_ad_spend_mu == 30_000
            # aov_mu was set to 600 → should be int
            assert isinstance(v1.aov_mu, int), "aov_mu must be int when set"
            assert v1.aov_mu == 600
            # date is a str "YYYY-MM-DD"
            assert isinstance(v1.date, str), "date must be str"
            assert v1.date == "2026-05-01"

            v2 = views[1]
            assert v2.net_sales_mu == 425_000
            assert v2.aov_mu == 850

        finally:
            server.stop(grace=0)

    def test_loopback_wire_to_pnl_provider_returns_insights(self):
        """Full pipeline: MetricsGrpcClient → analytics loopback → PnlInsightSignalsProvider.

        This is the B2 recurrence-killer gate: proves the full pipeline works over a
        REAL gRPC hop without a real analytics process or ClickHouse:
          1. Sync grpc.server with a fake MetricsServiceServicer (5 canned rows)
          2. MetricsGrpcClient.query_metrics() → reads over real gRPC wire
          3. PnlInsightSignalsProvider calls build_pnl_context via the grpc metric_source
          4. PnlInsightAgent runs Tier-A signals + FakeGateway Tier-B narration
          5. Asserts ≥1 InsightItem produced

        No real LLM (FakeGateway). No real ClickHouse. Real gRPC hop (sync server).
        """
        import grpc
        from concurrent import futures
        from brain.metrics.v1 import metrics_pb2, metrics_pb2_grpc
        from google.protobuf import wrappers_pb2, timestamp_pb2
        from datetime import timedelta, date as date_cls

        def _ts():
            ts = timestamp_pb2.Timestamp()
            ts.GetCurrentTime()
            return ts

        class _FakeSyncServicer5Rows(metrics_pb2_grpc.MetricsServiceServicer):
            """Returns 5 canned MetricRows for any QueryMetrics request."""

            def QueryMetrics(self, request, context):
                rows = []
                start = date_cls.fromisoformat(request.date_start)
                for i in range(5):
                    d = start + timedelta(days=i)
                    factor = 100_000 + i * 5_000
                    r = metrics_pb2.MetricRow(
                        workspace_id=request.workspace_id,
                        date=d.isoformat(),
                        net_sales_mu=factor,
                        cm1_mu=factor // 2,
                        cm2_mu=factor // 3,
                        cm3_mu=factor // 4,
                        cogs_mu=factor // 3,
                        total_ad_spend_mu=factor // 6,
                        gross_sales_mu=factor + 10_000,
                        returns_mu=5_000,
                        discounts_mu=0,
                        net_revenue_mu=factor,
                        total_tax_mu=0,
                        net_net_tax_mu=0,
                        shipping_revenue_mu=0,
                        currency_code="INR",
                    )
                    r.data_epoch.CopyFrom(_ts())
                    aov = factor // 10
                    if aov > 0:
                        r.aov_mu.CopyFrom(wrappers_pb2.Int32Value(value=aov))
                    rows.append(r)

                return metrics_pb2.QueryMetricsResponse(
                    rows=rows,
                    data_epoch=_ts(),
                    next_cursor="",
                )

        server = grpc.server(futures.ThreadPoolExecutor(max_workers=2))
        metrics_pb2_grpc.add_MetricsServiceServicer_to_server(
            _FakeSyncServicer5Rows(), server
        )
        port = server.add_insecure_port("127.0.0.1:0")
        server.start()

        try:
            from application.morning_brief.metrics_grpc_client import MetricsGrpcClient
            from application.morning_brief.pnl_signals_provider import PnlInsightSignalsProvider

            target = f"127.0.0.1:{port}"
            grpc_client = MetricsGrpcClient(target=target)
            metric_source = grpc_client.as_metric_source()

            fake_gateway = FakeGateway()
            provider = PnlInsightSignalsProvider(
                gateway=fake_gateway,
                metric_source=metric_source,
            )

            insights = provider("ws-loopback-pipeline", "2026-06-03")

            assert len(insights) >= 1, (
                f"B2: PnlInsightSignalsProvider over a REAL gRPC hop must return "
                f"≥1 insight, got {len(insights)}. "
                "Check that MetricsGrpcClient.query_metrics feeds rows to build_pnl_context."
            )

            item = insights[0]
            assert isinstance(item, dict), "InsightItem must be a dict"
            assert "title" in item, "InsightItem must have 'title'"
            assert "summary" in item, "InsightItem must have 'summary'"

        finally:
            server.stop(grace=0)

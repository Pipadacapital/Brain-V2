"""
application/morning_brief/metrics_grpc_client.py — gRPC client for analytics MetricsService.

@paradigm: sql (CF-C4-QUERY-SCOPE-ISOLATION-1 — metric read through the analytics
    service boundary; no ML, no LLM, no derivation of numbers)

B2 SCOPE: replaces the B1 in-process import-or-die adapter so the intelligence-
service PnlInsightSignalsProvider can read metrics over a REAL gRPC hop to the
analytics-service process in production (multi-process deployment).

DI design:
    MetricsGrpcClient(target=...) — production usage, lazily opens the gRPC channel
    MetricsGrpcClient(target=..., stub=FakeStub()) — test injection; channel never opened

Contract (matches build_pnl_context's _query_gateway dict contract):
    as_metric_source() → {"query_metrics": self.query_metrics, "DateRange": DateRange}

DateRange dataclass:
    DateRange(start: date, end: date) — compatible with dr_cls(start=, end=) usage
    and .start.isoformat() in the context builder.

MetricRowView:
    Lightweight view exposing exactly the fields build_pnl_context reads from each row.
    Proto Int64 → python int. Int32Value (nullable) → int | None.
    .date is a str "YYYY-MM-DD" (str(row.date) in _build_daily_signals produces
    "YYYY-MM-DD" directly from the proto string field).

Pagination:
    Follows next_cursor until empty, bounded by _MAX_PAGES to prevent runaway loops.
    page_size=90 covers 3 months of daily rows (the maximum the brief context uses).

PII/NEVERLOG:
    workspace_id is logged at DEBUG only. No metric values are logged.

India-residency assertion:
    This client makes outbound calls to analytics-service only — never to external
    endpoints. The analytics-service is India-resident (CF-C4-RESIDENCY-1).

Phase-D note:
    The workspace_daily_metrics_computed Materialized View is NOT populated locally
    (metric-engine Phase-D). The client will return empty rows until the MV is
    populated. This is expected and handled gracefully by build_pnl_context
    (returns zero-valued PnlContext, not a crash).
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
from dataclasses import dataclass
from datetime import date
from typing import Any, Optional

from brain_cost_router import paradigm

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# _pb2 bootstrap — add the metrics stubs to sys.path (mirrors intelligence_servicer.py)
# ---------------------------------------------------------------------------
_pb2_dir = str(pathlib.Path(__file__).parent.parent.parent / "interfaces" / "grpc" / "_pb2")
if _pb2_dir not in sys.path:
    sys.path.insert(0, _pb2_dir)

from brain.metrics.v1 import metrics_pb2, metrics_pb2_grpc  # noqa: E402


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DateRange:
    """Inclusive date range — duck-type compatible with analytics query_gateway.DateRange.

    build_pnl_context calls dr_cls(start=<date>, end=<date>) and then
    date_range.start.isoformat() — this satisfies both.
    """
    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ValueError(
                f"DateRange: end ({self.end}) must be >= start ({self.start})."
            )


@dataclass
class MetricRowView:
    """Lightweight view of one proto MetricRow, exposing the fields build_pnl_context reads.

    All _mu fields are python int (converted from proto int64 / Int32Value).
    .date is a str "YYYY-MM-DD" (the proto ships it as a string already).
    .aov_mu is int | None (maps from the nullable Int32Value).
    .total_orders is always 0 — build_pnl_context computes orders from aov_mu
    and net_sales_mu directly; it does not read total_orders off the row.

    @paradigm: sql — pure field projection, no computation.
    """
    date: str              # "YYYY-MM-DD"
    net_sales_mu: int
    cm1_mu: int
    cm2_mu: int
    cm3_mu: int
    cogs_mu: int
    total_ad_spend_mu: int
    total_orders: int      # always 0 — computed by the context builder
    aov_mu: Optional[int]  # None when the proto Int32Value is not set


# ---------------------------------------------------------------------------
# Pagination limit (safety guard against unbounded loops)
# ---------------------------------------------------------------------------
_MAX_PAGES = 10  # 10 × 90 rows = 900 daily rows; enough for years of daily data


# ---------------------------------------------------------------------------
# MetricsGrpcClient
# ---------------------------------------------------------------------------

class MetricsGrpcClient:
    """gRPC client for the analytics-service MetricsService.

    Reads workspace-scoped metric rows over a gRPC hop — the production-safe
    replacement for the B1 in-process analytics import.

    @paradigm: sql — metric reads only; no ML, no LLM.
    CF-C4-QUERY-SCOPE-ISOLATION-1: workspace_id is the first positional arg
        of query_metrics(); never optional; falsy values are rejected before
        the gRPC call (fail-closed, mirrors the analytics gateway behaviour).

    Constructor:
        target: gRPC target string (default: ANALYTICS_GRPC_TARGET env or
                "analytics-service:50052"). Ignored when stub is injected.
        stub:   (test injection) pre-built MetricsServiceStub. When supplied,
                no grpc.Channel is created — the stub is used directly. This
                lets unit tests wire a FakeStub without any network.

    PII/NEVERLOG: workspace_id logged at DEBUG only; no metric values logged.
    """

    def __init__(
        self,
        *,
        target: Optional[str] = None,
        stub: Optional[Any] = None,
    ) -> None:
        self._target = target or os.environ.get(
            "ANALYTICS_GRPC_TARGET", "analytics-service:50052"
        )
        # Injected stub short-circuits channel creation (test DI).
        self._stub = stub
        self._channel: Optional[Any] = None  # lazy; created on first query_metrics call

    def _get_stub(self) -> Any:
        """Return the stub, lazily creating the channel if not injected.

        @paradigm: sql — channel/stub construction only; no metric computation.
        """
        if self._stub is not None:
            return self._stub
        if self._channel is None:
            import grpc
            self._channel = grpc.insecure_channel(self._target)
        return metrics_pb2_grpc.MetricsServiceStub(self._channel)

    @paradigm("sql")
    def query_metrics(
        self,
        workspace_id: str,
        definition_id: str,
        date_range: DateRange,
    ) -> list[MetricRowView]:
        """Query workspace-scoped metric rows from analytics-service over gRPC.

        @paradigm: sql — pure metric read through the analytics gRPC boundary.
        CF-C4-QUERY-SCOPE-ISOLATION-1: workspace_id must be non-empty (fail-closed).

        Calls QueryMetrics(page_size=90) and follows next_cursor until empty
        (bounded by _MAX_PAGES). Rows are mapped to MetricRowView with int-typed
        fields that build_pnl_context expects.

        Args:
            workspace_id:  authenticated workspace scope. Must be non-empty.
            definition_id: metric registry definition id (e.g. "pnl_summary").
                           Passed as definition_ids=[definition_id] in the request.
            date_range:    inclusive date range (DateRange with .start, .end dates).

        Returns:
            list[MetricRowView] ordered by date ASC (analytics-service guarantees
            this ordering from the ClickHouse query).

        Raises:
            ValueError: if workspace_id is falsy (fail-closed, mirrors UnscopedQueryError).
            grpc.RpcError: propagated from the analytics-service stub on transport failure.
        """
        # Fail-closed: mirrors the analytics query_gateway's UnscopedQueryError guard.
        if not workspace_id or not workspace_id.strip():
            raise ValueError(
                f"MetricsGrpcClient.query_metrics: workspace_id must not be empty. "
                f"Got workspace_id={workspace_id!r}. "
                "CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        logger.debug(
            "MetricsGrpcClient.query_metrics: workspace_id=%r definition_id=%r "
            "date_range=[%s, %s]",
            workspace_id,
            definition_id,
            date_range.start,
            date_range.end,
        )

        stub = self._get_stub()
        rows: list[MetricRowView] = []
        cursor = ""
        pages_fetched = 0

        while pages_fetched < _MAX_PAGES:
            request = metrics_pb2.QueryMetricsRequest(
                workspace_id=workspace_id,
                definition_ids=[definition_id],
                date_start=date_range.start.isoformat(),
                date_end=date_range.end.isoformat(),
                cursor=cursor,
                page_size=90,
            )
            response = stub.QueryMetrics(request)
            pages_fetched += 1

            for proto_row in response.rows:
                rows.append(_proto_row_to_view(proto_row))

            next_cursor = response.next_cursor
            if not next_cursor:
                break
            cursor = next_cursor

        if pages_fetched == _MAX_PAGES:
            logger.warning(
                "MetricsGrpcClient.query_metrics: reached _MAX_PAGES=%d limit "
                "for workspace_id=%r — possible unbounded result set.",
                _MAX_PAGES,
                workspace_id,
            )

        return rows

    def as_metric_source(self) -> dict:
        """Return the dict contract expected by build_pnl_context's _query_gateway arg.

        Usage:
            metric_source = MetricsGrpcClient().as_metric_source()
            agent = PnlInsightAgent(gateway=..., _query_gateway=metric_source)

        @paradigm: sql — pure dict construction; no computation.
        """
        return {
            "query_metrics": self.query_metrics,
            "DateRange": DateRange,
        }


# ---------------------------------------------------------------------------
# Proto row → MetricRowView mapping
# ---------------------------------------------------------------------------

def _proto_row_to_view(proto_row: Any) -> MetricRowView:
    """Map a proto MetricRow to a MetricRowView.

    @paradigm: sql — pure field projection + type coercion; no derivation.

    Field mapping:
        proto int64 _mu fields → python int (direct assignment; proto guarantees int64)
        proto Int32Value nullable fields → int | None (via _unwrap_int32value)
        proto string date → str (already "YYYY-MM-DD" from the servicer)
    """
    return MetricRowView(
        date=proto_row.date,                          # str "YYYY-MM-DD"
        net_sales_mu=int(proto_row.net_sales_mu),     # int64 → int
        cm1_mu=int(proto_row.cm1_mu),
        cm2_mu=int(proto_row.cm2_mu),
        cm3_mu=int(proto_row.cm3_mu),
        cogs_mu=int(proto_row.cogs_mu),
        total_ad_spend_mu=int(proto_row.total_ad_spend_mu),
        total_orders=0,                               # computed by context builder
        aov_mu=_unwrap_int32value(proto_row.aov_mu),
    )


def _unwrap_int32value(wrapper: Any) -> Optional[int]:
    """Unwrap a proto Int32Value message to int | None.

    The proto client deserialises Int32Value as a message object with a .value
    field. The analytics servicer sets it via CopyFrom() only when the domain
    row has a non-None value.

    When the field is not set in the serialized bytes, the proto client returns
    a default Int32Value message (value=0, ByteSize()==0). We cannot call
    HasField on the message itself (it's a sub-message field), but we CAN call
    HasField on the parent via the field descriptor. For simplicity, we use
    proto's built-in: if the wrapper's ByteSize is 0, the field was not set.

    For the aov_mu field specifically: the analytics domain MetricRow has
    `aov_mu: int | None = None` — None means zero-denominator day. The servicer
    only sets proto_row.aov_mu.CopyFrom(...) when it's non-None. A proto client
    receiving a response where aov_mu was not set gets a ByteSize==0 default
    wrapper. ByteSize==0 → we return None (matches the domain contract).
    """
    if wrapper is None:
        return None
    try:
        # ByteSize() == 0 ↔ field was not set (no bytes were written for this field).
        if wrapper.ByteSize() == 0:
            return None
        return int(wrapper.value)
    except Exception:
        return None

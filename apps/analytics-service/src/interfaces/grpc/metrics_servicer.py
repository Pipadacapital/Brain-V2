"""
metrics_servicer.py — grpcio adapter for MetricsService (DDD interfaces layer).

@paradigm: sql + io/event-handling (no ML, no LLM)

DDD PLACEMENT: this is a thin adapter in the interfaces/grpc/ layer. It maps
proto request → domain call → proto response. ALL business logic stays in
src/infrastructure/clickhouse/query_gateway.py (the single CF-C4 entry-point).

CF-C4-QUERY-SCOPE-ISOLATION-1 (HIGH): workspace_id is extracted directly from
    the proto request and passed to query_metrics() as the FIRST positional arg.
    A falsy workspace_id causes query_metrics() to raise UnscopedQueryError,
    which this adapter converts to gRPC INVALID_ARGUMENT — fail-closed.
CF-C4-SINGLE-WRITER-1: this is a READ-ONLY adapter — no writes.
GRPC-REGISTRY-ONLY: this adapter NEVER derives metrics from the proto layer.
    All values come from the query_gateway; the servicer is a pure mapper.

RPC wiring status (ADR-0001, Step 2):
    QueryMetrics   — REAL: maps proto → query_metrics() → proto response.
    GetKpiSummary  — REAL: uses query_metrics() with the full date range,
                     then aggregates totals + reads nullable fields.
                     Deferred: currency_code is fixed "INR" until the metric
                     row carries it (a Child-7 contract extension).
    GetPnlWaterfall — REAL: uses query_metrics() to read the aggregated period
                     and builds the canonical waterfall step sequence.
                     Deferred: misc_expenses_prorated_mu step hidden when NULL
                     (NULL = zero-denominator day, no non-nullable step emitted).
"""

from __future__ import annotations

import logging
import pathlib
import sys

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# sys.path bootstrap — add the committed _pb2 stubs to the path so that
# "from brain.metrics.v1 import metrics_pb2, metrics_pb2_grpc" resolves.
# Mirrors the proven ingestion pattern (webhook_server.py:151-153).
# ---------------------------------------------------------------------------
_pb2_dir = str(pathlib.Path(__file__).parent / "_pb2")
if _pb2_dir not in sys.path:
    sys.path.insert(0, _pb2_dir)

from brain.metrics.v1 import metrics_pb2, metrics_pb2_grpc  # noqa: E402

import grpc  # noqa: E402
import grpc.aio  # noqa: E402
from google.protobuf import timestamp_pb2, wrappers_pb2  # noqa: E402

from src.infrastructure.clickhouse.query_gateway import (  # noqa: E402
    DateRange,
    MetricRow,
    UnscopedQueryError,
    query_metrics,
)

# Fixed currency code until MetricRow carries it (Child-7 extension).
_CURRENCY_INR = "INR"


def _proto_timestamp_now() -> timestamp_pb2.Timestamp:
    """Return a Timestamp representing the current UTC time.

    Used as data_epoch when the row doesn't carry a snapshot timestamp.
    The CH MV does not yet stamp individual rows (Child-6 extension pending).
    """
    import time
    ts = timestamp_pb2.Timestamp()
    ts.GetCurrentTime()
    return ts


def _nullable_int32(v: int | None) -> wrappers_pb2.Int32Value | None:
    """Wrap an int or None into a nullable Int32Value (proto pattern)."""
    if v is None:
        return None
    return wrappers_pb2.Int32Value(value=v)


def _row_to_proto(row: MetricRow) -> metrics_pb2.MetricRow:
    """Map a domain MetricRow to a proto MetricRow.

    All _mu fields are int64. All _bp / nullable fields use Int32Value.
    currency_code fixed "INR" (no per-row currency in the current MV schema).
    data_epoch is server-wall-clock now (Child-6: add snapshot stamp to MV).
    """
    proto_row = metrics_pb2.MetricRow(
        workspace_id=row.workspace_id,
        date=str(row.date),
        data_epoch=_proto_timestamp_now(),
        # Revenue ladder
        gross_sales_mu=row.gross_sales_mu,
        returns_mu=row.returns_mu,
        discounts_mu=row.discounts_mu,
        net_sales_mu=row.net_sales_mu,
        total_tax_mu=row.total_tax_mu,
        net_net_tax_mu=row.net_net_tax_mu,
        shipping_revenue_mu=row.shipping_revenue_mu,
        net_revenue_mu=row.net_revenue_mu,
        # Cost ladder
        cogs_mu=row.cogs_mu,
        total_ad_spend_mu=row.total_ad_spend_mu,
        cm1_mu=row.cm1_mu,
        cm2_mu=row.cm2_mu,
        cm3_mu=row.cm3_mu,
        currency_code=_CURRENCY_INR,
    )
    # Nullable fields: set only when not None
    if row.misc_expenses_prorated_mu is not None:
        proto_row.misc_expenses_prorated_mu.CopyFrom(
            wrappers_pb2.Int32Value(value=row.misc_expenses_prorated_mu)
        )
    if row.rto_rate_bp is not None:
        proto_row.rto_rate_bp.CopyFrom(wrappers_pb2.Int32Value(value=row.rto_rate_bp))
    if row.prepaid_rate_bp is not None:
        proto_row.prepaid_rate_bp.CopyFrom(wrappers_pb2.Int32Value(value=row.prepaid_rate_bp))
    if row.conversion_rate_bp is not None:
        proto_row.conversion_rate_bp.CopyFrom(wrappers_pb2.Int32Value(value=row.conversion_rate_bp))
    if row.aov_mu is not None:
        proto_row.aov_mu.CopyFrom(wrappers_pb2.Int32Value(value=row.aov_mu))
    if row.acos_bp is not None:
        proto_row.acos_bp.CopyFrom(wrappers_pb2.Int32Value(value=row.acos_bp))
    if row.blended_roas_x100 is not None:
        proto_row.blended_roas_x100.CopyFrom(wrappers_pb2.Int32Value(value=row.blended_roas_x100))
    if row.meta_ctr_bp is not None:
        proto_row.meta_ctr_bp.CopyFrom(wrappers_pb2.Int32Value(value=row.meta_ctr_bp))
    if row.meta_cpc_mu is not None:
        proto_row.meta_cpc_mu.CopyFrom(wrappers_pb2.Int32Value(value=row.meta_cpc_mu))
    if row.meta_cpm_mu is not None:
        proto_row.meta_cpm_mu.CopyFrom(wrappers_pb2.Int32Value(value=row.meta_cpm_mu))
    if row.google_ctr_bp is not None:
        proto_row.google_ctr_bp.CopyFrom(wrappers_pb2.Int32Value(value=row.google_ctr_bp))
    if row.google_avg_cpc_mu is not None:
        proto_row.google_avg_cpc_mu.CopyFrom(wrappers_pb2.Int32Value(value=row.google_avg_cpc_mu))
    return proto_row


def _parse_date_range(date_start: str, date_end: str) -> DateRange:
    """Parse ISO date strings into a DateRange value object."""
    from datetime import date as date_cls
    start = date_cls.fromisoformat(date_start)
    end = date_cls.fromisoformat(date_end)
    return DateRange(start=start, end=end)


class MetricsServiceAdapter(metrics_pb2_grpc.MetricsServiceServicer):
    """Thin grpcio adapter: proto requests → query_gateway → proto responses.

    DDD: this is the interfaces/grpc layer. No business logic here.
    All computation is delegated to query_metrics() (the single CF-C4 entry-point).

    The adapter accepts an optional _query_metrics callable for testing (DI),
    defaulting to the real query_metrics from query_gateway.
    """

    def __init__(self, *, _query_metrics_fn=None, _ch_client=None) -> None:
        """
        Args:
            _query_metrics_fn: (test injection) replacement for query_metrics.
                Signature: (workspace_id, definition_id, date_range, *, _client) -> list[MetricRow].
                If None, uses the real query_metrics from query_gateway.
            _ch_client: (test injection) ClickHouse client passed through to
                query_metrics as _client= when _query_metrics_fn is None.
        """
        self._query_metrics_fn = _query_metrics_fn or query_metrics
        self._ch_client = _ch_client

    def _run_query(
        self,
        workspace_id: str,
        date_range: DateRange,
        definition_id: str = "net_revenue_mu",
    ) -> list[MetricRow]:
        """Delegate to query_metrics (the CF-C4 single entry-point).

        UnscopedQueryError propagates upward; the RPC handler converts it.
        """
        return self._query_metrics_fn(
            workspace_id,
            definition_id,
            date_range,
            _client=self._ch_client,
        )

    async def QueryMetrics(self, request, context):
        """QueryMetrics — map proto request → query_metrics() → proto response.

        @paradigm: sql (CF-C4-QUERY-SCOPE-ISOLATION-1)
        Workspace-scoped, fail-closed: empty workspace_id → INVALID_ARGUMENT.
        definition_ids are used for observability; column-level filtering is
        a Child-5/6 concern (all columns are always returned from the MV).

        abort() raises grpc.aio.AbortError which propagates to the gRPC framework
        and sends the error status to the client. Code after abort() never runs.
        """
        try:
            date_range = _parse_date_range(request.date_start, request.date_end)
        except (ValueError, TypeError) as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"QueryMetrics: invalid date range: {exc}")
            return metrics_pb2.QueryMetricsResponse()  # unreachable; abort() raises

        definition_id = request.definition_ids[0] if request.definition_ids else "net_revenue_mu"

        try:
            rows = self._run_query(request.workspace_id, date_range, definition_id)
        except UnscopedQueryError as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"QueryMetrics: workspace_id required. {exc}")
            return metrics_pb2.QueryMetricsResponse()  # unreachable; abort() raises
        except Exception as exc:
            logger.exception("QueryMetrics: unexpected error workspace_id=%r", request.workspace_id)
            await context.abort(grpc.StatusCode.INTERNAL, f"QueryMetrics: internal error: {exc}")
            return metrics_pb2.QueryMetricsResponse()  # unreachable; abort() raises

        proto_rows = [_row_to_proto(r) for r in rows]
        return metrics_pb2.QueryMetricsResponse(
            rows=proto_rows,
            data_epoch=_proto_timestamp_now(),
            next_cursor="",  # Cursor pagination deferred (Child-7 scope)
        )

    async def GetKpiSummary(self, request, context):
        """GetKpiSummary — aggregate the period into a typed KpiSummaryRow.

        @paradigm: sql — all aggregation is Python-side integer arithmetic
        over query_gateway rows. No LLMs, no derived fields, no ad-hoc values.
        Every field is a named registry metric (CF-C6-REGISTRY-ONLY-BFF-1).

        Deferred: currency_code is "INR" until the MV carries per-row currency.
        total_orders is a count of non-zero net_sales rows as an approximation
        (the exact order count lives in a separate raw orders table — Child-7).
        """
        try:
            date_range = _parse_date_range(request.date_start, request.date_end)
        except (ValueError, TypeError) as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"GetKpiSummary: invalid date range: {exc}")
            return metrics_pb2.GetKpiSummaryResponse()

        try:
            rows = self._run_query(request.workspace_id, date_range, "cm2_mu")
        except UnscopedQueryError as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"GetKpiSummary: workspace_id required. {exc}")
            return metrics_pb2.GetKpiSummaryResponse()
        except Exception as exc:
            logger.exception("GetKpiSummary: unexpected error workspace_id=%r", request.workspace_id)
            await context.abort(grpc.StatusCode.INTERNAL, f"GetKpiSummary: internal error: {exc}")
            return metrics_pb2.GetKpiSummaryResponse()

        # Aggregate: sum integer fields, take last-row nullable ratios.
        total_net_revenue = sum(r.net_revenue_mu for r in rows)
        total_cm2 = sum(r.cm2_mu for r in rows)
        total_cm3 = sum(r.cm3_mu for r in rows)
        # total_orders approximation: count rows with non-zero net_sales (daily granularity)
        total_orders = sum(1 for r in rows if r.net_sales_mu > 0)
        # Nullable ratios: use last row with a value present
        rto_rate_bp = next((r.rto_rate_bp for r in reversed(rows) if r.rto_rate_bp is not None), None)
        blended_roas = next((r.blended_roas_x100 for r in reversed(rows) if r.blended_roas_x100 is not None), None)
        aov_mu = next((r.aov_mu for r in reversed(rows) if r.aov_mu is not None), None)
        conversion_rate = next(
            (r.conversion_rate_bp for r in reversed(rows) if r.conversion_rate_bp is not None), None
        )

        period = f"{request.date_start}/{request.date_end}"
        summary = metrics_pb2.KpiSummaryRow(
            workspace_id=request.workspace_id,
            period=period,
            data_epoch=_proto_timestamp_now(),
            currency_code=_CURRENCY_INR,
            net_revenue_mu=total_net_revenue,
            cm2_mu=total_cm2,
            cm3_mu=total_cm3,
            total_orders=total_orders,
        )
        if rto_rate_bp is not None:
            summary.rto_rate_bp.CopyFrom(wrappers_pb2.Int32Value(value=rto_rate_bp))
        if blended_roas is not None:
            summary.blended_roas_x100.CopyFrom(wrappers_pb2.Int32Value(value=blended_roas))
        if aov_mu is not None:
            summary.aov_mu.CopyFrom(wrappers_pb2.Int32Value(value=aov_mu))
        if conversion_rate is not None:
            summary.conversion_rate_bp.CopyFrom(wrappers_pb2.Int32Value(value=conversion_rate))

        return metrics_pb2.GetKpiSummaryResponse(
            summary=summary,
            data_epoch=_proto_timestamp_now(),
        )

    async def GetPnlWaterfall(self, request, context):
        """GetPnlWaterfall — build the canonical P&L waterfall from aggregated rows.

        @paradigm: sql — all values are integer aggregates from query_gateway.
        No LLMs, no derived fields beyond the canonical waterfall step sequence.
        Each step corresponds to a named registry definition_id
        (CF-C6-REGISTRY-ONLY-BFF-1).

        Waterfall steps emitted (in order):
            net_revenue_mu   → Gross revenue step (anchor)
            cogs_mu          → COGS deduction (negative)
            cm1_mu           → CM1 after COGS
            total_ad_spend_mu → Ad spend deduction (negative)
            cm2_mu           → CM2 after ad spend
            misc_expenses_prorated_mu → Misc. expenses deduction (only when present)
            cm3_mu           → CM3 (final waterfall step)

        Deferred: misc_expenses_prorated_mu step omitted when all rows are NULL
        (zero-denominator day). currency_code fixed "INR" until Child-7.
        """
        try:
            date_range = _parse_date_range(request.date_start, request.date_end)
        except (ValueError, TypeError) as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"GetPnlWaterfall: invalid date range: {exc}")
            return metrics_pb2.GetPnlWaterfallResponse()

        try:
            rows = self._run_query(request.workspace_id, date_range, "cm3_mu")
        except UnscopedQueryError as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"GetPnlWaterfall: workspace_id required. {exc}")
            return metrics_pb2.GetPnlWaterfallResponse()
        except Exception as exc:
            logger.exception("GetPnlWaterfall: unexpected error workspace_id=%r", request.workspace_id)
            await context.abort(grpc.StatusCode.INTERNAL, f"GetPnlWaterfall: internal error: {exc}")
            return metrics_pb2.GetPnlWaterfallResponse()

        # Sum the period
        net_revenue = sum(r.net_revenue_mu for r in rows)
        cogs = sum(r.cogs_mu for r in rows)
        cm1 = sum(r.cm1_mu for r in rows)
        ad_spend = sum(r.total_ad_spend_mu for r in rows)
        cm2 = sum(r.cm2_mu for r in rows)
        cm3 = sum(r.cm3_mu for r in rows)
        misc_list = [r.misc_expenses_prorated_mu for r in rows if r.misc_expenses_prorated_mu is not None]
        misc_total = sum(misc_list) if misc_list else None

        data_epoch = _proto_timestamp_now()

        def step(definition_id: str, label: str, value: int, cumulative: int) -> metrics_pb2.PnlWaterfallRow:
            return metrics_pb2.PnlWaterfallRow(
                definition_id=definition_id,
                label=label,
                value_mu=value,
                cumulative_mu=cumulative,
                currency_code=_CURRENCY_INR,
                data_epoch=data_epoch,
            )

        steps = [
            step("net_revenue_mu",   "Net Revenue",    net_revenue,   net_revenue),
            step("cogs_mu",          "COGS",           -cogs,         net_revenue - cogs),
            step("cm1_mu",           "CM1",            cm1,           cm1),
            step("total_ad_spend_mu", "Ad Spend",      -ad_spend,     cm1 - ad_spend),
            step("cm2_mu",           "CM2",            cm2,           cm2),
        ]
        if misc_total is not None:
            steps.append(step(
                "misc_expenses_prorated_mu", "Misc. Expenses",
                -misc_total,
                cm2 - misc_total,
            ))
        steps.append(step("cm3_mu", "CM3", cm3, cm3))

        return metrics_pb2.GetPnlWaterfallResponse(
            steps=steps,
            data_epoch=data_epoch,
        )

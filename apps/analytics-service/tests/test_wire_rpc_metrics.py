"""
test_wire_rpc_metrics.py — Wire-RPC CI gate for MetricsService (ADR-0001 §4).

These tests start the REAL grpc.aio server on a loopback port, wait for
grpc_health.v1 Check = SERVING, open a grpcio channel, and round-trip at
least one business RPC asserting a typed response. A test fails if the RPC
returns UNIMPLEMENTED or the servicer is unregistered.

This is the ADR-0001 "recurrence-killer" gate: it makes the "never served"
class of bug (a registered health probe hiding an unregistered business RPC)
structurally impossible to reintroduce without a red build.

Test design:
  - test_query_metrics_wire_round_trip (NO external deps):
      Uses an injected fake _query_metrics_fn that returns real MetricRow objects.
      This test runs in the NORMAL pytest suite (no @pytest.mark.integration).
  - test_get_kpi_summary_wire_round_trip (NO external deps): Same shape.
  - test_get_pnl_waterfall_wire_round_trip (NO external deps): Same shape.
  - test_empty_workspace_returns_invalid_argument: Validates fail-closed invariant.

Port selection: loopback port 0 lets the OS pick a free port, avoiding conflicts.

@paradigm: sql + io/event-handling (test toolchain only — no ML, no LLM)
"""

from __future__ import annotations

import asyncio
import datetime
import sys
import pathlib
from unittest.mock import MagicMock

import pytest

# ---------------------------------------------------------------------------
# Ensure the _pb2 stubs are importable in the test process
# ---------------------------------------------------------------------------
_pb2_dir = str(pathlib.Path(__file__).parent.parent / "src" / "interfaces" / "grpc" / "_pb2")
if _pb2_dir not in sys.path:
    sys.path.insert(0, _pb2_dir)


# ---------------------------------------------------------------------------
# Fixture: a fake _query_metrics_fn that returns real MetricRow objects
# without requiring a ClickHouse connection.
# ---------------------------------------------------------------------------

def _make_fake_query_metrics():
    """Return a fake query_metrics callable with real MetricRow objects.

    Enforces the same CF-C4-QUERY-SCOPE-ISOLATION-1 workspace_id check as the
    real query_metrics — so the fail-closed test can validate INVALID_ARGUMENT
    without a live ClickHouse connection.
    """
    from src.infrastructure.clickhouse.query_gateway import DateRange, MetricRow, UnscopedQueryError
    import datetime as dt

    def fake_query_metrics(workspace_id, definition_id, date_range, *, _client=None):
        # Mirror the real query_metrics CF-C4 guard (fail-closed invariant test)
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                f"query_metrics: workspace_id must not be empty or None. "
                f"Got workspace_id={workspace_id!r}. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )
        return [
            MetricRow(
                workspace_id=workspace_id,
                date=dt.date(2026, 5, 1),
                gross_sales_mu=1_000_000,
                returns_mu=50_000,
                discounts_mu=20_000,
                net_sales_mu=930_000,
                total_tax_mu=100_000,
                net_net_tax_mu=830_000,
                shipping_revenue_mu=30_000,
                net_revenue_mu=860_000,
                cogs_mu=400_000,
                total_ad_spend_mu=100_000,
                cm1_mu=460_000,
                cm2_mu=360_000,
                misc_expenses_prorated_mu=None,
                cm3_mu=360_000, total_orders=11,
                rto_rate_bp=500,
                prepaid_rate_bp=6000,
                conversion_rate_bp=200,
                aov_mu=85000,
                acos_bp=1200,
                blended_roas_x100=300,
            ),
        ]

    return fake_query_metrics


# ---------------------------------------------------------------------------
# Async helper: start server on a free loopback port, run test fn, stop.
# ---------------------------------------------------------------------------

async def _run_with_server(test_fn):
    """Start the real grpc.aio server on a loopback port and run test_fn(port)."""
    import grpc
    import grpc.aio
    from grpc_health.v1 import health, health_pb2, health_pb2_grpc

    from src.interfaces.grpc.metrics_servicer import (
        MetricsServiceAdapter,
        metrics_pb2,
        metrics_pb2_grpc,
    )

    server = grpc.aio.server()

    # Wire the real adapter with an injected fake query_metrics_fn (no CH needed)
    servicer = MetricsServiceAdapter(_query_metrics_fn=_make_fake_query_metrics())
    metrics_pb2_grpc.add_MetricsServiceServicer_to_server(servicer, server)

    # Health service (ADR-0001: health must stay SERVING alongside business RPCs)
    health_servicer = health.HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)

    # Port 0 = OS picks a free port (no conflict risk)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()

    try:
        await test_fn(port, metrics_pb2, metrics_pb2_grpc, health_pb2, health_pb2_grpc)
    finally:
        await server.stop(grace=0)


async def _wait_serving(stub, health_pb2, timeout: float = 3.0):
    """Poll grpc_health.v1 until SERVING or timeout."""
    from grpc_health.v1 import health_pb2 as hp2
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        try:
            resp = await stub.Check(hp2.HealthCheckRequest(service=""))
            if resp.status == hp2.HealthCheckResponse.SERVING:
                return
        except Exception:
            pass
        await asyncio.sleep(0.05)
    raise TimeoutError("gRPC server did not become SERVING within timeout")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_query_metrics_wire_round_trip():
    """Start the real grpc.aio server and round-trip QueryMetrics over the wire.

    ADR-0001 recurrence-killer: fails if QueryMetrics returns UNIMPLEMENTED
    or the servicer is unregistered.

    No external deps: uses injected fake query_metrics_fn.
    """
    async def inner(port, metrics_pb2, metrics_pb2_grpc, health_pb2, health_pb2_grpc):
        import grpc
        import grpc.aio

        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            metrics_stub = metrics_pb2_grpc.MetricsServiceStub(channel)
            request = metrics_pb2.QueryMetricsRequest(
                workspace_id="ws-test-001",
                definition_ids=["net_revenue_mu"],
                date_start="2026-05-01",
                date_end="2026-05-31",
            )

            response = await metrics_stub.QueryMetrics(request)

            # Typed response — not UNIMPLEMENTED
            assert isinstance(response, metrics_pb2.QueryMetricsResponse), (
                "QueryMetrics must return a typed QueryMetricsResponse, not raise UNIMPLEMENTED"
            )
            assert len(response.rows) == 1, (
                f"Expected 1 MetricRow from fake provider, got {len(response.rows)}"
            )
            row = response.rows[0]
            assert row.workspace_id == "ws-test-001"
            assert row.net_revenue_mu == 860_000
            assert row.cm2_mu == 360_000
            # data_epoch must be populated (CF-C6-AS-OF-STAMP-1)
            assert response.data_epoch is not None

    await _run_with_server(inner)


@pytest.mark.asyncio
async def test_get_kpi_summary_wire_round_trip():
    """Round-trip GetKpiSummary — asserts aggregated typed KpiSummaryRow.

    No external deps: uses injected fake query_metrics_fn.
    """
    async def inner(port, metrics_pb2, metrics_pb2_grpc, health_pb2, health_pb2_grpc):
        import grpc.aio

        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            metrics_stub = metrics_pb2_grpc.MetricsServiceStub(channel)
            request = metrics_pb2.GetKpiSummaryRequest(
                workspace_id="ws-test-001",
                date_start="2026-05-01",
                date_end="2026-05-31",
            )

            response = await metrics_stub.GetKpiSummary(request)

            assert isinstance(response, metrics_pb2.GetKpiSummaryResponse)
            summary = response.summary
            assert summary.workspace_id == "ws-test-001"
            assert summary.net_revenue_mu == 860_000
            assert summary.cm2_mu == 360_000
            assert summary.cm3_mu == 360_000
            assert summary.currency_code == "INR"
            assert summary.total_orders == 11  # real order count from MetricRow.total_orders

    await _run_with_server(inner)


@pytest.mark.asyncio
async def test_get_pnl_waterfall_wire_round_trip():
    """Round-trip GetPnlWaterfall — asserts typed waterfall steps.

    No external deps: uses injected fake query_metrics_fn.
    """
    async def inner(port, metrics_pb2, metrics_pb2_grpc, health_pb2, health_pb2_grpc):
        import grpc.aio

        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            metrics_stub = metrics_pb2_grpc.MetricsServiceStub(channel)
            request = metrics_pb2.GetPnlWaterfallRequest(
                workspace_id="ws-test-001",
                date_start="2026-05-01",
                date_end="2026-05-31",
            )

            response = await metrics_stub.GetPnlWaterfall(request)

            assert isinstance(response, metrics_pb2.GetPnlWaterfallResponse)
            steps = response.steps
            # Expect 6 steps (no misc_expenses since it's NULL in the fake row)
            step_ids = [s.definition_id for s in steps]
            assert "net_revenue_mu" in step_ids
            assert "cm1_mu" in step_ids
            assert "cm2_mu" in step_ids
            assert "cm3_mu" in step_ids
            # Verify anchor step value
            net_rev_step = next(s for s in steps if s.definition_id == "net_revenue_mu")
            assert net_rev_step.value_mu == 860_000
            assert net_rev_step.currency_code == "INR"

    await _run_with_server(inner)


@pytest.mark.asyncio
async def test_empty_workspace_returns_invalid_argument():
    """Empty workspace_id → INVALID_ARGUMENT (fail-closed invariant).

    CF-C4-QUERY-SCOPE-ISOLATION-1: the servicer must never serve rows for
    an un-scoped request — fail-closed means INVALID_ARGUMENT, not UNIMPLEMENTED.
    """
    import grpc
    import grpc.aio

    async def inner(port, metrics_pb2, metrics_pb2_grpc, health_pb2, health_pb2_grpc):
        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            metrics_stub = metrics_pb2_grpc.MetricsServiceStub(channel)
            request = metrics_pb2.QueryMetricsRequest(
                workspace_id="",  # empty — must be rejected
                definition_ids=["net_revenue_mu"],
                date_start="2026-05-01",
                date_end="2026-05-31",
            )

            with pytest.raises(grpc.aio.AioRpcError) as exc_info:
                await metrics_stub.QueryMetrics(request)

            rpc_error = exc_info.value
            assert rpc_error.code() == grpc.StatusCode.INVALID_ARGUMENT, (
                f"Expected INVALID_ARGUMENT for empty workspace_id, got {rpc_error.code()}"
            )

    await _run_with_server(inner)


@pytest.mark.asyncio
async def test_health_stays_serving_with_metrics_registered():
    """Health probe must return SERVING when MetricsService is also registered.

    ADR-0001 §4: health stays SERVING — no double-registration of health,
    no interference between MetricsService and the health servicer.
    """
    from grpc_health.v1 import health_pb2 as hp2

    async def inner(port, metrics_pb2, metrics_pb2_grpc, health_pb2, health_pb2_grpc):
        import grpc.aio

        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            # Health check after MetricsService is registered
            resp = await health_stub.Check(hp2.HealthCheckRequest(service=""))
            assert resp.status == hp2.HealthCheckResponse.SERVING, (
                f"Health must be SERVING with MetricsService registered, got {resp.status}"
            )

    await _run_with_server(inner)

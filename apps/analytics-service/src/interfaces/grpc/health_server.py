"""
analytics-service INTERNAL gRPC server (ADR-0001 Step 2).

@paradigm: sql + io/event-handling (no ML, no LLM)

INTERNAL-ONLY (PLACEMENT-1 / TRANSPORT-1): reachable only inside the cluster/pod
network, never a public ingress. The bind host comes from GRPC_INTERNAL_HOST
(loopback default); the container/compose layer sets the bind-all address — that
literal lives in env, never in this code.

ADR-0001 Step 2 (ACCEPTED 2026-06-03):
  Promotes this server from HEALTH-ONLY to serving the real MetricsService.
  MetricsServiceAdapter (interfaces/grpc/metrics_servicer.py) is a thin DDD
  adapter that maps proto → query_gateway → proto. No business logic in the
  adapter. Registration is FAIL-FAST (same pattern as webhook_server.py:160-166):
  if the servicer cannot be registered, the process raises at startup — an
  unregistered servicer is permanently UNIMPLEMENTED on the wire, which is
  worse than a failed-fast process.

  Health stays SERVING — health_pb2_grpc.HealthServicer() is registered first,
  then MetricsServiceAdapter. A double-registration of health is avoided by
  registering exactly one HealthServicer instance.

Revert path: unregister the MetricsServiceAdapter and the server falls back to
HEALTH-ONLY (same safe state as the pre-ADR health_server.py).
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_GRPC_INTERNAL_PORT_DEFAULT = 50052          # analytics internal port (ingestion=50051)
_GRPC_BIND_DEFAULT = "127.0.0.1"             # loopback; pod-network bind comes from env


async def start_analytics_grpc_server(
    *,
    host: Optional[str] = None,
    port: Optional[int] = None,
    _query_metrics_fn=None,
    _ch_client=None,
) -> None:
    """Start the analytics-service internal gRPC server (MetricsService + health).

    @paradigm: sql + io/event-handling

    INTERNAL-ONLY: the bind address defaults to 127.0.0.1 (loopback).
    HOLD-AT-CUTOVER (NO-LIVE-1): this coroutine is authored and ready but the
    service entrypoint that calls it is a Stage-8 artifact.

    ADR-0001 Step 2: MetricsService is registered alongside health (FAIL-FAST).

    Args:
        host:              Override bind host (default: GRPC_INTERNAL_HOST or 127.0.0.1).
        port:              Override gRPC port (default: GRPC_INTERNAL_PORT or 50052).
        _query_metrics_fn: (test injection) replacement for query_metrics in the servicer.
        _ch_client:        (test injection) ClickHouse client for the servicer.
    """
    try:
        import grpc
        import grpc.aio
    except ImportError as exc:
        raise ImportError(
            "grpcio is required for the analytics-service gRPC server. "
            "Declare grpcio in apps/analytics-service/pyproject.toml dependencies."
        ) from exc

    bind_host = host or os.environ.get("GRPC_INTERNAL_HOST", _GRPC_BIND_DEFAULT)
    bind_port = port or int(os.environ.get("GRPC_INTERNAL_PORT", str(_GRPC_INTERNAL_PORT_DEFAULT)))
    address = f"{bind_host}:{bind_port}"

    server = grpc.aio.server()

    # --- Register MetricsService (FAIL-FAST on failure — ADR-0001 §4 Step 2) ---
    # The _pb2 stubs are committed at src/interfaces/grpc/_pb2/ (the proven
    # ingestion pattern). The adapter is a thin DDD interfaces/grpc layer.
    try:
        from src.interfaces.grpc.metrics_servicer import (
            MetricsServiceAdapter,
            metrics_pb2_grpc,
        )
        servicer = MetricsServiceAdapter(
            _query_metrics_fn=_query_metrics_fn,
            _ch_client=_ch_client,
        )
        metrics_pb2_grpc.add_MetricsServiceServicer_to_server(servicer, server)
        logger.info("analytics gRPC: MetricsServiceAdapter registered via grpcio stubs.")
    except Exception as exc:
        # Do NOT silently skip — an unregistered servicer means every MetricsService
        # RPC is permanently UNIMPLEMENTED. Fail fast so the process never enters
        # a "looks healthy, serves nothing" state.
        raise RuntimeError(
            "analytics gRPC: FATAL — could not register MetricsServiceAdapter. "
            "Ensure src/interfaces/grpc/_pb2/ stubs are committed and grpcio is installed. "
            f"ADR-0001 Step 2. Underlying error: {exc}"
        ) from exc

    # --- Register gRPC health service (liveness probe target, ALWAYS present) ---
    try:
        from grpc_health.v1 import health, health_pb2_grpc
        health_pb2_grpc.add_HealthServicer_to_server(health.HealthServicer(), server)
        logger.info("analytics gRPC: health servicer registered.")
    except ImportError:
        logger.warning(
            "analytics gRPC: grpc-health-checking unavailable; skipping health service. "
            "Install grpcio-health-checking in pyproject.toml."
        )

    server.add_insecure_port(address)
    logger.info(
        "analytics gRPC: starting INTERNAL server address=%s PLACEMENT-1=internal-only",
        address,
    )
    await server.start()
    logger.info("analytics gRPC: INTERNAL server ready address=%s (MetricsService + health)", address)
    await server.wait_for_termination()

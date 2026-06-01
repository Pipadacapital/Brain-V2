"""
analytics-service INTERNAL gRPC server (Phase-A slice PA-2a).

@paradigm: sql + io/event-handling (no ML, no LLM)

INTERNAL-ONLY (PLACEMENT-1 / TRANSPORT-1): reachable only inside the cluster/pod
network, never a public ingress. The bind host comes from GRPC_INTERNAL_HOST
(loopback default); the container/compose layer sets the bind-all address — that
literal lives in env, never in this code.

HEALTH-ONLY surface for now: the real MetricsService servicer (and the gateway
flip onto it) is a later slice — no Python proto stubs exist yet
(pylibs/brain_grpc is un-generated). The value this process ships is an
independently runnable analytics-service whose fail-closed startup gate
(ap-south-1 ClickHouse residency + read-only Postgres role) has run before it
binds. The standard gRPC health service is the liveness signal.
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
) -> None:
    """Start the analytics-service internal gRPC server (health-only for PA-2a)."""
    try:
        import grpc  # noqa: F401
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

    # Real MetricsService servicer is a later slice (no generated Python stubs yet).
    try:
        import brain_grpc._gen.brain.metrics.v1  # noqa: F401
        logger.info("analytics gRPC: metrics proto stubs present (servicer wiring is a later slice)")
    except ImportError:
        logger.warning(
            "analytics gRPC: metrics proto stubs not generated — HEALTH-ONLY mode. "
            "Run `buf generate protos` + wire MetricsService in the gateway-flip slice."
        )

    # Standard gRPC health service (liveness probe target).
    try:
        from grpc_health.v1 import health, health_pb2_grpc
        health_pb2_grpc.add_HealthServicer_to_server(health.HealthServicer(), server)
    except ImportError:
        logger.info("analytics gRPC: grpc-health-checking unavailable; skipping health service.")

    server.add_insecure_port(address)
    logger.info(
        "analytics gRPC: starting INTERNAL server address=%s PLACEMENT-1=internal-only", address
    )
    await server.start()
    logger.info("analytics gRPC: INTERNAL server ready address=%s", address)
    await server.wait_for_termination()

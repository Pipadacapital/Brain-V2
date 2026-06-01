"""
intelligence-service INTERNAL gRPC server (Phase-A slice PA-2b).

@paradigm: sql + io/event-handling (the LLM calls themselves are small_llm/
frontier_llm, but NONE are invoked at boot — this is server lifecycle only)

INTERNAL-ONLY (PLACEMENT-1 / TRANSPORT-1): reachable only inside the cluster/pod
network, never a public ingress. The bind host comes from GRPC_INTERNAL_HOST
(loopback default); the container/compose layer supplies the pod-network bind —
that literal lives in env, never in this code.

HEALTH-ONLY surface for now: the real IntelligenceService servicer
(GetMorningBrief/SubmitInsightResponse/RegisterPushToken) is served in-process by
the api-gateway today, and the long-running daily-tick/Morning-Brief runtime is
canon-deferred to Phase-D. No Python proto stubs exist yet. The value this
process ships is an independently runnable intelligence-service whose fail-closed
India-residency gate has run before it binds.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_GRPC_INTERNAL_PORT_DEFAULT = 50053          # intelligence internal port (ingestion=50051, analytics=50052)
_GRPC_BIND_DEFAULT = "127.0.0.1"             # loopback; pod-network bind comes from env


async def start_intelligence_grpc_server(
    *,
    host: Optional[str] = None,
    port: Optional[int] = None,
) -> None:
    """Start the intelligence-service internal gRPC server (health-only for PA-2b)."""
    try:
        import grpc  # noqa: F401
        import grpc.aio
    except ImportError as exc:
        raise ImportError(
            "grpcio is required for the intelligence-service gRPC server. "
            "Declare grpcio in apps/intelligence-service/pyproject.toml dependencies."
        ) from exc

    bind_host = host or os.environ.get("GRPC_INTERNAL_HOST", _GRPC_BIND_DEFAULT)
    bind_port = port or int(os.environ.get("GRPC_INTERNAL_PORT", str(_GRPC_INTERNAL_PORT_DEFAULT)))
    address = f"{bind_host}:{bind_port}"

    server = grpc.aio.server()

    # Real IntelligenceService servicer is a later slice (no generated Python stubs yet).
    try:
        import brain_grpc._gen.brain.intelligence.v1  # noqa: F401
        logger.info("intelligence gRPC: proto stubs present (servicer wiring is a later slice)")
    except ImportError:
        logger.warning(
            "intelligence gRPC: proto stubs not generated — HEALTH-ONLY mode. "
            "Run `buf generate protos` + wire IntelligenceService in the gateway-flip slice."
        )

    # Standard gRPC health service (liveness probe target).
    try:
        from grpc_health.v1 import health, health_pb2_grpc
        health_pb2_grpc.add_HealthServicer_to_server(health.HealthServicer(), server)
    except ImportError:
        logger.info("intelligence gRPC: grpc-health-checking unavailable; skipping health service.")

    server.add_insecure_port(address)
    logger.info(
        "intelligence gRPC: starting INTERNAL server address=%s PLACEMENT-1=internal-only", address
    )
    await server.start()
    logger.info("intelligence gRPC: INTERNAL server ready address=%s", address)
    await server.wait_for_termination()

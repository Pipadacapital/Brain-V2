"""
intelligence-service INTERNAL gRPC server (ADR-0001 Step 3).

@paradigm: sql + io/event-handling (the LLM calls themselves are small_llm/
frontier_llm, but NONE are invoked at boot — this is server lifecycle only)

INTERNAL-ONLY (PLACEMENT-1 / TRANSPORT-1): reachable only inside the cluster/pod
network, never a public ingress. The bind host comes from GRPC_INTERNAL_HOST
(loopback default); the container/compose layer supplies the pod-network bind —
that literal lives in env, never in this code.

ADR-0001 Step 3 (ACCEPTED 2026-06-03):
  Promotes this server from HEALTH-ONLY to serving the real IntelligenceService.
  IntelligenceServiceAdapter (interfaces/grpc/intelligence_servicer.py) is a thin
  DDD adapter (no business logic). Registration is FAIL-FAST (same pattern as
  webhook_server.py:160-166 and analytics health_server.py Step 2):
  if the servicer cannot be registered, the process raises at startup — an
  unregistered servicer is permanently UNIMPLEMENTED on the wire, which is
  worse than a failed-fast process.

  Health stays SERVING. Exactly one HealthServicer is registered.

  Phase-D deferral: the full daily-tick/Morning-Brief runtime is Phase-D
  (GetMorningBrief Tier-B Sonnet synthesis). The RPC is REGISTERED on the wire
  today. The adapter returns typed responses for all three RPCs.

  Revert path: unregister IntelligenceServiceAdapter → server falls back to
  HEALTH-ONLY (same safe state as the pre-ADR health_server.py).
"""

from __future__ import annotations

import logging
import os
from typing import Optional, Callable

logger = logging.getLogger(__name__)

_GRPC_INTERNAL_PORT_DEFAULT = 50053          # intelligence internal port
_GRPC_BIND_DEFAULT = "127.0.0.1"             # loopback; pod-network bind comes from env


async def start_intelligence_grpc_server(
    *,
    host: Optional[str] = None,
    port: Optional[int] = None,
    _signals_provider: Optional[Callable] = None,
    _decision_log_writer: Optional[Callable] = None,
    _push_token_writer: Optional[Callable] = None,
) -> None:
    """Start the intelligence-service internal gRPC server (IntelligenceService + health).

    @paradigm: sql + io/event-handling

    INTERNAL-ONLY: the bind address defaults to 127.0.0.1 (loopback).
    HOLD-AT-CUTOVER (NO-LIVE-1): this coroutine is authored and ready but the
    service entrypoint that calls it is a Stage-8 artifact.

    ADR-0001 Step 3: IntelligenceService is registered alongside health (FAIL-FAST).

    Args:
        host:                  Override bind host (default: GRPC_INTERNAL_HOST or 127.0.0.1).
        port:                  Override gRPC port (default: GRPC_INTERNAL_PORT or 50053).
        _signals_provider:     (production/test injection) callable(workspace_id, date)
                               -> list of domain InsightItem-like objects.
                               None → Phase-D deferred path (empty brief, registered).
        _decision_log_writer:  (production/test injection) callable for decision log writes.
                               None → Phase-0/1 log-only graceful degradation.
        _push_token_writer:    (production/test injection) callable for push token upserts.
                               None → Phase-0/1 log-only graceful degradation.
    """
    try:
        import grpc
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

    # --- Register IntelligenceService (FAIL-FAST on failure — ADR-0001 §4 Step 3) ---
    # The _pb2 stubs are committed at src/interfaces/grpc/_pb2/ (the proven
    # ingestion pattern). The adapter is a thin DDD interfaces/grpc layer.
    try:
        from interfaces.grpc.intelligence_servicer import (
            IntelligenceServiceAdapter,
            intelligence_pb2_grpc,
        )
        servicer = IntelligenceServiceAdapter(
            _signals_provider=_signals_provider,
            _decision_log_writer=_decision_log_writer,
            _push_token_writer=_push_token_writer,
        )
        intelligence_pb2_grpc.add_IntelligenceServiceServicer_to_server(servicer, server)
        logger.info(
            "intelligence gRPC: IntelligenceServiceAdapter registered via grpcio stubs."
        )
    except Exception as exc:
        # Do NOT silently skip — an unregistered servicer means every IntelligenceService
        # RPC is permanently UNIMPLEMENTED. Fail fast so the process never enters
        # a "looks healthy, serves nothing" state.
        raise RuntimeError(
            "intelligence gRPC: FATAL — could not register IntelligenceServiceAdapter. "
            "Ensure src/interfaces/grpc/_pb2/ stubs are committed and grpcio is installed. "
            f"ADR-0001 Step 3. Underlying error: {exc}"
        ) from exc

    # --- Register gRPC health service (liveness probe target, ALWAYS present) ---
    try:
        from grpc_health.v1 import health, health_pb2_grpc
        health_pb2_grpc.add_HealthServicer_to_server(health.HealthServicer(), server)
        logger.info("intelligence gRPC: health servicer registered.")
    except ImportError:
        logger.warning(
            "intelligence gRPC: grpc-health-checking unavailable; skipping health service. "
            "Install grpcio-health-checking in pyproject.toml."
        )

    server.add_insecure_port(address)
    logger.info(
        "intelligence gRPC: starting INTERNAL server address=%s PLACEMENT-1=internal-only",
        address,
    )
    await server.start()
    logger.info(
        "intelligence gRPC: INTERNAL server ready address=%s "
        "(IntelligenceService + health)",
        address,
    )
    await server.wait_for_termination()

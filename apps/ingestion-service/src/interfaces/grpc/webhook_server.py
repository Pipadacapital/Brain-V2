"""
WebhookIngest gRPC server — internal pod-network listener.

@paradigm: sql + io/event-handling (no ML, no LLM)

INTERNAL-ONLY (PLACEMENT-1 / TRANSPORT-1):
  This server MUST bind to the internal pod address ONLY.
  It is NOT a public listener — it is reachable ONLY from the api-gateway
  inside the cluster (equivalent to a private VPC endpoint).
  The public choke point is the api-gateway Fastify route (Track T-GEN-B / Vikram).

HOLD-AT-CUTOVER (NO-LIVE-1):
  The live gRPC server start is a Stage-8 artifact.
  This module provides:
    - start_webhook_grpc_server() — the coroutine to wire into the service entrypoint.
    - A HELD entrypoint comment showing how to wire it.
  No live server is started by importing this module.

Startup integration:
  call run_all_gates() before start_webhook_grpc_server().
  The allowed_workspace_ids frozenset from run_all_gates() is injected into
  the servicer for the assert_workspace_allowed backstop.

gRPC generated stubs:
  The real proto-generated stub (brain.ingestion.v1.WebhookIngestService) is produced
  by `buf generate protos` into pylibs/brain_grpc/brain_grpc/_gen/.
  In this slice the servicer is registered against the stub at startup.
  Tests bypass the server and test the servicer directly.

GENERALIZATION (§0-GEN G7):
  The proto RPC is now ReceiveWebhook (was ReceiveShopifyWebhook).
  The identity resolver is now resolve_identity_workspace(vendor, external_identity)
  (was resolve_shop_workspace(shop_domain)).
  Adding vendor #2 requires ZERO change to this module.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# Internal gRPC port — NOT exposed via any public ingress (TRANSPORT-1).
# Stage-8 CDK confirms the security-group blocks external access to this port.
_GRPC_INTERNAL_PORT_DEFAULT = 50051

# Bind address — internal pod network only.
# In production Kubernetes: the pod IP (not 0.0.0.0).
# For local/test: 127.0.0.1 (loopback, not network-accessible).
_GRPC_BIND_DEFAULT = "127.0.0.1"


async def start_webhook_grpc_server(
    allowed_workspace_ids: frozenset[str],
    *,
    host: Optional[str] = None,
    port: Optional[int] = None,
    app_secret_provider_factory=None,
    identity_resolver=None,
    receive_webhook_fn=None,
    webhook_registry_override=None,
    intake_runner=None,
) -> None:
    """
    Start the internal gRPC server for WebhookIngest.

    @paradigm: sql + io/event-handling

    INTERNAL-ONLY: the bind address defaults to 127.0.0.1 (loopback) in local mode
    and the pod IP in Kubernetes.  NEVER 0.0.0.0 (that would make it a second public
    front door — Option B, explicitly rejected).

    HOLD-AT-CUTOVER (NO-LIVE-1): this coroutine is authored but the service
    entrypoint that calls it is a Stage-8 artifact.  The function is fully
    testable without a real server via direct servicer instantiation.

    GENERALIZATION: identity_resolver replaces the former shop_resolver parameter.
    The servicer now dispatches vendor-agnostically via the registry.

    KAFKA-LAZY-SINGLETON-1: starts the module-level AIOKafkaProducer at server startup
    (if KAFKA_BOOTSTRAP_SERVERS is set) and stops it on graceful shutdown.  The producer
    is then injected into each receive_webhook call by the live intake_runner.

    Args:
        allowed_workspace_ids:      From run_all_gates() — injected into the servicer.
        host:                       Override bind host (default: 127.0.0.1 for local,
                                    pod IP in prod).
        port:                       Override gRPC port (default: 50051).
        app_secret_provider_factory: Optional override for DI / testing.
        identity_resolver:          Optional override for DI / testing (replaces
                                    former shop_resolver).
        receive_webhook_fn:         Optional override for DI / testing.
        webhook_registry_override:  Optional registry dict override for DI / testing.
        intake_runner:              Optional intake runner override for DI / testing.
                                    Defaults to _live_intake_runner (with_workspace + Kafka).
    """
    try:
        import grpc
        import grpc.aio
    except ImportError as exc:
        raise ImportError(
            "grpcio is required for the WebhookIngest gRPC server. "
            "Add grpcio to ingestion-service dependencies (pyproject.toml). "
            "Stage-3 dep declaration: grpcio>=1.70.0,<2.0.0"
        ) from exc

    from src.interfaces.grpc.webhook_servicer import (
        WebhookIngestServicer,
        start_kafka_producer,
        stop_kafka_producer,
    )

    # KAFKA-LAZY-SINGLETON-1: start the producer before the server accepts requests.
    # If KAFKA_BOOTSTRAP_SERVERS is not set, start_kafka_producer() is a no-op and
    # the producer stays None (dry-run safe).
    await start_kafka_producer()

    bind_host = host or os.environ.get("GRPC_INTERNAL_HOST", _GRPC_BIND_DEFAULT)
    bind_port = port or int(os.environ.get("GRPC_INTERNAL_PORT", str(_GRPC_INTERNAL_PORT_DEFAULT)))
    address = f"{bind_host}:{bind_port}"

    servicer = WebhookIngestServicer(
        app_secret_provider_factory=app_secret_provider_factory,
        identity_resolver=identity_resolver,
        receive_webhook_fn=receive_webhook_fn,
        allowed_workspace_ids=allowed_workspace_ids,
        webhook_registry_override=webhook_registry_override,
        intake_runner=intake_runner,  # None → defaults to _live_intake_runner
    )

    server = grpc.aio.server()

    # Register the servicer using the committed grpcio stubs.
    #
    # Stubs are generated by grpcio-tools (NOT betterproto) and committed at
    # src/interfaces/grpc/_pb2/brain/ingestion/v1/ingestion_pb2_grpc.py.
    # The _pb2 directory is added to sys.path so the package import resolves.
    #
    # Why grpcio stubs here (not betterproto):
    #   betterproto generates grpclib-based stubs (WebhookIngestServiceStub +
    #   grpclib ServiceBase); it does NOT produce add_...Servicer_to_server or a
    #   grpcio Servicer base class.  grpcio.aio.server() requires the grpcio
    #   add_...Servicer_to_server registration function.  The betterproto stubs
    #   are preserved for the rest of the repo (pylibs/brain_grpc) — this is a
    #   LOCALIZED fix for the ingestion server path only.
    import pathlib
    import sys as _sys

    _pb2_dir = str(pathlib.Path(__file__).parent / "_pb2")
    if _pb2_dir not in _sys.path:
        _sys.path.insert(0, _pb2_dir)

    try:
        from brain.ingestion.v1 import ingestion_pb2_grpc  # noqa: PLC0415
        ingestion_pb2_grpc.add_WebhookIngestServiceServicer_to_server(servicer, server)
        logger.info("webhook_server: WebhookIngestServicer registered via grpcio stubs.")
    except Exception as exc:
        # Do NOT silently skip — an unregistered servicer means the RPC is
        # permanently unimplemented.  Raise so the process fails fast at startup.
        raise RuntimeError(
            "webhook_server: FATAL — could not register WebhookIngestServicer. "
            "Ensure src/interfaces/grpc/_pb2/ stubs are committed and grpcio is installed. "
            f"Underlying error: {exc}"
        ) from exc

    # Add gRPC health service (grpcio-health-checking).
    try:
        from grpc_health.v1 import health, health_pb2_grpc
        health_servicer = health.HealthServicer()
        health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    except ImportError:
        logger.info("webhook_server: grpc-health-checking not available; skipping health service.")

    server.add_insecure_port(address)

    logger.info(
        "webhook_server: starting INTERNAL gRPC server address=%s "
        "PLACEMENT-1=internal-only TRANSPORT-1=grpc.aio",
        address,
    )
    await server.start()
    logger.info("webhook_server: INTERNAL gRPC server ready address=%s", address)
    try:
        await server.wait_for_termination()
    finally:
        # KAFKA-LAZY-SINGLETON-1: stop the producer on graceful shutdown.
        await stop_kafka_producer()

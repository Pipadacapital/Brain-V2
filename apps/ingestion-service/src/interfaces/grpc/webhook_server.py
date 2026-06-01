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

    from src.interfaces.grpc.webhook_servicer import WebhookIngestServicer

    bind_host = host or os.environ.get("GRPC_INTERNAL_HOST", _GRPC_BIND_DEFAULT)
    bind_port = port or int(os.environ.get("GRPC_INTERNAL_PORT", str(_GRPC_INTERNAL_PORT_DEFAULT)))
    address = f"{bind_host}:{bind_port}"

    servicer = WebhookIngestServicer(
        app_secret_provider_factory=app_secret_provider_factory,
        identity_resolver=identity_resolver,
        receive_webhook_fn=receive_webhook_fn,
        allowed_workspace_ids=allowed_workspace_ids,
        webhook_registry_override=webhook_registry_override,
    )

    server = grpc.aio.server()

    # Register the servicer.
    # The generated stub add_WebhookIngestServicerToServer is produced by
    # `buf generate protos` into pylibs/brain_grpc/brain_grpc/_gen/.
    # HELD: the import below resolves only when codegen has run.
    # For Stage-3 testing, the servicer is tested directly (no server needed).
    try:
        from brain_grpc._gen.brain.ingestion.v1 import ingestion_grpc
        ingestion_grpc.add_WebhookIngestServicerToServer(servicer, server)
    except ImportError:
        logger.warning(
            "webhook_server: proto stubs not yet generated — "
            "running in stub-less mode (tests only). "
            "Run `buf generate protos` to produce the real stubs."
        )
        # For testing without generated stubs, skip stub registration.
        # Direct servicer.ReceiveWebhook() calls still work.

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
    await server.wait_for_termination()

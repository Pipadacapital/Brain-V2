"""
ingestion-service entrypoint — runs the service as its own process.

@paradigm: sql + io/event-handling (no ML, no LLM)

Phase-A roadmap, slice PA-1: this is the runnable ``main`` that makes
ingestion-service an INDEPENDENT deployable (own Dockerfile + own process), rather
than code imported in-process by another service. It:

  1. runs the fail-closed startup gates (ap-south-1 residency + workspace allowlist)
     — the service REFUSES TO START (non-zero exit) if either gate fails;
  2. starts the INTERNAL WebhookIngest gRPC server.

INTERNAL-ONLY (PLACEMENT-1 / TRANSPORT-1): the gRPC listener is reachable only
inside the cluster/pod network, never a public ingress — the public choke point
stays the api-gateway. The bind host comes from the GRPC_INTERNAL_HOST env var
(default loopback 127.0.0.1); the container/compose sets it to the bind-all
address to reach the pod network. That bind-all literal lives ONLY in env (the
container/compose layer), NEVER in this code.

Run solo (needs ap-south-1 creds + the workspace allowlist):

    cd apps/ingestion-service
    DATABASE_URL=...ap-south-1... DIRECT_URL=...ap-south-1... \
      ALLOWED_WORKSPACE_IDS=<workspace-uuid> uv run python -m src.main
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

from src.bootstrap.startup_gates import (
    ResidencyAssertionError,
    WorkspaceNotAllowedError,
    run_all_gates,
)
from src.interfaces.grpc.webhook_server import start_webhook_grpc_server

_log = logging.getLogger("ingestion.main")


def _configure_logging() -> None:
    # Structured JSON-ish line to stdout; compose/k8s log drivers capture it.
    # NEVERLOG-1: ids + outcome only — never PII / payloads.
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
        stream=sys.stdout,
    )


async def _serve() -> None:
    # Gate 1 — fail-closed startup (ap-south-1 residency + workspace allowlist).
    allowed_workspace_ids = run_all_gates()
    _log.info("startup gates passed allowed_workspace_count=%d", len(allowed_workspace_ids))
    # Gate 2 — start the internal gRPC server. Host/port resolve from
    # GRPC_INTERNAL_HOST / GRPC_INTERNAL_PORT inside the server (loopback default).
    await start_webhook_grpc_server(allowed_workspace_ids)


def main() -> int:
    _configure_logging()
    try:
        asyncio.run(_serve())
        return 0
    except (ResidencyAssertionError, WorkspaceNotAllowedError) as exc:
        # Refuse-to-start gates: clean non-zero exit, no traceback spam.
        _log.error("REFUSING TO START: %s", exc)
        return 1
    except KeyboardInterrupt:
        _log.info("shutdown (SIGINT)")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

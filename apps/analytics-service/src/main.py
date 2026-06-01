"""
analytics-service entrypoint — runs the service as its own process.

@paradigm: sql + io/event-handling (no ML, no LLM)

Phase-A slice PA-2a: makes analytics-service an INDEPENDENT deployable (own
Dockerfile + own process). It:

  1. runs the fail-closed startup assertions (ap-south-1 ClickHouse residency +
     read-only Postgres role) — the service REFUSES TO START (sys.exit(1)) if
     either fails;
  2. starts the INTERNAL gRPC server (health-only surface for PA-2a).

INTERNAL-ONLY (PLACEMENT-1 / TRANSPORT-1): the gRPC listener is reachable only
inside the cluster/pod network. The bind host comes from GRPC_INTERNAL_HOST
(loopback default); the container/compose layer supplies the pod-network bind.

Run solo (needs an ap-south-1 ClickHouse host + a read-only Postgres role):

    cd apps/analytics-service
    CLICKHOUSE_HOST=...ap-south-1... DATABASE_URL=...read-only... \
      python -m src.main
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

from src.bootstrap.analytics_service_startup import run_startup_assertions
from src.interfaces.grpc.health_server import start_analytics_grpc_server

_log = logging.getLogger("analytics.main")


def _configure_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
        stream=sys.stdout,
    )


async def _serve() -> None:
    await start_analytics_grpc_server()


def main() -> int:
    _configure_logging()
    # Gate 1 — fail-closed startup. run_startup_assertions() logs the failure(s)
    # and calls sys.exit(1) itself; that SystemExit propagates → process exits 1.
    run_startup_assertions()
    _log.info("startup assertions passed; starting internal gRPC server")
    try:
        asyncio.run(_serve())
        return 0
    except KeyboardInterrupt:
        _log.info("shutdown (SIGINT)")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

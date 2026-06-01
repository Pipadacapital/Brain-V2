"""
intelligence-service entrypoint — runs the service as its own process.

@paradigm: sql + io/event-handling (no LLM call at boot)

Phase-A slice PA-2b: makes intelligence-service an INDEPENDENT deployable (own
Dockerfile + own process). It:

  1. runs the fail-closed startup assertions (India residency: POSTGRES_REGION
     must be 'ap-south-1' if set) — REFUSES TO START (exit 1) on violation;
  2. starts the INTERNAL gRPC server (health-only surface for PA-2b).

Import convention: this service uses pythonpath=["src"] (no src/__init__.py), so
modules import as `bootstrap` / `interfaces` (NOT `src.*`). Run as `python -m main`
with src on the path (the Dockerfile sets WORKDIR to .../src).

INTERNAL-ONLY (PLACEMENT-1 / TRANSPORT-1): the gRPC listener is reachable only
inside the cluster/pod network. The bind host comes from GRPC_INTERNAL_HOST
(loopback default); the container/compose layer supplies the pod-network bind.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

from bootstrap import run_startup_assertions
from interfaces.grpc.health_server import start_intelligence_grpc_server

_log = logging.getLogger("intelligence.main")


def _configure_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
        stream=sys.stdout,
    )


async def _serve() -> None:
    await start_intelligence_grpc_server()


def main() -> int:
    _configure_logging()
    # Gate 1 — fail-closed startup (India residency). Raises EnvironmentError on
    # a POSTGRES_REGION violation → clean non-zero exit.
    try:
        run_startup_assertions()
    except EnvironmentError as exc:
        _log.error("REFUSING TO START: %s", exc)
        return 1
    _log.info("startup assertions passed; starting internal gRPC server")
    try:
        asyncio.run(_serve())
        return 0
    except KeyboardInterrupt:
        _log.info("shutdown (SIGINT)")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

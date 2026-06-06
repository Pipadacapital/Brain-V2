# =============================================================================
# ingestion-service Dockerfile — independent Python deployable (Phase-A, PA-1).
#
# @paradigm: sql + io/event-handling
#
# uv workspace build. Build context = repo ROOT (the uv.lock + workspace member
# manifests must be visible), mirroring the api-gateway image pattern.
#
# INTERNAL-ONLY service (PLACEMENT-1 / TRANSPORT-1): the gRPC port 50051 is NOT a
# public ingress. GRPC_INTERNAL_HOST=0.0.0.0 is set via container/compose env (so
# it binds the pod network) — the 0.0.0.0 literal lives in env, never in code.
#
# Build:  docker build -f apps/ingestion-service/Dockerfile -t brain/ingestion:pa1 .
# =============================================================================

FROM python:3.13-slim AS runtime

# Pinned uv (matches root pyproject required-version >= 0.8.22).
COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/workspace/.venv/bin:${PATH}"

WORKDIR /workspace

# --- Layer 1: resolve deps from manifests only (cached on the lockfile) ------
# uv resolves the whole workspace, so every member manifest must be present.
COPY pyproject.toml uv.lock ./
COPY apps/ingestion-service/pyproject.toml apps/ingestion-service/
COPY apps/analytics-service/pyproject.toml apps/analytics-service/
COPY apps/intelligence-service/pyproject.toml apps/intelligence-service/
COPY pylibs/ pylibs/
# Install ONLY ingestion-service's deps (not the project itself — src not copied yet).
RUN uv sync --frozen --package ingestion-service --no-install-project

# --- Layer 2: app source (busts only on code change, not dep change) ---------
COPY apps/ingestion-service/src apps/ingestion-service/src

ENV GRPC_INTERNAL_PORT=50051
EXPOSE 50051

WORKDIR /workspace/apps/ingestion-service

# gRPC health probe: the default (empty) service name reports SERVING once the
# server is up. `python` is the uv venv interpreter (PATH set above), so the
# grpcio-health-checking client is importable.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD python -c "import grpc; from grpc_health.v1 import health_pb2, health_pb2_grpc; health_pb2_grpc.HealthStub(grpc.insecure_channel('127.0.0.1:50051')).Check(health_pb2.HealthCheckRequest(), timeout=2)" || exit 1

# `python` resolves to /workspace/.venv/bin/python (PATH); deps resolved in Layer 1.
# Container hardening: run as a non-root user.
RUN useradd --create-home --uid 1001 appuser
USER appuser
CMD ["python", "-m", "src.main"]

# =============================================================================
# analytics-service Dockerfile — independent Python deployable (Phase-A, PA-2a).
#
# @paradigm: sql + io/event-handling
#
# uv workspace build, build context = repo ROOT (mirrors ingestion-service).
#
# INTERNAL-ONLY service (PLACEMENT-1 / TRANSPORT-1): gRPC port 50052 is NOT a
# public ingress. GRPC_INTERNAL_HOST=0.0.0.0 is set via container/compose env
# (binds the pod network) — that literal lives in env, never in code.
#
# Build: docker build -f apps/analytics-service/Dockerfile -t brain/analytics:pa2a .
# =============================================================================

FROM python:3.13-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/workspace/.venv/bin:${PATH}"

WORKDIR /workspace

# --- Layer 1: resolve deps from manifests only (cached on the lockfile) ------
COPY pyproject.toml uv.lock ./
COPY apps/ingestion-service/pyproject.toml apps/ingestion-service/
COPY apps/analytics-service/pyproject.toml apps/analytics-service/
COPY apps/intelligence-service/pyproject.toml apps/intelligence-service/
COPY pylibs/ pylibs/
RUN uv sync --frozen --package analytics-service --no-install-project

# --- Layer 2: app source -----------------------------------------------------
COPY apps/analytics-service/src apps/analytics-service/src

ENV GRPC_INTERNAL_PORT=50052
EXPOSE 50052

WORKDIR /workspace/apps/analytics-service

# gRPC health probe on the analytics internal port.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD python -c "import grpc; from grpc_health.v1 import health_pb2, health_pb2_grpc; health_pb2_grpc.HealthStub(grpc.insecure_channel('127.0.0.1:50052')).Check(health_pb2.HealthCheckRequest(), timeout=2)" || exit 1

CMD ["python", "-m", "src.main"]

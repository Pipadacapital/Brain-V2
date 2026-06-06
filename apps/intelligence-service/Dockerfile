# =============================================================================
# intelligence-service Dockerfile — independent Python deployable (Phase-A, PA-2b).
#
# @paradigm: sql + io/event-handling (no LLM call at boot)
#
# uv workspace build, build context = repo ROOT (mirrors ingestion/analytics).
#
# INTERNAL-ONLY service (PLACEMENT-1 / TRANSPORT-1): gRPC port 50053 is NOT a
# public ingress. GRPC_INTERNAL_HOST=0.0.0.0 is set via container/compose env
# (binds the pod network) — that literal lives in env, never in code.
#
# Import convention: this service uses pythonpath=["src"] (no src/__init__.py),
# so the entrypoint runs as `python -m main` with WORKDIR set to .../src.
#
# Build: docker build -f apps/intelligence-service/Dockerfile -t brain/intelligence:pa2b .
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
RUN uv sync --frozen --package intelligence-service --no-install-project

# --- Layer 2: app source -----------------------------------------------------
COPY apps/intelligence-service/src apps/intelligence-service/src

ENV GRPC_INTERNAL_PORT=50053
EXPOSE 50053

# pythonpath=["src"] convention: run from src so `import bootstrap` resolves.
WORKDIR /workspace/apps/intelligence-service/src

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD python -c "import grpc; from grpc_health.v1 import health_pb2, health_pb2_grpc; health_pb2_grpc.HealthStub(grpc.insecure_channel('127.0.0.1:50053')).Check(health_pb2.HealthCheckRequest(), timeout=2)" || exit 1

# Container hardening: run as a non-root user.
RUN useradd --create-home --uid 1001 appuser
USER appuser
CMD ["python", "-m", "main"]

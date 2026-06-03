# =============================================================================
# api-gateway Dockerfile — production-shape local image.
#
# @paradigm sql
#
# Brain canon: api-gateway runs on Node 24, pnpm 11 workspace. tsx (not tsc emit)
# is the runtime today; that matches `pnpm dev` so a containerized image
# behaves identically to the host process. tsc-emit-to-dist + node runtime is
# a future optimization (cuts image size + cold start).
#
# Multi-stage:
#   1. deps   — install the workspace once (cached on lockfile)
#   2. runtime — slim Node image + only the workspace files needed to run
#
# Build context: project root (the docker-compose service builds with the root
# as the build context so the WORKSPACE/lockfile + sibling packages are visible).
# =============================================================================

# ----- Stage 1: install workspace deps ------------------------------------
FROM node:24-alpine AS deps

# pnpm v11 — same as packageManager pin in root package.json.
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /workspace

# Copy ONLY the files pnpm needs to resolve the workspace + the package
# manifests of every member. This is the canonical pnpm-monorepo cache
# pattern — any source change beyond manifests will NOT bust this layer.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api-gateway/package.json apps/api-gateway/
COPY apps/core-service/package.json apps/core-service/
COPY apps/web/package.json apps/web/
COPY apps/notifications-service/package.json apps/notifications-service/
COPY apps/lifecycle-service/package.json apps/lifecycle-service/
COPY apps/mobile/package.json apps/mobile/
COPY packages/config/package.json packages/config/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/lib-clickhouse-ts/package.json packages/lib-clickhouse-ts/
COPY packages/lib-formatters/package.json packages/lib-formatters/
COPY packages/lib-grpc-clients/package.json packages/lib-grpc-clients/
COPY packages/lib-logger/package.json packages/lib-logger/
COPY packages/lib-metrics/package.json packages/lib-metrics/
COPY packages/state/package.json packages/state/
COPY packages/trpc-client/package.json packages/trpc-client/
COPY packages/ui/package.json packages/ui/
COPY packages/ui-mobile/package.json packages/ui-mobile/

# Frozen install — fails if the lockfile would shift; matches CI behavior.
# pnpm v10+ blocks build-scripts by default and ERRORS on ignored ones in
# non-interactive mode. The host config approves esbuild (workspace yaml);
# in Docker we relax further so esbuild + native binaries (sharp, @swc/core,
# @parcel/watcher, unrs-resolver) can compile inside the image.
ENV PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
RUN pnpm install --frozen-lockfile --config.dangerously-allow-all-builds=true

# ----- Stage 2: runtime --------------------------------------------------
FROM node:24-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /workspace

# Bring in the resolved workspace (node_modules + all linked workspace pkgs).
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /workspace/package.json ./package.json

# Source — only what api-gateway needs at runtime. Sibling apps that the gateway
# imports IN-PROCESS (core-service @brain/core-*) must also be present.
COPY apps/api-gateway ./apps/api-gateway
COPY apps/core-service ./apps/core-service
COPY packages/lib-logger ./packages/lib-logger
COPY packages/lib-metrics ./packages/lib-metrics
COPY packages/lib-clickhouse-ts ./packages/lib-clickhouse-ts
COPY packages/config ./packages/config
COPY tsconfig.json ./tsconfig.json
# gRPC proto contract for the webhook-ingest client (@grpc/proto-loader loads it at
# runtime). WEBHOOK_INGEST_PROTO_DIR points here. Required when BRAIN_WEBHOOKS_ENABLED.
COPY protos ./protos

# Pre-resolve workspace symlinks for the dependent app folders.
COPY --from=deps /workspace/apps/api-gateway/node_modules ./apps/api-gateway/node_modules
COPY --from=deps /workspace/apps/core-service/node_modules ./apps/core-service/node_modules
COPY --from=deps /workspace/packages/lib-logger/node_modules ./packages/lib-logger/node_modules

ENV NODE_ENV=production
ENV GATEWAY_PORT=3001
ENV LOG_LEVEL=info

# The shared logger emits JSON to stdout; docker compose's log driver captures.
EXPOSE 3001

# Healthcheck against the gateway's /health endpoint (already exists).
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3001/health | grep -q '"status":"ok"' || exit 1

# tsx is the runtime — same as `pnpm dev`. No tsc emit needed (Stage-0).
WORKDIR /workspace/apps/api-gateway
CMD ["pnpm", "exec", "tsx", "src/interfaces/server.ts"]

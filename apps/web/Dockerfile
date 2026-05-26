# =============================================================================
# web Dockerfile — production-shape Next.js 16 image.
#
# @paradigm sql
#
# Brain canon: Next.js 16 App Router, pnpm 11 workspace, Node 24. Per memory
# (project_frontend_replication), the web app runs via `next dev --webpack`
# locally; for production-shape it runs `next build` → `next start`.
#
# Multi-stage:
#   1. deps     — install workspace once
#   2. builder  — next build (produces .next/ optimized server + client bundles)
#   3. runtime  — node + standalone .next/ output; minimal surface
#
# Build context: project root.
#
# CAVEAT — env at build time:
#   NEXT_PUBLIC_API_URL is BAKED into the client bundle at build time. The
#   compose service supplies it via the args block. Default = the host port
#   mapping http://localhost:3001 (browser is always on the host machine).
#   If/when an SSR Server Component starts calling the gateway, use a separate
#   runtime-only API_URL_INTERNAL=http://api-gateway:3001 for in-cluster reach.
# =============================================================================

# ----- Stage 1: install workspace deps ------------------------------------
FROM node:24-alpine AS deps

RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /workspace

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
COPY packages/lib-logger/package.json packages/lib-logger/
COPY packages/lib-metrics/package.json packages/lib-metrics/
COPY packages/proto-ts/package.json packages/proto-ts/
COPY packages/ui/package.json packages/ui/

ENV PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
RUN pnpm install --frozen-lockfile --config.dangerously-allow-all-builds=true

# ----- Stage 2: build -----------------------------------------------------
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /workspace

# Source needed to build apps/web — web itself plus every workspace package
# it imports (notably @brain/api-gateway for the BrainRouter type + the
# shared logger + the typed core-* aliases via tsconfig paths).
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /workspace/package.json ./package.json

COPY apps/web ./apps/web
COPY apps/api-gateway ./apps/api-gateway
COPY apps/core-service ./apps/core-service
COPY packages/lib-logger ./packages/lib-logger
COPY packages/lib-metrics ./packages/lib-metrics
COPY packages/lib-clickhouse-ts ./packages/lib-clickhouse-ts
COPY packages/proto-ts ./packages/proto-ts
COPY packages/config ./packages/config
COPY packages/ui ./packages/ui
COPY tsconfig.json ./tsconfig.json

COPY --from=deps /workspace/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /workspace/apps/api-gateway/node_modules ./apps/api-gateway/node_modules
COPY --from=deps /workspace/apps/core-service/node_modules ./apps/core-service/node_modules
COPY --from=deps /workspace/packages/lib-logger/node_modules ./packages/lib-logger/node_modules

# Build-time public env (must be present BEFORE next build).
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_BRAIN_LOCAL_HARNESS=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_BRAIN_LOCAL_HARNESS=$NEXT_PUBLIC_BRAIN_LOCAL_HARNESS

# Build with --webpack (per memory project_frontend_replication: turbopack is
# Next 16's default but this workspace has a webpack config and dev runs as
# `next dev --webpack` — Turbopack errors out when a webpack config is present).
WORKDIR /workspace/apps/web
RUN pnpm exec next build --webpack

# ----- Stage 3: runtime ---------------------------------------------------
FROM node:24-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /workspace

# Copy resolved deps + the built .next + the runtime source.
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /workspace/package.json ./package.json
COPY --from=builder /workspace/apps/web ./apps/web

# Workspace symlink targets — node_modules/.pnpm/@brain+*/... symlink TO
# these source dirs. Without them the symlinks dangle and pnpm/Next refuse
# to start. Lightweight (a handful of TS files each).
COPY --from=builder /workspace/packages/lib-logger ./packages/lib-logger
COPY --from=builder /workspace/packages/lib-metrics ./packages/lib-metrics
COPY --from=builder /workspace/packages/lib-clickhouse-ts ./packages/lib-clickhouse-ts
COPY --from=builder /workspace/packages/proto-ts ./packages/proto-ts
COPY --from=builder /workspace/packages/config ./packages/config
COPY --from=builder /workspace/packages/ui ./packages/ui
# api-gateway is a TYPE-ONLY import (BrainRouter) — the built bundle already
# inlined the types. Source is here only so pnpm's workspace resolution finds
# the package — we never execute its code from the web container.
COPY --from=builder /workspace/apps/api-gateway ./apps/api-gateway
COPY --from=builder /workspace/apps/core-service ./apps/core-service

ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV PORT=3000

EXPOSE 3000

# Basic health: home page returns 307 redirect (to /auth/login) or 200.
# Accept either; failure is "no response at all".
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/ || exit 1

WORKDIR /workspace/apps/web
# Invoke next directly via node — bypasses pnpm's deps-status-check on every
# start (which fails when workspace symlink targets shifted between build and
# runtime). The .next/ bundle is already built; this is a pure runtime spawn.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]

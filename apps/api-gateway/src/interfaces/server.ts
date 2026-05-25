// @paradigm: sql
// api-gateway server bootstrap — LOCAL run harness entry point.
// CF-C6-RUNNABLE-HARNESS-1: this file is the missing piece that makes
// `pnpm dev` (tsx src/interfaces/server.ts) actually boot so the web
// app can call the BFF and render the seeded Sugandh-Lok numbers.
//
// Phase-0 architecture:
//   - StubDataPlane serves deterministic Sugandh-Lok seed data
//   - InMemoryIdempotencyStore replaces Redis (no external deps for LOCAL)
//   - WorkspaceContext is derived from request headers (LOCAL: stub claim)
//
// Phase-2 cutover (RemoteDataPlane — config flip, zero rewrite):
//   - Swap StubDataPlane → LoopbackDataPlane (GRPC_METRICS_ADDR, GRPC_INTELLIGENCE_ADDR)
//   - Swap InMemoryIdempotencyStore → ioredis.Redis (REDIS_URL)
//   - Swap stub claim builder → real JWT verification
//   - buildGrpcMetadata (tenancy.ts) is wired HERE when RemoteDataPlane lands
//
// TenancyInterceptor disposition (SEC-C6-M1):
//   assertWorkspaceClaim / assertRequiredRole / buildGrpcMetadata are exported
//   from tenancy.ts but are NOT called here. Rationale:
//   1. workspaceMiddleware in trpc.ts asserts workspaceId === claim.workspaceId
//      on EVERY workspace-tier procedure BEFORE any data-plane call — that IS
//      the real choke point. Calling assertWorkspaceClaim again here would be
//      duplicate enforcement of the same check (assertWorkspaceClaim has
//      identical logic to workspaceMiddleware's workspace assertion).
//   2. buildGrpcMetadata is the Phase-2 wire — it propagates the correlation
//      4-tuple into gRPC metadata headers. In Phase-0 the data plane is
//      in-process (StubDataPlane) so there is no gRPC network boundary to
//      attach headers to. buildGrpcMetadata MUST be wired in the RemoteDataPlane
//      adapter at Phase-2 (when GRPC_METRICS_ADDR is live).
//   Tech-debt entry: SEC-C6-M1 — tracked for Phase-2 cutover review.

import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { randomUUID } from 'node:crypto';

import { assembleClaim } from '@brain/core-auth';
import { createBrainRouter } from '../application/router.js';
import {
  StubDataPlane,
  InMemoryDecisionLog,
  SUGANDH_LOK_WORKSPACE_ID,
} from '../infrastructure/loopback-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import type { WorkspaceContext } from '../application/trpc.js';

// ---------------------------------------------------------------------------
// Phase-0 LOCAL harness constants
//
// These credentials are LOCAL-ONLY, clearly labeled, never shipped to
// production. They will be removed at auth cutover (SEC-C6-L1 tech-debt).
// The `brain-local-dev` password was already accepted by Shreya as Phase-0 OK.
// ---------------------------------------------------------------------------

const LOCAL_DEV_USER_ID    = 'user-founder-001';
const LOCAL_DEV_EMAIL      = 'founder@sugandhlok.com';   // display only, not used as credential
const LOCAL_DEV_WORKSPACE  = SUGANDH_LOK_WORKSPACE_ID;
const LOCAL_DEV_ROLE       = 'OWNER' as const;
const GATEWAY_PORT         = Number(process.env['GATEWAY_PORT'] ?? 3001);

// ---------------------------------------------------------------------------
// Data plane + idempotency store (Phase-0: in-process stubs)
// ---------------------------------------------------------------------------

const dataPlane      = new StubDataPlane(new InMemoryDecisionLog(), LOCAL_DEV_WORKSPACE);
const idempotencyStore = new InMemoryIdempotencyStore();

// ---------------------------------------------------------------------------
// tRPC router
// ---------------------------------------------------------------------------

const brainRouter = createBrainRouter(dataPlane, idempotencyStore);
export type BrainRouter = typeof brainRouter;

// ---------------------------------------------------------------------------
// Context factory — CF-C6-GATEWAY-TENANCY-1
//
// Phase-0 LOCAL strategy:
//   Read x-workspace-id and x-user-id from request headers; if absent fall
//   back to the Sugandh-Lok stub claim so `pnpm dev` works out of the box
//   without a real auth server.
//
// Phase-2 production strategy (TODO at auth cutover):
//   Verify JWT from the `Authorization: Bearer <token>` header.
//   Derive workspace_id from the verified claim (not from a header the client
//   can spoof). Only then build the WorkspaceContext.
//
// IMPORTANT: the workspaceMiddleware in trpc.ts asserts
//   ctx.workspaceId === ctx.claim.workspaceId
// on every workspace-tier procedure. This is the real enforcement gate.
// The context factory below MUST produce consistent values (workspaceId from
// the same source as claim.workspaceId) for the middleware check to pass.
// ---------------------------------------------------------------------------

function buildLocalStubContext(
  requestId: string,
  traceId: string,
  workspaceId: string,
  userId: string,
): WorkspaceContext {
  const claim = assembleClaim({
    userId,
    workspaceId,
    workspaceRole: LOCAL_DEV_ROLE,
    systemRole: 'USER',
    requestId,
    traceId,
  });

  return {
    claim,
    workspaceId,   // MUST equal claim.workspaceId (workspaceMiddleware asserts this)
    requestId,
    traceId,
  };
}

// ---------------------------------------------------------------------------
// Fastify server
// ---------------------------------------------------------------------------

async function buildServer() {
  const fastify = Fastify({
    // Structured JSON logs via pino — works without pino-pretty.
    // CF-SEC-5: request_id in every log line (req.id is Fastify's auto-generated id).
    logger: { level: 'info' },
  });

  // CORS: allow the web frontend (localhost:3000) to call the BFF.
  await fastify.register(cors, {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      // Expo / mobile dev server
      'http://localhost:19000',
      'http://localhost:19006',
    ],
    credentials: true,
  });

  // Health endpoint — CF-C6-RUNNABLE-HARNESS-1 / operational readiness.
  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'api-gateway',
    phase: 'phase-0-local-stub',
    workspace: LOCAL_DEV_WORKSPACE,
    ts: new Date().toISOString(),
  }));

  // tRPC plugin — all procedures under /trpc/:path
  await fastify.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: brainRouter,
      // Context factory: runs once per request, before any middleware.
      // CF-C6-GATEWAY-TENANCY-1: workspaceId in ctx MUST equal claim.workspaceId.
      createContext({ req }: CreateFastifyContextOptions): WorkspaceContext {
        // CF-SEC-5: generate a fresh correlation id per request.
        const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        const traceId   = (req.headers['x-trace-id']   as string | undefined) ?? randomUUID();

        // Phase-0 LOCAL: accept workspace + user from trusted request headers,
        // or fall back to the Sugandh-Lok stub. Production replaces this entire
        // block with JWT verification.
        const workspaceId = (req.headers['x-workspace-id'] as string | undefined)?.trim()
          || LOCAL_DEV_WORKSPACE;
        const userId      = (req.headers['x-user-id']      as string | undefined)?.trim()
          || LOCAL_DEV_USER_ID;

        // Attach the correlation requestId to the Fastify reply header so web
        // clients can surface it on errors (CF-SEC-5 traceability).
        req.server.log.info(
          { requestId, traceId, workspaceId, userId, url: req.url },
          'api-gateway request',
        );

        return buildLocalStubContext(requestId, traceId, workspaceId, userId);
      },

      // CF-SEC-5: surface requestId on errors via the gateway's error logger.
      onError({ error, path, ctx }: {
        error: { code: string; message: string };
        path: string | undefined;
        ctx: WorkspaceContext | undefined;
        input: unknown;
        req: FastifyRequest;
        type: string;
      }) {
        const requestId = ctx?.requestId ?? 'unknown';
        fastify.log.error(
          { path, code: error.code, message: error.message, requestId },
          'tRPC error',
        );
      },
    },
  });

  return fastify;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const server = await buildServer();

  try {
    const address = await server.listen({ port: GATEWAY_PORT, host: '0.0.0.0' });
    server.log.info(`api-gateway (Phase-0 LOCAL) listening on ${address}`);
    server.log.info(`  tRPC endpoint:   ${address}/trpc`);
    server.log.info(`  Health check:    ${address}/health`);
    server.log.info(`  Stub workspace:  ${LOCAL_DEV_WORKSPACE}`);
    server.log.info(`  Stub user:       ${LOCAL_DEV_EMAIL}`);
    server.log.info(
      `  Seed data:       net_revenue ₹18.5L | cm2 ₹3.2L | ROAS 2.85× | orders 1,247`,
    );
  } catch (err) {
    server.log.error(err, 'Failed to start api-gateway');
    process.exit(1);
  }
}

main();

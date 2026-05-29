// @paradigm: sql
// api-gateway server bootstrap.
//
// Production-shape (only path): every request authenticates a real Supabase
// JWT. Workspace_id is derived ONLY from the verified `sub` via the membership
// resolver (B3). There is no offline-stub / LOCAL-harness fork — the dev
// machine and production server take the same path. (2026-05-26: Founder
// destub — Rip A+B+C. Audit trail: feature/parity-epic-p1 branch.)
//
// Data plane: DispatchingDataPlane builds a per-workspace LocalDbDataPlane
// that reads the workspace's OWN connector facts. There is no demo/seed
// plane — fresh workspaces get honest empty results from empty-results.ts.
//
// TenancyInterceptor disposition (SEC-C6-M1):
//   assertWorkspaceClaim / buildGrpcMetadata are exported from tenancy.ts
//   but are NOT called here. Rationale:
//   1. workspaceMiddleware in trpc.ts asserts workspaceId === claim.workspaceId
//      on EVERY workspace-tier procedure BEFORE any data-plane call.
//   2. buildGrpcMetadata is the Phase-2 wire — it propagates the correlation
//      4-tuple into gRPC metadata headers when the data plane goes remote.
//   Tech-debt entry: SEC-C6-M1 — tracked for Phase-2 cutover review.

import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import {
  createLogger,
  extractCorrelation,
  PII_REDACT_PATHS,
} from '@brain/lib-logger';

import { assembleClaim } from '@brain/core-auth';
import { resolveMembership, listWorkspaces } from '@brain/core-onboarding';
import { assertShopifyOAuthSecretsPresent } from '@brain/core-connectors';
import { createBrainRouter } from '../application/router.js';
import { DispatchingDataPlane } from '../infrastructure/dispatching-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import type { IdentityContext } from '../application/trpc.js';
import {
  createSupabaseJwtVerifier,
  AuthVerifyError,
} from '../infrastructure/supabase-jwt-verifier.js';
import {
  DbMembershipResolver,
  type MembershipResolver,
} from '../domain/membership-resolver.js';

const GATEWAY_PORT = Number(process.env['GATEWAY_PORT'] ?? 3001);

// ---------------------------------------------------------------------------
// Auth config — single path: real Supabase JWT. Boot fails if SUPABASE_URL
// isn't set, so a misconfigured environment can never become a default grant.
// ---------------------------------------------------------------------------
export interface GatewayAuthConfig {
  supabaseUrl: string;
  isProduction: boolean;
}

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): GatewayAuthConfig {
  return {
    supabaseUrl: (env['SUPABASE_URL'] ?? '').trim(),
    isProduction: env['NODE_ENV'] === 'production',
  };
}

/**
 * Validate the auth config. Returns a fatal message string if boot MUST abort,
 * or null if the config is bootable. Pure — the caller decides to exit.
 */
export function assertBootableAuthConfig(cfg: GatewayAuthConfig): string | null {
  if (!cfg.supabaseUrl) {
    return 'SUPABASE_URL is required. There is no offline-stub fallback (Founder destub 2026-05-26).';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data plane + idempotency store (Phase-0: in-process).
// ---------------------------------------------------------------------------

const dataPlane = new DispatchingDataPlane();
const idempotencyStore = new InMemoryIdempotencyStore();

// ---------------------------------------------------------------------------
// tRPC router
// ---------------------------------------------------------------------------

const brainRouter = createBrainRouter(dataPlane, idempotencyStore);
export type BrainRouter = typeof brainRouter;

// ---------------------------------------------------------------------------
// Real-auth context builder — EXPORTED + dependency-injected so it is
// directly unit-testable without triggering this module's boot side effects.
//
// B1: this is the ONLY context path; there is no stub fallback inside — a
//     verify/resolve miss throws UNAUTHORIZED.
// B3: workspace_id comes ONLY from the MembershipResolver keyed on the verified
//     `sub`. The `x-workspace-id` header is NEVER consulted here.
// S1: any verify failure → generic UNAUTHORIZED; jose internals never surfaced.
// S2: only `userId` (the sub) flows into the claim and the log line — no email.
// S5: an unresolved sub fails closed (UNAUTHORIZED), never a default grant.
// ---------------------------------------------------------------------------
export interface RealAuthDeps {
  verifier: { verify(bearer: string): Promise<{ sub: string; email: string }> };
  resolver: MembershipResolver;
  listMemberships?: (sub: string) => Promise<Array<{ workspaceId: string; role: string }>>;
  log: Pick<FastifyRequest['server']['log'], 'warn'>;
}

/**
 * Build the per-request context.
 *
 * Returns an IdentityContext that ALWAYS carries the verified identity (sub+email)
 * and carries `claim`+`workspaceId` ONLY when the resolver finds a membership:
 *   - membership found → full WorkspaceContext (data procedures work).
 *   - NO membership   → identity-only context. The user is verified but has no
 *     workspace yet — onboarding.complete + user.me (identity tier) work; every
 *     workspace/authed-tier data procedure fails closed at the middleware. This
 *     is how a freshly signed-up user is routed to /onboarding WITHOUT an
 *     auto-OWNER grant.
 *   - verify failure  → UNAUTHORIZED (generic; jose internals never surfaced).
 *   - DB/resolver THROW → propagates → caller maps to UNAUTHORIZED (fail-closed).
 */
export async function buildRealAuthContext(
  authorization: string | undefined,
  requestId: string,
  traceId: string,
  deps: RealAuthDeps,
  requestedWorkspaceId?: string,
): Promise<IdentityContext> {
  let sub: string;
  let email: string;
  try {
    ({ sub, email } = await deps.verifier.verify(authorization ?? ''));
  } catch (err) {
    deps.log.warn(
      {
        requestId,
        errorClass: err instanceof AuthVerifyError ? err.reason : 'unknown',
      },
      'auth verify rejected',
    );
    throw new TRPCError({ code: 'UNAUTHORIZED', message: `Authentication required. request_id=${requestId}` });
  }

  const identity = { sub, email };

  const membership = await deps.resolver.resolve(sub);

  if (!membership) {
    deps.log.warn({ requestId, sub }, 'verified user has no membership (route to onboarding)');
    return { identity, requestId, traceId };
  }

  // Active workspace = resolver default, UNLESS the client picked another one
  // they're actually a member of (validated against listMemberships).
  let activeWorkspaceId = membership.workspaceId;
  let activeRole = membership.workspaceRole;
  if (
    requestedWorkspaceId &&
    requestedWorkspaceId !== membership.workspaceId &&
    deps.listMemberships
  ) {
    const all = await deps.listMemberships(sub);
    const match = all.find((m) => m.workspaceId === requestedWorkspaceId);
    if (match) {
      activeWorkspaceId = match.workspaceId;
      activeRole = match.role as typeof membership.workspaceRole;
    } else {
      deps.log.warn({ requestId, sub }, 'requested workspace not a membership — ignored');
    }
  }

  const claim = assembleClaim({
    userId: sub,
    workspaceId: activeWorkspaceId,
    workspaceRole: activeRole,
    systemRole: membership.systemRole,
    requestId,
    traceId,
  });

  return {
    identity,
    claim,
    workspaceId: activeWorkspaceId,
    requestId,
    traceId,
  };
}

// ---------------------------------------------------------------------------
// Fastify server
// ---------------------------------------------------------------------------

async function buildServer(cfg: GatewayAuthConfig) {
  // Brain shared logger (pino + canonical PII redact + ISO timestamps + service
  // binding). One source of truth across every TS service; see packages/lib-logger.
  // Fastify accepts a pino instance directly via `loggerInstance` (v5+).
  const log = createLogger('api-gateway', {
    level: process.env['LOG_LEVEL'] ?? 'info',
  });

  const fastify = Fastify({
    loggerInstance: log,
    // Re-apply the canonical redact paths at the Fastify-request-serializer
    // level so req.headers.authorization etc. are scrubbed in the auto-emitted
    // req/res log lines (Fastify owns those log calls; pino's top-level redact
    // applies, but documenting the dependency here for the reader).
    disableRequestLogging: false,
    genReqId: (req) => {
      const hdr = req.headers['x-request-id'];
      if (typeof hdr === 'string' && hdr.trim()) return hdr;
      return randomUUID();
    },
    // tRPC catch-all captures the comma-joined procedure path. With Fastify's
    // default (100), any 5+ procedure batch (>100 chars) silently 404s and the
    // client falls back to smaller batches — extra RTT per page-load. 5000 matches
    // the trpc-fastify adapter recommendation.
    maxParamLength: 5000,
  });
  // Cross-reference (intentional): PII_REDACT_PATHS is the canonical list (see
  // imports). Pino applies it via createLogger's redact config; we don't
  // re-declare per-service. Reference here keeps the dependency explicit.
  void PII_REDACT_PATHS;

  const jwtVerifier = createSupabaseJwtVerifier({ supabaseUrl: cfg.supabaseUrl });
  const membershipResolver: MembershipResolver = new DbMembershipResolver(resolveMembership);

  await fastify.register(cors, {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:19000',
      'http://localhost:19006',
    ],
    credentials: true,
  });

  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'api-gateway',
    authMode: 'real-supabase-jwt',
    ts: new Date().toISOString(),
  }));

  await fastify.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: brainRouter,
      async createContext({ req }: CreateFastifyContextOptions): Promise<IdentityContext> {
        // Canonical 4-tuple — request_id / trace_id from incoming headers,
        // fresh UUIDs when absent. Workspace + user fill in below from the
        // verified JWT membership (NEVER from header — that's a spoof vector).
        const correlation = extractCorrelation(req.headers);
        const requestId = correlation.request_id;
        const traceId = correlation.trace_id;

        // Bind correlation onto the per-request logger so every downstream
        // `req.log.info(...)` call carries the 4-tuple automatically.
        // (Fastify accepts this via assigning to req.log.)
        Object.assign(req, {
          log: req.log.child({
            request_id: requestId,
            trace_id: traceId,
          }),
        });

        req.log.info(
          {
            route: req.url,
            method: req.method,
          },
          'gateway request',
        );

        // Client-selected active workspace (workspace switch) — validated against
        // the user's real memberships inside buildRealAuthContext.
        const requestedWorkspaceId = correlation.workspace_id;

        const ctx = await buildRealAuthContext(
          req.headers['authorization'] as string | undefined,
          requestId,
          traceId,
          {
            verifier: jwtVerifier,
            resolver: membershipResolver,
            listMemberships: (sub: string) => listWorkspaces(sub),
            log: req.log,
          },
          requestedWorkspaceId,
        );

        // After auth resolves, enrich the logger with workspace_id + user_id
        // (sub only — NEVER the email) so downstream lines carry the full
        // 4-tuple. PII redact paths defend against accidental email leaks.
        if (ctx.workspaceId || ctx.identity?.sub) {
          Object.assign(req, {
            log: req.log.child({
              workspace_id: ctx.workspaceId,
              user_id: ctx.identity?.sub,
            }),
          });
        }

        return ctx;
      },

      onError({ error, path, ctx, req }: {
        error: { code: string; message: string };
        path: string | undefined;
        ctx: IdentityContext | undefined;
        input: unknown;
        req: FastifyRequest;
        type: string;
      }) {
        // Use the per-request log so the 4-tuple binding flows through. Fall
        // back to the top-level fastify.log if the request log was never
        // child-enriched (createContext threw before the child binding).
        const reqLog = (req.log ?? fastify.log);
        reqLog.error(
          {
            trpc_path: path,
            code: error.code,
            message: error.message,
            request_id: ctx?.requestId,
            trace_id: ctx?.traceId,
            workspace_id: ctx?.workspaceId,
            user_id: ctx?.identity?.sub,
          },
          'tRPC procedure error',
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
  const cfg = readAuthConfig();
  const fatal = assertBootableAuthConfig(cfg);
  if (fatal) {
    // eslint-disable-next-line no-console
    console.error(`FATAL: ${fatal}`);
    process.exit(1);
  }

  // CF-TS-FAILFAST-1: missing SHOPIFY_CLIENT_SECRET must surface at process
  // start, not at the first OAuth callback. The assert is pure — it names the
  // var in the message, never the value (CF-TS-NEVERLOG-1).
  const shopifyFatal = assertShopifyOAuthSecretsPresent();
  if (shopifyFatal) {
    // eslint-disable-next-line no-console
    console.error(`FATAL: ${shopifyFatal}`);
    process.exit(1);
  }

  const server = await buildServer(cfg);

  try {
    const address = await server.listen({ port: GATEWAY_PORT, host: '0.0.0.0' });
    server.log.info(`api-gateway listening on ${address} (auth: real Supabase JWT)`);
    server.log.info(`  tRPC endpoint:   ${address}/trpc`);
    server.log.info(`  Health check:    ${address}/health`);
  } catch (err) {
    server.log.error(err, 'Failed to start api-gateway');
    process.exit(1);
  }
}

// Run main() ONLY when this module is the process entry point.
const isEntrypoint = (() => {
  try {
    const entry = process.argv[1] ?? '';
    return entry.endsWith('server.ts') || entry.endsWith('server.js');
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  void main();
}

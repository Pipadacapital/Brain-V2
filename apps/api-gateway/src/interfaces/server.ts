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
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';

import { assembleClaim } from '@brain/core-auth';
import { resolveMembership, listWorkspaces } from '@brain/core-onboarding';
import { createBrainRouter } from '../application/router.js';
import {
  StubDataPlane,
  InMemoryDecisionLog,
  SUGANDH_LOK_WORKSPACE_ID,
} from '../infrastructure/loopback-data-plane.js';
import { DispatchingDataPlane } from '../infrastructure/dispatching-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import type { WorkspaceContext, IdentityContext } from '../application/trpc.js';
import {
  createSupabaseJwtVerifier,
  AuthVerifyError,
} from '../infrastructure/supabase-jwt-verifier.js';
import {
  LocalSeedMembershipResolver,
  DbMembershipResolver,
  type MembershipResolver,
} from '../domain/membership-resolver.js';

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
// Real-auth wiring (Slice A — feat-auth-supabase-identity)
//
// B1 (server-side flag, fail-closed): the LOCAL harness stub path is reachable
//   ONLY when BRAIN_GATEWAY_LOCAL_HARNESS === 'true'. This is a SERVER-SIDE flag,
//   distinct from the web's NEXT_PUBLIC_BRAIN_LOCAL_HARNESS (invisible here).
//   Absent/false ⇒ real-auth: a verified Bearer JWT is the ONLY way to get a claim.
// B2 (JWKS): SUPABASE_URL asserted non-empty at boot when real-auth is active.
// S5 (resolver fail-closed): the LocalSeedMembershipResolver is selected ONLY in
//   harness mode; real-auth resolves via the (slice-C) DbMembershipResolver, and
//   until that lands, an unresolved sub fails closed (UNAUTHORIZED).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth-mode resolution (Slice A). EXPORTED so the boot assertions are unit-tested
// without importing the side-effectful boot block. Pure: reads env, never exits.
// ---------------------------------------------------------------------------
export interface GatewayAuthConfig {
  localHarness: boolean;
  supabaseUrl: string;
  isProduction: boolean;
}

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): GatewayAuthConfig {
  return {
    localHarness: env['BRAIN_GATEWAY_LOCAL_HARNESS'] === 'true',
    supabaseUrl: (env['SUPABASE_URL'] ?? '').trim(),
    isProduction: env['NODE_ENV'] === 'production',
  };
}

/**
 * Validate the auth config. Returns a fatal message string if boot MUST abort,
 * or null if the config is bootable. (B1/B2/S5.) Pure — the caller decides to exit.
 */
export function assertBootableAuthConfig(cfg: GatewayAuthConfig): string | null {
  // B1 + S5: a production build must NEVER be able to select the stub/local path.
  if (cfg.isProduction && cfg.localHarness) {
    return 'BRAIN_GATEWAY_LOCAL_HARNESS is enabled under NODE_ENV=production. ' +
      'The stub-auth path must be unreachable in production (B1/S5).';
  }
  // B2: real-auth requires a Supabase project URL. Fail boot, not a request.
  if (!cfg.localHarness && !cfg.supabaseUrl) {
    return 'SUPABASE_URL is required when real-auth is active ' +
      '(BRAIN_GATEWAY_LOCAL_HARNESS is not "true"). Set it or enable the local harness (B2).';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data plane + idempotency store (Phase-0: in-process stubs).
// Constructing the stubs is side-effect-free (no env, no network), so it is safe
// at module scope — the web app's BrainRouter type import depends on it.
// ---------------------------------------------------------------------------

// Slice E: the DispatchingDataPlane routes Sugandh-Lok → the seed StubDataPlane and
// every OTHER workspace → a per-workspace LocalDbDataPlane reading its OWN ingested
// connector facts from local Postgres. ONE DataPlanePort to the router (no second path).
const seedPlane      = new StubDataPlane(new InMemoryDecisionLog(), LOCAL_DEV_WORKSPACE);
const dataPlane      = new DispatchingDataPlane(seedPlane);
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

export function buildLocalStubContext(
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
    // Slice C: the harness context also carries a (stub) verified identity so the
    // identity-tier procedures resolve under the offline harness.
    identity: { sub: userId, email: LOCAL_DEV_EMAIL },
    claim,
    workspaceId,   // MUST equal claim.workspaceId (workspaceMiddleware asserts this)
    requestId,
    traceId,
  };
}

// ---------------------------------------------------------------------------
// Real-auth context builder (Slice A) — EXPORTED + dependency-injected so it is
// directly unit-testable without triggering this module's boot side effects.
//
// B1: this builder is reached ONLY on the real-auth path; there is no stub
//     fallback inside it — a verify/resolve miss throws UNAUTHORIZED.
// B3: workspace_id comes ONLY from the MembershipResolver keyed on the verified
//     `sub`. The `x-workspace-id` header is NEVER passed in or consulted here —
//     there is no `??`/`||` fallback to it.
// S1: any verify failure → generic UNAUTHORIZED; jose internals never surfaced.
// S2: only `userId` (the sub) flows into the claim and the log line — no email.
// S5: an unresolved sub fails closed (UNAUTHORIZED), never a default grant.
// ---------------------------------------------------------------------------
export interface RealAuthDeps {
  verifier: { verify(bearer: string): Promise<{ sub: string; email: string }> };
  resolver: MembershipResolver;
  // Lists ALL of the verified user's memberships — used to validate a client-selected
  // active workspace (workspace switching) against real membership (never blind trust).
  listMemberships?: (sub: string) => Promise<Array<{ workspaceId: string; role: string }>>;
  log: Pick<FastifyRequest['server']['log'], 'warn'>;
}

/**
 * Build the per-request context on the real-auth path (Slice A invariants + the
 * Slice-C no-membership case).
 *
 * Returns an IdentityContext that ALWAYS carries the verified identity (sub+email)
 * and carries `claim`+`workspaceId` ONLY when the resolver finds a membership:
 *   - membership found → full WorkspaceContext (data procedures work).
 *   - NO membership   → identity-only context. The user is verified but has no
 *     workspace yet — onboarding.complete + user.me (identity tier) work; every
 *     workspace/authed-tier data procedure fails closed at the middleware. This
 *     is how a freshly signed-up user is routed to /onboarding WITHOUT an
 *     auto-OWNER grant (the slice-A persona's hard rule).
 *   - verify failure  → UNAUTHORIZED (generic; jose internals never surfaced).
 *   - DB/resolver THROW → propagates → caller maps to UNAUTHORIZED (fail-closed;
 *     a DB error must NEVER become a default privileged claim).
 *
 * B3 preserved: workspace_id comes ONLY from the resolver keyed on the verified
 * sub — `x-workspace-id` is never read here. S2 preserved: email is carried in the
 * identity (for onboarding) but NEVER logged and NEVER placed in the claim.
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
    // S1/S2: log error CLASS + requestId only (never token/email), at warn.
    deps.log.warn(
      {
        requestId,
        errorClass: err instanceof AuthVerifyError ? err.reason : 'unknown',
      },
      'auth verify rejected',
    );
    throw new TRPCError({ code: 'UNAUTHORIZED', message: `Authentication required. request_id=${requestId}` });
  }

  // The verified identity is ALWAYS present once the JWT verifies — even with no
  // membership. (Identity-tier procedures use this; never logged — S2.)
  const identity = { sub, email };

  // Resolver THROW (DB error) is NOT caught here — it propagates so the caller
  // fails closed (UNAUTHORIZED), never a default grant (S5).
  const membership = await deps.resolver.resolve(sub);

  if (!membership) {
    // Slice C: verified but no membership → identity-only context (route to
    // /onboarding). NOT an error, NOT a grant. S2: log sub/requestId only.
    deps.log.warn({ requestId, sub }, 'verified user has no membership (route to onboarding)');
    return { identity, requestId, traceId };
  }

  // Active workspace = the resolver default (earliest membership), UNLESS the client
  // selected a different one (workspace switch). A selection is honored ONLY if the
  // verified user is actually a member of it (validated via listMemberships) — this is
  // the secure switch path: the choice is checked against real membership, not trusted.
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
    userId: sub, // S2: sub only, never email
    workspaceId: activeWorkspaceId, // resolver default OR a membership-validated selection
    workspaceRole: activeRole,
    systemRole: membership.systemRole,
    requestId,
    traceId,
  });

  return {
    identity,
    claim,
    workspaceId: activeWorkspaceId, // === claim.workspaceId (middleware asserts)
    requestId,
    traceId,
  };
}

// ---------------------------------------------------------------------------
// Fastify server
// ---------------------------------------------------------------------------

async function buildServer(cfg: GatewayAuthConfig) {
  const fastify = Fastify({
    // Structured JSON logs via pino — works without pino-pretty.
    // CF-SEC-5: request_id in every log line (req.id is Fastify's auto-generated id).
    logger: { level: 'info' },
  });

  // Build the verifier + resolver ONCE (JWKS cache lives in the verifier).
  // In harness mode we skip the verifier entirely (no network) and use the seed resolver.
  const jwtVerifier = cfg.localHarness
    ? null
    : createSupabaseJwtVerifier({ supabaseUrl: cfg.supabaseUrl });

  // Slice C: the real-auth path now resolves membership from the LOCAL dev DB via
  // the core-service resolveMembership use-case (DbMembershipResolver). A verified
  // user with NO membership resolves to null → routed to /onboarding (no auto-grant);
  // a DB error propagates → UNAUTHORIZED (fail-closed). The LocalSeedMembershipResolver
  // remains the OFFLINE harness path ONLY (BRAIN_GATEWAY_LOCAL_HARNESS === 'true').
  const membershipResolver: MembershipResolver = cfg.localHarness
    ? new LocalSeedMembershipResolver(LOCAL_DEV_WORKSPACE)
    : new DbMembershipResolver(resolveMembership);

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
    // Slice A: report the active auth mode (no secrets, no PII).
    authMode: cfg.localHarness ? 'local-harness-stub' : 'real-supabase-jwt',
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
      //
      // Slice A: two HARD-gated paths (B1) — never a fallback chain.
      //   - real-auth (default): verify Bearer JWT → resolver → claim. No token ⇒
      //     UNAUTHORIZED. The `x-workspace-id` header is IGNORED here (B3).
      //   - LOCAL harness (BRAIN_GATEWAY_LOCAL_HARNESS === 'true' ONLY): the
      //     offline stub path, accepting trusted headers / Sugandh-Lok defaults.
      async createContext({ req }: CreateFastifyContextOptions): Promise<IdentityContext> {
        // CF-SEC-5: generate a fresh correlation id per request.
        const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        const traceId   = (req.headers['x-trace-id']   as string | undefined) ?? randomUUID();

        if (!cfg.localHarness) {
          // REAL-AUTH path. workspace_id derives ONLY from the verified claim's
          // membership (B3) — the `x-workspace-id` header is not read.
          if (!jwtVerifier) {
            // Defensive: boot already asserts SUPABASE_URL, so this is unreachable
            // in practice — fail closed rather than fall back to a stub.
            throw new TRPCError({
              code: 'UNAUTHORIZED',
              message: `Authentication required. request_id=${requestId}`,
            });
          }
          req.server.log.info({ requestId, traceId, url: req.url }, 'api-gateway request (real-auth)');
          // Client-selected active workspace (workspace switch) — validated against the
          // user's real memberships inside buildRealAuthContext. NOT blindly trusted.
          const requestedWorkspaceId = (req.headers['x-brain-workspace'] as string | undefined)?.trim() || undefined;
          return buildRealAuthContext(
            req.headers['authorization'] as string | undefined,
            requestId,
            traceId,
            {
              verifier: jwtVerifier,
              resolver: membershipResolver,
              listMemberships: (sub: string) => listWorkspaces(sub),
              log: req.server.log,
            },
            requestedWorkspaceId,
          );
        }

        // LOCAL HARNESS path (flag === 'true' only). Offline stub: accept
        // workspace + user from trusted headers, or fall back to Sugandh-Lok.
        const workspaceId = (req.headers['x-workspace-id'] as string | undefined)?.trim()
          || LOCAL_DEV_WORKSPACE;
        const userId      = (req.headers['x-user-id']      as string | undefined)?.trim()
          || LOCAL_DEV_USER_ID;

        // S2: log userId (correlation UUID) only — never email or token.
        req.server.log.info(
          { requestId, traceId, workspaceId, userId, url: req.url, harness: true },
          'api-gateway request (local-harness)',
        );

        return buildLocalStubContext(requestId, traceId, workspaceId, userId);
      },

      // CF-SEC-5: surface requestId on errors via the gateway's error logger.
      onError({ error, path, ctx }: {
        error: { code: string; message: string };
        path: string | undefined;
        ctx: IdentityContext | undefined;
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
  // B1/B2/S5: read + validate auth config at boot. Abort fatally if not bootable.
  const cfg = readAuthConfig();
  const fatal = assertBootableAuthConfig(cfg);
  if (fatal) {
    // eslint-disable-next-line no-console
    console.error(`FATAL: ${fatal}`);
    process.exit(1);
  }

  const server = await buildServer(cfg);

  try {
    const address = await server.listen({ port: GATEWAY_PORT, host: '0.0.0.0' });
    server.log.info(
      `api-gateway listening on ${address} (auth: ${cfg.localHarness ? 'LOCAL harness stub' : 'real Supabase JWT'})`,
    );
    server.log.info(`  tRPC endpoint:   ${address}/trpc`);
    server.log.info(`  Health check:    ${address}/health`);
    server.log.info(`  Seed workspace:  ${LOCAL_DEV_WORKSPACE}`);
    if (cfg.localHarness) {
      server.log.info(`  Stub user:       ${LOCAL_DEV_EMAIL}`);
    }
    server.log.info(
      `  Seed data:       net_revenue ₹18.5L | cm2 ₹3.2L | ROAS 2.85× | orders 1,247`,
    );
  } catch (err) {
    server.log.error(err, 'Failed to start api-gateway');
    process.exit(1);
  }
}

// Run main() ONLY when this module is the process entry point (tsx src/interfaces/server.ts).
// Importing the module in tests must be side-effect-free (no listen, no process.exit).
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

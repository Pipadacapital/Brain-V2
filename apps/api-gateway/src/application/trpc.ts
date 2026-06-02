// @paradigm: sql
// tRPC instance + superjson transformer registration.
// CF-C6-BIGINT-JSON-1: superjson MUST be registered here so bigint round-trips
// faithfully through the tRPC stack. Do NOT swap to bare JSON serializer.
//
// Router tiers per canon (technical-context.md :139):
//   public → authed → workspace → owner
//
// The superjson transformer is THE G-BIGINT gate at the serializer level.
// Mutant: remove superjson → bare JSON number → 9e18 paise loses precision → RED.

import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { BrainClaim } from '@brain/core-auth';
import { createLogger } from '@brain/lib-logger';
import { trpcDuration, trpcErrors } from '../infrastructure/metrics.js';

// Module-scoped logger used by the tRPC tracing middleware. Bound to the
// 'api-gateway' service; per-procedure log lines carry the procedure path +
// the correlation 4-tuple (request_id/trace_id/workspace_id/user_id) drawn
// from the per-request context. See docs/observability.md.
const trpcLog = createLogger('api-gateway', {
  bindings: { component: 'trpc' },
});

// ---------------------------------------------------------------------------
// Context shape — populated by Fastify request hooks
// ---------------------------------------------------------------------------

export interface PublicContext {
  requestId: string;
  traceId: string;
}

/**
 * Slice C: a VERIFIED identity that may NOT yet have a workspace membership.
 * Carried so identity-tier procedures (onboarding, user.me) work for a freshly
 * signed-up user with zero memberships — BEFORE any workspace claim exists.
 * `email` is PII — never logged (CF-C6-PII-CLIENT-1).
 */
export interface VerifiedIdentity {
  sub: string;
  email: string;
}

/**
 * Identity tier: a verified JWT sub+email is present. `claim`/`workspaceId` are
 * OPTIONAL here — a no-membership user routes to /onboarding and still needs to
 * call onboarding.complete + user.me, which require identity but NOT a workspace.
 */
export interface IdentityContext extends PublicContext {
  identity: VerifiedIdentity;
  /** Present ONLY when the verified user has a resolved membership. */
  claim?: BrainClaim;
  /** Present ONLY when claim is present; always === claim.workspaceId. */
  workspaceId?: string;
}

export interface AuthedContext extends IdentityContext {
  claim: BrainClaim;
}

export interface WorkspaceContext extends AuthedContext {
  workspaceId: string;  // asserted === claim.workspaceId (CF-C6-GATEWAY-TENANCY-1)
}

/**
 * Superadmin tier: a valid BrainClaim whose `systemRole === 'SUPERADMIN'`. The ONE
 * sanctioned cross-tenant tier — admin.* procedures that enumerate EVERY workspace/
 * user/connection run here. NO workspace_id assertion (the whole point is to span
 * tenants); the systemRole check IS the gate. Distinct from workspaceProc, which
 * fails closed on a foreign workspace_id.
 */
export interface SuperadminContext extends AuthedContext {
  claim: BrainClaim; // claim.systemRole asserted === 'SUPERADMIN' by superadminMiddleware
}

// The tRPC instance uses the union of all context shapes.
// Each procedure tier narrows the context at middleware time.
export type RootContext = PublicContext | IdentityContext | AuthedContext | WorkspaceContext;

// ---------------------------------------------------------------------------
// tRPC init with superjson transformer (G-BIGINT gate)
// CF-C6-BIGINT-JSON-1: superjson handles bigint, Date, Map, Set, etc.
// ---------------------------------------------------------------------------

const t = initTRPC.context<IdentityContext>().create({
  transformer: superjson,
  // CF-SEC-5: surface the real correlation request_id (not the procedure path) on
  // every error response so operators can trace failures end-to-end.
  // SEC-C6-H1 fix: ctx.requestId is the correlation id; shape.data.path is the
  // procedure name ("metrics.kpiSummary") — wrong value, different semantics.
  errorFormatter({ shape, ctx }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Use ctx.requestId (correlation id) NOT shape.data.path (procedure name).
        // Killed-mutant test: error.data.requestId === ctx.requestId !== path.
        requestId: ctx?.requestId ?? undefined,
      },
    };
  },
});

export const router = t.router;

// ---------------------------------------------------------------------------
// Tracing middleware — runs on EVERY procedure (public → workspace tier).
//
// Emits two log lines per procedure invocation:
//   - "procedure start"  (level=debug; opt-in via LOG_LEVEL=debug)
//   - "procedure done"   (level=info on OK; level=warn on caller-error;
//                         level=error on server-error)
//
// Bound fields on every line:
//   service:     'api-gateway'
//   component:   'trpc'
//   trpc_path:   the procedure name (e.g. 'metrics.kpiSummary')
//   trpc_type:   'query' | 'mutation' | 'subscription'
//   request_id:  per-request UUID from the correlation context
//   trace_id:    per-trace UUID
//   workspace_id: when present in ctx (workspace-tier procedures)
//   user_id:     the verified sub (never email)
//   duration_ms: end-to-end procedure latency
//   ok:          true | false
//   error_code:  on failure (e.g. 'UNAUTHORIZED', 'NOT_FOUND')
//
// Caller errors (4xx-shape: UNAUTHORIZED/FORBIDDEN/NOT_FOUND/BAD_REQUEST/
// CONFLICT/PRECONDITION_FAILED/PAYLOAD_TOO_LARGE/METHOD_NOT_SUPPORTED/
// UNPROCESSABLE_CONTENT) log at warn; everything else at error (so on-call
// can filter to "real" server-side failures).
// ---------------------------------------------------------------------------

const CALLER_ERROR_CODES = new Set([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_SUPPORTED',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'UNPROCESSABLE_CONTENT',
  'TOO_MANY_REQUESTS',
]);

const tracingMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const started = Date.now();

  // Build the per-invocation log context from ctx. ctx fields vary by tier
  // (public has only requestId/traceId; identity adds identity.sub; authed
  // adds claim/workspaceId; workspace asserts workspaceId).
  const c = ctx as Partial<IdentityContext> & Partial<WorkspaceContext>;
  const baseFields = {
    trpc_path: path,
    trpc_type: type,
    request_id: c.requestId,
    trace_id: c.traceId,
    workspace_id: c.workspaceId,
    user_id: c.identity?.sub,
  };

  trpcLog.debug(baseFields, 'procedure start');

  const result = await next({ ctx });
  const duration_ms = Date.now() - started;

  // Prometheus latency series (P1-19) — same measurement the log line uses, so
  // the histogram and the structured log can never disagree on duration.
  trpcDuration.observe({ path, type, ok: String(result.ok) }, duration_ms);

  if (result.ok) {
    trpcLog.info({ ...baseFields, ok: true, duration_ms }, 'procedure done');
  } else {
    const code = result.error.code;
    const isCallerError = CALLER_ERROR_CODES.has(code);
    // Mirror the log's caller-vs-server split into the error counter so the
    // on-call dashboard can alert on kind=server without caller-error noise.
    trpcErrors.inc({ path, type, code, kind: isCallerError ? 'caller' : 'server' });
    const fields = {
      ...baseFields,
      ok: false,
      duration_ms,
      error_code: code,
      error_message: result.error.message,
    };
    if (isCallerError) {
      trpcLog.warn(fields, 'procedure done (caller error)');
    } else {
      // pino's err serializer kicks in for the cause; safer than dumping the
      // raw error which may carry PII fields in some library exceptions.
      trpcLog.error({ ...fields, err: result.error.cause }, 'procedure done (server error)');
    }
  }

  return result;
});

// All procedure factories below get the tracing middleware first so every
// downstream tier inherits it (tracing applies UNIFORMLY to public, identity,
// authed, and workspace procedures).
export const publicProcedure = t.procedure.use(tracingMiddleware);

// ---------------------------------------------------------------------------
// Middleware: authentication check
// ---------------------------------------------------------------------------

const authedMiddleware = t.middleware(({ ctx, next }) => {
  // In production: claim is set by Fastify auth hook from the verified JWT.
  // The claim field being absent means the request is unauthenticated OR the
  // verified user has no workspace membership yet (slice C). Either way, claim-
  // requiring (workspace-data) procedures are not reachable — UNAUTHORIZED.
  if (!('claim' in ctx) || !ctx.claim) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: `Authentication required. request_id=${ctx.requestId}`,
    });
  }
  return next({ ctx: ctx as AuthedContext });
});

// ---------------------------------------------------------------------------
// Middleware: identity check (Slice C)
// A VERIFIED JWT identity (sub+email) is required, but a workspace membership is
// NOT — this tier serves onboarding + user.me for a no-membership user who must
// be routed to /onboarding. The verified identity (never spoofable headers) is
// the gate; fail-closed UNAUTHORIZED when absent.
// ---------------------------------------------------------------------------

const identityMiddleware = t.middleware(({ ctx, next }) => {
  if (!('identity' in ctx) || !ctx.identity || !ctx.identity.sub) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: `Authentication required. request_id=${ctx.requestId}`,
    });
  }
  return next({ ctx: ctx as IdentityContext & { identity: VerifiedIdentity } });
});

// ---------------------------------------------------------------------------
// Middleware: workspace tenancy assertion
// CF-C6-GATEWAY-TENANCY-1: request.workspace_id === claim.workspaceId BEFORE
// any data-plane call. The requireRole check is per-procedure (see workspaceProc).
// ---------------------------------------------------------------------------

const workspaceMiddleware = t.middleware(({ ctx, next }) => {
  if (!('workspaceId' in ctx) || !ctx.workspaceId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `workspace_id is required. request_id=${ctx.requestId}`,
    });
  }
  const wsCtx = ctx as WorkspaceContext;

  // CF-C6-GATEWAY-TENANCY-1: MUST assert workspace match before data-plane.
  // This is the load-bearing check — mutation target.
  if (wsCtx.workspaceId !== wsCtx.claim.workspaceId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        `Workspace mismatch: request workspace_id=${wsCtx.workspaceId} ` +
        `≠ claim.workspaceId=${wsCtx.claim.workspaceId}. ` +
        `CF-C6-GATEWAY-TENANCY-1. request_id=${wsCtx.requestId}`,
    });
  }

  return next({ ctx: wsCtx });
});

// ---------------------------------------------------------------------------
// Middleware: superadmin (platform) authorization
// The ONLY cross-tenant gate. Runs AFTER authedMiddleware so ctx.claim is present.
// Load-bearing check: claim.systemRole === 'SUPERADMIN'. Mutation target — flipping
// the comparison or dropping the check MUST fail a test (admin.* would leak every
// tenant's directory to a normal USER). NO workspace_id assertion here by design.
// ---------------------------------------------------------------------------

const superadminMiddleware = t.middleware(({ ctx, next }) => {
  if (!('claim' in ctx) || !ctx.claim) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: `Authentication required. request_id=${ctx.requestId}`,
    });
  }
  if (ctx.claim.systemRole !== 'SUPERADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        `Superadmin only. systemRole=${ctx.claim.systemRole} is not SUPERADMIN. ` +
        `request_id=${ctx.requestId}`,
    });
  }
  return next({ ctx: ctx as SuperadminContext });
});

// ---------------------------------------------------------------------------
// Procedure tiers
// ---------------------------------------------------------------------------

// Every tier composes the tracing middleware FIRST so we get a uniform
// procedure-done log line on success and failure across all tiers.

/** Public tier: no auth required (login page, health check) */
export const publicProc = t.procedure.use(tracingMiddleware);

/**
 * Identity tier (Slice C): requires a verified JWT identity (sub+email) but NOT a
 * workspace membership. For onboarding.complete + user.me (the no-membership user
 * who must be routed to /onboarding).
 */
export const identityProc = t.procedure.use(tracingMiddleware).use(identityMiddleware);

/** Authed tier: requires a valid BrainClaim (verified identity WITH a membership) */
export const authedProc = t.procedure.use(tracingMiddleware).use(authedMiddleware);

/** Workspace tier: requires auth + workspace_id === claim.workspaceId */
export const workspaceProc = t.procedure
  .use(tracingMiddleware)
  .use(authedMiddleware)
  .use(workspaceMiddleware);

/**
 * Superadmin tier: requires a valid claim with systemRole === 'SUPERADMIN'. The
 * sanctioned cross-tenant tier for the /admin suite. NO workspace assertion.
 */
export const superadminProc = t.procedure
  .use(tracingMiddleware)
  .use(authedMiddleware)
  .use(superadminMiddleware);

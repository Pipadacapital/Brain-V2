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

// ---------------------------------------------------------------------------
// Context shape — populated by Fastify request hooks
// ---------------------------------------------------------------------------

export interface PublicContext {
  requestId: string;
  traceId: string;
}

export interface AuthedContext extends PublicContext {
  claim: BrainClaim;
}

export interface WorkspaceContext extends AuthedContext {
  workspaceId: string;  // asserted === claim.workspaceId (CF-C6-GATEWAY-TENANCY-1)
}

// The tRPC instance uses the union of all context shapes.
// Each procedure tier narrows the context at middleware time.
export type RootContext = PublicContext | AuthedContext | WorkspaceContext;

// ---------------------------------------------------------------------------
// tRPC init with superjson transformer (G-BIGINT gate)
// CF-C6-BIGINT-JSON-1: superjson handles bigint, Date, Map, Set, etc.
// ---------------------------------------------------------------------------

const t = initTRPC.context<WorkspaceContext>().create({
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
export const publicProcedure = t.procedure;

// ---------------------------------------------------------------------------
// Middleware: authentication check
// ---------------------------------------------------------------------------

const authedMiddleware = t.middleware(({ ctx, next }) => {
  // In production: claim is set by Fastify auth hook from the verified JWT.
  // The claim field being absent means the request is unauthenticated.
  if (!('claim' in ctx) || !ctx.claim) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: `Authentication required. request_id=${ctx.requestId}`,
    });
  }
  return next({ ctx: ctx as AuthedContext });
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
// Procedure tiers
// ---------------------------------------------------------------------------

/** Public tier: no auth required (login page, health check) */
export const publicProc = t.procedure;

/** Authed tier: requires a valid BrainClaim */
export const authedProc = t.procedure.use(authedMiddleware);

/** Workspace tier: requires auth + workspace_id === claim.workspaceId */
export const workspaceProc = t.procedure
  .use(authedMiddleware)
  .use(workspaceMiddleware);

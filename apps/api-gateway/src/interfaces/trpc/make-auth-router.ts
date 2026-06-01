// @paradigm: sql
// Thin tRPC router — auth domain (spec: api-gateway interfaces = thin trpc routers).
// Extracted from application/router.ts as part of the Phase-E router split. Behaviour is
// byte-identical; createBrainRouter composes this factory. CF-C6-RENDER-ONLY-1 preserved.

import { router, authedProc } from '../../application/trpc.js';

/** auth router — session claim (authed tier). No deps. */
export function makeAuthRouter() {
  return router({
    /** Return the current session claim (authed tier). */
    session: authedProc.query(({ ctx }) => {
      return {
        userId: ctx.claim.userId,
        workspaceId: ctx.claim.workspaceId,
        workspaceRole: ctx.claim.workspaceRole,
        requestId: ctx.requestId,
      };
    }),
  });
}

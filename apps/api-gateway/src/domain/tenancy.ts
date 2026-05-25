// @paradigm: sql
// CF-C6-GATEWAY-TENANCY-1: ONE auth/tenancy choke point — TenancyInterceptor.
// Consumes the Child-1 BrainClaim contract from brain-claim.ts.
// Asserts request.workspace_id === claim.workspaceId BEFORE any data-plane call.
// requireRole() enforced here — the load-bearing >= comparison.
//
// Mutation testing targets:
//   1. flip workspace_id === claim.workspaceId → !== : must FAIL tenancy test
//   2. flip requireRole >= to > : must FAIL role-boundary test (ANALYST at min level)
//
// CF-SEC-5: correlation 4-tuple (request_id, trace_id, workspace_id, user_id)
// propagated into gRPC metadata via x-workspace-id and x-request-id headers.

import {
  type BrainClaim,
  type WorkspaceRoleString,
  requireRole,
} from '@brain/core-auth';

export class TenancyViolationError extends Error {
  constructor(
    public readonly code: 'WORKSPACE_MISMATCH' | 'INSUFFICIENT_ROLE' | 'MISSING_CLAIM',
    message: string,
    /** CF-SEC-5: surface request_id on error for end-to-end traceability */
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'TenancyViolationError';
  }
}

export interface TenancyContext {
  claim: BrainClaim;
  workspaceId: string;
  /** Correlation quad — CF-SEC-5 / C5-SEC-003 */
  requestId: string;
  traceId: string;
}

/**
 * Assert that the request workspace_id matches the claim's workspaceId.
 * This is the forward-note from brain-claim.ts:
 *   "A future router MUST assert request.workspace_id == claim.workspaceId
 *    before calling withWorkspace."
 *
 * CF-C6-GATEWAY-TENANCY-1: ONE choke point, called BEFORE any data-plane call.
 * Mutation target: the === comparison (workspace mismatch must throw).
 *
 * @throws TenancyViolationError on workspace mismatch
 */
export function assertWorkspaceClaim(
  requestWorkspaceId: string,
  claim: BrainClaim,
  requestId: string,
): void {
  // CF-C6-GATEWAY-TENANCY-1: this assertion is the load-bearing tenancy gate.
  // Mutation target: changing === to !== must fail the test.
  if (requestWorkspaceId !== claim.workspaceId) {
    throw new TenancyViolationError(
      'WORKSPACE_MISMATCH',
      `Workspace mismatch: request workspace_id=${requestWorkspaceId} does not match ` +
        `claim.workspaceId=${claim.workspaceId}. This is a tenancy violation. ` +
        `CF-C6-GATEWAY-TENANCY-1. request_id=${requestId}`,
      requestId,
    );
  }
}

/**
 * Assert that the claim has at least the required role level.
 * Consumes the Child-1 requireRole() function directly.
 *
 * Mutation target: the >= inside requireRole — flip to > must fail at ANALYST boundary test.
 *
 * @throws TenancyViolationError if role is insufficient
 */
export function assertRequiredRole(
  claim: BrainClaim,
  minRole: WorkspaceRoleString,
  requestId: string,
): void {
  // requireRole uses >= comparison (mutation target in brain-claim.ts).
  if (!requireRole(claim, minRole)) {
    throw new TenancyViolationError(
      'INSUFFICIENT_ROLE',
      `Role insufficient: requires ${minRole} or higher, ` +
        `current=${claim.workspaceRole} (level ${claim.workspaceRoleLevel}). ` +
        `CF-C6-GATEWAY-TENANCY-1. request_id=${requestId}`,
      requestId,
    );
  }
}

/**
 * Build the gRPC metadata object to propagate tenancy + correlation through
 * the data-plane call. CF-SEC-5 / CF-C6-GATEWAY-TENANCY-1.
 */
export function buildGrpcMetadata(ctx: TenancyContext): Record<string, string> {
  return {
    'x-workspace-id': ctx.workspaceId,
    'x-request-id': ctx.requestId,
    'x-trace-id': ctx.traceId,
    'x-user-id': ctx.claim.userId,
  };
}

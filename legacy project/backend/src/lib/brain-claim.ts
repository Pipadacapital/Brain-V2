/**
 * Brain auth/role-claim contract (Track 1b).
 *
 * Maps the existing Supabase JWT (userId) + WorkspaceMember.role (5-level
 * WorkspaceRole) + User.systemRole (SystemRole) into Brain's level-ordered
 * claim that flows through every middleware and into withWorkspace/withSuperadmin.
 *
 * Paradigm: sql-ddl-and-connection-handling (JWT-claim mapping, no ML/LLM)
 * CF-SEC-5: claim carries the correlation 4-tuple.
 *
 * Design (§8 of the arch plan):
 *   WorkspaceRole: OWNER(5) > ADMIN(4) > MANAGER(3) > ANALYST(2) > VIEWER(1)
 *   SystemRole:    SUPERADMIN | USER
 *
 * No re-login storm: the claim is assembled from the already-verified JWT +
 * the membership DB lookup that requireWorkspace already performs.
 */

// ---------------------------------------------------------------------------
// Role level ordering
// ---------------------------------------------------------------------------

export type WorkspaceRoleString = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER'
export type SystemRoleString = 'SUPERADMIN' | 'USER'

export const WORKSPACE_ROLE_LEVEL: Record<WorkspaceRoleString, number> = {
  OWNER: 5,
  ADMIN: 4,
  MANAGER: 3,
  ANALYST: 2,
  VIEWER: 1,
}

// ---------------------------------------------------------------------------
// Brain Claim — the canonical identity + auth object on req.claim
// ---------------------------------------------------------------------------

export interface BrainClaim {
  /** Supabase auth user UUID (JWT `sub`) */
  userId: string
  /** Resolved workspace UUID for this request */
  workspaceId: string
  /** Role string from WorkspaceMember */
  workspaceRole: WorkspaceRoleString
  /** Numeric level for >= comparisons in requireRole() */
  workspaceRoleLevel: number
  /** From User.systemRole */
  systemRole: SystemRoleString
  /** CF-SEC-5 correlation 4-tuple */
  requestId: string
  traceId: string
}

// ---------------------------------------------------------------------------
// requireRole guard — level-ordered, replaces ad-hoc role checks
// ---------------------------------------------------------------------------

/**
 * Returns true if the claim's workspaceRoleLevel >= the minimum required level.
 *
 * Usage:
 *   if (!requireRole(req.claim, 'ADMIN')) throw forbidden('Requires ADMIN role')
 */
export function requireRole(
  claim: BrainClaim,
  minRole: WorkspaceRoleString,
): boolean {
  return claim.workspaceRoleLevel >= WORKSPACE_ROLE_LEVEL[minRole]
}

/**
 * Throws a 403 if the role is insufficient.
 * Import the `forbidden` helper separately from utils/http-error.ts.
 */
export function assertRole(
  claim: BrainClaim,
  minRole: WorkspaceRoleString,
  onFail: (msg: string) => never,
): void {
  if (!requireRole(claim, minRole)) {
    onFail(`Requires ${minRole} role or higher`)
  }
}

// ---------------------------------------------------------------------------
// Claim assembler — called by requireWorkspace after membership resolution
// ---------------------------------------------------------------------------

export function assembleClaim(opts: {
  userId: string
  workspaceId: string
  workspaceRole: WorkspaceRoleString
  systemRole: SystemRoleString
  requestId: string
  traceId: string
}): BrainClaim {
  return {
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    workspaceRole: opts.workspaceRole,
    workspaceRoleLevel: WORKSPACE_ROLE_LEVEL[opts.workspaceRole],
    systemRole: opts.systemRole,
    requestId: opts.requestId,
    traceId: opts.traceId,
  }
}

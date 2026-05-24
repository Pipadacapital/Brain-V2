/**
 * Brain auth/role-claim contract (Track E — 1b).
 *
 * @paradigm sql (JWT-claim mapping; no ML, no LLM)
 *
 * Maps the already-verified Supabase JWT (userId = JWT `sub`) +
 * WorkspaceMember.role (5-level WorkspaceRole) + User.systemRole into the
 * Brain-native BrainClaim that flows through every middleware and into
 * withWorkspace/withSuperadmin.
 *
 * No re-login storm: the claim is assembled from the already-verified JWT +
 * the membership DB lookup that the request's auth middleware already performs.
 * The JWKS verify step is reused from the verified JWT `sub` → membership
 * lookup → claim assembly flow; this module handles only claim-MAPPING (not
 * a new RBAC model or new JWT verification).
 *
 * CF-SEC-5: claim carries the correlation 4-tuple (requestId/traceId seed).
 *
 * Design:
 *   WorkspaceRole: OWNER(5) > ADMIN(4) > MANAGER(3) > ANALYST(2) > VIEWER(1)
 *   SystemRole:    SUPERADMIN | USER
 *
 * The source of workspaceId that flows into withWorkspace<T> is always
 * claim.workspaceId. A future router MUST assert:
 *   request.workspace_id == claim.workspaceId
 * before calling withWorkspace.
 */

// ---------------------------------------------------------------------------
// Role level ordering
// ---------------------------------------------------------------------------

export type WorkspaceRoleString =
  | 'OWNER'
  | 'ADMIN'
  | 'MANAGER'
  | 'ANALYST'
  | 'VIEWER'

export type SystemRoleString = 'SUPERADMIN' | 'USER'

/**
 * Level-ordered role map. The >= comparison in requireRole() is the load-bearing
 * gate — mutation testing target: flip >= to > must fail a test.
 */
export const WORKSPACE_ROLE_LEVEL: Record<WorkspaceRoleString, number> = {
  OWNER: 5,
  ADMIN: 4,
  MANAGER: 3,
  ANALYST: 2,
  VIEWER: 1,
}

// ---------------------------------------------------------------------------
// BrainClaim — the canonical identity + auth object
// ---------------------------------------------------------------------------

export interface BrainClaim {
  /** Supabase auth user UUID (JWT `sub`) */
  userId: string
  /** Resolved workspace UUID for this request — source for withWorkspace */
  workspaceId: string
  /** Role string from WorkspaceMember */
  workspaceRole: WorkspaceRoleString
  /** Numeric level for >= comparisons in requireRole() */
  workspaceRoleLevel: number
  /** From User.systemRole */
  systemRole: SystemRoleString
  /** CF-SEC-5 correlation seed — requestId and traceId from the request context */
  requestId: string
  traceId: string
}

// ---------------------------------------------------------------------------
// requireRole — level-ordered guard, replaces ad-hoc role checks
// ---------------------------------------------------------------------------

/**
 * Returns true if the claim's workspaceRoleLevel >= the minimum required level.
 *
 * Mutation testing target: the >= comparison — flip to > must fail a test.
 *
 * Usage:
 *   if (!requireRole(claim, 'ADMIN')) throw forbidden('Requires ADMIN role')
 */
export function requireRole(
  claim: BrainClaim,
  minRole: WorkspaceRoleString,
): boolean {
  return claim.workspaceRoleLevel >= WORKSPACE_ROLE_LEVEL[minRole]
}

/**
 * Throws via the caller-supplied `onFail` callback if role is insufficient.
 * The callback pattern avoids importing an HTTP-error primitive into the domain
 * layer — the interfaces layer supplies the concrete thrower.
 *
 * Usage:
 *   assertRole(claim, 'ADMIN', (msg) => { throw new ForbiddenError(msg) })
 */
export function assertRole(
  claim: BrainClaim,
  minRole: WorkspaceRoleString,
  onFail: (msg: string) => never,
): void {
  if (!requireRole(claim, minRole)) {
    onFail(`Requires ${minRole} role or higher (current: ${claim.workspaceRole})`)
  }
}

// ---------------------------------------------------------------------------
// assembleClaim — called by auth middleware after membership resolution
// ---------------------------------------------------------------------------

export function assembleClaim(opts: {
  /** Supabase auth user UUID (verified JWT `sub`) */
  userId: string
  /** Workspace UUID resolved from the request path or header */
  workspaceId: string
  /** Role from WorkspaceMember DB lookup */
  workspaceRole: WorkspaceRoleString
  /** From User.systemRole */
  systemRole: SystemRoleString
  /** Correlation seed from the request context (CF-SEC-5) */
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

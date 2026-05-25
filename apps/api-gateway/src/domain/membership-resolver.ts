// @paradigm: sql
// MembershipResolver — maps a verified Supabase `sub` to a workspace + role.
// (Slice A — feat-auth-supabase-identity.)
//
// The verified JWT tells us WHO the user is (`sub`); the resolver tells us WHICH
// workspace + role they get. This is the ONLY source of workspace_id on the
// authed path — the spoofable `x-workspace-id` header is never consulted (B3).
//
// Persona bindings:
//   B3: workspace_id derives ONLY from resolver output keyed on the verified sub.
//   S5: LocalSeedMembershipResolver is selected ONLY when the local-harness flag
//       is affirmatively true (gating lives in server.ts). It NEVER defaults to a
//       grant — an unresolved sub returns null and the caller fails closed.
//
// Boundary (Stage-1 reconciliation #4): real membership lookup belongs to
// core-service, not the gateway. The slice-C DbMembershipResolver implements this
// SAME interface and calls core-service. This local seam is DB-less Phase-0 only.

import type {
  SystemRoleString,
  WorkspaceRoleString,
} from '@brain/core-auth';

export interface ResolvedMembership {
  workspaceId: string;
  workspaceRole: WorkspaceRoleString;
  systemRole: SystemRoleString;
}

export interface MembershipResolver {
  /**
   * @param sub the verified Supabase auth user UUID (JWT `sub`).
   * @returns the resolved membership, or null if the user has no membership
   *          (caller MUST fail closed — never default to a grant).
   */
  resolve(sub: string): Promise<ResolvedMembership | null>;
}

/**
 * Phase-0 local seam (offline harness ONLY): there is exactly ONE seeded workspace
 * (Sugandh-Lok), so any successfully-authenticated user is mapped to it as OWNER.
 * This is honest only because of that fact. The real-auth path uses the
 * DbMembershipResolver (below).
 *
 * Selection of THIS resolver is hard-gated on the local-harness flag in
 * server.ts (S5) — it is never the production / real-auth default.
 */
export class LocalSeedMembershipResolver implements MembershipResolver {
  constructor(private readonly seededWorkspaceId: string) {
    if (!seededWorkspaceId) {
      throw new Error('LocalSeedMembershipResolver requires a seeded workspaceId');
    }
  }

  async resolve(sub: string): Promise<ResolvedMembership | null> {
    if (!sub) return null; // fail closed
    return {
      workspaceId: this.seededWorkspaceId,
      workspaceRole: 'OWNER',
      systemRole: 'USER',
    };
  }
}

/**
 * Slice C — the REAL membership resolver. Delegates to the core-service
 * `resolveMembership(sub)` use-case (in-process Phase-0; canon: core-service owns
 * orgs/workspaces/users/roles — the gateway carries no business logic). Returns:
 *   - the user's PRIMARY (earliest-joined) workspace + role, OR
 *   - null when the verified user has NO membership — the gateway then routes the
 *     user to /onboarding (NEVER an auto-OWNER grant).
 *
 * Fail-closed (binding mandate): a DB error MUST become UNAUTHORIZED upstream, not
 * a default privileged claim. This resolver lets the error propagate; the gateway's
 * buildRealAuthContext catch turns any throw into UNAUTHORIZED. We do NOT swallow
 * the error and return a grant.
 */
export class DbMembershipResolver implements MembershipResolver {
  constructor(
    private readonly resolveMembershipUseCase: (sub: string) => Promise<ResolvedMembership | null>,
  ) {}

  async resolve(sub: string): Promise<ResolvedMembership | null> {
    if (!sub) return null; // fail closed
    // No try/catch: a DB error MUST propagate so the caller fails closed
    // (UNAUTHORIZED). Swallowing it and returning a grant would be the exact
    // privilege-default the slice-A persona warned against.
    return this.resolveMembershipUseCase(sub);
  }
}

/**
 * Onboarding / membership application use-cases (Slice C).
 *
 * @paradigm sql (deterministic DB transactions; no ML, no LLM)
 *
 * These own the Brain-native onboarding/membership business logic. Each runs the
 * actual DB work through the Child-1 session-context primitive (withWorkspace /
 * withSuperadmin) — NO second pool, NO second transaction shape (Single-Primitive
 * Rule). The gateway calls these in-process (Phase-0) passing the VERIFIED sub +
 * email from the JWT claim.
 *
 * RLS posture (proven at the wire in onboarding-rls.integration.test.ts):
 *   - completeOnboarding / ensureUser / resolveMembership / listWorkspaces:
 *     run under withSuperadmin because they span workspaces by user_id, or create
 *     a brand-new workspace that has no context to set yet. This is the SANCTIONED
 *     no-context / cross-workspace path (CF-BN-OWNER-1). Each query is explicitly
 *     filtered by the verified sub / token — superadmin context does NOT mean
 *     "return everything"; the SQL still scopes to the caller's own rows.
 *   - acceptInvitation's membership write runs under withWorkspace(invitation
 *     .workspaceId) once the invitation is validated — scoped to that one tenant.
 *
 * Fail-closed: a DB error propagates (the gateway maps it to UNAUTHORIZED on the
 * resolver path); resolveMembership returns null for a user with no membership so
 * the gateway routes to /onboarding (never an auto-grant).
 */

import type { PoolClient } from 'pg'
import { withWorkspace, withSuperadmin } from '../../infrastructure/db/workspace-context.js'
import {
  isValidSlug,
  normalizeSlug,
  mapInvitationRole,
  type OnboardingInput,
  type ResolvedMembership,
  type VerifiedIdentity,
  type WorkspaceSummary,
} from '../../domain/onboarding/membership.js'
import type { WorkspaceRoleString, SystemRoleString } from '../../domain/auth/brain-claim.js'

// Allow the DB runner to be injected for unit tests (defaults to the real primitive).
export interface DbRunners {
  withWorkspace: typeof withWorkspace
  withSuperadmin: typeof withSuperadmin
}

const defaultRunners: DbRunners = { withWorkspace, withSuperadmin }

export class OnboardingError extends Error {
  constructor(
    public readonly code:
      | 'SLUG_INVALID'
      | 'SLUG_TAKEN'
      | 'INVITATION_NOT_FOUND'
      | 'INVITATION_NOT_PENDING'
      | 'INVITATION_EXPIRED'
      | 'VALIDATION',
    message: string,
  ) {
    super(message)
    this.name = 'OnboardingError'
  }
}

// ---------------------------------------------------------------------------
// ensureUser — idempotent upsert of the users row for the verified caller.
// Ports legacy lib/ensure-user.ts. Keyed on the verified sub; email from the JWT.
// ---------------------------------------------------------------------------
export async function ensureUser(
  identity: VerifiedIdentity,
  runners: DbRunners = defaultRunners,
): Promise<{ userId: string; created: boolean }> {
  if (!identity.sub || !identity.email) {
    throw new OnboardingError('VALIDATION', 'ensureUser requires a verified sub and email')
  }
  return runners.withSuperadmin(async (tx: PoolClient) => {
    const res = await tx.query<{ id: string; inserted: boolean }>(
      `INSERT INTO users (id, email, full_name)
         VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             full_name = COALESCE(EXCLUDED.full_name, users.full_name),
             updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [identity.sub, identity.email, identity.fullName ?? null],
    )
    const row = res.rows[0]
    return { userId: row?.id ?? identity.sub, created: Boolean(row?.inserted) }
  })
}

// ---------------------------------------------------------------------------
// resolveMembership — the DbMembershipResolver's core lookup. Given a verified
// sub, return the user's PRIMARY (earliest-joined) workspace + role, or null.
// Cross-workspace read by user_id ⇒ withSuperadmin (sanctioned), but the SQL is
// scoped strictly to this user_id.
// ---------------------------------------------------------------------------
export async function resolveMembership(
  sub: string,
  runners: DbRunners = defaultRunners,
): Promise<ResolvedMembership | null> {
  if (!sub) return null // fail closed
  return runners.withSuperadmin(async (tx: PoolClient) => {
    const res = await tx.query<{
      workspace_id: string
      role: WorkspaceRoleString
      system_role: SystemRoleString
    }>(
      `SELECT wm.workspace_id, wm.role, u.system_role
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.user_id = $1
        ORDER BY wm.joined_at ASC
        LIMIT 1`,
      [sub],
    )
    const row = res.rows[0]
    if (!row) return null // no membership → caller routes to /onboarding
    return {
      workspaceId: row.workspace_id,
      workspaceRole: row.role,
      systemRole: row.system_role,
    }
  })
}

// ---------------------------------------------------------------------------
// listWorkspaces — all workspaces the verified user belongs to (multi-workspace).
// Used by workspace.list and to validate workspace.switch against REAL membership.
// ---------------------------------------------------------------------------
export async function listWorkspaces(
  sub: string,
  runners: DbRunners = defaultRunners,
): Promise<WorkspaceSummary[]> {
  if (!sub) return []
  return runners.withSuperadmin(async (tx: PoolClient) => {
    const res = await tx.query<{
      workspace_id: string
      slug: string
      name: string
      role: WorkspaceRoleString
    }>(
      `SELECT wm.workspace_id, w.slug, w.name, wm.role
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.user_id = $1
        ORDER BY wm.joined_at ASC`,
      [sub],
    )
    return res.rows.map((r) => ({
      workspaceId: r.workspace_id,
      slug: r.slug,
      name: r.name,
      role: r.role,
    }))
  })
}

// ---------------------------------------------------------------------------
// completeOnboarding — ONE transaction: upsert user, create workspace, create
// OWNER membership. Ports legacy onboarding /complete (minus the live Shopify/Woo
// OAuth connect, which is deferred to slice D — we persist the store handle only).
// Runs under withSuperadmin because the workspace row does not exist yet (no
// context to set). The slug-uniqueness check + insert are in the same tx.
// ---------------------------------------------------------------------------
export async function completeOnboarding(
  input: OnboardingInput,
  runners: DbRunners = defaultRunners,
): Promise<{ workspaceId: string; slug: string }> {
  if (!input.identity.sub || !input.identity.email) {
    throw new OnboardingError('VALIDATION', 'onboarding requires a verified sub and email')
  }
  if (!input.brandName.trim()) {
    throw new OnboardingError('VALIDATION', 'Brand name is required.')
  }
  const slug = normalizeSlug(input.slug)
  if (!slug) {
    throw new OnboardingError('VALIDATION', 'Workspace URL is required.')
  }
  if (!isValidSlug(slug)) {
    throw new OnboardingError(
      'SLUG_INVALID',
      'URL must start and end with a letter or number, and can only contain lowercase letters, numbers, and hyphens.',
    )
  }

  return runners.withSuperadmin(async (tx: PoolClient) => {
    // Slug uniqueness (inside the tx so the check + insert are atomic).
    const taken = await tx.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE slug = $1`,
      [slug],
    )
    if (taken.rows.length > 0) {
      throw new OnboardingError('SLUG_TAKEN', 'This workspace URL is already taken. Please choose another.')
    }

    // 1. Upsert the user (id = verified sub, email = verified JWT email).
    await tx.query(
      `INSERT INTO users (id, email, full_name, job_role)
         VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             full_name = COALESCE(EXCLUDED.full_name, users.full_name),
             job_role = COALESCE(EXCLUDED.job_role, users.job_role),
             updated_at = now()`,
      [
        input.identity.sub,
        input.identity.email,
        input.fullName.trim() || input.identity.fullName || null,
        input.jobRole.trim() || null,
      ],
    )

    // 2. Create the workspace. store_url = handle only (slice D wires live connect).
    const wsRes = await tx.query<{ id: string }>(
      `INSERT INTO workspaces (name, slug, industry, monthly_revenue, store_url, platform, created_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.brandName.trim(),
        slug,
        input.industry.trim() || null,
        input.monthlyRevenue.trim() || null,
        input.storeHandle?.trim() || null,
        input.platform,
        input.identity.sub,
      ],
    )
    const workspaceId = wsRes.rows[0]!.id

    // 3. Create the OWNER membership.
    await tx.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'OWNER')`,
      [workspaceId, input.identity.sub],
    )

    return { workspaceId, slug }
  })
}

// ---------------------------------------------------------------------------
// acceptInvitation — idempotent, RLS-scoped, role-mapped. Ports legacy invite
// accept. Lookup-by-token runs under withSuperadmin (the joining user is not yet
// a member, so no workspace context); the membership write runs under
// withWorkspace(invitation.workspace_id) — scoped to that one tenant.
// EDITOR→MANAGER role mapping applied via mapInvitationRole.
// ---------------------------------------------------------------------------
export type AcceptInvitationResult =
  | { status: 'accepted'; workspaceId: string; slug: string; role: WorkspaceRoleString }
  | { status: 'already_member'; workspaceId: string; slug: string }

export async function acceptInvitation(
  token: string,
  identity: VerifiedIdentity,
  runners: DbRunners = defaultRunners,
): Promise<AcceptInvitationResult> {
  if (!token) throw new OnboardingError('INVITATION_NOT_FOUND', 'Invalid invitation link')
  if (!identity.sub || !identity.email) {
    throw new OnboardingError('VALIDATION', 'accept requires a verified sub and email')
  }

  // Phase 1 (no-context lookup): find the invitation by its unguessable token,
  // ensure the user row exists, and decide the outcome. Cross-tenant by nature
  // (the joiner is not yet a member) ⇒ withSuperadmin, scoped to the exact token.
  const decision = await runners.withSuperadmin(async (tx: PoolClient) => {
    const invRes = await tx.query<{
      id: string
      workspace_id: string
      role: string
      status: string
      expires_at: Date
      slug: string
    }>(
      `SELECT i.id, i.workspace_id, i.role, i.status, i.expires_at, w.slug
         FROM invitations i
         JOIN workspaces w ON w.id = i.workspace_id
        WHERE i.token = $1`,
      [token],
    )
    const inv = invRes.rows[0]
    if (!inv) throw new OnboardingError('INVITATION_NOT_FOUND', 'Invalid invitation link')

    // Ensure the joining user exists (idempotent) BEFORE the membership check so the
    // already-member idempotency path works even for a non-PENDING invite.
    await tx.query(
      `INSERT INTO users (id, email, full_name)
         VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email, updated_at = now()`,
      [identity.sub, identity.email, identity.fullName ?? null],
    )

    // Already a member? (idempotent accept — checked FIRST so re-accepting a now-
    // ACCEPTED invite returns already_member instead of an error.)
    const memberRes = await tx.query<{ id: string }>(
      `SELECT id FROM workspace_members WHERE user_id = $1 AND workspace_id = $2`,
      [identity.sub, inv.workspace_id],
    )
    const alreadyMember = memberRes.rows.length > 0

    if (alreadyMember) {
      return {
        invitationId: inv.id,
        workspaceId: inv.workspace_id,
        slug: inv.slug,
        role: mapInvitationRole(inv.role),
        alreadyMember: true,
      }
    }

    // Not yet a member → the invite MUST be PENDING + unexpired to accept.
    if (inv.status !== 'PENDING') {
      throw new OnboardingError('INVITATION_NOT_PENDING', `This invitation has already been ${inv.status.toLowerCase()}`)
    }
    if (new Date() > new Date(inv.expires_at)) {
      await tx.query(`UPDATE invitations SET status = 'EXPIRED', updated_at = now() WHERE id = $1`, [inv.id])
      throw new OnboardingError('INVITATION_EXPIRED', 'This invitation has expired')
    }

    return {
      invitationId: inv.id,
      workspaceId: inv.workspace_id,
      slug: inv.slug,
      role: mapInvitationRole(inv.role), // EDITOR→MANAGER, rest 1:1
      alreadyMember: false,
    }
  })

  if (decision.alreadyMember) {
    // Mark the invite accepted (scoped to the workspace) and report already_member.
    await runners.withWorkspace(decision.workspaceId, async (tx: PoolClient) => {
      await tx.query(`UPDATE invitations SET status = 'ACCEPTED', updated_at = now() WHERE id = $1`, [decision.invitationId])
    })
    return { status: 'already_member', workspaceId: decision.workspaceId, slug: decision.slug }
  }

  // Phase 2 (scoped write): create the membership + mark accepted, both under the
  // invitation's workspace context. RLS now scopes every write to that one tenant.
  await runners.withWorkspace(decision.workspaceId, async (tx: PoolClient) => {
    await tx.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)`,
      [decision.workspaceId, identity.sub, decision.role],
    )
    await tx.query(`UPDATE invitations SET status = 'ACCEPTED', updated_at = now() WHERE id = $1`, [decision.invitationId])
  })

  return { status: 'accepted', workspaceId: decision.workspaceId, slug: decision.slug, role: decision.role }
}

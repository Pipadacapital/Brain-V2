/**
 * User-profile use-cases — getProfile / updateProfile / deleteAccount.
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * Profile fields live in public.users (id, email, full_name, avatar_url,
 * job_role, system_role). Email + system_role are NOT mutable here — email
 * is Supabase-managed; system_role is escalation-only via /admin.
 *
 * Password change and "sign out other sessions" are CLIENT-SIDE in Brain
 * (supabase.auth.updateUser / supabase.auth.signOut({scope:'others'})) — the
 * backend never sees the plaintext, never holds session state. This module
 * intentionally has no password endpoints.
 *
 * RLS posture: every query runs under withSuperadmin + explicit `id = $sub`
 * filter (CF-BN-OWNER-1 sanctioned no-workspace path) because the users row
 * is identity-scoped, not workspace-scoped.
 */

import type { PoolClient } from 'pg'
import { withSuperadmin } from '../../../infrastructure/db/workspace-context.js'

export interface AccountProfile {
  id: string
  email: string
  fullName: string
  avatarUrl: string | null
  jobRole: string
  createdAt: string
  /** Heuristic: a user is Google-managed if the email's domain ends in @gmail or
   *  their auth identity provider is google. We surface this so the UI hides
   *  the password panel for Google-only accounts. The backend has no source of
   *  truth for "provider"; the client knows from `supabase.auth.getUser()` and
   *  passes it through. We return `false` here as the conservative default and
   *  let the UI override based on the live auth.identity. */
  isGoogleAuth: boolean
}

export interface UpdateProfileInput {
  fullName?: string
  jobRole?: string
  avatarUrl?: string | null
}

export class UserProfileError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID' | 'OWNER_CONFLICT',
    msg: string,
  ) {
    super(msg)
    this.name = 'UserProfileError'
  }
}

export async function getProfile(userId: string): Promise<AccountProfile> {
  return withSuperadmin(async (tx: PoolClient) => {
    const res = await tx.query<{
      id: string
      email: string
      full_name: string | null
      avatar_url: string | null
      job_role: string | null
      created_at: Date
    }>(
      `SELECT id, email, full_name, avatar_url, job_role, created_at
         FROM public.users
        WHERE id = $1`,
      [userId],
    )
    const row = res.rows[0]
    if (!row) throw new UserProfileError('NOT_FOUND', 'user not found')
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name ?? '',
      avatarUrl: row.avatar_url,
      jobRole: row.job_role ?? '',
      createdAt: row.created_at.toISOString(),
      isGoogleAuth: false,                                      // UI overrides from supabase.auth
    }
  })
}

/**
 * Update mutable profile fields. Returns the new profile.
 * Validates lengths and trims whitespace; nulls are allowed for jobRole.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<AccountProfile> {
  const fullName = input.fullName?.trim()
  const jobRole  = input.jobRole?.trim() ?? ''
  const avatarUrl = input.avatarUrl ?? null

  if (fullName !== undefined && fullName.length === 0) {
    throw new UserProfileError('INVALID', 'full name cannot be empty')
  }
  if (fullName !== undefined && fullName.length > 200) {
    throw new UserProfileError('INVALID', 'full name too long (max 200)')
  }
  if (jobRole.length > 200) {
    throw new UserProfileError('INVALID', 'job role too long (max 200)')
  }

  return withSuperadmin(async (tx: PoolClient) => {
    // COALESCE keeps the existing value when the field isn't provided.
    const res = await tx.query<{
      id: string
      email: string
      full_name: string | null
      avatar_url: string | null
      job_role: string | null
      created_at: Date
    }>(
      `UPDATE public.users
          SET full_name  = COALESCE($2, full_name),
              job_role   = COALESCE($3, job_role),
              avatar_url = COALESCE($4, avatar_url),
              updated_at = now()
        WHERE id = $1
        RETURNING id, email, full_name, avatar_url, job_role, created_at`,
      [userId, fullName ?? null, input.jobRole === undefined ? null : jobRole, avatarUrl],
    )
    const row = res.rows[0]
    if (!row) throw new UserProfileError('NOT_FOUND', 'user not found')
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name ?? '',
      avatarUrl: row.avatar_url,
      jobRole: row.job_role ?? '',
      createdAt: row.created_at.toISOString(),
      isGoogleAuth: false,
    }
  })
}

/**
 * Delete the caller's account. Cascades:
 *   - workspace_members (FK ON DELETE CASCADE)
 *   - notifications (FK ON DELETE CASCADE)
 *   - audit_log (FK preserves row but nulls user_id via ON DELETE SET NULL)
 *   - invitations.invited_by (FK preserves row, nulls invited_by_id)
 *   - marketing_actions.created_by (ON DELETE SET NULL)
 *
 * BLOCKED if the user is the sole OWNER of a workspace that still has other
 * members (transferring ownership is out of scope here; surface a friendly
 * error and let the user resolve manually). Solo-owner of an empty workspace
 * is allowed — we delete the workspace too in that case.
 *
 * Supabase `auth.users` row is NOT touched by this endpoint; the client signs
 * out and Supabase eventually expires the JWT. Hard-deleting the auth row is
 * an admin operation (would require service-role key); deferred.
 */
export async function deleteAccount(userId: string): Promise<{ deletedWorkspaces: number }> {
  return withSuperadmin(async (tx: PoolClient) => {
    // 1) Identify workspaces where this user is the SOLE OWNER.
    const ownerRes = await tx.query<{ workspace_id: string; other_members: string }>(
      `WITH my_owned AS (
         SELECT workspace_id FROM public.workspace_members
          WHERE user_id = $1 AND role = 'OWNER'
       )
       SELECT mo.workspace_id,
              (SELECT count(*) FROM public.workspace_members wm
                WHERE wm.workspace_id = mo.workspace_id
                  AND wm.user_id != $1)::text AS other_members
         FROM my_owned mo`,
      [userId],
    )
    const conflicts = ownerRes.rows.filter((r) => Number(r.other_members) > 0)
    if (conflicts.length > 0) {
      throw new UserProfileError(
        'OWNER_CONFLICT',
        `cannot delete account — you are the sole OWNER of ${conflicts.length} workspace(s) with other members. Transfer ownership first.`,
      )
    }
    // 2) Delete the empty solo-owned workspaces (cascades members/invites/facts).
    const wsToDelete = ownerRes.rows.map((r) => r.workspace_id)
    let deletedWorkspaces = 0
    if (wsToDelete.length > 0) {
      const delRes = await tx.query(
        `DELETE FROM public.workspaces WHERE id = ANY($1::uuid[])`,
        [wsToDelete],
      )
      deletedWorkspaces = delRes.rowCount ?? 0
    }
    // 3) Delete the user row (cascades the remaining memberships + notifications).
    await tx.query(`DELETE FROM public.users WHERE id = $1`, [userId])
    return { deletedWorkspaces }
  })
}

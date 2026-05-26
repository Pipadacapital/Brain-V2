/**
 * Notifications use-cases — list, mark-read, mark-all-read, unread-count.
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * Notifications are USER-scoped (per `user_id`), with an optional `workspace_id`
 * scope (so a user only sees the notifications for the workspace they're in OR
 * global notifications for them). RLS-safe via withSuperadmin + explicit user-id
 * filter (CF-BN-OWNER-1 sanctioned no-workspace path): notifications belong to
 * the authenticated USER, not to a tenant, and a user can be in multiple
 * workspaces — narrowing by `app.workspace_id` would hide cross-workspace
 * notifications they're entitled to see.
 *
 * The gateway passes the verified `sub` (= public.users.id) from the JWT. Every
 * query filters by `user_id = $sub` so a compromised superadmin context CAN'T
 * leak someone else's notifications — the SQL itself is scoped.
 *
 * Optional workspace narrowing (?workspaceId=…) limits to notifications for that
 * tenant + globals (workspace_id IS NULL); leave it null to get everything.
 */

import type { PoolClient } from 'pg'
import { withSuperadmin } from '../../infrastructure/db/workspace-context.js'

export interface NotificationItem {
  id: string
  userId: string
  workspaceId: string | null
  type: string
  title: string
  body: string | null
  actionUrl: string | null
  read: boolean
  metadata: Record<string, unknown>
  createdAt: string
  readAt: string | null
}

export interface ListOptions {
  filter?: 'all' | 'unread'
  workspaceId?: string | null
  limit?: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function listNotifications(
  userId: string,
  opts: ListOptions = {},
): Promise<NotificationItem[]> {
  const filter = opts.filter ?? 'all'
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  return withSuperadmin(async (tx: PoolClient) => {
    // Cast type::text since the local enum value doesn't round-trip to a JS
    // string otherwise (node-postgres returns enums as strings only when the
    // column type is registered; safer to cast).
    const res = await tx.query<{
      id: string
      user_id: string
      workspace_id: string | null
      type: string
      title: string
      body: string | null
      action_url: string | null
      read: boolean
      metadata: Record<string, unknown>
      created_at: Date
      read_at: Date | null
    }>(
      `SELECT id, user_id, workspace_id, type::text, title, body, action_url,
              read, metadata, created_at, read_at
         FROM public.notifications
        WHERE user_id = $1
          AND ($2::uuid IS NULL OR workspace_id = $2::uuid OR workspace_id IS NULL)
          AND ($3::boolean = false OR read = false)
        ORDER BY created_at DESC
        LIMIT $4`,
      [userId, opts.workspaceId ?? null, filter === 'unread', limit],
    )
    return res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      workspaceId: r.workspace_id,
      type: r.type,
      title: r.title,
      body: r.body,
      actionUrl: r.action_url,
      read: r.read,
      metadata: r.metadata ?? {},
      createdAt: r.created_at.toISOString(),
      readAt: r.read_at ? r.read_at.toISOString() : null,
    }))
  })
}

export async function getUnreadCount(
  userId: string,
  workspaceId?: string | null,
): Promise<number> {
  return withSuperadmin(async (tx: PoolClient) => {
    const res = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM public.notifications
        WHERE user_id = $1
          AND read = false
          AND ($2::uuid IS NULL OR workspace_id = $2::uuid OR workspace_id IS NULL)`,
      [userId, workspaceId ?? null],
    )
    return Number(res.rows[0]?.n ?? '0')
  })
}

/**
 * Mark one notification read. Returns true if it was unread and is now read,
 * false if it was already read or did not exist / does not belong to the caller.
 */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<boolean> {
  return withSuperadmin(async (tx: PoolClient) => {
    const res = await tx.query(
      `UPDATE public.notifications
          SET read = true, read_at = now()
        WHERE id = $1 AND user_id = $2 AND read = false`,
      [notificationId, userId],
    )
    return (res.rowCount ?? 0) > 0
  })
}

/**
 * Mark every unread notification for this user (optionally narrowed to a
 * workspace) as read. Returns the count of newly-read rows.
 */
export async function markAllNotificationsRead(
  userId: string,
  workspaceId?: string | null,
): Promise<number> {
  return withSuperadmin(async (tx: PoolClient) => {
    const res = await tx.query(
      `UPDATE public.notifications
          SET read = true, read_at = now()
        WHERE user_id = $1
          AND read = false
          AND ($2::uuid IS NULL OR workspace_id = $2::uuid OR workspace_id IS NULL)`,
      [userId, workspaceId ?? null],
    )
    return res.rowCount ?? 0
  })
}

/**
 * Platform-admin (SUPERADMIN) application use-cases.
 *
 * @paradigm sql (deterministic cross-tenant reads; no ML, no LLM)
 *
 * These power the /admin SUPERADMIN suite (cross-workspace user/workspace/connection
 * directories). They are the ONE sanctioned place in Brain where a read deliberately
 * spans every tenant — so the authorization gate is load-bearing and lives OUTSIDE
 * this module: the gateway's `superadminProc` asserts `claim.systemRole === 'SUPERADMIN'`
 * before any of these run. A non-superadmin can never reach this code path.
 *
 * RLS posture: each query runs under `withSuperadmin` (the sanctioned no-context /
 * cross-workspace primitive — same one onboarding's resolveMembership/listWorkspaces
 * already use). Unlike those, an admin read INTENTIONALLY returns every row — that is
 * the feature, gated by systemRole at the wire. Single-Primitive Rule preserved: NO
 * second pool, NO second transaction shape.
 *
 * Money/PII discipline: these directories carry NO money fields and NO secrets — only
 * non-secret connection metadata (vendor, status, account_ref, sync timestamps), the
 * same NON-secret columns connector_connections exposes elsewhere.
 */

import type { PoolClient } from 'pg'
import { packageLogger } from '@brain/lib-logger'
import { withWorkspace, withSuperadmin } from '../../../infrastructure/db/workspace-context.js'
import type { SystemRoleString } from '../../../domain/auth/brain-claim.js'

// Per-package logger — every line carries package: 'core-admin' so an on-call can
// see WHICH package emitted inside the api-gateway service (in-process Phase-0).
const log = packageLogger('api-gateway', 'core-admin')

// Allow the DB runner to be injected for unit tests (defaults to the real primitive).
export interface DbRunners {
  withWorkspace: typeof withWorkspace
  withSuperadmin: typeof withSuperadmin
}

const defaultRunners: DbRunners = { withWorkspace, withSuperadmin }

// ---------------------------------------------------------------------------
// Result shapes (camelCase; ISO strings for timestamps so the wire is JSON-clean).
// ---------------------------------------------------------------------------

export interface AdminUserRow {
  id: string
  email: string
  fullName: string | null
  systemRole: SystemRoleString
  membershipCount: number
  createdAt: string
}

export interface AdminWorkspaceRow {
  id: string
  name: string
  slug: string
  /** Brain has no plan-tier concept yet → null (rendered as "—", never fabricated). */
  plan: string | null
  memberCount: number
  shopifyCount: number
  hasGoogleAds: boolean
  hasMeta: boolean
  createdAt: string
}

export interface AdminConnectionRow {
  connectionId: string
  vendor: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  status: string
  accountRef: string | null
  lastSyncAt: string | null
  lastSyncError: string | null
}

// ---------------------------------------------------------------------------
// listAllUsers — every user in the system, with membership counts.
// Cross-tenant by definition (no user_id filter) ⇒ withSuperadmin. Gated upstream.
// ---------------------------------------------------------------------------
export async function listAllUsers(
  runners: DbRunners = defaultRunners,
): Promise<AdminUserRow[]> {
  const fn = 'listAllUsers'
  const t0 = Date.now()
  try {
    const out = await runners.withSuperadmin(async (tx: PoolClient) => {
      const res = await tx.query<{
        id: string
        email: string
        full_name: string | null
        system_role: SystemRoleString
        membership_count: string
        created_at: Date
      }>(
        `SELECT u.id,
                u.email,
                u.full_name,
                u.system_role,
                (SELECT COUNT(*) FROM workspace_members wm WHERE wm.user_id = u.id) AS membership_count,
                u.created_at
           FROM users u
          ORDER BY u.created_at DESC`,
      )
      return res.rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        systemRole: r.system_role,
        membershipCount: Number(r.membership_count),
        createdAt: r.created_at.toISOString(),
      }))
    })
    log.debug({ fn, count: out.length, duration_ms: Date.now() - t0 }, 'listAllUsers done')
    return out
  } catch (err) {
    log.error({ fn, err, duration_ms: Date.now() - t0 }, 'listAllUsers failed')
    throw err
  }
}

// ---------------------------------------------------------------------------
// listAllWorkspaces — every workspace, with member + connector counts.
// Scalar subqueries (not joins) so member/connection counts don't fan out rows.
// ---------------------------------------------------------------------------
export async function listAllWorkspaces(
  runners: DbRunners = defaultRunners,
): Promise<AdminWorkspaceRow[]> {
  const fn = 'listAllWorkspaces'
  const t0 = Date.now()
  try {
    const out = await runners.withSuperadmin(async (tx: PoolClient) => {
      const res = await tx.query<{
        id: string
        name: string
        slug: string
        member_count: string
        shopify_count: string
        has_google: boolean
        has_meta: boolean
        created_at: Date
      }>(
        `SELECT w.id,
                w.name,
                w.slug,
                (SELECT COUNT(*) FROM workspace_members wm
                  WHERE wm.workspace_id = w.id) AS member_count,
                (SELECT COUNT(*) FROM connector_connections cc
                  WHERE cc.workspace_id = w.id AND cc.vendor = 'SHOPIFY'
                    AND cc.status = 'CONNECTED') AS shopify_count,
                EXISTS (SELECT 1 FROM connector_connections cc
                         WHERE cc.workspace_id = w.id AND cc.vendor = 'GOOGLE'
                           AND cc.status = 'CONNECTED') AS has_google,
                EXISTS (SELECT 1 FROM connector_connections cc
                         WHERE cc.workspace_id = w.id AND cc.vendor = 'META'
                           AND cc.status = 'CONNECTED') AS has_meta,
                w.created_at
           FROM workspaces w
          ORDER BY w.created_at DESC`,
      )
      return res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        plan: null, // Brain has no plan-tier column — honest null, never fabricated.
        memberCount: Number(r.member_count),
        shopifyCount: Number(r.shopify_count),
        hasGoogleAds: r.has_google,
        hasMeta: r.has_meta,
        createdAt: r.created_at.toISOString(),
      }))
    })
    log.debug({ fn, count: out.length, duration_ms: Date.now() - t0 }, 'listAllWorkspaces done')
    return out
  } catch (err) {
    log.error({ fn, err, duration_ms: Date.now() - t0 }, 'listAllWorkspaces failed')
    throw err
  }
}

// ---------------------------------------------------------------------------
// listAllConnections — every CONNECTED connector across all tenants, for the
// /admin/sync console's per-vendor workspace lists. READ-ONLY: the sync TRIGGERS
// stay disabled while connector cutover is HELD (no live ingestion path yet), so
// this surface is honest — it shows what's connected, not a working fan-out sync.
// ---------------------------------------------------------------------------
export async function listAllConnections(
  runners: DbRunners = defaultRunners,
): Promise<AdminConnectionRow[]> {
  const fn = 'listAllConnections'
  const t0 = Date.now()
  try {
    const out = await runners.withSuperadmin(async (tx: PoolClient) => {
      const res = await tx.query<{
        id: string
        vendor: string
        workspace_id: string
        name: string
        slug: string
        status: string
        account_ref: string | null
        last_sync_at: Date | null
        last_sync_error: string | null
      }>(
        `SELECT cc.id,
                cc.vendor,
                cc.workspace_id,
                w.name,
                w.slug,
                cc.status,
                cc.account_ref,
                cc.last_sync_at,
                cc.last_sync_error
           FROM connector_connections cc
           JOIN workspaces w ON w.id = cc.workspace_id
          WHERE cc.status = 'CONNECTED'
          ORDER BY cc.vendor ASC, w.name ASC`,
      )
      return res.rows.map((r) => ({
        connectionId: r.id,
        vendor: r.vendor,
        workspaceId: r.workspace_id,
        workspaceName: r.name,
        workspaceSlug: r.slug,
        status: r.status,
        accountRef: r.account_ref,
        lastSyncAt: r.last_sync_at ? r.last_sync_at.toISOString() : null,
        lastSyncError: r.last_sync_error,
      }))
    })
    log.debug({ fn, count: out.length, duration_ms: Date.now() - t0 }, 'listAllConnections done')
    return out
  } catch (err) {
    log.error({ fn, err, duration_ms: Date.now() - t0 }, 'listAllConnections failed')
    throw err
  }
}

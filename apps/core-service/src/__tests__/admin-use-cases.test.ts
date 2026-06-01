/**
 * Unit tests for the platform-admin (SUPERADMIN) cross-tenant read use-cases.
 *
 * Positive AND negative scenarios per the coverage standard. The DB primitive is
 * injected as a mock runner so these are pure logic tests (no live DB). They assert:
 *   - the correct row→camelCase mapping (incl. count string→Number, Date→ISO)
 *   - that EVERY query runs under the `superadmin` primitive (cross-tenant is the
 *     whole point — but the authz gate is the gateway's superadminProc, tested there)
 *   - honest empties (no rows → []) and honest plan=null (Brain has no plan tier)
 *   - errors propagate (fail-loud) — never swallowed into a partial/empty result
 */

import { describe, it, expect, vi } from 'vitest'
import type { PoolClient } from 'pg'
import {
  listAllUsers,
  listAllWorkspaces,
  listAllConnections,
  type DbRunners,
} from '../application/contexts/admin/admin-use-cases.js'

function makeRunners(handlers: { match: RegExp; rows: unknown[] }[]): {
  runners: DbRunners
  queries: { text: string; mode: 'workspace' | 'superadmin' }[]
} {
  const queries: { text: string; mode: 'workspace' | 'superadmin' }[] = []
  function makeTx(mode: 'workspace' | 'superadmin'): PoolClient {
    return {
      query: vi.fn(async (text: string) => {
        queries.push({ text, mode })
        const h = handlers.find((x) => x.match.test(text))
        return { rows: h ? h.rows : [], rowCount: h ? h.rows.length : 0 }
      }),
    } as unknown as PoolClient
  }
  const runners: DbRunners = {
    withWorkspace: (async (_ws: string, fn: (tx: PoolClient) => Promise<unknown>) =>
      fn(makeTx('workspace'))) as DbRunners['withWorkspace'],
    withSuperadmin: (async (fn: (tx: PoolClient) => Promise<unknown>) =>
      fn(makeTx('superadmin'))) as DbRunners['withSuperadmin'],
  }
  return { runners, queries }
}

const ISO = '2026-03-01T00:00:00.000Z'

describe('listAllUsers', () => {
  it('(+) maps every user row, coerces count, ISO-formats createdAt', async () => {
    const { runners, queries } = makeRunners([
      {
        match: /FROM users u/,
        rows: [
          {
            id: 'u1',
            email: 'a@brand.com',
            full_name: 'Aarti',
            system_role: 'SUPERADMIN',
            membership_count: '3',
            created_at: new Date(ISO),
          },
          {
            id: 'u2',
            email: 'b@brand.com',
            full_name: null,
            system_role: 'USER',
            membership_count: '0',
            created_at: new Date(ISO),
          },
        ],
      },
    ])
    const out = await listAllUsers(runners)
    expect(out).toEqual([
      { id: 'u1', email: 'a@brand.com', fullName: 'Aarti', systemRole: 'SUPERADMIN', membershipCount: 3, createdAt: ISO },
      { id: 'u2', email: 'b@brand.com', fullName: null, systemRole: 'USER', membershipCount: 0, createdAt: ISO },
    ])
    // cross-tenant read MUST run under the superadmin primitive
    expect(queries.every((q) => q.mode === 'superadmin')).toBe(true)
  })

  it('(-) returns [] when there are no users (honest empty)', async () => {
    const { runners } = makeRunners([])
    expect(await listAllUsers(runners)).toEqual([])
  })

  it('(-) propagates a DB error (never swallows into empty)', async () => {
    const runners: DbRunners = {
      withWorkspace: (async () => undefined) as DbRunners['withWorkspace'],
      withSuperadmin: (async () => {
        throw new Error('db down')
      }) as DbRunners['withSuperadmin'],
    }
    await expect(listAllUsers(runners)).rejects.toThrow('db down')
  })
})

describe('listAllWorkspaces', () => {
  it('(+) maps rows, plan is null (no fabrication), counts coerced, booleans preserved', async () => {
    const { runners, queries } = makeRunners([
      {
        match: /FROM workspaces w/,
        rows: [
          {
            id: 'w1',
            name: 'Sugandh Lok',
            slug: 'sugandh-lok',
            member_count: '5',
            shopify_count: '1',
            has_google: true,
            has_meta: false,
            created_at: new Date(ISO),
          },
        ],
      },
    ])
    const out = await listAllWorkspaces(runners)
    expect(out).toEqual([
      {
        id: 'w1',
        name: 'Sugandh Lok',
        slug: 'sugandh-lok',
        plan: null,
        memberCount: 5,
        shopifyCount: 1,
        hasGoogleAds: true,
        hasMeta: false,
        createdAt: ISO,
      },
    ])
    expect(queries.every((q) => q.mode === 'superadmin')).toBe(true)
  })

  it('(-) returns [] when there are no workspaces', async () => {
    const { runners } = makeRunners([])
    expect(await listAllWorkspaces(runners)).toEqual([])
  })
})

describe('listAllConnections', () => {
  it('(+) maps connected rows, null-safe lastSyncAt, superadmin mode', async () => {
    const { runners, queries } = makeRunners([
      {
        match: /FROM connector_connections cc/,
        rows: [
          {
            id: 'c1',
            vendor: 'SHOPIFY',
            workspace_id: 'w1',
            name: 'Sugandh Lok',
            slug: 'sugandh-lok',
            status: 'CONNECTED',
            account_ref: 'sugandh.myshopify.com',
            last_sync_at: new Date(ISO),
            last_sync_error: null,
          },
          {
            id: 'c2',
            vendor: 'GOOGLE',
            workspace_id: 'w1',
            name: 'Sugandh Lok',
            slug: 'sugandh-lok',
            status: 'CONNECTED',
            account_ref: '123-456',
            last_sync_at: null,
            last_sync_error: 'never synced',
          },
        ],
      },
    ])
    const out = await listAllConnections(runners)
    expect(out).toEqual([
      {
        connectionId: 'c1',
        vendor: 'SHOPIFY',
        workspaceId: 'w1',
        workspaceName: 'Sugandh Lok',
        workspaceSlug: 'sugandh-lok',
        status: 'CONNECTED',
        accountRef: 'sugandh.myshopify.com',
        lastSyncAt: ISO,
        lastSyncError: null,
      },
      {
        connectionId: 'c2',
        vendor: 'GOOGLE',
        workspaceId: 'w1',
        workspaceName: 'Sugandh Lok',
        workspaceSlug: 'sugandh-lok',
        status: 'CONNECTED',
        accountRef: '123-456',
        lastSyncAt: null,
        lastSyncError: 'never synced',
      },
    ])
    expect(queries.every((q) => q.mode === 'superadmin')).toBe(true)
  })

  it('(-) returns [] when nothing is connected', async () => {
    const { runners } = makeRunners([])
    expect(await listAllConnections(runners)).toEqual([])
  })
})

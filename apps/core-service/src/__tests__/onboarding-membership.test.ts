/**
 * Slice C — unit tests for the onboarding/membership domain + use-cases.
 *
 * Positive AND negative scenarios per the coverage standard. The DB primitive is
 * injected as a mock runner so these are pure logic tests (no live DB). The real
 * RLS/wire behavior is proven in integration/onboarding-rls.integration.test.ts.
 */

import { describe, it, expect, vi } from 'vitest'
import type { PoolClient } from 'pg'
import {
  isValidSlug,
  normalizeSlug,
  mapInvitationRole,
} from '../domain/onboarding/membership.js'
import {
  ensureUser,
  resolveMembership,
  listWorkspaces,
  completeOnboarding,
  acceptInvitation,
  OnboardingError,
  type DbRunners,
} from '../application/onboarding/onboarding-use-cases.js'

// ---------------------------------------------------------------------------
// Mock DB runners — capture queries; return scripted rows per query text.
// ---------------------------------------------------------------------------

function makeRunners(handlers: { match: RegExp; rows: unknown[] }[]): {
  runners: DbRunners
  queries: { text: string; params?: unknown[]; mode: 'workspace' | 'superadmin' }[]
} {
  const queries: { text: string; params?: unknown[]; mode: 'workspace' | 'superadmin' }[] = []

  function makeTx(mode: 'workspace' | 'superadmin'): PoolClient {
    return {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        queries.push({ text, params, mode })
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

// ===========================================================================
// Domain — slug validation
// ===========================================================================
describe('slug validation', () => {
  it('(+) accepts lowercase alnum + hyphen', () => {
    expect(isValidSlug('sugandh-lok')).toBe(true)
    expect(isValidSlug('brand123')).toBe(true)
    expect(isValidSlug('a1')).toBe(true)
  })
  it('(-) rejects uppercase, spaces, leading/trailing hyphen, empty', () => {
    expect(isValidSlug('Sugandh')).toBe(false)
    expect(isValidSlug('has space')).toBe(false)
    expect(isValidSlug('-lead')).toBe(false)
    expect(isValidSlug('trail-')).toBe(false)
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug('under_score')).toBe(false)
  })
  it('(+) normalizeSlug trims + lowercases', () => {
    expect(normalizeSlug('  Brand-A  ')).toBe('brand-a')
  })
})

// ===========================================================================
// Domain — invitation role mapping (EDITOR→MANAGER, rest 1:1)
// ===========================================================================
describe('mapInvitationRole', () => {
  it('(+) folds legacy EDITOR to MANAGER', () => {
    expect(mapInvitationRole('EDITOR')).toBe('MANAGER')
  })
  it('(+) passes the 5 Brain roles through 1:1', () => {
    for (const r of ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as const) {
      expect(mapInvitationRole(r)).toBe(r)
    }
  })
  it('(-) throws on an unknown role (fail-closed, never a default grant)', () => {
    expect(() => mapInvitationRole('SUPERUSER')).toThrow('Unknown invitation role')
  })
})

// ===========================================================================
// ensureUser
// ===========================================================================
describe('ensureUser', () => {
  it('(+) upserts via withSuperadmin and reports created=true on insert', async () => {
    const { runners, queries } = makeRunners([
      { match: /INSERT INTO users/i, rows: [{ id: 'sub-1', inserted: true }] },
    ])
    const out = await ensureUser({ sub: 'sub-1', email: 'a@b.test' }, runners)
    expect(out).toEqual({ userId: 'sub-1', created: true })
    expect(queries[0]?.mode).toBe('superadmin')
    expect(queries[0]?.text).toMatch(/INSERT INTO users/i)
  })
  it('(-) throws on missing sub/email (fail-closed validation)', async () => {
    const { runners } = makeRunners([])
    await expect(ensureUser({ sub: '', email: 'a@b.test' }, runners)).rejects.toThrow(OnboardingError)
    await expect(ensureUser({ sub: 's', email: '' }, runners)).rejects.toThrow(OnboardingError)
  })
})

// ===========================================================================
// resolveMembership — the DbMembershipResolver core
// ===========================================================================
describe('resolveMembership', () => {
  it('(+) returns the primary workspace + role for a member', async () => {
    const { runners, queries } = makeRunners([
      {
        match: /FROM workspace_members wm\s+JOIN users/i,
        rows: [{ workspace_id: 'ws-1', role: 'OWNER', system_role: 'USER' }],
      },
    ])
    const out = await resolveMembership('sub-1', runners)
    expect(out).toEqual({ workspaceId: 'ws-1', workspaceRole: 'OWNER', systemRole: 'USER' })
    // Cross-workspace read MUST run under superadmin (the sanctioned path), scoped by user_id.
    expect(queries[0]?.mode).toBe('superadmin')
    expect(queries[0]?.params).toContain('sub-1')
  })
  it('(+) returns null for a user with NO membership (caller routes to /onboarding)', async () => {
    const { runners } = makeRunners([{ match: /workspace_members/i, rows: [] }])
    expect(await resolveMembership('sub-x', runners)).toBeNull()
  })
  it('(-) returns null for an empty sub (fail-closed, no DB hit)', async () => {
    const { runners, queries } = makeRunners([])
    expect(await resolveMembership('', runners)).toBeNull()
    expect(queries).toHaveLength(0)
  })
})

// ===========================================================================
// listWorkspaces
// ===========================================================================
describe('listWorkspaces', () => {
  it('(+) returns every membership for the user (multi-workspace)', async () => {
    const { runners } = makeRunners([
      {
        match: /FROM workspace_members wm\s+JOIN workspaces/i,
        rows: [
          { workspace_id: 'ws-1', slug: 'a', name: 'A', role: 'OWNER' },
          { workspace_id: 'ws-2', slug: 'b', name: 'B', role: 'MANAGER' },
        ],
      },
    ])
    const out = await listWorkspaces('sub-1', runners)
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({ workspaceId: 'ws-2', slug: 'b', name: 'B', role: 'MANAGER' })
  })
  it('(+) returns [] for empty sub', async () => {
    const { runners } = makeRunners([])
    expect(await listWorkspaces('', runners)).toEqual([])
  })
})

// ===========================================================================
// completeOnboarding
// ===========================================================================
describe('completeOnboarding', () => {
  const base = {
    identity: { sub: 'sub-1', email: 'owner@brand.test' },
    fullName: 'Owner',
    jobRole: 'Founder',
    brandName: 'Brand A',
    slug: 'brand-a',
    industry: 'Beauty',
    monthlyRevenue: '10L',
    platform: 'SHOPIFY' as const,
    storeHandle: 'brand-a',
  }

  it('(+) creates user + workspace + OWNER membership in ONE superadmin transaction', async () => {
    const { runners, queries } = makeRunners([
      { match: /SELECT id FROM workspaces WHERE slug/i, rows: [] }, // slug free
      { match: /INSERT INTO workspaces/i, rows: [{ id: 'new-ws' }] },
    ])
    const out = await completeOnboarding(base, runners)
    expect(out).toEqual({ workspaceId: 'new-ws', slug: 'brand-a' })
    // All three writes ran under the SAME superadmin transaction.
    expect(queries.every((q) => q.mode === 'superadmin')).toBe(true)
    expect(queries.some((q) => /INSERT INTO users/i.test(q.text))).toBe(true)
    expect(queries.some((q) => /INSERT INTO workspaces/i.test(q.text))).toBe(true)
    expect(queries.some((q) => /INSERT INTO workspace_members/i.test(q.text) && /'OWNER'/.test(q.text))).toBe(true)
  })

  it('(-) rejects an invalid slug', async () => {
    const { runners } = makeRunners([])
    await expect(completeOnboarding({ ...base, slug: 'Bad Slug' }, runners)).rejects.toMatchObject({
      code: 'SLUG_INVALID',
    })
  })

  it('(-) rejects a taken slug (uniqueness inside the tx)', async () => {
    const { runners } = makeRunners([
      { match: /SELECT id FROM workspaces WHERE slug/i, rows: [{ id: 'existing' }] },
    ])
    await expect(completeOnboarding(base, runners)).rejects.toMatchObject({ code: 'SLUG_TAKEN' })
  })

  it('(-) rejects empty brand name', async () => {
    const { runners } = makeRunners([])
    await expect(completeOnboarding({ ...base, brandName: '   ' }, runners)).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  it('(-) rejects missing verified identity', async () => {
    const { runners } = makeRunners([])
    await expect(
      completeOnboarding({ ...base, identity: { sub: '', email: '' } }, runners),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

// ===========================================================================
// acceptInvitation
// ===========================================================================
describe('acceptInvitation', () => {
  const identity = { sub: 'joiner-1', email: 'joiner@brand.test' }

  it('(+) accepts a PENDING invite: creates membership (role-mapped) + marks accepted', async () => {
    const future = new Date(Date.now() + 3600_000)
    const { runners, queries } = makeRunners([
      {
        match: /FROM invitations i\s+JOIN workspaces/i,
        rows: [{ id: 'inv-1', workspace_id: 'ws-1', role: 'EDITOR', status: 'PENDING', expires_at: future, slug: 'brand-a' }],
      },
      { match: /SELECT id FROM workspace_members WHERE user_id/i, rows: [] }, // not yet a member
    ])
    const out = await acceptInvitation('tok-1', identity, runners)
    expect(out).toMatchObject({ status: 'accepted', workspaceId: 'ws-1', slug: 'brand-a', role: 'MANAGER' })
    // Role was mapped EDITOR→MANAGER and the membership write ran under withWorkspace.
    const memberInsert = queries.find((q) => /INSERT INTO workspace_members/i.test(q.text))
    expect(memberInsert?.mode).toBe('workspace')
    expect(memberInsert?.params).toContain('MANAGER')
  })

  it('(+) idempotent: an already-member returns already_member without a second insert', async () => {
    const future = new Date(Date.now() + 3600_000)
    const { runners, queries } = makeRunners([
      {
        match: /FROM invitations i\s+JOIN workspaces/i,
        rows: [{ id: 'inv-1', workspace_id: 'ws-1', role: 'VIEWER', status: 'PENDING', expires_at: future, slug: 'brand-a' }],
      },
      { match: /SELECT id FROM workspace_members WHERE user_id/i, rows: [{ id: 'existing-member' }] },
    ])
    const out = await acceptInvitation('tok-1', identity, runners)
    expect(out.status).toBe('already_member')
    expect(queries.some((q) => /INSERT INTO workspace_members/i.test(q.text))).toBe(false)
  })

  it('(-) NOT_FOUND for an unknown token', async () => {
    const { runners } = makeRunners([{ match: /FROM invitations i/i, rows: [] }])
    await expect(acceptInvitation('nope', identity, runners)).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND',
    })
  })

  it('(-) CONFLICT for a non-PENDING invite', async () => {
    const future = new Date(Date.now() + 3600_000)
    const { runners } = makeRunners([
      {
        match: /FROM invitations i/i,
        rows: [{ id: 'inv-1', workspace_id: 'ws-1', role: 'VIEWER', status: 'ACCEPTED', expires_at: future, slug: 'a' }],
      },
    ])
    await expect(acceptInvitation('tok-1', identity, runners)).rejects.toMatchObject({
      code: 'INVITATION_NOT_PENDING',
    })
  })

  it('(-) EXPIRED for a past-expiry invite (and marks it EXPIRED)', async () => {
    const past = new Date(Date.now() - 3600_000)
    const { runners, queries } = makeRunners([
      {
        match: /FROM invitations i/i,
        rows: [{ id: 'inv-1', workspace_id: 'ws-1', role: 'VIEWER', status: 'PENDING', expires_at: past, slug: 'a' }],
      },
    ])
    await expect(acceptInvitation('tok-1', identity, runners)).rejects.toMatchObject({
      code: 'INVITATION_EXPIRED',
    })
    expect(queries.some((q) => /UPDATE invitations SET status = 'EXPIRED'/i.test(q.text))).toBe(true)
  })
})

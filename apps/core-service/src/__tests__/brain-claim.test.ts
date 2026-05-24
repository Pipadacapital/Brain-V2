/**
 * Track T — Unit tests for brain-claim.ts (Track E)
 *
 * Covers positive AND negative scenarios per the coverage standard.
 * Mutation testing targets:
 *   - requireRole >= comparison (flip to > must fail test)
 *   - assembleClaim level assignment
 */

import { describe, it, expect } from 'vitest'
import {
  assembleClaim,
  requireRole,
  assertRole,
  WORKSPACE_ROLE_LEVEL,
  type BrainClaim,
  type WorkspaceRoleString,
} from '../domain/auth/brain-claim.js'

const makeClaim = (role: WorkspaceRoleString): BrainClaim =>
  assembleClaim({
    userId: '00000000-0000-0000-0000-000000000001',
    workspaceId: 'aaaaaaaa-0000-0000-0000-000000000001',
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-1',
    traceId: 'trace-1',
  })

describe('WORKSPACE_ROLE_LEVEL ordering', () => {
  it('OWNER(5) > ADMIN(4) > MANAGER(3) > ANALYST(2) > VIEWER(1)', () => {
    expect(WORKSPACE_ROLE_LEVEL.OWNER).toBe(5)
    expect(WORKSPACE_ROLE_LEVEL.ADMIN).toBe(4)
    expect(WORKSPACE_ROLE_LEVEL.MANAGER).toBe(3)
    expect(WORKSPACE_ROLE_LEVEL.ANALYST).toBe(2)
    expect(WORKSPACE_ROLE_LEVEL.VIEWER).toBe(1)
    // Ordering asserts
    expect(WORKSPACE_ROLE_LEVEL.OWNER).toBeGreaterThan(WORKSPACE_ROLE_LEVEL.ADMIN)
    expect(WORKSPACE_ROLE_LEVEL.ADMIN).toBeGreaterThan(WORKSPACE_ROLE_LEVEL.MANAGER)
    expect(WORKSPACE_ROLE_LEVEL.MANAGER).toBeGreaterThan(WORKSPACE_ROLE_LEVEL.ANALYST)
    expect(WORKSPACE_ROLE_LEVEL.ANALYST).toBeGreaterThan(WORKSPACE_ROLE_LEVEL.VIEWER)
  })
})

describe('assembleClaim()', () => {
  it('(+) assembles a BrainClaim with correct level for OWNER', () => {
    const claim = makeClaim('OWNER')
    expect(claim.workspaceRole).toBe('OWNER')
    expect(claim.workspaceRoleLevel).toBe(5)
    expect(claim.userId).toBe('00000000-0000-0000-0000-000000000001')
    expect(claim.requestId).toBe('req-1')
    expect(claim.traceId).toBe('trace-1')
  })

  it('(+) assembles correct level for VIEWER', () => {
    const claim = makeClaim('VIEWER')
    expect(claim.workspaceRoleLevel).toBe(1)
  })

  it('(+) all 5 roles produce distinct levels', () => {
    const roles: WorkspaceRoleString[] = ['OWNER','ADMIN','MANAGER','ANALYST','VIEWER']
    const levels = roles.map((r) => makeClaim(r).workspaceRoleLevel)
    const unique = new Set(levels)
    expect(unique.size).toBe(5)
  })
})

describe('requireRole()', () => {
  it('(+) OWNER >= ADMIN passes', () => {
    expect(requireRole(makeClaim('OWNER'), 'ADMIN')).toBe(true)
  })

  it('(+) OWNER >= OWNER passes (same level)', () => {
    expect(requireRole(makeClaim('OWNER'), 'OWNER')).toBe(true)
  })

  it('(+) ADMIN >= ADMIN passes', () => {
    expect(requireRole(makeClaim('ADMIN'), 'ADMIN')).toBe(true)
  })

  it('(+) MANAGER >= VIEWER passes', () => {
    expect(requireRole(makeClaim('MANAGER'), 'VIEWER')).toBe(true)
  })

  it('(-) VIEWER < ADMIN fails', () => {
    expect(requireRole(makeClaim('VIEWER'), 'ADMIN')).toBe(false)
  })

  it('(-) ANALYST < MANAGER fails', () => {
    expect(requireRole(makeClaim('ANALYST'), 'MANAGER')).toBe(false)
  })

  it('(-) VIEWER < OWNER fails', () => {
    expect(requireRole(makeClaim('VIEWER'), 'OWNER')).toBe(false)
  })

  // Mutation target: >= to > — this test MUST fail if you flip >= to >
  it('(mutation-target) exact same level passes (>= not >)', () => {
    // For each role, requiring exactly that role must pass
    const roles: WorkspaceRoleString[] = ['OWNER','ADMIN','MANAGER','ANALYST','VIEWER']
    for (const role of roles) {
      expect(requireRole(makeClaim(role), role)).toBe(true)
    }
  })
})

describe('assertRole()', () => {
  it('(+) does not call onFail when role is sufficient', () => {
    let called = false
    assertRole(makeClaim('ADMIN'), 'ADMIN', () => {
      called = true
      throw new Error('403')
    })
    expect(called).toBe(false)
  })

  it('(-) calls onFail with message when role is insufficient', () => {
    let message = ''
    const fn = (msg: string): never => {
      message = msg
      throw new Error(msg)
    }
    expect(() => assertRole(makeClaim('VIEWER'), 'ADMIN', fn)).toThrow()
    expect(message).toContain('ADMIN')
    expect(message).toContain('VIEWER')
  })

  it('(-) ANALYST assertRole OWNER throws', () => {
    expect(() =>
      assertRole(makeClaim('ANALYST'), 'OWNER', (msg) => {
        throw new Error(msg)
      }),
    ).toThrow(/OWNER/)
  })
})

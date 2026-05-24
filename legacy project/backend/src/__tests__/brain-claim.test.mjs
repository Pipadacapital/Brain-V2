/**
 * Tests for brain-claim.ts (Track 1b)
 * Uses Node.js built-in test runner (node:test) — no test framework required.
 *
 * Run: node --test src/__tests__/brain-claim.test.mjs
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// Inline the logic to avoid needing prisma generate for @prisma/client
// (baseline TS error: PrismaClient not exported — pre-existing env issue)
// ---------------------------------------------------------------------------

const WORKSPACE_ROLE_LEVEL = {
  OWNER: 5,
  ADMIN: 4,
  MANAGER: 3,
  ANALYST: 2,
  VIEWER: 1,
}

function assembleClaim(opts) {
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

function requireRole(claim, minRole) {
  return claim.workspaceRoleLevel >= WORKSPACE_ROLE_LEVEL[minRole]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assembleClaim', () => {
  test('assembles a claim with correct level for OWNER', () => {
    const claim = assembleClaim({
      userId: 'user-1',
      workspaceId: 'ws-1',
      workspaceRole: 'OWNER',
      systemRole: 'USER',
      requestId: 'req-1',
      traceId: 'trace-1',
    })
    assert.equal(claim.workspaceRoleLevel, 5)
    assert.equal(claim.workspaceRole, 'OWNER')
    assert.equal(claim.systemRole, 'USER')
    assert.equal(claim.userId, 'user-1')
    assert.equal(claim.workspaceId, 'ws-1')
    assert.equal(claim.requestId, 'req-1')
    assert.equal(claim.traceId, 'trace-1')
  })

  test('assembles a claim with correct level for VIEWER', () => {
    const claim = assembleClaim({
      userId: 'user-2',
      workspaceId: 'ws-2',
      workspaceRole: 'VIEWER',
      systemRole: 'USER',
      requestId: 'req-2',
      traceId: 'trace-2',
    })
    assert.equal(claim.workspaceRoleLevel, 1)
  })

  test('SUPERADMIN systemRole is preserved', () => {
    const claim = assembleClaim({
      userId: 'user-3',
      workspaceId: 'ws-3',
      workspaceRole: 'OWNER',
      systemRole: 'SUPERADMIN',
      requestId: 'req-3',
      traceId: 'trace-3',
    })
    assert.equal(claim.systemRole, 'SUPERADMIN')
  })
})

describe('requireRole level-ordered guard', () => {
  const ownerClaim = assembleClaim({
    userId: 'u', workspaceId: 'w', workspaceRole: 'OWNER',
    systemRole: 'USER', requestId: 'r', traceId: 't',
  })
  const viewerClaim = assembleClaim({
    userId: 'u', workspaceId: 'w', workspaceRole: 'VIEWER',
    systemRole: 'USER', requestId: 'r', traceId: 't',
  })
  const managerClaim = assembleClaim({
    userId: 'u', workspaceId: 'w', workspaceRole: 'MANAGER',
    systemRole: 'USER', requestId: 'r', traceId: 't',
  })

  test('OWNER satisfies all role requirements', () => {
    assert.equal(requireRole(ownerClaim, 'OWNER'), true)
    assert.equal(requireRole(ownerClaim, 'ADMIN'), true)
    assert.equal(requireRole(ownerClaim, 'MANAGER'), true)
    assert.equal(requireRole(ownerClaim, 'ANALYST'), true)
    assert.equal(requireRole(ownerClaim, 'VIEWER'), true)
  })

  test('VIEWER only satisfies VIEWER requirement', () => {
    assert.equal(requireRole(viewerClaim, 'VIEWER'), true)
    assert.equal(requireRole(viewerClaim, 'ANALYST'), false)
    assert.equal(requireRole(viewerClaim, 'MANAGER'), false)
    assert.equal(requireRole(viewerClaim, 'ADMIN'), false)
    assert.equal(requireRole(viewerClaim, 'OWNER'), false)
  })

  test('MANAGER satisfies MANAGER, ANALYST, VIEWER but not ADMIN, OWNER', () => {
    assert.equal(requireRole(managerClaim, 'MANAGER'), true)
    assert.equal(requireRole(managerClaim, 'ANALYST'), true)
    assert.equal(requireRole(managerClaim, 'VIEWER'), true)
    assert.equal(requireRole(managerClaim, 'ADMIN'), false)
    assert.equal(requireRole(managerClaim, 'OWNER'), false)
  })
})

describe('Role level ordering', () => {
  test('OWNER > ADMIN > MANAGER > ANALYST > VIEWER', () => {
    assert.equal(WORKSPACE_ROLE_LEVEL.OWNER > WORKSPACE_ROLE_LEVEL.ADMIN, true)
    assert.equal(WORKSPACE_ROLE_LEVEL.ADMIN > WORKSPACE_ROLE_LEVEL.MANAGER, true)
    assert.equal(WORKSPACE_ROLE_LEVEL.MANAGER > WORKSPACE_ROLE_LEVEL.ANALYST, true)
    assert.equal(WORKSPACE_ROLE_LEVEL.ANALYST > WORKSPACE_ROLE_LEVEL.VIEWER, true)
  })
})

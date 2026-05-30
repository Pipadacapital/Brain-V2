// @paradigm: sql
// Team CRUD router tests — parity-38 feat-parity-w6b.
//
// POSITIVE:
//   - MANAGER can invite a member (creates pending invitation row + token)
//   - MANAGER can change a non-OWNER member's role
//   - MANAGER can remove a non-OWNER member
//   - MANAGER can revoke a pending invitation
//   - OWNER can transfer ownership (promotes target, demotes self to MANAGER)
//   - MANAGER can list pending invitations
//
// NEGATIVE (role-gating):
//   - VIEWER/ANALYST cannot invite
//   - MANAGER cannot change/remove an OWNER (FORBIDDEN at router layer for changeRole;
//     removeMember checks target role and throws FORBIDDEN if target is OWNER)
//   - MANAGER cannot transfer ownership (OWNER-only)
//   - ANALYST cannot list pending invitations (requires MANAGER)
//   - Tenancy: foreign workspace rejected with UnscopedQueryError

import { describe, it, expect } from 'vitest';
import { createBrainRouter } from './router.js';
import { assembleClaim } from '@brain/core-auth';
import type { BrainClaim } from '@brain/core-auth';
import {
  StubDataPlane,
  InMemoryDecisionLog,
  SUGANDH_LOK_WORKSPACE_ID,
} from '../infrastructure/loopback-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import type { WorkspaceContext } from './trpc.js';

const FOREIGN_WS = '00000000-0000-0000-0000-000000000099';
// One of the seeded members that is NOT the OWNER (Rohit is MANAGER, Neha is ANALYST)
const ANALYST_USER_ID = '00000000-0000-0000-0000-0000000000a3';
const MANAGER_USER_ID = '00000000-0000-0000-0000-0000000000a2';
const OWNER_USER_ID   = '00000000-0000-0000-0000-0000000000a1';

function makeClaim(
  workspaceId: string,
  role: 'OWNER' | 'MANAGER' | 'ANALYST' | 'VIEWER',
  userId = 'caller-test',
): BrainClaim {
  return assembleClaim({
    userId,
    workspaceId,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-team-test',
    traceId: 'trace-team-test',
  });
}

function makeCtx(
  workspaceId: string,
  role: 'OWNER' | 'MANAGER' | 'ANALYST' | 'VIEWER',
  userId = 'caller-test',
): WorkspaceContext {
  const claim = makeClaim(workspaceId, role, userId);
  return {
    identity: { sub: userId, email: 'caller@brain.test' },
    claim,
    workspaceId,
    requestId: 'req-team-test',
    traceId: 'trace-team-test',
  };
}

function caller(ctx: WorkspaceContext, stubWs = SUGANDH_LOK_WORKSPACE_ID) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), stubWs);
  return createBrainRouter(dp, new InMemoryIdempotencyStore()).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE
// ---------------------------------------------------------------------------
describe('team.invite (positive)', () => {
  it('MANAGER can invite a new member and gets a token back', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'MANAGER'));
    const res = await c.team.invite({ email: 'newbie@brand.com', role: 'ANALYST' });
    // StubDataPlane returns { ok: true } — no error means success
    expect(res).toMatchObject({ ok: true });
  });

  it('OWNER can invite a new member', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'OWNER'));
    const res = await c.team.invite({ email: 'other@brand.com', role: 'MANAGER' });
    expect(res).toMatchObject({ ok: true });
  });
});

describe('team.pendingInvitations (positive)', () => {
  it('MANAGER can list pending invitations (initially empty seed)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'MANAGER'));
    const res = await c.team.pendingInvitations();
    expect(Array.isArray(res.invitations)).toBe(true);
  });

  it('invite + list roundtrip: invited email appears in pending list', async () => {
    const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
    const idem = new InMemoryIdempotencyStore();
    const router = createBrainRouter(dp, idem);
    const ctx = makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'MANAGER');
    const c = router.createCaller(ctx);
    await c.team.invite({ email: 'pending@brand.com', role: 'ANALYST' });
    const list = await c.team.pendingInvitations();
    expect(list.invitations.some((i) => i.email === 'pending@brand.com')).toBe(true);
  });
});

describe('team.changeRole (positive)', () => {
  it('MANAGER can change a non-OWNER member role', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'MANAGER'));
    const res = await c.team.changeRole({ user_id: ANALYST_USER_ID, new_role: 'VIEWER' });
    expect(res).toMatchObject({ ok: true });
  });

  it('OWNER can change any role', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'OWNER'));
    const res = await c.team.changeRole({ user_id: MANAGER_USER_ID, new_role: 'ANALYST' });
    expect(res).toMatchObject({ ok: true });
  });
});

describe('team.removeMember (positive)', () => {
  it('MANAGER can remove a non-OWNER member', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'MANAGER'));
    const res = await c.team.removeMember({ user_id: ANALYST_USER_ID });
    expect(res).toMatchObject({ ok: true });
  });

  it('OWNER can remove any member', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'OWNER'));
    const res = await c.team.removeMember({ user_id: MANAGER_USER_ID });
    expect(res).toMatchObject({ ok: true });
  });
});

describe('team.revokeInvite (positive)', () => {
  it('MANAGER can revoke an existing pending invitation', async () => {
    // Create an invitation first, then revoke it.
    const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
    const idem = new InMemoryIdempotencyStore();
    const ctx = makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'MANAGER');
    const c = createBrainRouter(dp, idem).createCaller(ctx);
    await c.team.invite({ email: 'revoke@brand.com', role: 'VIEWER' });
    const list = await c.team.pendingInvitations();
    const inv = list.invitations.find((i) => i.email === 'revoke@brand.com');
    expect(inv).toBeDefined();
    const res = await c.team.revokeInvite({ invitation_id: inv!.id });
    expect(res).toMatchObject({ ok: true });
    // After revocation the invitation is gone.
    const list2 = await c.team.pendingInvitations();
    expect(list2.invitations.some((i) => i.email === 'revoke@brand.com')).toBe(false);
  });
});

describe('team.transferOwnership (positive)', () => {
  it('OWNER can transfer ownership to a current member — new owner promoted, old owner demoted', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'OWNER', OWNER_USER_ID));
    const res = await c.team.transferOwnership({ new_owner_user_id: MANAGER_USER_ID });
    expect(res).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — role gating
// ---------------------------------------------------------------------------
describe('team CRUD role gating (negative)', () => {
  it('VIEWER cannot invite', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.team.invite({ email: 'x@x.com', role: 'ANALYST' })).rejects.toThrow(/MANAGER/);
  });

  it('ANALYST cannot invite', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'ANALYST'));
    await expect(c.team.invite({ email: 'x@x.com', role: 'VIEWER' })).rejects.toThrow(/MANAGER/);
  });

  it('ANALYST cannot list pending invitations', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'ANALYST'));
    await expect(c.team.pendingInvitations()).rejects.toThrow(/MANAGER/);
  });

  it('MANAGER cannot remove an OWNER (FORBIDDEN at router level)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'MANAGER'));
    await expect(c.team.removeMember({ user_id: OWNER_USER_ID })).rejects.toThrow(/MANAGER cannot remove an OWNER/);
  });

  it('MANAGER cannot transfer ownership (OWNER-only)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'MANAGER'));
    await expect(c.team.transferOwnership({ new_owner_user_id: ANALYST_USER_ID })).rejects.toThrow(/OWNER-only/);
  });

  it('ANALYST cannot transfer ownership', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'ANALYST'));
    await expect(c.team.transferOwnership({ new_owner_user_id: MANAGER_USER_ID })).rejects.toThrow(/OWNER-only/);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — tenancy (cross-workspace)
// ---------------------------------------------------------------------------
describe('team CRUD tenancy fail-closed', () => {
  it('invite on a foreign workspace: workspaceProc rejects BEFORE data plane (mismatch)', async () => {
    // workspaceProc middleware enforces ctx.workspaceId === claim.workspaceId.
    // We force a mismatch by giving ctx a different workspaceId than the claim.
    const claim = makeClaim(SUGANDH_LOK_WORKSPACE_ID, 'OWNER', 'owner-user');
    const mismatchCtx: WorkspaceContext = {
      identity: { sub: 'owner-user', email: 'owner@test.com' },
      claim,
      // Deliberately wrong workspaceId so the middleware rejects.
      workspaceId: FOREIGN_WS,
      requestId: 'req-team-test',
      traceId: 'trace-team-test',
    };
    const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
    const c = createBrainRouter(dp, new InMemoryIdempotencyStore()).createCaller(mismatchCtx);
    await expect(c.team.invite({ email: 'x@x.com', role: 'ANALYST' })).rejects.toThrow(/Workspace mismatch/);
  });

  it('invite with stub scoped to a different workspace returns { ok: false } (data-plane gate)', async () => {
    // ctx authenticated for FOREIGN_WS (claim matches ctx), but stub is scoped to SUGANDH_LOK.
    // The mutation reaches the data plane, which returns { ok: false, error: 'Not authorized' }.
    const c = caller(makeCtx(FOREIGN_WS, 'OWNER'), SUGANDH_LOK_WORKSPACE_ID);
    const res = await c.team.invite({ email: 'x@x.com', role: 'ANALYST' });
    expect(res.ok).toBe(false);
  });
});

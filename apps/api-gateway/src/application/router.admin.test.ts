// @paradigm: sql
// Gateway router tests for the platform-admin (SUPERADMIN) suite + the superadminProc
// authorization gate.
//
// The core-admin use-cases (DB-backed in production) are MOCKED so the router wiring +
// the LOAD-BEARING systemRole gate are unit-tested without a live DB. The cross-tenant
// SQL itself is covered in core-service's admin-use-cases.test.ts.
//
// Covers BOTH positive and negative (coverage standard):
//   POSITIVE — a SUPERADMIN claim reaches admin.users/workspaces/connections and gets
//              the shaped payload (+ total + requestId).
//   NEGATIVE — a normal USER (even with workspace role OWNER) is FORBIDDEN on EVERY
//              admin procedure, and the underlying use-case is NEVER called (no leak);
//              an unauthenticated/no-claim caller is UNAUTHORIZED. These kill the
//              "drop the systemRole check" and "flip !== to ===" mutants.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the core-admin barrel by its RESOLVED source path (the vitest alias points
// '@brain/core-admin' here) — the reliable way to intercept an aliased module.
vi.mock('../../../core-service/src/application/contexts/admin/index.ts', () => ({
  listAllUsers: vi.fn(),
  listAllWorkspaces: vi.fn(),
  listAllConnections: vi.fn(),
}));

import { createBrainRouter } from './router.js';
import type { BrainClaim } from '@brain/core-auth';
import { assembleClaim } from '@brain/core-auth';
import {
  StubDataPlane,
  InMemoryDecisionLog,
  SUGANDH_LOK_WORKSPACE_ID,
} from '../infrastructure/loopback-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import type { AuthedContext, IdentityContext } from './trpc.js';
import { listAllUsers, listAllWorkspaces, listAllConnections } from '@brain/core-admin';

const SUPER_SUB = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_SUB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeClaim(systemRole: 'SUPERADMIN' | 'USER', workspaceRole: BrainClaim['workspaceRole'] = 'OWNER'): BrainClaim {
  return assembleClaim({
    userId: systemRole === 'SUPERADMIN' ? SUPER_SUB : USER_SUB,
    workspaceId: SUGANDH_LOK_WORKSPACE_ID,
    workspaceRole,
    systemRole,
    requestId: 'req-admin-test',
    traceId: 'trace-admin-test',
  });
}

function authedCtx(systemRole: 'SUPERADMIN' | 'USER', workspaceRole: BrainClaim['workspaceRole'] = 'OWNER'): AuthedContext {
  const claim = makeClaim(systemRole, workspaceRole);
  return {
    identity: { sub: claim.userId, email: 'admin@brain.test' },
    claim,
    workspaceId: SUGANDH_LOK_WORKSPACE_ID,
    requestId: 'req-admin-test',
    traceId: 'trace-admin-test',
  };
}

// An identity-only context (verified, but NO claim — e.g. mid-onboarding/unauth on the
// claim path). superadminProc must reject it as UNAUTHORIZED.
function noClaimCtx(): IdentityContext {
  return {
    identity: { sub: USER_SUB, email: 'noclaim@brain.test' },
    requestId: 'req-admin-test',
    traceId: 'trace-admin-test',
  };
}

function caller(ctx: AuthedContext | IdentityContext) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
  return createBrainRouter(dp, new InMemoryIdempotencyStore()).createCaller(ctx);
}

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// POSITIVE — SUPERADMIN reaches every admin procedure
// ---------------------------------------------------------------------------
describe('admin suite (positive — SUPERADMIN)', () => {
  it('admin.users returns the user directory + total + requestId', async () => {
    vi.mocked(listAllUsers).mockResolvedValue([
      { id: 'u1', email: 'a@b.com', fullName: 'Aarti', systemRole: 'SUPERADMIN', membershipCount: 2, createdAt: '2026-03-01T00:00:00.000Z' },
    ]);
    const res = await caller(authedCtx('SUPERADMIN')).admin.users();
    expect(res.total).toBe(1);
    expect(res.users[0]?.email).toBe('a@b.com');
    expect(res.requestId).toBeTruthy();
    expect(listAllUsers).toHaveBeenCalledOnce();
  });

  it('admin.workspaces returns the workspace directory (plan may be null)', async () => {
    vi.mocked(listAllWorkspaces).mockResolvedValue([
      { id: 'w1', name: 'Sugandh Lok', slug: 'sugandh-lok', plan: null, memberCount: 5, shopifyCount: 1, hasGoogleAds: true, hasMeta: false, createdAt: '2026-03-01T00:00:00.000Z' },
    ]);
    const res = await caller(authedCtx('SUPERADMIN')).admin.workspaces();
    expect(res.total).toBe(1);
    expect(res.workspaces[0]?.plan).toBeNull();
    expect(res.workspaces[0]?.hasGoogleAds).toBe(true);
  });

  it('admin.connections returns the cross-tenant connection directory', async () => {
    vi.mocked(listAllConnections).mockResolvedValue([
      { connectionId: 'c1', vendor: 'SHOPIFY', workspaceId: 'w1', workspaceName: 'Sugandh Lok', workspaceSlug: 'sugandh-lok', status: 'CONNECTED', accountRef: 'x.myshopify.com', lastSyncAt: null, lastSyncError: null },
    ]);
    const res = await caller(authedCtx('SUPERADMIN')).admin.connections();
    expect(res.total).toBe(1);
    expect(res.connections[0]?.vendor).toBe('SHOPIFY');
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — a normal USER (even OWNER) is FORBIDDEN, and nothing leaks
// ---------------------------------------------------------------------------
describe('admin suite (negative — non-SUPERADMIN is fully fenced out)', () => {
  it('admin.users → FORBIDDEN for a USER who is workspace OWNER; use-case never runs', async () => {
    await expect(caller(authedCtx('USER', 'OWNER')).admin.users()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(listAllUsers).not.toHaveBeenCalled();
  });

  it('admin.workspaces → FORBIDDEN for a USER (OWNER); no leak', async () => {
    await expect(caller(authedCtx('USER', 'OWNER')).admin.workspaces()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(listAllWorkspaces).not.toHaveBeenCalled();
  });

  it('admin.connections → FORBIDDEN for a USER (OWNER); no leak', async () => {
    await expect(caller(authedCtx('USER', 'OWNER')).admin.connections()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(listAllConnections).not.toHaveBeenCalled();
  });

  it('admin.users → UNAUTHORIZED when there is no claim (unauthenticated/onboarding)', async () => {
    await expect(caller(noClaimCtx()).admin.users()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(listAllUsers).not.toHaveBeenCalled();
  });
});

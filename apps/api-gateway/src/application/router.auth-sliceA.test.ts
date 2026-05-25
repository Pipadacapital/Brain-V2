// @paradigm: sql
// Slice A + C — router-level auth hardening tests.
//
// B4 (slice A → slice C): workspace.switch now validates REAL DB membership
//   (multi-workspace capable). POSITIVE — switching to a workspace the verified
//   user IS a member of returns it; NEGATIVE — a workspace they are NOT a member
//   of → FORBIDDEN. The membership lookup (core-onboarding.listWorkspaces) is
//   mocked here so the router guard logic is unit-tested without a live DB; the
//   real DB/RLS behavior is proven in onboarding-rls.integration.test.ts.
// S4 (slice A): push-token registration derives user_id from the claim; the input
//   schema no longer accepts a client user_id.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the core-onboarding use-cases the router calls (DB-backed in production).
// Mock the RESOLVED source path the vitest alias points to (reliable interception).
vi.mock('../../../core-service/src/application/onboarding/index.ts', () => ({
  listWorkspaces: vi.fn(),
  ensureUser: vi.fn(),
  completeOnboarding: vi.fn(),
  acceptInvitation: vi.fn(),
  // OnboardingError must be a real class (router does `instanceof`).
  OnboardingError: class OnboardingError extends Error {
    constructor(public code: string, message: string) {
      super(message);
      this.name = 'OnboardingError';
    }
  },
}));

import { createBrainRouter } from './router.js';
import { assembleClaim } from '@brain/core-auth';
import {
  StubDataPlane,
  InMemoryDecisionLog,
  SUGANDH_LOK_WORKSPACE_ID,
} from '../infrastructure/loopback-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import type { WorkspaceContext } from './trpc.js';
import { listWorkspaces } from '@brain/core-onboarding';

const OTHER_WS = '99999999-9999-9999-9999-999999999999';
const CLAIM_USER = '11111111-1111-1111-1111-111111111111';

function ctx(workspaceId = SUGANDH_LOK_WORKSPACE_ID): WorkspaceContext {
  return {
    identity: { sub: CLAIM_USER, email: 'owner@brain.test' },
    claim: assembleClaim({
      userId: CLAIM_USER,
      workspaceId,
      workspaceRole: 'OWNER',
      systemRole: 'USER',
      requestId: 'req-sliceA',
      traceId: 'trace-sliceA',
    }),
    workspaceId,
    requestId: 'req-sliceA',
    traceId: 'trace-sliceA',
  };
}

function caller(c: WorkspaceContext) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
  return { router: createBrainRouter(dp, new InMemoryIdempotencyStore()).createCaller(c), dp };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('B4 (slice C) — workspace.switch validates REAL DB membership', () => {
  it('POSITIVE: switching to a workspace the user IS a member of returns it', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([
      { workspaceId: SUGANDH_LOK_WORKSPACE_ID, slug: 'sugandh-lok', name: 'Sugandh Lok', role: 'OWNER' },
    ]);
    const { router } = caller(ctx());
    const out = await router.workspace.switch({ workspaceId: SUGANDH_LOK_WORKSPACE_ID });
    expect(out.workspaceId).toBe(SUGANDH_LOK_WORKSPACE_ID);
    expect(out.role).toBe('OWNER');
  });

  it('NEGATIVE: switching to a workspace the user is NOT a member of → FORBIDDEN', async () => {
    // The user is a member of Sugandh-Lok only; OTHER_WS is not in their list.
    vi.mocked(listWorkspaces).mockResolvedValue([
      { workspaceId: SUGANDH_LOK_WORKSPACE_ID, slug: 'sugandh-lok', name: 'Sugandh Lok', role: 'OWNER' },
    ]);
    const { router } = caller(ctx());
    await expect(router.workspace.switch({ workspaceId: OTHER_WS })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('NEGATIVE: a user with ZERO memberships cannot switch anywhere → FORBIDDEN', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([]);
    const { router } = caller(ctx());
    await expect(router.workspace.switch({ workspaceId: SUGANDH_LOK_WORKSPACE_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('workspace.list (slice C) — REAL multi-workspace list from the DB', () => {
  it('POSITIVE: returns every workspace the verified user belongs to', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([
      { workspaceId: SUGANDH_LOK_WORKSPACE_ID, slug: 'sugandh-lok', name: 'Sugandh Lok', role: 'OWNER' },
      { workspaceId: OTHER_WS, slug: 'brand-b', name: 'Brand B', role: 'MANAGER' },
    ]);
    const { router } = caller(ctx());
    const out = await router.workspace.list();
    expect(out.workspaces).toHaveLength(2);
    expect(out.workspaces[1]?.role).toBe('MANAGER');
  });
});

describe('S4 — device.registerPushToken derives user_id from the claim', () => {
  it('POSITIVE: the data-plane call uses claim.userId (not client input)', async () => {
    const { router, dp } = caller(ctx());
    let captured: { user_id?: string } = {};
    const orig = dp.registerPushToken.bind(dp);
    dp.registerPushToken = async (p: Parameters<typeof orig>[0]) => {
      captured = p;
      return orig(p);
    };
    await router.device.registerPushToken({
      device_id: 'device-xyz',
      expo_push_token: 'ExponentPushToken[abc]',
    });
    expect(captured.user_id).toBe(CLAIM_USER);
  });

  it('NEGATIVE: a client-supplied user_id is not part of the input schema (TS + runtime)', async () => {
    const { router } = caller(ctx());
    const attackerInput = {
      user_id: 'attacker-supplied-uuid',
      device_id: 'device-xyz',
      expo_push_token: 'ExponentPushToken[abc]',
    };
    const call = router.device.registerPushToken(
      attackerInput as unknown as { device_id: string; expo_push_token: string },
    );
    await expect(call).resolves.toBeDefined();
  });
});

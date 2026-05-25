// @paradigm: sql
// Slice C — gateway router tests for the onboarding/membership procedures.
//
// The core-onboarding use-cases (DB-backed in production) are MOCKED so the router
// wiring, tier gating, and error mapping are unit-tested without a live DB. The
// real DB/RLS behavior is proven in core-service's onboarding-rls integration test.
//
// Covers: user.me (onboarding decision) · user.ensure · onboarding.complete (+ slug
// error mapping) · invitation.accept (+ role-mapped result) · identity-tier gating
// (a no-membership identity context can reach onboarding but NOT workspace data).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the core-onboarding barrel by its RESOLVED source path (the vitest alias
// points '@brain/core-onboarding' here). Mocking the resolved path is the reliable
// way to intercept an aliased module's named exports.
vi.mock('../../../core-service/src/application/onboarding/index.ts', () => {
  class OnboardingError extends Error {
    constructor(public code: string, message: string) {
      super(message);
      this.name = 'OnboardingError';
    }
  }
  return {
    ensureUser: vi.fn(),
    completeOnboarding: vi.fn(),
    acceptInvitation: vi.fn(),
    listWorkspaces: vi.fn(),
    resolveMembership: vi.fn(),
    OnboardingError,
  };
});

import { createBrainRouter } from './router.js';
import {
  StubDataPlane,
  InMemoryDecisionLog,
  SUGANDH_LOK_WORKSPACE_ID,
} from '../infrastructure/loopback-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import type { IdentityContext } from './trpc.js';
import {
  ensureUser,
  completeOnboarding,
  acceptInvitation,
  listWorkspaces,
  OnboardingError,
} from '@brain/core-onboarding';

const SUB = '11111111-1111-1111-1111-111111111111';

// An IDENTITY-ONLY context: verified user, NO workspace claim (the no-membership
// onboarding state). No `claim`, no `workspaceId`.
function identityOnlyCtx(): IdentityContext {
  return {
    identity: { sub: SUB, email: 'newuser@brain.test' },
    requestId: 'req-c',
    traceId: 'trace-c',
  };
}

function caller(ctx: IdentityContext) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
  return createBrainRouter(dp, new InMemoryIdempotencyStore()).createCaller(ctx);
}

beforeEach(() => vi.clearAllMocks());

describe('user.me — onboarding decision (identity tier, no membership required)', () => {
  it('(+) needsOnboarding=true when the verified user has zero memberships', async () => {
    vi.mocked(ensureUser).mockResolvedValue({ userId: SUB, created: true });
    vi.mocked(listWorkspaces).mockResolvedValue([]);
    const out = await caller(identityOnlyCtx()).user.me();
    expect(out.needsOnboarding).toBe(true);
    expect(out.memberships).toEqual([]);
    // user.me upserts the user row (ensure) before deciding.
    expect(ensureUser).toHaveBeenCalledWith({ sub: SUB, email: 'newuser@brain.test' });
  });

  it('(+) needsOnboarding=false when the user has at least one membership', async () => {
    vi.mocked(ensureUser).mockResolvedValue({ userId: SUB, created: false });
    vi.mocked(listWorkspaces).mockResolvedValue([
      { workspaceId: 'ws-1', slug: 'brand-a', name: 'Brand A', role: 'OWNER' },
    ]);
    const out = await caller(identityOnlyCtx()).user.me();
    expect(out.needsOnboarding).toBe(false);
    expect(out.memberships).toHaveLength(1);
  });
});

describe('user.ensure — idempotent upsert (identity tier)', () => {
  it('(+) returns created flag from the use-case', async () => {
    vi.mocked(ensureUser).mockResolvedValue({ userId: SUB, created: true });
    const out = await caller(identityOnlyCtx()).user.ensure();
    expect(out).toMatchObject({ userId: SUB, created: true });
  });
});

describe('onboarding.complete — creates workspace (identity tier)', () => {
  const input = {
    fullName: 'Owner',
    jobRole: 'Founder',
    brandName: 'Brand A',
    slug: 'brand-a',
    industry: 'Beauty',
    monthlyRevenue: '10L',
    platform: 'SHOPIFY' as const,
    storeHandle: 'brand-a',
  };

  it('(+) returns workspaceId + redirectTo /dashboard', async () => {
    vi.mocked(completeOnboarding).mockResolvedValue({ workspaceId: 'new-ws', slug: 'brand-a' });
    const out = await caller(identityOnlyCtx()).onboarding.complete(input);
    expect(out).toMatchObject({ workspaceId: 'new-ws', slug: 'brand-a', redirectTo: '/dashboard' });
    // The verified sub + email flow into the use-case (NOT client-supplied).
    expect(completeOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ identity: { sub: SUB, email: 'newuser@brain.test', fullName: 'Owner' } }),
    );
  });

  it('(-) a SLUG_TAKEN OnboardingError maps to CONFLICT', async () => {
    vi.mocked(completeOnboarding).mockRejectedValue(new OnboardingError('SLUG_TAKEN', 'taken'));
    await expect(caller(identityOnlyCtx()).onboarding.complete(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('(-) a SLUG_INVALID OnboardingError maps to BAD_REQUEST', async () => {
    vi.mocked(completeOnboarding).mockRejectedValue(new OnboardingError('SLUG_INVALID', 'bad'));
    await expect(caller(identityOnlyCtx()).onboarding.complete(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('(-) a raw DB error maps to a GENERIC INTERNAL_SERVER_ERROR (no detail leak)', async () => {
    vi.mocked(completeOnboarding).mockRejectedValue(new Error('connection refused at 10.0.0.5'));
    const call = caller(identityOnlyCtx()).onboarding.complete(input);
    await expect(call).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    await expect(call).rejects.not.toThrow(/connection refused/);
  });

  it('(-) zod rejects an empty brandName before the use-case is called', async () => {
    await expect(
      caller(identityOnlyCtx()).onboarding.complete({ ...input, brandName: '' }),
    ).rejects.toBeDefined();
    expect(completeOnboarding).not.toHaveBeenCalled();
  });
});

describe('invitation.accept — role-mapped, idempotent (identity tier)', () => {
  it('(+) returns the accepted result (role-mapped EDITOR→MANAGER by the use-case)', async () => {
    vi.mocked(acceptInvitation).mockResolvedValue({
      status: 'accepted', workspaceId: 'ws-1', slug: 'brand-a', role: 'MANAGER',
    });
    const out = await caller(identityOnlyCtx()).invitation.accept({ token: 'tok-1' });
    expect(out).toMatchObject({ status: 'accepted', role: 'MANAGER' });
    expect(acceptInvitation).toHaveBeenCalledWith('tok-1', { sub: SUB, email: 'newuser@brain.test' });
  });

  it('(-) INVITATION_NOT_FOUND maps to NOT_FOUND', async () => {
    vi.mocked(acceptInvitation).mockRejectedValue(new OnboardingError('INVITATION_NOT_FOUND', 'nope'));
    await expect(caller(identityOnlyCtx()).invitation.accept({ token: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('tier gating — a no-membership identity CANNOT reach workspace data', () => {
  it('(-) metrics.kpiSummary (workspace tier) → UNAUTHORIZED for an identity-only ctx', async () => {
    // No claim in ctx → authedMiddleware rejects before any data-plane call.
    await expect(
      caller(identityOnlyCtx()).metrics.kpiSummary({ date_start: '2026-04-01', date_end: '2026-04-30' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('(-) auth.session (authed tier) → UNAUTHORIZED for an identity-only ctx', async () => {
    await expect(caller(identityOnlyCtx()).auth.session()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

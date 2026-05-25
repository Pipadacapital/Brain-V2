// @paradigm: sql
// Slice A + C — MembershipResolver (B3 source-of-workspace-id, S5 fail-closed).

import { describe, it, expect, vi } from 'vitest';
import { LocalSeedMembershipResolver, DbMembershipResolver } from './membership-resolver.js';

const SEED_WS = '00000000-0000-0000-0000-000000000001';

describe('LocalSeedMembershipResolver (offline harness only)', () => {
  it('maps any authed sub to the seeded workspace as OWNER (B3: workspace_id from resolver)', async () => {
    const r = new LocalSeedMembershipResolver(SEED_WS);
    const m = await r.resolve('any-real-supabase-sub-uuid');
    expect(m).toEqual({
      workspaceId: SEED_WS,
      workspaceRole: 'OWNER',
      systemRole: 'USER',
    });
  });

  it('NEGATIVE: returns null for an empty sub (S5: fail-closed, never a default grant)', async () => {
    const r = new LocalSeedMembershipResolver(SEED_WS);
    expect(await r.resolve('')).toBeNull();
  });

  it('NEGATIVE: refuses construction without a seeded workspace id', () => {
    expect(() => new LocalSeedMembershipResolver('')).toThrow(/seeded workspaceId/i);
  });
});

describe('DbMembershipResolver (slice C — real-auth path)', () => {
  it('(+) delegates to the core-service use-case and returns its membership', async () => {
    const useCase = vi.fn().mockResolvedValue({
      workspaceId: 'ws-real',
      workspaceRole: 'MANAGER',
      systemRole: 'USER',
    });
    const r = new DbMembershipResolver(useCase);
    const m = await r.resolve('verified-sub');
    expect(m).toEqual({ workspaceId: 'ws-real', workspaceRole: 'MANAGER', systemRole: 'USER' });
    expect(useCase).toHaveBeenCalledWith('verified-sub');
  });

  it('(+) returns null when the user has no membership (caller routes to /onboarding)', async () => {
    const r = new DbMembershipResolver(vi.fn().mockResolvedValue(null));
    expect(await r.resolve('no-membership-sub')).toBeNull();
  });

  it('NEGATIVE: returns null for an empty sub WITHOUT hitting the DB (fail-closed)', async () => {
    const useCase = vi.fn();
    const r = new DbMembershipResolver(useCase);
    expect(await r.resolve('')).toBeNull();
    expect(useCase).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a DB error PROPAGATES (never swallowed into a default grant — S5)', async () => {
    const r = new DbMembershipResolver(vi.fn().mockRejectedValue(new Error('connection refused')));
    await expect(r.resolve('verified-sub')).rejects.toThrow('connection refused');
  });
});

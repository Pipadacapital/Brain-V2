// @paradigm: sql
// Slice A — MembershipResolver (B3 source-of-workspace-id, S5 fail-closed).

import { describe, it, expect } from 'vitest';
import { LocalSeedMembershipResolver } from './membership-resolver.js';

const SEED_WS = '00000000-0000-0000-0000-000000000001';

describe('LocalSeedMembershipResolver', () => {
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

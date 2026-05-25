// @paradigm: sql
// Slice A — gateway context builders + boot-config assertions.
//
// Exercises the REAL exported functions from server.ts (no duplicated logic):
//   B1: real-auth path fails closed (UNAUTHORIZED) when no/invalid token, never stub.
//   B3: workspace_id comes from the resolver, NOT from any header.
//   S2: only the sub flows into the claim; failure logs carry no email/'@'.
//   S5: an unresolved sub fails closed.
// And the boot assertions (B1/B2/S5) via assertBootableAuthConfig.

import { describe, it, expect, vi } from 'vitest';
import {
  buildRealAuthContext,
  buildLocalStubContext,
  readAuthConfig,
  assertBootableAuthConfig,
} from './server.js';
import { AuthVerifyError } from '../infrastructure/supabase-jwt-verifier.js';
import { LocalSeedMembershipResolver } from '../domain/membership-resolver.js';

const SEED_WS = '00000000-0000-0000-0000-000000000001';
const SUB = 'real-supabase-sub-uuid';

function fakeLog() {
  return { warn: vi.fn() };
}

describe('buildRealAuthContext (B1/B3/S2/S5)', () => {
  it('B3: derives workspace_id from the resolver — an x-workspace-id header is never passed in', async () => {
    const verifier = { verify: async () => ({ sub: SUB }) };
    const resolver = new LocalSeedMembershipResolver(SEED_WS);
    // Note the function SIGNATURE: it takes (authorization, requestId, traceId, deps).
    // There is no x-workspace-id parameter — the header cannot influence the result.
    const ctx = await buildRealAuthContext('Bearer good', 'req1', 'trace1', {
      verifier,
      resolver,
      log: fakeLog(),
    });
    expect(ctx.workspaceId).toBe(SEED_WS);
    expect(ctx.claim.workspaceId).toBe(SEED_WS);
    expect(ctx.workspaceId).toBe(ctx.claim.workspaceId); // middleware invariant
  });

  it('S2: claim.userId is the verified sub (no email anywhere)', async () => {
    const verifier = { verify: async () => ({ sub: SUB }) };
    const ctx = await buildRealAuthContext('Bearer good', 'req1', 'trace1', {
      verifier,
      resolver: new LocalSeedMembershipResolver(SEED_WS),
      log: fakeLog(),
    });
    expect(ctx.claim.userId).toBe(SUB);
    expect(JSON.stringify(ctx.claim)).not.toContain('@');
  });

  it('B1/S1: a verify failure → UNAUTHORIZED (never a stub fallback); log has no email', async () => {
    const log = fakeLog();
    const verifier = {
      verify: async () => {
        throw new AuthVerifyError('verify_failed');
      },
    };
    await expect(
      buildRealAuthContext('Bearer bad', 'req1', 'trace1', {
        verifier,
        resolver: new LocalSeedMembershipResolver(SEED_WS),
        log,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    // S2: the warn log carries error class + requestId, never PII.
    expect(log.warn).toHaveBeenCalled();
    const logged = JSON.stringify(log.warn.mock.calls);
    expect(logged).not.toContain('@');
    expect(logged).toContain('verify_failed');
  });

  it('S5: an unresolved sub fails closed (UNAUTHORIZED), never a default grant', async () => {
    const verifier = { verify: async () => ({ sub: SUB }) };
    const nullResolver = { resolve: async () => null };
    await expect(
      buildRealAuthContext('Bearer good', 'req1', 'trace1', {
        verifier,
        resolver: nullResolver,
        log: fakeLog(),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('buildLocalStubContext (harness path)', () => {
  it('produces a consistent stub context (workspaceId === claim.workspaceId)', () => {
    const ctx = buildLocalStubContext('req1', 'trace1', SEED_WS, 'user-local');
    expect(ctx.workspaceId).toBe(SEED_WS);
    expect(ctx.claim.workspaceId).toBe(SEED_WS);
    expect(ctx.claim.workspaceRole).toBe('OWNER');
  });
});

describe('boot config assertions (B1/B2/S5)', () => {
  it('readAuthConfig: defaults to real-auth (harness false) when flag absent', () => {
    const cfg = readAuthConfig({ SUPABASE_URL: 'https://x.supabase.co' });
    expect(cfg.localHarness).toBe(false);
  });

  it('B2: real-auth without SUPABASE_URL is NOT bootable', () => {
    const cfg = readAuthConfig({});
    expect(assertBootableAuthConfig(cfg)).toMatch(/SUPABASE_URL is required/);
  });

  it('B1/S5: harness under NODE_ENV=production is NOT bootable', () => {
    const cfg = readAuthConfig({ BRAIN_GATEWAY_LOCAL_HARNESS: 'true', NODE_ENV: 'production' });
    expect(assertBootableAuthConfig(cfg)).toMatch(/production/);
  });

  it('real-auth with SUPABASE_URL IS bootable (null = ok)', () => {
    const cfg = readAuthConfig({ SUPABASE_URL: 'https://x.supabase.co' });
    expect(assertBootableAuthConfig(cfg)).toBeNull();
  });

  it('harness in dev IS bootable', () => {
    const cfg = readAuthConfig({ BRAIN_GATEWAY_LOCAL_HARNESS: 'true' });
    expect(assertBootableAuthConfig(cfg)).toBeNull();
  });
});

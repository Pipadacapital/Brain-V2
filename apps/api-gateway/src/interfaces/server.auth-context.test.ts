// @paradigm: sql
// Slice A + C — gateway context builders + boot-config assertions.
//
// Exercises the REAL exported functions from server.ts (no duplicated logic):
//   B1: real-auth path fails closed (UNAUTHORIZED) when no/invalid token, never stub.
//   B3: workspace_id comes from the resolver, NOT from any header.
//   S2: only the sub flows into the claim; failure logs carry no email/'@'.
//   S5 (slice A → slice C): a verify failure still fails closed (UNAUTHORIZED), and a
//      resolver THROW (DB error) still fails closed (propagates → UNAUTHORIZED). But a
//      verified user with NO membership now returns an IDENTITY-ONLY context (route to
//      /onboarding) — NOT an auto-grant, NOT a hard UNAUTHORIZED. That is the slice-C
//      onboarding behavior.
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
    const verifier = { verify: async () => ({ sub: SUB, email: 'verified@brain.test' }) };
    const resolver = new LocalSeedMembershipResolver(SEED_WS);
    // Note the function SIGNATURE: it takes (authorization, requestId, traceId, deps).
    // There is no x-workspace-id parameter — the header cannot influence the result.
    const ctx = await buildRealAuthContext('Bearer good', 'req1', 'trace1', {
      verifier,
      resolver,
      log: fakeLog(),
    });
    expect(ctx.workspaceId).toBe(SEED_WS);
    expect(ctx.claim?.workspaceId).toBe(SEED_WS);
    expect(ctx.workspaceId).toBe(ctx.claim?.workspaceId); // middleware invariant
  });

  it('S2: claim.userId is the verified sub; the email is in identity but NEVER in the claim', async () => {
    const verifier = { verify: async () => ({ sub: SUB, email: 'verified@brain.test' }) };
    const ctx = await buildRealAuthContext('Bearer good', 'req1', 'trace1', {
      verifier,
      resolver: new LocalSeedMembershipResolver(SEED_WS),
      log: fakeLog(),
    });
    expect(ctx.claim?.userId).toBe(SUB);
    // S2: the BrainClaim itself carries NO email — serializing it has no '@'.
    expect(JSON.stringify(ctx.claim)).not.toContain('@');
    // The verified email IS carried in identity (for slice-C onboarding) but is
    // never logged and never in the claim.
    expect(ctx.identity.email).toBe('verified@brain.test');
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

  it('S5 (slice C): a verified user with NO membership → identity-only context (route to /onboarding), NOT a grant', async () => {
    const log = fakeLog();
    const verifier = { verify: async () => ({ sub: SUB, email: 'newuser@brain.test' }) };
    const nullResolver = { resolve: async () => null };
    const ctx = await buildRealAuthContext('Bearer good', 'req1', 'trace1', {
      verifier,
      resolver: nullResolver,
      log,
    });
    // Identity present (so onboarding can run), but NO claim and NO workspace → the
    // user is routed to /onboarding. This is NOT an auto-OWNER grant.
    expect(ctx.identity.sub).toBe(SUB);
    expect(ctx.claim).toBeUndefined();
    expect(ctx.workspaceId).toBeUndefined();
    // S2: the no-membership warn log carries sub/requestId, never the email.
    const logged = JSON.stringify(log.warn.mock.calls);
    expect(logged).not.toContain('@');
  });

  it('S5 (fail-closed): a resolver DB error propagates (caller maps to UNAUTHORIZED) — never a default grant', async () => {
    const verifier = { verify: async () => ({ sub: SUB, email: 'x@brain.test' }) };
    const throwingResolver = {
      resolve: async () => {
        throw new Error('connection refused');
      },
    };
    // The DB error MUST propagate (not be swallowed into a grant). The gateway's
    // createContext lets it bubble → tRPC surfaces UNAUTHORIZED/INTERNAL; either way
    // the user gets NO claim. We assert it throws (does not resolve to a context).
    await expect(
      buildRealAuthContext('Bearer good', 'req1', 'trace1', {
        verifier,
        resolver: throwingResolver,
        log: fakeLog(),
      }),
    ).rejects.toThrow();
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

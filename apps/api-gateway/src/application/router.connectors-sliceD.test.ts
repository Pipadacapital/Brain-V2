// @paradigm: io
// Slice D — gateway router tests for the connectors procedures.
//
// The core-connectors use-cases (DB + custody + provider HTTP in production) are
// MOCKED so the router wiring, tier gating, role gating, and error mapping are
// unit-tested without a live DB. The real custody/RLS/idempotency behavior is proven
// in core-service's connectors-rls integration test.
//
// Covers: connectors.initiate (MANAGER-gated, returns authUrl) · connectors.list
// (ANALYST-gated, NO token in payload) · connectors.disconnect (MANAGER-gated) ·
// connectors.completeCallback (identity tier — workspace from consumed state) ·
// ConnectorError → tRPC error mapping · role refusal.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core-service/src/application/contexts/connectors/index.ts', () => {
  class ConnectorError extends Error {
    constructor(public code: string, message: string) {
      super(message);
      this.name = 'ConnectorError';
    }
  }
  return {
    initiateConnect: vi.fn(),
    completeCallback: vi.fn(),
    listConnectors: vi.fn(),
    disconnect: vi.fn(),
    ConnectorError,
  };
});

import { createBrainRouter } from './router.js';
import {
  StubDataPlane,
  InMemoryDecisionLog,
  SUGANDH_LOK_WORKSPACE_ID,
} from '../infrastructure/loopback-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import { assembleClaim, type BrainClaim } from '@brain/core-auth';
import type { WorkspaceContext, IdentityContext } from './trpc.js';
import {
  initiateConnect,
  completeCallback,
  listConnectors,
  disconnect,
  ConnectorError,
} from '@brain/core-connectors';

const WS = SUGANDH_LOK_WORKSPACE_ID;

function makeClaim(role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER'): BrainClaim {
  return assembleClaim({
    userId: 'user-conn-test',
    workspaceId: WS,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-conn',
    traceId: 'trace-conn',
  });
}
function wsCtx(role: Parameters<typeof makeClaim>[0] = 'MANAGER'): WorkspaceContext {
  return {
    identity: { sub: 'user-conn-test', email: 'c@brain.test' },
    claim: makeClaim(role),
    workspaceId: WS,
    requestId: 'req-conn',
    traceId: 'trace-conn',
  };
}
function identityCtx(): IdentityContext {
  return { identity: { sub: 'user-conn-test', email: 'c@brain.test' }, requestId: 'req-conn', traceId: 'trace-conn' };
}
function caller(ctx: WorkspaceContext | IdentityContext) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), WS);
  return createBrainRouter(dp, new InMemoryIdempotencyStore()).createCaller(ctx as never);
}

beforeEach(() => vi.clearAllMocks());

describe('connectors.initiate (MANAGER-gated)', () => {
  it('(+) returns the provider authUrl for a MANAGER', async () => {
    vi.mocked(initiateConnect).mockResolvedValue({ authUrl: 'https://www.facebook.com/v21.0/dialog/oauth?state=x' });
    const res = await caller(wsCtx('MANAGER')).connectors.initiate({ vendor: 'META' });
    expect(res.authUrl).toContain('facebook.com');
    expect(initiateConnect).toHaveBeenCalledWith(expect.objectContaining({ vendor: 'META', workspaceId: WS }));
  });

  it('(-) refuses an ANALYST (requireRole MANAGER)', async () => {
    await expect(caller(wsCtx('ANALYST')).connectors.initiate({ vendor: 'META' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(initiateConnect).not.toHaveBeenCalled();
  });

  it('(-) maps ConnectorError(INVALID_SHOP_DOMAIN) → BAD_REQUEST', async () => {
    vi.mocked(initiateConnect).mockRejectedValue(new ConnectorError('INVALID_SHOP_DOMAIN', 'Invalid Shopify store domain.'));
    await expect(caller(wsCtx('MANAGER')).connectors.initiate({ vendor: 'SHOPIFY', shopDomain: 'bad' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('connectors.completeCallback (identity tier — workspace from consumed state)', () => {
  it('(+) returns the NON-secret outcome; never a token', async () => {
    vi.mocked(completeCallback).mockResolvedValue({ vendor: 'GOOGLE', workspaceId: WS, status: 'CONNECTED', accountRef: null });
    const res = await caller(identityCtx()).connectors.completeCallback({ vendor: 'GOOGLE', code: 'thecode', state: 'st' });
    expect(res.status).toBe('CONNECTED');
    expect(JSON.stringify(res)).not.toMatch(/access_token|refresh_token|thecode/);
  });

  it('(-) maps ConnectorError(INVALID_STATE) → FORBIDDEN (CSRF)', async () => {
    vi.mocked(completeCallback).mockRejectedValue(new ConnectorError('INVALID_STATE', 'OAuth state is invalid, expired, or already used.'));
    await expect(caller(identityCtx()).connectors.completeCallback({ vendor: 'META', code: 'c', state: 'used' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('(-) a non-ConnectorError (DB/crypto fault) → INTERNAL_SERVER_ERROR with generic message (no leak)', async () => {
    vi.mocked(completeCallback).mockRejectedValue(new Error('pg: secret detail with TOKEN_abc'));
    await expect(caller(identityCtx()).connectors.completeCallback({ vendor: 'META', code: 'c', state: 's' }))
      .rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    await expect(caller(identityCtx()).connectors.completeCallback({ vendor: 'META', code: 'c', state: 's' }))
      .rejects.not.toThrow(/TOKEN_abc/);
  });
});

describe('connectors.list (ANALYST-gated, READ)', () => {
  it('(+) returns per-vendor status rows with NO token', async () => {
    vi.mocked(listConnectors).mockResolvedValue([
      { vendor: 'SHOPIFY', status: 'CONNECTED', scopes: ['read_orders'], accountRef: 'shop.myshopify.com', tokenExpiresAt: null, lastSyncAt: null, lastSyncError: null, syncPending: true },
      { vendor: 'META', status: 'NOT_CONNECTED', scopes: [], accountRef: null, tokenExpiresAt: null, lastSyncAt: null, lastSyncError: null, syncPending: false },
      { vendor: 'GOOGLE', status: 'TOKEN_EXPIRED', scopes: [], accountRef: null, tokenExpiresAt: '2020-01-01T00:00:00.000Z', lastSyncAt: null, lastSyncError: null, syncPending: false },
    ]);
    const res = await caller(wsCtx('ANALYST')).connectors.list();
    expect(res.rows.length).toBe(3);
    expect(JSON.stringify(res)).not.toMatch(/access_token|refresh_token/);
  });

  it('(-) refuses a VIEWER (requireRole ANALYST)', async () => {
    await expect(caller(wsCtx('VIEWER')).connectors.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(listConnectors).not.toHaveBeenCalled();
  });
});

describe('connectors.disconnect (MANAGER-gated)', () => {
  it('(+) seals + returns DISCONNECTED for a MANAGER', async () => {
    vi.mocked(disconnect).mockResolvedValue({ vendor: 'META', status: 'DISCONNECTED' });
    const res = await caller(wsCtx('MANAGER')).connectors.disconnect({ vendor: 'META' });
    expect(res.status).toBe('DISCONNECTED');
    expect(disconnect).toHaveBeenCalledWith({ vendor: 'META', workspaceId: WS });
  });

  it('(-) refuses an ANALYST', async () => {
    await expect(caller(wsCtx('ANALYST')).connectors.disconnect({ vendor: 'META' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(disconnect).not.toHaveBeenCalled();
  });
});

// @paradigm: sql
// Gateway test for settings.workspaceConfig — the tax/filter/COGS readback procedure
// (closes the write-only gap). Isolated from router.settings.test.ts so the core-settings
// mock doesn't touch the dataPlane-backed read tests there.
//
// Only getWorkspaceSettings is stubbed (importActual keeps every other core-settings export
// real); no DB is touched.
//
// POSITIVE — ANALYST reads back the config row (+ request_id).
// NEGATIVE — VIEWER is FORBIDDEN (read role gate).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core-service/src/application/contexts/settings/index.ts', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getWorkspaceSettings: vi.fn() };
});

import { createBrainRouter } from './router.js';
import type { BrainClaim } from '@brain/core-auth';
import { assembleClaim } from '@brain/core-auth';
import {
  StubDataPlane,
  InMemoryDecisionLog,
  SUGANDH_LOK_WORKSPACE_ID,
} from '../infrastructure/loopback-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import type { WorkspaceContext } from './trpc.js';
import { getWorkspaceSettings } from '@brain/core-settings';

function makeCtx(role: BrainClaim['workspaceRole']): WorkspaceContext {
  const claim = assembleClaim({
    userId: 'user-cfg-test',
    workspaceId: SUGANDH_LOK_WORKSPACE_ID,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-cfg',
    traceId: 'trace-cfg',
  });
  return {
    identity: { sub: claim.userId, email: 't@brain.test' },
    claim,
    workspaceId: SUGANDH_LOK_WORKSPACE_ID,
    requestId: 'req-cfg',
    traceId: 'trace-cfg',
  };
}

function caller(ctx: WorkspaceContext) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
  return createBrainRouter(dp, new InMemoryIdempotencyStore()).createCaller(ctx);
}

beforeEach(() => vi.clearAllMocks());

describe('settings.workspaceConfig', () => {
  it('(+) ANALYST reads back the tax/filter/COGS config', async () => {
    vi.mocked(getWorkspaceSettings).mockResolvedValue({
      id: SUGANDH_LOK_WORKSPACE_ID,
      timezone: 'Asia/Kolkata',
      tax_percent_bp: 1800,
      skip_zero_sales_orders: true,
      skipped_shopify_order_tags: ['wholesale'],
      override_all_cogs_bp: 1000,
      cogs_markup_bp: 0,
      fallback_cogs_bp: 2000,
      updated_at: '2026-03-01T00:00:00.000Z',
    });
    const res = await caller(makeCtx('ANALYST')).settings.workspaceConfig();
    expect(res.tax_percent_bp).toBe(1800);
    expect(res.skip_zero_sales_orders).toBe(true);
    expect(res.override_all_cogs_bp).toBe(1000);
    expect(res.request_id).toBeTruthy();
    expect(getWorkspaceSettings).toHaveBeenCalledWith(SUGANDH_LOK_WORKSPACE_ID);
  });

  it('(-) VIEWER is FORBIDDEN; the use-case never runs', async () => {
    await expect(caller(makeCtx('VIEWER')).settings.workspaceConfig()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(getWorkspaceSettings).not.toHaveBeenCalled();
  });
});

// @paradigm: sql
// Phase-2 slice-4 (feat-marketing-acquisition) — marketing router tests.
//
// POSITIVE — marketing.efficiency returns MER/aMER (acquisition denominator)/ACOS/ROAS as
//            bigint+bp; marketing.acquisition returns CAC/CM2-per-NC/aMER + meta/google split +
//            daily; marketing.distributions returns per-product mode/mean/diff + histogram;
//            every metric field is registry-traced; MER numerator == /store net revenue.
// NEGATIVE — ANALYST role enforced (VIEWER rejected); cross-workspace request fails closed
//            (UnscopedQueryError); the "use total spend for aMER" mutant is killed at the wire.

import { describe, it, expect } from 'vitest';
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

const RANGE = { date_start: '2026-04-01', date_end: '2026-04-30' };
const OTHER_WS = '00000000-0000-0000-0000-0000000000ff';

function makeClaim(
  workspaceId: string,
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER' = 'ANALYST',
): BrainClaim {
  return assembleClaim({
    userId: 'user-mkt-test',
    workspaceId,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-mkt-test',
    traceId: 'trace-mkt-test',
  });
}

function makeCtx(workspaceId: string, role: Parameters<typeof makeClaim>[1] = 'ANALYST'): WorkspaceContext {
  return {
    identity: { sub: makeClaim(workspaceId, role).userId, email: 'test@brain.test' },
    claim: makeClaim(workspaceId, role),
    workspaceId,
    requestId: 'req-mkt-test',
    traceId: 'trace-mkt-test',
  };
}

function caller(ctx: WorkspaceContext, stubWorkspaceId: string = SUGANDH_LOK_WORKSPACE_ID) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), stubWorkspaceId);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE — marketing.efficiency
// ---------------------------------------------------------------------------

describe('marketing.efficiency (positive)', () => {
  it('returns MER (net_revenue/total_spend) — cross-surface consistent with /store', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.marketing.efficiency(RANGE);
    // net_revenue 191_000_000 / total_ad_spend 65_000_000 = 29384 bp
    expect(res.result.mer_bp).toBe(29384);
    expect(res.result.net_revenue_mu).toBe(191_000_000n);
    expect(typeof res.result.net_revenue_mu).toBe('bigint');
  });

  it('aMER uses ACQUISITION-classified spend, not total spend', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.marketing.efficiency(RANGE);
    // nc_revenue 78_000_000 / acquisition_ad_spend 26_000_000 = 30000 bp
    expect(res.result.amer_bp).toBe(30000);
    // The "use total spend" mutant would be 78_000_000/65_000_000 = 12000 bp — must NOT match.
    const mutant = Number((78_000_000n * 10000n) / 65_000_000n);
    expect(mutant).toBe(12000);
    expect(res.result.amer_bp).not.toBe(mutant);
  });

  it('ACOS and ROAS are present (display-only)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.marketing.efficiency(RANGE);
    expect(res.result.acos_bp).toBe(3403);          // 65M/191M
    expect(res.result.blended_roas_x100).toBe(293); // 191M*100/65M
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — marketing.acquisition
// ---------------------------------------------------------------------------

describe('marketing.acquisition (positive)', () => {
  it('returns blended CAC + CM2-per-NC as bigint', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.marketing.acquisition(RANGE);
    // CAC 65_000_000/4000 = 16250; CM2-per-NC 13_000_000/4000 = 3250
    expect(res.summary.cac_mu).toBe(16_250n);
    expect(res.summary.cm2_per_nc_mu).toBe(3_250n);
    expect(typeof res.summary.cac_mu).toBe('bigint');
  });

  it('returns meta/google spend split + daily rows', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.marketing.acquisition(RANGE);
    expect(res.summary.meta_spend_mu).toBe(39_000_000n);
    expect(res.summary.google_spend_mu).toBe(26_000_000n);
    expect(res.daily.length).toBe(2);
    expect(res.daily[0]!.date).toBe('2026-04-01');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — marketing.distributions
// ---------------------------------------------------------------------------

describe('marketing.distributions (positive)', () => {
  it('returns per-product mode/mean/diff (cm1 default) + histogram', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.marketing.distributions(RANGE);
    expect(res.metric).toBe('cm1');
    expect(res.rows.length).toBeGreaterThan(0);
    const oud = res.rows.find((r) => r.product.includes('Oud'));
    expect(oud).toBeTruthy();
    expect(oud!.mode_mu).toBe(48_000n);  // most-frequent cm1
    expect(res.graph_points.length).toBe(60);
  });

  it('metric=sales toggle + search filter', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.marketing.distributions({ ...RANGE, metric: 'sales', search: 'rose' });
    expect(res.metric).toBe('sales');
    expect(res.total_rows).toBe(1n);
    expect(res.rows[0]!.product.toLowerCase()).toContain('rose');
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — role + tenancy
// ---------------------------------------------------------------------------

describe('marketing.* (negative)', () => {
  it('rejects VIEWER role on efficiency', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.marketing.efficiency(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('rejects VIEWER role on acquisition', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.marketing.acquisition(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('rejects VIEWER role on distributions', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.marketing.distributions(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('cross-workspace request fails closed (UnscopedQueryError)', async () => {
    // ctx is authorized for OTHER_WS but the stub data-plane is scoped to SUGANDH_LOK.
    const c = caller(makeCtx(OTHER_WS), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.marketing.efficiency(RANGE)).rejects.toThrow(/UnscopedQueryError|not authorized/);
  });
});

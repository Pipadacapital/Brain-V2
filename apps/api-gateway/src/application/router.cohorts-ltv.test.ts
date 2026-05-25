// @paradigm: sql
// Phase-2 slice-5 (feat-cohorts-ltv) — cohorts + ltv router tests.
//
// POSITIVE — cohorts.matrix returns per-cohort CAC/rr90/payback(centi-months)/cohort_ltv/ltv_cac
//            as bigint+bp; the cumulative bucket-walk payback (1.0mo) KILLS the flat ratio mutant;
//            ltv.summary returns the dimensioned CM2 curve (cumulative) + summary cards + pagination.
// NEGATIVE — ANALYST role enforced (VIEWER rejected); cross-workspace fails closed; cohorts use CM3
//            (cohort_ltv > the CM2-only value would be); LTV has NO CAC field (Finding 2).

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
    userId: 'user-cohort-test',
    workspaceId,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-cohort-test',
    traceId: 'trace-cohort-test',
  });
}

function makeCtx(workspaceId: string, role: Parameters<typeof makeClaim>[1] = 'ANALYST'): WorkspaceContext {
  return {
    identity: { sub: makeClaim(workspaceId, role).userId, email: 'test@brain.test' },
    claim: makeClaim(workspaceId, role),
    workspaceId,
    requestId: 'req-cohort-test',
    traceId: 'trace-cohort-test',
  };
}

function caller(ctx: WorkspaceContext, stubWorkspaceId: string = SUGANDH_LOK_WORKSPACE_ID) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), stubWorkspaceId);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE — cohorts.matrix
// ---------------------------------------------------------------------------

describe('cohorts.matrix (positive)', () => {
  it('returns per-cohort CAC + rr90 as bigint/bp', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.cohorts.matrix(RANGE);
    const jan = res.rows.find((r) => r.cohort_month === '2026-01')!;
    expect(jan.cac_mu).toBe(50_000n); // 50_000_000 / 1000
    expect(typeof jan.cac_mu).toBe('bigint');
    expect(jan.rr90_bp).toBe(3000);   // 300/1000 = 30%
  });

  it('cohort_ltv is cumulative realized CM3 (Finding 1) and feeds ltv_cac', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.cohorts.matrix(RANGE);
    const jan = res.rows.find((r) => r.cohort_month === '2026-01')!;
    // ltv = firstOrderR 30000 + per-cust cm3 (20000 + 10000) = 60000; cac 50000 → ltv_cac 12000bp
    expect(jan.cohort_ltv_mu).toBe(60_000n);
    expect(jan.ltv_cac_bp).toBe(12000);
  });

  it('CF-S5-COHORT-PAYBACK-1: cumulative bucket-walk payback KILLS the flat-ratio mutant', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.cohorts.matrix({ ...RANGE, metric: 'cm3', mode: 'post' });
    const jan = res.rows.find((r) => r.cohort_month === '2026-01')!;
    // cum0 = 30000 − 50000 = −20000; M1 cum=0 → interpolate (0 + 100*20000/20000) = 100 centi-months.
    expect(jan.payback_centimonths).toBe(100); // 1.0 month
    // Flat phantom CAC/MonthlyCM2 = intDiv(50000,20000)=2mo (200 centi) — must NOT match.
    const flatMutant = Math.trunc(50_000 / 20_000) * 100;
    expect(flatMutant).toBe(200);
    expect(jan.payback_centimonths).not.toBe(flatMutant);
  });

  it('summary average CAC/repeat/payback present', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.cohorts.matrix(RANGE);
    // total spend 82_000_000 / total new 1800 = 45555
    expect(res.result.average_cac_mu).toBe(45_555n);
    expect(res.result.new_customers).toBe(1800n);
    expect(res.result.average_payback_centimonths).not.toBeNull();
  });

  it('cm3+post keeps incremental; cumulative seeds first order', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const post = await c.cohorts.matrix({ ...RANGE, metric: 'cm3', mode: 'post' });
    const cum = await c.cohorts.matrix({ ...RANGE, metric: 'cm3', mode: 'cumulative' });
    const janPost = post.rows.find((r) => r.cohort_month === '2026-01')!;
    const janCum = cum.rows.find((r) => r.cohort_month === '2026-01')!;
    expect(janPost.m[0]).toBe(20_000n);             // incremental M1
    expect(janCum.m[0]).toBe(50_000n);              // 30000 fo + 20000 M1
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — ltv.summary
// ---------------------------------------------------------------------------

describe('ltv.summary (positive)', () => {
  it('CF-S5-LTV-CUM-1: cumulative CM2 curve seeds first order', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.ltv.summary({ ...RANGE, metric: 'cm2', mode: 'cumulative', dimension: 'product' });
    const oud = res.rows.find((r) => r.dimension_label.includes('Oud'))!;
    // fo 1000000 + M1 500000 = 1500000; + M2 300000 = 1800000
    expect(oud.m[0]).toBe(1_500_000n);
    expect(oud.m[1]).toBe(1_800_000n);
    expect(typeof oud.first_order_realized_mu).toBe('bigint');
  });

  it('incremental mode shows per-customer increments (kills cumulative confusion)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.ltv.summary({ ...RANGE, metric: 'cm2', mode: 'incremental' });
    const oud = res.rows.find((r) => r.dimension_label.includes('Oud'))!;
    expect(oud.m[0]).toBe(500_000n);
    expect(oud.m[0]).not.toBe(1_500_000n);
  });

  it('LTV row has NO cac field (Finding 2: CAC is a cohort concept, not LTV)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.ltv.summary(RANGE);
    expect(res.rows[0]).not.toHaveProperty('cac_mu');
    expect(res.rows[0]).not.toHaveProperty('payback_centimonths');
  });

  it('pagination + search', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const all = await c.ltv.summary(RANGE);
    expect(all.total_rows).toBe(2n);
    const search = await c.ltv.summary({ ...RANGE, search: 'rose' });
    expect(search.total_rows).toBe(1n);
    expect(search.rows[0]!.dimension_label.toLowerCase()).toContain('rose');
  });

  it('repeat_rate metric forces first order to 0', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.ltv.summary({ ...RANGE, metric: 'repeat_rate', mode: 'incremental' });
    const oud = res.rows.find((r) => r.dimension_label.includes('Oud'))!;
    expect(oud.first_order_realized_mu).toBe(0n);
    expect(oud.m[0]).toBe(4000n); // 240/600 = 40% (bp stored as bigint in m[])
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — role + tenancy
// ---------------------------------------------------------------------------

describe('cohorts/ltv (negative)', () => {
  it('rejects VIEWER role on cohorts.matrix', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.cohorts.matrix(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('rejects VIEWER role on ltv.summary', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.ltv.summary(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('cohorts.matrix cross-workspace fails closed (UnscopedQueryError)', async () => {
    const c = caller(makeCtx(OTHER_WS), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.cohorts.matrix(RANGE)).rejects.toThrow(/UnscopedQueryError|not authorized/);
  });

  it('ltv.summary cross-workspace fails closed (UnscopedQueryError)', async () => {
    const c = caller(makeCtx(OTHER_WS), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.ltv.summary(RANGE)).rejects.toThrow(/UnscopedQueryError|not authorized/);
  });
});

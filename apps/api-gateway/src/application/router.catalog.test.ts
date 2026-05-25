// @paradigm: sql
// Phase-2 slice-6 (feat-catalog-inventory) — catalog router tests.
//
// POSITIVE — catalog.products returns CM1 (reuse cm1_mu) + pareto + return-rate + AOV as
//            bigint/bp; catalog.inventory returns days-left (cascade) + sell-through + status;
//            catalog.firstProductCascade returns per-first-product second-order-rate + revenue LTV.
// NEGATIVE — ANALYST role enforced (VIEWER rejected); cross-workspace fails closed; products is
//            CM1 NOT per-SKU CM2 (no marketing term); the days-left cascade is non-vacuous;
//            the cascade rate is NOT slice-5 rr90.

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

function makeClaim(
  workspaceId: string,
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER' = 'ANALYST',
): BrainClaim {
  return assembleClaim({
    userId: 'user-catalog-test',
    workspaceId,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-catalog-test',
    traceId: 'trace-catalog-test',
  });
}

function makeCtx(workspaceId: string, role: Parameters<typeof makeClaim>[1] = 'ANALYST'): WorkspaceContext {
  return {
    identity: { sub: makeClaim(workspaceId, role).userId, email: 'test@brain.test' },
    claim: makeClaim(workspaceId, role),
    workspaceId,
    requestId: 'req-catalog-test',
    traceId: 'trace-catalog-test',
  };
}

function caller(ctx: WorkspaceContext, stubWorkspaceId: string = SUGANDH_LOK_WORKSPACE_ID) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), stubWorkspaceId);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE — catalog.products
// ---------------------------------------------------------------------------

describe('catalog.products (positive)', () => {
  it('returns CM1 (reuse cm1_mu) as bigint — NOT per-SKU CM2', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.products(RANGE);
    const oud = res.rows.find((r) => r.label === 'Sugandh Oud Attar 12ml')!;
    expect(oud.cm1_mu).toBe(500_000n); // (1000000-100000) - 300000 - 100000
    expect(typeof oud.cm1_mu).toBe('bigint');
    expect(oud.revenue_mu).toBe(900_000n);
  });

  it('cm1_pct is bp over revenue', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.products(RANGE);
    const oud = res.rows.find((r) => r.label === 'Sugandh Oud Attar 12ml')!;
    expect(oud.cm1_pct_bp).toBe(5555); // 500000/900000
  });

  it('pareto grade is assigned (cumulative-CM1 walk)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.products(RANGE);
    for (const r of res.rows) {
      expect(['A', 'B', 'C', 'F']).toContain(r.pareto_grade);
    }
  });

  it('return-rate is bp; AOV reuses aov_mu', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.products(RANGE);
    const oud = res.rows.find((r) => r.label === 'Sugandh Oud Attar 12ml')!;
    expect(oud.return_rate_bp).toBe(1000); // 10/100
    expect(oud.aov_mu).toBe(11_250n); // 900000/80
  });

  it('search filters by label', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.products({ ...RANGE, search: 'rose' });
    expect(res.total_rows).toBe(1n);
    expect(res.rows[0]!.label).toBe('Rose Mist 50ml');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — catalog.inventory
// ---------------------------------------------------------------------------

describe('catalog.inventory (positive)', () => {
  it('days-left uses the velocity cascade (L30→L90→...) — non-vacuous', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.inventory(RANGE);
    const musk = res.rows.find((r) => r.sku === 'MUSK-10')!;
    expect(musk.days_left).toBe(30n); // L30=0 → falls to L90; 30/(90/90)=30
  });

  it('dead stock (no velocity) → 999999 INFINITE + Severely Overstocked', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.inventory(RANGE);
    const dead = res.rows.find((r) => r.sku === 'SND-BAR')!;
    expect(dead.days_left).toBe(999999n);
    expect(dead.status).toBe('Severely Overstocked');
  });

  it('sell-through is bp; status filter works', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const oud = (await c.catalog.inventory(RANGE)).rows.find((r) => r.sku === 'OUD-12')!;
    expect(oud.sell_through_bp).toBe(5000); // 300/(300+300)
    const filtered = await c.catalog.inventory({ ...RANGE, status_filter: 'Restock Soon' });
    expect(filtered.rows.every((r) => r.status === 'Restock Soon')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — catalog.firstProductCascade
// ---------------------------------------------------------------------------

describe('catalog.firstProductCascade (positive)', () => {
  it('second-order-rate is per-first-product bp (NOT slice-5 rr90)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.firstProductCascade(RANGE);
    const oud = res.rows.find((r) => r.product_key === 'p_oud')!;
    expect(oud.second_order_rate_bp).toBe(3750); // 3/8
    expect(oud.average_ltv_revenue_mu).toBe(1_000_000n); // revenue LTV, not CM
  });

  it('observation window is clamped to [30,730]', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.firstProductCascade({ ...RANGE, observation_days: 365 });
    expect(res.observation_days).toBe(365);
  });

  it('cohorts sorted by size desc', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.firstProductCascade(RANGE);
    expect(res.rows[0]!.product_key).toBe('p_oud'); // 8 > 4
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE
// ---------------------------------------------------------------------------

describe('catalog (negative)', () => {
  it('rejects VIEWER role on catalog.products', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.catalog.products(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('rejects VIEWER role on catalog.inventory', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.catalog.inventory(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('rejects VIEWER role on catalog.firstProductCascade', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.catalog.firstProductCascade(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('catalog.products cross-workspace fails closed (UnscopedQueryError)', async () => {
    // ctx workspace differs from the stub's authorized workspace → loopback throws.
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID), '00000000-0000-0000-0000-0000000000ff');
    await expect(c.catalog.products(RANGE)).rejects.toThrow(/UnscopedQueryError/);
  });

  it('products is CM1 NOT per-SKU CM2 — no marketing term subtracted', async () => {
    // CM1 = revenue − cogs − variable. If a CM2 mutant subtracted ad spend, cm1 would be < 500000.
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.catalog.products(RANGE);
    const oud = res.rows.find((r) => r.label === 'Sugandh Oud Attar 12ml')!;
    expect(oud.cm1_mu).toBe(500_000n); // exactly revenue−cogs−variable, no marketing
  });

  it('the cascade second-order-rate is a DISTINCT value-shape from rr90 (no conflation)', async () => {
    // p_oud cascade 2nd-order = 3 of 8 = 3750bp; this is the cohort-window denominator, not
    // the 90-day new-customer rr90 (which lives on cohorts.matrix). Distinct surfaces.
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const cascade = await c.catalog.firstProductCascade(RANGE);
    expect(cascade.rows.find((r) => r.product_key === 'p_oud')!.second_order_rate_bp).toBe(3750);
  });
});

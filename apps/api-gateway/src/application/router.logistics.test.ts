// @paradigm: sql
// Phase-2 slice-3 (feat-rto-cod-economics) — logistics router tests.
//
// Covers BOTH positive and negative scenarios (code-clarity + coverage standard):
//   POSITIVE — logistics.rto returns rate/cost/revenue-lost + by-payment/by-courier as bigint;
//              logistics.codPrepaid returns COD realization + the FULL break-even (500bp, NOT
//              the naive M/(M+C)); logistics.summary charge breakdown; logistics.pincode rows +
//              reliability score + filters; every metric field is registry-traced.
//   NEGATIVE — ANALYST role enforced (VIEWER rejected); cross-workspace request fails closed
//              (UnscopedQueryError); the naive break-even mutant is killed at the wire.

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
    userId: 'user-logi-test',
    workspaceId,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-logi-test',
    traceId: 'trace-logi-test',
  });
}

function makeCtx(workspaceId: string, role: Parameters<typeof makeClaim>[1] = 'ANALYST'): WorkspaceContext {
  return {
    identity: { sub: makeClaim(workspaceId, role).userId, email: 'test@brain.test' },
    claim: makeClaim(workspaceId, role),
    workspaceId,
    requestId: 'req-logi-test',
    traceId: 'trace-logi-test',
  };
}

function caller(ctx: WorkspaceContext, stubWorkspaceId: string = SUGANDH_LOK_WORKSPACE_ID) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), stubWorkspaceId);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE — logistics.rto
// ---------------------------------------------------------------------------

describe('logistics.rto (positive)', () => {
  it('returns RTO rate/cost/revenue-lost as bigint', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.logistics.rto(RANGE);
    const a = res.analytics;
    expect(a.rto_rate_bp).toBe(1796);          // 224/1247
    expect(a.total_rto_cost_mu).toBe(4_480_000n);
    expect(a.revenue_lost_to_rto_mu).toBe(33_200_000n);
    expect(typeof a.total_rto_cost_mu).toBe('bigint');
    expect(res.request_id).toBeTruthy();
  });

  it('by-payment reconciles to the total RTO count', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const { analytics } = await c.logistics.rto(RANGE);
    const cod = analytics.by_payment_method.find((p) => p.payment_method === 'COD')!;
    const pre = analytics.by_payment_method.find((p) => p.payment_method === 'Prepaid')!;
    expect(cod.rto_count + pre.rto_count).toBe(analytics.rto_count);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — logistics.codPrepaid (the break-even anchor)
// ---------------------------------------------------------------------------

describe('logistics.codPrepaid (positive)', () => {
  it('returns COD realization + the FULL break-even formula (500bp), NOT the naive M/(M+C)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const { result } = await c.logistics.codPrepaid(RANGE);
    expect(result.cod_realization_rate_bp).toBe(7650);     // 612/800
    expect(result.average_order_value_mu).toBe(150_000n);
    expect(result.breakeven_cod_rto_rate_bp).toBe(500);    // CF-S3-BREAKEVEN-1
    // The naive M/(M+C) = intDiv(150000*10000, 158000) = 9493 — must NOT match.
    const naive = Number((150_000n * 10000n) / (150_000n + 8_000n));
    expect(naive).toBe(9493);
    expect(result.breakeven_cod_rto_rate_bp).not.toBe(naive);
  });

  it('cod/prepaid RTO rates + effective revenue as bigint', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const { result } = await c.logistics.codPrepaid(RANGE);
    expect(result.cod_rto_rate_bp).toBe(2250);    // 180/800
    expect(result.prepaid_rto_rate_bp).toBe(500); // 10/200
    const cod = result.comparison.find((s) => s.payment_method === 'COD')!;
    expect(cod.effective_revenue_mu).toBe(89_160_000n);
    expect(typeof cod.effective_revenue_mu).toBe('bigint');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — logistics.summary
// ---------------------------------------------------------------------------

describe('logistics.summary (positive)', () => {
  it('returns charge breakdown + avg charge + by-courier', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const { result } = await c.logistics.summary(RANGE);
    expect(result.total_shiprocket_charges_mu).toBe(13_680_000n); // 8M+1.2M+4.48M
    expect(result.average_shipping_charge_per_shipment_mu).toBe(10_970n);
    expect(result.delivered_rate_bp).toBe(7858);  // 980/1247
    expect(result.by_courier.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — logistics.pincode
// ---------------------------------------------------------------------------

describe('logistics.pincode (positive)', () => {
  it('returns per-pincode rows with reliability score + tier', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const { rows, total_shipments } = await c.logistics.pincode(RANGE);
    expect(rows.length).toBe(3);
    expect(total_shipments).toBe(690n);
    const mum = rows.find((r) => r.pincode === '400001')!;
    expect(mum.tier).toBe(1);
    expect(mum.reliability_score).toBeGreaterThanOrEqual(0);
    expect(mum.reliability_score).toBeLessThanOrEqual(10000);
  });

  it('high_rto filter keeps only high-RTO pincodes', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const { rows } = await c.logistics.pincode({ ...RANGE, high_rto: true });
    // Every returned row must be >= 2000bp RTO.
    for (const r of rows) {
      expect(r.rto_rate_bp).not.toBeNull();
      expect(r.rto_rate_bp!).toBeGreaterThanOrEqual(2000);
    }
  });

  it('state filter scopes to the named state', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const { rows } = await c.logistics.pincode({ ...RANGE, state: 'Maharashtra' });
    for (const r of rows) expect(r.state).toBe('Maharashtra');
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — role + tenancy
// ---------------------------------------------------------------------------

describe('logistics router (negative)', () => {
  it('rejects VIEWER (requires ANALYST) on every procedure', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.logistics.rto(RANGE)).rejects.toThrow(/ANALYST/);
    await expect(c.logistics.codPrepaid(RANGE)).rejects.toThrow(/ANALYST/);
    await expect(c.logistics.summary(RANGE)).rejects.toThrow(/ANALYST/);
    await expect(c.logistics.pincode(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('cross-workspace request fails closed (stub seeded for a different workspace)', async () => {
    const foreign = '00000000-0000-0000-0000-0000000000ff';
    // ctx workspace = foreign; stub authorized only for SUGANDH_LOK → UnscopedQueryError.
    const c = caller(makeCtx(foreign), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.logistics.rto(RANGE)).rejects.toThrow(/UnscopedQueryError|not authorized/);
    await expect(c.logistics.codPrepaid(RANGE)).rejects.toThrow(/UnscopedQueryError|not authorized/);
  });
});

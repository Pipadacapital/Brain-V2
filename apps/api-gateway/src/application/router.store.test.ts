// @paradigm: sql
// Phase-2 slice-1 (feat-store-order-fact-layer) — store router tests.
//
// Covers BOTH positive and negative scenarios (code-clarity + coverage standard):
//   POSITIVE — store.summary returns the canonical Sugandh-Lok ladder as bigint;
//              store.revenueLadder returns 5 ordered registry-traced rungs;
//              realized < net_revenue (the honesty guarantee); dashboard KPI
//              net_revenue == store realized_revenue (same canonical fact).
//   NEGATIVE — ANALYST role enforced (VIEWER rejected); cross-workspace request
//              fails closed (UnscopedQueryError surfaced); an orphan ladder step
//              fails the G-REGISTRY-ONLY traceability assertion.

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
import { assertLadderDefinitionId } from '../domain/registry-mapper.js';
import type { WorkspaceContext } from './trpc.js';

const RANGE = { date_start: '2026-04-01', date_end: '2026-04-30' };

function makeClaim(
  workspaceId: string,
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER' = 'ANALYST',
): BrainClaim {
  return assembleClaim({
    userId: 'user-store-test',
    workspaceId,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-store-test',
    traceId: 'trace-store-test',
  });
}

function makeCtx(workspaceId: string, role: Parameters<typeof makeClaim>[1] = 'ANALYST'): WorkspaceContext {
  return {
    claim: makeClaim(workspaceId, role),
    workspaceId,
    requestId: 'req-store-test',
    traceId: 'trace-store-test',
  };
}

function caller(ctx: WorkspaceContext, stubWorkspaceId: string = SUGANDH_LOK_WORKSPACE_ID) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), stubWorkspaceId);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE
// ---------------------------------------------------------------------------

describe('store.summary (positive)', () => {
  it('returns the canonical Sugandh-Lok revenue ladder as bigint', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.store.summary(RANGE);

    expect(res.summary.gross_sales_mu).toBe(218_000_000n);
    expect(res.summary.total_discount_mu).toBe(12_000_000n);
    expect(res.summary.net_sales_mu).toBe(206_000_000n);   // gross - discount
    expect(res.summary.total_tax_mu).toBe(18_000_000n);    // per-SKU GST sum
    expect(res.summary.net_net_tax_mu).toBe(188_000_000n); // net_sales - tax
    expect(res.summary.net_revenue_mu).toBe(191_000_000n); // net_net_tax + shipping
    expect(res.summary.realized_revenue_mu).toBe(185_000_000n); // honest base
    expect(typeof res.summary.gross_sales_mu).toBe('bigint');
    expect(res.summary.currency_code).toBe('INR');
    expect(typeof res.request_id).toBe('string');
  });

  it('realized revenue is strictly below net revenue (reversals bite)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.store.summary(RANGE);
    expect(res.summary.realized_revenue_mu).toBeLessThan(res.summary.net_revenue_mu);
  });

  it('honors the ladder economic invariants', async () => {
    // gross >= net_sales >= net_of_tax (discounts then tax reduce);
    // net_revenue adds shipping back (so it may exceed net_of_tax);
    // realized <= net_revenue (post-sale reversals reduce it).
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const s = (await c.store.summary(RANGE)).summary;
    expect(s.gross_sales_mu).toBeGreaterThanOrEqual(s.net_sales_mu);
    expect(s.net_sales_mu).toBeGreaterThanOrEqual(s.net_net_tax_mu);
    expect(s.net_revenue_mu).toBe(s.net_net_tax_mu + s.shipping_revenue_mu);
    expect(s.realized_revenue_mu).toBeLessThanOrEqual(s.net_revenue_mu);
  });
});

describe('store.revenueLadder (positive)', () => {
  it('returns 5 ordered, registry-traced rungs', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.store.revenueLadder(RANGE);
    expect(res.ladder.map((s) => s.definition_id)).toEqual([
      'gross_sales_mu',
      'net_sales_mu',
      'net_net_tax_mu',
      'net_revenue_mu',
      'realized_revenue_mu',
    ]);
    // each rung traces to the registry (no throw)
    for (const step of res.ladder) {
      expect(() => assertLadderDefinitionId(step)).not.toThrow();
    }
    expect(res.currency_code).toBe('INR');
  });
});

describe('dashboard/store consistency (positive)', () => {
  it('dashboard KPI net_revenue equals the store realized_revenue (same canonical fact)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const kpi = await c.metrics.kpiSummary(RANGE);
    const store = await c.store.summary(RANGE);
    // The dashboard headline net_revenue is the canonical realized revenue —
    // proving the dashboard reads the SAME canonical facts, not a separate stub.
    expect(kpi.summary.net_revenue_mu).toBe(store.summary.realized_revenue_mu);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE
// ---------------------------------------------------------------------------

describe('store.summary (negative)', () => {
  it('rejects a VIEWER (requireRole ANALYST)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.store.summary(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('fails closed on a cross-workspace request (stub authorizes a DIFFERENT ws)', async () => {
    // The claim is for ws A; the stub data plane only authorizes ws B.
    // The workspaceMiddleware passes (ctx.workspaceId === claim.workspaceId),
    // but the data plane rejects the unauthorized workspace_id (UnscopedQueryError).
    const otherWs = '00000000-0000-0000-0000-0000000000ff';
    const c = caller(makeCtx(otherWs), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.store.summary(RANGE)).rejects.toThrow(/UnscopedQueryError|not authorized/);
  });
});

describe('G-REGISTRY-ONLY ladder traceability (negative / killed mutant)', () => {
  it('throws on an orphan ladder step not in the registry', () => {
    expect(() =>
      assertLadderDefinitionId({ definition_id: 'made_up_mu', label: 'x', value_mu: 1n }),
    ).toThrow(/G-REGISTRY-ONLY VIOLATION/);
  });
});

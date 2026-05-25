// @paradigm: sql
// Phase-2 slice-8 (feat-lifecycle-timings-email) — lifecycle router tests. READ/ANALYTICS ONLY.
//
// POSITIVE — lifecycle.states returns recency-vs-percentile buckets + net_active (new+active);
//            lifecycle.timings returns inter-order gap medians + repeat bp + reactivation window
//            (0.8×median, NOT the full interval); lifecycle.emailSms returns open/click rate bp +
//            revenue-per-recipient (REPORTING), grouped by campaign/channel/dow.
// NEGATIVE — ANALYST role enforced on all reads (VIEWER rejected); cross-workspace fails closed;
//            reactivation 0.8 factor is load-bearing (full-interval mutant killed); the email
//            click-rate denominator is delivered NOT opens (÷opens mutant killed).
// 🚨 COMPLIANCE — the router exposes ONLY .query procedures on lifecycle; there is NO .mutation,
//            NO send/dispatch surface (asserted structurally below). Shreya S4.

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

const RANGE = { date_start: '2026-05-01', date_end: '2026-05-31' };
const FOREIGN_WS = '00000000-0000-0000-0000-000000000099';

function makeClaim(
  workspaceId: string,
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER' = 'ANALYST',
): BrainClaim {
  return assembleClaim({
    userId: 'user-lifecycle-test',
    workspaceId,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-lifecycle-test',
    traceId: 'trace-lifecycle-test',
  });
}

function makeCtx(workspaceId: string, role: Parameters<typeof makeClaim>[1] = 'ANALYST'): WorkspaceContext {
  return {
    claim: makeClaim(workspaceId, role),
    workspaceId,
    requestId: 'req-lifecycle-test',
    traceId: 'trace-lifecycle-test',
  };
}

function caller(ctx: WorkspaceContext, stubWorkspaceId: string = SUGANDH_LOK_WORKSPACE_ID) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), stubWorkspaceId);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE — lifecycle.states
// ---------------------------------------------------------------------------

describe('lifecycle.states (positive — recency buckets, NOT RFM scoring)', () => {
  it('returns 4 buckets + net_active = new + active', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.lifecycle.states(RANGE);
    const byBucket = Object.fromEntries(res.buckets.map((b) => [b.bucket, b]));
    expect(Object.keys(byBucket).sort()).toEqual(['active', 'at_risk', 'churned', 'new']);
    // net_active = new(120) + active(340) = 460
    expect(res.net_active).toBe(460n);
    expect(res.result.p40_days).toBe(30);
    expect(res.result.p80_days).toBe(75);
    expect(typeof byBucket['new'].revenue_mu).toBe('bigint');
  });

  it('reports unattributed revenue separately (never folded into a bucket)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.lifecycle.states(RANGE);
    expect(res.result.unattributed_revenue_mu).toBe(850000n);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — lifecycle.timings
// ---------------------------------------------------------------------------

describe('lifecycle.timings (positive — gaps + reactivation, NOT best-send-time)', () => {
  it('summary: median 1→2 = 32, reactivation = round(0.8×32) = 26 (NOT 32)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.lifecycle.timings(RANGE);
    expect(res.summary.days_1to2).toBe(32);
    expect(res.summary.reactivation_window_days).toBe(26); // round(0.8×32)
    // NON-VACUOUS: reactivation must NOT equal the full interval (the dropped-0.8 mutant).
    expect(res.summary.reactivation_window_days).not.toBe(res.summary.days_1to2);
  });

  it('summary repeat percentages in bp: 2nd 44.00%, 3rd 18.00%, 4th 7.00%', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.lifecycle.timings(RANGE);
    expect(res.summary.second_orders_bp).toBe(4400);
    expect(res.summary.third_orders_bp).toBe(1800);
    expect(res.summary.fourth_orders_bp).toBe(700);
  });

  it('groups sorted by first_orders desc (p-oud first)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.lifecycle.timings(RANGE);
    expect(res.groups[0].group_id).toBe('p-oud');
    expect(res.groups[0].reactivation_window_days).toBe(22); // round(0.8×28)
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — lifecycle.emailSms (REPORTING)
// ---------------------------------------------------------------------------

describe('lifecycle.emailSms (positive — performance REPORTING, never sending)', () => {
  it('campaign rows carry open/click rate bp + revenue-per-recipient', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.lifecycle.emailSms({ ...RANGE, group_by: 'campaign' });
    const diwali = res.rows.find((r) => r.key === 'c:diwali')!;
    expect(diwali.open_rate_bp).toBe(4500);  // 5400/12000
    expect(diwali.click_rate_bp).toBe(1200); // 1440/12000
    // revenue 96_00_000µ / 12000 = 800µ per recipient
    expect(diwali.revenue_per_recipient_mu).toBe(800n);
    // NON-VACUOUS: click denominator is delivered, NOT opens (÷opens would be 2666bp).
    expect(diwali.click_rate_bp).not.toBe(2666);
  });

  it('sms channel rows report rates too (open_rate 0 when no opens)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.lifecycle.emailSms({ ...RANGE, group_by: 'channel' });
    const sms = res.rows.find((r) => r.key === 'ch:sms')!;
    expect(sms.channel).toBe('sms');
    expect(sms.open_rate_bp).toBe(0); // 0 opens / 5000 delivered
    expect(sms.click_rate_bp).toBe(500); // 250/5000
  });

  it('dow grouping sorted by weekday key', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.lifecycle.emailSms({ ...RANGE, group_by: 'dow' });
    expect(res.rows.map((r) => r.key)).toEqual(['w:1', 'w:3', 'w:5']);
  });

  it('totals are summed (bigint minor units)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.lifecycle.emailSms({ ...RANGE, group_by: 'campaign' });
    expect(typeof res.total_revenue_mu).toBe('bigint');
    expect(res.total_delivered).toBe(25000n); // 12000+8000+5000
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — role enforcement + tenancy fail-closed
// ---------------------------------------------------------------------------

describe('lifecycle (negative — role + tenancy)', () => {
  it('VIEWER cannot read lifecycle.states (ANALYST required)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.lifecycle.states(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('VIEWER cannot read lifecycle.timings', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.lifecycle.timings(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('VIEWER cannot read lifecycle.emailSms', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.lifecycle.emailSms(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('cross-workspace read fails closed (foreign ctx vs stub ws)', async () => {
    // Caller scoped to FOREIGN_WS, stub seeded for SUGANDH_LOK → data-plane rejects.
    const c = caller(makeCtx(FOREIGN_WS), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.lifecycle.states(RANGE)).rejects.toThrow(/UnscopedQueryError|not authorized/);
    await expect(c.lifecycle.emailSms(RANGE)).rejects.toThrow(/UnscopedQueryError|not authorized/);
  });
});

// ---------------------------------------------------------------------------
// 🚨 COMPLIANCE — no outbound surface on the lifecycle router
// ---------------------------------------------------------------------------

describe('lifecycle (compliance — READ-ONLY, no outbound surface)', () => {
  it('every lifecycle procedure is a query; there is NO mutation/send', () => {
    const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
    const idem = new InMemoryIdempotencyStore();
    const appRouter = createBrainRouter(dp, idem);
    // Enumerate the lifecycle sub-router's procedures from the router definition.
    const procs = (appRouter._def.procedures ?? {}) as Record<string, { _def?: { type?: string } }>;
    const lifecycleProcs = Object.keys(procs).filter((p) => p.startsWith('lifecycle.'));
    expect(lifecycleProcs.sort()).toEqual([
      'lifecycle.emailSms',
      'lifecycle.states',
      'lifecycle.timings',
    ]);
    // Every lifecycle procedure must be a READ query — never a mutation (no write/send path).
    for (const name of lifecycleProcs) {
      expect(procs[name]._def?.type).toBe('query');
    }
    // No outbound-looking procedure name on the surface.
    const forbidden = ['send', 'dispatch', 'enqueue', 'trigger', 'upsert', 'create', 'mutate'];
    for (const name of lifecycleProcs) {
      for (const token of forbidden) {
        expect(name.toLowerCase()).not.toContain(token);
      }
    }
  });
});

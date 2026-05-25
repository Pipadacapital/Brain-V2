// @paradigm: sql
// Phase-2 slice-7 (feat-finance-settings-goals) — settings + calendar router tests.
//
// POSITIVE — settings.goals returns directional RAG (higher-better AND lower-better);
//            settings.costs returns the resolved stack + CM landing; settings.festivals
//            returns the India template calendar (no learned lift); calendar.report returns
//            the period grid with overlays + per-cell directional RAG; settings.upsertGoal
//            is IDEMPOTENT (replay returns the cached result without a 2nd write).
// NEGATIVE — ANALYST role enforced on reads (VIEWER rejected); MANAGER enforced on the write
//            (ANALYST rejected); cross-workspace fails closed; CAC@120% is amber NOT green
//            (the all-higher-better mutant is killed); festival learned-lift never appears.

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
    userId: 'user-settings-test',
    workspaceId,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-settings-test',
    traceId: 'trace-settings-test',
  });
}

function makeCtx(workspaceId: string, role: Parameters<typeof makeClaim>[1] = 'ANALYST'): WorkspaceContext {
  return {
    claim: makeClaim(workspaceId, role),
    workspaceId,
    requestId: 'req-settings-test',
    traceId: 'trace-settings-test',
  };
}

function caller(ctx: WorkspaceContext, stubWorkspaceId: string = SUGANDH_LOK_WORKSPACE_ID) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), stubWorkspaceId);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// Helper: a caller that shares ONE idempotency store across calls (for replay tests).
function callerSharedIdem(ctx: WorkspaceContext) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE — settings.goals (directional RAG)
// ---------------------------------------------------------------------------

describe('settings.goals (positive — directional RAG)', () => {
  it('higher-better revenue @92% → amber; attainment 9200bp', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.goals(RANGE);
    const rev = res.rows.find((r) => r.metric_name === 'revenue')!;
    expect(rev.attainment_bp).toBe(9200);
    expect(rev.higher_better).toBe(true);
    expect(rev.rag).toBe('amber');
    expect(typeof rev.goal_value).toBe('bigint');
  });

  it('lower-better CAC @120% → amber, NOT green (kills all-higher-better mutant)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.goals(RANGE);
    const cac = res.rows.find((r) => r.metric_name === 'cac')!;
    expect(cac.higher_better).toBe(false);
    expect(cac.rag).toBe('amber');
    expect(cac.rag).not.toBe('green'); // NON-VACUOUS
  });

  it('higher-better cm3 @98% → green', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.goals(RANGE);
    const cm3 = res.rows.find((r) => r.metric_name === 'cm3')!;
    expect(cm3.rag).toBe('green');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — settings.costs (resolved stack feeding CM)
// ---------------------------------------------------------------------------

describe('settings.costs (positive)', () => {
  it('returns COGS mode + settings + CM landing (one source of truth)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.costs(RANGE);
    expect(res.result.cogs_mode).toBe('product+fallback');
    expect(res.result.fallback_bp).toBe(2500);
    expect(res.result.markup_bp).toBe(500);
    // CM1 = net_sales - cogs - variable (echoed from the existing CM path).
    expect(res.result.cm1_mu).toBe(17_800_000n);
  });

  it('cost rows split into fixed-monthly + per-order totals', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.costs(RANGE);
    expect(res.result.total_per_order_mu).toBe(8000n);   // 2000 + 6000
    expect(res.result.total_fixed_monthly_mu).toBe(5_000_000n);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — settings.festivals (India template; NO learned lift)
// ---------------------------------------------------------------------------

describe('settings.festivals (positive)', () => {
  it('Diwali multiplier is 40000bp (4.0×) — stored template default, NOT learned', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.festivals({ ...RANGE, year: 2026 });
    const diwali = res.rows.find((r) => r.name === 'Diwali')!;
    expect(diwali.expected_multiplier_bp).toBe(40000);
    expect(res.peak_multiplier_bp).toBe(40000);
  });

  it('rows carry NO learned-lift field (Finding 2)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.settings.festivals({ ...RANGE, year: 2026 });
    const row = res.rows[0]! as unknown as Record<string, unknown>;
    expect(row).not.toHaveProperty('learned_lift');
    expect(row).not.toHaveProperty('festival_lift');
    expect(row).toHaveProperty('expected_multiplier_bp');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — calendar.report (period grid + overlays + per-cell RAG)
// ---------------------------------------------------------------------------

describe('calendar.report (positive)', () => {
  it('returns the period grid with metric cells + marketing-action overlays', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.calendar.report(RANGE);
    const day1 = res.rows.find((r) => r.period_key === '2026-05-01')!;
    expect(day1.revenue.actual).toBe(1_000_000n);
    expect(day1.actions.length).toBe(1);
    expect(day1.actions[0]!.source).toBe('klaviyo');
  });

  it('per-cell CAC uses lower-better band (day-2 CAC@164% → red)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.calendar.report(RANGE);
    const day2 = res.rows.find((r) => r.period_key === '2026-05-02')!;
    // cac 41000 vs goal 25000 = 164% → red (lower-better, past 120%).
    expect(day2.cac.rag).toBe('red');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — settings.upsertGoal (idempotent write)
// ---------------------------------------------------------------------------

const UPSERT_INPUT = {
  metric_name: 'revenue' as const,
  period_type: 'MONTHLY' as const,
  period_start: '2026-05-01',
  goal_value: 30_000_000n,
  goal_type: 'MINIMUM' as const,
  idempotency_key: '11111111-1111-1111-1111-111111111111',
};

describe('settings.upsertGoal (idempotent write)', () => {
  it('first call writes; returns idempotent_replay=false', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'MANAGER'));
    const res = await c.settings.upsertGoal(UPSERT_INPUT);
    expect(res.idempotent_replay).toBe(false);
    expect(res.goal_value).toBe(30_000_000n);
    expect(typeof res.goal_value).toBe('bigint');
  });

  it('same idempotency_key replays — no second write (idempotent_replay=true)', async () => {
    const c = callerSharedIdem(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'MANAGER'));
    const first = await c.settings.upsertGoal(UPSERT_INPUT);
    const second = await c.settings.upsertGoal(UPSERT_INPUT);
    expect(first.idempotent_replay).toBe(false);
    expect(second.idempotent_replay).toBe(true);
    expect(second.goal_value).toBe(first.goal_value);
    expect(second.goal_id).toBe(first.goal_id);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — role gates + tenancy
// ---------------------------------------------------------------------------

describe('settings/calendar (negative — role + tenancy)', () => {
  it('settings.goals rejects VIEWER (needs ANALYST)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.settings.goals(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('settings.upsertGoal rejects ANALYST (needs MANAGER)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'ANALYST'));
    await expect(c.settings.upsertGoal(UPSERT_INPUT)).rejects.toThrow(/MANAGER/);
  });

  it('calendar.report rejects VIEWER', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.calendar.report(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('cross-workspace read fails closed (foreign ws vs stub ws)', async () => {
    // ctx authorizes FOREIGN_WS but the stub only knows SUGANDH_LOK → UnscopedQueryError.
    const c = caller(makeCtx(FOREIGN_WS), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.settings.goals(RANGE)).rejects.toThrow(/UnscopedQueryError/);
  });

  it('cross-workspace WRITE fails closed', async () => {
    const c = caller(makeCtx(FOREIGN_WS, 'MANAGER'), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.settings.upsertGoal(UPSERT_INPUT)).rejects.toThrow(/UnscopedQueryError/);
  });
});

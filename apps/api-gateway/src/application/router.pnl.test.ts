// @paradigm: sql
// Phase-2 slice-2 (feat-pnl-cm-waterfall) — pnl router tests.
//
// Covers BOTH positive and negative scenarios (code-clarity + coverage standard):
//   POSITIVE — pnl.statement returns the honest CM ladder as bigint (cm1 SUBTRACTS
//              variable costs; cm2/cm3 cascade; True-CM2 < CM2); pnl.cmWaterfall
//              returns ordered signed registry-traced steps with the cumulative
//              invariant; metrics.pnlWaterfall (re-pointed alias) == pnl.cmWaterfall;
//              dashboard KPI cm2 == P&L statement cm2 (one canonical fact source).
//   NEGATIVE — ANALYST role enforced (VIEWER rejected); cross-workspace request
//              fails closed (UnscopedQueryError); an orphan P&L line/step fails the
//              G-REGISTRY-ONLY traceability assertion.

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
import {
  assertWaterfallDefinitionId,
  assertPnlStatementTraceability,
} from '../domain/registry-mapper.js';
import type { PnlStatementRow } from '../domain/proto-types.js';
import type { WorkspaceContext } from './trpc.js';

const RANGE = { date_start: '2026-04-01', date_end: '2026-04-30' };

function makeClaim(
  workspaceId: string,
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER' = 'ANALYST',
): BrainClaim {
  return assembleClaim({
    userId: 'user-pnl-test',
    workspaceId,
    workspaceRole: role,
    systemRole: 'USER',
    requestId: 'req-pnl-test',
    traceId: 'trace-pnl-test',
  });
}

function makeCtx(workspaceId: string, role: Parameters<typeof makeClaim>[1] = 'ANALYST'): WorkspaceContext {
  return {
    identity: { sub: makeClaim(workspaceId, role).userId, email: 'test@brain.test' },
    claim: makeClaim(workspaceId, role),
    workspaceId,
    requestId: 'req-pnl-test',
    traceId: 'trace-pnl-test',
  };
}

function caller(ctx: WorkspaceContext, stubWorkspaceId: string = SUGANDH_LOK_WORKSPACE_ID) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), stubWorkspaceId);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE — pnl.statement
// ---------------------------------------------------------------------------

describe('pnl.statement (positive)', () => {
  it('returns the honest CM ladder; cm1 SUBTRACTS variable costs', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.pnl.statement(RANGE);
    const s = res.statement;

    expect(s.net_revenue_mu).toBe(185_000_000n);
    expect(s.cogs_mu).toBe(82_000_000n);
    expect(s.variable_costs_mu).toBe(6_000_000n);
    // HONEST cm1 = net_revenue − cogs − variable_costs = 185 − 82 − 6 = 97
    expect(s.cm1_mu).toBe(97_000_000n);
    // cm2 = cm1 − ad_spend = 97 − 65 = 32  (== dashboard KPI seed)
    expect(s.cm2_mu).toBe(32_000_000n);
    // cm3 = cm2 − misc = 32 − 4 = 28  (== dashboard KPI seed)
    expect(s.cm3_mu).toBe(28_000_000n);
    expect(typeof s.cm1_mu).toBe('bigint');
    expect(s.currency_code).toBe('INR');
  });

  it('cm1 is NOT COGS-only (the slice-2 regression mutant is dead)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const s = (await c.pnl.statement(RANGE)).statement;
    const cogsOnly = s.net_revenue_mu - s.cogs_mu; // 103_000_000 — the OLD wrong value
    expect(s.cm1_mu).not.toBe(cogsOnly);
    expect(s.cm1_mu).toBe(cogsOnly - s.variable_costs_mu);
  });

  it('True-CM2 is below CM2 (RTO provision bites; Brain-native honesty)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const s = (await c.pnl.statement(RANGE)).statement;
    expect(s.true_cm2_mu).not.toBeNull();
    expect(s.true_cm2_mu!).toBeLessThan(s.cm2_mu);
  });

  it('every statement field traces to the registry (no throw)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const s = (await c.pnl.statement(RANGE)).statement;
    expect(() => assertPnlStatementTraceability(s)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — pnl.cmWaterfall
// ---------------------------------------------------------------------------

describe('pnl.cmWaterfall (positive)', () => {
  it('returns ordered, signed, registry-traced steps including variable_costs', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.pnl.cmWaterfall(RANGE);
    // Canonical 16-step gross-top CM ladder (metric registry).
    expect(res.steps.map((s) => s.definition_id)).toEqual([
      'gross_sales_mu',
      'total_discount_mu',
      'returns_mu',
      'total_tax_mu',
      'shipping_outbound_mu',
      'gross_revenue_after_deductions_mu',
      'cogs_mu',
      'variable_costs_mu',
      'rto_cost_mu',
      'cm1_mu',
      'total_ad_spend_mu',
      'cm2_mu',
      'misc_expenses_prorated_mu',
      'cm3_mu',
      'founder_salary_mu',
      'net_profit_mu',
    ]);
    for (const step of res.steps) {
      expect(() => assertWaterfallDefinitionId(step)).not.toThrow();
    }
  });

  it('cost steps are negative; CM subtotals positive; cumulative invariant holds', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const res = await c.pnl.cmWaterfall(RANGE);
    const byId = Object.fromEntries(res.steps.map((s) => [s.definition_id, s]));
    // Cost steps are negative deductions.
    for (const id of ['total_discount_mu', 'returns_mu', 'total_tax_mu', 'shipping_outbound_mu', 'cogs_mu', 'variable_costs_mu', 'rto_cost_mu', 'total_ad_spend_mu', 'misc_expenses_prorated_mu']) {
      expect(byId[id].value_mu <= 0n).toBe(true);
    }
    // Subtotal steps carry their running total as the value (value == cumulative).
    for (const id of ['cm1_mu', 'cm2_mu', 'cm3_mu']) {
      expect(byId[id].value_mu).toBe(byId[id].cumulative_mu);
    }
    // CM ladder is monotonically non-increasing (each tier deducts more cost).
    expect(byId['cm1_mu'].value_mu >= byId['cm2_mu'].value_mu).toBe(true);
    expect(byId['cm2_mu'].value_mu >= byId['cm3_mu'].value_mu).toBe(true);
    // CM2 = CM1 − ad spend (exact, since ad spend is the only step between them).
    expect(byId['cm2_mu'].value_mu).toBe(byId['cm1_mu'].value_mu + byId['total_ad_spend_mu'].value_mu);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — Single-Primitive Rule: metrics.pnlWaterfall == pnl.cmWaterfall
// ---------------------------------------------------------------------------

describe('one CM-waterfall source of truth (positive)', () => {
  it('metrics.pnlWaterfall (re-pointed alias) equals pnl.cmWaterfall', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const alias = await c.metrics.pnlWaterfall(RANGE);
    const canonical = await c.pnl.cmWaterfall(RANGE);
    expect(alias.steps.map((s) => [s.definition_id, s.value_mu, s.cumulative_mu])).toEqual(
      canonical.steps.map((s) => [s.definition_id, s.value_mu, s.cumulative_mu]),
    );
  });

  it('dashboard KPI cm2 equals the P&L statement cm2 (one canonical fact)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID));
    const kpi = await c.metrics.kpiSummary(RANGE);
    const stmt = (await c.pnl.statement(RANGE)).statement;
    expect(kpi.summary.cm2_mu).toBe(stmt.cm2_mu);
    expect(kpi.summary.cm3_mu).toBe(stmt.cm3_mu);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE
// ---------------------------------------------------------------------------

describe('pnl.* (negative)', () => {
  it('pnl.statement rejects a VIEWER (requireRole ANALYST)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.pnl.statement(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('pnl.cmWaterfall rejects a VIEWER (requireRole ANALYST)', async () => {
    const c = caller(makeCtx(SUGANDH_LOK_WORKSPACE_ID, 'VIEWER'));
    await expect(c.pnl.cmWaterfall(RANGE)).rejects.toThrow(/ANALYST/);
  });

  it('pnl.statement fails closed on a cross-workspace request', async () => {
    const otherWs = '00000000-0000-0000-0000-0000000000ff';
    const c = caller(makeCtx(otherWs), SUGANDH_LOK_WORKSPACE_ID);
    await expect(c.pnl.statement(RANGE)).rejects.toThrow(/UnscopedQueryError|not authorized/);
  });
});

describe('G-REGISTRY-ONLY P&L traceability (negative / killed mutant)', () => {
  it('throws on an orphan P&L line not in the registry', () => {
    const orphan = {
      workspace_id: SUGANDH_LOK_WORKSPACE_ID,
      period: '2026-04',
      data_epoch: new Date(),
      currency_code: 'INR',
      net_revenue_mu: 1n,
      cogs_mu: 1n,
      variable_costs_mu: 1n,
      cm1_mu: 1n,
      total_ad_spend_mu: 1n,
      cm2_mu: 1n,
      misc_expenses_prorated_mu: 1n,
      cm3_mu: 1n,
      true_cm2_mu: 1n,
      order_count: 1n,
      // orphan ad-hoc derived field — must trip the assertion:
      gross_margin_pct: 4200,
    } as unknown as PnlStatementRow;
    expect(() => assertPnlStatementTraceability(orphan)).toThrow(/G-REGISTRY-ONLY VIOLATION/);
  });
});

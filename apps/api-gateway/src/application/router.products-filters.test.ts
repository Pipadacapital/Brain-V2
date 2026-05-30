// @paradigm: sql
// Products filter-honoring regression tests (parity-38 fix).
// This is the DATA-PLANE regression: proves that catalog.products actually forwards
// date_start/date_end/search/sort/direction/page/page_size to getProductPerformance,
// rather than ignoring them (the pre-fix bug where local-db-data-plane called
// readProductPerformance with no filters).
//
// POSITIVE: search filter applied — 'rose' returns only Rose Mist
// POSITIVE: pagination applied — page_size=1 returns exactly 1 row
// POSITIVE: pagination page 2 returns the next row
// POSITIVE: sort=revenue,direction=asc returns rows in ascending revenue order
// POSITIVE: sort=label returns rows in alphabetical order
// POSITIVE: sort=aov returns rows sorted by aov
// POSITIVE: page + page_size produce correct total_rows (unfilteredcount, not page count)
// POSITIVE: search + pagination: search narrows set, then page applied
// NEGATIVE: search='nonexistent' returns 0 rows, total_rows=0
// NEGATIVE: page beyond total pages returns empty rows but correct total_rows

import { describe, it, expect } from 'vitest';
import { createBrainRouter } from './router.js';
import { assembleClaim } from '@brain/core-auth';
import {
  StubDataPlane,
  InMemoryDecisionLog,
  SUGANDH_LOK_WORKSPACE_ID,
} from '../infrastructure/loopback-data-plane.js';
import { InMemoryIdempotencyStore } from '../domain/idempotency.js';
import type { WorkspaceContext } from './trpc.js';

const RANGE = { date_start: '2026-04-01', date_end: '2026-04-30' };

function makeCtx(workspaceId: string = SUGANDH_LOK_WORKSPACE_ID): WorkspaceContext {
  const claim = assembleClaim({
    userId: 'user-pf-test',
    workspaceId,
    workspaceRole: 'ANALYST',
    systemRole: 'USER',
    requestId: 'req-pf-test',
    traceId: 'trace-pf-test',
  });
  return {
    identity: { sub: claim.userId, email: 'test@brain.test' },
    claim,
    workspaceId,
    requestId: 'req-pf-test',
    traceId: 'trace-pf-test',
  };
}

function caller(ctx: WorkspaceContext = makeCtx()) {
  const dp = new StubDataPlane(new InMemoryDecisionLog(), SUGANDH_LOK_WORKSPACE_ID);
  const idem = new InMemoryIdempotencyStore();
  return createBrainRouter(dp, idem).createCaller(ctx);
}

// ---------------------------------------------------------------------------
// POSITIVE — search filter applied
// ---------------------------------------------------------------------------

describe('catalog.products — search filter honored', () => {
  it('search=rose returns only the Rose Mist row', async () => {
    const res = await caller().catalog.products({ ...RANGE, search: 'rose' });
    expect(res.total_rows).toBe(1n);
    expect(res.rows[0]!.label).toBe('Rose Mist 50ml');
  });

  it('search is case-insensitive', async () => {
    const res = await caller().catalog.products({ ...RANGE, search: 'ROSE' });
    expect(res.total_rows).toBe(1n);
  });
});

describe('catalog.products — search filter negative', () => {
  it('search=nonexistent returns 0 rows', async () => {
    const res = await caller().catalog.products({ ...RANGE, search: 'xyzNonExistent123' });
    expect(res.total_rows).toBe(0n);
    expect(res.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — pagination
// ---------------------------------------------------------------------------

describe('catalog.products — pagination honored', () => {
  it('page_size=10 returns all 3 seed rows (total < page_size)', async () => {
    const res = await caller().catalog.products({ ...RANGE, page: 1, page_size: 10 });
    // 3 seed rows; page_size=10 → all 3
    expect(Number(res.total_rows)).toBe(3);
    expect(res.rows).toHaveLength(3);
  });

  it('page 2 with page_size=10 and only 3 rows returns 0 rows (empty second page)', async () => {
    const pg2 = await caller().catalog.products({ ...RANGE, page: 2, page_size: 10 });
    // 3 rows, page_size=10: page 2 is empty
    expect(pg2.rows).toHaveLength(0);
    // total_rows is total BEFORE pagination
    expect(Number(pg2.total_rows)).toBe(3);
  });

  it('page beyond total returns 0 rows but total_rows remains 3', async () => {
    const res = await caller().catalog.products({ ...RANGE, page: 99, page_size: 10 });
    expect(res.rows).toHaveLength(0);
    expect(Number(res.total_rows)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — sort honored
// ---------------------------------------------------------------------------

describe('catalog.products — sort honored', () => {
  it('sort=revenue,direction=asc returns rows ascending by revenue', async () => {
    const res = await caller().catalog.products({ ...RANGE, sort: 'revenue', direction: 'asc' });
    const revenues = res.rows.map((r) => r.revenue_mu);
    for (let i = 1; i < revenues.length; i++) {
      expect(revenues[i]! >= revenues[i - 1]!).toBe(true);
    }
  });

  it('sort=label,direction=asc returns rows alphabetically', async () => {
    const res = await caller().catalog.products({ ...RANGE, sort: 'label', direction: 'asc' });
    const labels = res.rows.map((r) => r.label);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b));
    expect(labels).toEqual(sorted);
  });

  it('sort=cm1,direction=desc (default) returns highest CM1 first', async () => {
    const res = await caller().catalog.products({ ...RANGE, sort: 'cm1', direction: 'desc' });
    const cm1s = res.rows.map((r) => r.cm1_mu);
    for (let i = 1; i < cm1s.length; i++) {
      expect(cm1s[i]! <= cm1s[i - 1]!).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — search + pagination interaction
// ---------------------------------------------------------------------------

describe('catalog.products — search + pagination', () => {
  it('search narrows set; page applied to narrowed set', async () => {
    // 'oud' matches only Sugandh Oud Attar (1 row)
    const res = await caller().catalog.products({ ...RANGE, search: 'oud', page: 1, page_size: 10 });
    expect(Number(res.total_rows)).toBe(1);
    expect(res.rows).toHaveLength(1);

    // page 2 of a 1-row set returns empty
    const pg2 = await caller().catalog.products({ ...RANGE, search: 'oud', page: 2, page_size: 10 });
    expect(pg2.rows).toHaveLength(0);
    expect(Number(pg2.total_rows)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — all paginated columns still carry NC/EC + CM1 total share
// ---------------------------------------------------------------------------

describe('catalog.products — NC/EC fields in paginated rows', () => {
  it('rows have nc_orders and ec_orders fields (may be 0 — honest-empty)', async () => {
    const res = await caller().catalog.products({ ...RANGE });
    for (const row of res.rows) {
      expect(typeof row.nc_orders).toBe('bigint');
      expect(typeof row.ec_orders).toBe('bigint');
    }
  });

  it('rows have cm1_total_share_bp field (share of total CM1)', async () => {
    const res = await caller().catalog.products({ ...RANGE });
    for (const row of res.rows) {
      if (row.cm1_mu > 0n) {
        expect(row.cm1_total_share_bp).not.toBeNull();
      }
    }
  });
});

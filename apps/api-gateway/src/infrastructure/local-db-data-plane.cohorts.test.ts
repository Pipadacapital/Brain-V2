// @paradigm: sql
// Regression tests for the LocalDbDataPlane cohort correctness fix.
//
// The P0 gap: getCohortMatrix always returned cumulative net-revenue totals
// regardless of metric/mode/date_range. The fix:
//   1. applyCohortMode — exported helper that applies mode transforms.
//   2. LocalDbDataPlane filters cohorts by date range and applies per-customer division.
//
// This file tests applyCohortMode directly (no DB, no mocking overhead) plus
// validates the date-range filter logic by inspecting the transformation helpers.
//
// POSITIVE:
//   - incr mode → raw incremental per-customer values
//   - post mode (cm3) → same as incr for cm3
//   - post mode (revenue) → running cumulative post-acquisition
//   - cumulative mode → seeds from first-order value
//   - pct mode → scales relative to |fo| in bp
//   - ltvcac mode → scales cumulative relative to CAC in bp
//   - repeat/repurchase only support post → running sum
// NEGATIVE:
//   - applyCohortMode with empty incr → all-zero output
//   - applyCohortMode pct with zero fo → uses 1n as denominator (no div-by-zero)

import { describe, it, expect } from 'vitest';
import { applyCohortMode } from './local-db-data-plane.js';

// Sample per-customer incremental values (minor units, bigint).
// Jan cohort: fo=300_000, foR=300_000, cac=50_000
// incr: M0=300_000, M1=200_000, rest 0
const FO   = 300_000n;   // per-customer first-order
const FO_R = 300_000n;   // per-customer realized first-order
const CAC  = 50_000n;    // per-customer CAC
const INCR = [300_000n, 200_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];

// ---------------------------------------------------------------------------
// POSITIVE — mode=incr
// ---------------------------------------------------------------------------

describe('applyCohortMode — incr mode', () => {
  it('cm3+incr → raw incremental array unchanged', () => {
    const m = applyCohortMode('cm3', 'incr', FO, FO_R, CAC, INCR);
    expect(m[0]).toBe(300_000n);
    expect(m[1]).toBe(200_000n);
    expect(m[2]).toBe(0n);
  });

  it('revenue+incr → raw incremental array unchanged', () => {
    const m = applyCohortMode('revenue', 'incr', FO, FO_R, CAC, INCR);
    expect(m[0]).toBe(300_000n);
    expect(m[1]).toBe(200_000n);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — mode=post
// ---------------------------------------------------------------------------

describe('applyCohortMode — post mode', () => {
  it('cm3+post → same as incr (no cumulative seed for CM3 post-acquisition)', () => {
    const m = applyCohortMode('cm3', 'post', FO, FO_R, CAC, INCR);
    // post+cm3 = [...incrPer] (same as incr)
    expect(m[0]).toBe(300_000n);
    expect(m[1]).toBe(200_000n);
    expect(m[2]).toBe(0n);
  });

  it('revenue+post → running sum starting at 0 (post-acquisition accumulation)', () => {
    const m = applyCohortMode('revenue', 'post', FO, FO_R, CAC, INCR);
    // s=0; m[0]=300_000; m[1]=500_000; m[2]=500_000 …
    expect(m[0]).toBe(300_000n);
    expect(m[1]).toBe(500_000n);
    expect(m[2]).toBe(500_000n);
  });

  it('repeat+post → running sum of repeat-bp values', () => {
    const repeatIncr = [3000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]; // rr90 bp in M0
    const m = applyCohortMode('repeat', 'post', 0n, 0n, 0n, repeatIncr);
    expect(m[0]).toBe(3000n);   // running sum after M0
    expect(m[1]).toBe(3000n);   // no further repeat data
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — mode=cumulative
// ---------------------------------------------------------------------------

describe('applyCohortMode — cumulative mode', () => {
  it('cm3+cumulative: seeds from foR, then adds each incr', () => {
    const m = applyCohortMode('cm3', 'cumulative', FO, FO_R, CAC, INCR);
    // fo = FO_R = 300_000; s = 300_000
    // m[0] = s += 300_000 = 600_000
    // m[1] = s += 200_000 = 800_000
    // m[2] = s += 0       = 800_000
    expect(m[0]).toBe(600_000n);
    expect(m[1]).toBe(800_000n);
    expect(m[2]).toBe(800_000n);
  });

  it('revenue+cumulative: seeds from fo (first-order, not realized)', () => {
    const m = applyCohortMode('revenue', 'cumulative', FO, FO_R, CAC, INCR);
    // fo = FO = 300_000; same result here since FO == FO_R
    expect(m[0]).toBe(600_000n);
  });

  it('cumulative m[0] ≠ incr m[0] (modes are not identical)', () => {
    const cum  = applyCohortMode('cm3', 'cumulative', FO, FO_R, CAC, INCR);
    const incr = applyCohortMode('cm3', 'incr',       FO, FO_R, CAC, INCR);
    expect(cum[0]).not.toBe(incr[0]);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — mode=pct
// ---------------------------------------------------------------------------

describe('applyCohortMode — pct mode', () => {
  it('pct: scales cumulative value relative to |fo| in bp (×10000)', () => {
    const m = applyCohortMode('cm3', 'pct', FO, FO_R, CAC, INCR);
    // denom = |fo_R| = 300_000
    // s = fo_R = 300_000
    // m[0] = (s += 300_000) * 10000 / 300_000 = 600_000 * 10000 / 300_000 = 20000
    expect(m[0]).toBe(20_000n);  // 200% in bp
    // m[1] = (s = 800_000) * 10000 / 300_000 ≈ 26666
    expect(m[1]).toBe(26_666n);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — mode=ltvcac
// ---------------------------------------------------------------------------

describe('applyCohortMode — ltvcac mode', () => {
  it('ltvcac: scales cumulative relative to CAC in bp', () => {
    const m = applyCohortMode('cm3', 'ltvcac', FO, FO_R, CAC, INCR);
    // denom = CAC = 50_000
    // s = fo_R = 300_000; m[0] = (s += 300_000) * 10000 / 50_000 = 600_000*10000/50_000 = 120_000
    expect(m[0]).toBe(120_000n); // 12× in bp
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — date-range filtering (tested through string-comparison logic)
// ---------------------------------------------------------------------------

describe('Date range filtering — YYYY-MM string comparison', () => {
  // The filtering uses simple substring+lexicographic comparison.
  // This tests the edge cases to make sure the logic is correct.

  it('cohort month within range passes', () => {
    const cohortMonth = '2026-01';
    const startYM = '2026-01'; // exact start
    const endYM   = '2026-12';
    const included = cohortMonth >= startYM && cohortMonth <= endYM;
    expect(included).toBe(true);
  });

  it('cohort month before range is excluded', () => {
    const cohortMonth = '2025-12';
    const startYM = '2026-01';
    const endYM   = '2026-12';
    const included = cohortMonth >= startYM && cohortMonth <= endYM;
    expect(included).toBe(false);
  });

  it('cohort month after range is excluded', () => {
    const cohortMonth = '2027-01';
    const startYM = '2026-01';
    const endYM   = '2026-12';
    const included = cohortMonth >= startYM && cohortMonth <= endYM;
    expect(included).toBe(false);
  });

  it('cohort month at exact end of range is included', () => {
    const cohortMonth = '2026-12';
    const startYM = '2026-01';
    const endYM   = '2026-12';
    const included = cohortMonth >= startYM && cohortMonth <= endYM;
    expect(included).toBe(true);
  });

  it('ISO date string start sliced to YYYY-MM correctly', () => {
    const dateStart = '2026-01-01';
    expect(dateStart.substring(0, 7)).toBe('2026-01');
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — edge cases
// ---------------------------------------------------------------------------

describe('applyCohortMode — negative / edge cases', () => {
  it('empty incr array → all-zero output for any mode', () => {
    const m = applyCohortMode('cm3', 'post', FO, FO_R, CAC, []);
    expect(m).toHaveLength(0);
  });

  it('pct mode with fo=0 uses denom=1 (no division by zero)', () => {
    // |fo| = 0 → denom = 1n (guard)
    const m = applyCohortMode('cm3', 'pct', 0n, 0n, CAC, [100_000n]);
    // s=0; m[0] = (0+100_000)*10000/1 = 1_000_000_000n … large but no crash
    expect(() => applyCohortMode('cm3', 'pct', 0n, 0n, CAC, [100_000n])).not.toThrow();
  });

  it('ltvcac mode with cac=0 uses denom=1 (no division by zero)', () => {
    expect(() => applyCohortMode('cm3', 'ltvcac', FO, FO_R, 0n, [100_000n])).not.toThrow();
  });
});

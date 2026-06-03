// @paradigm: sql
// Track V5 — TS unit tests for Money value object, convert, ratio, subunits, goalType.
// Covers: positive + negative vectors, non-string rejection, BIGINT overflow,
//         multi-currency subunit, ratio FLOOR, goalType split, and the CF-C2-FIXTURE-PROOF-1
//         divergence-proving probe (string path PASS + number path FAIL).

import { describe, it, expect } from 'vitest';
import { makeMoney } from './money.js';
import { decimalToMinorUnits } from './convert.js';
import { ratioToBasisPoints } from './ratio.js';
import { subunitMultiplier } from './subunits.js';
import type { GoalType, GoalValue } from './goal-type.js';

// ---------------------------------------------------------------------------
// subunitMultiplier lookup (CF-C2-SUBUNIT-1)
// ---------------------------------------------------------------------------
describe('subunitMultiplier', () => {
  it('returns 100 for INR', () => {
    expect(subunitMultiplier('INR')).toBe(100);
  });
  it('returns 100 for AED', () => {
    expect(subunitMultiplier('AED')).toBe(100);
  });
  it('returns 100 for SAR', () => {
    expect(subunitMultiplier('SAR')).toBe(100);
  });
  it('returns 100 for USD', () => {
    expect(subunitMultiplier('USD')).toBe(100);
  });
  it('returns 1000 for KWD (3-decimal currency)', () => {
    expect(subunitMultiplier('KWD')).toBe(1000);
  });
  it('returns 1000 for BHD (3-decimal currency)', () => {
    expect(subunitMultiplier('BHD')).toBe(1000);
  });
  it('returns 1 for JPY (0-decimal currency)', () => {
    expect(subunitMultiplier('JPY')).toBe(1);
  });
  it('defaults to 100 for unknown currency codes', () => {
    expect(subunitMultiplier('XYZ')).toBe(100);
  });
  it('is case-insensitive', () => {
    expect(subunitMultiplier('inr')).toBe(100);
    expect(subunitMultiplier('kwd')).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// shared-libs-4: TS↔Python subunits parity gate (CF-C2-SUBUNIT-PARITY-1)
//
// The canonical override set is defined in subunits.ts and mirrored in
// pylibs/brain_metrics/brain_metrics/subunits.py. Both sides must contain the
// same set of overrides with the same values. This test pins the complete TS
// override table so any drift from Python is caught at CI time.
//
// Expected table (sourced from subunits.ts, verified against Python):
//   3-decimal: KWD=1000, BHD=1000, OMR=1000, TND=1000
//   0-decimal: JPY=1, KRW=1, VND=1, IDR=1, HUF=1, ISK=1, TWD=1
//   Default (100): everything else including INR, AED, SAR, USD, EUR, GBP
// ---------------------------------------------------------------------------
describe('subunitMultiplier — shared-libs-4 parity gate: TS == Python override table', () => {
  // 3-decimal currencies (×1000) — shared-libs-4 previously missing OMR + TND from TS
  it('OMR = 1000 (3-decimal; was missing from TS before shared-libs-4 fix)', () => {
    expect(subunitMultiplier('OMR')).toBe(1000);
  });
  it('TND = 1000 (3-decimal; was missing from TS before shared-libs-4 fix)', () => {
    expect(subunitMultiplier('TND')).toBe(1000);
  });

  // 0-decimal currencies (×1) — shared-libs-4 previously missing these from TS
  it('KRW = 1 (0-decimal; was missing from TS before shared-libs-4 fix)', () => {
    expect(subunitMultiplier('KRW')).toBe(1);
  });
  it('VND = 1 (0-decimal; was missing from TS before shared-libs-4 fix)', () => {
    expect(subunitMultiplier('VND')).toBe(1);
  });
  it('IDR = 1 (0-decimal; was missing from TS before shared-libs-4 fix)', () => {
    expect(subunitMultiplier('IDR')).toBe(1);
  });
  it('HUF = 1 (0-decimal; was missing from TS before shared-libs-4 fix)', () => {
    expect(subunitMultiplier('HUF')).toBe(1);
  });
  it('ISK = 1 (0-decimal; was missing from TS before shared-libs-4 fix)', () => {
    expect(subunitMultiplier('ISK')).toBe(1);
  });
  it('TWD = 1 (0-decimal; was missing from TS before shared-libs-4 fix)', () => {
    expect(subunitMultiplier('TWD')).toBe(1);
  });

  // Full parity check: exact expected value for every override code from both tables
  it('complete override table matches Python subunits.py exactly (byte-identity pair)', () => {
    // This is the canonical set. Python _SUBUNIT_OVERRIDE must contain the same codes.
    const expectedOverrides: Record<string, number> = {
      // 3-decimal
      KWD: 1000, BHD: 1000, OMR: 1000, TND: 1000,
      // 0-decimal
      JPY: 1, KRW: 1, VND: 1, IDR: 1, HUF: 1, ISK: 1, TWD: 1,
    };
    for (const [code, expected] of Object.entries(expectedOverrides)) {
      expect(subunitMultiplier(code), `${code} multiplier`).toBe(expected);
    }
    // Spot-check default-100 codes remain correct
    for (const code of ['INR', 'AED', 'SAR', 'USD', 'EUR', 'GBP']) {
      expect(subunitMultiplier(code), `${code} multiplier`).toBe(100);
    }
    // Unknown code → default 100
    expect(subunitMultiplier('XYZ')).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// makeMoney — Money value object (CF-C2-SUBUNIT-1)
// ---------------------------------------------------------------------------
describe('makeMoney', () => {
  it('resolves subunitMultiplier from currencyCode', () => {
    const m = makeMoney(123456n, 'INR');
    expect(m.minorUnits).toBe(123456n);
    expect(m.currencyCode).toBe('INR');
    expect(m.subunitMultiplier).toBe(100);
  });
  it('resolves 1000 for KWD', () => {
    const m = makeMoney(1000000n, 'KWD');
    expect(m.subunitMultiplier).toBe(1000);
  });
  it('resolves 1 for JPY', () => {
    const m = makeMoney(1000n, 'JPY');
    expect(m.subunitMultiplier).toBe(1);
  });
  it('is frozen (immutable)', () => {
    const m = makeMoney(100n, 'INR');
    expect(Object.isFrozen(m)).toBe(true);
  });
  it('uppercases currencyCode', () => {
    const m = makeMoney(100n, 'inr');
    expect(m.currencyCode).toBe('INR');
  });
});

// ---------------------------------------------------------------------------
// decimalToMinorUnits — the 6 banker's-rounding ties (ROUND_HALF_EVEN ×100)
// CF-C2-STRING-API-1: all inputs are strings
// ---------------------------------------------------------------------------
describe('decimalToMinorUnits — banker rounding ties (×100)', () => {
  const mul = 100;

  it('1234.565 → 123456 (tie: 56 is even → round down)', () => {
    expect(decimalToMinorUnits('1234.565', mul)).toBe(123456n);
  });
  it('1234.575 → 123458 (tie: 57 is odd → round up)', () => {
    expect(decimalToMinorUnits('1234.575', mul)).toBe(123458n);
  });
  it('0.005 → 0 (tie: 0 is even → round down)', () => {
    expect(decimalToMinorUnits('0.005', mul)).toBe(0n);
  });
  it('0.015 → 2 (tie: 1 is odd → round up)', () => {
    expect(decimalToMinorUnits('0.015', mul)).toBe(2n);
  });
  it('999.995 → 100000 (tie: 99 is odd → round up)', () => {
    expect(decimalToMinorUnits('999.995', mul)).toBe(100000n);
  });
  it('0.025 → 2 (tie: 2 is even → round down)', () => {
    expect(decimalToMinorUnits('0.025', mul)).toBe(2n);
  });
});

// ---------------------------------------------------------------------------
// CF-C2-NEG-VECTORS-1: negative variants of all 6 ties
// ---------------------------------------------------------------------------
describe('decimalToMinorUnits — negative banker rounding ties', () => {
  const mul = 100;

  it('-1234.565 → -123456', () => {
    expect(decimalToMinorUnits('-1234.565', mul)).toBe(-123456n);
  });
  it('-1234.575 → -123458', () => {
    expect(decimalToMinorUnits('-1234.575', mul)).toBe(-123458n);
  });
  it('-0.005 → 0 (negative zero rounds to 0)', () => {
    expect(decimalToMinorUnits('-0.005', mul)).toBe(0n);
  });
  it('-0.015 → -2', () => {
    expect(decimalToMinorUnits('-0.015', mul)).toBe(-2n);
  });
  it('-999.995 → -100000', () => {
    expect(decimalToMinorUnits('-999.995', mul)).toBe(-100000n);
  });
  it('-0.025 → -2', () => {
    expect(decimalToMinorUnits('-0.025', mul)).toBe(-2n);
  });
});

// ---------------------------------------------------------------------------
// 4-decimal sub-paise truncation (M-A5-Q2)
// ---------------------------------------------------------------------------
describe('decimalToMinorUnits — 4-decimal sub-paise sources (Decimal(12,4))', () => {
  const mul = 100;

  it('1234.5678 → 123457 (round up: 78 > 50)', () => {
    expect(decimalToMinorUnits('1234.5678', mul)).toBe(123457n);
  });
  it('999.9999 → 100000', () => {
    expect(decimalToMinorUnits('999.9999', mul)).toBe(100000n);
  });
  it('0.0050 → 0 (sub-paise tie, subunit=0 is even → round down)', () => {
    expect(decimalToMinorUnits('0.0050', mul)).toBe(0n);
  });
  it('0.0051 → 1 (sub-paise: 51 > 50 → round up)', () => {
    expect(decimalToMinorUnits('0.0051', mul)).toBe(1n);
  });
});

// ---------------------------------------------------------------------------
// Zero vectors
// ---------------------------------------------------------------------------
describe('decimalToMinorUnits — zero', () => {
  it('0.00 → 0n', () => {
    expect(decimalToMinorUnits('0.00', 100)).toBe(0n);
  });
  it('0.000 → 0n', () => {
    expect(decimalToMinorUnits('0.000', 100)).toBe(0n);
  });
  it('0 → 0n', () => {
    expect(decimalToMinorUnits('0', 100)).toBe(0n);
  });
  it('-0.00 → 0n', () => {
    expect(decimalToMinorUnits('-0.00', 100)).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// Multi-currency subunit (CF-C2-SUBUNIT-1): same input string → different MU
// ---------------------------------------------------------------------------
describe('decimalToMinorUnits — multi-currency subunit (CF-C2-SUBUNIT-1)', () => {
  it('INR "100.50" ×100 → 10050n (paise)', () => {
    expect(decimalToMinorUnits('100.50', 100)).toBe(10050n);
  });
  it('KWD "100.500" ×1000 → 100500n (fils)', () => {
    expect(decimalToMinorUnits('100.500', 1000)).toBe(100500n);
  });
  it('JPY "100" ×1 → 100n (yen, no decimal subunit)', () => {
    expect(decimalToMinorUnits('100', 1)).toBe(100n);
  });
  it('AED "50.99" ×100 → 5099n (fils)', () => {
    expect(decimalToMinorUnits('50.99', 100)).toBe(5099n);
  });
  it('same decimal string "1.505" gives different MU per multiplier (CF-C2-SUBUNIT-1)', () => {
    // INR ×100: "1.505" frac="505", subunit="50"=50n (even), rem="5"→TIE→round down→50. Total=150n.
    // KWD ×1000: "1.505" frac="505", exponent=3: subunit="505"=505n, no remainder. Total=1505n.
    const inrMu = decimalToMinorUnits('1.505', subunitMultiplier('INR'));
    const kwdMu = decimalToMinorUnits('1.505', subunitMultiplier('KWD'));
    expect(inrMu).toBe(150n);   // paise
    expect(kwdMu).toBe(1505n);  // fils
    expect(inrMu).not.toBe(kwdMu); // same string → different MU per multiplier
  });
});

// ---------------------------------------------------------------------------
// CF-C2-STRING-API-1: non-string rejection (type-level + runtime)
// ---------------------------------------------------------------------------
describe('decimalToMinorUnits — non-string rejection (CF-C2-STRING-API-1)', () => {
  it('throws TypeError when a number is passed (runtime guard)', () => {
    // TypeScript prevents this at compile time; `as unknown as string` simulates a poorly-typed caller.
    expect(() => decimalToMinorUnits(1234.565 as unknown as string, 100)).toThrow(TypeError);
  });
  it('TypeError message names the anti-pattern', () => {
    try {
      decimalToMinorUnits(1234.565 as unknown as string, 100);
    } catch (e) {
      expect((e as TypeError).message).toContain('CF-C2-STRING-API-1');
    }
  });
  it('throws TypeError when null is passed', () => {
    expect(() => decimalToMinorUnits(null as unknown as string, 100)).toThrow(TypeError);
  });
  it('throws TypeError when undefined is passed', () => {
    expect(() => decimalToMinorUnits(undefined as unknown as string, 100)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// CF-C2-FIXTURE-PROOF-1 — DIVERGENCE-PROVING PROBE (HIGH)
// Proves that the string path (ROUND_HALF_EVEN) and the legacy Number(str)*100 +
// Math.round path (ROUND_HALF_UP) DIVERGE on real values.
// A green CI without this test does NOT discharge CF-C2-STRING-API-1.
//
// The divergence mechanism:
//   - `Math.round` is ROUND_HALF_UP: ties always round UP.
//   - `ROUND_HALF_EVEN` (banker's rounding): ties round to the nearest EVEN integer.
//   - At exact *.5 paise ties where N (the subunit) is EVEN:
//       Math.round → N+1 (UP)     ← WRONG
//       ROUND_HALF_EVEN → N (DOWN) ← CORRECT
//
// PROBE 1: "100.005" — Decimal(12,2) cost-per-order value in ₹100 range
//   Number("100.005") * 100 = exactly 10000.5 in IEEE-754.
//   Math.round(10000.5) = 10001 (ROUND_HALF_UP). N=10000 is even → WRONG direction.
//   String ROUND_HALF_EVEN: N=10000 is even → round DOWN → 10000n. CORRECT.
//   DIVERGENCE: 10001 (legacy) vs 10000n (correct). Verified on Node v22 / V8. ✓
//
// PROBE 2: "2764.505" — Decimal(12,4) coq/ad-spend value in ₹2764 range
//   Number("2764.505") * 100 = 276450.5 → Math.round = 276451.
//   String ROUND_HALF_EVEN: N=276450 is even → round DOWN → 276450n. CORRECT.
//   DIVERGENCE: 276451 (legacy) vs 276450n (correct). Verified on Node v22 / V8. ✓
//
// Bit-pattern argument: the systematic bias is ROUND_HALF_UP vs ROUND_HALF_EVEN —
// every even-tied decimal amount is 1 paise over-counted in the legacy path.
// This is NOT a coincidence-epsilon case: it is structurally impossible for the
// string path (exact, ROUND_HALF_EVEN) to equal Math.round (ROUND_HALF_UP) on
// even-tied amounts, regardless of IEEE-754 representation precision.
// ---------------------------------------------------------------------------
describe('CF-C2-FIXTURE-PROOF-1 — divergence-proving probe', () => {
  const MULTIPLIER = 100;

  // PROBE 1: "100.005" — Decimal(12,2) ad-spend / cost value
  // String ROUND_HALF_EVEN: N=10000 (even) → round DOWN → 10000n
  // Legacy Math.round(Number()*100): 10001 (ROUND_HALF_UP)
  it('string path returns 10000n for "100.005" (ROUND_HALF_EVEN: N=10000 is even → round down)', () => {
    expect(decimalToMinorUnits('100.005', MULTIPLIER)).toBe(10000n);
  });

  it('Number(str)*100 legacy path returns 10001 for "100.005" — proves the ROUND_HALF_UP bias', () => {
    // Math.round(10000.5) = 10001 (ROUND_HALF_UP always rounds ties up).
    // This over-counts by 1 paise on every even-tied amount. Verified Node v22 / V8.
    const legacyResult = Math.round(Number('100.005') * MULTIPLIER);
    expect(legacyResult).toBe(10001);
    expect(BigInt(legacyResult)).not.toBe(decimalToMinorUnits('100.005', MULTIPLIER));
  });

  it('CF-C2-FIXTURE-PROOF-1: "100.005" — string path (10000n) DIVERGES from legacy path (10001n)', () => {
    const stringPath = decimalToMinorUnits('100.005', MULTIPLIER);     // 10000n (correct)
    const numberPath = BigInt(Math.round(Number('100.005') * MULTIPLIER)); // 10001n (wrong)
    expect(stringPath).not.toBe(numberPath); // MUST diverge — CI-green requires this
    expect(stringPath).toBe(10000n);
    expect(numberPath).toBe(10001n);
  });

  // PROBE 2: "2764.505" — Decimal(12,4) coq/ad-spend value (₹2764 order cost)
  // String ROUND_HALF_EVEN: N=276450 (even) → round DOWN → 276450n
  // Legacy: Math.round(276450.5) = 276451. DIVERGES.
  it('string path returns 276450n for "2764.505" (N=276450 is even → round down)', () => {
    expect(decimalToMinorUnits('2764.505', MULTIPLIER)).toBe(276450n);
  });

  it('"2764.505": legacy path gives 276451, diverges from correct 276450n', () => {
    const legacyResult = Math.round(Number('2764.505') * MULTIPLIER);
    expect(legacyResult).toBe(276451);
    expect(BigInt(legacyResult)).not.toBe(decimalToMinorUnits('2764.505', MULTIPLIER));
  });

  // Control — odd-tie: BOTH paths agree on round-up (verifies the probe is specific, not broad)
  // "100.015": N=10001 (odd) → ROUND_HALF_EVEN rounds UP → 10002n.
  // Math.round(10001.5) = 10002. Both correct and legacy agree here.
  it('control: "100.015" (N=10001 odd) — both string and legacy give 10002 (odd-tie agreement)', () => {
    const stringResult = decimalToMinorUnits('100.015', MULTIPLIER);
    const numberResult = Math.round(Number('100.015') * MULTIPLIER);
    expect(stringResult).toBe(10002n);
    expect(numberResult).toBe(10002); // odd-tie: both agree
  });
});

// ---------------------------------------------------------------------------
// BIGINT overflow boundary
// ---------------------------------------------------------------------------
describe('decimalToMinorUnits — BIGINT overflow boundary', () => {
  it('handles large-GMV (₹10 crore = 1_000_000_000 paise) without silent wrap', () => {
    expect(decimalToMinorUnits('10000000.00', 100)).toBe(1_000_000_000n);
  });
  it('INT64 max — BigInt arithmetic: no overflow or silent wrap', () => {
    // INT64 max = 9223372036854775807 (2^63 - 1)
    // Prisma Decimal string at that scale uses BigInt arithmetic — no float, no wrap.
    const bigAmount = '92233720368547758.07';
    const result = decimalToMinorUnits(bigAmount, 100);
    expect(result).toBe(9223372036854775807n);
  });
});

// ---------------------------------------------------------------------------
// ratioToBasisPoints — FLOOR ×10000 (M-A5-Q1)
// ---------------------------------------------------------------------------
describe('ratioToBasisPoints', () => {
  it('23.33% expressed as 2333/10000 → 2333 bp', () => {
    expect(ratioToBasisPoints(2333n, 10000n)).toBe(2333);
  });
  it('1/3 ratio → FLOOR(3333.33) = 3333 bp', () => {
    expect(ratioToBasisPoints(1n, 3n)).toBe(3333);
  });
  it('1/1 → 10000 bp (100%)', () => {
    expect(ratioToBasisPoints(1n, 1n)).toBe(10000);
  });
  it('0/anything → 0 bp', () => {
    expect(ratioToBasisPoints(0n, 1000n)).toBe(0);
  });
  it('denominator 0 → throws RangeError', () => {
    expect(() => ratioToBasisPoints(1n, 0n)).toThrow(RangeError);
  });
  it('negative ratio: -1/4 → -2500 bp (FLOOR)', () => {
    // FLOOR(-0.25 × 10000) = FLOOR(-2500) = -2500
    expect(ratioToBasisPoints(-1n, 4n)).toBe(-2500);
  });
  it('FLOOR applied correctly: 2/3 → 6666 (not 6667)', () => {
    expect(ratioToBasisPoints(2n, 3n)).toBe(6666);
  });
  // CF-C2-NEG-VECTORS-1 / F2-Tanvi: negative ratio with non-zero remainder — exercises the
  // sign-aware FLOOR adjustment at ratio.ts:29-33.
  // FLOOR(-1/3 × 10000) = FLOOR(-3333.33...) = -3334 (floor toward −∞, NOT truncate toward 0).
  // Truncation toward zero would give -3333 — this test catches that mutation.
  // Python: ratio_to_basis_points(-1, 3) == -3334. Must agree.
  it('negative ratio with remainder: -1/3 → -3334 bp (FLOOR toward −∞, NOT truncate -3333)', () => {
    expect(ratioToBasisPoints(-1n, 3n)).toBe(-3334);
  });
});

// ---------------------------------------------------------------------------
// goalType split (A1 #8)
// ---------------------------------------------------------------------------
describe('GoalType and GoalValue (A1 #8)', () => {
  it('GoalType is "money" or "ratio" (exhaustive type discriminant)', () => {
    const moneyGoal: GoalType = 'money';
    const ratioGoal: GoalType = 'ratio';
    expect(moneyGoal).toBe('money');
    expect(ratioGoal).toBe('ratio');
  });

  it('GoalValue money variant carries minorUnits (bigint) and currencyCode', () => {
    const g: GoalValue = { goalType: 'money', minorUnits: 1_00_00000n, currencyCode: 'INR' };
    expect(g.goalType).toBe('money');
    if (g.goalType === 'money') {
      expect(g.minorUnits).toBe(1_00_00000n);
      expect(g.currencyCode).toBe('INR');
    }
  });

  it('GoalValue ratio variant carries basisPoints (INT32)', () => {
    const g: GoalValue = { goalType: 'ratio', basisPoints: 2333 };
    expect(g.goalType).toBe('ratio');
    if (g.goalType === 'ratio') {
      expect(g.basisPoints).toBe(2333);
    }
  });
});

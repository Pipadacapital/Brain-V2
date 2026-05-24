// @paradigm: sql
// M-A5-Q1: ratio → INT32 FLOOR(ratio ×10000) basis-points. NOT ROUND_HALF_EVEN.
// ratioToBasisPoints: denominator==0 throws — caller must guard before calling.

/**
 * Convert a ratio (numerator/denominator) to basis points (INT32).
 *
 * Rule: FLOOR(numerator × 10000 / denominator).
 * NOT ROUND_HALF_EVEN — intentional: ratio metrics use FLOOR (M-A5-Q1).
 * Example: 23.33% → numerator=2333n, denominator=10000n → 2333.
 *          1/3 ratio → 3333 bp (FLOOR).
 *
 * @throws RangeError if denominator === 0n (caller must guard).
 */
export function ratioToBasisPoints(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) {
    throw new RangeError('ratioToBasisPoints: denominator must not be zero (divide-by-zero guard; caller must check before calling)');
  }
  // BigInt division in JS truncates toward zero (floor for positive, ceiling for negative).
  // FLOOR for positive ratios: integer division is correct.
  // For negative ratios, BigInt truncation rounds toward zero (not floor).
  // Spec says INT32 FLOOR — use the sign-aware floor.
  const scaled = numerator * 10000n;
  const quot = scaled / denominator;
  const rem = scaled % denominator;
  // Floor: if remainder has opposite sign to denominator, subtract 1.
  let floored = quot;
  if (rem !== 0n) {
    const remNeg = rem < 0n;
    const denNeg = denominator < 0n;
    if (remNeg !== denNeg) {
      floored = quot - 1n;
    }
  }
  // Assert INT32 range — basis points are small; overflow would be a metric bug.
  const result = Number(floored);
  if (!Number.isInteger(result) || result > 2_147_483_647 || result < -2_147_483_648) {
    throw new RangeError(`ratioToBasisPoints: result ${result} overflows INT32`);
  }
  return result;
}

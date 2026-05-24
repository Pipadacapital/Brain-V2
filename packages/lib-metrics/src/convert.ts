// @paradigm: sql
// CF-C2-STRING-API-1 (CRITICAL): string-in, exact decimal-string arithmetic, NO Number()*100, NO 1e-10 epsilon.
// Audited inline pure function — decimal.js explicitly rejected (06-architecture-plan §16).
// Child 4 imports this; never re-implement ×100.

/**
 * Convert a decimal string amount to integer minor units using exact decimal-string arithmetic.
 *
 * CF-C2-STRING-API-1: `amount` MUST be a decimal string (e.g. "1234.56", "-0.005").
 *   - Type-level: parameter is typed `string` — a number literal caller is rejected at compile time.
 *   - Runtime guard: throws TypeError on typeof !== "string" (defense-in-depth for `as any` callers).
 *
 * Algorithm:
 *   1. Split on "."; derive integer and fractional parts as strings.
 *   2. Scale integerPart × subunitMultiplier using BigInt — no float.
 *   3. Pad/truncate fractionalPart to `exponent` digits (exponent = subunitMultiplier.toString().length - 1; integer, no float).
 *   4. Apply ROUND_HALF_EVEN (banker's rounding) on the exact fractional remainder.
 *   5. Return the signed BIGINT sum. No Number(), no epsilon, no IEEE-754 anywhere.
 *
 * CF-C2-SUBUNIT-1: `subunitMultiplier` is passed by the caller (read from Money.subunitMultiplier
 *   or from the subunitMultiplier() lookup) — hardcoding 100 here is forbidden.
 *
 * @param amount       Decimal string (Prisma Decimal serialisation, e.g. "1234.5678").
 * @param subunitMultiplier  Must be a positive power of 10: 1, 10, 100, 1000, 10000, …
 */
export function decimalToMinorUnits(amount: string, subunitMultiplier: number): bigint {
  // Runtime guard — protects against `decimalToMinorUnits(someNumber as any, ...)`.
  if (typeof amount !== 'string') {
    throw new TypeError(
      `decimalToMinorUnits: amount must be a string, got ${typeof amount}. ` +
        `Do NOT pass Number(prismaDecimal) — that is the legacy float anti-pattern (CF-C2-STRING-API-1).`,
    );
  }

  if (!Number.isInteger(subunitMultiplier) || subunitMultiplier < 1) {
    throw new RangeError(`decimalToMinorUnits: subunitMultiplier must be a positive integer, got ${subunitMultiplier}`);
  }

  const trimmed = amount.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '+') {
    throw new RangeError(`decimalToMinorUnits: invalid amount string: "${amount}"`);
  }

  // Determine sign; strip it for the arithmetic.
  const negative = trimmed.startsWith('-');
  const abs = negative ? trimmed.slice(1) : trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;

  const dotIndex = abs.indexOf('.');
  const integerStr = dotIndex === -1 ? abs : abs.slice(0, dotIndex);
  const fracStr = dotIndex === -1 ? '' : abs.slice(dotIndex + 1);

  // exponent = number of fractional digits the subunit demands (e.g. 2 for ×100, 3 for ×1000, 0 for ×1).
  // Integer derivation via string-length: powers of 10 have exactly (n+1) digits where n is the exponent.
  // e.g. 100 → "100".length - 1 = 2. No float arithmetic in the money path (F5, CF-C2-STRING-API-1).
  const exponent = subunitMultiplier.toString().length - 1;

  // Scale the integer part exactly.
  const integerPart = BigInt(integerStr || '0') * BigInt(subunitMultiplier);

  let fractionalMu: bigint;
  if (exponent === 0) {
    // JPY (×1) — no fractional part; discard any sub-unit digits after rounding.
    // We still need to round the source decimal if it has fractional digits.
    if (fracStr.length === 0) {
      fractionalMu = 0n;
    } else {
      // ROUND_HALF_EVEN on the fractional part relative to 1 unit.
      // The "unit" here is 1 (JPY), so we just round the whole number.
      // e.g. "100.5" → 100 or 101 depending on banker's rounding.
      fractionalMu = roundHalfEvenFraction(fracStr, 0);
    }
  } else {
    fractionalMu = roundHalfEvenFraction(fracStr, exponent);
  }

  const abs_mu = integerPart + fractionalMu;
  return negative ? -abs_mu : abs_mu;
}

/**
 * Internal: given the fractional digit string (after the ".") and the number of
 * subunit digits demanded (exponent), apply ROUND_HALF_EVEN and return a BigInt
 * representing the fractional contribution in minor units.
 *
 * Examples (exponent=2, ×100):
 *   "565"  → round "5.65" relative to 1 → 57 (HALF_EVEN: 5 is odd → round up)
 *   Wait — we round to the nearest subunit:
 *   fracStr="565" exponent=2: the subunit-digit part is "56", remainder digit is "5".
 *   56 is even → round down → 56.
 *   Wait, ROUND_HALF_EVEN: 56 is even, so half goes to 56 (round half to even = 56). Correct.
 *
 * The math: take the first `exponent` digits as the "integer minor" and the rest as "remainder".
 * remainder / 10^len_remainder == 0.5 exactly? Apply ROUND_HALF_EVEN.
 * remainder / 10^len_remainder > 0.5? Round up.
 * < 0.5? Round down.
 */
function roundHalfEvenFraction(fracStr: string, exponent: number): bigint {
  if (exponent === 0) {
    // No fractional minor units at all; figure out if we round the integer up.
    if (fracStr.length === 0) return 0n;
    // The fractional part is relative to 1 unit. Is it exactly 0.5? Apply HALF_EVEN on 0.
    // The integer part will be 0 always here (we add to integerPart separately).
    // Rounding: if fracStr represents > 0.5 → +1; == 0.5 with even 0 → 0; < 0.5 → 0.
    // But exponent==0 means subunit==1 (JPY), so we just check if frac >= 0.5.
    return roundRemainder(0n, fracStr) ? 1n : 0n;
  }

  // Pad or truncate fracStr to exactly exponent+1 digits for rounding inspection.
  // "56"  with exponent=2 → subunit digits "56", remainder "" → no rounding needed.
  // "565" with exponent=2 → subunit digits "56", remainder "5" → ROUND_HALF_EVEN.
  // "5"   with exponent=2 → subunit digits "50" (right-pad), remainder "" → 50.
  // "5678" with exponent=2 → subunit digits "56", remainder "78" → round based on "78" > 50.

  // Extract the subunit-significant digits (first `exponent` digits, right-padded with zeros).
  const subunitDigits = fracStr.slice(0, exponent).padEnd(exponent, '0');
  const remainderStr = fracStr.slice(exponent); // digits beyond the subunit precision

  const mu = BigInt(subunitDigits);
  const roundUp = roundRemainder(mu, remainderStr);
  return roundUp ? mu + 1n : mu;
}

/**
 * Decide whether to round up `mu` given the remainder string.
 * Implements ROUND_HALF_EVEN (banker's rounding):
 *   - remainder == "0" (or empty)  → no round-up
 *   - remainder > 0.5 of the next digit → round up
 *   - remainder == 0.5 exactly      → round to even (round up if mu is odd)
 */
function roundRemainder(mu: bigint, remainderStr: string): boolean {
  if (remainderStr.length === 0) return false;

  // Compare remainderStr against "5" followed by zeros of same length.
  // e.g. remainderStr = "5" → compare to "5" → tie
  //      remainderStr = "50" → compare to "50" → tie
  //      remainderStr = "51" → > 0.5 → round up
  //      remainderStr = "49" → < 0.5 → no
  //      remainderStr = "500" → tie
  //      remainderStr = "500001" → > 0.5 → round up (non-zero beyond the 5)

  const halfStr = '5' + '0'.repeat(remainderStr.length - 1);

  if (remainderStr > halfStr) return true; // > 0.5 → always round up
  if (remainderStr < halfStr) return false; // < 0.5 → never round up
  // Exact tie → ROUND_HALF_EVEN: round up only if mu is odd.
  return mu % 2n === 1n;
}

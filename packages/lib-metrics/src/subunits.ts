// @paradigm: sql
// CF-C2-SUBUNIT-1: subunit_multiplier lookup — read this, never hardcode 100.
// ISO 4217 exponent: INR/AED/SAR=100, KWD/BHD=1000, JPY=1.
// Added in Child-2 now so the ae/sa Phase-4 seam (KWD/BHD/JPY) needs NO breaking change.

const SUBUNIT_MULTIPLIERS: Readonly<Record<string, number>> = {
  // 3-decimal currencies (×1000)
  KWD: 1000,
  BHD: 1000,
  // 0-decimal currencies (×1)
  JPY: 1,
  // Explicit 2-decimal currencies for the current ae/sa universe
  INR: 100,
  AED: 100,
  SAR: 100,
  USD: 100,
  EUR: 100,
  GBP: 100,
};

/**
 * Return the integer subunit multiplier for a currency code.
 * Default 100 (2-decimal currencies are the common case).
 * CF-C2-SUBUNIT-1: callers use this; they never hardcode 100.
 */
export function subunitMultiplier(currencyCode: string): number {
  return SUBUNIT_MULTIPLIERS[currencyCode.toUpperCase()] ?? 100;
}

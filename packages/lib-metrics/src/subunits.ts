// @paradigm: sql
// CF-C2-SUBUNIT-1: subunit_multiplier lookup — read this, never hardcode 100.
// ISO 4217 exponent: INR/AED/SAR=100, KWD/BHD=1000, JPY=1.
// Added in Child-2 now so the ae/sa Phase-4 seam (KWD/BHD/JPY) needs NO breaking change.
//
// CANONICAL SOURCE: this file is the authoritative table for the TS↔Python pair.
// pylibs/brain_metrics/brain_metrics/subunits.py derives from the same set.
// Parity is enforced by the subunits parity test in money.test.ts.
// Any currency added here MUST also be added to the Python counterpart and vice versa.
//
// shared-libs-4 fix: synced with Python subunits.py to include all override codes.
// Previously missing from TS: OMR, TND (3-decimal), KRW, VND, IDR, HUF, ISK, TWD (0-decimal).

const SUBUNIT_MULTIPLIERS: Readonly<Record<string, number>> = {
  // 3-decimal currencies (×1000)
  KWD: 1000,  // Kuwaiti Dinar
  BHD: 1000,  // Bahraini Dinar
  OMR: 1000,  // Omani Rial
  TND: 1000,  // Tunisian Dinar
  // 0-decimal currencies (×1)
  JPY: 1,     // Japanese Yen
  KRW: 1,     // Korean Won
  VND: 1,     // Vietnamese Dong
  IDR: 1,     // Indonesian Rupiah
  HUF: 1,     // Hungarian Forint
  ISK: 1,     // Icelandic Krona
  TWD: 1,     // New Taiwan Dollar
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

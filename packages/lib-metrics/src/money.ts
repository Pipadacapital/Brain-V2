// @paradigm: sql
// CF-C2-SUBUNIT-1: Money carries subunit_multiplier — the conversion reads it, never hardcodes 100.
// v1 internal contract: field names are stable; Child 4 imports unchanged.
// Forward note: proto Money message (Child 4) must mirror int64 minor_units / string currency_code / int32 subunit_multiplier.

import { subunitMultiplier } from './subunits.js';

/** Canonical money value object. Always integer minor units (e.g. paise for INR). */
export interface Money {
  /** Integer minor units (e.g. paise). Never float. */
  readonly minorUnits: bigint;
  /** ISO 4217 alpha-3, e.g. "INR". */
  readonly currencyCode: string;
  /**
   * Subunit exponent: 100 (INR/AED/SAR/USD/…), 1000 (KWD/BHD), 1 (JPY).
   * Resolved once at construction from the currency code.
   * CF-C2-SUBUNIT-1: the conversion reads this field, never hardcodes 100.
   */
  readonly subunitMultiplier: number;
}

/**
 * Construct a Money value object.
 * Resolves subunitMultiplier from the currencyCode via the lookup table.
 * CF-C2-SUBUNIT-1 — the lookup, not a hardcoded 100.
 */
export function makeMoney(minorUnits: bigint, currencyCode: string): Money {
  return Object.freeze({
    minorUnits,
    currencyCode: currencyCode.toUpperCase(),
    subunitMultiplier: subunitMultiplier(currencyCode),
  });
}

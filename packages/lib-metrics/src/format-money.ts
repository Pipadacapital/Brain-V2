// @paradigm: sql
// CF-C6-FORMATMONEY-CANONICAL-1: ONE canonical display formatter for money.
// ONE home: packages/lib-metrics/src/format-money.ts
// Exported from index.ts. web + mobile BOTH import from @brain/lib-metrics.
// ZERO local reimpls anywhere in apps/web or apps/mobile.
//
// Rules (ALL enforced, each is a mutation-test target):
//   1. Reads subunitMultiplier(currencyCode) — NEVER hardcodes 100.
//      Mutant: replace subunitMultiplier() with 100 → AED/KWD tests RED.
//   2. BigInt integer division: minorUnits / BigInt(multiplier).
//      NEVER Number(minorUnits) before dividing — precision loss above 2^53.
//   3. Lakh/crore grouping for INR (integer threshold — NO float arithmetic):
//        >= 10_000_000 (1 crore in rupees) → "X.XX Cr"
//        >= 100_000   (1 lakh in rupees)   → "X.XX L"
//        else                               → "₹X,XXX"
//   4. NEVER rounds — formats the registry integer, does not mutate it.
//      BigInt integer division (FLOOR) is intentional — faithfulness to the
//      stored BIGINT value. No Math.round, no toFixed() that rounds.
//   5. Currency symbol: INR → "₹", AED → "AED ", SAR → "SAR ", others → ISO prefix.
//
// For non-INR currencies: returns formatted major units (2 decimal places for
// 2-decimal currencies like AED/SAR/USD; 3 for KWD/BHD; 0 for JPY).
//
// CF-C6-BIGINT-JSON-1: minorUnits is bigint — the same type that arrives from
// the tRPC response. This function is the ONLY place a bigint money value is
// converted to a display string. It is NOT a semantic conversion.

import { subunitMultiplier } from './subunits.js';

// Currency symbol lookup.
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  INR: '₹',
  AED: 'AED ',
  SAR: 'SAR ',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  KWD: 'KWD ',
  BHD: 'BHD ',
};

function getCurrencySymbol(currencyCode: string): string {
  return CURRENCY_SYMBOLS[currencyCode.toUpperCase()] ?? `${currencyCode.toUpperCase()} `;
}

/**
 * Format an Indian Rupee major-unit value into lakh/crore notation.
 * integer threshold arithmetic only — no float.
 *
 * @param rupees - bigint: integer rupee value (after dividing minorUnits by 100)
 * @param paiseRemainder - bigint: the remainder after rupee division
 * @param symbol - currency symbol prefix
 *
 * Rules:
 *   >= 1 crore (10_000_000 rupees) → "₹X.XX Cr"
 *   >= 1 lakh  (100_000 rupees)    → "₹X.XX L"
 *   else                           → "₹X,XXX" (comma-separated)
 */
function formatInrMajor(
  minorUnits: bigint,
  symbol: string,
): string {
  // Never negative display for INR in lakh/crore (signed by caller).
  const isNegative = minorUnits < 0n;
  const absMinorUnits = isNegative ? -minorUnits : minorUnits;

  const multiplier = 100n; // INR always 100 paise per rupee
  const rupees = absMinorUnits / multiplier;         // BigInt integer division (FLOOR)
  const paise = absMinorUnits % multiplier;           // remainder, 0-99

  const sign = isNegative ? '-' : '';

  if (rupees >= 10_000_000n) {
    // Crore: X.XX Cr
    // crore = rupees / 10_000_000, remainder shows .XX
    const cr = rupees / 10_000_000n;
    const crRemainder = rupees % 10_000_000n;
    // Two decimal places: crRemainder / 100_000 → first 2 digits of the 7-digit remainder
    const decPart = crRemainder / 100_000n;
    return `${sign}${symbol}${cr}.${decPart.toString().padStart(2, '0')} Cr`;
  }

  if (rupees >= 100_000n) {
    // Lakh: X.XX L
    const l = rupees / 100_000n;
    const lRemainder = rupees % 100_000n;
    // Two decimal places: lRemainder / 1_000 → first 2 digits of the 5-digit remainder
    const decPart = lRemainder / 1_000n;
    return `${sign}${symbol}${l}.${decPart.toString().padStart(2, '0')} L`;
  }

  // Below 1 lakh: comma-separated rupees with paise.
  const rupeesStr = rupees.toLocaleString('en-IN');
  const paiseStr = paise.toString().padStart(2, '0');
  return `${sign}${symbol}${rupeesStr}.${paiseStr}`;
}

/**
 * Format a non-INR major-unit value.
 * For 2-decimal currencies: "SYMBOL X,XXX.XX"
 * For 3-decimal currencies (KWD/BHD): "SYMBOL X,XXX.XXX"
 * For 0-decimal currencies (JPY): "SYMBOL X,XXX"
 */
function formatNonInrMajor(
  minorUnits: bigint,
  currencyCode: string,
  symbol: string,
  locale: string,
): string {
  const mult = subunitMultiplier(currencyCode);
  const multBig = BigInt(mult);

  const isNegative = minorUnits < 0n;
  const absMinorUnits = isNegative ? -minorUnits : minorUnits;
  const sign = isNegative ? '-' : '';

  const major = absMinorUnits / multBig;             // integer division (FLOOR)
  const minor = absMinorUnits % multBig;             // remainder

  if (mult === 1) {
    // JPY — no decimal subunit
    return `${sign}${symbol}${major.toLocaleString(locale)}`;
  }

  const decimals = mult === 1000 ? 3 : 2;
  const minorStr = minor.toString().padStart(decimals, '0');
  return `${sign}${symbol}${major.toLocaleString(locale)}.${minorStr}`;
}

/**
 * formatMoney — the ONE canonical money display formatter.
 * CF-C6-FORMATMONEY-CANONICAL-1.
 *
 * @param minorUnits - bigint integer minor units (e.g. paise for INR).
 *   Must be bigint — never Number(). CF-C6-BIGINT-JSON-1.
 * @param currencyCode - ISO 4217 alpha-3, e.g. "INR", "AED", "KWD".
 * @param locale - optional BCP-47 locale for number grouping (default: 'en-IN' for INR, 'en-US' others).
 *
 * @returns formatted display string. Examples:
 *   formatMoney(18_500_000n, 'INR') → "₹1.85 L"
 *   formatMoney(185_000_000n, 'INR') → "₹18.50 L"
 *   formatMoney(1_850_000_000n, 'INR') → "₹1.85 Cr"
 *   formatMoney(5099n, 'AED') → "AED 50.99"
 *   formatMoney(100500n, 'KWD') → "KWD 100.500"
 *   formatMoney(9_000_000_000_000_000_000n, 'INR') → handles > MAX_SAFE_INTEGER
 *
 * NEVER rounds — uses BigInt FLOOR division throughout.
 * NEVER mutates the stored registry integer.
 */
export function formatMoney(
  minorUnits: bigint,
  currencyCode: string,
  locale?: string,
): string {
  const code = currencyCode.toUpperCase();
  const symbol = getCurrencySymbol(code);
  const defaultLocale = code === 'INR' ? 'en-IN' : 'en-US';
  const effectiveLocale = locale ?? defaultLocale;

  // INR uses lakh/crore notation.
  if (code === 'INR') {
    return formatInrMajor(minorUnits, symbol);
  }

  return formatNonInrMajor(minorUnits, code, symbol, effectiveLocale);
}

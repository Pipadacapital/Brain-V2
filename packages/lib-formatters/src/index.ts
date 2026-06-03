// @paradigm: sql
// @brain/lib-formatters — display-only formatters shared across web + mobile.
// CF-C6-RENDER-ONLY-1: display math ONLY on server-produced integers; never produces a new
// metric value. CF-C6-FORMATMONEY-CANONICAL-1: formatMoney re-exported from @brain/lib-metrics —
// ONE money home (Single-Primitive Rule), not reimplemented here.

// Canonical money formatter — single home in lib-metrics, surfaced here for the spec's
// "currency/date" formatter package.
export { formatMoney } from '@brain/lib-metrics';

// shared-libs-5 fix: negative-value sign handling.
// BEFORE: used Math.floor(bp / 10000) for the whole part, which for negative bp gives
// wrong results (e.g. -9500 → floor(-0.95)=-1 → "-1.05×" instead of "-0.95×").
// AFTER: take abs first, compute parts on abs, reattach sign. This is the correct form.

/** bp = FLOOR(ratio × 10000) → "1.50×" (efficiency multiple). Null → "—". */
export function formatBpMultiple(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '—';
  const sign = bp < 0 ? '-' : '';
  const abs = Math.abs(bp);
  const whole = Math.floor(abs / 10000);
  const frac = (abs % 10000 / 100).toFixed(0).padStart(2, '0');
  return `${sign}${whole}.${frac}×`;
}

/** x100 (e.g. 293) → "2.93×" (ROAS stored ×100). Null → "—". */
export function formatX100Multiple(x100: number | null | undefined): string {
  if (x100 === null || x100 === undefined) return '—';
  const sign = x100 < 0 ? '-' : '';
  const abs = Math.abs(x100);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${sign}${whole}.${frac}×`;
}

/** bp → "12.34%" (FLOOR). Null → "—". */
export function formatBpPercent(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '—';
  const sign = bp < 0 ? '-' : '';
  const abs = Math.abs(bp);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${sign}${whole}.${frac}%`;
}

/** centi-points (0..10000) → "59.00" (reliability score is ×100 of 0..100). Null → "—". */
export function formatScore(cp: number | null | undefined): string {
  if (cp === null || cp === undefined) return '—';
  const sign = cp < 0 ? '-' : '';
  const abs = Math.abs(cp);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

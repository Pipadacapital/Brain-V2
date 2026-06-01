// @paradigm: sql
// @brain/lib-formatters — display-only formatters shared across web + mobile.
// CF-C6-RENDER-ONLY-1: display math ONLY on server-produced integers; never produces a new
// metric value. CF-C6-FORMATMONEY-CANONICAL-1: formatMoney re-exported from @brain/lib-metrics —
// ONE money home (Single-Primitive Rule), not reimplemented here.

// Canonical money formatter — single home in lib-metrics, surfaced here for the spec's
// "currency/date" formatter package.
export { formatMoney } from '@brain/lib-metrics';

/** bp = FLOOR(ratio × 10000) → "1.50×" (efficiency multiple). Null → "—". */
export function formatBpMultiple(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '—';
  const whole = Math.floor(bp / 10000);
  const frac = Math.abs(Math.floor((bp % 10000) / 100)).toString().padStart(2, '0');
  return `${whole}.${frac}×`;
}

/** x100 (e.g. 293) → "2.93×" (ROAS stored ×100). Null → "—". */
export function formatX100Multiple(x100: number | null | undefined): string {
  if (x100 === null || x100 === undefined) return '—';
  const whole = Math.floor(x100 / 100);
  const frac = Math.abs(x100 % 100).toString().padStart(2, '0');
  return `${whole}.${frac}×`;
}

/** bp → "12.34%" (FLOOR). Null → "—". */
export function formatBpPercent(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '—';
  const whole = Math.floor(bp / 100);
  const frac = Math.abs(bp % 100).toString().padStart(2, '0');
  return `${whole}.${frac}%`;
}

/** centi-points (0..10000) → "59.00" (reliability score is ×100 of 0..100). Null → "—". */
export function formatScore(cp: number | null | undefined): string {
  if (cp === null || cp === undefined) return '—';
  const whole = Math.floor(cp / 100);
  const frac = Math.abs(cp % 100).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}

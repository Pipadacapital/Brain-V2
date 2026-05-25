// @paradigm: sql
// format-ratio — display-only formatting of MER/aMER/ROAS integers for the slice-4
// marketing pages. CF-C6-RENDER-ONLY-1: display math ONLY on server-produced integers;
// never produces a new metric value. ONE helper (Single-Primitive Rule).

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

/** bp → "12.34%" (for ACOS display). Null → "—". */
export function formatBpPercent(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '—';
  const whole = Math.floor(bp / 100);
  const frac = Math.abs(bp % 100).toString().padStart(2, '0');
  return `${whole}.${frac}%`;
}

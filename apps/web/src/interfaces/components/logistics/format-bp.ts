// @paradigm: sql
// format-bp — display-only formatting of basis-point + centi-point integers for the
// slice-3 logistics pages. CF-C6-RENDER-ONLY-1: display math ONLY on server-produced
// integers; never produces a new metric value. ONE helper shared across the 4 pages
// (Single-Primitive Rule) — no per-component bp math.

/** bp = FLOOR(ratio × 10000) → "12.34%". Null → "—". */
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

// @paradigm: sql
// default-date-range — every analytics page used to default to '2026-04-01'..
// '2026-04-30' (the StubDataPlane seed month). After the destub (2026-05-26),
// new pages should open on the last 30 days *of real data*. We compute it once
// at module load — good enough for "first render" defaults; users adjust via
// the date pickers as needed.

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const now = new Date();
const start = new Date(now);
start.setDate(start.getDate() - 30);

/** ISO YYYY-MM-DD — 30 days ago. */
export const DEFAULT_DATE_START = toIso(start);

/** ISO YYYY-MM-DD — today. */
export const DEFAULT_DATE_END = toIso(now);

// @paradigm: sql
// RAG badge — Goal RAG band display.
// CF-C6-RENDER-ONLY-1: green ≥95% / amber 80-95% / red <80% of goal.
// The component receives a pre-computed attainment pct from the BFF — it never
// computes the ratio itself (render-only).
// CF-C6-PERF-A11Y-1: WCAG AA color contrast; aria-label.

interface RagBadgeProps {
  /** Attainment percentage 0-100. Supplied by server — never computed here. */
  attainmentPct: number;
  /** Accessible label suffix e.g. "at 92% of goal" */
  label?: string;
}

function getRagBand(pct: number): 'green' | 'amber' | 'red' {
  if (pct >= 95) return 'green';
  if (pct >= 80) return 'amber';
  return 'red';
}

const RAG_CLASSES = {
  green: 'bg-green-100 text-green-800 ring-1 ring-green-200',
  amber: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
  red:   'bg-red-100 text-red-800 ring-1 ring-red-200',
} as const;

const RAG_LABELS = {
  green: 'On track',
  amber: 'Watch',
  red:   'Off track',
} as const;

export function RagBadge({ attainmentPct, label }: RagBadgeProps) {
  const band = getRagBand(attainmentPct);
  return (
    <span
      role="status"
      aria-label={label ?? `${RAG_LABELS[band]} at ${attainmentPct}% of goal`}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${RAG_CLASSES[band]}`}
    >
      {RAG_LABELS[band]}
    </span>
  );
}

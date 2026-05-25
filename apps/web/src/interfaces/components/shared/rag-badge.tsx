// @paradigm: sql
// RAG badge — directional Goal RAG band display (Phase-2 slice-7 rewrite, feat-finance-settings-goals).
//
// ROHAN STAGE-1 FINDING 1: the legacy Goal RAG is DIRECTIONAL, not the flat "≥95% green".
//   higher-better: actual >= goal*0.95 → green ; >= goal*0.80 → amber ; else red
//   lower-better:  actual <= goal*1.05 → green ; <= goal*1.20 → amber ; else red
// The band is therefore computed SERVER-SIDE (BFF computeGoalRag, registry) and passed here as
// `rag`. This component is RENDER-ONLY (CF-C6-RENDER-ONLY-1): it NEVER computes the band itself —
// the old flat getRagBand(attainmentPct) was WRONG for lower-better metrics (CAC/ACOS) and is removed.
//
// CF-C6-PERF-A11Y-1: never colour-only — every badge carries an ICON + a TEXT LABEL (WCAG: do
// not rely on colour alone), plus an aria-label. WCAG AA contrast on the tone classes.

export type GoalRag = 'green' | 'amber' | 'red';

interface RagBadgeProps {
  /** The server-computed directional band. NEVER computed in the UI. */
  rag: GoalRag;
  /** Accessible label suffix, e.g. "Net revenue at 92% of goal". */
  label?: string;
  /** Optional attainment percent to show inline (display-only; from the server). */
  attainmentPct?: number | null;
}

const RAG_CLASSES: Record<GoalRag, string> = {
  green: 'bg-green-100 text-green-800 ring-1 ring-green-200',
  amber: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
  red: 'bg-red-100 text-red-800 ring-1 ring-red-200',
};

const RAG_LABELS: Record<GoalRag, string> = {
  green: 'On track',
  amber: 'Watch',
  red: 'Off track',
};

// Icon glyphs — shape conveys status independent of colour (accessibility).
const RAG_ICONS: Record<GoalRag, string> = {
  green: '●',   // ● filled circle = on track
  amber: '▲',   // ▲ triangle = watch
  red: '■',     // ■ square = off track
};

export function RagBadge({ rag, label, attainmentPct }: RagBadgeProps) {
  const pctText = attainmentPct != null ? ` ${attainmentPct}%` : '';
  return (
    <span
      role="status"
      aria-label={label ?? `${RAG_LABELS[rag]}${attainmentPct != null ? ` at ${attainmentPct}% of goal` : ''}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${RAG_CLASSES[rag]}`}
    >
      <span aria-hidden="true">{RAG_ICONS[rag]}</span>
      <span>{RAG_LABELS[rag]}{pctText}</span>
    </span>
  );
}

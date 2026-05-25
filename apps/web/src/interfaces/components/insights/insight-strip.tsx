'use client';

// @paradigm: small_llm (the narrated text is produced UPSTREAM by the Haiku gateway;
//   this component RENDERS it verbatim — it NEVER generates or computes anything).
// InsightStrip — the /pnl page AI narration overlay (Phase-2 slice-9, feat-ai-insight-narration).
//
// CF-C6-RENDER-ONLY-1 + CF-S9: zero arithmetic; the narration text + grounded numbers
//   come from the tRPC BFF (insights.forPage), which has already faithfulness-validated
//   every number against the deterministic registry signal set. The UI shows the model
//   label + a "grounded in your numbers" note so the operator knows the text is grounded.
// READ-ONLY: there is NO action button / execute / approve here — narration is descriptive.

import { trpc } from '@/infrastructure/trpc-client.js';

type Severity = 'critical' | 'warning' | 'opportunity' | 'positive';

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: 'border-l-red-500 bg-red-50',
  warning: 'border-l-amber-500 bg-amber-50',
  opportunity: 'border-l-blue-500 bg-blue-50',
  positive: 'border-l-green-500 bg-green-50',
};

const SEVERITY_ICONS: Record<Severity, string> = {
  critical: '■',
  warning: '▲',
  opportunity: '◆',
  positive: '●',
};

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Watch',
  opportunity: 'Opportunity',
  positive: 'Positive',
};

interface InsightStripProps {
  page: 'pnl' | 'store' | 'dashboard';
  date_start: string;
  date_end: string;
}

export function InsightStrip({ page, date_start, date_end }: InsightStripProps) {
  const { data, isLoading, isError } = trpc.insights.forPage.useQuery({
    page,
    date_start,
    date_end,
  });

  if (isLoading) {
    return (
      <section aria-busy="true" className="rounded-lg border border-border bg-card p-4">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      </section>
    );
  }

  // Fail-closed: if the BFF faithfulness gate rejected the narration, the query errors.
  // We render NOTHING rather than show an ungrounded narration.
  if (isError || !data || data.narrations.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="AI insight narration"
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span aria-hidden="true">✦</span> AI Insights
        </h2>
        <span className="text-xs text-muted-foreground">
          Grounded in your numbers · model: {data.model_used}
          {data.cached ? ' · cached' : ''}
        </span>
      </div>

      <ul className="space-y-2">
        {data.narrations.map((n) => {
          const sev = n.severity as Severity;
          return (
            <li
              key={n.insight_id}
              className={`rounded-md border-l-4 px-3 py-2 ${SEVERITY_CLASSES[sev]}`}
            >
              <div className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-0.5 text-xs text-muted-foreground"
                  title={SEVERITY_LABELS[sev]}
                >
                  {SEVERITY_ICONS[sev]}
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    <span className="sr-only">{SEVERITY_LABELS[sev]}: </span>
                    {n.headline}
                  </p>
                  <p className="text-sm text-muted-foreground">{n.body}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Every number above is read from your deterministic P&amp;L — the AI describes the
        figures, it never invents or recomputes them.
      </p>
    </section>
  );
}

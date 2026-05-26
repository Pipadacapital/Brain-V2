'use client';

// @paradigm: sql
// GoalsContent — the /settings/goals page (Phase-2 slice-7, feat-finance-settings-goals).
// Renders directional Goal RAG: each goal's actual vs target, attainment %, and the band
// (icon+label, never colour-only). CF-C6-RENDER-ONLY-1: zero arithmetic; the RAG band is
// SERVER-COMPUTED (Rohan Finding 1 — higher-better 0.95/0.80; lower-better CAC/ACOS 1.05/1.20)
// and rendered as-is. Goal CRUD (upsert) is an idempotent MANAGER-gated tRPC mutation (wired in
// the BFF; the inline editor is a follow-up — this slice ships the RAG report view).

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { RagBadge } from '@/interfaces/components/shared/rag-badge.js';
import { formatBpPercent, formatBpMultiple } from '@/interfaces/components/marketing/format-ratio.js';

// Metric display metadata (label + how to render its scaled integer value).
const METRIC_META: Record<string, { label: string; fmt: 'money' | 'pct' | 'ratio' | 'count' }> = {
  revenue: { label: 'Net revenue', fmt: 'money' },
  cm3: { label: 'CM3', fmt: 'money' },
  cm3_pct: { label: 'CM3 %', fmt: 'pct' },
  mer: { label: 'MER', fmt: 'ratio' },
  amer: { label: 'aMER', fmt: 'ratio' },
  cac: { label: 'Blended CAC', fmt: 'money' },
  aov: { label: 'AOV', fmt: 'money' },
  new_customers: { label: 'New customers', fmt: 'count' },
  acos: { label: 'ACOS', fmt: 'pct' },
  meta_roas: { label: 'Meta ROAS', fmt: 'ratio' },
  google_roas: { label: 'Google ROAS', fmt: 'ratio' },
};

function fmtValue(metric: string, value: bigint): string {
  const meta = METRIC_META[metric];
  if (!meta) return String(value);
  if (meta.fmt === 'money') return formatMoney(value, 'INR');
  if (meta.fmt === 'pct') return formatBpPercent(Number(value));
  if (meta.fmt === 'ratio') return formatBpMultiple(Number(value));
  return String(value);
}

function attainmentPct(bp: number | null): number | null {
  return bp == null ? null : Math.round(bp / 100);
}

export function GoalsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-05-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-05-31'));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.settings.goals.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <a href="/login" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">Sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Goals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">goal attainment &amp; directional RAG (lower-is-better metrics invert)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="goals-from" className="sr-only">From date</label>
          <input id="goals-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="goals-to" className="sr-only">To date</label>
          <input id="goals-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading goals" className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load goals" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (
        <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>
          <h2 className="text-lg font-semibold text-gray-900">Goal attainment</h2>
          {q.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No goals set for this period. Set a goal (MANAGER) to track attainment.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  {['Metric', 'Period', 'Goal', 'Actual', 'Attainment', 'Status'].map((h, i) => (
                    <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((row) => {
                  const meta = METRIC_META[row.metric_name];
                  const pct = attainmentPct(row.attainment_bp);
                  return (
                    <tr key={`${row.metric_name}-${row.period_type}`} className="border-t border-gray-100">
                      <td className="py-2 text-sm font-medium">{meta?.label ?? row.metric_name}{!row.higher_better && <span className="ml-1 text-xs text-muted-foreground" title="lower is better">(↓ better)</span>}</td>
                      <td className="py-2 text-sm text-right text-muted-foreground">{row.period_type}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{fmtValue(row.metric_name, row.goal_value)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{fmtValue(row.metric_name, row.actual)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{pct == null ? '—' : `${pct}%`}</td>
                      <td className="py-2 text-sm text-right">
                        <RagBadge rag={row.rag} label={`${meta?.label ?? row.metric_name}${pct != null ? ` at ${pct}% of goal` : ''}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

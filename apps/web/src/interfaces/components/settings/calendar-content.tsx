'use client';

// @paradigm: sql
// CalendarContent — the /calendar page (Phase-2 slice-7, feat-finance-settings-goals).
// Renders the Calendar Report period grid (day/week/month) of revenue/cm3/spend/MER/aMER/CAC/AOV
// per period WITH marketing-action overlays + per-cell DIRECTIONAL goal RAG. CF-C6-RENDER-ONLY-1:
// zero arithmetic; values + RAG bands from trpc.calendar.report (Rohan Finding 3 — reuses the
// slice-1/2/4 primitives, no learned festival lift). RAG is never colour-only (icon+label).

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { RagBadge, type GoalRag } from '@/interfaces/components/shared/rag-badge.js';
import { formatBpMultiple } from '@/interfaces/components/marketing/format-ratio.js';

type Cell = { actual: bigint | null; goal: bigint | null; rag: GoalRag | null };

function moneyCell(c: Cell): string {
  return c.actual == null ? '—' : formatMoney(c.actual, 'INR');
}
function ratioCell(c: Cell): string {
  return c.actual == null ? '—' : formatBpMultiple(Number(c.actual));
}

export function CalendarContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-05-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-05-31'));
  const [grain, setGrain] = useQueryState('grain', parseAsString.withDefault('day'));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.calendar.report.useQuery(
    { date_start: dateStart, date_end: dateEnd, grain: grain as 'day' | 'week' | 'month' },
    { enabled },
  );

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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Calendar</h1>
          <p className="text-sm text-muted-foreground mt-0.5">daily performance, goal RAG &amp; marketing-action overlays</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="cal-grain" className="sr-only">Granularity</label>
          <select id="cal-grain" value={grain} onChange={(e) => setGrain(e.target.value)} aria-label="Granularity" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {['day', 'week', 'month'].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <label htmlFor="cal-from" className="sr-only">From date</label>
          <input id="cal-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="cal-to" className="sr-only">To date</label>
          <input id="cal-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading calendar" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load calendar" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (
        <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>
          <h2 className="text-lg font-semibold text-gray-900">Performance calendar ({q.data.grain})</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>{['Period', 'Revenue', 'CM3', 'Spend', 'MER', 'aMER', 'CAC', 'AOV', 'Actions'].map((h, i) => (
                  <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i === 0 || i === 8 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {q.data.rows.map((row) => (
                  <tr key={row.period_key} className="border-t border-gray-100 align-top">
                    <td className="py-2 text-sm font-medium">{row.label}</td>
                    <MetricTd display={moneyCell(row.revenue)} rag={row.revenue.rag} pct={null} />
                    <MetricTd display={moneyCell(row.cm3)} rag={row.cm3.rag} pct={null} />
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(row.total_spend_mu, q.data.currency_code)}</td>
                    <MetricTd display={ratioCell(row.mer)} rag={row.mer.rag} pct={null} />
                    <MetricTd display={ratioCell(row.amer)} rag={row.amer.rag} pct={null} />
                    <MetricTd display={moneyCell(row.cac)} rag={row.cac.rag} pct={null} />
                    <MetricTd display={moneyCell(row.aov)} rag={row.aov.rag} pct={null} />
                    <td className="py-2 text-sm">
                      {row.actions.length === 0 ? <span className="text-muted-foreground">—</span> : (
                        <ul className="space-y-1">
                          {row.actions.map((a) => (
                            <li key={a.id} className="text-xs">
                              <span className="font-medium">{a.action_name}</span>
                              <span className="text-muted-foreground"> · {a.action_type}{a.source === 'klaviyo' ? ' (Klaviyo)' : ''}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Cell colour + icon = goal RAG (directional: lower-is-better metrics like CAC invert). Marketing actions overlay the day they occurred.</p>
        </section>
      )}
    </div>
  );
}

function MetricTd({ display, rag, pct }: { display: string; rag: GoalRag | null; pct: number | null }) {
  return (
    <td className="py-2 text-sm text-right">
      <div className="flex flex-col items-end gap-0.5">
        <span className="tabular-nums">{display}</span>
        {rag && <RagBadge rag={rag} attainmentPct={pct} />}
      </div>
    </td>
  );
}

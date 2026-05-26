'use client';

// @paradigm: sql
// TimingsContent — the /timings page (Phase-2 slice-8, READ/ANALYTICS ONLY).
// Renders inter-order gap intervals (1→2, 2→3, 3→4), 2nd/3rd/4th repeat percentages, and the
// recommended reactivation window (0.8 × median 1→2 gap) — overall + by product group.
// This is NOT "best hours/days" (Rohan Finding 2 — best_send_time is a phantom); it is the
// inter-order timing analysis the legacy timings endpoint actually computes.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.lifecycle.timings.
// 🚨 COMPLIANCE: the reactivation window is a RECOMMENDATION, never a send trigger.

import { useQueryState, parseAsString } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/marketing/format-ratio.js';

function days(d: number | null | undefined): string {
  return d === null || d === undefined ? '—' : `${d} days`;
}

export function TimingsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-05-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-05-31'));
  const [metric, setMetric] = useQueryState('metric', parseAsString.withDefault('median'));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.lifecycle.timings.useQuery(
    { date_start: dateStart, date_end: dateEnd, metric: metric === 'mean' ? 'mean' : 'median' },
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Order Timings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">inter-order intervals, repeat rates &amp; reactivation timing</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="tm-metric" className="sr-only">Metric</label>
          <select id="tm-metric" value={metric} onChange={(e) => setMetric(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            <option value="median">Median</option>
            <option value="mean">Mean</option>
          </select>
          <label htmlFor="tm-from" className="sr-only">From date</label>
          <input id="tm-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="tm-to" className="sr-only">To date</label>
          <input id="tm-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading timings" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load timings" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (() => {
        const s = q.data.summary;
        const groups = q.data.groups;
        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Overall ({q.data.result.metric})</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="First orders" value={s.first_orders.toString()} />
                <Stat label="2nd order rate" value={formatBpPercent(s.second_orders_bp)} />
                <Stat label="3rd order rate" value={formatBpPercent(s.third_orders_bp)} />
                <Stat label="4th order rate" value={formatBpPercent(s.fourth_orders_bp)} />
                <Stat label="Typical 1→2" value={days(s.days_1to2)} />
                <Stat label="Typical 2→3" value={days(s.days_2to3)} />
                <Stat label="Typical 3→4" value={days(s.days_3to4)} />
                <Stat label="Reactivate by" value={days(s.reactivation_window_days)} />
              </div>
              <p className="text-xs text-muted-foreground">Reactivation window = 0.8 × the typical 1→2 interval — the recommended re-engagement timing. This is a recommendation only; Brain does not send.</p>
            </section>

            <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">By first product</h2>
              <table className="w-full">
                <thead>
                  <tr>{['Product', '1st orders', '2nd', '3rd', '1→2', 'Reactivate'].map((h, i) => <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.group_id} className="border-t border-gray-100">
                      <td className="py-2 text-sm font-medium">{g.label}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{g.first_orders.toString()}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(g.second_orders_bp)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(g.third_orders_bp)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{days(g.days_1to2)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{days(g.reactivation_window_days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        );
      })()}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}

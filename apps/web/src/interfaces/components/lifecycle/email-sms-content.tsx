'use client';

// @paradigm: sql
// EmailSmsContent — the /email-sms page (Phase-2 slice-8, READ/ANALYTICS ONLY).
// Renders email/SMS PERFORMANCE reporting: delivered / opens / clicks / orders / revenue and the
// derived open/click rates + revenue-per-recipient, grouped by campaign/flow/date/channel/dow.
// 🚨 COMPLIANCE: this page REPORTS on PAST send performance — it NEVER sends. There is no
// "send", "schedule", or audience-dispatch control here. email_cm2 is a phantom (Finding 4) —
// there is no margin attribution column.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.lifecycle.emailSms.

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/marketing/format-ratio.js';

const GROUP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'campaign', label: 'Campaign' },
  { value: 'flow', label: 'Flow' },
  { value: 'channel', label: 'Channel' },
  { value: 'date', label: 'Date' },
  { value: 'dow', label: 'Day of week' },
];

type GroupBy = 'campaign' | 'flow' | 'date' | 'channel' | 'dow';

export function EmailSmsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-05-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-05-31'));
  const [groupBy, setGroupBy] = useQueryState('groupBy', parseAsString.withDefault('campaign'));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const validGroup = (GROUP_OPTIONS.some((o) => o.value === groupBy) ? groupBy : 'campaign') as GroupBy;
  const q = trpc.lifecycle.emailSms.useQuery(
    { date_start: dateStart, date_end: dateEnd, group_by: validGroup },
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Email &amp; SMS Performance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">reporting on past campaign &amp; flow performance (read-only)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="es-group" className="sr-only">Group by</label>
          <select id="es-group" value={validGroup} onChange={(e) => setGroupBy(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label htmlFor="es-from" className="sr-only">From date</label>
          <input id="es-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="es-to" className="sr-only">To date</label>
          <input id="es-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading email/SMS performance" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load email/SMS performance" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (() => {
        const rows = q.data.rows;
        const r = q.data.result;
        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Totals</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Stat label="Total delivered" value={q.data.total_delivered.toString()} />
                <Stat label="Total revenue" value={formatMoney(q.data.total_revenue_mu, r.currency_code)} />
                <Stat label="Grouped by" value={validGroup} />
              </div>
              <p className="text-xs text-muted-foreground">Performance reporting on already-sent campaigns and flows. Brain does not send — this is past-performance analytics only.</p>
            </section>

            <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Performance</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr>{['Name', 'Channel', 'Delivered', 'Open', 'Click', 'Orders', 'Revenue', 'Rev/recipient'].map((h, i) => <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i <= 1 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} className="border-t border-gray-100">
                        <td className="py-2 text-sm font-medium">{row.label}</td>
                        <td className="py-2 text-sm text-muted-foreground uppercase">{row.channel}</td>
                        <td className="py-2 text-sm tabular-nums text-right">{row.delivered.toString()}</td>
                        <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(row.open_rate_bp)}</td>
                        <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(row.click_rate_bp)}</td>
                        <td className="py-2 text-sm tabular-nums text-right">{row.orders.toString()}</td>
                        <td className="py-2 text-sm tabular-nums text-right">{formatMoney(row.revenue_mu, r.currency_code)}</td>
                        <td className="py-2 text-sm tabular-nums text-right">{row.revenue_per_recipient_mu === null ? '—' : formatMoney(row.revenue_per_recipient_mu, r.currency_code)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

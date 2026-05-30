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

/** Format bigint minor-unit amount to 4-decimal ratio like legacy $/recipient. */
function formatRatio4dp(mu: bigint | null, currency: string): string {
  if (mu === null) return '—';
  // minor-units ÷ 100 (paise→rupees) with 4 decimals, matching legacy .toFixed(4)
  return (Number(mu) / 100).toFixed(4);
}

/** Preset date-range buttons matching legacy DateRangeFilter. */
function DatePresets({ onApply }: { onApply: (from: string, to: string) => void }) {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const presets: Array<{ label: string; days: number }> = [
    { label: 'Yesterday', days: 1 },
    { label: '7D', days: 7 },
    { label: '30D', days: 30 },
    { label: '90D', days: 90 },
    { label: '1Y', days: 365 },
  ];
  return (
    <div className="flex items-center gap-1 shrink-0">
      {presets.map((p) => {
        const to = p.label === 'Yesterday'
          ? fmt(new Date(today.getTime() - 86400000))
          : fmt(today);
        const from = fmt(new Date(today.getTime() - p.days * 86400000));
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onApply(from, to)}
            className="px-2 py-1 text-xs border border-border rounded bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

// Group-by options — labels match legacy: 'By ...' prefix, flow has '(daily)' qualifier,
// ordering: campaign / flow / date / channel / dow. Channel column stays as an enhancement.
const GROUP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'campaign', label: 'By campaign' },
  { value: 'flow',     label: 'By flow (daily)' },
  { value: 'date',     label: 'By date' },
  { value: 'channel',  label: 'By channel' },
  { value: 'dow',      label: 'By day of week' },
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Email &amp; SMS</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Klaviyo campaign &amp; flow performance. Rates use delivered as denominator where noted.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <DatePresets onApply={(from, to) => { void setDateStart(from); void setDateEnd(to); }} />
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
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-muted rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load email/SMS performance" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (() => {
        const rows = q.data.rows;
        const r = q.data.result;
        const cc = r.currency_code;
        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            <section className="bg-card rounded-lg border p-6 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Stat label="Total delivered" value={q.data.total_delivered.toString()} />
                <Stat label="Total revenue" value={formatMoney(q.data.total_revenue_mu, cc)} />
                <Stat label="Grouped by" value={GROUP_OPTIONS.find((o) => o.value === validGroup)?.label ?? validGroup} />
              </div>
            </section>

            <section className="bg-card rounded-lg border p-6 space-y-4">
              <div className="overflow-x-auto">
                {/* 13 columns matching legacy: Name / Delivered / Opens (raw) / Open % /
                    Clicks (raw) / Revenue / $/recipient / $/unique-open / Orders /
                    Unsub / Unsub % / Spam / Spam % — Channel is an extra column (UI enhancement). */}
                <table className="w-full min-w-[1100px]">
                  <thead>
                    <tr>
                      {[
                        ['Name', 'left'],
                        ['Channel', 'left'],
                        ['Delivered', 'right'],
                        ['Opens', 'right'],
                        ['Open %', 'right'],
                        ['Clicks', 'right'],
                        ['Revenue', 'right'],
                        ['$/recipient', 'right'],
                        ['$/unique-open', 'right'],
                        ['Orders', 'right'],
                        ['Unsub', 'right'],
                        ['Unsub %', 'right'],
                        ['Spam', 'right'],
                        ['Spam %', 'right'],
                      ].map(([h, align]) => (
                        <th key={h} className={`pb-2 text-xs font-medium text-muted-foreground text-${align} px-2 first:pl-0 last:pr-0`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="py-8 text-center text-sm text-muted-foreground">
                          No email/SMS data for this period.
                        </td>
                      </tr>
                    ) : rows.map((row) => (
                      <tr key={row.key} className="border-t border-border">
                        <td className="py-2 text-sm font-medium px-2 pl-0">{row.label}</td>
                        <td className="py-2 text-sm text-muted-foreground uppercase px-2">{row.channel}</td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {row.delivered.toLocaleString()}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {row.unique_opens.toLocaleString()}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {formatBpPercent(row.open_rate_bp)}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {row.unique_clicks.toLocaleString()}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {formatMoney(row.revenue_mu, cc)}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {formatRatio4dp(row.revenue_per_recipient_mu, cc)}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {formatRatio4dp(row.revenue_per_unique_open_mu, cc)}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {row.orders.toLocaleString()}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {row.unsubscribes.toLocaleString()}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {formatBpPercent(row.unsubscribe_rate_bp)}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2">
                          {row.spam_complaints.toLocaleString()}
                        </td>
                        <td className="py-2 text-sm tabular-nums text-right px-2 pr-0">
                          {formatBpPercent(row.spam_rate_bp)}
                        </td>
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
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}

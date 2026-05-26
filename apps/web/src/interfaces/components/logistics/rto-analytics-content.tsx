'use client';

// @paradigm: sql
// RtoAnalyticsContent — the /rto-analytics page (Phase-2 slice-3).
// Renders the RTO leak picture (rate, cost, revenue lost, by-payment, by-courier) for the
// anchor brand. CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.logistics.rto.
// CF-C6-FORMATMONEY-CANONICAL-1: every money value via formatMoney. CF-C6-BIGINT-JSON-1.

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/logistics/format-bp.js';

export function RtoAnalyticsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));

  const { data, isLoading, error } = trpc.logistics.rto.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled: Boolean(isAuthenticated && workspaceId) },
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">RTO Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">the RTO leak, by payment method and courier</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="rto-from" className="sr-only">From date</label>
          <input id="rto-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="rto-to" className="sr-only">To date</label>
          <input id="rto-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading RTO analytics" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay title="Failed to load RTO analytics" message={error.message} requestId={(error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {data && (() => {
        const a = data.analytics;
        const cc = a.currency_code;
        return (
          <>
            <div className="sr-only">Data as of {new Date(data.data_epoch).toISOString()}. Request ID: {data.request_id}</div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Stat label="RTO Rate" value={formatBpPercent(a.rto_rate_bp)} />
              <Stat label="RTO Shipments" value={`${a.rto_count} / ${a.total_shipments}`} />
              <Stat label="Total RTO Cost" value={formatMoney(a.total_rto_cost_mu, cc)} accent="red" />
              <Stat label="Revenue Lost to RTO" value={formatMoney(a.revenue_lost_to_rto_mu, cc)} accent="red" />
            </div>

            <Section title="By payment method">
              <Table head={['Method', 'RTO count', 'RTO cost', 'Revenue lost']}>
                {a.by_payment_method.map((p) => (
                  <tr key={p.payment_method} className="border-t border-gray-100">
                    <td className="py-2 text-sm">{p.payment_method}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{String(p.rto_count)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(p.rto_cost_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(p.revenue_lost_mu, cc)}</td>
                  </tr>
                ))}
              </Table>
            </Section>

            <Section title="By courier">
              <Table head={['Courier', 'RTO count', 'RTO cost', 'Revenue lost']}>
                {a.by_courier.map((c) => (
                  <tr key={c.courier_name} className="border-t border-gray-100">
                    <td className="py-2 text-sm">{c.courier_name}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{String(c.rto_count)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(c.rto_cost_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(c.revenue_lost_mu, cc)}</td>
                  </tr>
                ))}
              </Table>
            </Section>
          </>
        );
      })()}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'red' }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${accent === 'red' ? 'text-red-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full">
      <thead>
        <tr>{head.map((h, i) => <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

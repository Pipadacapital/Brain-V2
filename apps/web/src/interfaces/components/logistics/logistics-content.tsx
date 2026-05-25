'use client';

// @paradigm: sql
// LogisticsContent — the /logistics page (Phase-2 slice-3).
// Shiprocket operational summary: delivered/RTO rates, charge breakdown, by-courier.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.logistics.summary.

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/logistics/format-bp.js';

export function LogisticsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));

  const { data, isLoading, error } = trpc.logistics.summary.useQuery(
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Logistics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sugandh Lok — Shiprocket operations: delivery, RTO, and shipping charges</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="log-from" className="sr-only">From date</label>
          <input id="log-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="log-to" className="sr-only">To date</label>
          <input id="log-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading logistics" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay title="Failed to load logistics" message={error.message} requestId={(error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {data && (() => {
        const r = data.result;
        const cc = r.currency_code;
        return (
          <>
            <div className="sr-only">Data as of {new Date(data.data_epoch).toISOString()}. Request ID: {data.request_id}</div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Stat label="Total Shipments" value={String(r.total_shipments)} />
              <Stat label="Delivered" value={formatBpPercent(r.delivered_rate_bp)} />
              <Stat label="RTO" value={formatBpPercent(r.rto_rate_bp)} accent="red" />
              <Stat label="Avg Shipping / Shipment" value={r.average_shipping_charge_per_shipment_mu !== null ? formatMoney(r.average_shipping_charge_per_shipment_mu, cc) : '—'} />
            </div>

            <section className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Charge breakdown</h2>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Chip label="Forward" value={formatMoney(r.forward_charges_mu, cc)} />
                <Chip label="COD" value={formatMoney(r.cod_charges_mu, cc)} />
                <Chip label="RTO" value={formatMoney(r.rto_charges_mu, cc)} />
                <Chip label="Total" value={formatMoney(r.total_shiprocket_charges_mu, cc)} bold />
              </dl>
            </section>

            <section className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">By courier</h2>
              <table className="w-full">
                <thead>
                  <tr>
                    {['Courier', 'Shipments', 'Delivered', 'RTO', 'Charges'].map((h, i) => (
                      <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.by_courier.map((c) => (
                    <tr key={c.courier_name} className="border-t border-gray-100">
                      <td className="py-2 text-sm">{c.courier_name}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{String(c.count)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{String(c.delivered_count)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{String(c.rto_count)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{formatMoney(c.total_charges_mu, cc)}</td>
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'red' }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${accent === 'red' ? 'text-red-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function Chip({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`text-sm tabular-nums ${bold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{value}</dd>
    </div>
  );
}

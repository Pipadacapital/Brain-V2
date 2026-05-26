'use client';

// @paradigm: sql
// PincodeIntelligenceContent — the /pincode-intelligence page (Phase-2 slice-3).
// Per-pincode RTO/COD/delivered/repeat + reliability score + tier, filterable/sortable.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.logistics.pincode.

import { useQueryState, parseAsString, parseAsBoolean } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent, formatScore } from '@/interfaces/components/logistics/format-bp.js';

export function PincodeIntelligenceContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [highRto, setHighRto] = useQueryState('high_rto', parseAsBoolean.withDefault(false));

  const { data, isLoading, error } = trpc.logistics.pincode.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      search: search || undefined,
      high_rto: highRto || undefined,
      sort: 'reliability_score',
      order: 'desc',
    },
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Pincode Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-0.5">destination reliability by pincode (RTO risk, COD load, repeat rate)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="pin-from" className="sr-only">From date</label>
          <input id="pin-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="pin-to" className="sr-only">To date</label>
          <input id="pin-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label htmlFor="pin-search" className="sr-only">Search pincode/city/state</label>
        <input id="pin-search" type="search" placeholder="Search pincode, city, or state" value={search} onChange={(e) => setSearch(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground w-72" />
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={highRto} onChange={(e) => setHighRto(e.target.checked)} className="rounded border-border" />
          High RTO only (&ge; 20%)
        </label>
      </div>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading pincode intelligence" className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay title="Failed to load pincode intelligence" message={error.message} requestId={(error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {data && (
        <section className="bg-white rounded-lg border border-gray-200 p-6 overflow-x-auto">
          <div className="sr-only">Data as of {new Date(data.data_epoch).toISOString()}. Request ID: {data.request_id}. {String(data.total_shipments)} shipments in range.</div>
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                {['Pincode', 'City', 'Tier', 'Shipments', 'RTO %', 'COD %', 'Delivered %', 'AOV', 'Repeat %', 'Reliability'].map((h, i) => (
                  <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i <= 1 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.pincode} className="border-t border-gray-100">
                  <td className="py-2 text-sm">{r.pincode}</td>
                  <td className="py-2 text-sm">{r.city}</td>
                  <td className="py-2 text-sm text-right">{r.tier !== null ? `T${r.tier}` : '—'}</td>
                  <td className="py-2 text-sm tabular-nums text-right">{String(r.shipment_count)}</td>
                  <td className="py-2 text-sm tabular-nums text-right text-red-600">{formatBpPercent(r.rto_rate_bp)}</td>
                  <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(r.cod_rate_bp)}</td>
                  <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(r.delivered_rate_bp)}</td>
                  <td className="py-2 text-sm tabular-nums text-right">{r.aov_mu !== null ? formatMoney(r.aov_mu, 'INR') : '—'}</td>
                  <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(r.repeat_rate_bp)}</td>
                  <td className="py-2 text-sm tabular-nums text-right font-semibold">{formatScore(r.reliability_score)}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan={10} className="py-6 text-center text-sm text-gray-400">No pincodes match the current filters.</td></tr>
              )}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-gray-400">
            Reliability score (0–100) rewards delivery + repeat loyalty and penalizes RTO + COD load. Higher = a safer destination.
          </p>
        </section>
      )}
    </div>
  );
}

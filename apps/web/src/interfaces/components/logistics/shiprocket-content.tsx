'use client';

// @paradigm: sql
// ShiprocketContent — the /shiprocket page (Phase-2 slice-10).
// REUSE-only: real Shiprocket operational view from slice-3 logistics.summary
// (delivered/RTO rates, charge breakdown, by-courier). The legacy /shiprocket route
// is ONLY backfill triggers (owner-only WRITE) — those are DEFERRED (disabled). The
// VIEW lives on logistics. CF-C6-RENDER-ONLY-1: zero arithmetic; values from the BFF.

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/logistics/format-bp.js';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function ShiprocketContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));
  const enabled = Boolean(isAuthenticated && workspaceId);

  const q = trpc.logistics.summary.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });

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

  const r = q.data?.result;
  const cc = r?.currency_code ?? 'INR';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Shiprocket</h1>
          <p className="text-sm text-muted-foreground mt-0.5">shipping operations: delivery, RTO &amp; charges</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button type="button" disabled title="Backfill is available after connector cutover" className="cursor-not-allowed rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-60">Backfill couriers (pending cutover)</button>
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading Shiprocket" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && <ErrorDisplay title="Failed to load Shiprocket" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />}

      {r && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Operations</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Total shipments" value={String(r.total_shipments)} />
              <Stat label="Delivered" value={`${r.delivered_count} (${formatBpPercent(r.delivered_rate_bp)})`} />
              <Stat label="RTO" value={`${r.rto_count} (${formatBpPercent(r.rto_rate_bp)})`} />
              <Stat label="Avg charge / shipment" value={r.average_shipping_charge_per_shipment_mu == null ? '—' : formatMoney(r.average_shipping_charge_per_shipment_mu, cc)} />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Charges</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Forward" value={formatMoney(r.forward_charges_mu, cc)} />
              <Stat label="COD" value={formatMoney(r.cod_charges_mu, cc)} />
              <Stat label="RTO" value={formatMoney(r.rto_charges_mu, cc)} />
              <Stat label="Total" value={formatMoney(r.total_shiprocket_charges_mu, cc)} />
            </div>
          </section>

          {r.by_courier.length > 0 && (
            <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">By courier</h2>
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
                      <td className="py-2 text-sm font-medium">{c.courier_name}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{String(c.count)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{String(c.delivered_count)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{String(c.rto_count)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{formatMoney(c.total_charges_mu, cc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}

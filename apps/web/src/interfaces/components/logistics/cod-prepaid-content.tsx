'use client';

// @paradigm: sql
// CodPrepaidContent — the /cod-prepaid page (Phase-2 slice-3).
// COD vs prepaid economics + the FULL break-even COD RTO rate (the moat).
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.logistics.codPrepaid.

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/logistics/format-bp.js';

export function CodPrepaidContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));

  const { data, isLoading, error } = trpc.logistics.codPrepaid.useQuery(
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">COD vs Prepaid</h1>
          <p className="text-sm text-muted-foreground mt-0.5">realization, effective revenue, and the break-even COD RTO rate</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="cod-from" className="sr-only">From date</label>
          <input id="cod-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="cod-to" className="sr-only">To date</label>
          <input id="cod-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading COD vs prepaid" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay title="Failed to load COD vs prepaid" message={error.message} requestId={(error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {data && (() => {
        const r = data.result;
        const cc = r.currency_code;
        return (
          <>
            <div className="sr-only">Data as of {new Date(data.data_epoch).toISOString()}. Request ID: {data.request_id}</div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Stat label="COD Realization" value={formatBpPercent(r.cod_realization_rate_bp)} />
              <Stat label="Avg Order Value" value={r.average_order_value_mu !== null ? formatMoney(r.average_order_value_mu, cc) : '—'} />
              <Stat
                label="Break-even COD RTO Rate"
                value={r.breakeven_cod_rto_rate_bp !== null ? formatBpPercent(r.breakeven_cod_rto_rate_bp) : (r.breakeven_note ?? '—')}
                accent="amber"
              />
              <Stat label="Prepaid Premium" value={formatMoney(r.prepaid_premium_mu, cc)} />
            </div>

            <section className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">COD vs Prepaid</h2>
              <table className="w-full">
                <thead>
                  <tr>
                    {['Method', 'Orders', 'Gross', 'RTO %', 'Effective', 'Fees', '₹/order'].map((h, i) => (
                      <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.comparison.map((s) => (
                    <tr key={s.payment_method} className="border-t border-gray-100">
                      <td className="py-2 text-sm">{s.payment_method}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{String(s.orders)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{formatMoney(s.gross_revenue_mu, cc)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(s.rto_rate_bp)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{formatMoney(s.effective_revenue_mu, cc)}</td>
                      <td className="py-2 text-sm tabular-nums text-right text-red-600">{formatMoney(s.fee_total_mu, cc)}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{s.net_revenue_per_order_mu !== null ? formatMoney(s.net_revenue_per_order_mu, cc) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-4 text-xs text-gray-400">
                Break-even = the COD RTO rate above which prepaid is more profitable at the current AOV and fees
                (full formula: V·P + (COD fee − gateway fee) + P·return-shipping, over V + return-shipping). Above it, nudge prepaid.
              </p>
            </section>
          </>
        );
      })()}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'amber' }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${accent === 'amber' ? 'text-amber-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

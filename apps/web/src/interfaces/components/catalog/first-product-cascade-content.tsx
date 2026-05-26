'use client';

// @paradigm: sql
// FirstProductCascadeContent — the /first-product-cascade page (Phase-2 slice-6).
// Renders the legacy First Product Cascade table: per first product, what downstream repeat
// behavior + revenue LTV it leads to. second/third/fourth+ order rates (per-first-product
// cohort — Finding 4, NOT slice-5 rr90), additional-order rate, avg revenue LTV, avg days to
// second. CF-C6-RENDER-ONLY-1: zero arithmetic; values from trpc.catalog.firstProductCascade.
// rates are bp (÷100 display); additional-order is centi (÷100); days-to-second is deci (÷10).

import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/marketing/format-ratio.js';

/** centi-orders → "1.25" extra orders (display only). */
function formatCenti(centi: bigint): string {
  return (Number(centi) / 100).toFixed(2);
}

/** deci-days → "30.0 days" (display only); null → "—". */
function formatDeciDays(deci: bigint | null): string {
  if (deci === null) return '—';
  return `${(Number(deci) / 10).toFixed(1)} days`;
}

export function FirstProductCascadeContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));
  const [obs, setObs] = useQueryState('obs', parseAsInteger.withDefault(365));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.catalog.firstProductCascade.useQuery(
    { date_start: dateStart, date_end: dateEnd, observation_days: obs },
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">First Product Cascade</h1>
          <p className="text-sm text-muted-foreground mt-0.5">which first product leads to repeat purchase &amp; downstream LTV</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="fpc-obs" className="text-sm text-muted-foreground">Observation</label>
          <select id="fpc-obs" value={String(obs)} onChange={(e) => setObs(Number(e.target.value))} aria-label="Observation window days" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {[90, 180, 365, 730].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
          <label htmlFor="fpc-from" className="sr-only">From date</label>
          <input id="fpc-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="fpc-to" className="sr-only">To date</label>
          <input id="fpc-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading first product cascade" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load first product cascade" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (() => {
        const r = q.data.result;
        const cc = r.currency_code;
        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Stat label="Cohort customers" value={String(r.total_cohort_customers)} sub={`First order in range, observed ${r.observation_days}d`} />
              <Stat label="Hero first product" value={r.rows[0]?.product_title ?? '—'} sub="Largest first-order cohort" />
            </div>

            <Section title="First product → repeat behavior">
              <Table head={['First product', 'Cohort', '2nd order', '3rd order', '4th+ order', 'Extra orders', 'Avg LTV', 'Days to 2nd']}>
                {r.rows.map((row) => (
                  <tr key={row.product_key} className="border-t border-gray-100">
                    <td className="py-2 text-sm">{row.product_title}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{String(row.first_order_customers)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(row.second_order_rate_bp)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(row.third_order_rate_bp)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(row.fourth_plus_rate_bp)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatCenti(row.additional_order_rate_centi)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(row.average_ltv_revenue_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatDeciDays(row.average_days_to_second_deci)}</td>
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-gray-900">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
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

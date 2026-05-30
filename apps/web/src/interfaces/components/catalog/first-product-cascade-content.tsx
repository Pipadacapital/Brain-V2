'use client';

// @paradigm: sql
// FirstProductCascadeContent — the /first-product-cascade page (Phase-2 slice-6, parity-38 fix).
// Renders the legacy First Product Cascade table: per first product, what downstream repeat
// behavior + revenue LTV it leads to. second/third/fourth+ order rates (per-first-product
// cohort — Finding 4, NOT slice-5 rr90), additional-order rate, avg revenue LTV, avg days to
// second. CF-C6-RENDER-ONLY-1: zero arithmetic; values from trpc.catalog.firstProductCascade.
// rates are bp (÷100 display); additional-order is centi (÷100); days-to-second is deci (÷10).
//
// Parity-38 restoration:
//   - cohort funnel summary card (counts + waterfall percents)
//   - column sorting (click header to sort asc/desc)
//   - date range + observation window honored server-side (already wired in UI; fix in analytics)

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useState } from 'react';
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

type SortKey = 'product_title' | 'first_order_customers' | 'second_order_rate_bp' | 'third_order_rate_bp' | 'fourth_plus_rate_bp' | 'additional_order_rate_centi' | 'average_ltv_revenue_mu' | 'average_days_to_second_deci';
type SortDir = 'asc' | 'desc';

function SortIndicator({ col, sort, dir }: { col: SortKey; sort: SortKey; dir: SortDir }) {
  if (col !== sort) return <span className="text-muted-foreground/40 ml-0.5">↕</span>;
  return <span className="ml-0.5">{dir === 'asc' ? '↑' : '↓'}</span>;
}

export function FirstProductCascadeContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));
  const [obs, setObs] = useQueryState('obs', parseAsInteger.withDefault(365));
  const [sortKey, setSortKey] = useState<SortKey>('first_order_customers');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.catalog.firstProductCascade.useQuery(
    { date_start: dateStart, date_end: dateEnd, observation_days: obs },
    { enabled },
  );

  function toggleSort(col: SortKey) {
    if (sortKey === col) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(col);
      setSortDir('desc');
    }
  }

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

        // Cohort funnel: aggregate across all products.
        const totalCohort = r.total_cohort_customers;
        const totalWith2nd = r.rows.reduce((s, row) => s + Number(row.customers_with_2nd_order), 0);
        const totalWith3rd = r.rows.reduce((s, row) => s + Number(row.customers_with_3rd_order), 0);
        const totalWith4th = r.rows.reduce((s, row) => s + Number(row.customers_with_4th_plus_order), 0);
        const funnelPct = (n: number) => totalCohort > 0 ? ((n / Number(totalCohort)) * 100).toFixed(1) + '%' : '—';

        // Sort rows client-side.
        type R = typeof r.rows[0];
        const sortedRows = [...r.rows].sort((a: R, b: R) => {
          let av: number, bv: number;
          switch (sortKey) {
            case 'product_title':
              return sortDir === 'asc'
                ? a.product_title.localeCompare(b.product_title)
                : b.product_title.localeCompare(a.product_title);
            case 'first_order_customers': av = Number(a.first_order_customers); bv = Number(b.first_order_customers); break;
            case 'second_order_rate_bp': av = a.second_order_rate_bp ?? -1; bv = b.second_order_rate_bp ?? -1; break;
            case 'third_order_rate_bp': av = a.third_order_rate_bp ?? -1; bv = b.third_order_rate_bp ?? -1; break;
            case 'fourth_plus_rate_bp': av = a.fourth_plus_rate_bp ?? -1; bv = b.fourth_plus_rate_bp ?? -1; break;
            case 'additional_order_rate_centi': av = Number(a.additional_order_rate_centi); bv = Number(b.additional_order_rate_centi); break;
            case 'average_ltv_revenue_mu': av = Number(a.average_ltv_revenue_mu); bv = Number(b.average_ltv_revenue_mu); break;
            case 'average_days_to_second_deci': av = a.average_days_to_second_deci !== null ? Number(a.average_days_to_second_deci) : -1; bv = b.average_days_to_second_deci !== null ? Number(b.average_days_to_second_deci) : -1; break;
            default: return 0;
          }
          return sortDir === 'asc' ? av - bv : bv - av;
        });

        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            {/* Summary KPI strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Stat label="Cohort customers" value={String(totalCohort)} sub={`First order in range, observed ${r.observation_days}d`} />
              <Stat label="Hero first product" value={r.rows[0]?.product_title ?? '—'} sub="Largest first-order cohort" />
            </div>

            {/* Cohort funnel card — parity-38 restoration */}
            {totalCohort > 0 && (
              <section className="bg-card rounded-lg border p-6 space-y-3" aria-label="Cohort funnel">
                <h2 className="text-sm font-semibold text-foreground">Repeat order funnel</h2>
                <p className="text-xs text-muted-foreground">% of {String(totalCohort)} cohort customers who reached each order milestone</p>
                <div className="flex gap-3 flex-wrap">
                  {[
                    { label: '1st order', count: Number(totalCohort), pct: '100%' },
                    { label: '2nd order', count: totalWith2nd, pct: funnelPct(totalWith2nd) },
                    { label: '3rd order', count: totalWith3rd, pct: funnelPct(totalWith3rd) },
                    { label: '4th+ order', count: totalWith4th, pct: funnelPct(totalWith4th) },
                  ].map((step) => (
                    <div key={step.label} className="flex flex-col items-center gap-1 px-4 py-3 bg-muted/40 rounded-lg min-w-[80px]">
                      <span className="text-xs text-muted-foreground">{step.label}</span>
                      <span className="text-lg font-semibold tabular-nums text-foreground">{step.pct}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{step.count.toLocaleString()} cust.</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <Section title="First product → repeat behavior">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr>
                      {(
                        [
                          { label: 'First product', key: 'product_title', align: 'left' },
                          { label: 'Cohort', key: 'first_order_customers', align: 'right' },
                          { label: '2nd order', key: 'second_order_rate_bp', align: 'right' },
                          { label: '3rd order', key: 'third_order_rate_bp', align: 'right' },
                          { label: '4th+ order', key: 'fourth_plus_rate_bp', align: 'right' },
                          { label: 'Extra orders', key: 'additional_order_rate_centi', align: 'right' },
                          { label: 'Avg LTV', key: 'average_ltv_revenue_mu', align: 'right' },
                          { label: 'Days to 2nd', key: 'average_days_to_second_deci', align: 'right' },
                        ] as Array<{ label: string; key: SortKey; align: 'left' | 'right' }>
                      ).map(({ label, key, align }) => (
                        <th
                          key={key}
                          className={`pb-2 text-xs font-medium text-muted-foreground text-${align} cursor-pointer select-none hover:text-foreground`}
                          onClick={() => toggleSort(key)}
                          aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          {label}
                          <SortIndicator col={key} sort={sortKey} dir={sortDir} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          No first-product cascade data for this period.
                        </td>
                      </tr>
                    ) : sortedRows.map((row) => (
                      <tr key={row.product_key} className="border-t border-border hover:bg-muted/20">
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
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        );
      })()}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-lg border p-6 space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

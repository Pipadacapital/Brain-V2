'use client';

// @paradigm: sql
// ProductsContent — the /products page (Phase-2 slice-6, feat-catalog-inventory).
// Renders the per-product performance table: CM1 (Finding 1 — products is CM1, NOT per-SKU CM2),
// cm1%, cm1 share, pareto grade, return-rate, AOV. CF-C6-RENDER-ONLY-1: zero arithmetic; all
// values from trpc.catalog.products. cm1% / return-rate are bp (÷100 for display only).

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/marketing/format-ratio.js';

const GROUP_BY = ['product', 'variant', 'collection', 'vendor', 'type'] as const;
const SORT = ['cm1', 'revenue', 'return_rate', 'pareto_grade', 'aov', 'label'] as const;

const PARETO_TONE: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-amber-100 text-amber-800',
  F: 'bg-red-100 text-red-800',
};

export function ProductsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));
  const [groupBy, setGroupBy] = useQueryState('groupBy', parseAsString.withDefault('product'));
  const [sort, setSort] = useQueryState('sort', parseAsString.withDefault('cm1'));
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.catalog.products.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      group_by: groupBy as (typeof GROUP_BY)[number],
      sort: sort as (typeof SORT)[number],
      direction: 'desc',
      search: search || undefined,
    },
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground mt-0.5">per-product contribution margin (CM1), Pareto grade &amp; returns</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Group by" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {GROUP_BY.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {SORT.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label htmlFor="prod-q" className="sr-only">Search</label>
          <input id="prod-q" type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <label htmlFor="prod-from" className="sr-only">From date</label>
          <input id="prod-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="prod-to" className="sr-only">To date</label>
          <input id="prod-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading products" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load products" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (() => {
        const r = q.data.result;
        const cc = r.currency_code;
        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Stat label="Products" value={String(r.total_rows)} sub="In range" />
              <Stat label="Total CM1" value={formatMoney(r.total_cm1_mu, cc)} sub="Sum of product CM1" accent="green" />
              <Stat label="Top product" value={r.rows[0]?.label ?? '—'} sub="By current sort" />
            </div>

            <Section title="Product performance (CM1)">
              <Table head={['Product', 'Grade', 'CM1', 'CM1 %', 'Revenue', 'Sold', 'Return', 'Orders', 'AOV']}>
                {r.rows.map((row) => (
                  <tr key={row.label} className="border-t border-gray-100">
                    <td className="py-2 text-sm">{row.label}</td>
                    <td className="py-2 text-sm text-right">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${PARETO_TONE[row.pareto_grade] ?? ''}`}>{row.pareto_grade}</span>
                    </td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(row.cm1_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(row.cm1_pct_bp)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(row.revenue_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{String(row.sold)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(row.return_rate_bp)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{String(row.orders)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{row.aov_mu === null ? '—' : formatMoney(row.aov_mu, cc)}</td>
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

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'green' }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${accent === 'green' ? 'text-green-700' : 'text-gray-900'}`}>{value}</div>
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

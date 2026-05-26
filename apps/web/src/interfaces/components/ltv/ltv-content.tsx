'use client';

// @paradigm: sql
// LtvContent — the /lifetime-value page (Phase-2 slice-5, feat-cohorts-ltv).
// Renders the LTV-by-dimension curve (CM2 — Finding 2; NO CAC/payback here, those are cohort
// concepts), summary cards (month 1/3/6/12), and a paginated/searchable dimension table.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.ltv.summary.

import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

const METRICS = ['cm2', 'revenue', 'repeat_rate'] as const;
const MODES = ['cumulative', 'post_acq', 'incremental'] as const;
const DIMENSIONS = ['product', 'variant', 'vendor', 'product_type', 'product_tags', 'order_tags', 'discount_pct', 'customer_id'] as const;

/** Display a CM2/revenue value or a repeat_rate bp depending on metric. */
function formatLtvValue(value: bigint, metric: string, currency: string): string {
  if (metric === 'repeat_rate') {
    const bp = Number(value);
    return `${Math.floor(bp / 100)}%`;
  }
  return formatMoney(value, currency);
}

export function LtvContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));
  const [metric, setMetric] = useQueryState('metric', parseAsString.withDefault('cm2'));
  const [mode, setMode] = useQueryState('mode', parseAsString.withDefault('cumulative'));
  const [dimension, setDimension] = useQueryState('dimension', parseAsString.withDefault('product'));
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.ltv.summary.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      metric: metric as (typeof METRICS)[number],
      mode: mode as (typeof MODES)[number],
      dimension: dimension as (typeof DIMENSIONS)[number],
      search: search || undefined,
      page,
      page_size: 20,
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

  const months = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Lifetime Value</h1>
          <p className="text-sm text-muted-foreground mt-0.5">LTV curve by dimension (CM2-first)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={dimension} onChange={(e) => setDimension(e.target.value)} aria-label="Dimension" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input id="ltv-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} aria-label="From date" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <input id="ltv-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} aria-label="To date" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      <input
        type="search"
        placeholder="Search dimension…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        aria-label="Search dimension"
        className="w-full sm:w-72 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
      />

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading lifetime value" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load lifetime value" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (() => {
        const r = q.data.result;
        const cc = r.currency_code;
        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
              <Stat label="First order" value={formatLtvValue(r.first_order_realized_mu, metric, cc)} sub="Realized, weighted" />
              <Stat label="1 month" value={formatLtvValue(r.month1_mu, metric, cc)} accent="green" />
              <Stat label="3 months" value={formatLtvValue(r.month3_mu, metric, cc)} accent="green" />
              <Stat label="6 months" value={formatLtvValue(r.month6_mu, metric, cc)} accent="green" />
              <Stat label="12 months" value={formatLtvValue(r.month12_mu, metric, cc)} accent="green" />
            </div>

            {/* Per-dimension LTV curve */}
            <Section title={`LTV by ${dimension} — ${metric} (${mode})`}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="text-left p-2 font-medium text-gray-500 sticky left-0 bg-white">{dimension}</th>
                      <th className="text-right p-2 font-medium text-gray-500">New</th>
                      <th className="text-right p-2 font-medium text-gray-500">First</th>
                      {months.map((m) => <th key={m} className="text-right p-2 font-medium text-gray-500">{m}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row) => (
                      <tr key={row.dimension_value} className="border-t border-gray-100">
                        <td className="p-2 font-medium text-gray-900 sticky left-0 bg-white">{row.dimension_label}</td>
                        <td className="p-2 text-right tabular-nums text-gray-700">{String(row.new_customers)}</td>
                        <td className="p-2 text-right tabular-nums text-gray-700">{formatLtvValue(row.first_order_realized_mu, metric, cc)}</td>
                        {row.m.map((c, i) => (
                          <td key={i} className="p-2 text-right tabular-nums text-gray-900">{formatLtvValue(c, metric, cc)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between pt-2 text-sm text-gray-500">
                <span>{String(r.total_rows)} rows</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="px-2 py-1 border border-border rounded disabled:opacity-40">Prev</button>
                  <span>Page {page}</span>
                  <button onClick={() => setPage(page + 1)} disabled={page * 20 >= Number(r.total_rows)} className="px-2 py-1 border border-border rounded disabled:opacity-40">Next</button>
                </div>
              </div>
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

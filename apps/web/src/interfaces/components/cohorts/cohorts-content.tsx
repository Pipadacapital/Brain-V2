'use client';

// @paradigm: sql
// CohortsContent — the /cohorts page (Phase-2 slice-5, feat-cohorts-ltv).
// Renders the cohort retention/repeat heatmap (CM3 — Finding 1), per-cohort CAC / rr90 /
// payback (cumulative bucket-walk — Finding 3) / cohort LTV / LTV:CAC, and a summary strip.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.cohorts.matrix. payback is
// shown in months (centi-months ÷ 100, display only).

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpMultiple, formatBpPercent } from '@/interfaces/components/marketing/format-ratio.js';
import { CohortHeatmap, type HeatmapMetric } from '@/interfaces/components/cohorts/cohort-heatmap.js';

const METRICS: HeatmapMetric[] = ['cm3', 'revenue', 'repeat', 'repurchase'];
const MODES = ['post', 'cumulative', 'incr', 'pct', 'ltvcac'] as const;

/** centi-months → "1.0 mo" / "Immediate" / "—" (display only). */
function formatPayback(centi: number | null | undefined): string {
  if (centi === null || centi === undefined) return '—';
  if (centi === 0) return 'Immediate';
  return `${(centi / 100).toFixed(1)} mo`;
}

export function CohortsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));
  const [metric, setMetric] = useQueryState('metric', parseAsString.withDefault('cm3'));
  const [mode, setMode] = useQueryState('mode', parseAsString.withDefault('post'));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.cohorts.matrix.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      metric: metric as HeatmapMetric,
      mode: mode as (typeof MODES)[number],
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Cohorts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sugandh Lok — repeat-purchase &amp; retention by acquisition month (CM3-first)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <label htmlFor="coh-from" className="sr-only">From date</label>
          <input id="coh-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="coh-to" className="sr-only">To date</label>
          <input id="coh-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading cohorts" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load cohorts" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (() => {
        const r = q.data.result;
        const cc = r.currency_code;
        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            {/* Summary strip */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Stat label="Avg CAC" value={r.average_cac_mu === null ? '—' : formatMoney(r.average_cac_mu, cc)} sub="Ad spend ÷ new customers" />
              <Stat label="90-day repeat" value={formatBpPercent(r.avg_90day_repeat_bp)} sub="Repeat within 90 days" accent="green" />
              <Stat label="Avg payback" value={formatPayback(r.average_payback_centimonths)} sub="Customer-weighted (CM3)" accent="green" />
              <Stat label="New customers" value={String(r.new_customers)} sub="Across all cohorts" />
            </div>

            {/* Heatmap */}
            <Section title={`Retention heatmap — ${metric} (${mode})`}>
              <CohortHeatmap
                rows={r.rows.map((row) => ({ label: row.cohort_month, newCustomers: Number(row.new_customers), cells: row.m }))}
                metric={metric as HeatmapMetric}
                currency={cc}
              />
            </Section>

            {/* Per-cohort economics */}
            <Section title="Per-cohort economics">
              <Table head={['Cohort', 'New', 'CAC', 'rr90', 'Payback', 'Cohort LTV', 'LTV:CAC']}>
                {r.rows.map((row) => (
                  <tr key={row.cohort_month} className="border-t border-gray-100">
                    <td className="py-2 text-sm">{row.cohort_month}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{String(row.new_customers)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{row.cac_mu === null ? '—' : formatMoney(row.cac_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(row.rr90_bp)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatPayback(row.payback_centimonths)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(row.cohort_ltv_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatBpMultiple(row.ltv_cac_bp)}</td>
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

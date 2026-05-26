'use client';

// @paradigm: sql
// CustomerLifecycleContent — the /customer-lifecycle page (Phase-2 slice-8, READ/ANALYTICS ONLY).
// Renders the recency-vs-empirical-percentile lifecycle buckets (new / active / at_risk / churned),
// the p40/p80 churn thresholds, net-active, and revenue/order attribution by bucket.
// This is NOT classic RFM scoring (Rohan Finding 1) — it is recency-threshold classification.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.lifecycle.states.
// 🚨 COMPLIANCE: REPORTING only — this page never triggers a campaign or an outbound send.

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

const BUCKET_LABEL: Record<string, string> = {
  new: 'New',
  active: 'Active',
  at_risk: 'At risk',
  churned: 'Churned',
};

const BUCKET_TONE: Record<string, string> = {
  new: 'text-blue-700',
  active: 'text-green-700',
  at_risk: 'text-amber-700',
  churned: 'text-red-700',
};

export function CustomerLifecycleContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-05-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-05-31'));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.lifecycle.states.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });

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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Customer Lifecycle</h1>
          <p className="text-sm text-muted-foreground mt-0.5">recency-based segments (new / active / at-risk / churned)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="lc-from" className="sr-only">From date</label>
          <input id="lc-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="lc-to" className="sr-only">To date</label>
          <input id="lc-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading lifecycle" className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load lifecycle" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (() => {
        const r = q.data.result;
        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Churn thresholds</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Net active (new + active)" value={r.net_active.toString()} />
                <Stat label="Total customers" value={r.total_customers.toString()} />
                <Stat label="Typical short cycle (p40)" value={`${r.p40_days} days`} />
                <Stat label="Likely-churn tail (p80)" value={`${r.p80_days} days`} />
              </div>
              <p className="text-xs text-muted-foreground">Thresholds are the {r.used_fallback ? 'fixed DTC fallback (too few repeat gaps)' : 'workspace-empirical repeat-gap percentiles'}. A customer is classified by days since last order vs p40/p80. This is recency segmentation, not a campaign trigger.</p>
            </section>

            <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Segments</h2>
              <table className="w-full">
                <thead>
                  <tr>{['Segment', 'Customers', 'Orders (window)', 'Revenue (window)'].map((h, i) => <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {r.buckets.map((b) => (
                    <tr key={b.bucket} className="border-t border-gray-100">
                      <td className={`py-2 text-sm font-medium ${BUCKET_TONE[b.bucket] ?? ''}`}>{BUCKET_LABEL[b.bucket] ?? b.bucket}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{b.customer_count.toString()}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{b.order_count.toString()}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{formatMoney(b.revenue_mu, r.currency_code)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-gray-200">
                    <td className="py-2 text-sm text-muted-foreground">Unattributed</td>
                    <td className="py-2 text-sm tabular-nums text-right text-muted-foreground">—</td>
                    <td className="py-2 text-sm tabular-nums text-right text-muted-foreground">{r.unattributed_order_count.toString()}</td>
                    <td className="py-2 text-sm tabular-nums text-right text-muted-foreground">{formatMoney(r.unattributed_revenue_mu, r.currency_code)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </>
        );
      })()}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}

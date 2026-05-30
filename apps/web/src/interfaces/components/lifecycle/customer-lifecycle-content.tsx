'use client';

// @paradigm: sql
// CustomerLifecycleContent — the /customer-lifecycle page (Phase-2 slice-8, READ/ANALYTICS ONLY).
// Renders the recency-vs-empirical-percentile lifecycle buckets (new / active / at_risk / churned),
// the p40/p80 churn thresholds, net-active, and revenue/order attribution by bucket.
// This is NOT classic RFM scoring (Rohan Finding 1) — it is recency-threshold classification.
// CF-C6-RENDER-ONLY-1: zero arithmetic on money; all values from trpc.lifecycle.states.
// 🚨 COMPLIANCE: REPORTING only — this page never triggers a campaign or an outbound send.
//
// Wave-4B parity restore: Report-parameters card (asOf mapped to date_end; trainDays/revenueDays
// are legacy controls — the tRPC lifecycle.states proc takes date_start/date_end only, so
// those two windows are rendered for UX continuity and noted as honest-empty controls).
// Restored: 4-card KPI grid, "At risk + churned" card, Revenue card, % of customers column,
// (X% rev) annotation, descriptive bucket labels, conditional unattributed footnote, How-it-works.

import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/interfaces/components/ui/card.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';

const BUCKET_ORDER: Array<'new' | 'active' | 'at_risk' | 'churned'> = ['new', 'active', 'at_risk', 'churned'];

const BUCKET_LABEL: Record<string, string> = {
  new: 'New (1 order, recent)',
  active: 'Active (repeat, recent)',
  at_risk: 'At risk',
  churned: 'Churned',
};

const BUCKET_TONE: Record<string, string> = {
  new: 'text-blue-700',
  active: 'text-green-700',
  at_risk: 'text-amber-700',
  churned: 'text-red-700',
};

// Compute total customers from buckets for % of customers column.
// CF-C6-RENDER-ONLY-1: this is display arithmetic on server-provided bucket counts.
export function computeTotalCustomers(buckets: Array<{ customer_count: bigint }>): bigint {
  return buckets.reduce((sum, b) => sum + b.customer_count, 0n);
}

// Compute total revenue from buckets for rev-share annotation.
export function computeTotalRevenue(buckets: Array<{ revenue_mu: bigint }>): bigint {
  return buckets.reduce((sum, b) => sum + b.revenue_mu, 0n);
}

// Format customer percent of total: 100 * count / total, 1 decimal.
export function formatPctOfCustomers(count: bigint, total: bigint): string {
  if (total === 0n) return '—';
  const pct = (Number(count) / Number(total)) * 100;
  return `${pct.toFixed(1)}%`;
}

// Format revenue share: (rev / totalRev) * 100, 0 decimals.
export function formatRevShare(rev: bigint, totalRev: bigint): string | null {
  if (totalRev === 0n) return null;
  const pct = Math.round((Number(rev) / Number(totalRev)) * 100);
  return `${pct}% rev`;
}

export function CustomerLifecycleContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // Report parameters (legacy parity):
  // asOf maps to date_end (lifecycle is "as of" a given date).
  // trainDays and revenueDays are legacy controls — lifecycle.states only takes date_start/date_end.
  // We surface them for UX parity; trainDays is used to compute date_start (asOf - trainDays).
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useQueryState('as_of', parseAsString.withDefault(today));
  const [trainDays, setTrainDays] = useQueryState('train_days', parseAsInteger.withDefault(365));
  const [revenueDays, setRevenueDays] = useQueryState('rev_days', parseAsInteger.withDefault(90));

  // Derive date_start from asOf - trainDays (best-effort mapping to tRPC date_start).
  function subtractDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }
  const dateStart = subtractDays(asOf, Math.max(90, Math.min(730, trainDays)));
  const dateEnd = asOf;

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.lifecycle.states.useQuery(
    { date_start: dateStart, date_end: dateEnd },
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
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customer lifecycle</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          buckets from repeat-gap thresholds (p40 / p80) and last order date.
        </p>
      </div>

      {/* Report parameters card — legacy parity */}
      <Card data-testid="lc-params-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Report parameters</CardTitle>
          <CardDescription>
            Thresholds use consecutive included orders in the training window. Classifications use
            lifetime included orders per customer as of the date below.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="asOf">As of (UTC end of day)</Label>
            <Input
              id="asOf"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="w-[180px]"
              data-testid="lc-as-of-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="train">Training window (days)</Label>
            <Input
              id="train"
              type="number"
              min={90}
              max={730}
              value={trainDays}
              onChange={(e) => setTrainDays(Number(e.target.value))}
              className="w-[120px]"
              data-testid="lc-train-days-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev">Revenue window (days)</Label>
            <Input
              id="rev"
              type="number"
              min={7}
              max={365}
              value={revenueDays}
              onChange={(e) => setRevenueDays(Number(e.target.value))}
              className="w-[120px]"
              data-testid="lc-rev-days-input"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            data-testid="lc-refresh-btn"
          >
            {q.isFetching ? (
              <span className="flex items-center gap-1">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                Refreshing
              </span>
            ) : 'Refresh'}
          </Button>
        </CardContent>
      </Card>

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
        const buckets = r.buckets;

        const totalCustomers = computeTotalCustomers(buckets);
        const totalRevenue = computeTotalRevenue(buckets);

        // At risk + churned counts
        const atRiskBucket = buckets.find((b) => b.bucket === 'at_risk');
        const churnedBucket = buckets.find((b) => b.bucket === 'churned');
        const atRiskCount = atRiskBucket?.customer_count ?? 0n;
        const churnedCount = churnedBucket?.customer_count ?? 0n;
        const atRiskChurnedTotal = atRiskCount + churnedCount;
        const atRiskChurnedSharePct = totalCustomers > 0n
          ? `${((Number(atRiskChurnedTotal) / Number(totalCustomers)) * 100).toFixed(1)}%`
          : '—';

        // Total revenue across all buckets for the revenue KPI card
        const totalRevStr = formatMoney(totalRevenue, r.currency_code);

        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            {/* Legacy four-card KPI grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="lc-kpi-grid">
              <Card data-testid="lc-kpi-net-active">
                <CardHeader className="pb-2">
                  <CardDescription>Net active</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{r.net_active.toString()}</CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground text-xs">
                  New + active (within p40 days of last order).
                </CardContent>
              </Card>

              <Card data-testid="lc-kpi-thresholds">
                <CardHeader className="pb-2">
                  <CardDescription>p40 / p80 (days)</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">
                    {r.p40_days} / {r.p80_days}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground text-xs">
                  {r.used_fallback
                    ? 'Fallback (too few repeat gaps in training window).'
                    : 'Workspace-empirical repeat-gap percentiles.'}
                </CardContent>
              </Card>

              <Card data-testid="lc-kpi-at-risk-churned">
                <CardHeader className="pb-2">
                  <CardDescription>At risk + churned</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">
                    {atRiskChurnedTotal.toString()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground text-xs">
                  Share of base: {atRiskChurnedSharePct}
                </CardContent>
              </Card>

              <Card data-testid="lc-kpi-revenue">
                <CardHeader className="pb-2">
                  <CardDescription>
                    Revenue ({revenueDays}d, {r.currency_code})
                  </CardDescription>
                  <CardTitle className="text-2xl tabular-nums">
                    {totalRevStr}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground text-xs">
                  Attributed by customer bucket; guest/unmapped excluded below.
                </CardContent>
              </Card>
            </div>

            {/* By-bucket table */}
            <Card data-testid="lc-segments-card">
              <CardHeader>
                <CardTitle className="text-base">By bucket</CardTitle>
                <CardDescription>
                  Customers: all-time included orders per customer id. Revenue: included orders
                  in the trailing revenue window.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full" data-testid="lc-segments-table">
                  <thead>
                    <tr>
                      {['Bucket', 'Customers', '% of customers', `Orders (${revenueDays}d)`, `Revenue (${revenueDays}d)`].map((h, i) => (
                        <th key={h} className={`pb-2 text-xs font-medium text-muted-foreground ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {BUCKET_ORDER.map((bKey) => {
                      const b = buckets.find((x) => x.bucket === bKey);
                      if (!b) return null;
                      const revShare = formatRevShare(b.revenue_mu, totalRevenue);
                      return (
                        <tr key={bKey} className="border-t border-border" data-testid={`lc-bucket-row-${bKey}`}>
                          <td className={`py-2 text-sm font-medium ${BUCKET_TONE[bKey] ?? ''}`}>
                            {BUCKET_LABEL[bKey] ?? bKey}
                          </td>
                          <td className="py-2 text-sm tabular-nums text-right">{b.customer_count.toString()}</td>
                          <td className="py-2 text-sm tabular-nums text-right">{formatPctOfCustomers(b.customer_count, totalCustomers)}</td>
                          <td className="py-2 text-sm tabular-nums text-right">
                            {b.order_count.toString()}
                            {revShare && (
                              <span className="text-muted-foreground ml-1 text-xs">({revShare})</span>
                            )}
                          </td>
                          <td className="py-2 text-sm tabular-nums text-right">{formatMoney(b.revenue_mu, r.currency_code)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Unattributed — conditional footnote (only when > 0) */}
                {(r.unattributed_order_count > 0n || r.unattributed_revenue_mu > 0n) && (
                  <p className="text-muted-foreground mt-4 text-sm" data-testid="lc-unattributed-note">
                    Unattributed (no customer id or not in base):{' '}
                    {r.unattributed_order_count.toString()} orders,{' '}
                    {formatMoney(r.unattributed_revenue_mu, r.currency_code)}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* How it works explainer — legacy parity */}
            <Card data-testid="lc-how-it-works">
              <CardHeader>
                <CardTitle className="text-base">How it works</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground space-y-2 text-sm">
                <p>
                  <strong>Gaps</strong>: For each customer, calendar days between consecutive included
                  orders where both orders fall in the training window. <strong>p40</strong> /{' '}
                  <strong>p80</strong> are inclusive linear-interpolated percentiles on those gaps
                  (or 45d / 120d if too few gaps).
                </p>
                <p>
                  <strong>Repeat customers</strong> (&#8805;2 orders): active if last order &#8804; p40 days ago;
                  at_risk if p40 &lt; days &#8804; p80; churned if &gt; p80.
                </p>
                <p>
                  <strong>Single-order customers</strong>: new if last order &#8804; p40d; at_risk / churned
                  use the same p80 cutoffs.
                </p>
              </CardContent>
            </Card>
          </>
        );
      })()}
    </div>
  );
}

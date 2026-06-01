'use client';

// @paradigm: sql
// RtoAnalyticsContent — the /rto-analytics page (Phase-2 slice-3, parity-pass).
// Renders the RTO leak picture (rate, cost, revenue lost, by-payment, by-courier,
// and optionally RTO by product top-50).
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.logistics.rto.
// CF-C6-FORMATMONEY-CANONICAL-1: every money value via formatMoney.
// Parity fixes applied (vs legacy-parity-audit-v2.md § rto-analytics):
//   P1: "RTO by product (top 50)" table added (by_product array, gated behind non-empty).
//   P1: No-Shiprocket-connection amber banner + zero-shipment empty state added.
//   P1: RTO rate now rounds to 1 decimal (Math.round, matching legacy .toFixed(1)).

import { DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/interfaces/components/ui/card.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/interfaces/components/ui/table.js';

// 90-day default — matches the logistics page (parity: legacy defaultFrom = today-89d)
function makeDefault90dStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - 89);
  return d.toISOString().slice(0, 10);
}

// Round to 1 decimal (legacy: Math.round(rtoCount/total*10000)/100 → toFixed(1))
function fmtRate(bp: number | null): string {
  if (bp === null) return '—';
  return (Math.round(bp) / 100).toFixed(1) + '%';
}

export function RtoAnalyticsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(makeDefault90dStart()));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));

  const { data, isLoading, error } = trpc.logistics.rto.useQuery(
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">RTO Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Return-to-origin overview: rate, cost, and revenue lost. Shiprocket-first: RTO
            definition and revenue lost use Shiprocket data only (COD amount or order total).
            No Shopify mapping required for main KPIs.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="rto-from" className="sr-only">From date</label>
          <input id="rto-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="rto-to" className="sr-only">To date</label>
          <input id="rto-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading RTO analytics" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-muted rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay title="Failed to load RTO analytics" message={error.message}
          requestId={(error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {data && (() => {
        const a = data.analytics;
        const cc = a.currency_code;

        // Not-connected banner
        if (!a.connected) {
          return (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-700">
              No Shiprocket connection. Connect Shiprocket in{' '}
              <a href="/settings/integrations" className="font-medium underline">Settings → Integrations</a>{' '}
              to view RTO analytics.
            </div>
          );
        }

        // Zero-shipment empty state
        if (a.total_shipments === 0n) {
          return (
            <p className="text-sm text-muted-foreground">
              No shipments in this date range. Try a wider range or sync from Shiprocket.
            </p>
          );
        }

        return (
          <>
            <div className="sr-only">Data as of {new Date(data.data_epoch).toISOString()}. Request ID: {data.request_id}</div>

            {/* 4 KPI cards — parity: legacy has 4 cards with sublines */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <KpiCard
                label="RTO Rate"
                value={fmtRate(a.rto_rate_bp)}
                sub={`${Number(a.rto_count).toLocaleString('en-IN')} of ${Number(a.total_shipments).toLocaleString('en-IN')} shipments`}
                accent="red"
              />
              <KpiCard
                label="Total RTO Orders"
                value={Number(a.rto_count).toLocaleString('en-IN')}
                sub="RTO shipments"
              />
              <KpiCard
                label="Total RTO Cost"
                value={formatMoney(a.total_rto_cost_mu, cc)}
                sub="Shiprocket RTO charges"
              />
              <KpiCard
                label="Revenue Lost to RTO"
                value={formatMoney(a.revenue_lost_to_rto_mu, cc)}
                sub="Shiprocket order/shipment value (COD amount or order total)"
              />
            </div>

            {/* By Payment Method */}
            {a.by_payment_method.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By Payment Method</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">RTO count</TableHead>
                        <TableHead className="text-right">RTO cost</TableHead>
                        <TableHead className="text-right">Revenue lost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.by_payment_method.map((p) => (
                        <TableRow key={p.payment_method}>
                          <TableCell>{p.payment_method}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(p.rto_count).toLocaleString('en-IN')}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(p.rto_cost_mu, cc)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(p.revenue_lost_mu, cc)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* By Courier */}
            {a.by_courier.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By Courier</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Courier</TableHead>
                        <TableHead className="text-right">RTO count</TableHead>
                        <TableHead className="text-right">RTO cost</TableHead>
                        <TableHead className="text-right">Revenue lost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.by_courier.map((c) => (
                        <TableRow key={c.courier_name}>
                          <TableCell>{c.courier_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(c.rto_count).toLocaleString('en-IN')}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(c.rto_cost_mu, cc)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(c.revenue_lost_mu, cc)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* RTO by Product — optional Shopify enrichment (top 50), gated behind non-empty */}
            {a.by_product.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">RTO by product (top 50)</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Line items from Shopify-mapped RTO orders; respects workspace filters.
                  </p>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Revenue lost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.by_product.map((p) => (
                        <TableRow key={p.product_title}>
                          <TableCell>{p.product_title}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(p.quantity).toLocaleString('en-IN')}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(p.revenue_lost_mu, cc)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        );
      })()}
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'red';
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold tabular-nums mt-1 ${accent === 'red' ? 'text-destructive' : 'text-foreground'}`}>
          {value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

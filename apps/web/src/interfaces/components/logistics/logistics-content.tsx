'use client';

// @paradigm: sql
// LogisticsContent — the /logistics page (Phase-2 slice-3, parity-pass).
// Shiprocket operational summary: delivered/RTO rates, charge breakdown, by-courier,
// COD vs Prepaid card + by-payment table.
// CF-C6-RENDER-ONLY-1: zero arithmetic — all values from trpc.logistics.summary.
// CF-C6-FORMATMONEY-CANONICAL-1: every money value via formatMoney.
// Parity fixes applied (vs legacy-parity-audit-v2.md § logistics):
//   P1: COD vs Prepaid KPI card restored (cod_count/prepaid_count were returned but unused).
//   P1: By Payment Method table restored (synthesized from cod_count/prepaid_count).
//   P1: forward/cod charges now come from summed shipment facts (not hardcoded 0).
//   P2: default date window changed from 30d → 90d (matches legacy defaultFrom = today-89d).
//   P2: avg-shipping/shipment moved to sub-line under Total Charges (not standalone KPI).
//   P2: delivered/RTO rates now round to 1 decimal (matches legacy Math.round + toFixed(1)).

import { DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/interfaces/components/ui/card.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/interfaces/components/ui/table.js';

// Parity: legacy uses Math.round((count/total)*10000)/100 then .toFixed(1).
// bp is floored; we replicate the round+1-decimal display here.
function fmtRate(bp: number | null): string {
  if (bp === null) return '—';
  return (Math.round(bp) / 100).toFixed(1) + '%';
}

// 90-day default matches legacy (today - 89 days)
function makeDefault90dStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - 89);
  return d.toISOString().slice(0, 10);
}

export function LogisticsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(makeDefault90dStart()));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));

  const { data, isLoading, error } = trpc.logistics.summary.useQuery(
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Logistics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Shiprocket operations: delivery, RTO, charges and COD vs Prepaid split
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="log-from" className="sr-only">From date</label>
          <input id="log-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="log-to" className="sr-only">To date</label>
          <input id="log-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading logistics" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-muted rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay title="Failed to load logistics" message={error.message}
          requestId={(error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {data && (() => {
        const r = data.result;
        const cc = r.currency_code;
        const avgShipping = r.average_shipping_charge_per_shipment_mu !== null
          ? `avg ${formatMoney(r.average_shipping_charge_per_shipment_mu, cc)}/shipment`
          : null;
        return (
          <>
            <div className="sr-only">Data as of {new Date(data.data_epoch).toISOString()}. Request ID: {data.request_id}</div>

            {/* Row 1: 4 KPI cards — Total Shipments, Delivered %, RTO %, COD vs Prepaid */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <KpiCard label="Total Shipments" value={Number(r.total_shipments).toLocaleString('en-IN')}
                sub={`${Number(r.delivered_count).toLocaleString('en-IN')} delivered`} />
              <KpiCard label="Delivered" value={fmtRate(r.delivered_rate_bp)}
                sub={`${Number(r.delivered_count).toLocaleString('en-IN')} of ${Number(r.total_shipments).toLocaleString('en-IN')} shipments`} />
              <KpiCard label="RTO" value={fmtRate(r.rto_rate_bp)} accent="red"
                sub={`${Number(r.rto_count).toLocaleString('en-IN')} shipments`} />
              <KpiCard label="COD vs Prepaid" value={`${Number(r.cod_count).toLocaleString('en-IN')} / ${Number(r.prepaid_count).toLocaleString('en-IN')}`}
                sub="COD · Prepaid" />
            </div>

            {/* Row 2: 4 Charge cards — Forward, COD, RTO, Total (with avg sub-line) */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <KpiCard label="Forward Charges" value={formatMoney(r.forward_charges_mu, cc)} />
              <KpiCard label="COD Charges" value={formatMoney(r.cod_charges_mu, cc)} />
              <KpiCard label="RTO Charges" value={formatMoney(r.rto_charges_mu, cc)} />
              <KpiCard label="Shiprocket Charges" value={formatMoney(r.total_shiprocket_charges_mu, cc)}
                sub={avgShipping ?? undefined} />
            </div>

            {/* By Payment Method */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By Payment Method</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Shipments</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>COD</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(r.cod_count).toLocaleString('en-IN')}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Prepaid</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(r.prepaid_count).toLocaleString('en-IN')}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* By Courier */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By Courier</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Courier</TableHead>
                      <TableHead className="text-right">Shipments</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                      <TableHead className="text-right">RTO</TableHead>
                      <TableHead className="text-right">Charges</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.by_courier.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                          No courier data in this date range.
                        </TableCell>
                      </TableRow>
                    ) : r.by_courier.map((c) => (
                      <TableRow key={c.courier_name}>
                        <TableCell>{c.courier_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(c.count).toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(c.delivered_count).toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(c.rto_count).toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(c.total_charges_mu, cc)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
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

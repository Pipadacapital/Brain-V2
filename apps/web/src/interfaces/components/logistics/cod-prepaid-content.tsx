'use client';

// @paradigm: sql
// CodPrepaidContent — the /cod-prepaid page (Phase-2 slice-3, parity-pass).
// COD vs prepaid economics + the FULL break-even COD RTO rate (the moat).
// CF-C6-RENDER-ONLY-1: zero arithmetic on metric values; all from trpc.logistics.codPrepaid.
// CF-C6-FORMATMONEY-CANONICAL-1: every money value via formatMoney.
// Parity fixes applied (vs legacy-parity-audit-v2.md § cod-prepaid):
//   P1: Interactive fee-assumption inputs restored (COD fee/order, return shipping, gateway %).
//   P1: 5 dropped KPI cards restored (COD orders, Prepaid orders, COD RTO rate,
//       Prepaid RTO rate, Effective revenue COD, Effective revenue Prepaid).
//   P1: No-connection banner + no-shipments empty state added.
//   P2: Net Revenue column added (net_revenue_mu = effective − fee_total).
//   P2: Percent values now round to 1 decimal (legacy .toFixed(1), not floor to 2).
//   P2: Replaced hardcoded gray classes with shadcn Card + theme tokens.

import { useState, useTransition } from 'react';
import { DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { useScopedPath } from '@/infrastructure/workspace-slug-context.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/interfaces/components/ui/card.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/interfaces/components/ui/table.js';
import { Button } from '@/interfaces/components/ui/button.js';

// 90-day default
function makeDefault90dStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - 89);
  return d.toISOString().slice(0, 10);
}

// Round to 1 decimal (legacy toFixed(1) after Math.round)
function fmtRate(bp: number | null): string {
  if (bp === null) return '—';
  return (Math.round(bp) / 100).toFixed(1) + '%';
}

// Default fee assumptions (must match DataPlanePort defaults)
const DEFAULT_COD_FEE_RS = 30;       // ₹30 per order
const DEFAULT_RETURN_SHIP_RS = 80;   // ₹80 per RTO
const DEFAULT_GATEWAY_FEE_PCT = 2.0; // 2%

export function CodPrepaidContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const toPath = useScopedPath();
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(makeDefault90dStart()));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));

  // Fee-assumption inputs — local form state (not URL; these are what-if levers)
  const [codFeeRs, setCodFeeRs] = useState<number>(DEFAULT_COD_FEE_RS);
  const [returnShipRs, setReturnShipRs] = useState<number>(DEFAULT_RETURN_SHIP_RS);
  const [gatewayFeePct, setGatewayFeePct] = useState<number>(DEFAULT_GATEWAY_FEE_PCT);
  // Applied overrides (committed on Apply click)
  const [appliedCodFee, setAppliedCodFee] = useState<bigint | undefined>(undefined);
  const [appliedReturnShip, setAppliedReturnShip] = useState<bigint | undefined>(undefined);
  const [appliedGatewayFeeBp, setAppliedGatewayFeeBp] = useState<number | undefined>(undefined);
  const [, startTransition] = useTransition();

  const { data, isLoading, error, refetch } = trpc.logistics.codPrepaid.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      cod_fee_per_order_mu: appliedCodFee,
      return_shipping_per_rto_mu: appliedReturnShip,
      gateway_fee_bp: appliedGatewayFeeBp,
    },
    { enabled: Boolean(isAuthenticated && workspaceId) },
  );

  function handleApply() {
    startTransition(() => {
      setAppliedCodFee(BigInt(Math.round(codFeeRs * 100)));
      setAppliedReturnShip(BigInt(Math.round(returnShipRs * 100)));
      setAppliedGatewayFeeBp(Math.round(gatewayFeePct * 100));
    });
    void refetch();
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">COD vs Prepaid</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Realization, effective revenue, and the break-even COD RTO rate. Adjust fee
            assumptions below and click Apply to recompute.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="cod-from" className="sr-only">From date</label>
          <input id="cod-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="cod-to" className="sr-only">To date</label>
          <input id="cod-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {/* Fee-assumption what-if inputs (P1 parity — the moat lever) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Fee assumptions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <FeeInput
              id="cod-fee-per-order"
              label="COD fee / order (₹)"
              value={codFeeRs}
              onChange={setCodFeeRs}
              min={0}
              step={1}
            />
            <FeeInput
              id="return-shipping-per-rto"
              label="Return shipping / RTO (₹)"
              value={returnShipRs}
              onChange={setReturnShipRs}
              min={0}
              step={1}
            />
            <FeeInput
              id="gateway-fee-pct"
              label="Gateway fee %"
              value={gatewayFeePct}
              onChange={setGatewayFeePct}
              min={0}
              max={10}
              step={0.1}
            />
            <Button onClick={handleApply} size="sm" className="shrink-0">
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading COD vs prepaid" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-muted rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay title="Failed to load COD vs prepaid" message={error.message}
          requestId={(error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {data && (() => {
        const r = data.result;
        const cc = r.currency_code;

        if (!r.connected) {
          return (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-700">
              No Shiprocket connection. Connect Shiprocket in{' '}
              <a href={toPath("/settings/integrations")} className="font-medium underline">Settings → Integrations</a>{' '}
              to view COD vs Prepaid analytics.
            </div>
          );
        }

        if (r.cod_orders === 0n && r.prepaid_orders === 0n) {
          return (
            <p className="text-sm text-muted-foreground">
              No shipments in this date range. Try a wider range or sync from Shiprocket.
            </p>
          );
        }

        return (
          <>
            <div className="sr-only">Data as of {new Date(data.data_epoch).toISOString()}. Request ID: {data.request_id}</div>

            {/* Row 1: COD orders / Prepaid orders / COD realization / COD RTO rate / Prepaid RTO rate */}
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
              <KpiCard label="COD Orders" value={Number(r.cod_orders).toLocaleString('en-IN')} />
              <KpiCard label="Prepaid Orders" value={Number(r.prepaid_orders).toLocaleString('en-IN')} />
              <KpiCard label="COD Realization" value={fmtRate(r.cod_realization_rate_bp)}
                sub="Delivered / shipped COD" />
              <KpiCard label="COD RTO Rate" value={fmtRate(r.cod_rto_rate_bp)} accent="red" />
              <KpiCard label="Prepaid RTO Rate" value={fmtRate(r.prepaid_rto_rate_bp)} accent="red" />
            </div>

            {/* Row 2: Break-even / Avg Order Value / Effective Revenue COD / Effective Revenue Prepaid / Prepaid Premium */}
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
              <KpiCard
                label="Break-even COD RTO Rate"
                value={r.breakeven_cod_rto_rate_bp !== null ? fmtRate(r.breakeven_cod_rto_rate_bp) : (r.breakeven_note ?? '—')}
                accent="amber"
              />
              <KpiCard label="Avg Order Value"
                value={r.average_order_value_mu !== null ? formatMoney(r.average_order_value_mu, cc) : '—'} />
              <KpiCard label="Effective Revenue (COD)" value={formatMoney(r.effective_revenue_cod_mu, cc)} />
              <KpiCard label="Effective Revenue (Prepaid)" value={formatMoney(r.effective_revenue_prepaid_mu, cc)} />
              <KpiCard label="Prepaid Premium" value={formatMoney(r.prepaid_premium_mu, cc)} />
            </div>

            {/* Comparison table with Net Revenue column */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">COD vs Prepaid</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Gross Revenue</TableHead>
                      <TableHead className="text-right">RTO %</TableHead>
                      <TableHead className="text-right">Effective Revenue</TableHead>
                      <TableHead className="text-right">Fee (COD ₹ / Gateway %)</TableHead>
                      <TableHead className="text-right">Net Revenue</TableHead>
                      <TableHead className="text-right">Net / Order</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.comparison.map((s) => (
                      <TableRow key={s.payment_method}>
                        <TableCell>{s.payment_method}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(s.orders).toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(s.gross_revenue_mu, cc)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtRate(s.rto_rate_bp)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(s.effective_revenue_mu, cc)}</TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">{formatMoney(s.fee_total_mu, cc)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(s.net_revenue_mu, cc)}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.net_revenue_per_order_mu !== null ? formatMoney(s.net_revenue_per_order_mu, cc) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-4 text-xs text-muted-foreground">
                  Break-even = the COD RTO rate above which prepaid is more profitable at the
                  current AOV and fees (formula: V·P + (COD fee − gateway fee) + P·return-shipping,
                  over V + return-shipping). Above the break-even rate, nudge to prepaid.
                </p>
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
  accent?: 'red' | 'amber';
}) {
  const colorClass = accent === 'red' ? 'text-destructive' : accent === 'amber' ? 'text-amber-600' : 'text-foreground';
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold tabular-nums mt-1 ${colorClass}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function FeeInput({ id, label, value, onChange, min, max, step }: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground w-36 focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

'use client';

// @paradigm: sql
// AnalyticsContent — the /analytics (Store Analytics) page (Phase-2 slice-10).
// REUSE-only: renders the REAL store-level deep analytics by combining slice-1
// store.summary (revenue ladder) + slice-2 pnl.statement (CM ladder + True-CM2)
// + daily net-sales AreaChart (chart-parity with legacy).
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from the BFF.
// CF-C6-FORMATMONEY-CANONICAL-1: formatMoney is the only money formatter.
//
// CF-S10-HONEST-STATE-1 (persona C1): storefront SESSIONS + CONVERSION are Shopify-
// sync fields, NULL in legacy when unsynced and NOT seeded locally. We render an
// HONEST "pending connector cutover" panel for them — NEVER a fabricated number.

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { StalenessLabel } from '@/interfaces/components/shared/staleness-label.js';
import { ConnectorPending } from '@/interfaces/components/shared/connector-pending.js';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/interfaces/components/ui/chart.js';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';

const DAILY_CHART_CONFIG: ChartConfig = {
  netSales: { label: 'Net sales', color: '#96bf48' },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function AnalyticsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));
  const enabled = Boolean(isAuthenticated && workspaceId);

  const summary = trpc.store.summary.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });
  const pnl = trpc.pnl.statement.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });
  const daily = trpc.store.dailySales.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });

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

  const s = summary.data?.summary;
  const p = pnl.data?.statement;
  const cc = s?.currency_code ?? 'INR';

  // Build chart-ready daily rows: convert bigint _mu to number for Recharts pixel math.
  // formatMoney uses the original bigint in the tooltip — never the coerced number.
  const dailyRows = (daily.data?.rows ?? []).map((r) => {
    // Inline date format: 'YYYY-MM-DD' → 'MMM D' using Intl (no date-fns dep needed).
    const dateLabel = new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric' }).format(
      new Date(r.date + 'T00:00:00'),
    );
    return {
      date: r.date,
      dateLabel,
      // Number() coercion here is for Recharts pixel positioning only (SVG math),
      // NOT for display. Display uses formatMoney in ChartTooltipContent formatter.
      netSales: Number(r.net_sales_mu) / 100,   // ÷100: paise → rupees for axis scale
      net_sales_mu: r.net_sales_mu,             // kept for tooltip formatMoney
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Store Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">store-level revenue quality &amp; contribution margin</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="an-from" className="sr-only">From date</label>
          <input id="an-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="an-to" className="sr-only">To date</label>
          <input id="an-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {(summary.isLoading || pnl.isLoading) && (
        <div aria-busy="true" aria-label="Loading store analytics" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {summary.error && <ErrorDisplay title="Failed to load store analytics" message={summary.error.message} requestId={(summary.error as { data?: { requestId?: string } }).data?.requestId} />}
      {pnl.error && <ErrorDisplay title="Failed to load P&L" message={pnl.error.message} requestId={(pnl.error as { data?: { requestId?: string } }).data?.requestId} />}

      {s && (
        <section className="space-y-3">
          {summary.data && <StalenessLabel dataEpoch={new Date(summary.data.data_epoch)} />}
          <h2 className="text-lg font-semibold text-gray-900">Revenue quality</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Gross sales" value={formatMoney(s.gross_sales_mu, cc)} />
            <Stat label="Net sales" value={formatMoney(s.net_sales_mu, cc)} />
            <Stat label="Net revenue" value={formatMoney(s.net_revenue_mu, cc)} />
            <Stat label="Realized revenue" value={formatMoney(s.realized_revenue_mu, cc)} />
            <Stat label="Orders" value={String(s.order_count)} />
            <Stat label="AOV" value={s.aov_mu == null ? '—' : formatMoney(s.aov_mu, cc)} />
          </div>
        </section>
      )}

      {/* Daily net-sales AreaChart — chart parity with legacy analytics page */}
      {dailyRows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Net sales over time</h2>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <ChartContainer config={DAILY_CHART_CONFIG} className="h-[280px] w-full">
              <AreaChart
                data={dailyRows}
                margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="dateLabel"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) =>
                    formatMoney(BigInt(Math.round(Number(v) * 100)), cc)
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(_v, _name, props) => [
                        formatMoney(
                          (props.payload as { net_sales_mu?: bigint }).net_sales_mu ?? 0n,
                          cc,
                        ),
                        'Net sales',
                      ]}
                      labelFormatter={(_label, payload) => {
                        const d = (payload?.[0]?.payload as { date?: string } | undefined)?.date;
                        if (!d) return '';
                        return new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }).format(
                          new Date(d + 'T00:00:00'),
                        );
                      }}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="netSales"
                  stroke="var(--color-netSales)"
                  fill="var(--color-netSales)"
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </div>
        </section>
      )}

      {daily.isLoading && !dailyRows.length && (
        <div className="h-[280px] bg-gray-100 animate-pulse rounded-lg" aria-busy="true" aria-label="Loading daily chart" />
      )}

      {p && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Contribution margin</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="COGS" value={formatMoney(p.cogs_mu, cc)} />
            <Stat label="Ad spend" value={formatMoney(p.total_ad_spend_mu, cc)} />
            <Stat label="CM1" value={formatMoney(p.cm1_mu, cc)} />
            <Stat label="CM2 (after ads)" value={formatMoney(p.cm2_mu, cc)} />
            <Stat label="CM3 (after overheads)" value={formatMoney(p.cm3_mu, cc)} />
            <Stat label="True-CM2 (RTO-adj)" value={p.true_cm2_mu == null ? '—' : formatMoney(p.true_cm2_mu, cc)} />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Storefront engagement</h2>
        <ConnectorPending
          source="Shopify storefront analytics"
          detail="Sessions and conversion rate sync from Shopify. Available after the connector cutover."
        />
      </section>
    </div>
  );
}

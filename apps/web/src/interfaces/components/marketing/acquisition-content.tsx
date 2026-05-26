'use client';

// @paradigm: sql
// AcquisitionContent — the /acquisition page (Phase-2 slice-4, feat-marketing-acquisition).
// Renders MER/aMER/ACOS efficiency + blended CAC + CM2-per-NC + meta/google spend split +
// a daily ComposedChart (Bar ncCm2 + Lines adSpend/cm2PerNc) matching legacy.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.marketing.{efficiency,acquisition,dailyAcquisition}.
// CF-C6-FORMATMONEY-CANONICAL-1: formatMoney is the only money formatter.

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useMemo } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import {
  formatBpMultiple,
  formatX100Multiple,
  formatBpPercent,
} from '@/interfaces/components/marketing/format-ratio.js';
import { ChartContainer, type ChartConfig } from '@/interfaces/components/ui/chart.js';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Cell, Tooltip } from 'recharts';

const CHART_CONFIG: ChartConfig = {
  ncCm2: { label: 'NC CM2', color: 'hsl(var(--chart-1))' },
  adSpend: { label: 'Ad Spend', color: 'hsl(24 95% 53%)' },
  cm2PerNc: { label: 'CM2 per NC', color: 'hsl(0 0% 9%)' },
};

const TOOLTIP_LABELS: Record<string, string> = {
  ncCm2: 'NC CM2',
  adSpend: 'Ad Spend',
  cm2PerNc: 'CM2 per NC',
};

const TOOLTIP_COLORS: Record<string, string> = {
  ncCm2: '#22c55e',
  adSpend: 'hsl(24 95% 53%)',
  cm2PerNc: 'hsl(0 0% 9%)',
};

function AcquisitionChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ name: string; dataKey: string; value: number; color: string }>;
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length || !label) return null;
  const dateLabel = new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(String(label) + 'T00:00:00'),
  );
  return (
    <div className="border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{dateLabel}</div>
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.dataKey && item.value !== undefined)
          .map((item) => (
            <div key={item.dataKey} className="flex w-full items-center gap-2">
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: TOOLTIP_COLORS[item.dataKey] ?? item.color }}
              />
              <span className="text-muted-foreground min-w-[4.5rem]">
                {TOOLTIP_LABELS[item.dataKey] ?? item.name}
              </span>
              <span className="font-mono font-medium tabular-nums">
                {/* Values stored as rupees (÷100 in buildChartRow) — format back */}
                {formatMoney(BigInt(Math.round(item.value * 100)), currency)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

export function AcquisitionContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const eff = trpc.marketing.efficiency.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled },
  );
  const acq = trpc.marketing.acquisition.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled },
  );
  const dailyAcq = trpc.marketing.dailyAcquisition.useQuery(
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

  const isLoading = eff.isLoading || acq.isLoading;
  const error = eff.error || acq.error;

  // Build chart rows: bigint → number ÷100 for Recharts pixel math (rupees).
  // The tooltip receives the raw row and re-multiplies ×100 → formatMoney.
  const chartRows = useMemo(() => {
    return (dailyAcq.data?.rows ?? []).map((r) => ({
      date: r.date,
      // Pixel-math numbers (÷100 paise→rupees) — never displayed as money directly.
      ncCm2: Number(r.nc_cm2_mu) / 100,
      adSpend: Number(r.ad_spend_mu) / 100,
      cm2PerNc: r.cm2_per_nc_mu === null ? 0 : Number(r.cm2_per_nc_mu) / 100,
    }));
  }, [dailyAcq.data]);

  const cc = eff.data?.result.currency_code ?? 'INR';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Acquisition</h1>
          <p className="text-sm text-muted-foreground mt-0.5">marketing efficiency &amp; new-customer economics (CM2-first)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="acq-from" className="sr-only">From date</label>
          <input id="acq-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="acq-to" className="sr-only">To date</label>
          <input id="acq-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading acquisition" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay title="Failed to load acquisition" message={error.message} requestId={(error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {eff.data && acq.data && (() => {
        const e = eff.data.result;
        const s = acq.data.summary;
        return (
          <>
            <div className="sr-only">Data as of {new Date(eff.data.data_epoch).toISOString()}. Request ID: {eff.data.request_id}</div>

            {/* Efficiency strip — aMER + CAC privileged; ROAS/ACOS display-only. */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Stat label="MER" value={formatBpMultiple(e.mer_bp)} sub="Net revenue ÷ all ad spend" />
              <Stat label="aMER" value={formatBpMultiple(e.amer_bp)} sub="NC revenue ÷ acquisition spend" accent="green" />
              <Stat label="Blended CAC" value={s.cac_mu === null ? '—' : formatMoney(s.cac_mu, cc)} sub="Ad spend ÷ new customers" accent="green" />
              <Stat label="CM2 / new customer" value={s.cm2_per_nc_mu === null ? '—' : formatMoney(s.cm2_per_nc_mu, cc)} sub="New-customer CM2 ÷ NC" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Stat label="New customers" value={String(s.new_customers_count)} sub="First order in range" />
              <Stat label="NC revenue" value={formatMoney(s.new_customer_revenue_mu, cc)} sub="Net of tax, RTO excluded" />
              <Stat label="ACOS" value={formatBpPercent(e.acos_bp)} sub="display-only" muted />
              <Stat label="Blended ROAS" value={formatX100Multiple(e.blended_roas_x100)} sub="display-only" muted />
            </div>

            {/* Spend split — blended vs platform. */}
            <Section title="Ad spend split (blended vs platform)">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Stat label="Total ad spend" value={formatMoney(e.total_ad_spend_mu, cc)} />
                <Stat label="Meta" value={formatMoney(e.meta_spend_mu, cc)} />
                <Stat label="Google" value={formatMoney(e.google_spend_mu, cc)} />
              </div>
            </Section>

            {/* Daily ComposedChart — Bar ncCm2 + Lines adSpend/cm2PerNc (legacy parity) */}
            {chartRows.length > 0 && (
              <Section title="Daily new-customer economics">
                <div className="mb-3 flex flex-wrap items-center gap-4">
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-[#22c55e]" />
                    NC CM2
                  </span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(24_95%_53%)]" />
                    Ad Spend
                  </span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-[hsl(0_0%_9%)]" />
                    CM2 per NC
                  </span>
                </div>
                <ChartContainer config={CHART_CONFIG} className="h-[360px] w-full">
                  <ComposedChart
                    data={chartRows}
                    margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) =>
                        new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric' }).format(
                          new Date(String(v) + 'T00:00:00'),
                        )
                      }
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(v) => formatMoney(BigInt(Math.round(Number(v) * 100)), cc)}
                      tick={{ fontSize: 11 }}
                      width={60}
                    />
                    <Tooltip
                      content={<AcquisitionChartTooltip currency={cc} />}
                    />
                    <Bar
                      dataKey="ncCm2"
                      name="NC CM2"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={32}
                    >
                      {chartRows.map((entry, index) => (
                        <Cell
                          key={index}
                          fill={entry.ncCm2 >= 0 ? '#22c55e' : '#ef4444'}
                        />
                      ))}
                    </Bar>
                    <Line
                      type="monotone"
                      dataKey="adSpend"
                      name="Ad Spend"
                      stroke="hsl(24 95% 53%)"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="cm2PerNc"
                      name="CM2 per NC"
                      stroke="hsl(0 0% 9%)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ChartContainer>
              </Section>
            )}

            {dailyAcq.isLoading && !chartRows.length && (
              <div className="h-[360px] bg-gray-100 animate-pulse rounded-lg" aria-busy="true" aria-label="Loading daily acquisition chart" />
            )}

            {/* Daily table — existing tabular data */}
            <Section title="Daily new-customer economics (table)">
              <Table head={['Date', 'New', 'NC CM2', 'CAC', 'aMER']}>
                {acq.data.daily.map((d) => (
                  <tr key={d.date} className="border-t border-gray-100">
                    <td className="py-2 text-sm">{d.date}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{String(d.new_customers)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(d.nc_cm2_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{d.cac_mu === null ? '—' : formatMoney(d.cac_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatBpMultiple(d.amer_bp)}</td>
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

function Stat({ label, value, sub, accent, muted }: { label: string; value: string; sub?: string; accent?: 'green'; muted?: boolean }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-4 ${muted ? 'opacity-70' : ''}`}>
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

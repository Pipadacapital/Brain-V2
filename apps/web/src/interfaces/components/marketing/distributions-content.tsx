'use client';

// @paradigm: sql
// DistributionsContent — the /distributions page (Phase-2 slice-4, feat-marketing-acquisition).
// Renders the per-product value distribution (mode / mean / diff) + a density LineChart
// matching legacy (LineChart with mode + mean ReferenceLine). CF-C6-RENDER-ONLY-1: zero
// arithmetic; all values from trpc.marketing.distributions. CF-C6-FORMATMONEY-CANONICAL-1.

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/interfaces/components/ui/chart.js';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts';

const DENSITY_CHART_CONFIG: ChartConfig = {
  density: { label: 'Density', color: 'hsl(0 0% 9%)' },
};

export function DistributionsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));
  const [metric, setMetric] = useQueryState('metric', parseAsString.withDefault('cm1'));
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const { data, isLoading, error } = trpc.marketing.distributions.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      metric: metric === 'sales' ? 'sales' : 'cm1',
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Distributions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">per-product per-order value distribution (mode vs mean)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="dist-from" className="sr-only">From date</label>
          <input id="dist-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="dist-to" className="sr-only">To date</label>
          <input id="dist-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-md border border-border overflow-hidden" role="group" aria-label="Metric">
          <button type="button" onClick={() => setMetric('cm1')} className={`px-3 py-1.5 text-sm ${metric !== 'sales' ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'}`}>CM1</button>
          <button type="button" onClick={() => setMetric('sales')} className={`px-3 py-1.5 text-sm ${metric === 'sales' ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'}`}>Sales</button>
        </div>
        <label htmlFor="dist-search" className="sr-only">Search product</label>
        <input id="dist-search" type="search" placeholder="Search product..." value={search} onChange={(e) => setSearch(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
      </div>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading distributions" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay title="Failed to load distributions" message={error.message} requestId={(error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {data && (() => {
        const cc = 'INR';
        // Build chart-ready graph_points: convert bigint value_mu to number for Recharts.
        // density_bp is already a number. formatMoney uses the original bigint in tooltip.
        const graphPoints = data.graph_points.map((p) => ({
          // Number() coercion of value_mu is for axis pixel positioning only.
          value: Number(p.value_mu) / 100,   // paise → rupees for axis labels
          value_mu: p.value_mu,              // kept for tooltip / reference lines
          density: p.density_bp / 100,       // bp → percent (0..100 scale)
        }));
        const globalModePx = Number(data.global_mode_mu) / 100;
        const globalMeanPx = Number(data.global_mean_mu) / 100;

        return (
          <>
            <div className="sr-only">Data as of {new Date(data.data_epoch).toISOString()}. Request ID: {data.request_id}</div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Stat label="Global mode" value={formatMoney(data.global_mode_mu, cc)} />
              <Stat label="Global mean" value={formatMoney(data.global_mean_mu, cc)} />
              <Stat label="Products" value={String(data.total_rows)} />
            </div>

            {/* Density LineChart — matches legacy distributions-content.tsx LineChart */}
            {graphPoints.length > 0 ? (
              <Section title={`Density (${data.metric === 'sales' ? 'per-order sales' : 'per-order CM1'})`}>
                <ChartContainer config={DENSITY_CHART_CONFIG} className="h-[280px] w-full">
                  <LineChart
                    data={graphPoints}
                    margin={{ top: 12, right: 12, left: 8, bottom: 24 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="value"
                      tickFormatter={(v) =>
                        formatMoney(BigInt(Math.round(Number(v) * 100)), cc)
                      }
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis hide />
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Line
                      type="monotone"
                      dataKey="density"
                      stroke="hsl(0 0% 9%)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <ReferenceLine
                      x={globalModePx}
                      stroke="hsl(0 0% 9%)"
                      strokeWidth={2}
                      label={{
                        value: `Mode: ${formatMoney(data.global_mode_mu, cc)}`,
                        position: 'top',
                        fontSize: 11,
                      }}
                    />
                    <ReferenceLine
                      x={globalMeanPx}
                      stroke="hsl(0 0% 9%)"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      label={{
                        value: `Mean: ${formatMoney(data.global_mean_mu, cc)}`,
                        position: 'top',
                        fontSize: 11,
                      }}
                    />
                  </LineChart>
                </ChartContainer>
              </Section>
            ) : (
              <Section title="Density">
                <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
                  No distribution data for the selected range.
                </div>
              </Section>
            )}

            <Section title="Per-product distribution">
              <Table head={['Product', 'Orders', 'Mode', 'Mean', 'Diff (mode - mean)']}>
                {data.rows.map((r) => (
                  <tr key={r.product} className="border-t border-gray-100">
                    <td className="py-2 text-sm">{r.product}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{String(r.orders)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(r.mode_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(r.mean_mu, cc)}</td>
                    <td className={`py-2 text-sm tabular-nums text-right ${r.diff_mu < 0n ? 'text-red-600' : 'text-gray-900'}`}>{formatMoney(r.diff_mu, cc)}</td>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-gray-900">{value}</div>
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

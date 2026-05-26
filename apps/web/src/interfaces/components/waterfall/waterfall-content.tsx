'use client';

// @paradigm: sql
// WaterfallContent — the /waterfall page client component (Phase-2 slice-2).
// Renders the recharts waterfall chart (matching legacy pattern) + the Visx panel.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from the tRPC BFF.
// CF-C6-BIGINT-JSON-1: value_mu / cumulative_mu arrive as bigint via superjson.
// CF-C6-FORMATMONEY-CANONICAL-1: formatMoney is the only money formatter.

import { useQueryState, parseAsString } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { formatMoney } from '@brain/lib-metrics';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { StalenessLabel } from '@/interfaces/components/shared/staleness-label.js';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/interfaces/components/ui/chart.js';
import { BarChart, Bar, XAxis, YAxis, Cell, Tooltip } from 'recharts';

// Mirror of PnlWaterfallRow (proto-types shape).
interface WfStep {
  definition_id: string;
  label: string;
  value_mu: bigint;
  cumulative_mu: bigint;
  currency_code: string;
}

const CHART_CONFIG: ChartConfig = {
  revenue: { label: 'Revenue', color: 'hsl(142 76% 36%)' },
  cost: { label: 'Cost', color: 'hsl(0 84% 60%)' },
  subtotal: { label: 'Subtotal', color: 'hsl(221 83% 53%)' },
};

// Definition IDs that are CM/summary lines (coloured blue like legacy subtotals).
const SUMMARY_IDS = new Set(['cm1_mu', 'cm2_mu', 'cm3_mu', 'net_revenue_mu', 'realized_revenue_mu']);

function barFill(step: WfStep): string {
  if (SUMMARY_IDS.has(step.definition_id)) return 'hsl(221 83% 53%)';
  return step.value_mu >= 0n ? 'hsl(142 76% 36%)' : 'hsl(0 84% 60%)';
}

/** Build legacy-style waterfall: transparent "start" bar + visible "value" bar. */
function buildChartData(steps: WfStep[]) {
  // The steps already carry cumulative_mu. For legacy waterfall:
  //   start = cumulative_mu − value_mu  (= bottom of the bar)
  //   value = |value_mu|               (= bar height), sign-coloured
  // For summary bars: start = 0, value = cumulative_mu (full bar from 0).
  return steps.map((step) => {
    const isSummary = SUMMARY_IDS.has(step.definition_id);
    // Convert bigint to number for Recharts pixel math only — never rendered as money.
    const cumNum = Number(step.cumulative_mu);
    const valNum = Number(step.value_mu);
    if (isSummary) {
      return {
        label: step.label,
        definition_id: step.definition_id,
        start: 0,
        value: cumNum,
        displayValue: step.value_mu,
        currency_code: step.currency_code,
        step,
      };
    }
    const start = valNum >= 0 ? cumNum - valNum : cumNum;
    return {
      label: step.label,
      definition_id: step.definition_id,
      start,
      value: Math.abs(valNum),
      displayValue: step.value_mu,
      currency_code: step.currency_code,
      step,
    };
  });
}

function WaterfallTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ReturnType<typeof buildChartData>[0] }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="border-border bg-background grid min-w-[14rem] gap-1.5 rounded-lg border px-3 py-2 text-xs shadow-lg">
      <div className="font-medium">{p.label}</div>
      <div className="pt-1 font-mono tabular-nums">
        {formatMoney(p.displayValue, p.currency_code)}
      </div>
    </div>
  );
}

function WaterfallChart({ steps }: { steps: WfStep[] }) {
  const chartData = buildChartData(steps);
  const currency = steps[0]?.currency_code ?? 'INR';

  return (
    <div className="h-[400px] w-full">
      <ChartContainer config={CHART_CONFIG} className="h-full w-full">
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ left: 8, right: 40, top: 8, bottom: 8 }}
        >
          <XAxis
            type="number"
            tickFormatter={(v) =>
              formatMoney(BigInt(Math.round(v)), currency)
            }
            tick={{ fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={160}
            tick={{ fontSize: 11 }}
            tickLine={false}
          />
          <Tooltip
            content={<WaterfallTooltip />}
          />
          {/* Transparent spacer bar — positions the visible bar correctly */}
          <Bar dataKey="start" stackId="wf" fill="transparent" legendType="none" />
          {/* Visible value bar */}
          <Bar dataKey="value" stackId="wf" radius={[0, 4, 4, 0]} minPointSize={2}>
            {chartData.map((entry) => (
              <Cell
                key={entry.definition_id}
                fill={barFill(entry.step)}
                stroke={SUMMARY_IDS.has(entry.definition_id) ? 'hsl(221 83% 53%)' : undefined}
                strokeWidth={SUMMARY_IDS.has(entry.definition_id) ? 2 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

export function WaterfallContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const { data, isLoading, error } = trpc.metrics.pnlWaterfall.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled },
  );

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <p className="text-sm text-muted-foreground">Please sign in to view the waterfall.</p>
          <a
            href="/login"
            className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Contribution Margin Waterfall
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Step-down from realized revenue to CM2. Green = revenue/CM, red = cost, blue = subtotal.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="wf-date-start" className="sr-only">
            From date
          </label>
          <input
            id="wf-date-start"
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Start date for waterfall"
          />
          <span aria-hidden="true" className="text-muted-foreground text-sm">
            to
          </span>
          <label htmlFor="wf-date-end" className="sr-only">
            To date
          </label>
          <input
            id="wf-date-end"
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="End date for waterfall"
          />
        </div>
      </div>

      {isLoading && (
        <div
          aria-busy="true"
          aria-label="Loading waterfall chart"
          className="h-[400px] bg-gray-100 animate-pulse rounded-lg"
        />
      )}

      {error && (
        <ErrorDisplay
          title="Failed to load waterfall"
          message={error.message}
          requestId={(error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {data && (
        <section aria-label="CM Waterfall chart" className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Waterfall</h2>
            <StalenessLabel dataEpoch={data.data_epoch} />
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Hover any bar for the exact amount. Green = revenue or CM line, red = cost deduction, blue = subtotal.
          </p>
          <WaterfallChart steps={data.steps} />
        </section>
      )}

      {data && data.steps.length > 0 && (
        <section aria-label="Waterfall line items" className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Absolute values</h2>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left pb-2 font-medium text-gray-500">Line item</th>
                <th className="text-right pb-2 font-medium text-gray-500">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.steps.map((step) => (
                <tr key={step.definition_id} className="border-t border-gray-100">
                  <td className={`py-2 ${SUMMARY_IDS.has(step.definition_id) ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                    {step.label}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums font-mono ${
                      SUMMARY_IDS.has(step.definition_id)
                        ? 'font-semibold text-blue-700'
                        : step.value_mu >= 0n
                        ? 'text-green-700'
                        : 'text-red-600'
                    }`}
                  >
                    {formatMoney(step.value_mu, step.currency_code)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Net Revenue → COGS → CM1 → Ad Spend → CM2. CM1 nets out variable fulfilment costs; RTO
        is provisioned at CM2 (True CM2), never double-counted in CM1.
      </p>
    </div>
  );
}

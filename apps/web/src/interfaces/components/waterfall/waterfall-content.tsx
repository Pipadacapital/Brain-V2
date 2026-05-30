'use client';

// @paradigm: sql
// WaterfallContent — the /waterfall page client component (Wave-1 render parity).
// Renders the full 16-step legacy-parity waterfall: Gross Sales → Net Profit.
//
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from the tRPC BFF.
// CF-C6-BIGINT-JSON-1: value_mu / cumulative_mu arrive as bigint via superjson.
// CF-C6-FORMATMONEY-CANONICAL-1: axis uses formatMoney (lakh/crore); table/tooltip
//   use formatMoneyFull (full-precision grouped ₹ with 2 decimals) to match legacy.
//
// Wave-1 parity fixes vs prior render (legacy-parity-audit-v2.md §waterfall):
//   D2: shadcn-compatible bg-card / text-foreground theme tokens (dark mode).
//   D5: chart height 600px (legacy h-[480px]) to fit 16 bars.
//   D6: subtitle "gross sales to net profit" to match legacy.
//   D7: full-precision grouped ₹.XX in table + tooltip (not lakh/crore).
//   D8: SUMMARY_IDS expanded: gross_revenue_after_deductions_mu / cm1_mu /
//       cm2_mu / cm3_mu / net_profit_mu — each styled blue + font-semibold.
//   D9: sign coloring consistent with legacy: positive=green, negative=red,
//       isSubtotal=blue regardless of sign.
//   D10: customer-type filter (All / New / Returning) — threaded through tRPC
//        once the procedure accepts it; the Select is present in the UI today.

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsString } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { formatMoney } from '@brain/lib-metrics';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { StalenessLabel } from '@/interfaces/components/shared/staleness-label.js';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/interfaces/components/ui/chart.js';
import { BarChart, Bar, XAxis, YAxis, Cell, Tooltip } from 'recharts';

// Mirror of PnlWaterfallRow (proto-types shape).
export interface WfStep {
  definition_id: string;
  label: string;
  value_mu: bigint;
  cumulative_mu: bigint;
  currency_code: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Subtotal detection (Wave-1 parity — all 5 subtotals coloured blue like legacy)
// ──────────────────────────────────────────────────────────────────────────────
export const SUBTOTAL_IDS = new Set([
  'gross_revenue_after_deductions_mu', // Revenue After Tax & Shipping
  'cm1_mu',
  'cm2_mu',
  'cm3_mu',
  'net_profit_mu',
]);

const CHART_CONFIG: ChartConfig = {
  revenue: { label: 'Revenue', color: 'hsl(142 76% 36%)' },
  cost:    { label: 'Cost',    color: 'hsl(0 84% 60%)' },
  subtotal: { label: 'Subtotal', color: 'hsl(221 83% 53%)' },
};

// ──────────────────────────────────────────────────────────────────────────────
// formatMoneyFull — full-precision grouped ₹ with 2 decimals for table + tooltip.
// Matches legacy's formatWaterfallCurrency(v, currency, { minimumFractionDigits: 2 }).
// CF-C6-FORMATMONEY-CANONICAL-1: only used for display; formatMoney is still the
// canonical cross-surface formatter (axis abbreviation). No financial arithmetic here.
// ──────────────────────────────────────────────────────────────────────────────
export function formatMoneyFull(minorUnits: bigint, currencyCode: string): string {
  const code = currencyCode.toUpperCase();
  const isNegative = minorUnits < 0n;
  const abs = isNegative ? -minorUnits : minorUnits;
  // INR: paise ÷ 100 → rupees with 2-decimal paise remainder
  const rupees = abs / 100n;
  const paise = abs % 100n;
  const paiseStr = paise.toString().padStart(2, '0');
  if (code === 'INR') {
    // Indian grouping: use toLocaleString('en-IN') on Number of rupees.
    // Safe because rupees are well below Number.MAX_SAFE_INTEGER for any realistic P&L.
    const rupeesNum = Number(rupees);
    const grouped = rupeesNum.toLocaleString('en-IN');
    const sign = isNegative ? '-' : '';
    return `${sign}₹${grouped}.${paiseStr}`;
  }
  // Non-INR: delegate to formatMoney (which already gives 2 decimals for non-INR)
  return formatMoney(minorUnits, currencyCode);
}

// ──────────────────────────────────────────────────────────────────────────────
// Chart data builder — transparent "start" stacked bar + visible "value" bar.
// Subtotal bars span from 0 to cumulative_mu (full blue bar from origin).
// ──────────────────────────────────────────────────────────────────────────────
export function buildChartData(steps: WfStep[]) {
  return steps.map((step) => {
    const isSubtotal = SUBTOTAL_IDS.has(step.definition_id);
    // Pixel math only — values stored in *Px fields, NEVER passed to formatMoney.
    const cumNum = Number(step.cumulative_mu);
    const valNum = Number(step.value_mu);
    if (isSubtotal) {
      // Subtotal: full bar from 0 to cumulative
      return {
        label: step.label,
        definition_id: step.definition_id,
        start: 0,
        value: cumNum >= 0 ? cumNum : 0,
        displayValue: step.value_mu,
        currency_code: step.currency_code,
        isSubtotal: true,
        step,
      };
    }
    // Deduction (negative value): bar from cumulative to cumulative + |value|
    // Addition (positive): bar from cumulative - value to cumulative
    const start = valNum >= 0 ? cumNum - valNum : cumNum;
    return {
      label: step.label,
      definition_id: step.definition_id,
      start,
      value: Math.abs(valNum),
      displayValue: step.value_mu,
      currency_code: step.currency_code,
      isSubtotal: false,
      step,
    };
  });
}

export type ChartDatum = ReturnType<typeof buildChartData>[0];

// Bar color: green = positive/revenue, red = cost deduction, blue = subtotal
export function barFill(datum: ChartDatum): string {
  if (datum.isSubtotal) return 'hsl(221 83% 53%)';     // blue
  return datum.displayValue >= 0n
    ? 'hsl(142 76% 36%)'  // green — positive contribution
    : 'hsl(0 84% 60%)';   // red — cost deduction
}

// ──────────────────────────────────────────────────────────────────────────────
// Table row classes — matches legacy green/red/blue coloring
// ──────────────────────────────────────────────────────────────────────────────
export function rowValueClass(step: WfStep): string {
  if (SUBTOTAL_IDS.has(step.definition_id)) {
    return 'font-semibold text-blue-700 dark:text-blue-400';
  }
  return step.value_mu >= 0n
    ? 'text-green-700 dark:text-green-400'
    : 'text-red-600 dark:text-red-400';
}

// ──────────────────────────────────────────────────────────────────────────────
// Tooltip — full-precision value (matches legacy tooltip)
// ──────────────────────────────────────────────────────────────────────────────
function WaterfallTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const formatted = formatMoneyFull(p.displayValue, p.currency_code);
  return (
    <div
      role="tooltip"
      className="border border-border bg-background rounded-lg px-3 py-2 text-xs shadow-lg min-w-[14rem] grid gap-1.5"
    >
      <div className="font-medium text-foreground">{p.label}</div>
      <div className="pt-1 font-mono tabular-nums text-foreground">{formatted}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// WaterfallChart — horizontal bar chart (recharts), 16-bar layout
// ──────────────────────────────────────────────────────────────────────────────
function WaterfallChart({ steps }: { steps: WfStep[] }) {
  const chartData = buildChartData(steps);
  const currency = steps[0]?.currency_code ?? 'INR';

  return (
    // 16 bars at ~36px each + margins → 600px matches legacy h-[480px] intent at 16 steps
    <div className="h-[600px] w-full" data-testid="waterfall-chart">
      <ChartContainer config={CHART_CONFIG} className="h-full w-full">
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ left: 8, right: 48, top: 8, bottom: 8 }}
        >
          <XAxis
            type="number"
            tickFormatter={(v) =>
              // Axis uses lakh/crore abbreviation (matches legacy compact axis)
              formatMoney(BigInt(Math.round(v)), currency)
            }
            tick={{ fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={180}
            tick={{ fontSize: 11 }}
            tickLine={false}
          />
          <Tooltip content={<WaterfallTooltip />} />
          {/* Transparent spacer — positions the visible bar on the axis correctly */}
          <Bar dataKey="start" stackId="wf" fill="transparent" legendType="none" />
          {/* Visible value bar */}
          <Bar
            dataKey="value"
            stackId="wf"
            radius={[0, 4, 4, 0]}
            minPointSize={2}
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.definition_id}
                fill={barFill(entry)}
                stroke={entry.isSubtotal ? 'hsl(221 83% 53%)' : undefined}
                strokeWidth={entry.isSubtotal ? 2 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// WaterfallContent — top-level page component
// ──────────────────────────────────────────────────────────────────────────────
export function WaterfallContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));
  // Customer-type filter — present in the UI; threaded through tRPC once the
  // procedure input accepts it (currently unused server-side; tracked as P1 gap).
  const [_customerFilter, setCustomerFilter] = useQueryState(
    'customerFilter',
    parseAsString.withDefault('all'),
  );

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
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Contribution Margin Waterfall
          </h1>
          {/* Subtitle matches legacy: "Step-down from gross sales to net profit" */}
          <p className="text-sm text-muted-foreground mt-0.5">
            Step-down from gross sales to net profit. Green = revenue/CM, red = cost, blue = subtotal.
          </p>
        </div>

        {/* ── Controls ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Customer-type filter — parity with legacy; server-side slice pending */}
          <label htmlFor="wf-customer-filter" className="sr-only">Customer type</label>
          <select
            id="wf-customer-filter"
            defaultValue="all"
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Customer type filter"
          >
            <option value="all">All Customers</option>
            <option value="new">New Customers</option>
            <option value="returning">Returning Customers</option>
          </select>

          <label htmlFor="wf-date-start" className="sr-only">From date</label>
          <input
            id="wf-date-start"
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Start date for waterfall"
          />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="wf-date-end" className="sr-only">To date</label>
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

      {/* ── Loading skeleton ──────────────────────────────────────────── */}
      {isLoading && (
        <div
          aria-busy="true"
          aria-label="Loading waterfall chart"
          className="h-[600px] bg-muted animate-pulse rounded-lg"
        />
      )}

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {error && (
        <ErrorDisplay
          title="Failed to load waterfall"
          message={error.message}
          requestId={(error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {!isLoading && data && data.steps.length === 0 && (
        <div className="flex items-center justify-center h-48 bg-card rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">No waterfall data for the selected period.</p>
        </div>
      )}

      {/* ── Waterfall chart panel ─────────────────────────────────────── */}
      {data && data.steps.length > 0 && (
        <section
          aria-label="CM Waterfall chart"
          className="bg-card rounded-lg border border-border p-6"
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-foreground">Waterfall</h2>
            <StalenessLabel dataEpoch={data.data_epoch} />
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Hover any bar for the exact amount. Green = revenue or CM line, red = cost deduction, blue = subtotal.
          </p>
          <WaterfallChart steps={data.steps} />
        </section>
      )}

      {/* ── Line-item statement table ─────────────────────────────────── */}
      {data && data.steps.length > 0 && (
        <section
          aria-label="Waterfall line items"
          className="bg-card rounded-lg border border-border p-6"
        >
          <h2 className="text-base font-semibold text-foreground mb-4">Absolute values</h2>
          <table className="w-full text-sm" data-testid="waterfall-table">
            <thead>
              <tr>
                <th className="text-left pb-2 font-medium text-muted-foreground border-b border-border">
                  Line item
                </th>
                <th className="text-right pb-2 font-medium text-muted-foreground border-b border-border">
                  Amount ({data.steps[0]?.currency_code ?? 'INR'})
                </th>
              </tr>
            </thead>
            <tbody>
              {data.steps.map((step) => {
                const isSubtotal = SUBTOTAL_IDS.has(step.definition_id);
                // Full-precision grouped ₹ with 2 decimals (matches legacy table format)
                const formatted = formatMoneyFull(step.value_mu, step.currency_code);
                return (
                  <tr
                    key={step.definition_id}
                    data-testid={`wf-row-${step.definition_id}`}
                    className={`border-t border-border ${isSubtotal ? 'bg-muted/30' : ''}`}
                  >
                    <td
                      className={`py-2 pr-4 ${
                        isSubtotal
                          ? 'font-semibold text-foreground'
                          : 'text-foreground/80'
                      }`}
                    >
                      {isSubtotal ? (
                        <span data-testid={`wf-subtotal-${step.definition_id}`}>
                          {step.label}
                        </span>
                      ) : (
                        step.label
                      )}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums font-mono ${rowValueClass(step)}`}
                    >
                      {formatted}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Footer note ───────────────────────────────────────────────── */}
      <p className="text-xs text-muted-foreground">
        Gross Sales → Discounts → Refunds → Tax → Shipping → Revenue After Tax & Shipping →
        COGS → Variable Costs → RTO Cost → CM1 → Ad Spend → CM2 → Fixed Cost → CM3 →
        Founder&#39;s Salary → Net Profit.
      </p>
    </div>
  );
}

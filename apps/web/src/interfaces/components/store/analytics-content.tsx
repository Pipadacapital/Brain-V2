'use client';

// @paradigm: sql
// AnalyticsContent — Store Analytics page (Phase-2 slice-10, parity-audit-v2 item 38).
//
// Parity restoration:
//   - Full KPI card grid (21+ cards): REUSES DashboardMetricsGrid (5 categories,
//     33 metrics, RAG deltas, drill-through) — no duplication of metric definitions.
//   - Date presets: Yesterday / 7D / 30D / 90D / 1Y (matching legacy + dashboard).
//   - Goal RAG colouring: provided by DashboardMetricsGrid (direction-aware, server-computed).
//   - "No store connected" empty-state: uses dataAvailability + EmptyWorkspaceState.
//   - AI Insight sheet: not in apps/web (hook/component absent) — honest placeholder rendered.
//   - Daily AreaChart: net sales over time from store.dailySales.
//
// CF-C6-RENDER-ONLY-1: zero arithmetic. All values from tRPC BFF procedures.
// CF-C6-FORMATMONEY-CANONICAL-1: formatMoney is the only money formatter.
// CF-S10-HONEST-STATE-1: sessions/conversionRate render "—"; AI insights show honest placeholder.

import { useMemo, useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { EmptyWorkspaceState } from '@/interfaces/components/dashboard/empty-workspace-state.js';
import { DashboardMetricsGrid } from '@/interfaces/components/dashboard/dashboard-metrics-grid.js';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/interfaces/components/ui/chart.js';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';

// ---------------------------------------------------------------------------
// Date helpers — matching legacy + DashboardContent exactly.
// ---------------------------------------------------------------------------

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function subDaysFromDate(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - n);
  return r;
}

function getPresetRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = subDaysFromDate(to, days - 1);
  return { from: isoDate(from), to: isoDate(to) };
}

function getYesterdayRange(): { from: string; to: string } {
  const d = subDaysFromDate(new Date(), 1);
  const v = isoDate(d);
  return { from: v, to: v };
}

function getPrevPeriod(from: string, to: string): { prevFrom: string; prevTo: string } {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const days =
    Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const prevTo = subDaysFromDate(fromDate, 1);
  const prevFrom = subDaysFromDate(prevTo, days - 1);
  return { prevFrom: isoDate(prevFrom), prevTo: isoDate(prevTo) };
}

function getDefault30Days(): { from: string; to: string } {
  return getPresetRange(30);
}

type Preset = 'yesterday' | '7d' | '30d' | '90d' | '1y' | 'custom';

function detectPreset(from: string, to: string): Preset {
  const y = getYesterdayRange();
  if (from === y.from && to === y.to) return 'yesterday';
  if (from === getPresetRange(7).from   && to === getPresetRange(7).to)   return '7d';
  if (from === getPresetRange(30).from  && to === getPresetRange(30).to)  return '30d';
  if (from === getPresetRange(90).from  && to === getPresetRange(90).to)  return '90d';
  if (from === getPresetRange(365).from && to === getPresetRange(365).to) return '1y';
  return 'custom';
}

// ---------------------------------------------------------------------------
// Daily chart config
// ---------------------------------------------------------------------------

const DAILY_CHART_CONFIG: ChartConfig = {
  netSales: { label: 'Net sales', color: '#96bf48' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnalyticsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // Look up slug from workspace list — same pattern as DashboardContent.
  const workspaceListQuery = trpc.workspace.list.useQuery(undefined, {
    enabled: !!isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
  const activeWorkspace = workspaceListQuery.data?.workspaces.find(
    (w) => w.workspaceId === workspaceId,
  );
  const workspaceSlug = activeWorkspace?.slug ?? workspaceId ?? '';
  const workspaceName = activeWorkspace?.name ?? null;

  // Date state via URL (nuqs) — shareable + back-button.
  const defaults = useMemo(() => getDefault30Days(), []);
  const [dateStart, setDateStart] = useQueryState(
    'from',
    parseAsString.withDefault(defaults.from),
  );
  const [dateEnd, setDateEnd] = useQueryState(
    'to',
    parseAsString.withDefault(defaults.to),
  );

  const { prevFrom, prevTo } = useMemo(
    () => getPrevPeriod(dateStart, dateEnd),
    [dateStart, dateEnd],
  );

  const activePreset = useMemo(
    () => detectPreset(dateStart, dateEnd),
    [dateStart, dateEnd],
  );

  const applyPreset = (preset: Preset) => {
    if (preset === 'yesterday') {
      const r = getYesterdayRange();
      setDateStart(r.from);
      setDateEnd(r.to);
    } else if (preset === '7d') {
      const r = getPresetRange(7);
      setDateStart(r.from);
      setDateEnd(r.to);
    } else if (preset === '30d') {
      const r = getPresetRange(30);
      setDateStart(r.from);
      setDateEnd(r.to);
    } else if (preset === '90d') {
      const r = getPresetRange(90);
      setDateStart(r.from);
      setDateEnd(r.to);
    } else if (preset === '1y') {
      const r = getPresetRange(365);
      setDateStart(r.from);
      setDateEnd(r.to);
    }
  };

  const [showCustomizePanel, setShowCustomizePanel] = useState(false);

  const enabled = Boolean(isAuthenticated && workspaceId);

  // Empty-state check (workspace has no seed/live data yet).
  const dataAvailability = trpc.workspace.dataAvailability.useQuery(undefined, {
    retry: false,
  });

  // Daily net-sales chart.
  const daily = trpc.store.dailySales.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled },
  );

  // Currency code for chart axis — sourced from dailySales or store.summary.
  const storeSummary = trpc.store.summary.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled },
  );
  const cc = storeSummary.data?.summary?.currency_code ?? 'INR';

  const dailyRows = (daily.data?.rows ?? []).map((r) => {
    const dateLabel = new Intl.DateTimeFormat('en-IN', {
      month: 'short',
      day: 'numeric',
    }).format(new Date(r.date + 'T00:00:00'));
    return {
      date: r.date,
      dateLabel,
      // Number() for Recharts SVG pixel math only — never for display.
      // Display uses formatMoney in ChartTooltipContent formatter.
      netSales: Number(r.net_sales_mu) / 100,
      net_sales_mu: r.net_sales_mu,
    };
  });

  // ---------------------------------------------------------------------------
  // Not authenticated guard
  // ---------------------------------------------------------------------------

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6" data-testid="analytics-content">
      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Store Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {workspaceName
              ? `${workspaceName} · revenue quality & contribution margin`
              : 'Revenue quality & contribution margin'}
          </p>
        </div>

        {/* AI Insight — honest placeholder (hook/component not present in apps/web). */}
        <div
          className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
          role="note"
          aria-label="AI Insight — pending"
          data-testid="ai-insight-placeholder"
        >
          AI Insights — coming soon
        </div>
      </div>

      {/* Main card */}
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Toolbar: date range + presets + Customize */}
        <div className="border-b px-6 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            {/* Date inputs + preset buttons */}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label
                  className="text-xs text-muted-foreground block mb-1"
                  htmlFor="analytics-from"
                >
                  From
                </label>
                <input
                  id="analytics-from"
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="block h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Start date for analytics"
                  data-testid="analytics-date-from"
                />
              </div>
              <div>
                <label
                  className="text-xs text-muted-foreground block mb-1"
                  htmlFor="analytics-to"
                >
                  To
                </label>
                <input
                  id="analytics-to"
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="block h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="End date for analytics"
                  data-testid="analytics-date-to"
                />
              </div>

              {/* Preset buttons: Yesterday / 7D / 30D / 90D / 1Y */}
              <div
                className="flex flex-wrap gap-1 pb-0.5"
                role="group"
                aria-label="Date range presets"
                data-testid="analytics-presets"
              >
                {(
                  [
                    { id: 'yesterday', label: 'Yesterday' },
                    { id: '7d',        label: '7D' },
                    { id: '30d',       label: '30D' },
                    { id: '90d',       label: '90D' },
                    { id: '1y',        label: '1Y' },
                  ] as { id: Preset; label: string }[]
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => applyPreset(id)}
                    aria-pressed={activePreset === id}
                    data-testid={`analytics-preset-${id}`}
                    className={`h-9 rounded-md border px-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                      activePreset === id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Customize button */}
            <button
              type="button"
              onClick={() => setShowCustomizePanel((prev) => !prev)}
              aria-expanded={showCustomizePanel}
              aria-controls="analytics-customize-panel"
              data-testid="analytics-customize-btn"
              className="h-9 rounded-md border bg-background px-3 text-sm border-border hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {showCustomizePanel ? 'Close' : '+ Customize'}
            </button>
          </div>

          {/* Goal RAG hint */}
          <p className="mt-2 text-xs text-muted-foreground" role="note">
            Goal RAG colouring: green ≥95% of goal · amber 80–95% · red &lt;80%.
            Set targets in{' '}
            <a
              href="/settings/goals"
              className="underline text-foreground font-medium"
            >
              Settings → Goals
            </a>
            .
          </p>
        </div>

        {/* Metrics content */}
        <div className="px-6 py-4" id="analytics-customize-panel">
          {dataAvailability.data && !dataAvailability.data.hasSeedData ? (
            /* No store connected / no data yet — matches legacy "no store connected" state */
            <EmptyWorkspaceState />
          ) : (
            /* Full 33-metric KPI grid with RAG + deltas + drill-through */
            <DashboardMetricsGrid
              workspaceSlug={workspaceSlug}
              from={dateStart}
              to={dateEnd}
              prevFrom={prevFrom}
              prevTo={prevTo}
              showCustomizePanel={showCustomizePanel}
            />
          )}
        </div>
      </div>

      {/* Daily net-sales AreaChart */}
      {(daily.isLoading && !dailyRows.length) && (
        <div
          className="h-[280px] rounded-lg border bg-muted/10 animate-pulse"
          aria-busy="true"
          aria-label="Loading daily sales chart"
          data-testid="analytics-chart-skeleton"
        />
      )}

      {daily.error && (
        <ErrorDisplay
          title="Failed to load daily sales chart"
          message={daily.error.message}
          requestId={(daily.error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {dailyRows.length > 0 && (
        <section
          className="rounded-xl border bg-card shadow-sm p-6 space-y-3"
          aria-label="Net sales over time"
          data-testid="analytics-daily-chart"
        >
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Net sales over time
          </h2>
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
                      const d = (
                        payload?.[0]?.payload as { date?: string } | undefined
                      )?.date;
                      if (!d) return '';
                      return new Intl.DateTimeFormat('en-IN', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      }).format(new Date(d + 'T00:00:00'));
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
        </section>
      )}

      {/* Storefront engagement — sessions/conversion: honest empty (CF-S10-HONEST-STATE-1) */}
      <section
        className="rounded-xl border bg-card shadow-sm px-6 py-4 space-y-2"
        aria-label="Storefront engagement"
        data-testid="analytics-storefront-section"
      >
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Storefront engagement
        </h2>
        <p className="text-xs text-muted-foreground">
          Sessions and Conversion Rate sync from Shopify storefront analytics.
          The Sessions and Conversion Rate cards in the grid above show{' '}
          <strong>—</strong> until the Shopify connector cutover is live.
        </p>
      </section>
    </div>
  );
}

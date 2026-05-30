'use client';

// @paradigm: sql
// LtvContent — /lifetime-value page (parity-45: restore legacy design + LTV curve).
// Renders:
//   1. Summary cards (First Order R / First Order / M1 / M3 / M6 / M12 / New Customers)
//   2. Metric (cm2 | revenue | repeat_rate) + Mode (cumulative | post_acq | incremental)
//      + Dimension (10 options, all matching the tRPC enum) selectors + date range + search
//   3. Paginated per-dimension M1-M12 table with diverging heatmap cells
//   4. LTV curve Recharts LineChart (one line per dimension row, M1..M12 X-axis)
//
// CF-C6-RENDER-ONLY-1: zero arithmetic — all values from trpc.ltv.summary.
// CF-C6-FORMATMONEY-CANONICAL-1: formatMoney from @brain/lib-metrics; NEVER inline.
// CF-C6-BIGINT-JSON-1: m[] cells are bigint; Number() coercion only for chart pixel math.

import { useMemo } from 'react';
import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/interfaces/components/ui/card.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Skeleton } from '@/interfaces/components/ui/skeleton.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/interfaces/components/ui/select.js';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// ---------------------------------------------------------------------------
// Types — local aliases mirroring proto-types.ts (no backend import)
// ---------------------------------------------------------------------------

type LtvMetric = 'cm2' | 'revenue' | 'repeat_rate';
type LtvMode = 'cumulative' | 'post_acq' | 'incremental';
type LtvDimension =
  | 'product' | 'variant' | 'vendor' | 'collection' | 'product_type'
  | 'product_tags' | 'order_tags' | 'discount_codes' | 'discount_pct' | 'customer_id';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METRIC_OPTIONS: { value: LtvMetric; label: string }[] = [
  { value: 'cm2', label: 'CM2' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'repeat_rate', label: 'Repeat Rate' },
];

const MODE_OPTIONS: { value: LtvMode; label: string }[] = [
  { value: 'cumulative', label: 'Cumulative' },
  { value: 'post_acq', label: 'Post-Acq' },
  { value: 'incremental', label: 'Incremental' },
];

// All 10 dimensions matching the tRPC enum exactly.
// collection and discount_codes are supported by the tRPC procedure.
const DIMENSION_OPTIONS: { value: LtvDimension; label: string }[] = [
  { value: 'product', label: 'Product' },
  { value: 'variant', label: 'Variant' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'collection', label: 'Collection' },
  { value: 'product_type', label: 'Product Type' },
  { value: 'product_tags', label: 'Product Tags' },
  { value: 'order_tags', label: 'Order Tags' },
  { value: 'discount_codes', label: 'Discount Codes' },
  { value: 'discount_pct', label: 'Discount %' },
  { value: 'customer_id', label: 'Customer ID' },
];

const M_LABELS = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);

// Stable palette for the LTV curve (up to 10 dimension rows).
const LINE_COLORS = [
  '#96bf48', '#2563eb', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#84cc16', '#ec4899', '#f97316', '#14b8a6',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a cell value by metric.
 * - repeat_rate: stored as basis-points (×10000) → floor-divide to %; display as X%
 * - cm2 / revenue: bigint minor-units → formatMoney (canonical)
 * CF-C6-RENDER-ONLY-1 / CF-C6-FORMATMONEY-CANONICAL-1
 *
 * Exported for unit testing.
 */
export function formatLtvCell(value: bigint, metric: LtvMetric, currency: string): string {
  if (metric === 'repeat_rate') {
    // basis-points: 3000 bp = 30%. Floor division keeps it honest.
    return `${Number(value / 100n)}%`;
  }
  return formatMoney(value, currency);
}

/**
 * Diverging heatmap: positive → green rgba(34,197,94,…), negative → red rgba(239,68,68,…).
 * Mirrors legacy lifetime-value-content.tsx heatmapStyle exactly.
 */
function heatmapStyle(value: bigint, minV: bigint, maxV: bigint): React.CSSProperties {
  const num = Number(value);
  const mn = Number(minV);
  const mx = Number(maxV);
  const range = mx - mn || 1;
  const p = (num - mn) / range;
  if (num >= 0) {
    const intensity = Math.min(1, p * 1.2);
    return { backgroundColor: `rgba(34, 197, 94, ${0.15 + intensity * 0.35})` };
  }
  const intensity = Math.min(1, (1 - p) * 1.2);
  return { backgroundColor: `rgba(239, 68, 68, ${0.1 + intensity * 0.25})` };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  sub,
  'data-testid': testId,
}: {
  label: string;
  value: string;
  sub?: string;
  'data-testid'?: string;
}) {
  return (
    <Card className="py-4" data-testid={testId}>
      <CardHeader className="pb-1 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-0">
        <span className="text-xl font-semibold tabular-nums text-foreground">{value}</span>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// LtvContent — main component
// ---------------------------------------------------------------------------

export function LtvContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));
  const [metric, setMetric] = useQueryState('metric', parseAsString.withDefault('cm2'));
  const [mode, setMode] = useQueryState('mode', parseAsString.withDefault('cumulative'));
  const [dimension, setDimension] = useQueryState('dimension', parseAsString.withDefault('product'));
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));

  const PAGE_SIZE = 20;
  const enabled = Boolean(isAuthenticated && workspaceId);

  const q = trpc.ltv.summary.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      metric: metric as LtvMetric,
      mode: mode as LtvMode,
      dimension: dimension as LtvDimension,
      search: search || undefined,
      page,
      page_size: PAGE_SIZE,
    },
    { enabled },
  );

  // Heatmap scale — [min, max] across all m[] cells.
  const { minCell, maxCell } = useMemo(() => {
    if (!q.data?.result?.rows?.length) return { minCell: 0n, maxCell: 0n };
    let mn = 0n, mx = 0n;
    for (const row of q.data.result.rows) {
      for (const v of row.m) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    return { minCell: mn, maxCell: mx };
  }, [q.data]);

  // LTV curve data — one entry per month label, one key per dimension row.
  // Number() coercion is for Recharts pixel math only; tooltip re-uses formatLtvCell.
  const curveData = useMemo(() => {
    const rows = q.data?.result?.rows ?? [];
    if (!rows.length) return [];
    return M_LABELS.map((label, mIdx) => {
      const entry: Record<string, number | string> = { month: label };
      rows.forEach((row) => {
        const v = row.m[mIdx] ?? 0n;
        // Divide by 100 for INR axis scale (paise → rupees); safe for Recharts SVG math.
        entry[row.dimension_label] = Number(v) / 100;
      });
      return entry;
    });
  }, [q.data]);

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <a
            href="/login"
            className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  const r = q.data?.result;
  const cc = r?.currency_code ?? 'INR';
  const met = metric as LtvMetric;
  const rows = r?.rows ?? [];
  const totalRows = Number(r?.total_rows ?? 0n);
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const dimensionLabel =
    DIMENSION_OPTIONS.find((d) => d.value === dimension)?.label ?? dimension;

  return (
    <div className="space-y-6" data-testid="ltv-content">
      {/* ------------------------------------------------------------------ */}
      {/* Page heading */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Lifetime Value</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            LTV curve by dimension (CM2-first)
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Filters */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="LTV filters">
        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="ltv-from" className="text-sm text-muted-foreground">From</label>
          <input
            id="ltv-from"
            type="date"
            value={dateStart}
            onChange={(e) => { setDateStart(e.target.value); setPage(1); }}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            aria-label="From date"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor="ltv-to" className="text-sm text-muted-foreground">To</label>
          <input
            id="ltv-to"
            type="date"
            value={dateEnd}
            onChange={(e) => { setDateEnd(e.target.value); setPage(1); }}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            aria-label="To date"
          />
        </div>

        {/* Metric selector */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="ltv-metric" className="text-sm text-muted-foreground">Metric</label>
          <Select
            value={metric}
            onValueChange={(v) => { setMetric(v); setPage(1); }}
          >
            <SelectTrigger id="ltv-metric" size="sm" className="w-[130px]" aria-label="Metric">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRIC_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="ltv-mode" className="text-sm text-muted-foreground">Mode</label>
          <Select
            value={mode}
            onValueChange={(v) => { setMode(v); setPage(1); }}
          >
            <SelectTrigger id="ltv-mode" size="sm" className="w-[140px]" aria-label="Mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Dimension selector */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="ltv-dimension" className="text-sm text-muted-foreground">Dimension</label>
          <Select
            value={dimension}
            onValueChange={(v) => { setDimension(v); setPage(1); }}
          >
            <SelectTrigger id="ltv-dimension" size="sm" className="w-[160px]" aria-label="Dimension">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIMENSION_OPTIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Search */}
      <div>
        <Input
          type="search"
          placeholder={`Search ${dimensionLabel.toLowerCase()}…`}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          aria-label="Search dimension"
          className="w-full sm:w-72"
          data-testid="ltv-search"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Loading */}
      {/* ------------------------------------------------------------------ */}
      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading lifetime value" className="space-y-2">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" aria-hidden="true" />
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Error */}
      {/* ------------------------------------------------------------------ */}
      {q.error && (
        <ErrorDisplay
          title="Failed to load lifetime value"
          message={q.error.message}
          requestId={(q.error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Data */}
      {/* ------------------------------------------------------------------ */}
      {r && !q.isLoading && (
        <>
          {/* Trace metadata (sr-only) */}
          <div className="sr-only" aria-live="polite">
            Data as of {new Date(r.data_epoch).toISOString()}. Request ID: {q.data?.request_id}
          </div>

          {/* Summary cards */}
          <div
            className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4"
            data-testid="ltv-summary-cards"
          >
            <SummaryCard
              label="First Order (R)"
              value={formatLtvCell(r.first_order_realized_mu, met, cc)}
              sub="Realized, weighted"
              data-testid="ltv-card-first-order-r"
            />
            <SummaryCard
              label="First Order"
              value={formatLtvCell(r.first_order_mu, met, cc)}
              data-testid="ltv-card-first-order"
            />
            <SummaryCard
              label="1 Month"
              value={formatLtvCell(r.month1_mu, met, cc)}
              data-testid="ltv-card-m1"
            />
            <SummaryCard
              label="3 Months"
              value={formatLtvCell(r.month3_mu, met, cc)}
              data-testid="ltv-card-m3"
            />
            <SummaryCard
              label="6 Months"
              value={formatLtvCell(r.month6_mu, met, cc)}
              data-testid="ltv-card-m6"
            />
            <SummaryCard
              label="12 Months"
              value={formatLtvCell(r.month12_mu, met, cc)}
              data-testid="ltv-card-m12"
            />
            <SummaryCard
              label="New Customers"
              value={String(r.new_customers)}
              data-testid="ltv-card-new-customers"
            />
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="ltv-empty">
              No data for the selected filters.
            </p>
          ) : (
            <>
              {/* LTV Curve — Recharts LineChart, one line per dimension row */}
              <Card data-testid="ltv-curve-card">
                <CardHeader className="px-6 pt-4 pb-2">
                  <CardTitle className="text-base font-semibold text-foreground">
                    LTV Curve — {METRIC_OPTIONS.find((m) => m.value === met)?.label} (
                    {MODE_OPTIONS.find((m) => m.value === mode)?.label})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div
                    className="h-[280px] w-full"
                    role="img"
                    aria-label={`LTV curve by ${dimensionLabel}`}
                    data-testid="ltv-curve"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={curveData}
                        margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="month"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v: number) =>
                            met === 'repeat_rate'
                              ? `${Math.round(v)}%`
                              : formatMoney(BigInt(Math.round(v * 100)), cc)
                          }
                          width={72}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => {
                            const display =
                              met === 'repeat_rate'
                                ? `${Math.round(value)}%`
                                : formatMoney(BigInt(Math.round(value * 100)), cc);
                            return [display, name];
                          }}
                        />
                        {rows.length > 1 && <Legend />}
                        {rows.map((row, idx) => (
                          <Line
                            key={row.dimension_value}
                            type="monotone"
                            dataKey={row.dimension_label}
                            stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Per-dimension M1-M12 table with heatmap */}
              <Card data-testid="ltv-table-card">
                <CardHeader className="px-6 pt-4 pb-2">
                  <CardTitle className="text-base font-semibold text-foreground">
                    LTV by {dimensionLabel}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <div className="overflow-x-auto">
                    <table
                      className="w-full text-xs border-collapse"
                      aria-label={`LTV table by ${dimensionLabel} — ${METRIC_OPTIONS.find((m) => m.value === met)?.label}`}
                    >
                      <thead>
                        <tr className="bg-muted/50">
                          <th
                            scope="col"
                            className="sticky left-0 z-10 bg-muted/50 px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                          >
                            {dimensionLabel}
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">
                            Orders
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">
                            New
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">
                            First (R)
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">
                            First
                          </th>
                          {M_LABELS.map((m) => (
                            <th
                              key={m}
                              scope="col"
                              className="px-2 py-2 text-center font-medium text-muted-foreground min-w-[56px]"
                            >
                              {m}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={row.dimension_value}
                            className="border-t border-border hover:bg-muted/20 transition-colors"
                            data-testid={`ltv-row-${row.dimension_value}`}
                          >
                            <td
                              className="sticky left-0 bg-background px-4 py-2 font-medium text-foreground whitespace-nowrap max-w-[200px] truncate"
                              title={row.dimension_label}
                            >
                              {row.dimension_label}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-foreground">
                              {String(row.orders_count)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-foreground">
                              {String(row.new_customers)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-foreground">
                              {formatLtvCell(row.first_order_realized_mu, met, cc)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-foreground">
                              {formatLtvCell(row.first_order_mu, met, cc)}
                            </td>
                            {row.m.map((v, i) => (
                              <td
                                key={i}
                                className="px-2 py-2 text-center tabular-nums text-foreground"
                                style={heatmapStyle(v, minCell, maxCell)}
                                data-testid={`ltv-cell-${row.dimension_value}-m${i + 1}`}
                              >
                                {formatLtvCell(v, met, cc)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div
                    className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-3"
                    data-testid="ltv-pagination"
                  >
                    <p className="text-sm text-muted-foreground">
                      {totalRows} row{totalRows !== 1 ? 's' : ''}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        disabled={page <= 1}
                        onClick={() => setPage(1)}
                        aria-label="First page"
                        data-testid="ltv-page-first"
                      >
                        «
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        disabled={page <= 1}
                        onClick={() => setPage(Math.max(1, page - 1))}
                        aria-label="Previous page"
                        data-testid="ltv-page-prev"
                      >
                        ‹
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage(Math.min(totalPages, page + 1))}
                        aria-label="Next page"
                        data-testid="ltv-page-next"
                      >
                        ›
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage(totalPages)}
                        aria-label="Last page"
                        data-testid="ltv-page-last"
                      >
                        »
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

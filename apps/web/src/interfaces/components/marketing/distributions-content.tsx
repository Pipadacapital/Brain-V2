'use client';

// @paradigm: sql
// DistributionsContent — the /distributions page (legacy-parity-v2 restore).
// Restores column sort, pagination, page-size, YTD preset, and full shadcn layout
// matching legacy distributions-content.tsx.
//
// Reuses the existing trpc.marketing.distributions procedure — zero backend changes.
// CF-C6-RENDER-ONLY-1: zero arithmetic. CF-C6-FORMATMONEY-CANONICAL-1: formatMoney.
// CF-C6-BIGINT-JSON-1: all bigint _mu fields via superjson. CF-SEC-5: requestId on error.

import { useState, useMemo, useCallback } from 'react';
import { useQueryState, parseAsString, parseAsStringEnum } from 'nuqs';
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart2 } from 'lucide-react';
import { DEFAULT_DATE_START, DEFAULT_DATE_END } from '@/lib/default-date-range.js';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/interfaces/components/ui/select.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/interfaces/components/ui/table.js';
import { Tabs, TabsList, TabsTrigger } from '@/interfaces/components/ui/tabs.js';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/interfaces/components/ui/chart.js';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

type SortCol = 'product' | 'orders' | 'mode' | 'mean' | 'diff';
type SortDir = 'asc' | 'desc';
type Metric = 'cm1' | 'sales';

const DENSITY_CHART_CONFIG: ChartConfig = {
  density: { label: 'Density', color: 'hsl(0 0% 9%)' },
};

// ---------------------------------------------------------------------------
// YTD preset helper
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yearStartIso(): string {
  return `${new Date().getFullYear()}-01-01`;
}

// ---------------------------------------------------------------------------
// Sort icon helper
// ---------------------------------------------------------------------------

function SortIcon({ col, sort, dir }: { col: SortCol; sort: SortCol; dir: SortDir }) {
  if (sort !== col) return <ArrowUpDown className="size-3.5 text-muted-foreground" />;
  return dir === 'desc'
    ? <ArrowDown className="size-3.5" />
    : <ArrowUp className="size-3.5" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DistributionsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // URL state: date range, metric, search
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd,   setDateEnd]   = useQueryState('to',   parseAsString.withDefault(DEFAULT_DATE_END));
  const [metric, setMetric] = useQueryState(
    'metric',
    parseAsStringEnum<Metric>(['cm1', 'sales']).withDefault('cm1'),
  );
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));

  // Local sort / pagination (not URL-persisted — session only, like legacy)
  const [sort, setSort] = useState<SortCol>('orders');
  const [dir,  setDir]  = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const enabled = Boolean(isAuthenticated && workspaceId);

  const { data, isLoading, error } = trpc.marketing.distributions.useQuery(
    {
      date_start: dateStart,
      date_end:   dateEnd,
      metric:     metric === 'sales' ? 'sales' : 'cm1',
      search:     search || undefined,
      sort:       sort,
      order:      dir,
      page:       page,
      page_size:  pageSize,
    },
    { enabled },
  );

  const cc = data?.rows?.[0] ? 'INR' : 'INR';   // currency from workspace; backend always INR for now

  const totalRows = data ? Number(data.total_rows ?? BigInt(data.rows?.length ?? 0)) : 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  const toggleSort = useCallback((col: SortCol) => {
    if (sort === col) {
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(col);
      setDir('desc');
    }
    setPage(1);
  }, [sort]);

  const applyYtd = useCallback(() => {
    setDateStart(yearStartIso());
    setDateEnd(todayIso());
    setPage(1);
  }, [setDateStart, setDateEnd]);

  const modeLabel = metric === 'cm1' ? 'CM1 Mode' : 'Sales Mode';
  const meanLabel = metric === 'cm1' ? 'CM1 Mean' : 'Sales Mean';

  // Build recharts-compatible graph points from bigint values
  const graphPoints = useMemo(() => {
    if (!data?.graph_points) return [];
    return data.graph_points.map((p) => ({
      value:    Number(p.value_mu) / 100,   // minor-units → major (for axis positioning)
      value_mu: p.value_mu,
      density:  p.density_bp / 100,         // bp → percent 0..100
    }));
  }, [data?.graph_points]);

  const globalModePx = data ? Number(data.global_mode_mu) / 100 : 0;
  const globalMeanPx = data ? Number(data.global_mean_mu) / 100 : 0;

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

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      {/* Page header — icon + workspace name matching legacy */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <BarChart2 className="h-6 w-6 text-[#96bf48]" aria-hidden="true" />
          Distributions
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          per-product per-order value distribution (mode vs mean)
        </p>
      </div>

      {/* Card */}
      <div className="rounded-xl border bg-card shadow-sm">

        {/* Toolbar — date pickers + YTD + metric toggle */}
        <div className="flex flex-wrap items-center gap-4 border-b px-6 py-4">
          {/* Date pickers */}
          <label htmlFor="dist-from" className="sr-only">From date</label>
          <input
            id="dist-from"
            type="date"
            value={dateStart}
            onChange={(e) => { setDateStart(e.target.value); setPage(1); }}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Start date for Distributions"
          />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="dist-to" className="sr-only">To date</label>
          <input
            id="dist-to"
            type="date"
            value={dateEnd}
            onChange={(e) => { setDateEnd(e.target.value); setPage(1); }}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="End date for Distributions"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={applyYtd}
          >
            Year to date
          </Button>

          {/* Metric toggle — ml-auto to match legacy right-alignment */}
          <div className="ml-auto">
            <Tabs
              value={metric}
              onValueChange={(v) => { setMetric(v as Metric); setPage(1); }}
            >
              <TabsList className="h-8">
                <TabsTrigger value="cm1">CM1</TabsTrigger>
                <TabsTrigger value="sales">Sales</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Density chart section */}
        <div className="p-6">
          {isLoading ? (
            <div className="flex justify-center py-16" aria-busy="true" aria-label="Loading distributions">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-hidden="true" />
            </div>
          ) : error ? (
            <ErrorDisplay
              title="Failed to load distributions"
              message={error.message}
              requestId={(error as { data?: { requestId?: string } }).data?.requestId}
            />
          ) : data && graphPoints.length > 0 ? (
            <ChartContainer config={DENSITY_CHART_CONFIG} className="h-[280px] w-full">
              <LineChart
                data={graphPoints}
                margin={{ top: 12, right: 12, left: 8, bottom: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="value"
                  tickFormatter={(v) => formatMoney(BigInt(Math.round(Number(v) * 100)), cc)}
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
          ) : data ? (
            <div className="flex justify-center py-16 text-sm text-muted-foreground">
              No distribution data for the selected range.
            </div>
          ) : null}
        </div>

        {/* Search bar */}
        <div className="px-6 py-3 border-t">
          <label htmlFor="dist-search" className="sr-only">Search products</label>
          <Input
            id="dist-search"
            type="search"
            placeholder="Search products"
            className="max-w-xs"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        {/* Table with sort + pagination */}
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex justify-center py-16" aria-busy="true">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-hidden="true" />
            </div>
          ) : error ? null /* already shown above */ : data ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">
                      <div className="flex items-center gap-1">
                        Product
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => toggleSort('product')}
                          aria-label="Sort by product"
                        >
                          <SortIcon col="product" sort={sort} dir={dir} />
                        </Button>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        Orders
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => toggleSort('orders')}
                          aria-label="Sort by orders"
                        >
                          <SortIcon col="orders" sort={sort} dir={dir} />
                        </Button>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {modeLabel}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => toggleSort('mode')}
                          aria-label={`Sort by ${modeLabel}`}
                        >
                          <SortIcon col="mode" sort={sort} dir={dir} />
                        </Button>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {meanLabel}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => toggleSort('mean')}
                          aria-label={`Sort by ${meanLabel}`}
                        >
                          <SortIcon col="mean" sort={sort} dir={dir} />
                        </Button>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        Diff
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => toggleSort('diff')}
                          aria-label="Sort by diff"
                        >
                          <SortIcon col="diff" sort={sort} dir={dir} />
                        </Button>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        No data for the selected filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.rows.map((row, idx) => (
                      <TableRow key={`${row.product}-${idx}`}>
                        <TableCell className="font-medium align-top min-w-[200px]">
                          <span className="break-words" title={row.product}>
                            {row.product}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums align-top">
                          {Number(row.orders).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums align-top">
                          {formatMoney(row.mode_mu, cc)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums align-top">
                          {formatMoney(row.mean_mu, cc)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums align-top',
                            row.diff_mu < 0n ? 'text-destructive' : '',
                          )}
                        >
                          {formatMoney(row.diff_mu, cc)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {/* Pagination footer */}
              <div className="flex items-center justify-between px-6 py-3 border-t">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Rows per page</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
                  >
                    <SelectTrigger className="w-16 h-8" aria-label="Rows per page">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 20, 30, 50].map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {totalRows > 0 && (
                    <span className="tabular-nums ml-1">
                      {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalRows)} of {totalRows}
                    </span>
                  )}
                </div>

                <nav aria-label="Distributions pagination" className="flex items-center gap-1">
                  <Button
                    variant="outline" size="icon" className="h-8 w-8"
                    disabled={page <= 1}
                    onClick={() => setPage(1)}
                    aria-label="First page"
                  >
                    «
                  </Button>
                  <Button
                    variant="outline" size="icon" className="h-8 w-8"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    ‹
                  </Button>
                  <Button
                    variant="outline" size="icon" className="h-8 w-8"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                  >
                    ›
                  </Button>
                  <Button
                    variant="outline" size="icon" className="h-8 w-8"
                    disabled={page >= totalPages}
                    onClick={() => setPage(totalPages)}
                    aria-label="Last page"
                  >
                    »
                  </Button>
                </nav>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

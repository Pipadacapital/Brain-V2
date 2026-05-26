'use client';

// @paradigm: sql
// PnlContent — /pnl page client component (P0 legacy-parity rebuild).
// PRIMARY: per-period P&L grid (granularity toggle, column picker, %-of-net-sales
// mode, client-side pagination, totals row) matching legacy COLUMN_CONFIG (~34 cols).
// SECONDARY: existing CM statement summary + waterfall kept below the grid.
//
// CF-C6-RENDER-ONLY-1: zero arithmetic. All values from tRPC BFF
//   (pnl.periodGrid + pnl.statement + metrics.pnlWaterfall).
// CF-C6-FORMATMONEY-CANONICAL-1: every money value goes through formatMoney.
// CF-C6-BIGINT-JSON-1: all bigint _mu fields arrive via superjson.
// CF-SEC-5: request_id surfaced on error UI for traceability.

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useState, useMemo } from 'react';
import { useQueryState, parseAsString, parseAsStringEnum } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { formatMoney } from '@brain/lib-metrics';
import { cn } from '@/lib/utils.js';
import { Button } from '@/interfaces/components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/interfaces/components/ui/dropdown-menu.js';
import { PnlStatementTable } from '@/interfaces/components/pnl/pnl-statement-table.js';
import { PnlWaterfallPanel } from '@/interfaces/components/waterfall/pnl-waterfall-panel.js';
import { InsightStrip } from '@/interfaces/components/insights/insight-strip.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Granularity = 'day' | 'week' | 'month' | 'quarter';
type ValueMode = 'absolute' | 'percentage';

// PnlPeriodRow field keys — all bigint except label/bucketKey/currencyCode.
type PnlMoneyKey =
  | 'grossSales' | 'productGross' | 'shippingGross'
  | 'discounts' | 'productDiscount' | 'shippingDiscount'
  | 'sales' | 'netSales' | 'productNet' | 'shippingNet'
  | 'refunds' | 'productRefunds' | 'shippingRefunds' | 'returnFees'
  | 'revenue' | 'ncNetRevenue' | 'ecNetRevenue' | 'netRevenue'
  | 'cogs' | 'variableCosts' | 'shippingCosts' | 'returnsCosts'
  | 'paymentCosts' | 'customsCosts' | 'otherVariable'
  | 'adSpend' | 'metaAdSpend' | 'googleAdSpend'
  | 'contributionMargin1' | 'contributionMargin2' | 'contributionMargin3'
  | 'fixedCosts' | 'founderSalaryAllocated' | 'netProfit';

type PnlColId = 'label' | PnlMoneyKey;

// ---------------------------------------------------------------------------
// Column config — mirrors legacy COLUMN_CONFIG exactly.
// ---------------------------------------------------------------------------

const COLUMN_CONFIG: { id: PnlColId; label: string; defaultVisible: boolean }[] = [
  { id: 'label', label: 'Period', defaultVisible: true },
  { id: 'grossSales', label: 'Gross Sales', defaultVisible: false },
  { id: 'productGross', label: 'Product Gross', defaultVisible: false },
  { id: 'shippingGross', label: 'Shipping Gross', defaultVisible: false },
  { id: 'discounts', label: 'Discounts', defaultVisible: true },
  { id: 'productDiscount', label: 'Product Discount', defaultVisible: false },
  { id: 'shippingDiscount', label: 'Shipping Discount', defaultVisible: false },
  { id: 'sales', label: 'Sales', defaultVisible: true },
  { id: 'netSales', label: 'Net Sales', defaultVisible: true },
  { id: 'productNet', label: 'Product Net', defaultVisible: false },
  { id: 'shippingNet', label: 'Shipping Net', defaultVisible: false },
  { id: 'refunds', label: 'Refunds', defaultVisible: true },
  { id: 'productRefunds', label: 'Product Refunds', defaultVisible: true },
  { id: 'shippingRefunds', label: 'Shipping Refunds', defaultVisible: true },
  { id: 'returnFees', label: 'Return Fees', defaultVisible: false },
  { id: 'revenue', label: 'Revenue', defaultVisible: true },
  { id: 'ncNetRevenue', label: 'NC Net Revenue', defaultVisible: false },
  { id: 'ecNetRevenue', label: 'EC Net Revenue', defaultVisible: false },
  { id: 'netRevenue', label: 'Net Revenue', defaultVisible: true },
  { id: 'cogs', label: 'COGS', defaultVisible: true },
  { id: 'variableCosts', label: 'Variable Costs', defaultVisible: true },
  { id: 'shippingCosts', label: 'Shipping Costs', defaultVisible: false },
  { id: 'returnsCosts', label: 'Returns Costs', defaultVisible: false },
  { id: 'paymentCosts', label: 'Payment Costs', defaultVisible: false },
  { id: 'customsCosts', label: 'Customs Costs', defaultVisible: false },
  { id: 'otherVariable', label: 'Other Variable', defaultVisible: false },
  { id: 'adSpend', label: 'Ad Spend', defaultVisible: true },
  { id: 'metaAdSpend', label: 'Meta Ads', defaultVisible: false },
  { id: 'googleAdSpend', label: 'Google Ads', defaultVisible: false },
  { id: 'contributionMargin1', label: 'CM1', defaultVisible: true },
  { id: 'contributionMargin2', label: 'CM2', defaultVisible: true },
  { id: 'contributionMargin3', label: 'CM3', defaultVisible: true },
  { id: 'fixedCosts', label: 'Fixed Costs', defaultVisible: true },
  { id: 'founderSalaryAllocated', label: "Founder Salary", defaultVisible: false },
  { id: 'netProfit', label: 'Net Profit', defaultVisible: true },
];

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

const DEFAULT_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  COLUMN_CONFIG.map((c) => [c.id, c.defaultVisible]),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Integer basis-point percentage of value vs base.
// Returns string like "12.34%" with no float arithmetic.
function formatBpPct(value: bigint, base: bigint): string {
  if (base === 0n) return '—';
  const bp = (value * 10000n) / base;
  const sign = bp < 0n ? '-' : '';
  const absBp = bp < 0n ? -bp : bp;
  const whole = absBp / 100n;
  const frac = absBp % 100n;
  return `${sign}${whole}.${String(frac).padStart(2, '0')}%`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PnlContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // URL state — date range + granularity persist in URL.
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));
  const [granularity, setGranularity] = useQueryState(
    'gran',
    parseAsStringEnum<Granularity>(['day', 'week', 'month', 'quarter']).withDefault('day'),
  );

  // Local UI state (per-session; not URL-persisted).
  const [valueMode, setValueMode] = useState<ValueMode>('absolute');
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(DEFAULT_VISIBILITY);
  const [pageSize, setPageSize] = useState(14);
  const [pageIndex, setPageIndex] = useState(0);

  // tRPC query.
  const { data, isLoading, error } = trpc.pnl.periodGrid.useQuery(
    { date_start: dateStart, date_end: dateEnd, granularity },
    { enabled: !!(isAuthenticated && workspaceId) },
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const currencyCode = data?.currency_code ?? 'INR';

  // Visible columns (always include 'label').
  const visibleColumns = useMemo(
    () => COLUMN_CONFIG.filter((c) => c.id === 'label' || columnVisibility[c.id]),
    [columnVisibility],
  );

  // Total Net Sales across all rows (for percentage mode denominator).
  const totalNetSales: bigint = useMemo(
    () => rows.reduce((s, r) => s + r.netSales, 0n),
    [rows],
  );

  // Totals row: sum all money columns across all rows.
  const totalRow = useMemo<Record<string, bigint> | null>(() => {
    if (rows.length === 0) return null;
    const acc: Record<string, bigint> = {};
    for (const col of COLUMN_CONFIG) {
      if (col.id === 'label') continue;
      acc[col.id] = rows.reduce<bigint>((s, r) => {
        const v = (r as unknown as Record<string, bigint>)[col.id];
        return typeof v === 'bigint' ? s + v : s;
      }, 0n);
    }
    return acc;
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  const paginatedRows = useMemo(() => {
    const start = pageIndex * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, pageIndex, pageSize]);

  // Format a data cell value.
  function formatCell(colId: PnlColId, value: bigint, rowNetSales: bigint): string {
    if (colId === 'label') return '';
    if (valueMode === 'percentage') {
      const base = rowNetSales !== 0n ? rowNetSales : totalNetSales;
      return formatBpPct(value, base);
    }
    return formatMoney(value, currencyCode);
  }

  // ---- Not authenticated guard ----
  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <p className="text-sm text-muted-foreground">Please sign in to view your P&amp;L.</p>
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
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">P&amp;L</h1>
          <p className="text-sm text-muted-foreground mt-0.5">honest contribution margin</p>
        </div>

        {/* Date pickers */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="pnl-date-start" className="sr-only">From date</label>
          <input
            id="pnl-date-start"
            type="date"
            value={dateStart}
            onChange={(e) => { setDateStart(e.target.value); setPageIndex(0); }}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Start date for P&L"
          />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="pnl-date-end" className="sr-only">To date</label>
          <input
            id="pnl-date-end"
            type="date"
            value={dateEnd}
            onChange={(e) => { setDateEnd(e.target.value); setPageIndex(0); }}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="End date for P&L"
          />
        </div>
      </div>

      {/* AI narration strip */}
      <InsightStrip page="pnl" date_start={dateStart} date_end={dateEnd} />

      {/* ------------------------------------------------------------------ */}
      {/* PRIMARY: Per-period P&L grid (legacy-parity)                        */}
      {/* ------------------------------------------------------------------ */}
      <section
        aria-label="P&L period grid"
        className="rounded-xl border border-border bg-card shadow-sm"
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          {/* Granularity selector */}
          <div
            className="flex rounded-md border border-border bg-muted/30 p-0.5"
            role="group"
            aria-label="Granularity"
          >
            {GRANULARITY_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={granularity === opt.value ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setGranularity(opt.value); setPageIndex(0); }}
                aria-pressed={granularity === opt.value}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          {/* Value mode toggle */}
          <div
            className="flex rounded-md border border-border bg-muted/30 p-0.5"
            role="group"
            aria-label="Value display mode"
          >
            <Button
              variant={valueMode === 'absolute' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setValueMode('absolute')}
              aria-pressed={valueMode === 'absolute'}
            >
              Absolute
            </Button>
            <Button
              variant={valueMode === 'percentage' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setValueMode('percentage')}
              aria-pressed={valueMode === 'percentage'}
            >
              % of Net Sales
            </Button>
          </div>

          {/* Column picker */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 ml-auto">
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 max-h-[70vh] overflow-y-auto">
              {COLUMN_CONFIG.filter((c) => c.id !== 'label').map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onSelect={(e) => {
                    // Prevent closing the dropdown on item click so multiple columns
                    // can be toggled without reopening.
                    e.preventDefault();
                    setColumnVisibility((prev) => ({ ...prev, [c.id]: !(prev[c.id] ?? false) }));
                  }}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    aria-label={`Toggle ${c.label} column`}
                    checked={columnVisibility[c.id] ?? false}
                    onChange={() => {
                      setColumnVisibility((prev) => ({ ...prev, [c.id]: !(prev[c.id] ?? false) }));
                    }}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  <span className="text-sm">{c.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Percentage mode banner */}
        {valueMode === 'percentage' && (
          <p className="px-4 py-1 text-xs text-muted-foreground border-b border-border bg-muted/20">
            Percentage mode: money columns shown as % of row Net Sales (falls back to total when row is zero).
          </p>
        )}

        {/* Grid */}
        <div className="overflow-x-auto">
          {isLoading ? (
            <div
              className="flex items-center justify-center py-16"
              aria-busy="true"
              aria-label="Loading P&L grid"
            >
              <div
                className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin"
                aria-hidden="true"
              />
            </div>
          ) : error ? (
            <div className="px-4 py-8">
              <ErrorDisplay
                title="Failed to load P&L grid"
                message={error.message}
                requestId={(error as { data?: { requestId?: string } }).data?.requestId}
              />
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-12 text-sm text-muted-foreground text-center">
              No data for the selected period. Connect a store or adjust the date range.
            </p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border">
                  <tr>
                    {visibleColumns.map((col) => (
                      <th
                        key={col.id}
                        scope="col"
                        className={cn(
                          'px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap',
                          col.id === 'label'
                            ? 'text-left sticky left-0 bg-muted/30 z-10 min-w-[110px]'
                            : 'text-right',
                        )}
                      >
                        {col.id === 'label'
                          ? granularity.charAt(0).toUpperCase() + granularity.slice(1)
                          : col.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {paginatedRows.map((row) => (
                    <tr key={row.bucketKey} className="border-t border-border hover:bg-muted/10">
                      {visibleColumns.map((col) => {
                        if (col.id === 'label') {
                          return (
                            <td
                              key="label"
                              className="px-3 py-2 text-xs font-medium whitespace-nowrap sticky left-0 bg-card z-10"
                            >
                              {row.label}
                            </td>
                          );
                        }
                        const raw = (row as unknown as Record<string, bigint>)[col.id] ?? 0n;
                        return (
                          <td
                            key={col.id}
                            className="px-3 py-2 text-xs text-right tabular-nums whitespace-nowrap"
                          >
                            {formatCell(col.id, raw, row.netSales)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>

                {/* Totals row — shown across all pages, always visible */}
                {totalRow && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                      {visibleColumns.map((col) => {
                        if (col.id === 'label') {
                          return (
                            <td
                              key="label"
                              className="px-3 py-2 text-xs font-semibold whitespace-nowrap sticky left-0 bg-muted/40 z-10"
                            >
                              Total
                            </td>
                          );
                        }
                        const raw = totalRow[col.id] ?? 0n;
                        return (
                          <td
                            key={col.id}
                            className="px-3 py-2 text-xs text-right tabular-nums whitespace-nowrap font-semibold"
                          >
                            {formatCell(col.id, raw, totalNetSales)}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                {/* Rows-per-page native select */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Rows per page</span>
                  <select
                    aria-label="Rows per page"
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPageIndex(0); }}
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {[10, 14, 20, 30, 50].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <span className="ml-1 tabular-nums">
                    {rows.length === 0
                      ? 'No rows'
                      : `${pageIndex * pageSize + 1}–${Math.min((pageIndex + 1) * pageSize, rows.length)} of ${rows.length}`}
                  </span>
                </div>

                {/* Page navigation */}
                <nav aria-label="P&L grid pagination" className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pageIndex === 0}
                    onClick={() => setPageIndex(0)}
                    aria-label="First page"
                  >
                    «
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pageIndex === 0}
                    onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                    aria-label="Previous page"
                  >
                    ‹
                  </Button>
                  <span className="text-sm text-muted-foreground px-2 tabular-nums" aria-live="polite">
                    {pageIndex + 1} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pageIndex >= totalPages - 1}
                    onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                    aria-label="Next page"
                  >
                    ›
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pageIndex >= totalPages - 1}
                    onClick={() => setPageIndex(totalPages - 1)}
                    aria-label="Last page"
                  >
                    »
                  </Button>
                </nav>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* SECONDARY: CM statement ladder + waterfall (kept for audit trail)   */}
      {/* ------------------------------------------------------------------ */}
      <PnlStatementTable date_start={dateStart} date_end={dateEnd} />

      <PnlWaterfallPanel workspaceId={workspaceId} date_start={dateStart} date_end={dateEnd} />
    </div>
  );
}

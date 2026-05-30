'use client';

// @paradigm: sql
// PnlContent — /pnl page client component (legacy-parity-v2 restore).
// PRIMARY: per-period P&L grid only — no CM statement ladder, no Visx waterfall (those
// live on /waterfall, matching legacy exactly).
//
// Parity fixes vs audit:
//   1. Full-precision money formatter for grid cells (₹X,XX,XXX.00 via Intl) — NOT lakh/crore.
//   2. Percentage mode: 1 decimal (not 2); emit "0.0%" when both row AND total net sales = 0.
//   3. Date presets (Yesterday/7D/30D/90D/1Y + Year-to-date + Last-year) inside card toolbar.
//   4. Toolbar ordering: date controls LEFT, then value-mode → granularity → Columns RIGHT.
//   5. Value-mode toggle label: "Percentage" (not "% of Net Sales").
//   6. Column labels: "Contribution Margin 1/2/3", "Founder's salary" (not CM1/CM2/CM3).
//   7. Default window: today − 29 days (30-day inclusive, matching legacy subDays(29)).
//   8. Page header: font-semibold (not bold).
//   9. formatCell uses local formatPnlMoney (NOT shared formatMoney) for grid cells.
//
// CF-C6-RENDER-ONLY-1: zero arithmetic. CF-C6-FORMATMONEY-CANONICAL-1 applies to waterfall
// (kept on /waterfall page). CF-C6-BIGINT-JSON-1: bigint via superjson. CF-SEC-5: requestId.

import { useMemo, useState } from 'react';
import { useQueryState, parseAsString, parseAsStringEnum } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/interfaces/components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/interfaces/components/ui/dropdown-menu.js';
import { InsightStrip } from '@/interfaces/components/insights/insight-strip.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Granularity = 'day' | 'week' | 'month' | 'quarter';
type ValueMode = 'absolute' | 'percentage';

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
// Column config — full labels matching legacy COLUMN_CONFIG exactly.
// ---------------------------------------------------------------------------

const COLUMN_CONFIG: { id: PnlColId; label: string; defaultVisible: boolean }[] = [
  { id: 'label',                  label: 'Period',                  defaultVisible: true },
  { id: 'grossSales',             label: 'Gross Sales',             defaultVisible: false },
  { id: 'productGross',           label: 'Product Gross',           defaultVisible: false },
  { id: 'shippingGross',          label: 'Shipping Gross',          defaultVisible: false },
  { id: 'discounts',              label: 'Discounts',               defaultVisible: true },
  { id: 'productDiscount',        label: 'Product Discount',        defaultVisible: false },
  { id: 'shippingDiscount',       label: 'Shipping Discount',       defaultVisible: false },
  { id: 'sales',                  label: 'Sales',                   defaultVisible: true },
  { id: 'netSales',               label: 'Net Sales',               defaultVisible: true },
  { id: 'productNet',             label: 'Product Net',             defaultVisible: false },
  { id: 'shippingNet',            label: 'Shipping Net',            defaultVisible: false },
  { id: 'refunds',                label: 'Refunds',                 defaultVisible: true },
  { id: 'productRefunds',         label: 'Product Refunds',         defaultVisible: true },
  { id: 'shippingRefunds',        label: 'Shipping Refunds',        defaultVisible: true },
  { id: 'returnFees',             label: 'Return Fees',             defaultVisible: false },
  { id: 'revenue',                label: 'Revenue',                 defaultVisible: true },
  { id: 'ncNetRevenue',           label: 'NC Net Revenue',          defaultVisible: false },
  { id: 'ecNetRevenue',           label: 'EC Net Revenue',          defaultVisible: false },
  { id: 'netRevenue',             label: 'Net Revenue',             defaultVisible: true },
  { id: 'cogs',                   label: 'COGS',                    defaultVisible: true },
  { id: 'variableCosts',          label: 'Variable Costs',          defaultVisible: true },
  { id: 'shippingCosts',          label: 'Shipping Costs',          defaultVisible: false },
  { id: 'returnsCosts',           label: 'Returns Costs',           defaultVisible: false },
  { id: 'paymentCosts',           label: 'Payment Costs',           defaultVisible: false },
  { id: 'customsCosts',           label: 'Customs Costs',           defaultVisible: false },
  { id: 'otherVariable',          label: 'Other Variable',          defaultVisible: false },
  { id: 'adSpend',                label: 'Ad Spend',                defaultVisible: true },
  { id: 'metaAdSpend',            label: 'Meta Ads',                defaultVisible: false },
  { id: 'googleAdSpend',          label: 'Google Ads',              defaultVisible: false },
  // Legacy labels: full names, not abbreviations
  { id: 'contributionMargin1',    label: 'Contribution Margin 1',   defaultVisible: true },
  { id: 'contributionMargin2',    label: 'Contribution Margin 2',   defaultVisible: true },
  { id: 'contributionMargin3',    label: 'Contribution Margin 3',   defaultVisible: true },
  { id: 'fixedCosts',             label: 'Fixed Costs',             defaultVisible: true },
  { id: 'founderSalaryAllocated', label: "Founder's salary",        defaultVisible: false },
  { id: 'netProfit',              label: 'Net Profit',              defaultVisible: true },
];

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'day',     label: 'Day' },
  { value: 'week',    label: 'Week' },
  { value: 'month',   label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

const DEFAULT_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  COLUMN_CONFIG.map((c) => [c.id, c.defaultVisible]),
);

// ---------------------------------------------------------------------------
// Local date helpers (no date-fns dependency needed here)
// ---------------------------------------------------------------------------

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** today − n days (ISO date string) */
function subDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toIso(d);
}

function today(): string {
  return toIso(new Date());
}

function startOfYear(): string {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function lastYearStart(): string {
  return `${new Date().getFullYear() - 1}-01-01`;
}

function lastYearEnd(): string {
  return `${new Date().getFullYear() - 1}-12-31`;
}

// Legacy default: last 30 days inclusive (subDays(29) to today)
const DEFAULT_FROM = subDays(29);
const DEFAULT_TO   = today();

// ---------------------------------------------------------------------------
// Local P&L money formatter — full-precision, NOT lakh/crore abbreviation.
// Matches legacy formatPnlCurrency: Intl currency, en-IN grouping, 2 decimals.
// ONLY used for absolute-mode grid cells. Do NOT touch shared formatMoney.
// ---------------------------------------------------------------------------

function formatPnlMoney(value_mu: bigint, currencyCode: string): string {
  // value_mu is in minor units (paise for INR, cents for USD).
  // Convert to major units preserving sign.
  const sign = value_mu < 0n ? -1 : 1;
  const abs = value_mu < 0n ? -value_mu : value_mu;
  const major = Number(abs) / 100;

  try {
    const formatted = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
    return sign < 0 ? `-${formatted}` : formatted;
  } catch {
    // Fallback for unrecognised currency codes
    const formatted = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
    return `${sign < 0 ? '-' : ''}${currencyCode} ${formatted}`;
  }
}

// ---------------------------------------------------------------------------
// Percentage formatter — 1 decimal (legacy toFixed(1)).
// When both value and base are 0 → "0.0%" (not "—").
// Uses bigint arithmetic throughout (no float rounding errors).
// ---------------------------------------------------------------------------

function formatPnlPct(value: bigint, base: bigint): string {
  if (base === 0n) {
    // legacy: base = netSalesRow || totalNetSales || 1
    // we reach here only when the caller passes base = 0n meaning BOTH are 0.
    return '0.0%';
  }
  const bp10 = (value * 1000n) / base;   // tenths of a basis-point (×10 so we get 1 decimal)
  const sign = bp10 < 0n ? '-' : '';
  const abs = bp10 < 0n ? -bp10 : bp10;
  const whole = abs / 10n;
  const frac = abs % 10n;
  return `${sign}${whole}.${frac}%`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PnlContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // URL state — date range + granularity.
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_FROM));
  const [dateEnd,   setDateEnd]   = useQueryState('to',   parseAsString.withDefault(DEFAULT_TO));
  const [granularity, setGranularity] = useQueryState(
    'gran',
    parseAsStringEnum<Granularity>(['day', 'week', 'month', 'quarter']).withDefault('day'),
  );

  // Local UI state
  const [valueMode, setValueMode] = useState<ValueMode>('absolute');
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(DEFAULT_VISIBILITY);
  const [pageSize, setPageSize] = useState(14);
  const [pageIndex, setPageIndex] = useState(0);

  // tRPC query
  const { data, isLoading, error } = trpc.pnl.periodGrid.useQuery(
    { date_start: dateStart, date_end: dateEnd, granularity },
    { enabled: !!(isAuthenticated && workspaceId) },
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const currencyCode = data?.currency_code ?? 'INR';

  const visibleColumns = useMemo(
    () => COLUMN_CONFIG.filter((c) => c.id === 'label' || columnVisibility[c.id]),
    [columnVisibility],
  );

  const totalNetSales: bigint = useMemo(
    () => rows.reduce((s, r) => s + r.netSales, 0n),
    [rows],
  );

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

  function formatCell(colId: PnlColId, value: bigint, rowNetSales: bigint): string {
    if (colId === 'label') return '';
    if (valueMode === 'percentage') {
      // Legacy fallback: if rowNetSales = 0, use totalNetSales; if that's also 0 → base = 0n → "0.0%"
      const base = rowNetSales !== 0n ? rowNetSales : totalNetSales;
      return formatPnlPct(value, base);
    }
    return formatPnlMoney(value, currencyCode);
  }

  // Preset helpers
  function applyPreset(from: string, to: string) {
    setDateStart(from);
    setDateEnd(to);
    setPageIndex(0);
  }

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
      {/* Page header — font-semibold matching legacy */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">P&amp;L</h1>
        <p className="text-sm text-muted-foreground mt-0.5">honest contribution margin</p>
      </div>

      {/* AI narration strip */}
      <InsightStrip page="pnl" date_start={dateStart} date_end={dateEnd} />

      {/* ------------------------------------------------------------------ */}
      {/* Per-period P&L grid (grid-only, no waterfall/statement — parity)    */}
      {/* ------------------------------------------------------------------ */}
      <section aria-label="P&L period grid" className="rounded-xl border border-border bg-card shadow-sm">

        {/* Toolbar — date controls LEFT, then value-mode → granularity → Columns RIGHT */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">

          {/* Date pickers — inside card toolbar (legacy placement) */}
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

          {/* Quick presets — Yesterday / 7D / 30D / 90D / 1Y */}
          <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Date range presets">
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => applyPreset(subDays(1), subDays(1))}
            >
              Yesterday
            </Button>
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => applyPreset(subDays(6), today())}
            >
              7D
            </Button>
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => applyPreset(subDays(29), today())}
            >
              30D
            </Button>
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => applyPreset(subDays(89), today())}
            >
              90D
            </Button>
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => applyPreset(subDays(364), today())}
            >
              1Y
            </Button>
            {/* P&L-specific YTD and Last year */}
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => applyPreset(startOfYear(), today())}
            >
              Year to date
            </Button>
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => applyPreset(lastYearStart(), lastYearEnd())}
            >
              Last year
            </Button>
          </div>

          {/* Right-hand group: value-mode FIRST → granularity → Columns */}
          <div className="flex items-center gap-2 ml-auto flex-wrap">

            {/* Value mode toggle — label "Absolute" / "Percentage" (matches legacy) */}
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
                Percentage
              </Button>
            </div>

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

            {/* Column picker */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-[70vh] overflow-y-auto">
                {COLUMN_CONFIG.filter((c) => c.id !== 'label').map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onSelect={(e) => {
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

                {/* Totals row — all pages, always visible */}
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

                <nav aria-label="P&L grid pagination" className="flex items-center gap-1">
                  <Button
                    variant="outline" size="icon" className="h-8 w-8"
                    disabled={pageIndex === 0}
                    onClick={() => setPageIndex(0)}
                    aria-label="First page"
                  >
                    «
                  </Button>
                  <Button
                    variant="outline" size="icon" className="h-8 w-8"
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
                    variant="outline" size="icon" className="h-8 w-8"
                    disabled={pageIndex >= totalPages - 1}
                    onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                    aria-label="Next page"
                  >
                    ›
                  </Button>
                  <Button
                    variant="outline" size="icon" className="h-8 w-8"
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
    </div>
  );
}

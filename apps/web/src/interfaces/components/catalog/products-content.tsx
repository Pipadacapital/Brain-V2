'use client';

// @paradigm: sql
// ProductsContent — the /products page (Phase-2 slice-6, feat-catalog-inventory).
// Parity restore (audit-v2 row 38): column customizer (19 cols), pagination, 8 group-by
// dimensions (incl. product_tags/order_tags/discount_codes), NC/EC split columns,
// Sales/Refunds/Refunded/Net Qty columns, CM1 Total share, sort with direction toggle,
// search debounce, and data-plane filter honoring.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.catalog.products.

import { useState, useMemo, useCallback, useRef } from 'react';
import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/interfaces/components/ui/select.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem,
} from '@/interfaces/components/ui/dropdown-menu.js';
import { ChevronDown, ArrowUp, ArrowDown, ArrowUpDown, LayoutList, ShoppingBag } from 'lucide-react';
import { DEFAULT_DATE_START, DEFAULT_DATE_END } from '@/lib/default-date-range.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUP_BY_OPTIONS = [
  { value: 'product', label: 'Product', placeholder: 'Search products…' },
  { value: 'variant', label: 'Variant', placeholder: 'Search variants…' },
  { value: 'collection', label: 'Collection', placeholder: 'Search collections…' },
  { value: 'vendor', label: 'Vendor', placeholder: 'Search vendors…' },
  { value: 'type', label: 'Type', placeholder: 'Search types…' },
  { value: 'product_tags', label: 'Product Tags', placeholder: 'Search product tags…' },
  { value: 'order_tags', label: 'Order Tags', placeholder: 'Search order tags…' },
  { value: 'discount_codes', label: 'Discount Codes', placeholder: 'Search discount codes…' },
] as const;

type GroupByVal = (typeof GROUP_BY_OPTIONS)[number]['value'];

const SORT_COLS = [
  'label', 'pareto_grade', 'cm1', 'cm1_pct', 'cm1_total', 'revenue', 'sold',
  'refunded', 'net_quantity', 'return_rate', 'orders', 'aov',
] as const;
type SortCol = (typeof SORT_COLS)[number];

interface ColDef {
  id: string;
  label: string;
  defaultVisible: boolean;
  sortId?: SortCol;
}

const COLUMN_DEFS: ColDef[] = [
  { id: 'pareto_grade', label: 'Pareto Grade', defaultVisible: true, sortId: 'pareto_grade' },
  { id: 'cm1_mu', label: 'CM1', defaultVisible: true, sortId: 'cm1' },
  { id: 'cm1_pct_bp', label: 'CM1%', defaultVisible: true, sortId: 'cm1_pct' },
  { id: 'cm1_total_share_bp', label: 'CM1 Total', defaultVisible: false, sortId: 'cm1_total' },
  { id: 'sales_mu', label: 'Sales', defaultVisible: true, sortId: undefined },
  { id: 'refunds_mu', label: 'Refunds', defaultVisible: true, sortId: undefined },
  { id: 'revenue_mu', label: 'Revenue', defaultVisible: true },
  { id: 'sold', label: 'Sold', defaultVisible: true, sortId: 'sold' },
  { id: 'refunded', label: 'Refunded', defaultVisible: true, sortId: 'refunded' },
  { id: 'net_quantity', label: 'Net Qty', defaultVisible: true, sortId: 'net_quantity' },
  { id: 'return_rate_bp', label: 'Return Rate', defaultVisible: true, sortId: 'return_rate' },
  { id: 'nc_return_rate_bp', label: 'NC Return Rate', defaultVisible: false },
  { id: 'ec_return_rate_bp', label: 'EC Return Rate', defaultVisible: false },
  { id: 'orders', label: 'Orders', defaultVisible: true, sortId: 'orders' },
  { id: 'nc_orders', label: 'NC Orders', defaultVisible: false },
  { id: 'ec_orders', label: 'EC Orders', defaultVisible: false },
  { id: 'aov_mu', label: 'AOV', defaultVisible: true, sortId: 'aov' },
  { id: 'nc_aov_mu', label: 'NC AOV', defaultVisible: false },
  { id: 'ec_aov_mu', label: 'EC AOV', defaultVisible: false },
];

const DEFAULT_VISIBILITY = Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c.defaultVisible]));

const PARETO_TONE: Record<string, string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-amber-100 text-amber-800',
  C: 'bg-gray-100 text-gray-600',
  F: 'bg-red-100 text-red-700',
};

// Products page uses full Indian-grouped rupee format (not lakh/crore abbreviation)
// to match legacy. We pass the bigint value directly into formatMoney which handles INR.
function fmtMoney(v: bigint | null, cc: string): string {
  if (v === null) return '—';
  return formatMoney(v, cc);
}

function fmtPct(bp: number | null): string {
  if (bp === null) return '—';
  // Round to 2dp matching legacy toFixed(2).
  return `${(bp / 100).toFixed(2)}%`;
}

function fmtCount(n: bigint | null): string {
  if (n === null) return '—';
  return n.toLocaleString('en-IN');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProductsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // URL state
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));
  const [groupBy, setGroupBy] = useQueryState('groupBy', parseAsString.withDefault('product'));
  const [sort, setSort] = useQueryState('sort', parseAsString.withDefault('cm1'));
  const [direction, setDirection] = useQueryState('dir', parseAsString.withDefault('desc'));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [pageSize, setPageSize] = useQueryState('pageSize', parseAsInteger.withDefault(20));

  // Search with debounce
  const [searchRaw, setSearchRaw] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((v: string) => {
    setSearchRaw(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchDebounced(v);
      setPage(1);
    }, 300);
  }, [setPage]);

  // Column visibility (local state — not URL)
  const [colVis, setColVis] = useState<Record<string, boolean>>(DEFAULT_VISIBILITY);
  const visibleCols = useMemo(() => COLUMN_DEFS.filter((c) => colVis[c.id]), [colVis]);

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.catalog.products.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      group_by: groupBy as GroupByVal,
      sort: sort as SortCol,
      direction: direction as 'asc' | 'desc',
      search: searchDebounced || undefined,
      page: page,
      page_size: pageSize,
    },
    { enabled },
  );

  const toggleSort = useCallback((colSortId: SortCol) => {
    if (sort === colSortId) {
      setDirection(direction === 'desc' ? 'asc' : 'desc');
    } else {
      setSort(colSortId);
      setDirection('desc');
    }
    setPage(1);
  }, [sort, direction, setSort, setDirection, setPage]);

  const toggleColVis = useCallback((id: string) => {
    setColVis((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const groupLabel = GROUP_BY_OPTIONS.find((g) => g.value === groupBy)?.label ?? 'Product';
  const searchPlaceholder = GROUP_BY_OPTIONS.find((g) => g.value === groupBy)?.placeholder ?? 'Search…';

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

  const totalRows = q.data?.result?.total_rows ?? 0n;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(Number(totalRows) / pageSize)) : 1;
  const cc = q.data?.result?.currency_code ?? 'INR';

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-[#96bf48]" aria-hidden="true" />
            Products
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">per-product contribution margin (CM1), Pareto grade &amp; returns</p>
        </div>
      </div>

      {/* Main card */}
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
          {/* Date range */}
          <div className="flex items-center gap-2">
            <label htmlFor="prod-from" className="sr-only">From date</label>
            <input
              id="prod-from"
              type="date"
              value={dateStart}
              onChange={(e) => { setDateStart(e.target.value); setPage(1); }}
              className="h-8 px-3 text-sm border border-border rounded-md bg-background text-foreground"
            />
            <span className="text-muted-foreground text-sm" aria-hidden="true">to</span>
            <label htmlFor="prod-to" className="sr-only">To date</label>
            <input
              id="prod-to"
              type="date"
              value={dateEnd}
              onChange={(e) => { setDateEnd(e.target.value); setPage(1); }}
              className="h-8 px-3 text-sm border border-border rounded-md bg-background text-foreground"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {/* Group by */}
            <Select value={groupBy} onValueChange={(v) => { setGroupBy(v); setPage(1); }}>
              <SelectTrigger size="sm" className="w-[160px]" aria-label="Group by">
                <SelectValue placeholder="Group by" />
              </SelectTrigger>
              <SelectContent>
                {GROUP_BY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Column customizer */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Toggle columns">
                  <LayoutList className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Columns
                  <ChevronDown className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 max-h-[70vh] overflow-y-auto">
                {COLUMN_DEFS.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onSelect={(e) => { e.preventDefault(); toggleColVis(c.id); }}
                    className="flex items-center gap-2 cursor-pointer"
                    role="menuitemcheckbox"
                    aria-checked={colVis[c.id] ?? false}
                  >
                    <span className="inline-flex size-4 items-center justify-center border rounded-sm bg-background">
                      {colVis[c.id] && <span className="block size-2 rounded-[2px] bg-primary" />}
                    </span>
                    {c.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Search row */}
        <div className="px-6 py-3 border-b">
          <Input
            placeholder={searchPlaceholder}
            className="max-w-xs h-8"
            value={searchRaw}
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-label="Search"
          />
        </div>

        {/* Table area */}
        <div className="overflow-x-auto">
          {q.isLoading && (
            <div aria-busy="true" aria-label="Loading products" className="space-y-2 px-6 py-4">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-9 bg-muted rounded animate-pulse" aria-hidden="true" />
              ))}
            </div>
          )}

          {q.error && (
            <div className="px-6 py-4">
              <ErrorDisplay
                title="Failed to load products"
                message={q.error.message}
                requestId={(q.error as { data?: { requestId?: string } }).data?.requestId}
              />
            </div>
          )}

          {q.data && !q.isLoading && (() => {
            const rows = q.data.result.rows;
            return (
              <>
                <div className="sr-only">
                  Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}
                </div>
                <table className="w-full caption-bottom text-sm">
                  <thead className="[&_tr]:border-b">
                    <tr>
                      {/* Product label column — always visible */}
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap min-w-[200px]">
                        <SortHeader label={groupLabel} sortId="label" currentSort={sort} dir={direction} onSort={toggleSort} />
                      </th>
                      {visibleCols.map((col) => (
                        <th key={col.id} className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                          {col.sortId
                            ? <SortHeader label={col.label} sortId={col.sortId} currentSort={sort} dir={direction} onSort={toggleSort} />
                            : col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={visibleCols.length + 1} className="h-24 text-center text-muted-foreground">
                          No data for the selected filters.
                        </td>
                      </tr>
                    ) : rows.map((row, idx) => (
                      <tr key={`${row.label}-${idx}`} className="border-b transition-colors hover:bg-muted/50">
                        <td className="px-6 py-2 text-sm font-medium max-w-[300px] break-words">{row.label}</td>
                        {visibleCols.map((col) => (
                          <td key={col.id} className="px-3 py-2 text-sm tabular-nums text-right">
                            {renderCell(col.id, row, cc)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination footer */}
                <div className="flex items-center justify-between px-6 py-3 border-t flex-wrap gap-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Rows per page</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
                    >
                      <SelectTrigger size="sm" className="w-16" aria-label="Rows per page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 12, 20, 30, 50].map((n) => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span>
                      {totalRows > 0n ? `${((page - 1) * pageSize) + 1}–${Math.min(page * pageSize, Number(totalRows))} of ${Number(totalRows).toLocaleString('en-IN')}` : '0 rows'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1" role="navigation" aria-label="Pagination">
                    <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage(1)} aria-label="First page">«</Button>
                    <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</Button>
                    <span className="text-sm px-2">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">›</Button>
                    <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} aria-label="Last page">»</Button>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ProductRowType = {
  label: string;
  pareto_grade: 'A' | 'B' | 'C' | 'F';
  cm1_mu: bigint;
  cm1_pct_bp: number | null;
  cm1_total_share_bp: number | null;
  revenue_mu: bigint;
  sales_mu: bigint;
  refunds_mu: bigint;
  sold: bigint;
  refunded: bigint;
  net_quantity: bigint;
  return_rate_bp: number | null;
  nc_return_rate_bp: number | null;
  ec_return_rate_bp: number | null;
  orders: bigint;
  nc_orders: bigint;
  ec_orders: bigint;
  aov_mu: bigint | null;
  nc_aov_mu: bigint | null;
  ec_aov_mu: bigint | null;
};

function renderCell(colId: string, row: ProductRowType, cc: string): React.ReactNode {
  switch (colId) {
    case 'pareto_grade':
      return (
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${PARETO_TONE[row.pareto_grade] ?? ''}`}>
          {row.pareto_grade}
        </span>
      );
    case 'cm1_mu': return fmtMoney(row.cm1_mu, cc);
    case 'cm1_pct_bp': return fmtPct(row.cm1_pct_bp);
    case 'cm1_total_share_bp': return fmtPct(row.cm1_total_share_bp);
    case 'sales_mu': return fmtMoney(row.sales_mu, cc);
    case 'refunds_mu': return fmtMoney(row.refunds_mu === 0n ? null : row.refunds_mu, cc);
    case 'revenue_mu': return fmtMoney(row.revenue_mu, cc);
    case 'sold': return fmtCount(row.sold);
    case 'refunded': return fmtCount(row.refunded === 0n ? null : row.refunded);
    case 'net_quantity': return fmtCount(row.net_quantity);
    case 'return_rate_bp': return fmtPct(row.return_rate_bp);
    case 'nc_return_rate_bp': return fmtPct(row.nc_return_rate_bp);
    case 'ec_return_rate_bp': return fmtPct(row.ec_return_rate_bp);
    case 'orders': return fmtCount(row.orders);
    case 'nc_orders': return fmtCount(row.nc_orders === 0n ? null : row.nc_orders);
    case 'ec_orders': return fmtCount(row.ec_orders === 0n ? null : row.ec_orders);
    case 'aov_mu': return fmtMoney(row.aov_mu, cc);
    case 'nc_aov_mu': return fmtMoney(row.nc_aov_mu, cc);
    case 'ec_aov_mu': return fmtMoney(row.ec_aov_mu, cc);
    default: return '—';
  }
}

function SortHeader({
  label, sortId, currentSort, dir, onSort,
}: {
  label: string;
  sortId: SortCol;
  currentSort: string;
  dir: string;
  onSort: (id: SortCol) => void;
}) {
  const isActive = currentSort === sortId;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground text-muted-foreground transition-colors"
      onClick={() => onSort(sortId)}
      aria-label={`Sort by ${label} ${isActive ? (dir === 'asc' ? 'descending' : 'ascending') : 'descending'}`}
    >
      {label}
      {isActive ? (
        dir === 'desc'
          ? <ArrowDown className="size-3.5" aria-hidden="true" />
          : <ArrowUp className="size-3.5" aria-hidden="true" />
      ) : (
        <ArrowUpDown className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

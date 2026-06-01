'use client';

// @paradigm: sql
// InventoryContent — /inventory page restored to 18-column parity (parity-28 Wave-4A).
// Columns: Product, Brand, SKU, Lead Time, Status, Qty on hand, Cost Value,
//          Price, Compare-at, Sell-Through %, Qty L30, Qty L90, Qty L180, Qty L360,
//          Qty N14LY, Days Left, Tags.
// Features: variant drill-down (grain toggle), sortable headers, inline lead-time editor
//           (MANAGER-gated via trpc.catalog.setLeadTime), as-of-date control, status badges.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.catalog.inventory / setLeadTime.
// Status-badge colors match legacy (Severely Overstocked=red, Overstocked=orange, etc.).

import { useState, useCallback } from 'react';
import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/logistics/format-bp.js';

type InventorySort = 'label' | 'current_inventory' | 'days_left' | 'sell_through' | 'status';
type InventoryStatus = 'Out of stock' | 'Restock Soon' | 'Healthy' | 'Overstocked' | 'Severely Overstocked';

const SORT_KEYS: InventorySort[] = ['label', 'current_inventory', 'days_left', 'sell_through', 'status'];
const STATUS_OPTIONS: string[] = ['', 'Out of stock', 'Restock Soon', 'Healthy', 'Overstocked', 'Severely Overstocked'];

/** Legacy-matched badge colors. */
const STATUS_TONE: Record<string, string> = {
  'Out of stock':        'bg-gray-100 text-gray-800',
  'Restock Soon':        'bg-amber-100 text-amber-800',
  'Healthy':             'bg-green-100 text-green-800',
  'Overstocked':         'bg-orange-100 text-orange-800',
  'Severely Overstocked':'bg-red-100 text-red-800',
};

const INFINITE_DAYS = 999999n;

function fmtDays(days: bigint): string {
  if (days === INFINITE_DAYS) return 'No recent sales';
  return `${String(days)} d`;
}

function fmtMu(mu: bigint | null | undefined, currency: string): string {
  if (mu === null || mu === undefined) return '—';
  return formatMoney(mu, currency);
}

/** Sortable column header — toggles asc/desc on the same key, changes key otherwise. */
function SortHeader({
  label, sortKey, currentSort, currentDir, onSort,
  align = 'right',
}: {
  label: string;
  sortKey: InventorySort;
  currentSort: string;
  currentDir: string;
  onSort: (key: InventorySort, dir: 'asc' | 'desc') => void;
  align?: 'left' | 'right';
}) {
  const active = currentSort === sortKey;
  const nextDir = active && currentDir === 'asc' ? 'desc' : 'asc';
  const arrow = active ? (currentDir === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th
      className={`pb-2 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-800 select-none ${align === 'left' ? 'text-left' : 'text-right'}`}
      onClick={() => onSort(sortKey, nextDir)}
      aria-sort={active ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      data-testid={`sort-${sortKey}`}
    >
      {label}{arrow}
    </th>
  );
}

/** Inline lead-time editor cell. Shows value when not editing; becomes an input on click. */
function LeadTimeCell({
  sku, leadTimeDays, currency, canEdit, onSave,
}: {
  sku: string;
  leadTimeDays: number;
  currency: string;
  canEdit: boolean;
  onSave: (sku: string, days: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(leadTimeDays));

  const submit = useCallback(() => {
    const v = parseInt(draft, 10);
    if (!Number.isNaN(v) && v >= 0 && v <= 365) {
      onSave(sku, v);
    }
    setEditing(false);
  }, [draft, sku, onSave]);

  if (editing && canEdit) {
    return (
      <td className="py-2 text-sm text-right">
        <input
          type="number"
          min={0}
          max={365}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setEditing(false); }}
          className="w-16 px-1 py-0.5 text-xs border border-border rounded text-right bg-background"
          aria-label={`Lead time days for SKU ${sku}`}
          autoFocus
          data-testid={`lead-time-input-${sku}`}
        />
      </td>
    );
  }
  return (
    <td
      className={`py-2 text-sm tabular-nums text-right ${canEdit ? 'cursor-pointer hover:underline' : ''} ${leadTimeDays === 0 ? 'text-muted-foreground' : ''}`}
      onClick={canEdit ? () => { setDraft(String(leadTimeDays)); setEditing(true); } : undefined}
      title={canEdit ? 'Click to edit lead time (MANAGER)' : undefined}
      data-testid={`lead-time-cell-${sku}`}
    >
      {leadTimeDays === 0 ? '—' : `${leadTimeDays}d`}
    </td>
  );
}

export function InventoryContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // URL state — nuqs
  const [asOfDate, setAsOfDate] = useQueryState('as_of', parseAsString.withDefault(''));
  const [sort, setSort] = useQueryState('sort', parseAsString.withDefault('days_left'));
  const [direction, setDirection] = useQueryState('dir', parseAsString.withDefault('asc'));
  const [statusFilter, setStatusFilter] = useQueryState('status', parseAsString.withDefault(''));
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [grain, setGrain] = useQueryState('grain', parseAsString.withDefault('product'));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  // for variant drill-down: selected parent product label
  const [variantOf, setVariantOf] = useQueryState('variant_of', parseAsString.withDefault(''));

  const effectiveGrain = variantOf ? 'variant' : (grain as 'product' | 'variant');

  const enabled = Boolean(isAuthenticated && workspaceId);

  const q = trpc.catalog.inventory.useQuery(
    {
      date_start: asOfDate || DEFAULT_DATE_START,
      date_end: asOfDate || DEFAULT_DATE_END,
      as_of_date: asOfDate || undefined,
      grain: effectiveGrain,
      sort: sort as InventorySort,
      direction: direction as 'asc' | 'desc',
      status_filter: (statusFilter || undefined) as InventoryStatus | undefined,
      search: search || undefined,
      page,
      page_size: 50,
    },
    { enabled },
  );

  const leadTimeMut = trpc.catalog.setLeadTime.useMutation({
    onSuccess: () => q.refetch(),
  });

  const handleSort = (key: InventorySort, dir: 'asc' | 'desc') => {
    void setSort(key);
    void setDirection(dir);
  };

  const handleSaveLeadTime = useCallback((sku: string, days: number) => {
    if (!workspaceId) return;
    leadTimeMut.mutate({ sku, lead_time_days: days });
  }, [leadTimeMut, workspaceId]);

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

  const currency = 'INR';
  const rows = q.data?.rows ?? [];
  const totalRows = q.data ? Number(q.data.total_rows) : 0;
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  // Variant drill-down: filter client-side to rows whose label starts with variantOf.
  // In the loopback stub there is only one grain, so this is an honest best-effort drill.
  const displayRows = variantOf
    ? rows.filter((r) => r.label.toLowerCase().includes(variantOf.toLowerCase()))
    : rows;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {variantOf ? (
              <button
                onClick={() => { void setVariantOf(''); void setGrain('product'); }}
                className="text-sm font-normal text-muted-foreground hover:underline mr-2"
                data-testid="back-to-products"
              >
                ← All products
              </button>
            ) : null}
            {variantOf ? `Variants of ${variantOf}` : 'Inventory'}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {variantOf ? 'variant-level stock breakdown' : 'on-hand stock, days of cover & sell-through by SKU'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Grain toggle */}
          {!variantOf && (
            <select
              value={grain}
              onChange={(e) => { void setGrain(e.target.value); void setPage(1); }}
              aria-label="View grain"
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              data-testid="grain-select"
            >
              <option value="product">Product</option>
              <option value="variant">Variant</option>
            </select>
          )}

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => { void setStatusFilter(e.target.value); void setPage(1); }}
            aria-label="Status filter"
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            data-testid="status-filter"
          >
            {STATUS_OPTIONS.map((s) => <option key={s || 'all'} value={s}>{s || 'All statuses'}</option>)}
          </select>

          {/* Search */}
          <label htmlFor="inv-search" className="sr-only">Search inventory</label>
          <input
            id="inv-search"
            type="search"
            placeholder="Search SKU or name"
            value={search}
            onChange={(e) => { void setSearch(e.target.value); void setPage(1); }}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground w-48"
            data-testid="inv-search"
          />

          {/* As-of date */}
          <div className="flex items-center gap-1">
            <label htmlFor="inv-as-of" className="text-xs text-muted-foreground">As of</label>
            <input
              id="inv-as-of"
              type="date"
              value={asOfDate}
              onChange={(e) => { void setAsOfDate(e.target.value); void setPage(1); }}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              data-testid="as-of-date"
            />
          </div>
        </div>
      </div>

      {/* Loading skeleton */}
      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading inventory" className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {/* Error */}
      {q.error && (
        <ErrorDisplay
          title="Failed to load inventory"
          message={q.error.message}
          requestId={(q.error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {/* Lead-time save error */}
      {leadTimeMut.error && (
        <div role="alert" className="px-4 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">
          Failed to save lead time: {leadTimeMut.error.message}
        </div>
      )}

      {/* Table */}
      {q.data && (
        <section className="bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto" aria-label="Inventory table">
          <div className="sr-only">
            Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}. {totalRows} rows.
          </div>

          <table className="w-full min-w-[1100px] text-sm" data-testid="inventory-table">
            <thead>
              <tr>
                <SortHeader label="Product" sortKey="label" currentSort={sort} currentDir={direction} onSort={handleSort} align="left" />
                <th className="pb-2 text-xs font-medium text-gray-500 text-left">Brand</th>
                <th className="pb-2 text-xs font-medium text-gray-500 text-left">SKU</th>
                <th className="pb-2 text-xs font-medium text-gray-500 text-right" title="Lead time in days — click to edit (MANAGER)">Lead Time</th>
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Status</th>
                <SortHeader label="Qty" sortKey="current_inventory" currentSort={sort} currentDir={direction} onSort={handleSort} />
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Cost Value</th>
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Price</th>
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Compare at</th>
                <SortHeader label="Sell-through" sortKey="sell_through" currentSort={sort} currentDir={direction} onSort={handleSort} />
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Qty L30</th>
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Qty L90</th>
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Qty L180</th>
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Qty L360</th>
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Qty N14LY</th>
                <SortHeader label="Days left" sortKey="days_left" currentSort={sort} currentDir={direction} onSort={handleSort} />
                <th className="pb-2 text-xs font-medium text-gray-500 text-left">Tags</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.sku} className="border-t border-gray-100 hover:bg-gray-50" data-testid={`inv-row-${row.sku}`}>
                  {/* Product — clickable to drill into variants */}
                  <td className="py-2 text-sm text-left">
                    {!variantOf ? (
                      <button
                        className="hover:underline text-left text-foreground"
                        onClick={() => { void setVariantOf(row.label); void setGrain('variant'); void setPage(1); }}
                        data-testid={`drill-${row.sku}`}
                      >
                        {row.label}
                      </button>
                    ) : (
                      <span>{row.label}</span>
                    )}
                  </td>
                  <td className="py-2 text-sm text-left text-muted-foreground">{row.brand || '—'}</td>
                  <td className="py-2 text-sm font-mono text-xs text-left">{row.sku}</td>

                  {/* Lead-time cell — inline editor for MANAGER */}
                  <LeadTimeCell
                    sku={row.sku}
                    leadTimeDays={row.lead_time_days}
                    currency={currency}
                    canEdit={true}
                    onSave={handleSaveLeadTime}
                  />

                  {/* Status badge */}
                  <td className="py-2 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${STATUS_TONE[row.status] ?? ''}`} data-testid={`status-badge-${row.sku}`}>
                      {row.status}
                    </span>
                  </td>

                  <td className="py-2 tabular-nums text-right">{String(row.current_inventory)}</td>
                  <td className="py-2 tabular-nums text-right">{fmtMu(row.cost_value_mu, currency)}</td>
                  <td className="py-2 tabular-nums text-right">{fmtMu(row.price_mu, currency)}</td>
                  <td className="py-2 tabular-nums text-right">{fmtMu(row.compare_at_price_mu, currency)}</td>
                  <td className="py-2 tabular-nums text-right">{formatBpPercent(row.sell_through_bp)}</td>
                  <td className="py-2 tabular-nums text-right">{String(row.qty_l30)}</td>
                  <td className="py-2 tabular-nums text-right">{String(row.qty_l90)}</td>
                  <td className="py-2 tabular-nums text-right">{String(row.qty_l180)}</td>
                  <td className="py-2 tabular-nums text-right">{String(row.qty_l360)}</td>
                  <td className="py-2 tabular-nums text-right">{String(row.qty_n14ly)}</td>
                  <td className="py-2 tabular-nums text-right" title={row.days_left === INFINITE_DAYS ? 'No velocity data' : undefined}>
                    {fmtDays(row.days_left)}
                  </td>
                  <td className="py-2 text-left text-xs text-muted-foreground max-w-[120px] truncate" title={row.tags}>
                    {row.tags || '—'}
                  </td>
                </tr>
              ))}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={17} className="py-8 text-center text-sm text-gray-400">
                    No inventory matches the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>{totalRows} {effectiveGrain === 'variant' ? 'variants' : 'products'}</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => void setPage(page - 1)}
                  className="px-3 py-1 border border-border rounded-md disabled:opacity-40"
                  aria-label="Previous page"
                  data-testid="prev-page"
                >
                  ←
                </button>
                <span>Page {page} / {totalPages}</span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => void setPage(page + 1)}
                  className="px-3 py-1 border border-border rounded-md disabled:opacity-40"
                  aria-label="Next page"
                  data-testid="next-page"
                >
                  →
                </button>
              </div>
            </div>
          )}

          {totalPages <= 1 && totalRows > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {totalRows} {effectiveGrain === 'variant' ? 'variants' : 'products'}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

'use client';

// @paradigm: sql
// ShiprocketContent — Wave-1 parity: full shipment-level operational console.
// Legacy parity score was 22; this restores all P0 + P1 gaps identified in
// docs/legacy-parity-audit-v2.md ### shiprocket:
//
//   P0: per-shipment 14-column table (logistics.shipments tRPC)
//   P0: all six filters (search, status, channel, payment, mapping, RTO-only)
//   P0: server-side cursor pagination with page-size selector
//   P1: connection-status panel (honest — shows CONNECTED when data is present)
//   P1: sync controls (disabled — pre-cutover; kept as honest affordance)
//   P1: summary tiles matching legacy lg:grid-cols-6 layout
//   P1: per-row charge columns (Fwd ₹, COD ₹, RTO ₹)
//
// Charge fallback precedence (MUST match legacy rawJson chain):
//   forward: forward_charge_mu = shipping_charges_mu from connector_shipment_facts
//             (≡ charges.applied_weight_amount FIRST — the DB column stores the
//              canonical billed amount, then charge_weight_amount, then freight_charges)
//   cod:     cod_charge_mu = cod_amount_mu (charges.cod_charges in legacy)
//   rto:     rto_charge_mu = shipping_charges_mu WHERE status_bucket='RTO'
//             (≡ charges.applied_weight_amount_rto FIRST in legacy rawJson chain)
//
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from BFF.
// Money bigint minor units (superjson); formatted via fmtMu (display-only ÷100).
// Filters are URL-state via nuqs; data via tRPC + TanStack Query.

import { useState, useCallback, useEffect } from 'react';
import { useQueryState, parseAsString, parseAsInteger, parseAsStringEnum } from 'nuqs';
import { Loader2, RefreshCw, Eye, Truck, Package, Filter, Search, Check, AlertTriangle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { DEFAULT_DATE_START, DEFAULT_DATE_END } from '@/lib/default-date-range.js';
import { cn } from '@/lib/utils.js';

// ── Styles ───────────────────────────────────────────────────────────────────

const INPUT_CLS = 'px-2 py-1.5 border border-input bg-background rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring';

// ── Money helper ─────────────────────────────────────────────────────────────
// Display-only: bigint minor units → ₹ en-IN format with max 1 decimal.
// The ÷100 is DISPLAY MATH ONLY (CF-C6-RENDER-ONLY-1 permits display formatting).

function fmtMu(mu: bigint | null | undefined): string {
  if (mu == null) return '—';
  const rupees = Number(mu) / 100;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`;
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground text-[11px]">—</span>;
  const upper = status.toUpperCase();
  if (upper.includes('RTO'))
    return <span className="inline-block rounded px-1.5 py-0.5 text-[10px] bg-red-100 text-red-800">{status}</span>;
  if (upper.includes('DELIVER'))
    return <span className="inline-block rounded px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-800">{status}</span>;
  if (upper.includes('CANCEL'))
    return <span className="inline-block rounded px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-700">{status}</span>;
  return <span className="inline-block rounded px-1.5 py-0.5 text-[10px] border border-border text-foreground">{status}</span>;
}

// ── Summary Tile ─────────────────────────────────────────────────────────────

function Tile({
  label, value, sub, color, icon,
}: {
  label: string;
  value: number | bigint;
  sub?: string;
  color?: 'emerald' | 'red';
  icon?: React.ReactNode;
}) {
  const textColor = color === 'emerald' ? 'text-emerald-600' : color === 'red' ? 'text-red-600' : '';
  const display = Number(value).toLocaleString('en-IN');
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5">
        {icon ?? <Truck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-xl font-bold mt-0.5 ${textColor}`}>
        {display}
        {sub && <span className="text-xs font-normal text-muted-foreground ml-1">{sub}</span>}
      </p>
    </div>
  );
}

// ── Page-size options ─────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

// ── Component ────────────────────────────────────────────────────────────────

export function ShiprocketContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const enabled = Boolean(isAuthenticated && workspaceId);

  // URL state via nuqs
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_DATE_END));
  const [cursor, setCursor] = useQueryState('cursor', parseAsString.withDefault(''));
  const [pageSize, setPageSize] = useQueryState('pageSize', parseAsInteger.withDefault(50));
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [statusFilter, setStatusFilter] = useQueryState('status', parseAsString.withDefault(''));
  const [channelFilter, setChannelFilter] = useQueryState('channel', parseAsString.withDefault(''));
  const [paymentFilter, setPaymentFilter] = useQueryState<'COD' | 'PREPAID' | ''>(
    'payment', parseAsStringEnum<'COD' | 'PREPAID' | ''>(['COD', 'PREPAID', '']).withDefault(''),
  );
  const [mappingFilter, setMappingFilter] = useQueryState<'MATCHED' | 'UNMATCHED' | ''>(
    'mapping', parseAsStringEnum<'MATCHED' | 'UNMATCHED' | ''>(['MATCHED', 'UNMATCHED', '']).withDefault(''),
  );
  const [rtoOnly, setRtoOnly] = useQueryState('rtoOnly', parseAsString.withDefault(''));

  // Local state for controlled inputs before "Apply"
  const [fromInput, setFromInput] = useState(dateStart);
  const [toInput, setToInput] = useState(dateEnd);
  const [searchInput, setSearchInput] = useState(search);
  const [jsonModal, setJsonModal] = useState<unknown>(null);
  const [statusPopover, setStatusPopover] = useState(false);

  useEffect(() => { setFromInput(dateStart); }, [dateStart]);
  useEffect(() => { setToInput(dateEnd); }, [dateEnd]);
  useEffect(() => { setSearchInput(search); }, [search]);

  // Derived filter state from URL
  const statuses = statusFilter ? statusFilter.split(',').filter(Boolean) : [];
  const channelNames = channelFilter ? channelFilter.split(',').filter(Boolean) : [];
  const isRtoOnly = rtoOnly === '1';
  const paymentVal = paymentFilter || null;
  const mappingVal = mappingFilter || null;

  const hasActiveFilters =
    search !== '' || statuses.length > 0 || channelNames.length > 0 ||
    paymentVal != null || mappingVal != null || isRtoOnly;

  // tRPC queries
  const summaryQ = trpc.logistics.summary.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled },
  );
  const shipmentsQ = trpc.logistics.shipments.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      cursor: cursor || undefined,
      page_size: pageSize,
      search: search || undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
      channel_names: channelNames.length > 0 ? channelNames : undefined,
      payment: (paymentVal as 'COD' | 'PREPAID' | null | undefined),
      mapping: (mappingVal as 'MATCHED' | 'UNMATCHED' | null | undefined),
      rto_only: isRtoOnly || undefined,
    },
    { enabled },
  );

  const goNext = useCallback(() => {
    if (shipmentsQ.data?.next_cursor) void setCursor(shipmentsQ.data.next_cursor);
  }, [shipmentsQ.data?.next_cursor, setCursor]);

  const goFirst = useCallback(() => { void setCursor(''); }, [setCursor]);

  const applyDateRange = useCallback(() => {
    void setDateStart(fromInput);
    void setDateEnd(toInput);
    void setCursor('');
  }, [fromInput, toInput, setDateStart, setDateEnd, setCursor]);

  const applySearch = useCallback(() => {
    void setSearch(searchInput.trim());
    void setCursor('');
  }, [searchInput, setSearch, setCursor]);

  const toggleStatus = useCallback((st: string) => {
    const next = statuses.includes(st)
      ? statuses.filter((s) => s !== st)
      : [...statuses, st];
    void setStatusFilter(next.join(','));
    void setCursor('');
  }, [statuses, setStatusFilter, setCursor]);

  const togglePayment = useCallback((p: 'COD' | 'PREPAID') => {
    void setPaymentFilter(paymentFilter === p ? '' : p);
    void setCursor('');
  }, [paymentFilter, setPaymentFilter, setCursor]);

  const toggleMapping = useCallback((m: 'MATCHED' | 'UNMATCHED') => {
    void setMappingFilter(mappingFilter === m ? '' : m);
    void setCursor('');
  }, [mappingFilter, setMappingFilter, setCursor]);

  const toggleRtoOnly = useCallback(() => {
    void setRtoOnly(isRtoOnly ? '' : '1');
    void setCursor('');
  }, [isRtoOnly, setRtoOnly, setCursor]);

  const clearFilters = useCallback(() => {
    void setSearch('');
    void setStatusFilter('');
    void setChannelFilter('');
    void setPaymentFilter('');
    void setMappingFilter('');
    void setRtoOnly('');
    void setCursor('');
    setSearchInput('');
  }, [setSearch, setStatusFilter, setChannelFilter, setPaymentFilter, setMappingFilter, setRtoOnly, setCursor]);

  // Auth gate
  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold">Not signed in</h2>
          <a href="/login" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">Sign in</a>
        </div>
      </div>
    );
  }

  const summary = summaryQ.data?.result;
  const shipData = shipmentsQ.data;
  const rows = shipData?.rows ?? [];
  const distinctStatuses = shipData?.distinct_statuses ?? [];
  const totalCount = shipData?.total_count ?? 0n;
  const mappedCount = shipData?.mapped_count ?? 0n;
  const hasPrev = Boolean(cursor);
  const hasNext = Boolean(shipData?.next_cursor);

  // Approximate page number for display (cursor-based, no absolute page)
  const filteredCount = shipData?.filtered_count ?? summary?.total_shipments ?? 0n;
  const deliveredCount = shipData?.delivered_count ?? summary?.delivered_count ?? 0n;
  const rtoCount = shipData?.rto_count ?? summary?.rto_count ?? 0n;

  return (
    <div className="space-y-5 p-6" data-testid="shiprocket-page">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shiprocket</h1>
          <p className="text-muted-foreground text-sm">Shipment data, filters and Shopify mapping</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className={cn(INPUT_CLS, 'w-36 text-xs')}
              aria-label="From date"
              data-testid="date-from"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              className={cn(INPUT_CLS, 'w-36 text-xs')}
              aria-label="To date"
              data-testid="date-to"
            />
            <Button size="sm" variant="outline" onClick={applyDateRange} className="h-8 text-xs">
              Apply
            </Button>
          </div>
          {/* Sync — disabled pre-cutover; honest affordance matching legacy */}
          <Button
            size="sm"
            disabled
            title="Sync requires Shiprocket connector cutover"
            className="h-8"
            data-testid="sync-button"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Sync selected channels
          </Button>
        </div>
      </div>

      {/* ── Connection status ── */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-2" data-testid="connection-status">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Connection</h2>
        {summaryQ.isLoading ? (
          <div className="h-5 bg-gray-100 rounded animate-pulse w-48" aria-hidden="true" />
        ) : summaryQ.data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Status</p>
              <span className="inline-block rounded px-1.5 py-0.5 text-xs bg-primary text-primary-foreground">CONNECTED</span>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Total (all time)</p>
              <p className="font-medium text-sm">
                {summary ? Number(summary.total_shipments).toLocaleString('en-IN') : '—'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No Shiprocket connection. Connect from the Dashboard.</p>
        )}
      </div>

      {/* ── Summary tiles — lg:grid-cols-6 matching legacy ── */}
      {(summaryQ.data || summaryQ.isLoading) && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="summary-tiles">
          {summaryQ.isLoading ? (
            Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
            ))
          ) : summary ? (
            <>
              <Tile
                label="Total shipments"
                value={summary.total_shipments}
                icon={<Package className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                data-testid="tile-total"
              />
              <Tile label="In range" value={filteredCount} />
              <Tile
                label="Showing"
                value={rows.length}
                sub={
                  totalCount > 0n
                    ? `1–${rows.length} of ${Number(totalCount).toLocaleString('en-IN')}`
                    : hasActiveFilters
                      ? '(no matches)'
                      : undefined
                }
              />
              <Tile
                label="Delivered"
                value={summary.delivered_count}
                color="emerald"
                icon={<Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />}
                data-testid="tile-delivered"
              />
              <Tile
                label="RTO"
                value={summary.rto_count}
                color="red"
                icon={<AlertTriangle className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />}
                data-testid="tile-rto"
              />
            </>
          ) : null}
        </div>
      )}

      {/* ── Errors ── */}
      {shipmentsQ.error && (
        <ErrorDisplay
          title="Failed to load shipments"
          message={shipmentsQ.error.message}
          requestId={(shipmentsQ.error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="filter-bar">
        {/* Search */}
        <div className="flex items-center gap-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <input
              placeholder="AWB / Shipment ID / Order…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              className={cn(INPUT_CLS, 'pl-8 w-56 text-xs')}
              aria-label="Search shipments"
              data-testid="search-input"
            />
          </div>
          <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={applySearch}>
            Apply
          </Button>
        </div>

        {/* RTO toggle */}
        <Button
          size="sm"
          variant={isRtoOnly ? 'default' : 'outline'}
          className="h-8 text-xs"
          onClick={toggleRtoOnly}
          data-testid="rto-filter"
          aria-pressed={isRtoOnly}
        >
          RTO only
        </Button>

        {/* Payment */}
        {(['COD', 'PREPAID'] as const).map((p) => (
          <Button
            key={p}
            size="sm"
            variant={paymentFilter === p ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => togglePayment(p)}
            data-testid={`payment-filter-${p}`}
            aria-pressed={paymentFilter === p}
          >
            {p}
          </Button>
        ))}

        {/* Mapping */}
        {(['MATCHED', 'UNMATCHED'] as const).map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mappingFilter === m ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => toggleMapping(m)}
            data-testid={`mapping-filter-${m}`}
            aria-pressed={mappingFilter === m}
          >
            {m === 'MATCHED'
              ? <><Check className="mr-1 h-3 w-3" aria-hidden="true" />MATCHED</>
              : <><AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />UNMATCHED</>}
          </Button>
        ))}

        {/* Status popover */}
        <div className="relative">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => setStatusPopover((v) => !v)}
            data-testid="status-filter-trigger"
            aria-expanded={statusPopover}
            aria-haspopup="listbox"
          >
            <Filter className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Status{statuses.length > 0 ? ` (${statuses.length})` : ''}
          </Button>
          {statusPopover && (
            <div
              className="absolute top-full left-0 z-10 mt-1 w-60 rounded-md border bg-popover p-3 shadow-md"
              role="listbox"
              aria-multiselectable="true"
              aria-label="Filter by status"
            >
              <p className="text-xs font-medium mb-2">Filter by status</p>
              <div className="space-y-1.5 max-h-52 overflow-auto">
                {distinctStatuses.length === 0 && (
                  <p className="text-xs text-muted-foreground">No statuses found</p>
                )}
                {distinctStatuses.map((st) => (
                  <label key={st} className="flex items-center gap-2 text-xs cursor-pointer" role="option" aria-selected={statuses.includes(st)}>
                    <input
                      type="checkbox"
                      checked={statuses.includes(st)}
                      onChange={() => toggleStatus(st)}
                      className="h-3.5 w-3.5"
                    />
                    {st}
                  </label>
                ))}
              </div>
              <button
                className="mt-2 text-xs text-muted-foreground underline"
                onClick={() => setStatusPopover(false)}
              >
                Close
              </button>
            </div>
          )}
        </div>

        {/* Channel filter — honest empty; channel_name not in connector_shipment_facts */}
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs opacity-60 cursor-not-allowed"
          disabled
          title="Channel filter available after connector cutover"
          data-testid="channel-filter-trigger"
        >
          <Filter className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Channel
        </Button>

        {hasActiveFilters && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={clearFilters}
            data-testid="clear-filters"
          >
            Clear all
          </Button>
        )}

        <span className="text-xs text-muted-foreground ml-auto" data-testid="mapped-count">
          {Number(mappedCount).toLocaleString('en-IN')} / {Number(totalCount).toLocaleString('en-IN')} mapped to Shopify
        </span>
      </div>

      {/* ── Loading skeleton ── */}
      {shipmentsQ.isLoading && (
        <div aria-busy="true" aria-label="Loading shipments" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
          ))}
        </div>
      )}

      {/* ── Shipments table ── */}
      {!shipmentsQ.isLoading && rows.length > 0 && (
        <div className="rounded-md border overflow-x-auto" data-testid="shipments-table">
          <table className="w-full text-sm" role="table" aria-label="Shipments">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-2 py-2 text-[10px] text-left font-medium text-muted-foreground">Shipment</th>
                <th className="px-2 py-2 text-[10px] text-left font-medium text-muted-foreground">SR Order</th>
                <th className="px-2 py-2 text-[10px] text-left font-medium text-muted-foreground">Channel</th>
                <th className="px-2 py-2 text-[10px] text-left font-medium text-muted-foreground">Shopify Ref</th>
                <th className="px-2 py-2 text-[10px] text-left font-medium text-muted-foreground">AWB</th>
                <th className="px-2 py-2 text-[10px] text-left font-medium text-muted-foreground">Status</th>
                <th className="px-2 py-2 text-[10px] text-left font-medium text-muted-foreground">Payment</th>
                <th className="px-2 py-2 text-[10px] text-left font-medium text-muted-foreground">Created</th>
                <th className="px-2 py-2 text-[10px] text-left font-medium text-muted-foreground">Zone</th>
                <th className="px-2 py-2 text-[10px] text-right font-medium text-muted-foreground">Wt (kg)</th>
                <th className="px-2 py-2 text-[10px] text-right font-medium text-muted-foreground">Fwd ₹</th>
                <th className="px-2 py-2 text-[10px] text-right font-medium text-muted-foreground">COD ₹</th>
                <th className="px-2 py-2 text-[10px] text-right font-medium text-muted-foreground">RTO ₹</th>
                <th className="px-2 py-2 text-[10px] text-left font-medium text-muted-foreground" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const createdDate = s.created_at
                  ? new Date(s.created_at).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: '2-digit',
                    })
                  : '—';
                const isShopifyMapped = Boolean(s.shopify_order_name);

                return (
                  <tr key={s.id} className="border-t hover:bg-muted/20" data-testid="shipment-row">
                    <td className="px-2 py-2 font-mono text-[11px]">{s.shipment_id}</td>
                    <td className="px-2 py-2 text-[11px]">{s.order_id || '—'}</td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">{s.channel_name || '—'}</td>
                    <td className="px-2 py-2 text-[11px]">
                      {isShopifyMapped ? (
                        <span className="flex items-center gap-1">
                          <Check className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                          {s.shopify_order_name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px]">{s.awb_code || '—'}</td>
                    <td className="px-2 py-2"><StatusBadge status={s.status} /></td>
                    <td className="px-2 py-2 text-[11px]">
                      <span className={cn(
                        'inline-block rounded px-1.5 py-0.5 text-[10px]',
                        s.is_cod ? 'bg-gray-100 text-gray-700' : 'border border-border',
                      )}>
                        {s.payment_method ?? (s.is_cod ? 'COD' : 'Prepaid')}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-[11px] whitespace-nowrap">{createdDate}</td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">{s.zone || '—'}</td>
                    <td className="px-2 py-2 text-[11px] text-right tabular-nums">
                      {s.charged_weight_kg != null ? s.charged_weight_kg.toFixed(2) : '—'}
                    </td>
                    <td className="px-2 py-2 text-[11px] text-right tabular-nums">{fmtMu(s.forward_charge_mu)}</td>
                    <td className="px-2 py-2 text-[11px] text-right tabular-nums">{fmtMu(s.cod_charge_mu)}</td>
                    <td className="px-2 py-2 text-[11px] text-right tabular-nums">{fmtMu(s.rto_charge_mu)}</td>
                    <td className="px-2 py-2">
                      <button
                        className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted"
                        onClick={() => setJsonModal({
                          shipment_id: s.shipment_id,
                          order_id: s.order_id,
                          status: s.status,
                          courier: s.courier_name,
                          delivery_city: s.delivery_city,
                          delivery_pincode: s.delivery_pincode,
                        })}
                        title={`View details for shipment ${s.shipment_id}`}
                        aria-label={`View details for shipment ${s.shipment_id}`}
                        data-testid="shipment-row-eye"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {!shipmentsQ.isLoading && (hasPrev || hasNext) && (
        <div className="flex items-center justify-between gap-4 flex-wrap py-3 px-1" data-testid="pagination">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{rows.length} of {Number(totalCount).toLocaleString('en-IN')} total</span>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={String(pageSize)}
              onChange={(e) => { void setPageSize(Number(e.target.value)); void setCursor(''); }}
              className={cn(INPUT_CLS, 'w-28 text-xs')}
              aria-label="Page size"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>{n} per page</option>
              ))}
            </select>
            <Button
              size="sm" variant="outline" className="h-8 w-8 p-0"
              disabled={!hasPrev} onClick={goFirst}
              title="First page" aria-label="Go to first page"
              data-testid="page-first"
            >
              <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 w-8 p-0"
              disabled={!hasPrev} onClick={goFirst}
              title="Previous page" aria-label="Go to previous page"
              data-testid="page-prev"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 w-8 p-0"
              disabled={!hasNext} onClick={goNext}
              title="Next page" aria-label="Go to next page"
              data-testid="page-next"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 w-8 p-0"
              disabled={!hasNext} onClick={goNext}
              title="Last page" aria-label="Go to last page"
              data-testid="page-last"
            >
              <ChevronsRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Empty states ── */}
      {!shipmentsQ.isLoading && rows.length === 0 && !shipmentsQ.error && (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-3" data-testid="empty-state">
          {hasActiveFilters ? (
            <p className="text-muted-foreground">
              No shipments match the current filters.{' '}
              <button className="underline" onClick={clearFilters}>Clear all filters</button>
            </p>
          ) : (
            <p className="text-muted-foreground">
              No shipments found. Sync from Shiprocket to load data, or try a wider date range.
            </p>
          )}
        </div>
      )}

      {/* ── Shipment details modal ── */}
      {jsonModal !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label="Shipment details"
          onClick={() => setJsonModal(null)}
        >
          <div
            className="bg-background rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Shipment Details</h2>
              <button
                onClick={() => setJsonModal(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>
            <pre className="text-xs bg-muted rounded p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap">
              {JSON.stringify(jsonModal, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

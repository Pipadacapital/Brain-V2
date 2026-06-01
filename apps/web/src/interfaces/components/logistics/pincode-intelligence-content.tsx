'use client';

// @paradigm: sql
// PincodeIntelligenceContent — /pincode-intelligence (parity-38 restoration).
// Restores 5 dropped columns: State, Orders (shipments), Revenue, Unique Customers,
// Top Courier. Adds filters: State, Min orders, High COD.
// Tier/State/Top Courier are COMPUTED in the data plane (not stubbed).
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.logistics.pincode.

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsString, parseAsBoolean, parseAsInteger } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent, formatScore } from '@/interfaces/components/logistics/format-bp.js';

type SortKey =
  | 'pincode' | 'city' | 'state' | 'shipment_count' | 'rto_rate_bp'
  | 'cod_rate_bp' | 'delivered_rate_bp' | 'tier' | 'unique_customers'
  | 'repeat_rate_bp' | 'reliability_score';

/** RAG-color for reliability score (centi-points 0..10000 → 0..100). */
function scoreColor(cp: number): string {
  const pct = cp / 100;
  if (pct >= 70) return 'text-green-700 font-semibold';
  if (pct >= 40) return 'text-amber-700 font-semibold';
  return 'text-red-700 font-semibold';
}

/** RTO % — conditional color (not unconditionally red). */
function rtoColor(bp: number | null): string {
  if (bp === null) return '';
  if (bp >= 2000) return 'text-red-600';  // ≥20%
  if (bp >= 1000) return 'text-amber-600'; // ≥10%
  return '';
}

/** Sortable th that toggles asc/desc. */
function SortTh({
  label, sortKey, current, dir, onSort, align = 'right',
}: {
  label: string;
  sortKey: SortKey;
  current: string;
  dir: string;
  onSort: (k: SortKey, d: string) => void;
  align?: 'left' | 'right';
}) {
  const active = current === sortKey;
  const nextDir = active && dir === 'asc' ? 'desc' : 'asc';
  return (
    <th
      className={`pb-2 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-800 select-none ${align === 'left' ? 'text-left' : 'text-right'}`}
      onClick={() => onSort(sortKey, nextDir)}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      data-testid={`sort-${sortKey}`}
    >
      {label}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );
}

export function PincodeIntelligenceContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd, setDateEnd]     = useQueryState('to',   parseAsString.withDefault(DEFAULT_DATE_END));
  const [search, setSearch]       = useQueryState('q',    parseAsString.withDefault(''));
  const [stateFilter, setStateFilter] = useQueryState('state', parseAsString.withDefault(''));
  const [minOrders, setMinOrders] = useQueryState('min_orders', parseAsInteger.withDefault(0));
  const [highRto, setHighRto]     = useQueryState('high_rto', parseAsBoolean.withDefault(false));
  const [highCod, setHighCod]     = useQueryState('high_cod', parseAsBoolean.withDefault(false));
  const [sortKey, setSortKey]     = useQueryState('sort', parseAsString.withDefault('reliability_score'));
  const [sortDir, setSortDir]     = useQueryState('dir',  parseAsString.withDefault('desc'));

  const enabled = Boolean(isAuthenticated && workspaceId);

  const { data, isLoading, error } = trpc.logistics.pincode.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      search: search || undefined,
      state: stateFilter || undefined,
      min_orders: minOrders || undefined,
      high_rto: highRto || undefined,
      high_cod: highCod || undefined,
      sort: sortKey,
      order: sortDir as 'asc' | 'desc',
    },
    { enabled },
  );

  const handleSort = (k: SortKey, d: string) => {
    void setSortKey(k);
    void setSortDir(d);
  };

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Pincode Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Delivery pincode view: orders, revenue, RTO&nbsp;%, COD&nbsp;%, delivered&nbsp;% by area.
            Pincode / city / state from Shiprocket; revenue from matched Shopify orders.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="pin-from" className="sr-only">From date</label>
          <input
            id="pin-from"
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
          />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="pin-to" className="sr-only">To date</label>
          <input
            id="pin-to"
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <label htmlFor="pin-search" className="sr-only">Search pincode / city / state</label>
        <input
          id="pin-search"
          type="search"
          placeholder="Search pincode, city, or state"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground w-60"
          data-testid="pin-search"
        />

        <label htmlFor="pin-state" className="sr-only">Filter by state</label>
        <input
          id="pin-state"
          type="text"
          placeholder="State"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground w-36"
          data-testid="pin-state-filter"
        />

        <label htmlFor="pin-min-orders" className="sr-only">Minimum orders</label>
        <input
          id="pin-min-orders"
          type="number"
          min={0}
          placeholder="Min orders"
          value={minOrders || ''}
          onChange={(e) => setMinOrders(parseInt(e.target.value, 10) || 0)}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground w-28"
          data-testid="pin-min-orders"
        />

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={highRto}
            onChange={(e) => setHighRto(e.target.checked)}
            className="rounded border-border"
            data-testid="high-rto-filter"
          />
          High RTO (&ge;20%)
        </label>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={highCod}
            onChange={(e) => setHighCod(e.target.checked)}
            className="rounded border-border"
            data-testid="high-cod-filter"
          />
          High COD (&ge;50%)
        </label>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div aria-busy="true" aria-label="Loading pincode intelligence" className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {/* Error */}
      {error && (
        <ErrorDisplay
          title="Failed to load pincode intelligence"
          message={error.message}
          requestId={(error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {/* Table */}
      {data && (
        <section className="bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto" aria-label="Pincode intelligence table">
          <div className="sr-only">
            Data as of {new Date(data.data_epoch).toISOString()}. Request ID: {data.request_id}.
            {String(data.total_shipments)} total shipments.
          </div>

          <table className="w-full min-w-[1200px]" data-testid="pincode-table">
            <thead>
              <tr>
                <SortTh label="Pincode"   sortKey="pincode"          current={sortKey} dir={sortDir} onSort={handleSort} align="left" />
                <SortTh label="City"      sortKey="city"             current={sortKey} dir={sortDir} onSort={handleSort} align="left" />
                <SortTh label="State"     sortKey="state"            current={sortKey} dir={sortDir} onSort={handleSort} align="left" />
                <SortTh label="Orders"    sortKey="shipment_count"   current={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Revenue</th>
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">AOV</th>
                <SortTh label="RTO %"     sortKey="rto_rate_bp"      current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="COD %"     sortKey="cod_rate_bp"      current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Delivered %" sortKey="delivered_rate_bp" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Tier"      sortKey="tier"             current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Uniq. Customers" sortKey="unique_customers" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Repeat %"  sortKey="repeat_rate_bp"   current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Score"     sortKey="reliability_score" current={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="pb-2 text-xs font-medium text-gray-500 text-right">Top Courier</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.pincode} className="border-t border-gray-100 hover:bg-gray-50" data-testid={`pin-row-${r.pincode}`}>
                  <td className="py-2 text-sm text-left">{r.pincode}</td>
                  <td className="py-2 text-sm text-left">{r.city || '—'}</td>
                  <td className="py-2 text-sm text-left" data-testid={`state-${r.pincode}`}>{r.state || '—'}</td>
                  <td className="py-2 text-sm tabular-nums text-right">{String(r.shipment_count)}</td>
                  <td className="py-2 text-sm tabular-nums text-right" data-testid={`revenue-${r.pincode}`}>
                    {r.revenue_mu !== undefined && r.revenue_mu > 0n ? formatMoney(r.revenue_mu, 'INR') : '—'}
                  </td>
                  <td className="py-2 text-sm tabular-nums text-right">
                    {r.aov_mu !== null ? formatMoney(r.aov_mu, 'INR') : '—'}
                  </td>
                  <td className={`py-2 text-sm tabular-nums text-right ${rtoColor(r.rto_rate_bp)}`}>
                    {formatBpPercent(r.rto_rate_bp)}
                  </td>
                  <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(r.cod_rate_bp)}</td>
                  <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(r.delivered_rate_bp)}</td>
                  <td className="py-2 text-sm tabular-nums text-right" data-testid={`tier-${r.pincode}`}>
                    {r.tier !== null ? `T${r.tier}` : '—'}
                  </td>
                  <td className="py-2 text-sm tabular-nums text-right" data-testid={`unique-customers-${r.pincode}`}>
                    {r.unique_customers > 0n ? String(r.unique_customers) : '—'}
                  </td>
                  <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(r.repeat_rate_bp)}</td>
                  <td className={`py-2 text-sm tabular-nums text-right ${scoreColor(r.reliability_score)}`}>
                    {formatScore(r.reliability_score)}
                  </td>
                  <td className="py-2 text-sm text-right" data-testid={`top-courier-${r.pincode}`}>
                    {r.top_courier || '—'}
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={14} className="py-6 text-center text-sm text-gray-400">
                    No pincodes match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <p className="mt-4 text-xs text-gray-400">
            Score (0–100) penalizes RTO and COD load, rewards delivery rate. Higher = safer destination.
            State from pincode prefix. Tier from city classification (T1 = metro, T2 = large city, T3 = other).
            Revenue and unique customers are honest "—" when matched-order data is unavailable locally.
          </p>
        </section>
      )}
    </div>
  );
}

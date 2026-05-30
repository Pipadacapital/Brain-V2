'use client';

// @paradigm: sql
// TimingsContent — the /timings page (Phase-2 slice-8, READ/ANALYTICS ONLY).
// Parity restore (audit-v2 row 42): 9-column table, group-by selector (product/variant/
// vendor/productType), per-group drill-down filter, text search, client-side sort on
// all 9 columns, CSV export, share-to-clipboard, ~2-year default window.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from trpc.lifecycle.timings.
// 🚨 COMPLIANCE: the reactivation window is a RECOMMENDATION, never a send trigger.

import { useState, useMemo, useCallback } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/interfaces/components/ui/select.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { ArrowUp, ArrowDown, ArrowUpDown, Download, Share2, Clock } from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function subDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toIsoDate(d);
}

const DEFAULT_FROM = subDaysFromNow(729);
const DEFAULT_TO = toIsoDate(new Date());

const GROUP_BY_OPTIONS = [
  { value: 'product', label: 'Product', plural: 'products' },
  { value: 'variant', label: 'Variant', plural: 'variants' },
  { value: 'vendor', label: 'Vendor', plural: 'vendors' },
  { value: 'productType', label: 'Product Type', plural: 'product types' },
] as const;

type GroupByVal = (typeof GROUP_BY_OPTIONS)[number]['value'];
type MetricVal = 'median' | 'mean';

type SortKey =
  | 'label' | 'first_orders' | 'second_orders_bp' | 'third_orders_bp' | 'fourth_orders_bp'
  | 'days_1to2' | 'days_2to3' | 'days_3to4' | 'reactivation_window_days';

interface TimingsRowShape {
  group_id: string;
  label: string;
  group_by: string;
  first_orders: bigint;
  second_orders_bp: number;
  third_orders_bp: number;
  fourth_orders_bp: number;
  days_1to2: number | null;
  days_2to3: number | null;
  days_3to4: number | null;
  reactivation_window_days: number | null;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/** Format bp percentage to 2 decimal places (round, not floor) matching legacy toFixed(2). */
function fmtBpPct(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`;
}

/** Format gap days with one decimal and optional ~ prefix matching legacy formatDays. */
function fmtDays(d: number | null, approximate = false): string {
  if (d === null || d === undefined) return '—';
  return `${approximate ? '~' : ''}${d.toFixed(1)} days`;
}

/** Format first_orders count with thousands grouping matching legacy toLocaleString(). */
function fmtCount(n: bigint): string {
  return n.toLocaleString('en-IN');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TimingsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // URL state
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_FROM));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault(DEFAULT_TO));
  const [metric, setMetric] = useQueryState('metric', parseAsString.withDefault('median'));
  const [groupBy, setGroupBy] = useQueryState('groupBy', parseAsString.withDefault('product'));
  const [groupFilter, setGroupFilter] = useQueryState('groupId', parseAsString.withDefault(''));

  // Local state
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('first_orders');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.lifecycle.timings.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      metric: metric === 'mean' ? 'mean' : 'median',
      group_by: groupBy as GroupByVal,
    },
    { enabled },
  );

  const handleGroupByChange = useCallback((v: string) => {
    setGroupBy(v);
    setGroupFilter('');
  }, [setGroupBy, setGroupFilter]);

  const handleSort = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'label' ? 'asc' : 'desc');
    }
  }, [sortKey]);

  const groups = q.data?.groups ?? [];
  const groupByLabel = GROUP_BY_OPTIONS.find((g) => g.value === groupBy)?.label ?? 'Product';
  const groupByPlural = GROUP_BY_OPTIONS.find((g) => g.value === groupBy)?.plural ?? 'products';

  const filteredGroups = useMemo(() => {
    let list = groups as TimingsRowShape[];
    if (groupFilter) list = list.filter((g) => g.group_id === groupFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((g) => g.label.toLowerCase().includes(q));
    }
    return list;
  }, [groups, groupFilter, search]);

  const sortedGroups = useMemo(() => {
    return [...filteredGroups].sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'label': diff = a.label.localeCompare(b.label); break;
        case 'first_orders': diff = Number(a.first_orders - b.first_orders); break;
        case 'second_orders_bp': diff = a.second_orders_bp - b.second_orders_bp; break;
        case 'third_orders_bp': diff = a.third_orders_bp - b.third_orders_bp; break;
        case 'fourth_orders_bp': diff = a.fourth_orders_bp - b.fourth_orders_bp; break;
        case 'days_1to2': diff = (a.days_1to2 ?? -1) - (b.days_1to2 ?? -1); break;
        case 'days_2to3': diff = (a.days_2to3 ?? -1) - (b.days_2to3 ?? -1); break;
        case 'days_3to4': diff = (a.days_3to4 ?? -1) - (b.days_3to4 ?? -1); break;
        case 'reactivation_window_days': diff = (a.reactivation_window_days ?? -1) - (b.reactivation_window_days ?? -1); break;
      }
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [filteredGroups, sortKey, sortDir]);

  const handleExport = useCallback(() => {
    const headers = [
      groupByLabel, '1st Orders', '2nd Orders %', '3rd Orders %', '4th Orders %',
      '1 → 2 (days)', '2 → 3 (days)', '3 → 4 (days)', 'Reactivation 80% of 1→2 (days)',
    ];
    const csvRows = sortedGroups.map((g) => [
      JSON.stringify(g.label),
      Number(g.first_orders),
      (g.second_orders_bp / 100).toFixed(2),
      (g.third_orders_bp / 100).toFixed(2),
      (g.fourth_orders_bp / 100).toFixed(2),
      g.days_1to2?.toFixed(1) ?? '',
      g.days_2to3?.toFixed(1) ?? '',
      g.days_3to4?.toFixed(1) ?? '',
      g.reactivation_window_days?.toFixed(1) ?? '',
    ]);
    const csv = [headers.join(','), ...csvRows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `time-between-orders-${dateStart}-${dateEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedGroups, groupByLabel, dateStart, dateEnd]);

  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // no-op if clipboard unavailable
    }
  }, []);

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

  const summary = q.data?.summary;
  const currentMetric = (metric === 'mean' ? 'Mean' : 'Median');

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Clock className="h-6 w-6 text-[#96bf48]" aria-hidden="true" />
          Time Between Orders
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">inter-order intervals, repeat rates &amp; reactivation timing</p>
      </div>

      {/* Date + metric controls */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="tm-from" className="sr-only">From date</label>
        <input
          id="tm-from"
          type="date"
          value={dateStart}
          onChange={(e) => setDateStart(e.target.value)}
          className="h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground"
        />
        <span className="text-muted-foreground text-sm" aria-hidden="true">to</span>
        <label htmlFor="tm-to" className="sr-only">To date</label>
        <input
          id="tm-to"
          type="date"
          value={dateEnd}
          onChange={(e) => setDateEnd(e.target.value)}
          className="h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground"
        />

        {/* Preset buttons */}
        {([
          { label: '7D', days: 7 },
          { label: '30D', days: 30 },
          { label: '90D', days: 90 },
          { label: '1Y', days: 365 },
          { label: '2Y', days: 729 },
        ] as const).map((p) => (
          <Button
            key={p.label}
            variant="outline"
            size="sm"
            onClick={() => {
              setDateStart(subDaysFromNow(p.days));
              setDateEnd(toIsoDate(new Date()));
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Loading */}
      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading timings" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-9 bg-muted rounded animate-pulse" aria-hidden="true" />
          ))}
        </div>
      )}

      {/* Error */}
      {q.error && (
        <ErrorDisplay
          title="Failed to load timings"
          message={q.error.message}
          requestId={(q.error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {summary && (
        <>
          <div className="sr-only">
            Data as of {q.data ? new Date(q.data.data_epoch).toISOString() : ''}. Request ID: {q.data?.request_id}
          </div>

          {/* Summary cards — 8-up grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            <SummaryCard label="1st Orders" value={fmtCount(summary.first_orders)} />
            <SummaryCard label="2nd Orders" value={fmtBpPct(summary.second_orders_bp)} />
            <SummaryCard label="3rd Orders" value={fmtBpPct(summary.third_orders_bp)} />
            <SummaryCard label="4th Orders" value={fmtBpPct(summary.fourth_orders_bp)} />
            <SummaryCard label={`1 → 2 (${currentMetric})`} value={fmtDays(summary.days_1to2)} highlight />
            <SummaryCard label={`2 → 3 (${currentMetric})`} value={fmtDays(summary.days_2to3)} highlight />
            <SummaryCard label={`3 → 4 (${currentMetric})`} value={fmtDays(summary.days_3to4)} highlight />
            <SummaryCard
              label="Recommended reactivation"
              value={fmtDays(summary.reactivation_window_days, true)}
              sub="80% of 1→2 to catch before churn"
              highlight
            />
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Group by */}
            <Select value={groupBy} onValueChange={handleGroupByChange}>
              <SelectTrigger className="w-[160px]" aria-label="Group by">
                <SelectValue placeholder="Group by" />
              </SelectTrigger>
              <SelectContent>
                {GROUP_BY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Per-group drill-down filter */}
            <Select
              value={groupFilter || '__all__'}
              onValueChange={(v) => setGroupFilter(v === '__all__' ? '' : v)}
            >
              <SelectTrigger className="w-[200px]" aria-label={`Filter by ${groupByLabel}`}>
                <SelectValue placeholder={`All ${groupByPlural}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All {groupByPlural}</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.group_id} value={g.group_id}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Metric toggle */}
            <div className="flex border rounded-md overflow-hidden" role="group" aria-label="Metric">
              {(['median', 'mean'] as MetricVal[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`px-3 py-1.5 text-sm border-r last:border-r-0 transition-colors ${metric === m ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-muted'}`}
                  onClick={() => setMetric(m)}
                  aria-pressed={metric === m}
                >
                  {m === 'median' ? 'Median' : 'Mean'}
                </button>
              ))}
            </div>

            <Button variant="outline" size="icon" onClick={handleExport} aria-label="Export CSV">
              <Download className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="outline" size="icon" onClick={handleShare} aria-label="Copy link">
              <Share2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {/* Search */}
          <Input
            placeholder={`Search ${groupByPlural}…`}
            className="max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={`Search ${groupByPlural}`}
          />

          {/* 9-column group table */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="[&_tr]:border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <ColSort label={groupByLabel} sortKey="label" current={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <ColSort label="1st Orders" sortKey="first_orders" current={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <ColSort label="2nd Orders %" sortKey="second_orders_bp" current={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <ColSort label="3rd Orders %" sortKey="third_orders_bp" current={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <ColSort label="4th Orders %" sortKey="fourth_orders_bp" current={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <ColSort label="1 → 2" sortKey="days_1to2" current={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <ColSort label="2 → 3" sortKey="days_2to3" current={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <ColSort label="3 → 4" sortKey="days_3to4" current={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <ColSort label="Reactivation (80% of 1→2)" sortKey="reactivation_window_days" current={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGroups.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="h-24 text-center text-muted-foreground">
                        No {groupByPlural} found.
                      </td>
                    </tr>
                  ) : sortedGroups.map((row) => (
                    <tr key={row.group_id} className="border-b transition-colors hover:bg-muted/50">
                      <td className="px-4 py-2 font-medium">{row.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtCount(row.first_orders)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtBpPct(row.second_orders_bp)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtBpPct(row.third_orders_bp)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtBpPct(row.fourth_orders_bp)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtDays(row.days_1to2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtDays(row.days_2to3)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtDays(row.days_3to4)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtDays(row.reactivation_window_days, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Reactivation window = 0.8 × the typical 1→2 interval — the recommended re-engagement timing. This is a recommendation only; Brain does not send.
          </p>
        </>
      )}

      {!q.isLoading && !q.error && !summary && (
        <p className="text-sm text-muted-foreground py-4">
          No timings data for the selected date range. Ensure your store is connected and has order data with repeat customers.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label, value, sub, highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  const base = 'rounded-lg border p-4';
  const cls = highlight
    ? `${base} bg-[#96bf48]/10 border-[#96bf48]/30`
    : `${base} bg-muted/30`;
  return (
    <div className={cls}>
      <p className={`text-xs uppercase tracking-wider font-medium ${highlight ? 'text-[#96bf48]' : 'text-muted-foreground'}`}>
        {label}
      </p>
      {sub && <p className="text-[10px] text-[#96bf48]/80 mt-0.5">{sub}</p>}
      <p className={`text-xl font-semibold mt-0.5 tabular-nums ${highlight ? 'text-[#96bf48]' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function ColSort({
  label, sortKey, current, dir, onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
}) {
  const isActive = current === sortKey;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label}`}
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

'use client';

// @paradigm: sql
// StoreOrdersTable — the Orders tab on /store. Paginated table backed by
// trpc.store.orders. Columns: Order / Customer ref / Total / Payment /
// Fulfillment / COD / Date. Search + status + COD filters; URL-synced.

import { useEffect, useState } from 'react';
import { useQueryState, parseAsString, parseAsInteger, parseAsStringEnum } from 'nuqs';
import { Loader2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { cn } from '@/lib/utils.js';

const INPUT_CLS =
  'px-2 py-1.5 border border-input bg-background rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const STATUS = ['all', 'paid', 'pending', 'refunded', 'voided', 'partially_refunded'] as const;
const COD    = ['all', 'cod', 'prepaid'] as const;

export function StoreOrdersTable() {
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceId     = useAppSelector((s) => s.session.workspaceId);

  const [search, setSearch] = useQueryState('q',      parseAsString.withDefault(''));
  const [status, setStatus] = useQueryState('status', parseAsStringEnum<typeof STATUS[number]>([...STATUS]).withDefault('all'));
  const [cod, setCod]       = useQueryState('cod',    parseAsStringEnum<typeof COD[number]>([...COD]).withDefault('all'));
  const [page, setPage]     = useQueryState('opage',  parseAsInteger.withDefault(1));
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    const t = setTimeout(() => { if (searchInput !== search) { setSearch(searchInput || null); setPage(1); } }, 350);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const enabled = Boolean(isAuthenticated && workspaceId);
  const { data, isLoading, error } = trpc.store.orders.useQuery(
    { search: search || undefined, status, cod, page, pageSize: 25 },
    { enabled },
  );

  if (error) return <ErrorDisplay title="Couldn't load orders" message={error.message} />;

  const total = data?.total ?? 0;
  const rows  = data?.rows ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text" placeholder="Search order #…" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={cn(INPUT_CLS, 'pl-9 w-64')}
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as typeof STATUS[number]); setPage(1); }}
          className={cn(INPUT_CLS, 'w-44')}
        >
          {STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select
          value={cod}
          onChange={(e) => { setCod(e.target.value as typeof COD[number]); setPage(1); }}
          className={cn(INPUT_CLS, 'w-32')}
        >
          {COD.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="ml-auto text-sm text-muted-foreground">
          {isLoading ? 'Loading…' : `${total.toLocaleString()} order${total !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Order</th>
              <th className="px-3 py-2 text-left font-medium">Customer ref</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-left font-medium">Payment</th>
              <th className="px-3 py-2 text-left font-medium">Fulfillment</th>
              <th className="px-3 py-2 text-left font-medium">COD</th>
              <th className="px-3 py-2 text-left font-medium">Pincode</th>
              <th className="px-3 py-2 text-right font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="py-12 text-center"><Loader2 className="inline h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">No orders match the filters.</td></tr>
            ) : rows.map((o) => (
              <tr key={o.id} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-mono text-xs">{o.orderNumber ?? o.vendorOrderId}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {o.customerRef ? `${o.customerRef.slice(0, 12)}…` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(BigInt(o.totalMu), o.currencyCode || 'INR')}
                </td>
                <td className="px-3 py-2">
                  <span className={cn(
                    'inline-block rounded px-1.5 py-0.5 text-xs',
                    o.financialStatus === 'paid'      && 'bg-emerald-100 text-emerald-900',
                    o.financialStatus === 'refunded'  && 'bg-amber-100 text-amber-900',
                    o.financialStatus === 'voided'    && 'bg-red-100 text-red-900',
                    !o.financialStatus               && 'bg-muted',
                  )}>{o.financialStatus || '—'}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{o.fulfillmentStatus || '—'}</td>
                <td className="px-3 py-2">{o.isCod ? 'COD' : 'Prepaid'}</td>
                <td className="px-3 py-2 text-muted-foreground">{o.deliveryPincode ?? '—'}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {new Date(o.processedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

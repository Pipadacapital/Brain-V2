'use client';

// @paradigm: sql
// StoreProductsTable — the Products tab on /store. Read-only browser
// (Image / Title / Type / Vendor / Status / Inventory / COGS).
// Editing COGS happens on the dedicated /product-cogs page.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryState, parseAsString, parseAsInteger, parseAsStringEnum } from 'nuqs';
import { Loader2, ChevronLeft, ChevronRight, Search, ExternalLink } from 'lucide-react';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { cn } from '@/lib/utils.js';

const INPUT_CLS =
  'px-2 py-1.5 border border-input bg-background rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const STATUS = ['all', 'ACTIVE', 'DRAFT', 'ARCHIVED'] as const;

export function StoreProductsTable() {
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceId     = useAppSelector((s) => s.session.workspaceId);

  const [search, setSearch] = useQueryState('q',      parseAsString.withDefault(''));
  const [status, setStatus] = useQueryState('status', parseAsStringEnum<typeof STATUS[number]>([...STATUS]).withDefault('all'));
  const [page, setPage]     = useQueryState('ppage',  parseAsInteger.withDefault(1));
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    const t = setTimeout(() => { if (searchInput !== search) { setSearch(searchInput || null); setPage(1); } }, 350);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const enabled = Boolean(isAuthenticated && workspaceId);
  const { data, isLoading, error } = trpc.store.productsTable.useQuery(
    { search: search || undefined, status, page, pageSize: 25 },
    { enabled },
  );

  if (error) return <ErrorDisplay title="Couldn't load products" message={error.message} />;

  const total = data?.total ?? 0;
  const rows  = data?.rows ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text" placeholder="Search title / handle / type…" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={cn(INPUT_CLS, 'pl-9 w-72')}
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as typeof STATUS[number]); setPage(1); }}
          className={cn(INPUT_CLS, 'w-40')}
        >
          {STATUS.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.toLowerCase()}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {isLoading ? 'Loading…' : `${total.toLocaleString()} product${total !== 1 ? 's' : ''}`}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href="/product-cogs">
              Edit COGS<ExternalLink className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-16">Image</th>
              <th className="px-3 py-2 text-left font-medium">Product</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Vendor</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Inventory</th>
              <th className="px-3 py-2 text-right font-medium">COGS</th>
              <th className="px-3 py-2 text-right font-medium">MRP</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="py-12 text-center"><Loader2 className="inline h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">No products match the filters.</td></tr>
            ) : rows.map((p) => (
              <tr key={p.id} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2">
                  <div className="h-10 w-10 rounded bg-muted overflow-hidden">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" className="h-10 w-10 object-cover" />
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium">{p.title}</p>
                  <p className="text-xs text-muted-foreground">{p.handle || p.vendorProductId}</p>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{p.productType ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.vendor}</td>
                <td className="px-3 py-2">
                  <span className={cn(
                    'inline-block rounded px-1.5 py-0.5 text-xs',
                    p.status === 'ACTIVE'   && 'bg-emerald-100 text-emerald-900',
                    p.status === 'DRAFT'    && 'bg-amber-100 text-amber-900',
                    p.status === 'ARCHIVED' && 'bg-muted text-muted-foreground',
                  )}>{p.status || '—'}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {p.inventoryQty == null ? '—' : p.inventoryQty.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {p.costMu === '0' ? '—' : formatMoney(BigInt(p.costMu), 'INR')}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {p.mrpMu === '0' ? '—' : formatMoney(BigInt(p.mrpMu), 'INR')}
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

'use client';

// @paradigm: sql
// StoreCustomersTable — the Customers tab on /store. DPDP posture: PII
// (email/name/phone) sits AES-GCM encrypted in customer_pii; this list
// shows aggregates + "has email / has name" flags. The legacy app stored
// PII plaintext — we explicitly do NOT regress to that. A separate
// audited "reveal one customer" flow is deferred.

import { useEffect, useState } from 'react';
import { useQueryState, parseAsString, parseAsInteger, parseAsStringEnum } from 'nuqs';
import { Loader2, ChevronLeft, ChevronRight, Search, Mail, User, Phone } from 'lucide-react';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { cn } from '@/lib/utils.js';

const INPUT_CLS =
  'px-2 py-1.5 border border-input bg-background rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const CONSENT = ['all', 'opted_in', 'opted_out', 'unknown'] as const;

export function StoreCustomersTable() {
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceId     = useAppSelector((s) => s.session.workspaceId);

  const [search, setSearch]       = useQueryState('q',     parseAsString.withDefault(''));
  const [minOrders, setMinOrders] = useQueryState('min',   parseAsInteger.withDefault(0));
  const [consent, setConsent]     = useQueryState('csnt',  parseAsStringEnum<typeof CONSENT[number]>([...CONSENT]).withDefault('all'));
  // Keyset cursor stack: [null] = first page; Next pushes the server's nextCursor, Prev pops.
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1] ?? undefined;
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    const t = setTimeout(() => { if (searchInput !== search) { setSearch(searchInput || null); setCursorStack([null]); } }, 350);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const enabled = Boolean(isAuthenticated && workspaceId);
  const PAGE_SIZE = 25;
  const { data, isLoading, error } = trpc.store.customers.useQuery(
    { search: search || undefined, minOrders: minOrders > 0 ? minOrders : undefined, consent, cursor, pageSize: PAGE_SIZE },
    { enabled },
  );

  if (error) return <ErrorDisplay title="Couldn't load customers" message={error.message} />;

  const total = data?.total ?? 0;
  const rows  = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageNum = cursorStack.length;            // 1-based: stack depth
  const nextCursor = data?.nextCursor ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text" placeholder="Search vendor / customer ref…" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={cn(INPUT_CLS, 'pl-9 w-72')}
          />
        </div>
        <label className="text-sm text-muted-foreground flex items-center gap-1">
          Min orders
          <input
            type="number" min={0} value={minOrders}
            onChange={(e) => { setMinOrders(Number(e.target.value) || 0); setCursorStack([null]); }}
            className={cn(INPUT_CLS, 'w-20')}
          />
        </label>
        <select
          value={consent}
          onChange={(e) => { setConsent(e.target.value as typeof CONSENT[number]); setCursorStack([null]); }}
          className={cn(INPUT_CLS, 'w-36')}
        >
          {CONSENT.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
        <div className="ml-auto text-sm text-muted-foreground">
          {isLoading ? 'Loading…' : `${total.toLocaleString()} customer${total !== 1 ? 's' : ''}`}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Email / name / phone are AES-GCM encrypted (DPDP-aligned). Icons below indicate which fields exist; revealing PII is a separate audited operation.
      </p>

      <div className="rounded-xl border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Customer ref</th>
              <th className="px-3 py-2 text-left font-medium">Vendor</th>
              <th className="px-3 py-2 text-right font-medium">Orders</th>
              <th className="px-3 py-2 text-right font-medium">Lifetime spent</th>
              <th className="px-3 py-2 text-left font-medium">PII held</th>
              <th className="px-3 py-2 text-left font-medium">Consent</th>
              <th className="px-3 py-2 text-right font-medium">First seen</th>
              <th className="px-3 py-2 text-right font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="py-12 text-center"><Loader2 className="inline h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">No customers match the filters.</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 font-mono text-xs">{c.customerRef.slice(0, 16)}…</td>
                <td className="px-3 py-2 text-muted-foreground">{c.vendor}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.ordersCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(BigInt(c.lifetimeSpentMu), c.currencyCode || 'INR')}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    {c.hasEmail && <Mail   className="h-3.5 w-3.5 text-muted-foreground" aria-label="Email held" />}
                    {c.hasName  && <User   className="h-3.5 w-3.5 text-muted-foreground" aria-label="Name held" />}
                    {c.hasPhone && <Phone  className="h-3.5 w-3.5 text-muted-foreground" aria-label="Phone held" />}
                    {!c.hasEmail && !c.hasName && !c.hasPhone && <span className="text-xs text-muted-foreground">none</span>}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={cn(
                    'inline-block rounded px-1.5 py-0.5 text-xs',
                    c.consentStatus === 'opted_in'  && 'bg-emerald-100 text-emerald-900',
                    c.consentStatus === 'opted_out' && 'bg-red-100 text-red-900',
                    c.consentStatus === 'unknown'   && 'bg-muted text-muted-foreground',
                  )}>{c.consentStatus.replace('_', ' ')}</span>
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {c.firstSeenAt ? new Date(c.firstSeenAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(nextCursor || pageNum > 1) && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {pageNum} of {totalPages}</p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={pageNum <= 1} onClick={() => setCursorStack((s) => s.slice(0, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={!nextCursor} onClick={() => setCursorStack((s) => [...s, nextCursor])}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

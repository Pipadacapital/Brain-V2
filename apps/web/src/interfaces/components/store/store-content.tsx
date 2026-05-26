'use client';

// @paradigm: sql
// StoreContent — the /store page. Slice 4 of the parity epic: legacy
// store-content.tsx (233 LOC, the synced-data browser) lands here as four
// extra tabs alongside the new Brain revenue-ladder. The COGS tab is a
// pointer to /product-cogs (the dedicated editor from Slice 3).
//
// Tabs: Revenue / Orders / Products / Customers / Product COGS (link).
// URL-synced via `tab` query param; default = Revenue (existing behaviour).

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsStringEnum, parseAsString } from 'nuqs';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useAppSelector } from '@/domain/store/hooks.js';
import { RevenueLadderStrip } from '@/interfaces/components/store/revenue-ladder-strip.js';
import { StalenessLabel } from '@/interfaces/components/shared/staleness-label.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { cn } from '@/lib/utils.js';
import { StoreOrdersTable } from './store-orders-table.js';
import { StoreProductsTable } from './store-products-table.js';
import { StoreCustomersTable } from './store-customers-table.js';

const TAB_VALUES = ['revenue', 'orders', 'products', 'customers', 'cogs'] as const;
type TabValue = (typeof TAB_VALUES)[number];

const TABS: { value: TabValue; label: string }[] = [
  { value: 'revenue',   label: 'Revenue quality' },
  { value: 'orders',    label: 'Orders' },
  { value: 'products',  label: 'Products' },
  { value: 'customers', label: 'Customers' },
  { value: 'cogs',      label: 'Product COGS →' },
];

export function StoreContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum<TabValue>([...TAB_VALUES]).withDefault('revenue'),
  );
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(DEFAULT_DATE_START));
  const [dateEnd,   setDateEnd]   = useQueryState('to',   parseAsString.withDefault(DEFAULT_DATE_END));

  const { data: summary } = trpc.store.summary.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled: isAuthenticated && tab === 'revenue' },
  );

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <p className="text-sm text-muted-foreground">Please sign in to view your store.</p>
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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Store</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Synced data + revenue quality
          </p>
          {tab === 'revenue' && summary && (
            <div className="mt-1">
              <StalenessLabel dataEpoch={summary.data_epoch} />
            </div>
          )}
        </div>

        {tab === 'revenue' && (
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="store-date-start" className="sr-only">From date</label>
            <input
              id="store-date-start" type="date" value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Start date for store metrics"
            />
            <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
            <label htmlFor="store-date-end" className="sr-only">To date</label>
            <input
              id="store-date-end" type="date" value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="End date for store metrics"
            />
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="border-b">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value === 'revenue' ? null : t.value)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                tab === t.value
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'revenue' && (
        <>
          <RevenueLadderStrip date_start={dateStart} date_end={dateEnd} />
          <p className="text-xs text-muted-foreground">
            Realized revenue is the honest billing base — it nets out cancellations,
            RTO reversals, and refunds. Tax is extracted per SKU at its GST 2.0 slab,
            never blended.
          </p>
        </>
      )}

      {tab === 'orders'    && <StoreOrdersTable />}
      {tab === 'products'  && <StoreProductsTable />}
      {tab === 'customers' && <StoreCustomersTable />}

      {tab === 'cogs' && (
        <div className="rounded-xl border bg-card p-6 flex flex-col gap-3 shadow-sm">
          <h2 className="text-base font-semibold">Product COGS editor</h2>
          <p className="text-sm text-muted-foreground">
            Per-product COGS lives on its own page so the editing surface (bulk
            edit, per-row save, search/filter) has room to breathe. Feeds CM1.
          </p>
          <div>
            <Button asChild>
              <Link href="/product-cogs">
                Open the COGS editor
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

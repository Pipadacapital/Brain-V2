'use client';

// @paradigm: sql
// StoreContent — the /store page. Slice 4 of the parity epic: legacy
// store-content.tsx (233 LOC, the synced-data browser) lands here as four
// extra tabs alongside the new Brain revenue-ladder. The COGS tab is a
// pointer to /product-cogs (the dedicated editor from Slice 3).
//
// Parity fixes applied (vs legacy-parity-audit-v2.md § store):
//   P0: Sync + backfill toolbar restored as honest-disabled (pending cutover).
//       Legacy labels preserved; buttons are not wired to live mutations.
//   P1: Connect-store empty state added — shown when hasConnection=false.
//       Detects connection via trpc.settings.integrations or data absence.
//
// Tabs: Revenue / Orders / Products / Customers / Product COGS (link).
// URL-synced via `tab` query param; default = Revenue (existing behaviour).

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsStringEnum, parseAsString } from 'nuqs';
import Link from 'next/link';
import { ArrowRight, RefreshCw, Download } from 'lucide-react';
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

  // Detect connection status from integrations (lightweight read).
  // hasConnection is true when at least one CONNECTED store connector exists.
  const { data: integrationsData } = trpc.settings.integrations.useQuery(
    undefined,
    { enabled: Boolean(isAuthenticated && workspaceId) },
  );
  const hasConnection = integrationsData?.result?.rows?.some(
    (r) => (r.connector === 'Shopify' || r.connector === 'WooCommerce') && r.status === 'CONNECTED',
  ) ?? true; // default true (pending cutover) — honest state for migrated data

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

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Sync + backfill toolbar — P0 parity. Buttons carry legacy labels and are
              rendered DISABLED with a "pending cutover" tooltip until the connector
              integration is live. Never fabricate live mutations. */}
          <div className="flex items-center gap-1.5" aria-label="Store sync controls">
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Connector cutover pending — sync will be enabled after Shopify integration goes live"
              aria-disabled="true"
              className="flex items-center gap-1.5 opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh from Shopify
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Connector cutover pending — backfill will be enabled after Shopify integration goes live"
              aria-disabled="true"
              className="flex items-center gap-1.5 opacity-60"
            >
              <Download className="h-3.5 w-3.5" />
              Backfill Customers
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Connector cutover pending — bulk backfill will be enabled after Shopify integration goes live"
              aria-disabled="true"
              className="flex items-center gap-1.5 opacity-60"
            >
              <Download className="h-3.5 w-3.5" />
              Bulk Backfill (4 Years)
            </Button>
          </div>

          {tab === 'revenue' && (
            <div className="flex items-center gap-2">
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

      {/* Connect-store empty state — shown when no store connector is active */}
      {!hasConnection && tab !== 'revenue' && tab !== 'cogs' && (
        <div className="rounded-xl border-2 border-dashed border-border p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Connect a Shopify or WooCommerce store from{' '}
            <Link href="/settings/integrations" className="font-medium underline underline-offset-2">
              Integrations
            </Link>{' '}
            to view orders, products, and customers here.
          </p>
        </div>
      )}

      {/* Tab content */}
      {(hasConnection || tab === 'revenue' || tab === 'cogs') && (
        <>
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
        </>
      )}
    </div>
  );
}

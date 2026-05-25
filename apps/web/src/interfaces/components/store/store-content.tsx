'use client';

// @paradigm: sql
// StoreContent — the /store page client component (Phase-2 slice-1).
// Renders the real, data-backed revenue-quality ladder for the anchor brand
// inside the app shell. CF-C6-RENDER-ONLY-1: zero arithmetic; all values from
// the tRPC BFF (store.revenueLadder / store.summary). Mirrors DashboardContent.

import { useQueryState, parseAsString } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { RevenueLadderStrip } from '@/interfaces/components/store/revenue-ladder-strip.js';
import { StalenessLabel } from '@/interfaces/components/shared/staleness-label.js';
import { trpc } from '@/infrastructure/trpc-client.js';

export function StoreContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));

  // Summary drives the freshness label + the realized headline.
  const { data: summary } = trpc.store.summary.useQuery({
    date_start: dateStart,
    date_end: dateEnd,
  });

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
            Sugandh Lok — revenue quality
          </p>
          {summary && (
            <div className="mt-1">
              <StalenessLabel dataEpoch={summary.data_epoch} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="store-date-start" className="sr-only">
            From date
          </label>
          <input
            id="store-date-start"
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Start date for store metrics"
          />
          <span aria-hidden="true" className="text-muted-foreground text-sm">
            to
          </span>
          <label htmlFor="store-date-end" className="sr-only">
            To date
          </label>
          <input
            id="store-date-end"
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="End date for store metrics"
          />
        </div>
      </div>

      {/* Revenue quality ladder — Gross → Net → Net of Tax → Net Revenue → Realized */}
      <RevenueLadderStrip date_start={dateStart} date_end={dateEnd} />

      <p className="text-xs text-muted-foreground">
        Realized revenue is the honest billing base — it nets out cancellations,
        RTO reversals, and refunds. Tax is extracted per SKU at its GST 2.0 slab,
        never blended.
      </p>
    </div>
  );
}

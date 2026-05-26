'use client';

// @paradigm: sql
// WaterfallContent — the /waterfall page client component (Phase-2 slice-2).
// Renders the honest CM waterfall chart inside the shell, reusing the existing
// PnlWaterfallPanel (→ CmWaterfallChart). CF-C6-RENDER-ONLY-1: zero arithmetic;
// all values from the tRPC BFF (the re-pointed metrics.pnlWaterfall = honest data).

import { useQueryState, parseAsString } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { PnlWaterfallPanel } from '@/interfaces/components/waterfall/pnl-waterfall-panel.js';

export function WaterfallContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <p className="text-sm text-muted-foreground">Please sign in to view the waterfall.</p>
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Waterfall</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            contribution margin waterfall
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="wf-date-start" className="sr-only">
            From date
          </label>
          <input
            id="wf-date-start"
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Start date for waterfall"
          />
          <span aria-hidden="true" className="text-muted-foreground text-sm">
            to
          </span>
          <label htmlFor="wf-date-end" className="sr-only">
            To date
          </label>
          <input
            id="wf-date-end"
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="End date for waterfall"
          />
        </div>
      </div>

      <PnlWaterfallPanel workspaceId={workspaceId} date_start={dateStart} date_end={dateEnd} />

      <p className="text-xs text-muted-foreground">
        Net Revenue → COGS → Variable Costs → CM1 → Ad Spend → CM2 → Fixed Overheads → CM3.
        CM1 nets out variable fulfilment costs; RTO is provisioned at CM2 (True CM2), never
        double-counted in CM1.
      </p>
    </div>
  );
}

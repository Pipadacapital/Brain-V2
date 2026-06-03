'use client';

// @paradigm: sql
// CommandCenter — the main dashboard page Client Component.
// Orchestrates KpiStrip + PnlWaterfallPanel + DrillDrawer + WorkspaceSwitcher.
// CF-C6-RENDER-ONLY-1: zero arithmetic. All values from tRPC BFF.
// CF-C6-AS-OF-STAMP-1: date range from URL state via nuqs.
// CF-C6-NEW-LAYER-1: nuqs for URL state (date range / filters); Redux for ui/session.
// CF-C6-PERF-A11Y-1: semantic headings, landmarks.

import { DEFAULT_DATE_START, DEFAULT_DATE_END } from "@/lib/default-date-range.js";
import { useQueryState, parseAsString } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { useScopedPath } from '@/infrastructure/workspace-slug-context.js';
import { KpiStrip } from '@/interfaces/components/kpi/kpi-strip.js';
import { PnlWaterfallPanel } from '@/interfaces/components/waterfall/pnl-waterfall-panel.js';
import { DrillDrawer } from '@/interfaces/components/drill/drill-drawer.js';
import { WorkspaceSwitcher } from '@/interfaces/components/workspace/workspace-switcher.js';

// Current month date range helper (for LOCAL harness default).
function currentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const startDate = `${year}-${month}-01`;
  // End = today for live; seed month = 2026-04.
  // For LOCAL harness, default to the Sugandh-Lok seed month.
  const endDate = DEFAULT_DATE_END;
  return { start: startDate, end: endDate };
}

export function CommandCenter() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const toPath = useScopedPath();

  // CF-C6-AS-OF-STAMP-1: date range in URL state (nuqs).
  const [dateStart, setDateStart] = useQueryState(
    'from',
    parseAsString.withDefault(DEFAULT_DATE_START),
  );
  const [dateEnd, setDateEnd] = useQueryState(
    'to',
    parseAsString.withDefault(DEFAULT_DATE_END),
  );

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">Brain</h1>
          <p className="text-gray-600">Please sign in to view your dashboard.</p>
          <a
            href="/login"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top navigation */}
      <nav
        aria-label="Main navigation"
        className="bg-white border-b border-gray-200 sticky top-0 z-20"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href={toPath("/dashboard")} className="text-lg font-bold text-gray-900">
              Brain
            </a>
            <span aria-hidden="true" className="text-gray-300">|</span>
            <span className="text-sm text-gray-600">Command Center</span>
          </div>

          <div className="flex items-center gap-4">
            <WorkspaceSwitcher />
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Page heading */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
            <p className="text-sm text-gray-500 mt-1">
              Morning Brief
            </p>
          </div>

          {/* Date range picker (URL state via nuqs) */}
          <div className="flex items-center gap-3">
            <label htmlFor="date-start" className="sr-only">From date</label>
            <input
              id="date-start"
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Start date for metrics"
            />
            <span aria-hidden="true" className="text-gray-400 text-sm">to</span>
            <label htmlFor="date-end" className="sr-only">To date</label>
            <input
              id="date-end"
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="End date for metrics"
            />
          </div>
        </div>

        {/* KPI strip — revenue + profit */}
        <KpiStrip
          workspaceId={workspaceId}
          date_start={dateStart}
          date_end={dateEnd}
        />

        {/* P&L / CM Waterfall (Visx) */}
        <PnlWaterfallPanel
          workspaceId={workspaceId}
          date_start={dateStart}
          date_end={dateEnd}
        />

        {/* Top-3-actions placeholder (6b — deferred) */}
        <section
          aria-label="Recommended actions (coming soon)"
          className="bg-white rounded-lg border border-dashed border-gray-300 p-6 text-center"
        >
          <p className="text-sm text-gray-400">
            Top-3 recommended actions — Morning Brief (Track K / mobile-first; 6b full web page)
          </p>
        </section>
      </main>

      {/* Drill-to-source drawer — CF-C6-DRILL-TO-SOURCE-1 */}
      <DrillDrawer />
    </div>
  );
}

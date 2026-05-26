"use client";

// @paradigm: sql
// DashboardContent — main dashboard Client Component, renders inside the shell.
// Shell (sidebar + header) is provided by the (shell) layout.
// CF-C6-RENDER-ONLY-1: zero arithmetic. All values from tRPC BFF.
// CF-C6-AS-OF-STAMP-1: date range from URL state via nuqs.
// CF-C6-NEW-LAYER-1: nuqs for URL state; Redux for ui/session.

import { useQueryState, parseAsString } from "nuqs";
import { useAppSelector } from "@/domain/store/hooks.js";
import { trpc } from "@/infrastructure/trpc-client.js";
import { KpiStrip } from "@/interfaces/components/kpi/kpi-strip.js";
import { PnlWaterfallPanel } from "@/interfaces/components/waterfall/pnl-waterfall-panel.js";
import { DrillDrawer } from "@/interfaces/components/drill/drill-drawer.js";
import { EmptyWorkspaceState } from "@/interfaces/components/dashboard/empty-workspace-state.js";

export function DashboardContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // Slice C data-reconciliation: a freshly-onboarded workspace has a new UUID and
  // NO analytics data (the StubDataPlane seed is keyed to Sugandh-Lok; the live data
  // plane is slice D). Ask the gateway whether the active workspace has seed data; if
  // not, render the honest "no data yet" empty-state rather than fabricating numbers.
  const dataAvailability = trpc.workspace.dataAvailability.useQuery(undefined, {
    retry: false,
  });

  const [dateStart, setDateStart] = useQueryState(
    "from",
    parseAsString.withDefault("2026-04-01")
  );
  const [dateEnd, setDateEnd] = useQueryState(
    "to",
    parseAsString.withDefault("2026-04-30")
  );

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <p className="text-sm text-muted-foreground">
            Please sign in to view your dashboard.
          </p>
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
      {/* Page header + date range */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Morning Brief
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="date-start" className="sr-only">
            From date
          </label>
          <input
            id="date-start"
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Start date for metrics"
          />
          <span aria-hidden="true" className="text-muted-foreground text-sm">
            to
          </span>
          <label htmlFor="date-end" className="sr-only">
            To date
          </label>
          <input
            id="date-end"
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="End date for metrics"
          />
        </div>
      </div>

      {/* Slice C: a freshly-onboarded workspace (no seed data) shows the honest
          empty-state; the seeded Sugandh-Lok workspace keeps its demo data. We do
          NOT fabricate data for a new workspace. While the availability check is in
          flight we optimistically render the data panels (Sugandh-Lok is the common
          case); only an explicit hasSeedData=false swaps to the empty-state. */}
      {dataAvailability.data && !dataAvailability.data.hasSeedData ? (
        <EmptyWorkspaceState />
      ) : (
        <>
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

          {/* Recommended actions placeholder (Phase 2) */}
          <section
            aria-label="Recommended actions"
            className="rounded-lg border border-dashed border-border p-6 text-center bg-card"
          >
            <p className="text-sm text-muted-foreground">
              Top-3 recommended actions — Morning Brief (Phase 2)
            </p>
          </section>

          {/* Drill-to-source drawer */}
          <DrillDrawer />
        </>
      )}
    </div>
  );
}

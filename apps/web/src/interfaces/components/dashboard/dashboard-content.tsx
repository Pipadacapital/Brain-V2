"use client";

// @paradigm: sql
// DashboardContent — main dashboard Client Component.
// Rebuilt to match legacy dashboard-content.tsx parity (Wave 1 parity restoration).
//
// Features:
//   - 32-metric grid across 5 categories (Revenue / Margins / Marketing / Logistics / Store)
//   - Date presets: Yesterday / 7D / 30D / 90D / 1Y + custom date inputs
//   - Customize panel: add/remove/reorder tiles, persisted to localStorage
//   - Period-over-period deltas per tile
//   - Drill-through links to detail pages
//   - Honest empty tiles for metrics without a local data source (CF-S10-HONEST-STATE-1)
//
// CF-C6-RENDER-ONLY-1: zero arithmetic — all values from tRPC BFF.
// CF-C6-AS-OF-STAMP-1: date range from URL state via nuqs.
// CF-C6-NEW-LAYER-1: nuqs for URL state; Redux for ui/session.

import { useMemo, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { useAppSelector } from "@/domain/store/hooks.js";
import { DashboardMetricsGrid } from "@/interfaces/components/dashboard/dashboard-metrics-grid.js";
import { EmptyWorkspaceState } from "@/interfaces/components/dashboard/empty-workspace-state.js";
import { DrillDrawer } from "@/interfaces/components/drill/drill-drawer.js";
import { trpc } from "@/infrastructure/trpc-client.js";

// ---------------------------------------------------------------------------
// Date helpers — matching legacy preset logic exactly.
// ---------------------------------------------------------------------------

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function subDaysFromDate(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - n);
  return r;
}

function getPresetRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = subDaysFromDate(to, days - 1);
  return { from: isoDate(from), to: isoDate(to) };
}

function getYesterdayRange(): { from: string; to: string } {
  const d = subDaysFromDate(new Date(), 1);
  const v = isoDate(d);
  return { from: v, to: v };
}

/** Compute the previous period of equal length for period-over-period deltas. */
function getPrevPeriod(from: string, to: string): { prevFrom: string; prevTo: string } {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const prevTo = subDaysFromDate(fromDate, 1);
  const prevFrom = subDaysFromDate(prevTo, days - 1);
  return { prevFrom: isoDate(prevFrom), prevTo: isoDate(prevTo) };
}

// Default date range: last 30 days (matching legacy getDefaultRange).
function getDefault30Days(): { from: string; to: string } {
  return getPresetRange(30);
}

// ---------------------------------------------------------------------------
// Active preset tracking for styling the pressed button.
// ---------------------------------------------------------------------------

type Preset = "yesterday" | "7d" | "30d" | "90d" | "1y" | "custom";

function detectPreset(from: string, to: string): Preset {
  const y = getYesterdayRange();
  if (from === y.from && to === y.to) return "yesterday";
  const p7 = getPresetRange(7);
  if (from === p7.from && to === p7.to) return "7d";
  const p30 = getPresetRange(30);
  if (from === p30.from && to === p30.to) return "30d";
  const p90 = getPresetRange(90);
  if (from === p90.from && to === p90.to) return "90d";
  const p1y = getPresetRange(365);
  if (from === p1y.from && to === p1y.to) return "1y";
  return "custom";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // Look up the active workspace slug + name from the workspace list.
  // The session slice stores workspaceId only; slug/name come from workspace.list.
  const workspaceListQuery = trpc.workspace.list.useQuery(undefined, {
    enabled: !!isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
  const activeWorkspace = workspaceListQuery.data?.workspaces.find(
    (w) => w.workspaceId === workspaceId
  );
  const workspaceSlug = activeWorkspace?.slug ?? workspaceId ?? "";
  const workspaceName = activeWorkspace?.name ?? null;

  const defaults = useMemo(() => getDefault30Days(), []);

  const [dateStart, setDateStart] = useQueryState(
    "from",
    parseAsString.withDefault(defaults.from)
  );
  const [dateEnd, setDateEnd] = useQueryState(
    "to",
    parseAsString.withDefault(defaults.to)
  );
  const [showCustomizePanel, setShowCustomizePanel] = useState(false);

  const { prevFrom, prevTo } = useMemo(
    () => getPrevPeriod(dateStart, dateEnd),
    [dateStart, dateEnd]
  );

  const activePreset = useMemo(
    () => detectPreset(dateStart, dateEnd),
    [dateStart, dateEnd]
  );

  const applyPreset = (preset: Preset) => {
    if (preset === "yesterday") {
      const r = getYesterdayRange();
      setDateStart(r.from);
      setDateEnd(r.to);
    } else if (preset === "7d") {
      const r = getPresetRange(7);
      setDateStart(r.from);
      setDateEnd(r.to);
    } else if (preset === "30d") {
      const r = getPresetRange(30);
      setDateStart(r.from);
      setDateEnd(r.to);
    } else if (preset === "90d") {
      const r = getPresetRange(90);
      setDateStart(r.from);
      setDateEnd(r.to);
    } else if (preset === "1y") {
      const r = getPresetRange(365);
      setDateStart(r.from);
      setDateEnd(r.to);
    }
  };

  // Slice C: a freshly-onboarded workspace has no seed data.
  const dataAvailability = trpc.workspace.dataAvailability.useQuery(undefined, {
    retry: false,
  });

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
    <div className="flex flex-col gap-6 py-4 md:py-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {workspaceName ?? "Dashboard"}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Welcome to your workspace dashboard.
        </p>
      </div>

      {/* Main card */}
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Toolbar: date range + presets + Customize */}
        <div className="border-b px-6 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            {/* Left: date inputs + preset buttons */}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label
                  className="text-xs text-muted-foreground block mb-1"
                  htmlFor="dashboard-from"
                >
                  From
                </label>
                <input
                  id="dashboard-from"
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="block h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Start date for metrics"
                  data-testid="date-from-input"
                />
              </div>
              <div>
                <label
                  className="text-xs text-muted-foreground block mb-1"
                  htmlFor="dashboard-to"
                >
                  To
                </label>
                <input
                  id="dashboard-to"
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="block h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="End date for metrics"
                  data-testid="date-to-input"
                />
              </div>

              {/* Preset buttons */}
              <div
                className="flex flex-wrap gap-1 pb-0.5"
                role="group"
                aria-label="Date range presets"
              >
                {(
                  [
                    { id: "yesterday", label: "Yesterday" },
                    { id: "7d",        label: "7D" },
                    { id: "30d",       label: "30D" },
                    { id: "90d",       label: "90D" },
                    { id: "1y",        label: "1Y" },
                  ] as { id: Preset; label: string }[]
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => applyPreset(id)}
                    aria-pressed={activePreset === id}
                    data-testid={`preset-${id}`}
                    className={`h-9 rounded-md border px-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                      activePreset === id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Customize button */}
            <button
              type="button"
              onClick={() => setShowCustomizePanel((prev) => !prev)}
              aria-expanded={showCustomizePanel}
              aria-controls="customize-panel"
              data-testid="customize-btn"
              className="h-9 rounded-md border bg-background px-3 text-sm border-border hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {showCustomizePanel ? "Close" : "+ Customize"}
            </button>
          </div>
        </div>

        {/* Metrics content */}
        <div className="px-6 py-4">
          {dataAvailability.data && !dataAvailability.data.hasSeedData ? (
            <EmptyWorkspaceState />
          ) : (
            <DashboardMetricsGrid
              workspaceSlug={workspaceSlug ?? ""}
              from={dateStart}
              to={dateEnd}
              prevFrom={prevFrom}
              prevTo={prevTo}
              showCustomizePanel={showCustomizePanel}
            />
          )}
        </div>
      </div>

      {/* Drill-to-source drawer */}
      <DrillDrawer />
    </div>
  );
}

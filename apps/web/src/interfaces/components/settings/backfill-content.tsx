'use client';

// @paradigm: sql
// BackfillContent — the /settings/backfill page (Phase-2 slice-10).
// Honest ads-backfill status (CF-S10-HONEST-STATE-1): renders the backfill job list +
// honest note from trpc.settings.backfill. No jobs run locally (connector cutover HELD),
// so the page tells the truth ("pending cutover") rather than faking a progress bar.
// Backfill TRIGGERS (owner-only POST) are DEFERRED — disabled affordances.

import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  NONE: { label: 'No jobs', cls: 'bg-gray-100 text-gray-700' },
  PENDING_CUTOVER: { label: 'Pending cutover', cls: 'bg-amber-100 text-amber-800' },
  RUNNING: { label: 'Running', cls: 'bg-blue-100 text-blue-800' },
  COMPLETE: { label: 'Complete', cls: 'bg-green-100 text-green-800' },
  FAILED: { label: 'Failed', cls: 'bg-red-100 text-red-800' },
};

export function BackfillContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.settings.backfill.useQuery(undefined, { enabled });

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <a href="/login" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">Sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Ads Backfill</h1>
        <p className="text-sm text-muted-foreground mt-0.5">historical data backfill status</p>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading backfill status" className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load backfill status" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (
        <div className="space-y-4">
          <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-honest-state="connector-pending">{q.data.note}</p>
          <div className="space-y-3">
            {q.data.jobs.map((j) => {
              const s = STATUS_STYLE[j.status] ?? STATUS_STYLE.NONE!;
              return (
                <div key={j.job_type} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{j.job_type}</span>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{j.started_at ? `Started ${new Date(j.started_at).toISOString().slice(0, 10)}` : j.note}</p>
                  </div>
                  <button
                    type="button"
                    disabled
                    title="Backfill triggers are available after connector cutover"
                    className="cursor-not-allowed rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-60"
                  >
                    Run backfill (pending cutover)
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

// @paradigm: sql
// WorkspaceSettingsContent — the /settings (general) page (Phase-2 slice-10).
// Renders REAL workspace settings (name/plan/timezone/region/currency) from
// trpc.settings.workspace. CF-C6-RENDER-ONLY-1: zero arithmetic. Settings EDIT
// (rename/plan-change/delete) is DEFERRED — read-only display this slice.

import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

export function WorkspaceSettingsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.settings.workspace.useQuery(undefined, { enabled });

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

  const rows: Array<{ label: string; value: string }> = q.data
    ? [
        { label: 'Workspace name', value: q.data.result.name },
        { label: 'Plan', value: q.data.result.plan },
        { label: 'Timezone', value: q.data.result.timezone },
        { label: 'Region', value: q.data.result.region },
        { label: 'Currency', value: q.data.result.currency_code },
        { label: 'Created', value: q.data.result.created_at },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">general workspace settings</p>
        </div>
        <button
          type="button"
          disabled
          title="Editing settings is coming soon"
          className="cursor-not-allowed rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
        >
          Edit settings (coming soon)
        </button>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading settings" className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load settings" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>
          <dl className="divide-y divide-gray-100">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between py-3">
                <dt className="text-sm text-muted-foreground">{r.label}</dt>
                <dd className="text-sm font-medium text-foreground">{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

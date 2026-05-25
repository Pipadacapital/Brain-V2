'use client';

// @paradigm: sql
// IntegrationsContent — the /settings/integrations page (Phase-2 slice-10).
// The HONEST-STATE centerpiece (CF-S10-HONEST-STATE-1): renders the connector list
// with REAL health/status/last-sync from trpc.settings.integrations. Shopify is
// CONNECTED (drives the seeded analytics); Meta/Google/Shiprocket/Klaviyo are
// PENDING_CUTOVER with NO fake sync time. CONNECT/DISCONNECT (OAuth) is DEFERRED —
// rendered as disabled affordances. CF-C6-RENDER-ONLY-1: zero arithmetic.

import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  CONNECTED: { label: 'Connected', cls: 'bg-green-100 text-green-800' },
  PENDING_CUTOVER: { label: 'Pending cutover', cls: 'bg-amber-100 text-amber-800' },
  DISCONNECTED: { label: 'Disconnected', cls: 'bg-gray-100 text-gray-700' },
  ERROR: { label: 'Error', cls: 'bg-red-100 text-red-800' },
};

export function IntegrationsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.settings.integrations.useQuery(undefined, { enabled });

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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Sugandh Lok — connector health &amp; sync status</p>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading integrations" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load integrations" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (
        <div className="space-y-3">
          <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>
          {q.data.rows.map((r) => {
            const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.DISCONNECTED!;
            const isConnected = r.status === 'CONNECTED';
            return (
              <div key={r.connector} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{r.connector}</span>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.last_sync_at
                      ? `Last synced ${new Date(r.last_sync_at).toISOString().slice(0, 10)}`
                      : 'Never synced — connector cutover pending'}
                    {r.last_sync_error ? ` · ${r.last_sync_error}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  disabled
                  title={isConnected ? 'Disconnect is coming soon' : 'Connect is available after connector cutover'}
                  className="cursor-not-allowed rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-60"
                >
                  {isConnected ? 'Manage (coming soon)' : 'Connect (pending cutover)'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

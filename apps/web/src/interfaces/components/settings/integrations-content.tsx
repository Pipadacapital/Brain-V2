'use client';

// @paradigm: io
// IntegrationsContent — the /settings/integrations page.
//
// Slice D (feat live integrations OAuth): the Connect/Disconnect buttons for
// Shopify, Meta Ads, Google Ads are now REAL. Connect → connectors.initiate (CSRF
// state + provider consent URL) → window.location.assign(authUrl). After the
// provider redirects to /api/integrations/{vendor}/callback, core-service exchanges
// the code + persists the token ENCRYPTED, then redirects back here with
// ?connected={vendor} | ?error=<slug>. Per-vendor live status (connected /
// not-connected / token-expired) from connectors.list.
//
// Data-ingestion is DEFERRED: a connected connector shows "Connected · sync pending"
// (syncPending) — NO fabricated last-sync time. NEVER renders a token value.
// CF-C6-RENDER-ONLY-1: zero arithmetic.

import { useState } from 'react';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

type Vendor = 'SHOPIFY' | 'META' | 'GOOGLE';

const VENDOR_LABEL: Record<Vendor, string> = {
  SHOPIFY: 'Shopify',
  META: 'Meta Ads',
  GOOGLE: 'Google Ads',
};

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  CONNECTED: { label: 'Connected', cls: 'bg-green-100 text-green-800' },
  NOT_CONNECTED: { label: 'Not connected', cls: 'bg-gray-100 text-gray-700' },
  TOKEN_EXPIRED: { label: 'Token expired — reconnect', cls: 'bg-amber-100 text-amber-800' },
  DISCONNECTED: { label: 'Disconnected', cls: 'bg-gray-100 text-gray-700' },
  ERROR: { label: 'Error', cls: 'bg-red-100 text-red-800' },
};

export function IntegrationsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const enabled = Boolean(isAuthenticated && workspaceId);

  const connectorsQuery = trpc.connectors.list.useQuery(undefined, { enabled });
  const utils = trpc.useUtils();

  const [shopDomain, setShopDomain] = useState('');
  const [busyVendor, setBusyVendor] = useState<Vendor | null>(null);

  const initiate = trpc.connectors.initiate.useMutation({
    onSuccess: (data) => {
      // Redirect the browser to the provider consent screen.
      window.location.assign(data.authUrl);
    },
    onSettled: () => setBusyVendor(null),
  });
  const disconnect = trpc.connectors.disconnect.useMutation({
    onSuccess: () => {
      void utils.connectors.list.invalidate();
    },
    onSettled: () => setBusyVendor(null),
  });

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

  const onConnect = (vendor: Vendor) => {
    setBusyVendor(vendor);
    initiate.mutate({
      vendor,
      shopDomain: vendor === 'SHOPIFY' ? shopDomain.trim() : null,
    });
  };

  // Surface the post-callback ?connected / ?error banner (read on the client).
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const connectedVendor = params?.get('connected');
  const errorSlug = params?.get('error');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Connect your store &amp; ad accounts (read-only)</p>
      </div>

      {connectedVendor && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {VENDOR_LABEL[connectedVendor.toUpperCase() as Vendor] ?? connectedVendor} connected. Data sync is coming soon.
        </div>
      )}
      {errorSlug && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Connection did not complete ({errorSlug.replace(/_/g, ' ')}). Please try again.
        </div>
      )}

      {connectorsQuery.isLoading && (
        <div aria-busy="true" aria-label="Loading connectors" className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-20 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {connectorsQuery.error && (
        <ErrorDisplay
          title="Failed to load connectors"
          message={connectorsQuery.error.message}
          requestId={(connectorsQuery.error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {connectorsQuery.data && (
        <div className="space-y-3">
          {connectorsQuery.data.rows.map((r) => {
            const vendor = r.vendor as Vendor;
            const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.NOT_CONNECTED!;
            const isConnected = r.status === 'CONNECTED' || r.status === 'TOKEN_EXPIRED';
            const busy = busyVendor === vendor && (initiate.isPending || disconnect.isPending);
            return (
              <div key={vendor} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{VENDOR_LABEL[vendor]}</span>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.status === 'CONNECTED' && r.syncPending
                        ? 'Connected · sync pending (data ingestion coming soon)'
                        : r.accountRef
                          ? `Account: ${r.accountRef}`
                          : 'Read-only access to your store / ad data'}
                      {r.lastSyncError ? ` · ${r.lastSyncError}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isConnected ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => { setBusyVendor(vendor); disconnect.mutate({ vendor }); }}
                        className="rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:bg-gray-50 disabled:opacity-60"
                      >
                        {busy ? 'Working…' : 'Disconnect'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || (vendor === 'SHOPIFY' && !shopDomain.trim())}
                        onClick={() => onConnect(vendor)}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {busy ? 'Redirecting…' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Shopify is per-store OAuth → it needs the *.myshopify.com domain. */}
                {vendor === 'SHOPIFY' && !isConnected && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={shopDomain}
                      onChange={(e) => setShopDomain(e.target.value)}
                      placeholder="your-store.myshopify.com"
                      aria-label="Shopify store domain"
                      className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            These are read-only connections (we pull store &amp; ad performance data). We never post
            on your behalf. Tokens are encrypted at rest.
          </p>
        </div>
      )}
    </div>
  );
}

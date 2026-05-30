'use client';

// @paradigm: io
// IntegrationsContent — the /settings/integrations page.
//
// Wave-3 parity restoration: 7-connector branded card layout matching legacy.
// Wired vendors (Shopify/Meta/Google) reuse the existing connectors.* tRPC procedures
// (initiate/disconnect/list/sync). Unwired vendors (Shiprocket/Unicommerce/Klaviyo/
// WooCommerce) render honest "Coming soon" disabled cards — brand chrome matches legacy
// but no backend calls are made.
//
// Slice D (feat live integrations OAuth): Connect/Disconnect buttons for Shopify/Meta/
// Google are REAL. Connect → connectors.initiate (CSRF state + provider consent URL) →
// window.location.assign(authUrl). Per-vendor live status from connectors.list.
//
// Slice E (feat-connector-data-ingestion): Sync now → connectors.sync.
// CF-C6-RENDER-ONLY-1: zero arithmetic.

import { useState } from 'react';
import {
  IconPlugConnected,
  IconCheck,
  IconRefresh,
  IconLoader2,
  IconBrandMeta,
  IconBrandGoogle,
  IconUnlink,
  IconTruck,
  IconMail,
  IconDatabase,
} from '@tabler/icons-react';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';
import { Badge } from '@/interfaces/components/ui/badge.js';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

// ── Types ────────────────────────────────────────────────────────────────────

type WiredVendor = 'SHOPIFY' | 'META' | 'GOOGLE';

// ── Brand config ─────────────────────────────────────────────────────────────

type VendorCardConfig = {
  label: string;
  subtitle: string;
  brandBg: string;      // Tailwind class for bg (e.g. bg-[#96bf48]/10)
  iconClass: string;    // Tailwind text color for icon
  Icon: React.ComponentType<{ className?: string }>;
};

const WIRED_VENDOR_CONFIG: Record<WiredVendor, VendorCardConfig> = {
  SHOPIFY: {
    label: 'Shopify',
    subtitle: 'Your store is connected',
    brandBg: 'bg-[#96bf48]/10',
    iconClass: 'text-[#96bf48]',
    Icon: IconPlugConnected,
  },
  META: {
    label: 'Meta Ads',
    subtitle: 'Connect your Meta Ads account for marketing insights',
    brandBg: 'bg-[#1877F2]/10',
    iconClass: 'text-[#1877F2]',
    Icon: IconBrandMeta,
  },
  GOOGLE: {
    label: 'Google Ads',
    subtitle: 'Connect your Google Ads account for search & display insights',
    brandBg: 'bg-[#4285F4]/10',
    iconClass: 'text-[#4285F4]',
    Icon: IconBrandGoogle,
  },
};

type UnwiredVendorConfig = {
  label: string;
  subtitle: string;
  bg: string;          // Tailwind bg token
  Icon: React.ComponentType<{ className?: string }>;
  iconColor: string;   // Tailwind text token
};

const UNWIRED_VENDORS: UnwiredVendorConfig[] = [
  {
    label: 'Shiprocket',
    subtitle: 'Shipping analytics (courier, RTO, pincode intelligence)',
    bg: 'bg-[#6E3FF3]/10',
    Icon: IconTruck,
    iconColor: 'text-[#6E3FF3]',
  },
  {
    label: 'Unicommerce',
    subtitle: 'Product catalog source (WMS/OMS integration)',
    bg: 'bg-orange-500/10',
    Icon: IconDatabase,
    iconColor: 'text-orange-600',
  },
  {
    label: 'Klaviyo',
    subtitle: 'Email/SMS campaign & flow performance',
    bg: 'bg-violet-500/10',
    Icon: IconMail,
    iconColor: 'text-violet-600',
  },
  {
    label: 'WooCommerce',
    subtitle: 'WordPress / WooCommerce store integration',
    bg: 'bg-[#7F54B3]/10',
    Icon: IconPlugConnected,
    iconColor: 'text-[#7F54B3]',
  },
];

// ── Status display ────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  CONNECTED: { label: 'Connected', cls: 'bg-emerald-500/10 text-emerald-600' },
  NOT_CONNECTED: { label: 'Not connected', cls: 'bg-secondary text-secondary-foreground' },
  TOKEN_EXPIRED: { label: 'Token expired — reconnect', cls: 'bg-amber-100 text-amber-800' },
  DISCONNECTED: { label: 'Disconnected', cls: 'bg-secondary text-secondary-foreground' },
  ERROR: { label: 'Error', cls: 'bg-destructive/10 text-destructive' },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function IntegrationsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const enabled = Boolean(isAuthenticated && workspaceId);

  const connectorsQuery = trpc.connectors.list.useQuery(undefined, { enabled });
  const utils = trpc.useUtils();

  const [shopDomain, setShopDomain] = useState('');
  const [busyVendor, setBusyVendor] = useState<WiredVendor | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const initiate = trpc.connectors.initiate.useMutation({
    onSuccess: (data) => {
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

  const sync = trpc.connectors.sync.useMutation({
    onSuccess: (data) => {
      void utils.connectors.list.invalidate();
      void utils.store.invalidate();
      void utils.pnl.invalidate();
      void utils.metrics.invalidate();
      void utils.marketing.invalidate();
      const vendor = data.vendor as WiredVendor;
      const label = WIRED_VENDOR_CONFIG[vendor]?.label ?? data.vendor;
      if (data.status === 'synced') {
        setSyncMsg(
          `${label} synced: ${data.ordersSynced} orders, ` +
            `${data.lineItemsSynced} line items, ${data.productsSynced} products, ${data.adRowsSynced} ad rows.`,
        );
      } else if (data.status === 'not_connected') {
        setSyncMsg(`${label} is not connected.`);
      } else {
        setSyncMsg(data.error ?? 'Sync failed.');
      }
    },
    onSettled: () => setBusyVendor(null),
  });

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <a
            href="/login"
            className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  const onConnect = (vendor: WiredVendor) => {
    setBusyVendor(vendor);
    initiate.mutate({
      vendor,
      shopDomain: vendor === 'SHOPIFY' ? shopDomain.trim() : null,
    });
  };

  // Post-callback banner from ?connected / ?error query params.
  const params =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const connectedVendor = params?.get('connected');
  const errorSlug = params?.get('error');

  // Build a lookup by vendor from the list query.
  const rowByVendor = Object.fromEntries(
    (connectorsQuery.data?.rows ?? []).map((r) => [r.vendor, r]),
  );

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect Shopify, Meta, Google, Shiprocket, and Klaviyo for your workspace.
        </p>
      </div>

      {/* Post-OAuth banners */}
      {connectedVendor && (
        <div
          role="status"
          className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"
        >
          {WIRED_VENDOR_CONFIG[connectedVendor.toUpperCase() as WiredVendor]?.label ??
            connectedVendor}{' '}
          connected. Data sync is coming soon.
        </div>
      )}
      {errorSlug && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          Connection did not complete ({errorSlug.replace(/_/g, ' ')}). Please try again.
        </div>
      )}
      {syncMsg && (
        <div
          role="status"
          className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"
        >
          {syncMsg}
        </div>
      )}

      {/* Loading skeleton — 4-card shape matching legacy */}
      {connectorsQuery.isLoading && (
        <div aria-busy="true" aria-label="Loading connectors" className="space-y-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="rounded-xl border bg-card shadow-sm"
              aria-hidden="true"
            >
              <div className="flex items-center gap-3 border-b px-6 py-4">
                <div className="h-9 w-9 rounded-lg bg-muted animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-48 rounded bg-muted animate-pulse" />
                </div>
                <div className="h-5 w-20 rounded-full bg-muted animate-pulse" />
              </div>
              <div className="px-6 py-4">
                <div className="h-8 w-24 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      {connectorsQuery.error && (
        <ErrorDisplay
          title="Failed to load connectors"
          message={connectorsQuery.error.message}
          requestId={
            (connectorsQuery.error as { data?: { requestId?: string } }).data?.requestId
          }
        />
      )}

      {/* Wired vendor cards — data-driven from connectors.list */}
      {connectorsQuery.data && (
        <>
          {(Object.keys(WIRED_VENDOR_CONFIG) as WiredVendor[]).map((vendor) => {
            const cfg = WIRED_VENDOR_CONFIG[vendor];
            const row = rowByVendor[vendor];
            const status = row?.status ?? 'NOT_CONNECTED';
            const s = STATUS_STYLE[status] ?? STATUS_STYLE.NOT_CONNECTED!;
            const isConnected = status === 'CONNECTED' || status === 'TOKEN_EXPIRED';
            const busy =
              busyVendor === vendor && (initiate.isPending || disconnect.isPending);
            const syncing = busyVendor === vendor && sync.isPending;

            return (
              <div
                key={vendor}
                className="rounded-xl border bg-card shadow-sm"
                data-testid={`vendor-card-${vendor.toLowerCase()}`}
              >
                {/* Card header */}
                <div className="flex items-center gap-3 border-b px-6 py-4">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${cfg.brandBg}`}
                    aria-hidden="true"
                  >
                    <cfg.Icon className={`h-5 w-5 ${cfg.iconClass}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{cfg.label}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {isConnected && row?.accountRef
                        ? `Account: ${row.accountRef}`
                        : cfg.subtitle}
                    </p>
                  </div>
                  {isConnected ? (
                    <Badge
                      className="bg-emerald-500/10 text-emerald-600 border-transparent flex-shrink-0"
                      data-testid={`status-badge-${vendor.toLowerCase()}`}
                    >
                      <IconCheck className="mr-1 h-3 w-3" aria-hidden="true" />
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="flex-shrink-0"
                      data-testid={`status-badge-${vendor.toLowerCase()}`}
                    >
                      {s.label}
                    </Badge>
                  )}
                </div>

                {/* Card body */}
                <div className="px-6 py-4">
                  {/* Token-expired inline warning (matches legacy lines 957-964) */}
                  {status === 'TOKEN_EXPIRED' && (
                    <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      Access token expired — reconnect soon to prevent sync failures.
                    </div>
                  )}

                  {isConnected ? (
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <p className="text-xs text-muted-foreground">
                          {row?.syncPending
                            ? 'Connected · sync pending — click "Sync now" to pull your data'
                            : row?.lastSyncAt
                              ? `Last synced: ${new Date(row.lastSyncAt).toLocaleString()}`
                              : row?.accountRef
                                ? `Account: ${row.accountRef}`
                                : 'Read-only access to your data'}
                          {row?.lastSyncError ? ` · ${row.lastSyncError}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {status === 'CONNECTED' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || syncing}
                            onClick={() => {
                              setBusyVendor(vendor);
                              setSyncMsg(null);
                              sync.mutate({ vendor });
                            }}
                            data-testid={`sync-btn-${vendor.toLowerCase()}`}
                          >
                            {syncing ? (
                              <>
                                <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                Syncing…
                              </>
                            ) : (
                              <>
                                <IconRefresh className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                                Sync now
                              </>
                            )}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setBusyVendor(vendor);
                            disconnect.mutate({ vendor });
                          }}
                          data-testid={`disconnect-btn-${vendor.toLowerCase()}`}
                        >
                          <IconUnlink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          {busy ? 'Working…' : 'Disconnect'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 py-4 text-center">
                      <div className="max-w-sm space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          No {cfg.label}{' '}
                          {vendor === 'SHOPIFY' ? 'store' : 'account'} connected
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {vendor === 'SHOPIFY'
                            ? 'Connect your Shopify store to pull in orders, products, and customer data for analytics.'
                            : vendor === 'META'
                              ? 'Connect your Meta (Facebook) Ads account to pull in campaign performance data.'
                              : 'Connect your Google Ads account to pull in campaign performance data.'}
                        </p>
                      </div>
                      {/* Shopify domain input */}
                      {vendor === 'SHOPIFY' && (
                        <div className="w-full max-w-sm">
                          <Input
                            type="text"
                            value={shopDomain}
                            onChange={(e) => setShopDomain(e.target.value)}
                            placeholder="your-store.myshopify.com"
                            aria-label="Shopify store domain"
                          />
                        </div>
                      )}
                      <Button
                        disabled={
                          busy ||
                          (vendor === 'SHOPIFY' && !shopDomain.trim())
                        }
                        onClick={() => onConnect(vendor)}
                        data-testid={`connect-btn-${vendor.toLowerCase()}`}
                      >
                        {busy ? (
                          <>
                            <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                            Redirecting…
                          </>
                        ) : (
                          <>
                            {vendor === 'META' ? (
                              <IconBrandMeta className="mr-1.5 h-4 w-4" aria-hidden="true" />
                            ) : vendor === 'GOOGLE' ? (
                              <IconBrandGoogle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                            ) : (
                              <IconPlugConnected className="mr-1.5 h-4 w-4" aria-hidden="true" />
                            )}
                            Connect {cfg.label}
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Unwired vendor cards — honest "Coming soon" disabled state */}
          {UNWIRED_VENDORS.map((cfg) => (
            <div
              key={cfg.label}
              className="rounded-xl border bg-card shadow-sm opacity-80"
              data-testid={`vendor-card-${cfg.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <div className="flex items-center gap-3 border-b px-6 py-4">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${cfg.bg}`}
                  aria-hidden="true"
                >
                  <cfg.Icon className={`h-5 w-5 ${cfg.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{cfg.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{cfg.subtitle}</p>
                </div>
                <Badge
                  variant="secondary"
                  className="flex-shrink-0 text-muted-foreground"
                  data-testid={`status-badge-${cfg.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  Not connected
                </Badge>
              </div>
              <div className="px-6 py-4">
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <p className="text-sm text-muted-foreground max-w-sm">
                    {cfg.label} connector is coming soon. Integration will be available once
                    the connector cutover is complete.
                  </p>
                  <Button
                    disabled
                    variant="outline"
                    title={`${cfg.label} connector is not yet wired — coming soon`}
                    data-testid={`coming-soon-btn-${cfg.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <cfg.Icon className={`mr-1.5 h-4 w-4 ${cfg.iconColor}`} aria-hidden="true" />
                    Connect {cfg.label} (coming soon)
                  </Button>
                </div>
              </div>
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            These are read-only connections (we pull store &amp; ad performance data). We never
            post on your behalf. Tokens are encrypted at rest.
          </p>
        </>
      )}
    </div>
  );
}

'use client';

// @paradigm: sql
// PlatformAdsView — the shared /meta-ads + /google-ads body (Phase-2 slice-10).
// Single primitive (Single-Primitive Rule): ONE component renders either platform,
// parameterized by `platform`. REUSE-only: real per-platform spend from slice-4
// marketing.efficiency (meta_spend_mu/google_spend_mu) + acquisition split + aMER/CAC.
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values from the BFF.
//
// CF-S10-HONEST-STATE-1 (persona C2): per-campaign rows are OAuth-fetched live and are
// NOT seeded. We render the REAL aggregate spend/efficiency + an HONEST "connect to see
// per-campaign breakdown" — NEVER a fabricated campaign. This mirrors legacy, which
// returns this state at HTTP 200 when the platform is unconnected.

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { ConnectorPending } from '@/interfaces/components/shared/connector-pending.js';
import { formatBpMultiple } from '@/interfaces/components/marketing/format-ratio.js';

type Platform = 'meta' | 'google';

const PLATFORM_META: Record<Platform, { label: string }> = {
  meta: { label: 'Meta Ads' },
  google: { label: 'Google Ads' },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function PlatformAdsView({ platform }: { platform: Platform }) {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));
  const enabled = Boolean(isAuthenticated && workspaceId);

  const eff = trpc.marketing.efficiency.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });
  const acq = trpc.marketing.acquisition.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });

  const label = PLATFORM_META[platform].label;

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

  const e = eff.data?.result;
  const cc = e?.currency_code ?? 'INR';
  const platformSpend = e ? (platform === 'meta' ? e.meta_spend_mu : e.google_spend_mu) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{label}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sugandh Lok — {label} spend &amp; acquisition efficiency</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="ads-from" className="sr-only">From date</label>
          <input id="ads-from" type="date" value={dateStart} onChange={(ev) => setDateStart(ev.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="ads-to" className="sr-only">To date</label>
          <input id="ads-to" type="date" value={dateEnd} onChange={(ev) => setDateEnd(ev.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {(eff.isLoading || acq.isLoading) && (
        <div aria-busy="true" aria-label={`Loading ${label}`} className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {eff.error && <ErrorDisplay title={`Failed to load ${label}`} message={eff.error.message} requestId={(eff.error as { data?: { requestId?: string } }).data?.requestId} />}

      {e && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Spend &amp; efficiency</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={`${label} spend`} value={platformSpend == null ? '—' : formatMoney(platformSpend, cc)} />
            <Stat label="Total ad spend" value={formatMoney(e.total_ad_spend_mu, cc)} />
            <Stat label="MER (blended)" value={formatBpMultiple(e.mer_bp)} />
            <Stat label="aMER (acquisition)" value={formatBpMultiple(e.amer_bp)} />
          </div>
        </section>
      )}

      {acq.data?.summary && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Acquisition</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="New customers" value={String(acq.data.summary.new_customers_count)} />
            <Stat label="Blended CAC" value={acq.data.summary.cac_mu == null ? '—' : formatMoney(acq.data.summary.cac_mu, cc)} />
            <Stat label="Acquisition ad spend" value={formatMoney(acq.data.summary.acquisition_ad_spend_mu, cc)} />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Campaign breakdown</h2>
        <ConnectorPending
          source={`${label} campaigns`}
          detail={`Per-campaign performance syncs from ${label} via OAuth. Connect to see the campaign-level breakdown.`}
          deferredAction={`Connect ${label}`}
        />
      </section>
    </div>
  );
}

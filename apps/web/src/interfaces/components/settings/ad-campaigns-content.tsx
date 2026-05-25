'use client';

// @paradigm: sql
// AdCampaignsContent — the /settings/ad-campaigns page (Phase-2 slice-10).
// REUSE-only: the campaign-classification view built on slice-4 marketing.acquisition.
// Renders the REAL acquisition-vs-total spend split (acquisition_ad_spend_mu /
// total_ad_spend_mu, both seeded) — the honest classification headline. Per-campaign
// classification EDITING (saving intents — a WRITE) is DEFERRED. Per-campaign rows are
// OAuth-fetched live and not seeded → honest affordance. CF-C6-RENDER-ONLY-1.

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { ConnectorPending } from '@/interfaces/components/shared/connector-pending.js';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function AdCampaignsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));
  const enabled = Boolean(isAuthenticated && workspaceId);

  const q = trpc.marketing.acquisition.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });

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

  const s = q.data?.summary;
  const cc = s?.currency_code ?? 'INR';
  const nonAcq = s ? s.total_ad_spend_mu - s.acquisition_ad_spend_mu : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Ad Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sugandh Lok — spend by acquisition classification</p>
        </div>
        <button type="button" disabled title="Editing classifications is available after connector cutover" className="cursor-not-allowed rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60">Edit classifications (coming soon)</button>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading ad campaigns" className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && <ErrorDisplay title="Failed to load ad campaigns" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />}

      {s && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Spend by classification</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Total ad spend" value={formatMoney(s.total_ad_spend_mu, cc)} />
            <Stat label="Acquisition spend" value={formatMoney(s.acquisition_ad_spend_mu, cc)} />
            <Stat label="Non-acquisition spend" value={nonAcq == null ? '—' : formatMoney(nonAcq, cc)} />
            <Stat label="Meta spend" value={formatMoney(s.meta_spend_mu, cc)} />
            <Stat label="Google spend" value={formatMoney(s.google_spend_mu, cc)} />
            <Stat label="New customers" value={String(s.new_customers_count)} />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Per-campaign classification</h2>
        <ConnectorPending
          source="Campaign-level classification"
          detail="Per-campaign intent classification syncs from Meta/Google via OAuth. Connect to classify individual campaigns."
        />
      </section>
    </div>
  );
}

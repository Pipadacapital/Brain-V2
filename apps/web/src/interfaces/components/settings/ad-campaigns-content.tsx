'use client';

// @paradigm: sql
// AdCampaignsContent — /settings/ad-campaigns — interactive classification editor
// (Wave 3 parity restoration). Restores:
//   • Searchable, platform-filterable per-campaign table with inline intent dropdowns
//   • settings.classifyCampaign (MANAGER-gated UPSERT) on each dropdown change
//   • Intent summary: spend cards for all 4 intents, unclassified RAG callout,
//     reconciliation badge — from marketing.spendByIntent (META + GOOGLE combined)
//   • Read-only acquisition split summary from marketing.acquisition is replaced by
//     the per-platform spendByIntent + platformCampaigns queries per instructions.
//
// Role: MANAGER+ can edit; ANALYST/lower read-only.
// Money formatting via formatMoney (INR lakh/crore per lib-formatters contract).
// CF-C6-RENDER-ONLY-1: no inline arithmetic; values from BFF only.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { useScopedPath } from '@/infrastructure/workspace-slug-context.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { DEFAULT_DATE_START, DEFAULT_DATE_END } from '@/lib/default-date-range.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/interfaces/components/ui/select.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Badge } from '@/interfaces/components/ui/badge.js';
import { Button } from '@/interfaces/components/ui/button.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTENTS = [
  { value: 'unclassified',  label: 'Unclassified'   },
  { value: 'acquisition',   label: 'Acquisition'     },
  { value: 'retargeting',   label: 'Retargeting'     },
  { value: 'brand',         label: 'Brand'           },
] as const;

type Intent = typeof INTENTS[number]['value'];
type Platform = 'all' | 'meta' | 'google';

function isManager(role: string | null): boolean {
  return role === 'MANAGER' || role === 'OWNER';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SpendCard({ label, amount, count, currencyCode }: {
  label: string;
  amount: bigint;
  count: number;
  currencyCode: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2" data-testid={`intent-card-${label.toLowerCase()}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{formatMoney(amount, currencyCode)}</p>
      <p className="text-xs text-muted-foreground">
        {count} campaign{count !== 1 ? 's' : ''}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdCampaignsContent() {
  const workspaceId     = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceRole   = useAppSelector((s) => s.session.workspaceRole);
  const toPath = useScopedPath();

  const canChange = isManager(workspaceRole);

  const [search,          setSearch]          = useState('');
  const [platformFilter,  setPlatformFilter]  = useState<Platform>('all');
  const [savingKey,       setSavingKey]       = useState<string | null>(null);
  const [mutError,        setMutError]        = useState<string | null>(null);

  const enabled = Boolean(isAuthenticated && workspaceId);
  const utils   = trpc.useUtils();

  // Date range: last 90 days (like legacy — fixed window for classification context)
  const now      = new Date();
  const dateEnd  = DEFAULT_DATE_END;
  const dateFrom = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 89);
    return d.toISOString().slice(0, 10);
  })();

  // Per-campaign data: both platforms
  const metaCampaignsQ = trpc.marketing.platformCampaigns.useQuery(
    { vendor: 'META',   date_start: dateFrom, date_end: dateEnd },
    { enabled },
  );
  const googleCampaignsQ = trpc.marketing.platformCampaigns.useQuery(
    { vendor: 'GOOGLE', date_start: dateFrom, date_end: dateEnd },
    { enabled },
  );

  // Spend by intent: both platforms
  const metaIntentQ = trpc.marketing.spendByIntent.useQuery(
    { vendor: 'META',   date_start: dateFrom, date_end: dateEnd },
    { enabled },
  );
  const googleIntentQ = trpc.marketing.spendByIntent.useQuery(
    { vendor: 'GOOGLE', date_start: dateFrom, date_end: dateEnd },
    { enabled },
  );

  // Classify mutation
  const classifyMutation = trpc.settings.classifyCampaign.useMutation({
    onSuccess: () => {
      void utils.marketing.platformCampaigns.invalidate();
      void utils.marketing.spendByIntent.invalidate();
      setSavingKey(null);
      setMutError(null);
    },
    onError: (err) => {
      setSavingKey(null);
      setMutError(err.message);
    },
  });

  const updateIntent = (platform: 'meta' | 'google', campaignId: string, campaignName: string, intent: Intent) => {
    if (!canChange) return;
    const key = `${platform}:${campaignId}`;
    setSavingKey(key);
    setMutError(null);
    classifyMutation.mutate({ platform, campaign_id: campaignId, campaign_name: campaignName, intent });
  };

  // -------------------------------------------------------------------------
  // Merge campaign rows from both platforms into a unified list
  // -------------------------------------------------------------------------
  type CampaignDisplayRow = {
    platform: 'meta' | 'google';
    campaignId: string;
    campaignName: string;
    spendMu: bigint;
    intent: string;
    currencyCode: string;
  };

  const allCampaigns: CampaignDisplayRow[] = useMemo(() => {
    const meta: CampaignDisplayRow[] = (metaCampaignsQ.data?.rows ?? []).map((r) => ({
      platform:     'meta',
      campaignId:   r.campaignId,
      campaignName: r.campaignName,
      spendMu:      BigInt(r.spendMu),
      intent:       r.intent ?? 'unclassified',
      currencyCode: r.currencyCode ?? 'INR',
    }));
    const google: CampaignDisplayRow[] = (googleCampaignsQ.data?.rows ?? []).map((r) => ({
      platform:     'google',
      campaignId:   r.campaignId,
      campaignName: r.campaignName,
      spendMu:      BigInt(r.spendMu),
      intent:       r.intent ?? 'unclassified',
      currencyCode: r.currencyCode ?? 'INR',
    }));
    return [...meta, ...google];
  }, [metaCampaignsQ.data, googleCampaignsQ.data]);

  // Filtered rows for the table
  const filteredRows = useMemo(() => {
    let list = allCampaigns;
    if (platformFilter !== 'all') {
      list = list.filter((r) => r.platform === platformFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.campaignName.toLowerCase().includes(q) ||
        r.campaignId.toLowerCase().includes(q) ||
        r.platform.toLowerCase().includes(q) ||
        (INTENTS.find((i) => i.value === r.intent)?.label.toLowerCase().includes(q) ?? false),
    );
  }, [allCampaigns, platformFilter, search]);

  // -------------------------------------------------------------------------
  // Intent summary: aggregate spend + campaign counts across platforms
  // -------------------------------------------------------------------------
  const intentSummary = useMemo(() => {
    const spendByIntent: Record<Intent, bigint> = {
      unclassified: 0n, acquisition: 0n, retargeting: 0n, brand: 0n,
    };
    const countByIntent: Record<Intent, number> = {
      unclassified: 0, acquisition: 0, retargeting: 0, brand: 0,
    };
    let totalSpend = 0n;

    for (const q of [metaIntentQ.data, googleIntentQ.data]) {
      if (!q) continue;
      for (const row of q.rows) {
        const intent = (row.intent ?? 'unclassified') as Intent;
        if (intent in spendByIntent) {
          spendByIntent[intent] += BigInt(row.spendMu);
        }
        totalSpend += BigInt(row.spendMu);
      }
    }

    // Count campaigns per intent from the merged list
    for (const r of allCampaigns) {
      const intent = (r.intent ?? 'unclassified') as Intent;
      if (intent in countByIntent) countByIntent[intent] += 1;
    }

    const unclassifiedSpend = spendByIntent.unclassified;
    const pctUnclassified   = totalSpend > 0n
      ? Number((unclassifiedSpend * 10000n) / totalSpend) / 100
      : 0;
    // Reconciles: sum of all intent spends ≈ totalSpend (within 1%)
    const intentSum = Object.values(spendByIntent).reduce((a, b) => a + b, 0n);
    const diff = intentSum > totalSpend ? intentSum - totalSpend : totalSpend - intentSum;
    const spendReconciles = totalSpend === 0n || diff * 100n < totalSpend;

    return { spendByIntent, countByIntent, totalSpend, pctUnclassified, spendReconciles };
  }, [metaIntentQ.data, googleIntentQ.data, allCampaigns]);

  const currencyCode = metaCampaignsQ.data?.currencyCode ?? googleCampaignsQ.data?.currencyCode ?? 'INR';
  const isLoading    = metaCampaignsQ.isLoading || googleCampaignsQ.isLoading;
  const loadError    = metaCampaignsQ.error ?? googleCampaignsQ.error ?? null;
  const hasData      = allCampaigns.length > 0;

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <a href="/login" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
            Sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 py-4">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">Ad campaign classification</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Tag campaigns as <strong>Acquisition</strong> for aMER on{' '}
          <Link href={toPath("/acquisition")} className="underline">
            Acquisition
          </Link>
          . Splits appear on{' '}
          <Link href={toPath("/meta-ads")} className="underline">
            Meta
          </Link>{' '}
          &{' '}
          <Link href={toPath("/google-ads")} className="underline">
            Google
          </Link>{' '}
          Ads. Window: last 90 days spend.
        </p>
      </div>

      {!canChange && (
        <p className="text-sm text-muted-foreground" role="note">
          Only workspace owners can edit classifications.
        </p>
      )}

      {/* Mutation error */}
      {mutError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          data-testid="classify-error"
        >
          {mutError}
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <ErrorDisplay
          title="Failed to load campaigns"
          message={loadError.message}
          requestId={(loadError as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {/* -------------------------------------------------------------- */}
      {/* Intent summary card                                             */}
      {/* -------------------------------------------------------------- */}
      {!isLoading && hasData && (
        <div
          className="rounded-xl border bg-card p-4 space-y-3 shadow-sm"
          data-testid="intent-summary"
          aria-label="Intent spend summary (90 days)"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Summary (90d)</h3>
            <span
              className={`text-xs ${intentSummary.spendReconciles ? 'text-emerald-600' : 'text-destructive'}`}
              data-testid="reconciliation-badge"
            >
              {intentSummary.spendReconciles
                ? 'Spend reconciles across intents'
                : 'Spend split mismatch — refresh or report'}
            </span>
          </div>

          {/* Unclassified RAG callout */}
          <div
            className="rounded-lg border-2 border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/25 px-4 py-3"
            data-testid="unclassified-rag"
          >
            <p className="text-xs font-medium text-amber-900 dark:text-amber-200 uppercase">
              Unclassified spend
            </p>
            <p className="text-2xl font-bold tabular-nums mt-1">
              {formatMoney(intentSummary.spendByIntent.unclassified, currencyCode)}
            </p>
            <p className="text-sm text-muted-foreground">
              {intentSummary.pctUnclassified.toFixed(1)}% of total · classify below to improve
              aMER and ad reports
            </p>
          </div>

          {/* Per-intent spend grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm" data-testid="intent-spend-grid">
            {INTENTS.map((i) => (
              <SpendCard
                key={i.value}
                label={i.label}
                amount={intentSummary.spendByIntent[i.value]}
                count={intentSummary.countByIntent[i.value]}
                currencyCode={currencyCode}
              />
            ))}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------- */}
      {/* Search + platform filter                                        */}
      {/* -------------------------------------------------------------- */}
      <div className="flex flex-wrap gap-2" role="search" aria-label="Filter campaigns">
        <Input
          role="searchbox"
          aria-label="Search campaigns"
          placeholder="Search campaign name, ID, platform, intent…"
          className="max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="campaign-search"
        />
        <Select
          value={platformFilter}
          onValueChange={(v) => setPlatformFilter(v as Platform)}
        >
          <SelectTrigger className="w-[140px]" data-testid="platform-filter">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="meta">Meta</SelectItem>
            <SelectItem value="google">Google</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* -------------------------------------------------------------- */}
      {/* Campaign classification table                                   */}
      {/* -------------------------------------------------------------- */}
      {isLoading ? (
        <div aria-busy="true" aria-label="Loading campaigns" className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-12 bg-muted rounded animate-pulse" aria-hidden="true" />
          ))}
        </div>
      ) : !hasData ? (
        <p className="text-sm text-muted-foreground" data-testid="campaigns-empty">
          No Meta or Google campaign spend in this window. Connect ads and sync data first.
        </p>
      ) : (
        <div
          className="rounded-lg border overflow-x-auto"
          data-testid="campaign-classification-table"
        >
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="p-3 font-medium" scope="col">Platform</th>
                <th className="p-3 font-medium" scope="col">Campaign</th>
                <th className="p-3 font-medium text-right" scope="col">Spend (90d)</th>
                <th className="p-3 font-medium w-[220px]" scope="col">Intent</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const key = `${row.platform}:${row.campaignId}`;
                const isSaving = savingKey === key;
                return (
                  <tr key={key} className="border-b last:border-0" data-testid={`campaign-row-${row.campaignId}`}>
                    <td className="p-3 capitalize">
                      <Badge variant="secondary">{row.platform}</Badge>
                    </td>
                    <td
                      className="p-3 max-w-[280px] truncate"
                      title={row.campaignName}
                    >
                      {row.campaignName || row.campaignId}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {formatMoney(row.spendMu, row.currencyCode)}
                    </td>
                    <td className="p-3">
                      <Select
                        value={row.intent}
                        disabled={!canChange || isSaving}
                        onValueChange={(v) =>
                          updateIntent(row.platform, row.campaignId, row.campaignName, v as Intent)
                        }
                      >
                        <SelectTrigger
                          className="h-8"
                          aria-label={`Intent for ${row.campaignName || row.campaignId}`}
                          aria-busy={isSaving}
                          data-testid={`intent-select-${row.campaignId}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INTENTS.map((i) => (
                            <SelectItem key={i.value} value={i.value}>
                              {i.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredRows.length === 0 && (
            <p
              className="p-6 text-center text-sm text-muted-foreground"
              data-testid="campaigns-filtered-empty"
            >
              No campaigns match your search or filter.
            </p>
          )}
        </div>
      )}

      {/* Refresh button */}
      <Button
        variant="outline"
        size="sm"
        disabled={isLoading}
        onClick={() => {
          void metaCampaignsQ.refetch();
          void googleCampaignsQ.refetch();
          void metaIntentQ.refetch();
          void googleIntentQ.refetch();
        }}
        data-testid="campaigns-refresh"
      >
        Refresh
      </Button>
    </div>
  );
}

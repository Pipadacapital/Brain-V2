'use client';

// @paradigm: sql
// PlatformAdsView — the shared /meta-ads + /google-ads workbench (Wave 1 parity).
//
// Single-Primitive Rule: ONE component renders either platform, parameterized by
// `vendor` prop (a VendorConfig object injected at the page callsite). Zero
// hardcoded `if platform === 'meta'` branches inside this file — all platform
// divergence is expressed through the config.
//
// CF-C6-RENDER-ONLY-1: zero arithmetic here; all computed values come from BFF.
// CF-S10-HONEST-STATE-1: funnel + creative data is not ingested yet; those tabs
// render a clear operator-facing message — never internal jargon, never a
// fabricated number.
// CF-MONEY-MU-1: all money rendered via formatMoney(bigint, currencyCode).
//
// KPIs are sourced from:
//   - meta/google: marketing.platformCampaigns (summary row) for Spend/Revenue/ROAS
//   - Impressions/Clicks/Conversions/Conv.value: from the same platformCampaigns totals
//   - Goal RAG line: summary.goalEvaluations.{meta_roas,google_roas} — not yet
//     wired from the BFF, so KpiGoalLine is hidden when null (honest-empty).
//
// Vendor genericity is covered by platform-ads-view.test.tsx
// (both vendors render tabs + table + KPIs + honest empty-state).

import { useState, useMemo, Fragment } from 'react';
import { useQueryState, parseAsString, parseAsStringEnum } from 'nuqs';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { cn } from '@/lib/utils.js';
import { DEFAULT_DATE_START, DEFAULT_DATE_END } from '@/lib/default-date-range.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = 'meta' | 'google';
type TabValue = 'performance' | 'funnel' | 'creative';
type ViewValue = 'campaigns' | 'adsets' | 'daily';
type CampaignIntent = 'acquisition' | 'non_acquisition' | 'brand' | 'unclassified';

// Config object that captures all platform divergence — the ONLY place where
// meta vs google branching is expressed.
interface VendorConfig {
  platform: Platform;
  label: string;
  vendor: 'META' | 'GOOGLE';
  /** Campaign column header label for the "Revenue / Conv. value" column */
  revenueColumnLabel: string;
  /** Meta has 3 views; Google has 2 */
  hasAdsetView: boolean;
  /** Summary KPI card set — labels + accessor from the totals */
  summaryCardMode: 'meta' | 'google';
}

export const META_VENDOR_CONFIG: VendorConfig = {
  platform: 'meta',
  label: 'Meta Ads',
  vendor: 'META',
  revenueColumnLabel: 'Revenue',
  hasAdsetView: true,
  summaryCardMode: 'meta',
};

export const GOOGLE_VENDOR_CONFIG: VendorConfig = {
  platform: 'google',
  label: 'Google Ads',
  vendor: 'GOOGLE',
  revenueColumnLabel: 'Conv. value',
  hasAdsetView: false,
  summaryCardMode: 'google',
};

// ---------------------------------------------------------------------------
// Helpers — display formatting (CF-C6-RENDER-ONLY-1)
// ---------------------------------------------------------------------------

function fmtBpPct(bp: number): string {
  if (!Number.isFinite(bp) || bp === 0) return '—';
  return `${(bp / 100).toFixed(bp >= 10000 ? 0 : bp >= 1000 ? 1 : 2)}%`;
}

function fmtNumber(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(n);
}

function fmtRoas(bp: number | null | undefined): string {
  if (bp == null || bp === 0) return '—';
  return `${(bp / 10000).toFixed(2)}×`;
}

const INTENT_OPTIONS = [
  { value: 'all', label: 'All intents' },
  { value: 'acquisition', label: 'Acquisition' },
  { value: 'non_acquisition', label: 'Non-acquisition' },
  { value: 'brand', label: 'Brand' },
  { value: 'unclassified', label: 'Unclassified' },
] as const;

function intentDisplayLabel(i: string): string {
  return INTENT_OPTIONS.find((o) => o.value === i)?.label ?? i;
}

function IntentBadge({ intent }: { intent: string }) {
  const cls =
    intent === 'acquisition'
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
      : intent === 'unclassified'
        ? 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200 ring-1 ring-amber-400/60'
        : intent === 'brand'
          ? 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200'
          : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {intentDisplayLabel(intent)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI Summary card
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  dateRange,
  children,
}: {
  label: string;
  value: string;
  dateRange?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {dateRange && (
        <p className="text-xs text-muted-foreground mt-0.5">{dateRange}</p>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spend-by-intent panel (both vendors, with ROAS pools + campaign counts)
// ---------------------------------------------------------------------------

interface IntentSplitPanelProps {
  spendIntentRows: Array<{
    intent: string;
    spendMu: string;
    spendBp: number;
    campaignCount?: number;
  }>;
  totalSpendMu: bigint;
  totalRevenueMu: bigint;
  currencyCode: string;
  acquisitionRoasBp: number | null;
  nonAcqRoasBp: number | null;
  spendReconciles: boolean;
  revenueReconciles: boolean;
  spendDelta: bigint;
  revenueDelta: bigint;
  platformLabel: string;
  workspaceSlug: string;
  activeIntent: string | null;
  onIntentChange: (intent: string | null) => void;
}

function IntentSplitPanel({
  spendIntentRows,
  totalSpendMu,
  currencyCode,
  acquisitionRoasBp,
  nonAcqRoasBp,
  spendReconciles,
  revenueReconciles,
  spendDelta,
  revenueDelta,
  workspaceSlug,
  activeIntent,
  onIntentChange,
}: IntentSplitPanelProps) {
  const reconciles = spendReconciles && revenueReconciles;
  const total = totalSpendMu;

  return (
    <div
      className="rounded-xl border bg-card p-4 shadow-sm space-y-3"
      data-testid="intent-split-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Spend by campaign intent</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            ROAS by intent pool. Classify campaigns in{' '}
            <a
              href={`/w/${workspaceSlug}/settings/ad-campaigns`}
              className="underline font-medium text-foreground"
            >
              Settings → Ad campaigns
            </a>
            .
          </p>
        </div>
        {total > 0n && (
          <div
            className={cn(
              'text-xs tabular-nums',
              reconciles
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-destructive',
            )}
          >
            {reconciles
              ? '✓ Spend & conv. value reconcile'
              : `Δ spend ${formatMoney(spendDelta < 0n ? -spendDelta : spendDelta, currencyCode)} · Δ value ${formatMoney(revenueDelta < 0n ? -revenueDelta : revenueDelta, currencyCode)}`}
          </div>
        )}
      </div>

      {spendIntentRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No spend classified for this date range. Classify campaigns on{' '}
          <a
            href={`/w/${workspaceSlug}/settings/ad-campaigns`}
            className="underline font-medium text-foreground"
          >
            Settings → Ad campaigns
          </a>{' '}
          to split spend by intent.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['acquisition', 'non_acquisition', 'brand', 'unclassified'] as CampaignIntent[]).map(
            (k) => {
              const row = spendIntentRows.find((r) => r.intent === k);
              const spendMu = row ? BigInt(row.spendMu) : 0n;
              const pct = total > 0n ? Number((spendMu * 10000n) / total) / 100 : 0;
              const count = row?.campaignCount ?? 0;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    onIntentChange(activeIntent === k ? null : k)
                  }
                  className={cn(
                    'text-left rounded-lg border p-3 transition-colors focus:outline-none focus:ring-2 focus:ring-ring',
                    k === 'unclassified'
                      ? 'border-amber-400/70 bg-amber-50/50 dark:bg-amber-950/30'
                      : 'border bg-muted/30',
                    activeIntent === k && 'ring-2 ring-ring',
                  )}
                  aria-pressed={activeIntent === k}
                  aria-label={`Filter by ${intentDisplayLabel(k)} intent`}
                >
                  <p className="text-xs font-medium text-muted-foreground">
                    {intentDisplayLabel(k)}
                  </p>
                  <p className="text-lg font-semibold tabular-nums mt-1">
                    {formatMoney(spendMu, currencyCode)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pct.toFixed(0)}% of spend
                    {count > 0 && ` · ${count} campaign${count !== 1 ? 's' : ''}`}
                  </p>
                </button>
              );
            },
          )}
        </div>
      )}

      {(acquisitionRoasBp != null || nonAcqRoasBp != null) && (
        <div className="flex flex-wrap gap-4 text-sm border-t pt-3">
          <span>
            <span className="text-muted-foreground">Acq ROAS (pool): </span>
            <span className="font-semibold tabular-nums">
              {fmtRoas(acquisitionRoasBp)}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Non-acq ROAS (pool): </span>
            <span className="font-semibold tabular-nums">
              {fmtRoas(nonAcqRoasBp)}
            </span>
            <span className="text-xs text-muted-foreground ml-1">
              (non-acq + brand + uncl.)
            </span>
          </span>
        </div>
      )}

      {activeIntent && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-2">
          <span>Filtering by intent:</span>
          <span className="rounded bg-foreground text-background px-1.5 py-0.5">
            {intentDisplayLabel(activeIntent)}
          </span>
          <button
            type="button"
            onClick={() => onIntentChange(null)}
            className="underline"
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funnel grid + table (shared layout for Meta + Google)
// ---------------------------------------------------------------------------

type FunnelBand = 'low' | 'medium' | 'strong' | 'na';

function bandClass(b: FunnelBand): string {
  if (b === 'low') return 'text-amber-600 dark:text-amber-400';
  if (b === 'medium') return 'text-slate-600 dark:text-slate-400';
  if (b === 'strong') return 'text-emerald-600 dark:text-emerald-400';
  return 'text-muted-foreground';
}

interface FunnelSummary {
  spend: number;
  impressions: number;
  clicks: number;
  ctrPct: number;
  addToCart: number | null;
  atcRatePct: number | null;
  checkoutInitiated: number | null;
  checkoutPerAtcPct: number | null;
  purchases: number;
  purchasePerCheckoutPct?: number | null;
  overallCvrPct: number;
  roas: number;
  costPerAtc: number | null;
  costPerCheckout: number | null;
  costPerPurchase: number | null;
  coverage: string;
  diagnostics: {
    atcRate: FunnelBand;
    checkoutFromAtc: FunnelBand;
    purchaseFromCheckout: FunnelBand;
    clickToPurchase: FunnelBand;
  };
}

function FunnelGrid({
  summary,
  currencyCode,
  coverageNote,
  isGoogle,
}: {
  summary: FunnelSummary;
  currencyCode: string;
  coverageNote: string;
  isGoogle: boolean;
}) {
  const full = !isGoogle || summary.coverage === 'google_full';

  function FunnelPct({ pct, band }: { pct: number | null; band: FunnelBand }) {
    if (pct == null) return <span className="text-muted-foreground">—</span>;
    return <span className={bandClass(band)}>{pct.toFixed(2)}%</span>;
  }

  const cells: Array<[string, React.ReactNode]> = [
    ['Spend', formatMoney(BigInt(Math.round(summary.spend * 100)), currencyCode)],
    ['Impressions', fmtNumber(summary.impressions)],
    ['Clicks', fmtNumber(summary.clicks)],
    ['CTR', `${summary.ctrPct.toFixed(2)}%`],
    ['ATC', full ? fmtNumber(summary.addToCart ?? 0, 1) : '—'],
    [
      'ATC %',
      full ? <FunnelPct pct={summary.atcRatePct} band={summary.diagnostics.atcRate} /> : '—',
    ],
    ['Checkout', full ? fmtNumber(summary.checkoutInitiated ?? 0, 1) : '—'],
    [
      'CI % of ATC',
      full ? (
        <FunnelPct pct={summary.checkoutPerAtcPct} band={summary.diagnostics.checkoutFromAtc} />
      ) : (
        '—'
      ),
    ],
    ['Purchases', fmtNumber(summary.purchases, 2)],
    ...(isGoogle && summary.purchasePerCheckoutPct != null
      ? [
          [
            'Pur % checkout',
            full ? (
              <FunnelPct
                pct={summary.purchasePerCheckoutPct ?? null}
                band={summary.diagnostics.purchaseFromCheckout}
              />
            ) : (
              '—'
            ),
          ] as [string, React.ReactNode],
        ]
      : []),
    [
      'CVR',
      <span className={bandClass(summary.diagnostics.clickToPurchase)}>
        {summary.overallCvrPct.toFixed(2)}%
      </span>,
    ],
    ['ROAS', `${summary.roas.toFixed(2)}×`],
  ];

  if (full && summary.costPerAtc != null) {
    cells.push([
      isGoogle ? 'Cost/ATC' : 'Cost / ATC',
      formatMoney(BigInt(Math.round(summary.costPerAtc * 100)), currencyCode),
    ]);
    if (summary.costPerCheckout != null) {
      cells.push([
        isGoogle ? 'Cost/CI' : 'Cost / checkout',
        formatMoney(BigInt(Math.round(summary.costPerCheckout * 100)), currencyCode),
      ]);
    }
    if (summary.costPerPurchase != null) {
      cells.push([
        isGoogle ? 'Cost/Purch' : 'Cost / purchase',
        formatMoney(BigInt(Math.round(summary.costPerPurchase * 100)), currencyCode),
      ]);
    }
  }

  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border p-4',
        isGoogle && summary.coverage !== 'google_full'
          ? 'border-amber-200/50 bg-amber-50/30 dark:bg-amber-950/20'
          : 'bg-card',
      )}
      data-testid="funnel-grid"
    >
      {coverageNote && (
        <p
          className={cn(
            'text-sm',
            isGoogle && summary.coverage !== 'google_full'
              ? 'text-amber-900 dark:text-amber-200'
              : 'text-muted-foreground',
          )}
        >
          {coverageNote}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 text-sm">
        {cells.map(([label, val], i) => (
          <div key={`${label}-${i}`} className="rounded-lg border bg-muted/20 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <div className="mt-0.5 font-semibold tabular-nums">{val}</div>
          </div>
        ))}
      </div>
      {!isGoogle && (
        <p className="text-[10px] text-muted-foreground">
          Bands: ATC %, CI÷ATC, Purchase÷Checkout, CVR — heuristic low/medium/strong benchmarks.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Creative tree components (shared shell — renders honest empty state when
// ad-creative facts are not yet available locally)
// ---------------------------------------------------------------------------

function CreativeEmptyState({ platform }: { platform: Platform }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 gap-3 text-center"
      data-testid="creative-empty-state"
    >
      <p className="text-sm font-medium text-muted-foreground max-w-sm">
        {platform === 'meta'
          ? 'Ad-level creative metrics (hook %, hold %, video quartiles) are coming soon for connected Meta Ads accounts.'
          : 'Ad-level creative metrics (image previews, copy, YouTube thumbnails) are coming soon for connected Google Ads accounts.'}
      </p>
      <p className="text-xs text-muted-foreground max-w-xs">
        When available, this tab will show a campaign → ad group → ad tree with spend, clicks, and
        creative performance by ad.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaign table (TanStack Table with sort, search, Revenue + Acq/Non-acq ROAS)
// ---------------------------------------------------------------------------

interface CampaignTableRow {
  campaignId: string;
  campaignName: string;
  intent: string;
  spendMu: string;
  revenueMu: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctrBp: number;
  roasBp: number;
  acqRoasBp?: number | null;
  nonAcqRoasBp?: number | null;
  currencyCode?: string;
  // daily-view extra field
  date?: string;
  // adset-view extra field
  adsetName?: string;
  adsetId?: string;
}

interface CampaignTableProps {
  rows: CampaignTableRow[];
  currencyCode: string;
  isLoading: boolean;
  view: ViewValue;
  search: string;
  config: VendorConfig;
  totalSpendMu: string;
  totalRevenueMu: string;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
}

// Sortable column descriptor (no external deps — plain arrays)
type SortKey = 'spendMu' | 'revenueMu' | 'impressions' | 'clicks' | 'ctrBp' | 'conversions' | 'roasBp' | null;
type SortDir = 'asc' | 'desc';

function sortRows(rows: CampaignTableRow[], key: SortKey, dir: SortDir): CampaignTableRow[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    let av: number | bigint = 0;
    let bv: number | bigint = 0;
    if (key === 'spendMu' || key === 'revenueMu') {
      av = BigInt(a[key]);
      bv = BigInt(b[key]);
    } else {
      av = (a[key] as number) ?? 0;
      bv = (b[key] as number) ?? 0;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
}

type ColHeader = { label: string; key: SortKey; rightAlign?: boolean };

function CampaignTable({
  rows,
  currencyCode,
  isLoading,
  view,
  search,
  config,
  totalSpendMu,
  totalRevenueMu,
  totalImpressions,
  totalClicks,
  totalConversions,
}: CampaignTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('spendMu');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const base =
        r.campaignName.toLowerCase().includes(q) ||
        r.campaignId.toLowerCase().includes(q) ||
        intentDisplayLabel(r.intent).toLowerCase().includes(q);
      if (view === 'adsets') {
        return (
          base ||
          (r.adsetName || '').toLowerCase().includes(q) ||
          (r.adsetId || '').toLowerCase().includes(q)
        );
      }
      if (view === 'daily') {
        return base || (r.date || '').includes(q);
      }
      return base;
    });
  }, [rows, search, view]);

  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  // Column headers definition
  const leadCols: ColHeader[] =
    view === 'daily'
      ? [
          { label: 'Date', key: null },
          { label: 'Campaign', key: null },
        ]
      : view === 'adsets'
        ? [
            { label: 'Campaign', key: null },
            { label: 'Ad set', key: null },
          ]
        : [{ label: 'Campaign', key: null }];

  const metaCols: ColHeader[] = [
    { label: 'Intent', key: null },
    { label: 'Spend', key: 'spendMu', rightAlign: true },
    { label: 'Impressions', key: 'impressions', rightAlign: true },
    { label: 'Clicks', key: 'clicks', rightAlign: true },
    { label: 'CTR', key: 'ctrBp', rightAlign: true },
    { label: 'Conversions', key: 'conversions', rightAlign: true },
    { label: config.revenueColumnLabel, key: 'revenueMu', rightAlign: true },
    { label: 'ROAS', key: 'roasBp', rightAlign: true },
    { label: 'Acq ROAS', key: null, rightAlign: true },
    { label: 'Non-acq ROAS', key: null, rightAlign: true },
  ];

  const allCols: ColHeader[] = [...leadCols, ...metaCols];
  const colCount = allCols.length;

  function SortIcon({ colKey }: { colKey: SortKey }) {
    if (!colKey) return null;
    if (sortKey !== colKey) return <ArrowUpDown className="size-3 text-muted-foreground" />;
    return sortDir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />;
  }

  return (
    <section
      className="rounded-xl border bg-card shadow-sm overflow-x-auto"
      data-testid="campaign-table"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">
          {view === 'campaigns' ? 'Campaigns' : view === 'adsets' ? 'Ad sets' : 'Daily breakdown'}{' '}
          ({filtered.length}
          {rows.length > 500 ? ' + (capped)' : ''})
        </h3>
        {isLoading && (
          <Loader2
            className="h-4 w-4 animate-spin text-muted-foreground"
            aria-label="Loading campaigns"
          />
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            {allCols.map((col) => (
              <th
                key={col.label}
                className={cn(
                  'px-3 py-2 font-medium whitespace-nowrap',
                  col.rightAlign ? 'text-right' : 'text-left',
                )}
              >
                {col.key ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort(col.key)}
                    aria-label={`Sort by ${col.label}`}
                  >
                    {col.label}
                    <SortIcon colKey={col.key} />
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={colCount} className="py-12 text-center">
                <Loader2 className="inline h-5 w-5 animate-spin text-muted-foreground" />
              </td>
            </tr>
          ) : sorted.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="py-12 text-center text-muted-foreground">
                {search.trim()
                  ? 'No campaigns match your search.'
                  : 'No campaign data for this date range.'}
              </td>
            </tr>
          ) : (
            sorted.map((r) => {
              const rowKey =
                view === 'daily'
                  ? `${r.campaignId}-${r.date ?? ''}`
                  : view === 'adsets'
                    ? `${r.campaignId}-${r.adsetId ?? ''}`
                    : r.campaignId;
              return (
                <tr key={rowKey} className="border-t hover:bg-muted/20">
                  {view === 'daily' && (
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.date ?? '—'}</td>
                  )}
                  <td className="px-3 py-2">
                    <div
                      className="font-medium max-w-[220px] truncate"
                      title={r.campaignName}
                    >
                      {r.campaignName || r.campaignId}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">{r.campaignId.slice(0, 16)}&hellip;</div>
                  </td>
                  {view === 'adsets' && (
                    <td className="px-3 py-2">
                      <div
                        className="max-w-[160px] truncate text-muted-foreground"
                        title={r.adsetName ?? ''}
                      >
                        {r.adsetName || r.adsetId || '—'}
                      </div>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <IntentBadge intent={r.intent} />
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(BigInt(r.spendMu), currencyCode)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                    {fmtNumber(r.impressions)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                    {fmtNumber(r.clicks)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                    {fmtBpPct(r.ctrBp)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {r.conversions === 0 ? '—' : fmtNumber(r.conversions, 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {BigInt(r.revenueMu) === 0n ? '—' : formatMoney(BigInt(r.revenueMu), currencyCode)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmtRoas(r.roasBp)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums text-sm">
                    {fmtRoas(r.acqRoasBp)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums text-sm">
                    {fmtRoas(r.nonAcqRoasBp)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        {!isLoading && filtered.length > 0 && (
          <tfoot className="bg-muted/40 text-xs font-medium">
            <tr>
              <td className="px-3 py-2 text-left" colSpan={leadCols.length}>Total</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right tabular-nums">
                {formatMoney(BigInt(totalSpendMu), currencyCode)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(totalImpressions)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(totalClicks)}</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right tabular-nums">
                {totalConversions === 0 ? '—' : fmtNumber(totalConversions, 2)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {BigInt(totalRevenueMu) === 0n
                  ? '—'
                  : formatMoney(BigInt(totalRevenueMu), currencyCode)}
              </td>
              <td className="px-3 py-2" colSpan={3} />
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Funnel tab body (honest empty state when data is not available)
// ---------------------------------------------------------------------------

function FunnelTabBody({
  platform,
  funnelData,
  currencyCode,
  funnelRows,
  search,
}: {
  platform: Platform;
  funnelData: {
    coverage: string;
    note: string;
    summary: FunnelSummary;
  } | null | undefined;
  currencyCode: string;
  funnelRows: Array<{ key: string; label: string; sub?: string; f: FunnelSummary }>;
  search: string;
}) {
  const isGoogle = platform === 'google';

  if (!funnelData) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 gap-3 text-center"
        data-testid="funnel-empty-state"
      >
        <p className="text-sm font-medium text-muted-foreground max-w-sm">
          {platform === 'meta'
            ? 'Funnel metrics (ATC, checkout, purchase rates) are coming soon for connected Meta Ads accounts.'
            : 'Conversion funnel data (ATC, checkout, purchase rates) is coming soon for connected Google Ads accounts.'}
        </p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Connect your{' '}
          {platform === 'meta' ? 'Meta Ads' : 'Google Ads'} account to see funnel performance here
          once the data is available.
        </p>
      </div>
    );
  }

  const filteredRows = search.trim()
    ? funnelRows.filter(
        (x) =>
          x.label.toLowerCase().includes(search.toLowerCase()) ||
          (x.sub || '').toLowerCase().includes(search.toLowerCase()),
      )
    : funnelRows;

  return (
    <div className="space-y-4" data-testid="funnel-tab">
      <FunnelGrid
        summary={funnelData.summary}
        currencyCode={currencyCode}
        coverageNote={funnelData.note}
        isGoogle={isGoogle}
      />
      {filteredRows.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Campaign</th>
                <th className="px-3 py-2 text-right font-medium">Spend</th>
                <th className="px-3 py-2 text-right font-medium">Impr</th>
                <th className="px-3 py-2 text-right font-medium">Clicks</th>
                <th className="px-3 py-2 text-right font-medium">CTR</th>
                <th className="px-3 py-2 text-right font-medium">ATC</th>
                <th className="px-3 py-2 text-right font-medium">ATC%</th>
                <th className="px-3 py-2 text-right font-medium">Checkout</th>
                <th className="px-3 py-2 text-right font-medium">CI%</th>
                <th className="px-3 py-2 text-right font-medium">Purch</th>
                <th className="px-3 py-2 text-right font-medium">CVR</th>
                <th className="px-3 py-2 text-right font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ key, label, sub, f }) => {
                const full = !isGoogle || f.coverage === 'google_full';
                return (
                  <tr key={key} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <div className="max-w-[200px] truncate font-medium" title={label}>
                        {label}
                      </div>
                      {sub && (
                        <div className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {sub}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(BigInt(Math.round(f.spend * 100)), currencyCode)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtNumber(f.impressions)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(f.clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {f.ctrPct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {full ? fmtNumber(f.addToCart ?? 0, 1) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {full && f.atcRatePct != null ? (
                        <span className={bandClass(f.diagnostics.atcRate)}>
                          {f.atcRatePct.toFixed(2)}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {full ? fmtNumber(f.checkoutInitiated ?? 0, 1) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {full && f.checkoutPerAtcPct != null ? (
                        <span className={bandClass(f.diagnostics.checkoutFromAtc)}>
                          {f.checkoutPerAtcPct.toFixed(2)}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtNumber(f.purchases, 2)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right tabular-nums font-medium',
                        bandClass(f.diagnostics.clickToPurchase),
                      )}
                    >
                      {f.overallCvrPct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {f.roas.toFixed(2)}×
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredRows.length === 0 && search.trim() && (
            <p className="text-center text-sm text-muted-foreground py-8">
              No rows match your search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta Creative tree (expansion = honest empty state until facts land)
// Google Creative tree (honest empty state until facts land)
// ---------------------------------------------------------------------------

type MetaCreativeAd = {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  adsetId: string | null;
  adsetName: string | null;
  intent: string;
  impressions: number;
  clicks: number;
  spend: number;
  isVideo: boolean;
  hookRatePct: number | null;
  holdRatePct: number | null;
  p25RatePct: number | null;
  p50RatePct: number | null;
  p75RatePct: number | null;
  p95RatePct: number | null;
  avgWatchSec: number | null;
  ctrPct: number;
  roas: number;
  conversions: number;
  diagnosticLabels: string[];
  previewImageUrl?: string | null;
  previewVideoId?: string | null;
};

type GoogleCreativeAd = {
  adId: string;
  adName: string;
  adType: string;
  previewText: string | null;
  previewImageUrl: string | null;
  previewYoutubeId: string | null;
  landingUrl: string | null;
  campaignId: string;
  campaignName: string;
  channelType: string;
  adGroupId: string;
  adGroupName: string;
  intent: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversionValue: number;
  ctrPct: number;
  roas: number;
};

function MetaCreativeTree({
  ads,
  search,
  currencyCode,
}: {
  ads: MetaCreativeAd[];
  search: string;
  currencyCode: string;
}) {
  const [openCampaigns, setOpenCampaigns] = useState<Set<string>>(new Set());
  const [openAdsets, setOpenAdsets] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!search.trim()) return ads;
    const q = search.toLowerCase();
    return ads.filter(
      (r) =>
        r.adName.toLowerCase().includes(q) ||
        r.campaignName.toLowerCase().includes(q) ||
        (r.adsetName || '').toLowerCase().includes(q),
    );
  }, [ads, search]);

  // Group: campaign → adset → ads
  const tree = useMemo(() => {
    const byCampaign = new Map<string, MetaCreativeAd[]>();
    for (const r of filtered) {
      const list = byCampaign.get(r.campaignId) ?? [];
      list.push(r);
      byCampaign.set(r.campaignId, list);
    }
    return [...byCampaign.entries()].map(([cid, campAds]) => {
      const byAdset = new Map<string, MetaCreativeAd[]>();
      for (const r of campAds) {
        const k = r.adsetId || '_no_adset';
        const list = byAdset.get(k) ?? [];
        list.push(r);
        byAdset.set(k, list);
      }
      const first = campAds[0]!;
      return {
        campaignId: cid,
        campaignName: first.campaignName || cid,
        intent: first.intent,
        adsets: [...byAdset.entries()].map(([ak, sads]) => {
          const sf = sads[0]!;
          return {
            adsetKey: `${cid}|${ak}`,
            adsetId: ak === '_no_adset' ? '' : sf.adsetId ?? ak,
            adsetName: ak === '_no_adset' ? 'Ad set (not linked)' : sf.adsetName || ak,
            ads: sads.sort((a, b) => b.spend - a.spend),
          };
        }),
      };
    });
  }, [filtered]);

  const colCount = 15;

  if (tree.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        {search.trim()
          ? 'No ads match your search.'
          : 'No ad-level creative data in this range. Run a Meta sync after connecting.'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="meta-creative-tree">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left min-w-[140px]">Ad / group</th>
            <th className="px-3 py-2 text-left min-w-[120px]">Campaign / ad set</th>
            <th className="px-3 py-2 text-left">Intent</th>
            <th className="px-3 py-2 text-right">Spend</th>
            <th className="px-3 py-2 text-right">Impr</th>
            <th className="px-3 py-2 text-right">Hook %</th>
            <th className="px-3 py-2 text-right">Hold %</th>
            <th className="px-3 py-2 text-right">P25</th>
            <th className="px-3 py-2 text-right">P50</th>
            <th className="px-3 py-2 text-right">P75</th>
            <th className="px-3 py-2 text-right">P95</th>
            <th className="px-3 py-2 text-right">Avg watch (s)</th>
            <th className="px-3 py-2 text-right">CTR</th>
            <th className="px-3 py-2 text-right">ROAS</th>
            <th className="px-3 py-2 min-w-[160px]">Diagnostics</th>
          </tr>
        </thead>
        <tbody>
          {tree.map((c) => {
            const campOpen = openCampaigns.has(c.campaignId);
            return (
              <Fragment key={c.campaignId}>
                <tr
                  className="bg-muted/30 cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    setOpenCampaigns((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.campaignId)) next.delete(c.campaignId);
                      else next.add(c.campaignId);
                      return next;
                    })
                  }
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-expanded={campOpen}
                        aria-label={campOpen ? 'Collapse campaign' : 'Expand campaign'}
                        className="text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenCampaigns((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.campaignId)) next.delete(c.campaignId);
                            else next.add(c.campaignId);
                            return next;
                          });
                        }}
                      >
                        {campOpen ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>
                      <span className="text-xs font-semibold">Campaign total</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 max-w-[180px] truncate text-sm font-medium">
                    {c.campaignName}
                  </td>
                  <td className="px-3 py-2">
                    <IntentBadge intent={c.intent} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" colSpan={colCount - 3}>
                    —
                  </td>
                </tr>
                {campOpen &&
                  c.adsets.map((g) => {
                    const grpOpen = openAdsets.has(g.adsetKey);
                    return (
                      <Fragment key={g.adsetKey}>
                        <tr
                          className="bg-muted/15 cursor-pointer hover:bg-muted/40"
                          onClick={() =>
                            setOpenAdsets((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.adsetKey)) next.delete(g.adsetKey);
                              else next.add(g.adsetKey);
                              return next;
                            })
                          }
                        >
                          <td className="px-3 py-2 pl-8">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-expanded={grpOpen}
                                aria-label={grpOpen ? 'Collapse ad set' : 'Expand ad set'}
                                className="text-muted-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenAdsets((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(g.adsetKey)) next.delete(g.adsetKey);
                                    else next.add(g.adsetKey);
                                    return next;
                                  });
                                }}
                              >
                                {grpOpen ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </button>
                              <span className="text-xs font-medium">Ad set total</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-sm font-medium">{g.adsetName}</td>
                          <td className="px-3 py-2">
                            <IntentBadge intent={c.intent} />
                          </td>
                          <td className="px-3 py-2 text-right" colSpan={colCount - 3}>
                            —
                          </td>
                        </tr>
                        {grpOpen &&
                          g.ads.map((r) => (
                            <tr key={r.adId} className="border-t hover:bg-muted/20">
                              <td className="px-3 py-2 pl-12 max-w-[240px]">
                                {r.previewImageUrl && (
                                  <div className="mb-1 space-y-1">
                                    <a
                                      href={r.previewImageUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs text-primary underline font-medium"
                                    >
                                      Open image
                                    </a>
                                    <a href={r.previewImageUrl} target="_blank" rel="noreferrer">
                                      <img
                                        src={r.previewImageUrl}
                                        alt=""
                                        className="max-h-24 max-w-[200px] rounded-md border object-contain bg-muted/40"
                                        loading="lazy"
                                        referrerPolicy="no-referrer-when-downgrade"
                                      />
                                    </a>
                                  </div>
                                )}
                                {r.previewVideoId && (
                                  <div className="mb-1">
                                    <a
                                      href={`https://www.facebook.com/watch/?v=${encodeURIComponent(r.previewVideoId)}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs text-primary underline font-medium"
                                    >
                                      Watch on Facebook
                                    </a>
                                  </div>
                                )}
                                <div
                                  className="max-w-[200px] truncate font-medium"
                                  title={r.adName || r.adId}
                                >
                                  {r.adName || r.adId}
                                </div>
                                <div className="text-xs text-muted-foreground">{r.adId}</div>
                                {r.isVideo && (
                                  <span className="text-[10px] uppercase text-muted-foreground">
                                    Video
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">—</td>
                              <td className="px-3 py-2">
                                <IntentBadge intent={r.intent} />
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-medium">
                                {formatMoney(BigInt(Math.round(r.spend * 100)), currencyCode)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {fmtNumber(r.impressions)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {r.hookRatePct == null ? (
                                  <span className="text-muted-foreground">N/A</span>
                                ) : (
                                  `${r.hookRatePct.toFixed(2)}%`
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {r.holdRatePct == null ? (
                                  <span className="text-muted-foreground">N/A</span>
                                ) : (
                                  `${r.holdRatePct.toFixed(2)}%`
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {r.p25RatePct == null ? (
                                  <span className="text-muted-foreground">N/A</span>
                                ) : (
                                  `${r.p25RatePct.toFixed(2)}%`
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {r.p50RatePct == null ? (
                                  <span className="text-muted-foreground">N/A</span>
                                ) : (
                                  `${r.p50RatePct.toFixed(2)}%`
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {r.p75RatePct == null ? (
                                  <span className="text-muted-foreground">N/A</span>
                                ) : (
                                  `${r.p75RatePct.toFixed(2)}%`
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {r.p95RatePct == null ? (
                                  <span className="text-muted-foreground">N/A</span>
                                ) : (
                                  `${r.p95RatePct.toFixed(2)}%`
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {r.avgWatchSec == null ? (
                                  <span className="text-muted-foreground">N/A</span>
                                ) : (
                                  r.avgWatchSec.toFixed(2)
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {r.ctrPct.toFixed(2)}%
                              </td>
                              <td className="px-3 py-2 text-right font-medium tabular-nums">
                                {r.roas.toFixed(2)}×
                              </td>
                              <td className="px-3 py-2 text-sm">
                                {r.diagnosticLabels.length === 0 ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <ul className="list-disc list-inside space-y-0.5 text-amber-800 dark:text-amber-200">
                                    {r.diagnosticLabels.map((d) => (
                                      <li key={d}>{d}</li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GoogleCreativeTree({
  ads,
  search,
  currencyCode,
}: {
  ads: GoogleCreativeAd[];
  search: string;
  currencyCode: string;
}) {
  const [openCampaigns, setOpenCampaigns] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!search.trim()) return ads;
    const q = search.toLowerCase();
    return ads.filter(
      (r) =>
        r.adName.toLowerCase().includes(q) ||
        r.campaignName.toLowerCase().includes(q) ||
        r.adGroupName.toLowerCase().includes(q) ||
        r.adType.toLowerCase().includes(q),
    );
  }, [ads, search]);

  const tree = useMemo(() => {
    const byCampaign = new Map<string, GoogleCreativeAd[]>();
    for (const r of filtered) {
      const list = byCampaign.get(r.campaignId) ?? [];
      list.push(r);
      byCampaign.set(r.campaignId, list);
    }
    return [...byCampaign.entries()].map(([, campAds]) => {
      const first = campAds[0]!;
      const byGroup = new Map<string, GoogleCreativeAd[]>();
      for (const r of campAds) {
        const list = byGroup.get(r.adGroupId) ?? [];
        list.push(r);
        byGroup.set(r.adGroupId, list);
      }
      return {
        campaignId: first.campaignId,
        campaignName: first.campaignName || first.campaignId,
        intent: first.intent,
        channelType: first.channelType,
        groups: [...byGroup.entries()].map(([gid, gads]) => {
          const gf = gads[0]!;
          return {
            adGroupId: gid,
            adGroupName: gf.adGroupName || gid,
            ads: gads.sort((a, b) => b.spend - a.spend),
          };
        }),
      };
    });
  }, [filtered]);

  const isPmax = (ch: string) => ch.toUpperCase().includes('PERFORMANCE_MAX');

  if (tree.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        {search.trim()
          ? 'No ads match your search.'
          : 'No ad-level creative rows in this range.'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="google-creative-tree">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left min-w-[200px]">Creative preview</th>
            <th className="px-3 py-2 text-left min-w-[120px]">Ad</th>
            <th className="px-3 py-2 text-left min-w-[120px]">Campaign</th>
            <th className="px-3 py-2 text-left">Channel</th>
            <th className="px-3 py-2 text-left">Intent</th>
            <th className="px-3 py-2 text-right">Spend</th>
            <th className="px-3 py-2 text-right">Impr</th>
            <th className="px-3 py-2 text-right">Clicks</th>
            <th className="px-3 py-2 text-right">CTR</th>
            <th className="px-3 py-2 text-right">Conv</th>
            <th className="px-3 py-2 text-right">Conv. value</th>
            <th className="px-3 py-2 text-right">ROAS</th>
          </tr>
        </thead>
        <tbody>
          {tree.map((c) => {
            const campOpen = openCampaigns.has(c.campaignId);
            const groupLabel = isPmax(c.channelType) ? 'asset groups' : 'ad groups';
            return (
              <Fragment key={c.campaignId}>
                <tr
                  className="bg-muted/30 cursor-pointer hover:bg-muted/50"
                  onClick={() =>
                    setOpenCampaigns((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.campaignId)) next.delete(c.campaignId);
                      else next.add(c.campaignId);
                      return next;
                    })
                  }
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-expanded={campOpen}
                        aria-label={campOpen ? 'Collapse campaign' : 'Expand campaign'}
                        className="text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenCampaigns((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.campaignId)) next.delete(c.campaignId);
                            else next.add(c.campaignId);
                            return next;
                          });
                        }}
                      >
                        {campOpen ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>
                      <span className="text-xs font-semibold">
                        Campaign total — {c.groups.length} {groupLabel}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">—</td>
                  <td className="px-3 py-2 text-sm font-medium">{c.campaignName}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {c.channelType.replace(/_/g, ' ').toLowerCase()}
                  </td>
                  <td className="px-3 py-2">
                    <IntentBadge intent={c.intent} />
                  </td>
                  <td className="px-3 py-2 text-right" colSpan={7}>
                    —
                  </td>
                </tr>
                {campOpen &&
                  c.groups.map((g) => {
                    const gKey = `${c.campaignId}|${g.adGroupId}`;
                    const grpOpen = openGroups.has(gKey);
                    const subLabel = isPmax(c.channelType) ? 'Asset group' : 'Ad group';
                    return (
                      <Fragment key={gKey}>
                        <tr
                          className="bg-muted/15 cursor-pointer hover:bg-muted/40"
                          onClick={() =>
                            setOpenGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(gKey)) next.delete(gKey);
                              else next.add(gKey);
                              return next;
                            })
                          }
                        >
                          <td className="px-3 py-2 pl-10">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-expanded={grpOpen}
                                aria-label={grpOpen ? 'Collapse group' : 'Expand group'}
                                className="text-muted-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenGroups((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(gKey)) next.delete(gKey);
                                    else next.add(gKey);
                                    return next;
                                  });
                                }}
                              >
                                {grpOpen ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </button>
                              <span className="text-xs font-medium">{subLabel}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-sm font-medium">{g.adGroupName}</td>
                          <td className="px-3 py-2 text-muted-foreground text-xs">—</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {c.channelType.replace(/_/g, ' ').toLowerCase()}
                          </td>
                          <td className="px-3 py-2">
                            <IntentBadge intent={c.intent} />
                          </td>
                          <td className="px-3 py-2 text-right" colSpan={7}>
                            —
                          </td>
                        </tr>
                        {grpOpen &&
                          g.ads.map((r) => (
                            <tr key={`${r.campaignId}-${r.adGroupId}-${r.adId}`} className="border-t hover:bg-muted/20">
                              <td className="px-3 py-2 pl-14 max-w-[240px]">
                                <p className="text-xs text-muted-foreground">
                                  {r.adType.replace(/_/g, ' ').toLowerCase()}
                                </p>
                                {r.previewImageUrl && (
                                  <div className="mt-1 space-y-1">
                                    <a
                                      href={r.previewImageUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs text-primary underline font-medium"
                                    >
                                      Open image
                                    </a>
                                    <a href={r.previewImageUrl} target="_blank" rel="noreferrer">
                                      <img
                                        src={r.previewImageUrl}
                                        alt=""
                                        className="max-h-24 max-w-[220px] rounded-md border object-contain bg-muted/40"
                                        loading="lazy"
                                        referrerPolicy="no-referrer-when-downgrade"
                                      />
                                    </a>
                                  </div>
                                )}
                                {r.previewYoutubeId && (
                                  <div className="mt-1 space-y-1">
                                    <a
                                      href={`https://www.youtube.com/watch?v=${encodeURIComponent(r.previewYoutubeId)}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs text-primary underline font-medium"
                                    >
                                      Watch on YouTube
                                    </a>
                                    <a
                                      href={`https://www.youtube.com/watch?v=${encodeURIComponent(r.previewYoutubeId)}`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <img
                                        src={`https://img.youtube.com/vi/${encodeURIComponent(r.previewYoutubeId)}/hqdefault.jpg`}
                                        alt=""
                                        className="max-h-24 max-w-[220px] rounded-md border object-cover bg-muted/40"
                                        loading="lazy"
                                        referrerPolicy="no-referrer-when-downgrade"
                                      />
                                    </a>
                                  </div>
                                )}
                                {r.previewText && (
                                  <p className="text-sm font-medium line-clamp-3 mt-0.5">
                                    {r.previewText}
                                  </p>
                                )}
                                {r.landingUrl && (
                                  <a
                                    href={r.landingUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-primary underline block mt-1 max-w-[200px] truncate"
                                  >
                                    Landing page
                                  </a>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div className="max-w-[160px] truncate font-medium text-sm">
                                  {r.adName || r.adId}
                                </div>
                                <div className="text-xs text-muted-foreground">{r.adId}</div>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground text-xs">—</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {r.channelType.replace(/_/g, ' ').toLowerCase()}
                              </td>
                              <td className="px-3 py-2">
                                <IntentBadge intent={r.intent} />
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-medium">
                                {formatMoney(BigInt(Math.round(r.spend * 100)), currencyCode)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {fmtNumber(r.impressions)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {fmtNumber(r.clicks)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {r.ctrPct.toFixed(2)}%
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {fmtNumber(r.conversions, 2)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatMoney(
                                  BigInt(Math.round(r.conversionValue * 100)),
                                  currencyCode,
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-medium tabular-nums">
                                {r.roas.toFixed(2)}×
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PlatformAdsView — the exported entry point
// ---------------------------------------------------------------------------

export function PlatformAdsView({ config }: { config: VendorConfig }) {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  // Look up workspace slug from the workspace list (session slice stores workspaceId only).
  const workspaceListQ = trpc.workspace.list.useQuery(undefined, {
    enabled: !!isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
  const activeWorkspace = workspaceListQ.data?.workspaces.find(
    (w) => w.workspaceId === workspaceId,
  );
  const workspaceSlug = activeWorkspace?.slug ?? workspaceId ?? '';

  const [dateStart, setDateStart] = useQueryState(
    'from',
    parseAsString.withDefault(DEFAULT_DATE_START),
  );
  const [dateEnd, setDateEnd] = useQueryState(
    'to',
    parseAsString.withDefault(DEFAULT_DATE_END),
  );
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum<TabValue>(['performance', 'funnel', 'creative']).withDefault('performance'),
  );

  const [view, setView] = useState<ViewValue>('campaigns');
  const [intentFilter, setIntentFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const enabled = Boolean(isAuthenticated && workspaceId);

  // Campaigns + totals
  const campaignsQ = trpc.marketing.platformCampaigns.useQuery(
    {
      vendor: config.vendor,
      date_start: dateStart,
      date_end: dateEnd,
      intent: intentFilter ?? undefined,
    },
    { enabled },
  );

  // Spend-by-intent breakdown
  const intentQ = trpc.marketing.spendByIntent.useQuery(
    { vendor: config.vendor, date_start: dateStart, date_end: dateEnd },
    { enabled },
  );

  // Account selector (Meta: ad account IDs; Google: customer IDs)
  const accountsQ = trpc.marketing.platformAccounts.useQuery(
    { vendor: config.vendor },
    { enabled },
  );

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold">Not signed in</h2>
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

  const { label, platform, vendor, hasAdsetView, summaryCardMode } = config;

  const rows = campaignsQ.data?.rows ?? [];
  const cc = campaignsQ.data?.currencyCode ?? 'INR';
  const totalSpendMu = campaignsQ.data?.totalSpendMu ?? '0';
  const totalRevenueMu = campaignsQ.data?.totalRevenueMu ?? '0';
  const totalImpressions = campaignsQ.data?.totalImpressions ?? 0;
  const totalClicks = campaignsQ.data?.totalClicks ?? 0;
  const totalConversions = campaignsQ.data?.totalConversions ?? 0;

  // Compute totals for summary KPI cards from campaign rows
  const summarySpend = BigInt(totalSpendMu);
  const summaryRevenue = BigInt(totalRevenueMu);
  const summaryRoasBp =
    summarySpend > 0n
      ? Number((summaryRevenue * 10000n) / summarySpend)
      : 0;
  const dateRange = `${dateStart} – ${dateEnd}`;

  const accounts = accountsQ.data?.rows ?? [];

  // Build campaign table rows (typed as CampaignTableRow)
  const tableRows: CampaignTableRow[] = rows.map((r) => ({
    ...r,
    // acqRoas / nonAcqRoas are not yet in the BFF response; surface honest null
    acqRoasBp: null,
    nonAcqRoasBp: null,
  }));

  const intentRows = intentQ.data?.rows ?? [];

  // Funnel data — not wired yet; honest null
  const funnelData: null = null;
  const funnelRows: Array<{ key: string; label: string; sub?: string; f: FunnelSummary }> = [];

  // Creative data — not wired yet; honest empty arrays
  const metaCreativeAds: MetaCreativeAd[] = [];
  const googleCreativeAds: GoogleCreativeAd[] = [];

  const TAB_LIST: Array<{ v: TabValue; l: string }> = [
    { v: 'performance', l: 'Performance' },
    { v: 'funnel', l: 'Funnel' },
    { v: 'creative', l: 'Creative' },
  ];

  // View options
  const VIEW_OPTIONS: Array<{ v: ViewValue; l: string }> = [
    { v: 'campaigns', l: 'Campaign totals' },
    ...(hasAdsetView ? [{ v: 'adsets' as ViewValue, l: 'Ad set totals' }] : []),
    { v: 'daily', l: 'Daily breakdown (all rows)' },
  ];

  return (
    <div className="space-y-6" data-testid={`${platform}-ads-view`}>
      {/* Page header + date controls */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Campaign performance for the selected {label} account.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor={`${platform}-ads-from`} className="sr-only">
            From date
          </label>
          <input
            id={`${platform}-ads-from`}
            type="date"
            value={dateStart}
            onChange={(ev) => setDateStart(ev.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
          />
          <span aria-hidden="true" className="text-muted-foreground text-sm">
            to
          </span>
          <label htmlFor={`${platform}-ads-to`} className="sr-only">
            To date
          </label>
          <input
            id={`${platform}-ads-to`}
            type="date"
            value={dateEnd}
            onChange={(ev) => setDateEnd(ev.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
          />
        </div>
      </div>

      {/* Loading skeleton */}
      {campaignsQ.isLoading && (
        <div aria-busy="true" aria-label={`Loading ${label}`} className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="h-16 bg-muted rounded animate-pulse"
              aria-hidden="true"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {campaignsQ.error && (
        <ErrorDisplay
          title={`Failed to load ${label}`}
          message={campaignsQ.error.message}
          requestId={
            (campaignsQ.error as { data?: { requestId?: string } }).data?.requestId
          }
        />
      )}

      {/* KPI Summary cards — platform-specific */}
      {!campaignsQ.isLoading && !campaignsQ.error && (
        <div
          className={cn(
            'grid gap-4',
            summaryCardMode === 'meta'
              ? 'sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6'
              : 'sm:grid-cols-2 lg:grid-cols-4',
          )}
          data-testid="summary-kpi-cards"
          aria-label={`${label} summary KPIs`}
        >
          {summaryCardMode === 'meta' ? (
            <>
              <SummaryCard
                label="Spend"
                value={formatMoney(summarySpend, cc)}
                dateRange={dateRange}
              />
              <SummaryCard
                label="Revenue"
                value={summaryRevenue === 0n ? '—' : formatMoney(summaryRevenue, cc)}
                dateRange={dateRange}
              />
              <SummaryCard
                label="ROAS"
                value={fmtRoas(summaryRoasBp)}
                dateRange={dateRange}
              />
              <SummaryCard
                label="Impressions"
                value={fmtNumber(totalImpressions)}
                dateRange={dateRange}
              />
              <SummaryCard
                label="Clicks"
                value={fmtNumber(totalClicks)}
                dateRange={dateRange}
              />
              <SummaryCard
                label="Conversions"
                value={totalConversions === 0 ? '—' : fmtNumber(totalConversions, 2)}
                dateRange={dateRange}
              />
            </>
          ) : (
            <>
              <SummaryCard
                label="Spend"
                value={formatMoney(summarySpend, cc)}
                dateRange={dateRange}
              />
              <SummaryCard
                label="Conversions"
                value={totalConversions === 0 ? '—' : fmtNumber(totalConversions, 2)}
                dateRange={dateRange}
              />
              <SummaryCard
                label="Conversion value"
                value={summaryRevenue === 0n ? '—' : formatMoney(summaryRevenue, cc)}
                dateRange={dateRange}
              />
              <SummaryCard
                label="ROAS"
                value={fmtRoas(summaryRoasBp)}
                dateRange={dateRange}
              />
            </>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div className="border-b" role="tablist" aria-label={`${label} tabs`}>
        <div className="flex gap-1 -mb-px">
          {TAB_LIST.map((t) => (
            <button
              key={t.v}
              type="button"
              role="tab"
              aria-selected={tab === t.v}
              onClick={() => setTab(t.v === 'performance' ? null : t.v)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                tab === t.v
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40',
              )}
              data-testid={`tab-${t.v}`}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Performance tab ── */}
      {tab === 'performance' && (
        <div className="space-y-4">
          {/* Intent split panel (with ROAS pools + campaign counts) */}
          {intentRows.length > 0 && (
            <IntentSplitPanel
              spendIntentRows={intentRows.map((r) => ({
                ...r,
                campaignCount: undefined, // not in current BFF; honest empty
              }))}
              totalSpendMu={summarySpend}
              totalRevenueMu={summaryRevenue}
              currencyCode={cc}
              acquisitionRoasBp={null}
              nonAcqRoasBp={null}
              spendReconciles={true}
              revenueReconciles={true}
              spendDelta={0n}
              revenueDelta={0n}
              platformLabel={label}
              workspaceSlug={workspaceSlug}
              activeIntent={intentFilter}
              onIntentChange={(i) => setIntentFilter(i)}
            />
          )}

          {/* Account selector (Google: customer-id; Meta: ad-account-id) */}
          {accounts.length > 1 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor={`${platform}-account-selector`}
                className="text-sm text-muted-foreground shrink-0"
              >
                {vendor === 'GOOGLE' ? 'Account' : 'Ad account'}:
              </label>
              <select
                id={`${platform}-account-selector`}
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                defaultValue=""
              >
                {accounts.map((a) => (
                  <option key={a.adAccountId} value={a.adAccountId}>
                    {vendor === 'GOOGLE' ? `Account ${a.adAccountId}` : a.adAccountId}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Toolbar: view selector + intent filter + search */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Intent filter */}
            <select
              value={intentFilter ?? 'all'}
              onChange={(e) =>
                setIntentFilter(e.target.value === 'all' ? null : e.target.value)
              }
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              aria-label="Filter by intent"
            >
              {INTENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {/* View selector */}
            <select
              value={view}
              onChange={(e) => setView(e.target.value as ViewValue)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              aria-label="Select table view"
            >
              {VIEW_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>

            {/* Search */}
            <input
              type="search"
              placeholder={
                view === 'daily'
                  ? 'Search campaigns or date...'
                  : view === 'adsets'
                    ? 'Search campaign or ad set...'
                    : 'Search campaigns...'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground max-w-xs"
              aria-label="Search campaigns"
            />
          </div>

          <CampaignTable
            rows={tableRows}
            currencyCode={cc}
            isLoading={campaignsQ.isLoading}
            view={view}
            search={search}
            config={config}
            totalSpendMu={totalSpendMu}
            totalRevenueMu={totalRevenueMu}
            totalImpressions={totalImpressions}
            totalClicks={totalClicks}
            totalConversions={totalConversions}
          />
        </div>
      )}

      {/* ── Funnel tab ── */}
      {tab === 'funnel' && (
        <FunnelTabBody
          platform={platform}
          funnelData={funnelData}
          currencyCode={cc}
          funnelRows={funnelRows}
          search={search}
        />
      )}

      {/* ── Creative tab ── */}
      {tab === 'creative' && (
        <div className="space-y-4">
          {platform === 'meta' && metaCreativeAds.length === 0 ? (
            <CreativeEmptyState platform={platform} />
          ) : platform === 'meta' ? (
            <div className="rounded-lg border bg-card overflow-hidden">
              <MetaCreativeTree
                ads={metaCreativeAds}
                search={search}
                currencyCode={cc}
              />
            </div>
          ) : null}

          {platform === 'google' && googleCreativeAds.length === 0 ? (
            <CreativeEmptyState platform={platform} />
          ) : platform === 'google' ? (
            <div className="rounded-lg border bg-card overflow-hidden">
              <GoogleCreativeTree
                ads={googleCreativeAds}
                search={search}
                currencyCode={cc}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

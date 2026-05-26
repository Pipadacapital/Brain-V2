'use client';

// @paradigm: sql
// PlatformAdsCampaigns — Performance tab body for /meta-ads and /google-ads.
// Renders the campaign-level table + Spend-by-intent breakdown driven by
// trpc.marketing.{platformCampaigns, spendByIntent, platformAccounts}.
//
// CF-S10-HONEST-STATE-1: conversions / revenue / ROAS columns surface 0
// honestly because the PG ad-spend mirror doesn't carry them yet (the wider
// CH facts do; the read-path companion is the next ingestion slice).

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatMoney } from '@brain/lib-metrics';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { cn } from '@/lib/utils.js';

const INPUT_CLS =
  'px-2 py-1.5 border border-input bg-background rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function fmtBpPct(bp: number): string {
  if (!Number.isFinite(bp) || bp === 0) return '—';
  // 10000 bp = 100%
  return `${(bp / 100).toFixed(bp >= 10000 ? 0 : bp >= 1000 ? 1 : 2)}%`;
}

interface Props {
  vendor: 'META' | 'GOOGLE';
  label: string;
  dateStart: string;
  dateEnd: string;
}

export function PlatformAdsCampaigns({ vendor, label, dateStart, dateEnd }: Props) {
  const [intent, setIntent] = useState<string | null>(null);

  const { data: spendIntent } = trpc.marketing.spendByIntent.useQuery({
    vendor, date_start: dateStart, date_end: dateEnd,
  });
  const { data, isLoading, error } = trpc.marketing.platformCampaigns.useQuery({
    vendor, date_start: dateStart, date_end: dateEnd, intent: intent ?? undefined,
  });

  if (error) return <ErrorDisplay title={`Couldn't load ${label} campaigns`} message={error.message} />;

  const rows = data?.rows ?? [];
  const cc = data?.currencyCode ?? 'INR';
  const intents = spendIntent?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Spend by intent ────────────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="text-sm font-semibold mb-3">Spend by campaign intent</h3>
        {intents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No spend in this date range. Classify campaigns on Settings → Ad campaigns to label intents.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {intents.map((i) => (
              <button
                key={i.intent}
                type="button"
                onClick={() => setIntent(intent === i.intent ? null : i.intent)}
                className={cn(
                  'flex items-center gap-3 text-left rounded transition-colors',
                  intent === i.intent ? 'bg-muted/50' : 'hover:bg-muted/30',
                )}
              >
                <span className="w-32 text-xs font-medium">{i.intent}</span>
                <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-foreground"
                    style={{ width: `${Math.min(100, i.spendBp / 100)}%` }}
                  />
                </div>
                <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                  {(i.spendBp / 100).toFixed(0)}%
                </span>
                <span className="w-24 text-right text-xs tabular-nums">
                  {formatMoney(BigInt(i.spendMu), cc)}
                </span>
              </button>
            ))}
          </div>
        )}
        {intent && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Filtering by intent:</span>
            <span className="rounded bg-foreground text-background px-1.5 py-0.5">{intent}</span>
            <button type="button" onClick={() => setIntent(null)} className="underline">
              clear
            </button>
          </div>
        )}
      </section>

      {/* Campaign table ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">
            Campaigns ({rows.length} {rows.length === 500 ? '+ (capped)' : ''})
          </h3>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Campaign</th>
              <th className="px-3 py-2 text-left font-medium">Intent</th>
              <th className="px-3 py-2 text-right font-medium">Spend</th>
              <th className="px-3 py-2 text-right font-medium">Impr.</th>
              <th className="px-3 py-2 text-right font-medium">Clicks</th>
              <th className="px-3 py-2 text-right font-medium">CTR</th>
              <th className="px-3 py-2 text-right font-medium">CPC</th>
              <th className="px-3 py-2 text-right font-medium">CPM</th>
              <th className="px-3 py-2 text-right font-medium">Conv.</th>
              <th className="px-3 py-2 text-right font-medium">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={10} className="py-12 text-center"><Loader2 className="inline h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="py-12 text-center text-muted-foreground">No campaigns in this date range.</td></tr>
            ) : rows.map((c) => (
              <tr key={c.campaignId} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2">
                  <p className="font-medium truncate max-w-[280px]">{c.campaignName}</p>
                  <p className="text-xs text-muted-foreground font-mono">{c.campaignId.slice(0, 16)}…</p>
                </td>
                <td className="px-3 py-2">
                  <span className={cn(
                    'inline-block rounded px-1.5 py-0.5 text-xs',
                    c.intent === 'unclassified' ? 'bg-muted text-muted-foreground' : 'bg-foreground/10',
                  )}>{c.intent}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(BigInt(c.spendMu), cc)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{c.impressions.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{c.clicks.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtBpPct(c.ctrBp)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.cpcMu === '0' ? '—' : formatMoney(BigInt(c.cpcMu), cc)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.cpmMu === '0' ? '—' : formatMoney(BigInt(c.cpmMu), cc)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {c.conversions === 0 ? '—' : c.conversions.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {c.roasBp === 0 ? '—' : `${(c.roasBp / 10000).toFixed(2)}×`}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && data && (
            <tfoot className="bg-muted/40 text-xs font-medium">
              <tr>
                <td className="px-3 py-2 text-left">Total</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(BigInt(data.totalSpendMu), cc)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{data.totalImpressions.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{data.totalClicks.toLocaleString()}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    </div>
  );
}

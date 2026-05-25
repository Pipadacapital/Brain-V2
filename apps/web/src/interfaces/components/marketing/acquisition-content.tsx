'use client';

// @paradigm: sql
// AcquisitionContent — the /acquisition page (Phase-2 slice-4, feat-marketing-acquisition).
// Renders MER/aMER/ACOS efficiency + blended CAC + CM2-per-NC + meta/google spend split + a
// daily table for the anchor brand. aMER uses ACQUISITION-classified spend (privileges
// CM2/CAC; ROAS/ACOS are labelled display-only). CF-C6-RENDER-ONLY-1: zero arithmetic; all
// values from trpc.marketing.{efficiency,acquisition}. CF-C6-FORMATMONEY-CANONICAL-1.

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import {
  formatBpMultiple,
  formatX100Multiple,
  formatBpPercent,
} from '@/interfaces/components/marketing/format-ratio.js';

export function AcquisitionContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const eff = trpc.marketing.efficiency.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled },
  );
  const acq = trpc.marketing.acquisition.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled },
  );

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

  const isLoading = eff.isLoading || acq.isLoading;
  const error = eff.error || acq.error;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Acquisition</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sugandh Lok — marketing efficiency &amp; new-customer economics (CM2-first)</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="acq-from" className="sr-only">From date</label>
          <input id="acq-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="acq-to" className="sr-only">To date</label>
          <input id="acq-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading acquisition" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay title="Failed to load acquisition" message={error.message} requestId={(error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {eff.data && acq.data && (() => {
        const e = eff.data.result;
        const s = acq.data.summary;
        const cc = e.currency_code;
        return (
          <>
            <div className="sr-only">Data as of {new Date(eff.data.data_epoch).toISOString()}. Request ID: {eff.data.request_id}</div>

            {/* Efficiency strip — aMER + CAC privileged; ROAS/ACOS display-only. */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Stat label="MER" value={formatBpMultiple(e.mer_bp)} sub="Net revenue ÷ all ad spend" />
              <Stat label="aMER" value={formatBpMultiple(e.amer_bp)} sub="NC revenue ÷ acquisition spend" accent="green" />
              <Stat label="Blended CAC" value={s.cac_mu === null ? '—' : formatMoney(s.cac_mu, cc)} sub="Ad spend ÷ new customers" accent="green" />
              <Stat label="CM2 / new customer" value={s.cm2_per_nc_mu === null ? '—' : formatMoney(s.cm2_per_nc_mu, cc)} sub="New-customer CM2 ÷ NC" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Stat label="New customers" value={String(s.new_customers_count)} sub="First order in range" />
              <Stat label="NC revenue" value={formatMoney(s.new_customer_revenue_mu, cc)} sub="Net of tax, RTO excluded" />
              <Stat label="ACOS" value={formatBpPercent(e.acos_bp)} sub="display-only" muted />
              <Stat label="Blended ROAS" value={formatX100Multiple(e.blended_roas_x100)} sub="display-only" muted />
            </div>

            {/* Spend split — blended vs platform. */}
            <Section title="Ad spend split (blended vs platform)">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Stat label="Total ad spend" value={formatMoney(e.total_ad_spend_mu, cc)} />
                <Stat label="Meta" value={formatMoney(e.meta_spend_mu, cc)} />
                <Stat label="Google" value={formatMoney(e.google_spend_mu, cc)} />
              </div>
            </Section>

            {/* Daily table. */}
            <Section title="Daily new-customer economics">
              <Table head={['Date', 'New', 'NC CM2', 'CAC', 'aMER']}>
                {acq.data.daily.map((d) => (
                  <tr key={d.date} className="border-t border-gray-100">
                    <td className="py-2 text-sm">{d.date}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{String(d.new_customers)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatMoney(d.nc_cm2_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{d.cac_mu === null ? '—' : formatMoney(d.cac_mu, cc)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatBpMultiple(d.amer_bp)}</td>
                  </tr>
                ))}
              </Table>
            </Section>
          </>
        );
      })()}
    </div>
  );
}

function Stat({ label, value, sub, accent, muted }: { label: string; value: string; sub?: string; accent?: 'green'; muted?: boolean }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-4 ${muted ? 'opacity-70' : ''}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${accent === 'green' ? 'text-green-700' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full">
      <thead>
        <tr>{head.map((h, i) => <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

'use client';

// @paradigm: sql
// CostsContent — the /costs page (Phase-2 slice-7, feat-finance-settings-goals).
// Renders the resolved cost stack the operator edits: COGS settings (override/fallback/markup),
// the active cost rows (fixed/per-order/percent), and how the resolved COGS lands in the CM
// ladder (net sales → COGS → variable → CM1). CF-C6-RENDER-ONLY-1: zero arithmetic; values from
// trpc.settings.costs. The CM1 shown is the EXISTING cm1_mu (one source of truth), NOT a re-compute.
// Cost-row EDIT/CRUD is a follow-up (this slice ships the resolved READ view).

import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/marketing/format-ratio.js';

const KIND_LABEL: Record<string, string> = {
  fixed_monthly: 'Fixed / month',
  per_order: 'Per order',
  percent: '% of revenue',
};

function formatCostAmount(kind: string, amountMu: bigint, amountBp: number, currency: string): string {
  if (kind === 'percent') return formatBpPercent(amountBp);
  return formatMoney(amountMu, currency);
}

export function CostsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-05-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-05-31'));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.settings.costs.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });

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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Costs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">COGS settings, cost stack &amp; how they land in CM</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label htmlFor="costs-from" className="sr-only">From date</label>
          <input id="costs-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="costs-to" className="sr-only">To date</label>
          <input id="costs-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading costs" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load costs" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (() => {
        const r = q.data.result;
        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">COGS resolution</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Mode" value={r.cogs_mode === 'override' ? 'Override all' : 'Product COGS + fallback'} />
                <Stat label="Override %" value={r.override_all_bp > 0 ? formatBpPercent(r.override_all_bp) : 'Off'} />
                <Stat label="Fallback %" value={formatBpPercent(r.fallback_bp)} />
                <Stat label="Markup %" value={formatBpPercent(r.markup_bp)} />
              </div>
              <p className="text-xs text-muted-foreground">Precedence: override % → product COGS → fallback % → 0, then markup. This resolved COGS feeds CM1 below — one source of truth.</p>
            </section>

            <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Cost stack</h2>
              <table className="w-full">
                <thead>
                  <tr>{['Cost', 'Type', 'Kind', 'Amount', 'Since'].map((h, i) => <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i <= 1 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {r.cost_rows.map((c, idx) => (
                    <tr key={`${c.cost_type}-${c.name}-${idx}`} className="border-t border-gray-100">
                      <td className="py-2 text-sm font-medium">{c.name}</td>
                      <td className="py-2 text-sm text-muted-foreground">{c.cost_type}</td>
                      <td className="py-2 text-sm text-right">{KIND_LABEL[c.kind] ?? c.kind}</td>
                      <td className="py-2 text-sm tabular-nums text-right">{formatCostAmount(c.kind, c.amount_mu, c.amount_bp, c.currency_code)}</td>
                      <td className="py-2 text-sm tabular-nums text-right text-muted-foreground">{c.effective_from}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                <Stat label="Total fixed / month" value={formatMoney(r.total_fixed_monthly_mu, r.currency_code)} />
                <Stat label="Total per order" value={formatMoney(r.total_per_order_mu, r.currency_code)} />
              </div>
            </section>

            <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">How costs land in CM</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Net sales" value={formatMoney(r.net_sales_mu, r.currency_code)} />
                <Stat label="Resolved COGS" value={formatMoney(r.resolved_cogs_mu, r.currency_code)} />
                <Stat label="Variable costs" value={formatMoney(r.variable_costs_mu, r.currency_code)} />
                <Stat label="CM1" value={formatMoney(r.cm1_mu, r.currency_code)} />
              </div>
              <p className="text-xs text-muted-foreground">CM1 = net sales − resolved COGS − variable costs. Read from the canonical CM engine (cm1_mu) — not recomputed on this page.</p>
            </section>
          </>
        );
      })()}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}

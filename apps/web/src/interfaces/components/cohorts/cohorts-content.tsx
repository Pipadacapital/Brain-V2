'use client';

// @paradigm: sql
// CohortsContent — /cohorts page (Phase-2 slice-5, feat-cohorts-ltv).
// ONE combined table: Cohort | New | CAC | 90d RR | Payback | First Order (R) | First Order |
// M1..M12 (heatmap inline) + a customer-weighted Average row — matching legacy semantics.
//
// CF-C6-RENDER-ONLY-1: zero metric arithmetic; all values from trpc.cohorts.matrix.
// Heatmap: diverging green (positive) / red (negative) over [min,max] range — matching
// legacy's heatmapStyle (rgba(34,197,94,…) for positive, rgba(239,68,68,…) for negative).

import { useMemo } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpMultiple, formatBpPercent } from '@/interfaces/components/marketing/format-ratio.js';

// ---------------------------------------------------------------------------
// Constants — metric / mode labels and disabled-mode rules (mirrors legacy)
// ---------------------------------------------------------------------------

type CohortMetric = 'cm3' | 'revenue' | 'repeat' | 'repurchase';
type CohortMode   = 'post' | 'cumulative' | 'incr' | 'pct' | 'ltvcac';

const METRIC_LABELS: Record<CohortMetric, string> = {
  cm3:        'CM3',
  revenue:    'Revenue',
  repeat:     'Repeat Rate',
  repurchase: 'Repurchase Rate',
};

const MODE_LABELS: Record<CohortMode, string> = {
  post:       'Post-Acquisition',
  cumulative: 'Cumulative',
  incr:       'Incremental',
  pct:        '%',
  ltvcac:     'LTV:CAC',
};

// Modes that are disabled for a given metric (mirrors legacy DISABLED_METRIC_MODE).
const DISABLED_MODES: Partial<Record<CohortMetric, CohortMode[]>> = {
  repeat:     ['cumulative', 'pct', 'ltvcac'],
  repurchase: ['cumulative', 'pct', 'ltvcac'],
};

// ---------------------------------------------------------------------------
// Helpers — display formatting (render-only, no metric math)
// ---------------------------------------------------------------------------

/** centi-months → "1.0 mo" / "Immediate" / "—". Display only. */
function fmtPayback(centi: number | null | undefined): string {
  if (centi === null || centi === undefined) return '—';
  if (centi === 0) return 'Immediate';
  return `${(centi / 100).toFixed(1)} mo`;
}

/**
 * Format a cell value by metric/mode context.
 * - pct mode or repeat/repurchase metric → render as bp→% (e.g. 3000bp = 30.00%).
 * - ltvcac mode → render as multiple (e.g. 12000bp = 1.20×).
 * - money metric (cm3/revenue) → formatMoney (bigint minor-units → ₹).
 * CF-C6-RENDER-ONLY-1: purely display.
 */
function fmtCell(
  value: bigint,
  metric: CohortMetric,
  mode: CohortMode,
  currency: string,
): string {
  if (mode === 'ltvcac') return formatBpMultiple(Number(value));
  if (mode === 'pct') return formatBpPercent(Number(value));
  if (metric === 'repeat' || metric === 'repurchase') {
    // stored as bp (×10000); render as "%"
    return formatBpPercent(Number(value));
  }
  return formatMoney(value, currency);
}

/**
 * Diverging heatmap colour: positive → green rgba(34,197,94,…),
 * negative → red rgba(239,68,68,…). Intensity scales across [min,max] range.
 * Mirrors legacy cohorts-content.tsx heatmapStyle exactly.
 */
function heatmapStyle(
  value: bigint,
  minV: bigint,
  maxV: bigint,
): React.CSSProperties {
  const num = Number(value);
  const mn  = Number(minV);
  const mx  = Number(maxV);
  const range = mx - mn || 1;
  const p = (num - mn) / range;
  if (num >= 0) {
    const intensity = Math.min(1, p * 1.2);
    return { backgroundColor: `rgba(34, 197, 94, ${0.15 + intensity * 0.35})` };
  }
  const intensity = Math.min(1, (1 - p) * 1.2);
  return { backgroundColor: `rgba(239, 68, 68, ${0.1 + intensity * 0.25})` };
}

/** Format cohort month from 'YYYY-MM' to 'Mon YYYY'. */
function fmtCohortMonth(ym: string): string {
  // Append '-01' to form a parseable date, use toLocaleDateString for 'short' month name.
  try {
    return new Date(ym + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  } catch {
    return ym;
  }
}

// ---------------------------------------------------------------------------
// Cohorts page — 2-year default range (legacy default is ~729 days back)
// ---------------------------------------------------------------------------

function twoYearsAgo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const COHORT_DEFAULT_START = twoYearsAgo();
const COHORT_DEFAULT_END   = today();

const M_COLS = Array.from({ length: 12 }, (_, i) => i); // indices 0..11

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CohortsContent() {
  const workspaceId    = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault(COHORT_DEFAULT_START));
  const [dateEnd,   setDateEnd]   = useQueryState('to',   parseAsString.withDefault(COHORT_DEFAULT_END));
  const [metric,    setMetric]    = useQueryState('metric', parseAsString.withDefault('cm3'));
  const [mode,      setMode]      = useQueryState('mode',   parseAsString.withDefault('post'));

  const disabledModes = DISABLED_MODES[metric as CohortMetric] ?? [];
  // If the current mode is disabled for this metric, fall back to 'post'.
  const effectiveMode = disabledModes.includes(mode as CohortMode) ? 'post' : mode;

  const enabled = Boolean(isAuthenticated && workspaceId);

  const q = trpc.cohorts.matrix.useQuery(
    {
      date_start: dateStart,
      date_end:   dateEnd,
      metric:     metric   as CohortMetric,
      mode:       effectiveMode as CohortMode,
    },
    { enabled },
  );

  // ---------------------------------------------------------------------------
  // Derived heatmap scale — find [min, max] across all m[] cells
  // ---------------------------------------------------------------------------
  const { minCell, maxCell } = useMemo(() => {
    if (!q.data?.result?.rows?.length) return { minCell: 0n, maxCell: 0n };
    let mn = 0n, mx = 0n;
    for (const row of q.data.result.rows) {
      for (const v of row.m) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    return { minCell: mn, maxCell: mx };
  }, [q.data]);

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

  const met = metric as CohortMetric;
  const mod = effectiveMode as CohortMode;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* Page heading */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Cohorts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Repeat-purchase &amp; retention by acquisition month
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Filters */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Cohort filters">
        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="coh-from" className="text-sm text-muted-foreground">From</label>
          <input
            id="coh-from"
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            aria-label="Cohort start date"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor="coh-to" className="text-sm text-muted-foreground">To</label>
          <input
            id="coh-to"
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            aria-label="Cohort end date"
          />
        </div>

        {/* Metric selector */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="coh-metric" className="text-sm text-muted-foreground">Metric</label>
          <select
            id="coh-metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            aria-label="Cohort metric"
          >
            {(Object.keys(METRIC_LABELS) as CohortMetric[]).map((m) => (
              <option key={m} value={m}>{METRIC_LABELS[m]}</option>
            ))}
          </select>
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="coh-mode" className="text-sm text-muted-foreground">Mode</label>
          <select
            id="coh-mode"
            value={effectiveMode}
            onChange={(e) => setMode(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            aria-label="Cohort mode"
          >
            {(Object.keys(MODE_LABELS) as CohortMode[]).map((m) => (
              <option key={m} value={m} disabled={disabledModes.includes(m)}>
                {MODE_LABELS[m]}{disabledModes.includes(m) ? ' (N/A)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Loading / error states */}
      {/* ------------------------------------------------------------------ */}
      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading cohorts" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-9 bg-muted rounded animate-pulse" aria-hidden="true" />
          ))}
        </div>
      )}

      {q.error && (
        <ErrorDisplay
          title="Failed to load cohorts"
          message={q.error.message}
          requestId={(q.error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Data */}
      {/* ------------------------------------------------------------------ */}
      {q.data && (() => {
        const r   = q.data.result;
        const cc  = r.currency_code;
        const rows = r.rows;

        // Summary cards
        const summaryCards = (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <SummaryCard
              label="Avg CAC"
              value={r.average_cac_mu === null ? '—' : formatMoney(r.average_cac_mu, cc)}
              sub="Ad spend ÷ new customers"
            />
            <SummaryCard
              label="90-day repeat"
              value={formatBpPercent(r.avg_90day_repeat_bp)}
              sub="Repeat within 90 days"
              accent="green"
            />
            <SummaryCard
              label="Avg payback"
              value={fmtPayback(r.average_payback_centimonths)}
              sub="Customer-weighted (CM3)"
              accent="green"
            />
            <SummaryCard
              label="New customers"
              value={String(r.new_customers)}
              sub="Across filtered cohorts"
            />
          </div>
        );

        if (rows.length === 0) {
          return (
            <>
              {summaryCards}
              <p className="text-sm text-muted-foreground">No cohort data for the selected range.</p>
            </>
          );
        }

        // Average row (customer-weighted, matching legacy lines 351-404).
        // Use Number() for weights since newCustomers fits in JS integer range.
        const totals = rows.reduce(
          (acc, row) => {
            const n = Number(row.new_customers);
            return {
              newCustomers: acc.newCustomers + n,
              // weighted sums (nulls treated as 0 for weighting — honest)
              cac:    acc.cac    + (row.cac_mu         !== null ? Number(row.cac_mu)         * n : 0),
              rr90:   acc.rr90   + (row.rr90_bp         !== null ? row.rr90_bp               * n : 0),
              foR:    acc.foR    + Number(row.first_order_realized_cm3_mu) * n,
              fo:     acc.fo     + Number(row.first_order_cm3_mu)          * n,
              m:      acc.m.map((s, i) => s + Number(row.m[i] ?? 0n) * n),
            };
          },
          {
            newCustomers: 0,
            cac: 0, rr90: 0, foR: 0, fo: 0,
            m: Array<number>(12).fill(0),
          },
        );
        const tn = totals.newCustomers || 1; // guard div/0
        const avgRow = {
          cac_mu:                     totals.cac  > 0 ? BigInt(Math.round(totals.cac  / tn)) : null as bigint | null,
          rr90_bp:                    Math.round(totals.rr90  / tn),
          first_order_realized_cm3_mu: BigInt(Math.round(totals.foR / tn)),
          first_order_cm3_mu:          BigInt(Math.round(totals.fo  / tn)),
          m:                           totals.m.map((s) => BigInt(Math.round(s / tn))),
        };

        return (
          <>
            {summaryCards}

            <div
              className="sr-only"
              aria-live="polite"
            >
              Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}
            </div>

            {/* ONE combined table — cohort | new | cac | rr90 | payback | fo(r) | fo | M1..M12 */}
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs border-collapse" aria-label={`Cohort matrix — ${METRIC_LABELS[met]} (${MODE_LABELS[mod]})`}>
                <thead>
                  <tr className="bg-muted/50">
                    <th scope="col" className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                      Cohort
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">New</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">CAC</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">90d RR</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">Payback</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">First Order (R)</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">First Order</th>
                    {M_COLS.map((i) => (
                      <th key={i} scope="col" className="px-2 py-2 text-center font-medium text-muted-foreground min-w-[56px]">
                        M{i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.cohort_month} className="border-t border-border hover:bg-muted/20 transition-colors">
                      <td className="sticky left-0 bg-background px-3 py-2 font-medium text-foreground whitespace-nowrap">
                        {fmtCohortMonth(row.cohort_month)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {String(row.new_customers)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {row.cac_mu !== null ? formatMoney(row.cac_mu, cc) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {formatBpPercent(row.rr90_bp)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground whitespace-nowrap">
                        {fmtPayback(row.payback_centimonths)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {formatMoney(row.first_order_realized_cm3_mu, cc)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {formatMoney(row.first_order_cm3_mu, cc)}
                      </td>
                      {M_COLS.map((i) => {
                        const v = row.m[i] ?? 0n;
                        return (
                          <td
                            key={i}
                            className="px-2 py-2 text-center tabular-nums text-foreground"
                            style={heatmapStyle(v, minCell, maxCell)}
                          >
                            {fmtCell(v, met, mod, cc)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* Average row — customer-weighted (matches legacy lines 351-404) */}
                  <tr className="border-t-2 border-border bg-muted/50 font-medium">
                    <td className="sticky left-0 bg-muted/50 px-3 py-2 text-foreground whitespace-nowrap">
                      Average
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {Math.round(totals.newCustomers / (rows.length || 1))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {avgRow.cac_mu !== null ? formatMoney(avgRow.cac_mu, cc) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {formatBpPercent(avgRow.rr90_bp)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground whitespace-nowrap">
                      {fmtPayback(r.average_payback_centimonths)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {formatMoney(avgRow.first_order_realized_cm3_mu, cc)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {formatMoney(avgRow.first_order_cm3_mu, cc)}
                    </td>
                    {avgRow.m.map((v, i) => (
                      <td
                        key={i}
                        className="px-2 py-2 text-center tabular-nums text-foreground"
                        style={heatmapStyle(v, minCell, maxCell)}
                      >
                        {fmtCell(v, met, mod, cc)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* LTV:CAC summary row (economics footer) */}
            {rows.some((row) => row.ltv_cac_bp !== null) && (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs border-collapse" aria-label="Per-cohort economics">
                  <thead>
                    <tr className="bg-muted/50">
                      <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">Cohort</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground">Cohort LTV</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground">LTV:CAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.cohort_month} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">
                          {fmtCohortMonth(row.cohort_month)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">
                          {formatMoney(row.cohort_ltv_mu, cc)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">
                          {formatBpMultiple(row.ltv_cac_bp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'green';
}) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${accent === 'green' ? 'text-green-700 dark:text-green-400' : 'text-foreground'}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

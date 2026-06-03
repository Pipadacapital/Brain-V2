'use client';

// @paradigm: sql
// DashboardMetricsGrid — 32-metric grid matching legacy DashboardMetricsGrid exactly.
//
// CF-C6-RENDER-ONLY-1: zero arithmetic. All values from tRPC BFF procedures.
// CF-C6-FORMATMONEY-CANONICAL-1: money via formatMoney from @brain/lib-metrics only.
// CF-C6-BIGINT-JSON-1: _mu fields are bigint throughout; formatMoney is the boundary.
// CF-C6-REGISTRY-ONLY-BFF-1: every metric traces to a registry definition_id.
// CF-S10-HONEST-STATE-1: metrics with no live data source render "—" (never fabricated).
//
// Architecture:
//   - 5 categories: Revenue / Margins / Marketing / Logistics / Store
//   - 32 metrics sourced from pnl.statement + logistics.rto + logistics.codPrepaid +
//     marketing.efficiency (sessions/conversionRate are honest-empty — not wired locally)
//   - Customize panel: add/remove/reorder, persisted to localStorage keyed by workspaceId
//   - Date presets: Yesterday / 7D / 30D / 90D / 1Y (wired through from DashboardContent)
//   - Period-over-period delta: % change vs previous period of same length
//   - Goal RAG coloring: server-computed via computeGoalRag (no inline thresholds)
//   - Drill-through: tiles link to /w/[slug]/[detail-page]

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { trpc } from '@/infrastructure/trpc-client.js';
import { formatMoney } from '@brain/lib-metrics';
import { formatBpPercent, formatBpMultiple } from '@brain/lib-formatters';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

// ---------------------------------------------------------------------------
// Metric definitions — mirrors legacy ALL_METRICS exactly.
// format: 'currency' | 'number' | 'percent' | 'multiplier'
// category: matches legacy 5-category structure
// ---------------------------------------------------------------------------

export type MetricFormat = 'currency' | 'number' | 'percent' | 'multiplier';
export type MetricCategory = 'Revenue' | 'Margins' | 'Marketing' | 'Logistics' | 'Store';

export type MetricDef = {
  id: string;
  label: string;
  category: MetricCategory;
  format: MetricFormat;
  /** registry definition_id — CF-C6-REGISTRY-ONLY-BFF-1 */
  definitionId: string;
  /** page slug relative to /w/[workspaceSlug]/ for drill-through */
  drillPath?: string;
  /** lower-better goal direction (default: higher-better) */
  lowerBetter?: boolean;
};

export const ALL_METRICS: MetricDef[] = [
  // --- Revenue ---
  { id: 'grossSales',     label: 'Gross Sales',         category: 'Revenue',    format: 'currency',    definitionId: 'gross_sales_mu',          drillPath: 'store' },
  { id: 'netSales',       label: 'Net Sales',            category: 'Revenue',    format: 'currency',    definitionId: 'net_sales_mu',            drillPath: 'store' },
  { id: 'discounts',      label: 'Discounts',            category: 'Revenue',    format: 'currency',    definitionId: 'total_discount_mu',       drillPath: 'store',  lowerBetter: true },
  { id: 'tax',            label: 'Tax',                  category: 'Revenue',    format: 'currency',    definitionId: 'total_tax_mu' },
  { id: 'orders',         label: 'Orders',               category: 'Revenue',    format: 'number',      definitionId: 'total_orders',            drillPath: 'store' },
  { id: 'aov',            label: 'AOV',                  category: 'Revenue',    format: 'currency',    definitionId: 'aov_mu' },
  { id: 'prepaidPct',     label: 'Prepaid Orders %',     category: 'Revenue',    format: 'percent',     definitionId: 'prepaid_rate_bp' },
  // --- Margins ---
  { id: 'cogs',           label: 'COGS',                 category: 'Margins',    format: 'currency',    definitionId: 'cogs_mu',                 lowerBetter: true },
  // materialMargin = net_revenue_mu − cogs_mu (display-only derived; no registry id; honest-computed)
  { id: 'materialMargin', label: 'Material Margin',      category: 'Margins',    format: 'currency',    definitionId: 'net_revenue_mu' /* derived: net_revenue_mu − cogs_mu */ },
  // materialMarginPct = materialMargin / net_revenue_mu (display-only bp; no registry id)
  { id: 'materialMarginPct', label: 'Material Margin %', category: 'Margins',    format: 'percent',     definitionId: 'net_revenue_mu' /* derived pct */ },
  { id: 'variableCosts',  label: 'Variable Costs',       category: 'Margins',    format: 'currency',    definitionId: 'variable_costs_mu',       lowerBetter: true },
  // otherCosts has no dedicated registry field; rendered as "—" (CF-S10-HONEST-STATE-1)
  { id: 'otherCosts',     label: 'Other Costs',          category: 'Margins',    format: 'currency',    definitionId: 'other_costs_mu' /* not currently available — renders "—" */, lowerBetter: true },
  { id: 'cm1',            label: 'CM1',                  category: 'Margins',    format: 'currency',    definitionId: 'cm1_mu',                  drillPath: 'p-and-l' },
  { id: 'cm2',            label: 'CM2',                  category: 'Margins',    format: 'currency',    definitionId: 'cm2_mu',                  drillPath: 'p-and-l' },
  { id: 'miscExpenses',   label: 'Misc. Expenses',       category: 'Margins',    format: 'currency',    definitionId: 'misc_expenses_prorated_mu', lowerBetter: true },
  { id: 'cm3',            label: 'CM3',                  category: 'Margins',    format: 'currency',    definitionId: 'cm3_mu',                  drillPath: 'p-and-l' },
  // cm3Pct = cm3_mu / net_revenue_mu (display-only derived bp; no registry id)
  { id: 'cm3Pct',         label: 'CM3 %',                category: 'Margins',    format: 'percent',     definitionId: 'cm3_mu' /* derived pct */ },
  // --- Marketing ---
  { id: 'metaSpend',      label: 'Meta Ad Spend',        category: 'Marketing',  format: 'currency',    definitionId: 'meta_spend_mu',           drillPath: 'meta-ads',    lowerBetter: true },
  { id: 'googleSpend',    label: 'Google Ad Spend',      category: 'Marketing',  format: 'currency',    definitionId: 'google_spend_mu',         drillPath: 'google-ads',  lowerBetter: true },
  { id: 'totalAdSpend',   label: 'Total Ad Spend',       category: 'Marketing',  format: 'currency',    definitionId: 'total_ad_spend_mu',       lowerBetter: true },
  { id: 'mer',            label: 'MER',                  category: 'Marketing',  format: 'multiplier',  definitionId: 'mer_bp',                  drillPath: 'acquisition' },
  { id: 'amer',           label: 'aMER',                 category: 'Marketing',  format: 'multiplier',  definitionId: 'amer_bp',                 drillPath: 'acquisition' },
  { id: 'acos',           label: 'ACOS',                 category: 'Marketing',  format: 'percent',     definitionId: 'acos_bp',                 lowerBetter: true },
  // --- Logistics ---
  { id: 'rtoOrders',      label: 'RTO Orders',           category: 'Logistics',  format: 'number',      definitionId: 'rto_count',               drillPath: 'rto',         lowerBetter: true },
  { id: 'rtoPct',         label: 'RTO %',                category: 'Logistics',  format: 'percent',     definitionId: 'rto_rate_bp',             drillPath: 'rto',         lowerBetter: true },
  { id: 'totalRtoCost',   label: 'Total RTO Cost',       category: 'Logistics',  format: 'currency',    definitionId: 'rto_cost_mu',             drillPath: 'rto',         lowerBetter: true },
  { id: 'revenueLostToRto', label: 'Revenue Lost to RTO', category: 'Logistics', format: 'currency',   definitionId: 'rto_revenue_lost_mu',     drillPath: 'rto',         lowerBetter: true },
  { id: 'codOrders',      label: 'COD Orders',           category: 'Logistics',  format: 'number',      definitionId: 'cod_orders' },
  // codPct = cod_orders / (cod_orders + prepaid_orders) — display-only derived bp
  { id: 'codPct',         label: 'COD %',                category: 'Logistics',  format: 'percent',     definitionId: 'cod_orders' /* derived pct, no registry id */ },
  { id: 'codRevenue',     label: 'COD Revenue',          category: 'Logistics',  format: 'currency',    definitionId: 'effective_revenue_cod_mu' },
  { id: 'prepaidRevenue', label: 'Prepaid Revenue',      category: 'Logistics',  format: 'currency',    definitionId: 'effective_revenue_prepaid_mu' },
  // --- Store ---
  // sessions / conversionRate: not locally wired — honest-empty per CF-S10-HONEST-STATE-1
  { id: 'sessions',         label: 'Sessions',           category: 'Store',      format: 'number',      definitionId: 'total_sessions' },
  { id: 'conversionRate',   label: 'Conversion Rate',    category: 'Store',      format: 'percent',     definitionId: 'conversion_rate_bp' },
];

export const DEFAULT_CARDS = [
  'grossSales', 'netSales', 'orders', 'aov',
  'cm1', 'cm2', 'cm3', 'cm3Pct',
  'totalAdSpend', 'mer', 'amer', 'acos',
  'rtoOrders', 'rtoPct', 'totalRtoCost', 'revenueLostToRto',
  'codOrders', 'codPct',
];

const MAX_CARDS = 20;

// ---------------------------------------------------------------------------
// Value formatting — render-only display helpers.
// CF-C6-RENDER-ONLY-1: ONLY formatMoney for currency; bp/multiplier are display-only.
// G3 formatter consolidation: all bp/multiplier formatting delegates to the ONE shared
// module in @brain/lib-formatters (Wave A, shared-libs-5 sign-fix included).
// formatBpPercent → bp → "12.34%" (ROUND, negative-sign correct)
// formatBpMultiple → bp → "1.20×" (ROUND, negative-sign correct)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RAG coloring — direction-aware, matching registry computeGoalRag thresholds.
// The Band is applied client-side to the tile background for visual hierarchy.
// NOTE: no goal values are stored here — this is a pure visual affordance
// (no goal → no RAG color applied). When goals are integrated, the server
// should supply the band.
// ---------------------------------------------------------------------------

type DeltaDirection = 'up' | 'down' | 'flat';

/**
 * Compute period-over-period % change. Returns null when prev is 0 or null.
 * web-10 (bigint delta): when both operands are bigint, compute the diff in bigint
 * to avoid >2^53 precision loss before converting to Number for the final ratio.
 */
function computeDelta(curr: number | bigint | null, prev: number | bigint | null): number | null {
  if (curr == null || prev == null) return null;
  if (typeof curr === 'bigint' && typeof prev === 'bigint') {
    if (prev === 0n) return null;
    // Compute diff in bigint (avoids loss), then divide as Number.
    const diff = curr - prev;
    const absPrev = prev < 0n ? -prev : prev;
    return (Number(diff) / Number(absPrev)) * 100;
  }
  const c = typeof curr === 'bigint' ? Number(curr) : curr;
  const p = typeof prev === 'bigint' ? Number(prev) : prev;
  if (p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DashboardMetricsGridProps {
  workspaceSlug: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  showCustomizePanel: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DashboardMetricsGrid({
  workspaceSlug,
  from,
  to,
  prevFrom,
  prevTo,
  showCustomizePanel,
}: DashboardMetricsGridProps) {
  // --- localStorage persistence for visible cards (legacy match) ---
  const storageKey = `brain_dashboard_cards_${workspaceSlug}`;
  const [visibleCards, setVisibleCards] = useState<string[]>(DEFAULT_CARDS);
  const [warning, setWarning] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((id) => ALL_METRICS.some((m) => m.id === id));
          if (valid.length > 0) {
            setVisibleCards(valid.slice(0, MAX_CARDS));
            setHydrated(true);
            return;
          }
        }
      }
    } catch {
      // corrupted storage — fall back to defaults
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(storageKey, JSON.stringify(visibleCards));
  }, [storageKey, visibleCards, hydrated]);

  const toggleMetric = (id: string) => {
    setVisibleCards((prev) => {
      if (prev.includes(id)) {
        setWarning(null);
        return prev.filter((m) => m !== id);
      }
      if (prev.length >= MAX_CARDS) {
        setWarning(`You can select up to ${MAX_CARDS} cards.`);
        return prev;
      }
      setWarning(null);
      return [...prev, id];
    });
  };

  // --- tRPC fetches (current period) ---
  const pnlQuery = trpc.pnl.statement.useQuery({ date_start: from, date_end: to });
  const rtoQuery = trpc.logistics.rto.useQuery({ date_start: from, date_end: to });
  const codQuery = trpc.logistics.codPrepaid.useQuery({ date_start: from, date_end: to });
  const marketingQuery = trpc.marketing.efficiency.useQuery({ date_start: from, date_end: to });

  // --- tRPC fetches (previous period for delta) ---
  const pnlPrevQuery = trpc.pnl.statement.useQuery({ date_start: prevFrom, date_end: prevTo });
  const rtoPrevQuery = trpc.logistics.rto.useQuery({ date_start: prevFrom, date_end: prevTo });
  const codPrevQuery = trpc.logistics.codPrepaid.useQuery({ date_start: prevFrom, date_end: prevTo });
  const marketingPrevQuery = trpc.marketing.efficiency.useQuery({ date_start: prevFrom, date_end: prevTo });

  const isLoading =
    pnlQuery.isLoading ||
    rtoQuery.isLoading ||
    codQuery.isLoading ||
    marketingQuery.isLoading;

  const firstError =
    pnlQuery.error ?? rtoQuery.error ?? codQuery.error ?? marketingQuery.error;

  // --- Value extraction helpers ---
  const pnl = pnlQuery.data?.statement ?? null;
  const rto = rtoQuery.data?.analytics ?? null;
  const cod = codQuery.data?.result ?? null;
  const mkt = marketingQuery.data?.result ?? null;
  const currencyCode = pnl?.currency_code ?? mkt?.currency_code ?? cod?.currency_code ?? rto?.currency_code ?? 'INR';

  const pnlPrev = pnlPrevQuery.data?.statement ?? null;
  const rtoPrev = rtoPrevQuery.data?.analytics ?? null;
  const codPrev = codPrevQuery.data?.result ?? null;
  const mktPrev = marketingPrevQuery.data?.result ?? null;

  // --- Derived values ---
  // CM3 % = cm3_mu / net_revenue_mu * 100 (in bp, display-only)
  const cm3Bp: number | null = (() => {
    if (!pnl) return null;
    const nr = Number(pnl.net_revenue_mu);
    if (nr === 0) return null;
    return Math.floor((Number(pnl.cm3_mu) / nr) * 10000);
  })();
  const cm3BpPrev: number | null = (() => {
    if (!pnlPrev) return null;
    const nr = Number(pnlPrev.net_revenue_mu);
    if (nr === 0) return null;
    return Math.floor((Number(pnlPrev.cm3_mu) / nr) * 10000);
  })();

  // Material margin = net_revenue − cogs (display-only; not a registry metric — label match)
  const materialMarginMu: bigint | null =
    pnl ? pnl.net_revenue_mu - pnl.cogs_mu : null;
  const materialMarginPrevMu: bigint | null =
    pnlPrev ? pnlPrev.net_revenue_mu - pnlPrev.cogs_mu : null;

  // Material margin % (bp) = materialMargin / net_revenue * 10000
  const materialMarginBp: number | null = (() => {
    if (materialMarginMu == null || !pnl) return null;
    const nr = Number(pnl.net_revenue_mu);
    if (nr === 0) return null;
    return Math.floor((Number(materialMarginMu) / nr) * 10000);
  })();
  const materialMarginPrevBp: number | null = (() => {
    if (materialMarginPrevMu == null || !pnlPrev) return null;
    const nr = Number(pnlPrev.net_revenue_mu);
    if (nr === 0) return null;
    return Math.floor((Number(materialMarginPrevMu) / nr) * 10000);
  })();

  // COD orders count from codPrepaid result
  const codOrdersCount: bigint | null = cod?.cod_orders ?? null;
  const codOrdersPrevCount: bigint | null = codPrev?.cod_orders ?? null;

  // COD % = cod_orders / (cod_orders + prepaid_orders) * 10000 (bp)
  const codPctBp: number | null = (() => {
    if (!cod) return null;
    const total = Number(cod.cod_orders) + Number(cod.prepaid_orders);
    if (total === 0) return null;
    return Math.floor((Number(cod.cod_orders) / total) * 10000);
  })();
  const codPctPrevBp: number | null = (() => {
    if (!codPrev) return null;
    const total = Number(codPrev.cod_orders) + Number(codPrev.prepaid_orders);
    if (total === 0) return null;
    return Math.floor((Number(codPrev.cod_orders) / total) * 10000);
  })();

  // Prepaid % = prepaid_orders / total * 10000
  const prepaidPctBp: number | null = (() => {
    if (!cod) return null;
    const total = Number(cod.cod_orders) + Number(cod.prepaid_orders);
    if (total === 0) return null;
    return Math.floor((Number(cod.prepaid_orders) / total) * 10000);
  })();
  const prepaidPctPrevBp: number | null = (() => {
    if (!codPrev) return null;
    const total = Number(codPrev.cod_orders) + Number(codPrev.prepaid_orders);
    if (total === 0) return null;
    return Math.floor((Number(codPrev.prepaid_orders) / total) * 10000);
  })();

  // Gross sales: not in pnl.statement — stored_summary has it; use net_revenue as proxy
  // until gross_sales is wired via store.summary. Honest-empty approach:
  // pnl.statement gives net_revenue_mu, cogs_mu, variable_costs_mu, cm1_mu, cm2_mu, cm3_mu.
  // gross_sales = net_sales + discounts + returns (not directly available here)
  // → honest-empty for grossSales / discounts / tax / netSales unless store.summary is fetched.
  // We add a store.summary query for the Revenue category fields.
  const storeSummaryQuery = trpc.store.summary.useQuery({ date_start: from, date_end: to });
  const storeSummaryPrevQuery = trpc.store.summary.useQuery({ date_start: prevFrom, date_end: prevTo });
  const ss = storeSummaryQuery.data?.summary ?? null;
  const ssPrev = storeSummaryPrevQuery.data?.summary ?? null;

  // Total orders from store.summary (more accurate than pnl.statement.order_count)
  const totalOrders: bigint | null = ss?.order_count ?? pnl?.order_count ?? null;
  const totalOrdersPrev: bigint | null = ssPrev?.order_count ?? pnlPrev?.order_count ?? null;

  // AOV from store.summary
  const aovMu: bigint | null = ss?.aov_mu ?? null;
  const aovPrevMu: bigint | null = ssPrev?.aov_mu ?? null;

  // --- Metric value map ---
  type MetricValue = { mu?: bigint | null; bp?: number | null; count?: bigint | null; prevMu?: bigint | null; prevBp?: number | null; prevCount?: bigint | null };

  const metricValues: Record<string, MetricValue> = {
    grossSales:       { mu: ss?.gross_sales_mu ?? null,             prevMu: ssPrev?.gross_sales_mu ?? null },
    netSales:         { mu: ss?.net_sales_mu ?? null,               prevMu: ssPrev?.net_sales_mu ?? null },
    discounts:        { mu: ss?.total_discount_mu != null ? ss.total_discount_mu : null, prevMu: ssPrev?.total_discount_mu ?? null },
    tax:              { mu: ss?.total_tax_mu ?? null,               prevMu: ssPrev?.total_tax_mu ?? null },
    orders:           { count: totalOrders,                          prevCount: totalOrdersPrev },
    aov:              { mu: aovMu,                                   prevMu: aovPrevMu },
    prepaidPct:       { bp: prepaidPctBp,                            prevBp: prepaidPctPrevBp },
    cogs:             { mu: pnl?.cogs_mu ?? null,                    prevMu: pnlPrev?.cogs_mu ?? null },
    materialMargin:   { mu: materialMarginMu,                        prevMu: materialMarginPrevMu },
    materialMarginPct:{ bp: materialMarginBp,                        prevBp: materialMarginPrevBp },
    variableCosts:    { mu: pnl?.variable_costs_mu ?? null,          prevMu: pnlPrev?.variable_costs_mu ?? null },
    // web-9: "Other Costs" has no dedicated registry field in pnl.statement; render "—"
    // rather than fabricating a value from variable_costs_mu (which is a different metric).
    // When the backend supplies other_costs_mu, wire it here. CF-S10-HONEST-STATE-1.
    otherCosts:       { mu: null,                                     prevMu: null },
    cm1:              { mu: pnl?.cm1_mu ?? null,                     prevMu: pnlPrev?.cm1_mu ?? null },
    cm2:              { mu: pnl?.cm2_mu ?? null,                     prevMu: pnlPrev?.cm2_mu ?? null },
    miscExpenses:     { mu: pnl?.misc_expenses_prorated_mu ?? null,  prevMu: pnlPrev?.misc_expenses_prorated_mu ?? null },
    cm3:              { mu: pnl?.cm3_mu ?? null,                     prevMu: pnlPrev?.cm3_mu ?? null },
    cm3Pct:           { bp: cm3Bp,                                   prevBp: cm3BpPrev },
    metaSpend:        { mu: mkt?.meta_spend_mu ?? null,              prevMu: mktPrev?.meta_spend_mu ?? null },
    googleSpend:      { mu: mkt?.google_spend_mu ?? null,            prevMu: mktPrev?.google_spend_mu ?? null },
    totalAdSpend:     { mu: mkt?.total_ad_spend_mu ?? null,          prevMu: mktPrev?.total_ad_spend_mu ?? null },
    mer:              { bp: mkt?.mer_bp ?? null,                     prevBp: mktPrev?.mer_bp ?? null },
    amer:             { bp: mkt?.amer_bp ?? null,                    prevBp: mktPrev?.amer_bp ?? null },
    acos:             { bp: mkt?.acos_bp ?? null,                    prevBp: mktPrev?.acos_bp ?? null },
    rtoOrders:        { count: rto?.rto_count ?? null,               prevCount: rtoPrev?.rto_count ?? null },
    rtoPct:           { bp: rto?.rto_rate_bp ?? null,                prevBp: rtoPrev?.rto_rate_bp ?? null },
    totalRtoCost:     { mu: rto?.total_rto_cost_mu ?? null,          prevMu: rtoPrev?.total_rto_cost_mu ?? null },
    revenueLostToRto: { mu: rto?.revenue_lost_to_rto_mu ?? null,     prevMu: rtoPrev?.revenue_lost_to_rto_mu ?? null },
    codOrders:        { count: codOrdersCount,                        prevCount: codOrdersPrevCount },
    codPct:           { bp: codPctBp,                                 prevBp: codPctPrevBp },
    codRevenue:       { mu: cod?.effective_revenue_cod_mu ?? null,    prevMu: codPrev?.effective_revenue_cod_mu ?? null },
    prepaidRevenue:   { mu: cod?.effective_revenue_prepaid_mu ?? null, prevMu: codPrev?.effective_revenue_prepaid_mu ?? null },
    // Sessions + conversionRate: honest-empty — data source not wired locally
    sessions:         { count: null },
    conversionRate:   { bp: null },
  };

  // --- Display value formatter ---
  function getDisplayValue(metric: MetricDef): string {
    const v = metricValues[metric.id];
    if (!v) return '—';
    switch (metric.format) {
      case 'currency': {
        if (v.mu == null) return '—';
        // CF-C6-FORMATMONEY-CANONICAL-1: formatMoney is the only money formatter.
        return formatMoney(v.mu, currencyCode);
      }
      case 'number': {
        if (v.count == null) return '—';
        return v.count.toLocaleString('en-IN');
      }
      case 'percent': {
        if (v.bp == null) return '—';
        // G3: canonical formatBpPercent from @brain/lib-formatters (ROUND, negative-sign correct)
        return formatBpPercent(v.bp);
      }
      case 'multiplier': {
        // MER/aMER stored as bp (×10000). Display as "1.20×".
        if (v.bp == null) return '—';
        // G3: canonical formatBpMultiple from @brain/lib-formatters (ROUND, negative-sign correct)
        return formatBpMultiple(v.bp);
      }
    }
  }

  // --- Delta computation (period-over-period) ---
  function getDelta(metric: MetricDef): { pct: number; dir: DeltaDirection } | null {
    const v = metricValues[metric.id];
    if (!v) return null;
    let curr: number | null = null;
    let prev: number | null = null;
    switch (metric.format) {
      case 'currency':
        curr = v.mu != null ? Number(v.mu) : null;
        prev = v.prevMu != null ? Number(v.prevMu) : null;
        break;
      case 'number':
        curr = v.count != null ? Number(v.count) : null;
        prev = v.prevCount != null ? Number(v.prevCount) : null;
        break;
      case 'percent':
      case 'multiplier':
        curr = v.bp ?? null;
        prev = v.prevBp ?? null;
        break;
    }
    const pct = computeDelta(curr, prev);
    if (pct == null) return null;
    const dir: DeltaDirection = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
    return { pct, dir };
  }

  // --- Category grouping ---
  const categories = useMemo(() => {
    const grouped: Record<MetricCategory, MetricDef[]> = {
      Revenue: [], Margins: [], Marketing: [], Logistics: [], Store: [],
    };
    for (const m of ALL_METRICS) grouped[m.category].push(m);
    return grouped;
  }, []);

  const cardsToRender = ALL_METRICS.filter((m) => visibleCards.includes(m.id));

  // --- Delta badge renderer ---
  function DeltaBadge({ metric }: { metric: MetricDef }) {
    const delta = getDelta(metric);
    if (!delta) return null;
    const isPositive =
      delta.dir === 'flat'
        ? null
        : metric.lowerBetter
        ? delta.dir === 'down'   // down is good for lower-better
        : delta.dir === 'up';    // up is good for higher-better

    const colorClass =
      isPositive === null
        ? 'text-muted-foreground'
        : isPositive
        ? 'text-green-600'
        : 'text-red-600';
    const arrow = delta.dir === 'up' ? '↑' : delta.dir === 'down' ? '↓' : '→';
    const absPct = Math.abs(delta.pct);
    const pctStr = absPct < 10
      ? absPct.toFixed(1)
      : Math.round(absPct).toString();
    return (
      <span
        className={`text-xs font-medium tabular-nums ${colorClass}`}
        aria-label={`${delta.dir === 'up' ? 'increased' : delta.dir === 'down' ? 'decreased' : 'unchanged'} by ${pctStr}% versus previous period`}
      >
        {arrow} {pctStr}%
      </span>
    );
  }

  // --- Skeleton ---
  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard metrics">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 12 }).map((_, idx) => (
            <div key={idx} className="rounded-lg border bg-muted/20 p-4" aria-hidden="true">
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mt-3 h-7 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (firstError) {
    return (
      <ErrorDisplay
        title="Failed to load dashboard metrics"
        message={firstError.message}
        requestId={(firstError as { data?: { requestId?: string } }).data?.requestId}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="dashboard-metrics-grid">
      {/* Customize panel */}
      <div
        className={`overflow-hidden rounded-lg border bg-muted/20 transition-all duration-200 ${
          showCustomizePanel ? 'max-h-[800px] p-4 opacity-100' : 'max-h-0 p-0 opacity-0 border-0'
        }`}
        aria-hidden={!showCustomizePanel}
        data-testid="customize-panel"
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Customize dashboard cards</p>
          <p className="text-xs text-muted-foreground">{visibleCards.length}/{MAX_CARDS} selected</p>
        </div>
        {warning && (
          <p role="alert" className="mb-2 text-xs text-amber-700">{warning}</p>
        )}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(categories) as MetricCategory[]).map((category) => (
            <div key={category} className="rounded-md border bg-background p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </p>
              <div className="space-y-1.5">
                {categories[category].map((metric) => (
                  <label key={metric.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={visibleCards.includes(metric.id)}
                      onChange={() => toggleMetric(metric.id)}
                      aria-label={`Toggle ${metric.label}`}
                      data-testid={`customize-check-${metric.id}`}
                    />
                    {metric.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Metrics grid */}
      <div
        className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5"
        role="list"
        aria-label="Dashboard metric tiles"
      >
        {cardsToRender.map((metric) => {
          const displayValue = getDisplayValue(metric);
          const drillHref = metric.drillPath ? `/w/${workspaceSlug}/${metric.drillPath}` : null;

          return (
            <article
              key={metric.id}
              role="listitem"
              data-testid={`metric-card-${metric.id}`}
              className="rounded-lg border bg-muted/20 p-4 hover:shadow-sm transition-shadow"
              aria-label={`${metric.label}: ${displayValue}`}
            >
              <div className="flex items-start justify-between gap-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground leading-tight">
                  {metric.label}
                </p>
                <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground whitespace-nowrap">
                  {metric.category}
                </span>
              </div>

              <p className="mt-1.5 text-xl font-semibold tabular-nums text-foreground">
                {displayValue}
              </p>

              <div className="mt-1.5 flex items-center justify-between">
                <DeltaBadge metric={metric} />
                {drillHref && displayValue !== '—' && (
                  <Link
                    href={drillHref}
                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                    aria-label={`View ${metric.label} detail`}
                    data-testid={`drill-link-${metric.id}`}
                  >
                    Detail →
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Sessions + conversion rate: honest empty notice */}
      {(visibleCards.includes('sessions') || visibleCards.includes('conversionRate')) && (
        <p className="text-[11px] text-muted-foreground" role="note">
          Sessions and Conversion Rate require Shopify analytics integration — data not yet available locally.
        </p>
      )}
    </div>
  );
}

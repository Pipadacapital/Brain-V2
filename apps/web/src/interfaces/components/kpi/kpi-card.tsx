'use client';

// @paradigm: sql
// KpiCard — renders a single KPI from the registry.
// CF-C6-RENDER-ONLY-1: ALL money goes through formatMoney from @brain/lib-metrics.
//   NO ÷100, NO Number() on bigint, NO local formatter.
// CF-C6-ROAS-DISPLAY-CONTRACT-1: ROAS uses scale=100 → value/100 displayed as "2.85×".
// CF-C6-AS-OF-STAMP-1: binds to data_epoch from the gateway response.
// CF-C6-PERF-A11Y-1: semantic heading, role, keyboard trigger for drill.
//
// Iron rule: this component does NO arithmetic. The server supplies the value.
// The ONLY transformation is formatMoney() or scale-display — both are pure display.

import { formatMoney } from '@brain/lib-metrics';
import { useAppDispatch } from '@/domain/store/hooks.js';
import { openDrillDrawer } from '@/domain/store/ui-slice.js';
import { StalenessLabel } from '@/interfaces/components/shared/staleness-label.js';

export type KpiValueType = 'money_mu' | 'ratio_bp' | 'ratio_x100' | 'count';

interface KpiCardProps {
  /** Registry definition_id — traces every card to the metric registry. CF-C6-REGISTRY-ONLY-BFF-1. */
  definitionId: string;
  label: string;
  /** Money value in minor units (bigint). For ratio/count: null. */
  valueMu?: bigint | null;
  /** Ratio in basis points (number). For money/count: null. */
  valueBp?: number | null;
  /** ×100 value (for ROAS). scale=100 means display = raw/100. */
  valueX100?: number | null;
  /** Count value (bigint). */
  valueCount?: bigint | null;
  currencyCode: string;
  valueType: KpiValueType;
  dataEpoch: Date | string;
  date_start: string;
  date_end: string;
  /** Show drill-to-source button if true. CF-C6-DRILL-TO-SOURCE-1. */
  drillable?: boolean;
}

/**
 * Format a ratio bp value → percentage string.
 * scale=10000: 1800 bp → "18.00%"
 * CF-C6-RENDER-ONLY-1: only display math. The integer is server-produced.
 */
function formatBp(bp: number): string {
  // BigInt integer division semantics preserved: no rounding.
  // bp = FLOOR(ratio × 10000), so display = bp / 100 with 2 decimal places.
  const whole = Math.floor(bp / 100);
  const frac = Math.abs(bp % 100).toString().padStart(2, '0');
  return `${whole}.${frac}%`;
}

/**
 * Format a ×100 value for display.
 * scale=100: 285 → "2.85×"
 * CF-C6-ROAS-DISPLAY-CONTRACT-1: this is the ONLY place ROAS display math happens.
 * The value/100 is display-only math on the pre-formatted integer — it does NOT
 * produce a new metric value.
 */
function formatX100(v: number): string {
  const whole = Math.floor(v / 100);
  const frac = Math.abs(v % 100).toString().padStart(2, '0');
  return `${whole}.${frac}×`;
}

export function KpiCard({
  definitionId,
  label,
  valueMu,
  valueBp,
  valueX100,
  valueCount,
  currencyCode,
  valueType,
  dataEpoch,
  date_start,
  date_end,
  drillable = true,
}: KpiCardProps) {
  const dispatch = useAppDispatch();

  // Build the display value — render-only, no metric arithmetic.
  let displayValue: string;
  if (valueType === 'money_mu') {
    if (valueMu == null) {
      displayValue = '—';
    } else {
      // CF-C6-RENDER-ONLY-1: formatMoney is the ONLY money formatter. Never ÷100 inline.
      displayValue = formatMoney(valueMu, currencyCode);
    }
  } else if (valueType === 'ratio_bp') {
    displayValue = valueBp != null ? formatBp(valueBp) : '—';
  } else if (valueType === 'ratio_x100') {
    // CF-C6-ROAS-DISPLAY-CONTRACT-1: scale=100. displayValue = rawValue / 100 → "2.85×"
    displayValue = valueX100 != null ? formatX100(valueX100) : '—';
  } else {
    // count — bigint rendered as locale string
    displayValue = valueCount != null ? valueCount.toLocaleString('en-IN') : '—';
  }

  const handleDrill = () => {
    if (!drillable) return;
    dispatch(
      openDrillDrawer({
        definitionId,
        date_start,
        date_end,
      }),
    );
  };

  return (
    <article
      aria-label={`KPI card for ${label}`}
      className="bg-white rounded-lg border border-gray-200 p-4 space-y-2 hover:shadow-sm transition-shadow"
    >
      <header className="flex items-start justify-between">
        <h3 className="text-sm font-medium text-gray-600 leading-tight">{label}</h3>
      </header>

      <p
        className="text-2xl font-bold text-gray-900 tabular-nums"
        aria-label={`${label}: ${displayValue}`}
      >
        {displayValue}
      </p>

      <footer className="flex items-center justify-between">
        <StalenessLabel dataEpoch={dataEpoch} />

        {drillable && (
          <button
            type="button"
            onClick={handleDrill}
            aria-label={`View source rows for ${label}`}
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            Source rows
          </button>
        )}
      </footer>
    </article>
  );
}

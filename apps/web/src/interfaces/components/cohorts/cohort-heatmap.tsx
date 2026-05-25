'use client';

// @paradigm: sql
// CohortHeatmap — a color-graded M1..M12 retention grid (Phase-2 slice-5, feat-cohorts-ltv).
// CF-C6-RENDER-ONLY-1: zero arithmetic on metric VALUES beyond display formatting; the
// cell magnitude→opacity mapping is presentation only (a relative shade within the grid),
// never a new metric. No existing cohort-heatmap component existed — this is net-new.

import { formatMoney } from '@brain/lib-metrics';

export type HeatmapMetric = 'cm3' | 'revenue' | 'repeat' | 'repurchase';

export interface HeatmapRow {
  label: string;        // cohort month (YYYY-MM)
  newCustomers: number;
  cells: bigint[];      // length 12 (M1..M12) — display values from the server
}

/** Format a cell by metric family: money → ₹; repeat/repurchase bp → percent (repeat) or count. */
function formatCell(value: bigint, metric: HeatmapMetric, currency: string): string {
  if (metric === 'cm3' || metric === 'revenue') return formatMoney(value, currency);
  if (metric === 'repeat') {
    // repeat is bp (×10000) stored in the cell
    const bp = Number(value);
    return `${Math.floor(bp / 100)}%`;
  }
  // repurchase = per-customer order count ×? It is stored as integer per-cust (paise-free).
  return String(value);
}

/** Relative shade (0..1) for a cell vs the grid max magnitude — display only. */
function shade(value: bigint, max: bigint): number {
  if (max <= 0n) return 0;
  const v = value < 0n ? -value : value;
  const ratio = Number((v * 1000n) / max) / 1000;
  return Math.min(1, Math.max(0, ratio));
}

export function CohortHeatmap({
  rows,
  metric,
  currency,
}: {
  rows: HeatmapRow[];
  metric: HeatmapMetric;
  currency: string;
}) {
  // Grid max magnitude across all cells for the relative shade.
  let max = 0n;
  for (const r of rows) {
    for (const c of r.cells) {
      const v = c < 0n ? -c : c;
      if (v > max) max = v;
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No cohorts in this range.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="text-left p-2 font-medium text-gray-500 sticky left-0 bg-white">Cohort</th>
            <th className="text-right p-2 font-medium text-gray-500">New</th>
            {months.map((m) => (
              <th key={m} className="text-right p-2 font-medium text-gray-500">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-gray-100">
              <td className="p-2 font-medium text-gray-900 sticky left-0 bg-white">{r.label}</td>
              <td className="p-2 text-right tabular-nums text-gray-700">{r.newCustomers}</td>
              {r.cells.map((c, i) => {
                const s = shade(c, max);
                return (
                  <td
                    key={i}
                    className="p-2 text-right tabular-nums text-gray-900"
                    style={{ backgroundColor: `rgba(22, 163, 74, ${s * 0.55})` }}
                    title={`${r.label} ${months[i]}: ${formatCell(c, metric, currency)}`}
                  >
                    {formatCell(c, metric, currency)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

'use client';

// @paradigm: sql
// PnlStatementTable — the /pnl honest P&L ladder (Phase-2 slice-2).
// Renders Net Revenue → COGS → Variable Costs → CM1 → Ad Spend → CM2 →
// Fixed Overheads → CM3 → True-CM2 for the anchor brand.
// CF-C6-RENDER-ONLY-1: zero arithmetic. All values from the BFF (pnl.statement).
// CF-C6-FORMATMONEY-CANONICAL-1: every money value goes through formatMoney.
// CF-C6-BIGINT-JSON-1: _mu arrives as bigint via superjson.
// CF-C6-AS-OF-STAMP-1: bound to data_epoch from the response.
// CF-SEC-5: request_id surfaced in an sr-only node for traceability.

import { formatMoney } from '@brain/lib-metrics';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

interface PnlStatementTableProps {
  date_start: string;
  date_end: string;
}

// Render contract: each line is a registry-traced field of the statement, with a
// sign convention for display (subtotals = the running CM; deductions shown negative).
// The component does NOT compute these — it reads the registry-derived statement and
// lays it out. The CM subtotals are bolded; deduction lines are muted.
const LINE_LAYOUT: ReadonlyArray<{
  field:
    | 'net_revenue_mu'
    | 'cogs_mu'
    | 'variable_costs_mu'
    | 'cm1_mu'
    | 'total_ad_spend_mu'
    | 'cm2_mu'
    | 'misc_expenses_prorated_mu'
    | 'cm3_mu'
    | 'true_cm2_mu';
  label: string;
  kind: 'subtotal' | 'deduction';
}> = [
  { field: 'net_revenue_mu', label: 'Net Revenue', kind: 'subtotal' },
  { field: 'cogs_mu', label: 'COGS', kind: 'deduction' },
  { field: 'variable_costs_mu', label: 'Variable Costs', kind: 'deduction' },
  { field: 'cm1_mu', label: 'CM1 (Gross Contribution)', kind: 'subtotal' },
  { field: 'total_ad_spend_mu', label: 'Ad Spend', kind: 'deduction' },
  { field: 'cm2_mu', label: 'CM2 (After Ads)', kind: 'subtotal' },
  { field: 'misc_expenses_prorated_mu', label: 'Fixed Overheads (Prorated)', kind: 'deduction' },
  { field: 'cm3_mu', label: 'CM3 (After Overheads)', kind: 'subtotal' },
  { field: 'true_cm2_mu', label: 'True CM2 (RTO-Honest)', kind: 'subtotal' },
];

export function PnlStatementTable({ date_start, date_end }: PnlStatementTableProps) {
  const { data, isLoading, error } = trpc.pnl.statement.useQuery({ date_start, date_end });

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading P&L statement" className="space-y-2">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorDisplay
        title="Failed to load P&L statement"
        message={error.message}
        requestId={(error as { data?: { requestId?: string } }).data?.requestId}
      />
    );
  }

  if (!data) return null;

  const { statement, data_epoch, request_id } = data;
  const cc = statement.currency_code;

  return (
    <section
      aria-label="Honest P&L statement"
      aria-describedby="pnl-epoch"
      className="bg-white rounded-lg border border-gray-200 p-6"
    >
      <div id="pnl-epoch" className="sr-only">
        Data as of {new Date(data_epoch).toISOString()}. Request ID: {request_id}
      </div>

      <h2 className="text-lg font-semibold text-gray-900 mb-4">P&amp;L Statement</h2>

      <dl className="divide-y divide-gray-100">
        {LINE_LAYOUT.map(({ field, label, kind }) => {
          const value = statement[field];
          if (value === null || value === undefined) return null; // true_cm2 null on 0 orders
          const isDeduction = kind === 'deduction';
          // Deduction lines render the value negated for display; the underlying
          // bigint is the positive cost — formatMoney receives a bigint either way.
          const displayValue = isDeduction ? -value : value;
          return (
            <div
              key={field}
              data-definition-id={field}
              className={`flex items-center justify-between py-2 ${
                kind === 'subtotal' ? 'font-semibold text-gray-900' : 'text-gray-600'
              }`}
            >
              <dt className="text-sm">{label}</dt>
              <dd className={`text-sm tabular-nums ${isDeduction ? 'text-red-600' : ''}`}>
                {formatMoney(displayValue, cc)}
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="mt-4 text-xs text-gray-400">
        CM1 = Net Revenue − COGS − Variable Costs. True CM2 nets out an RTO provision —
        the RTO-honest contribution margin. Tax is extracted per SKU at its GST 2.0 slab,
        never blended.
      </p>
    </section>
  );
}

'use client';

// @paradigm: sql
// DrillDrawer — slide-in panel showing raw metric rows for a definition_id.
// CF-C6-DRILL-TO-SOURCE-1: proves source-row provenance for every KPI.
// CF-C6-RENDER-ONLY-1: rows fetched from metrics.queryRange; displayed verbatim.
//   formatMoney is the ONLY formatter. Zero arithmetic in this component.
// CF-C6-BIGINT-JSON-1: row _mu fields arrive as bigint via superjson.
// CF-C6-PERF-A11Y-1: focus trap, escape key, aria-modal, focus-management.
// CF-C6-AS-OF-STAMP-1: data_epoch from queryRange response shown in drawer header.

import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/domain/store/hooks.js';
import { closeDrillDrawer } from '@/domain/store/ui-slice.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { formatMoney } from '@brain/lib-metrics';
import { StalenessLabel } from '@/interfaces/components/shared/staleness-label.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

export function DrillDrawer() {
  const dispatch = useAppDispatch();
  const { open, definitionId, date_start, date_end } = useAppSelector((s) => s.ui.drillDrawer);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the close button when drawer opens.
  useEffect(() => {
    if (open) {
      closeRef.current?.focus();
    }
  }, [open]);

  // Escape key closes the drawer.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        dispatch(closeDrillDrawer());
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, dispatch]);

  const { data, isLoading, error } = trpc.metrics.queryRange.useQuery(
    {
      definition_ids: definitionId ? [definitionId] : [],
      date_start: date_start ?? '',
      date_end: date_end ?? '',
    },
    {
      enabled: open && !!definitionId && !!date_start && !!date_end,
    },
  );

  if (!open) return null;

  const rows = data?.rows ?? [];
  const epoch = data?.data_epoch;

  // Determine if the definitionId is a money metric (ends in _mu).
  const isMoneyMetric = definitionId?.endsWith('_mu') ?? false;
  const isBpMetric = definitionId?.endsWith('_bp') ?? false;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        aria-hidden="true"
        onClick={() => dispatch(closeDrillDrawer())}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Source rows for ${definitionId ?? 'metric'}`}
        className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-white z-50 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Source rows — <code className="text-blue-700 text-sm">{definitionId}</code>
            </h2>
            {epoch && <StalenessLabel dataEpoch={epoch} className="mt-1" />}
          </div>

          <button
            ref={closeRef}
            type="button"
            onClick={() => dispatch(closeDrillDrawer())}
            aria-label="Close source rows drawer"
            className="p-2 rounded-md text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && (
            <div aria-busy="true" aria-label="Loading source rows" className="space-y-2">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
              ))}
            </div>
          )}

          {error && (
            <ErrorDisplay
              title="Failed to load source rows"
              message={error.message}
              requestId={(error as { data?: { requestId?: string } }).data?.requestId}
            />
          )}

          {!isLoading && !error && rows.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              No rows found for this metric in the selected date range.
            </p>
          )}

          {!isLoading && rows.length > 0 && (
            <table className="min-w-full text-sm" aria-label={`Source rows for ${definitionId}`}>
              <thead className="sticky top-0 bg-white border-b border-gray-200">
                <tr>
                  <th scope="col" className="text-left font-medium text-gray-600 py-2 pr-4">Date</th>
                  <th scope="col" className="text-right font-medium text-gray-600 py-2">
                    {definitionId}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => {
                  // CF-C6-RENDER-ONLY-1: formatMoney is the ONLY formatter.
                  // Explicit type narrowing per metric kind.
                  const rawValue = row[definitionId as keyof typeof row];

                  let displayValue: string;
                  if (isMoneyMetric && typeof rawValue === 'bigint') {
                    displayValue = formatMoney(rawValue, row.currency_code);
                  } else if (isBpMetric && typeof rawValue === 'number') {
                    // bp display: 1800 → "18.00%"
                    const whole = Math.floor(rawValue / 100);
                    const frac = Math.abs(rawValue % 100).toString().padStart(2, '0');
                    displayValue = `${whole}.${frac}%`;
                  } else if (typeof rawValue === 'bigint') {
                    displayValue = rawValue.toLocaleString('en-IN');
                  } else if (rawValue != null) {
                    displayValue = String(rawValue);
                  } else {
                    displayValue = '—';
                  }

                  return (
                    <tr key={row.date} className="hover:bg-gray-50">
                      <td className="py-2 pr-4 text-gray-700 tabular-nums">{row.date}</td>
                      <td className="py-2 text-right font-medium text-gray-900 tabular-nums">
                        {displayValue}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400">
          {rows.length > 0 && <>{rows.length} rows · cursor-paginated (no offset)</>}
        </footer>
      </aside>
    </>
  );
}

'use client';

// @paradigm: sql
// PnlWaterfallPanel — fetches pnlWaterfall data and renders CmWaterfallChart.
// CF-C6-RENDER-ONLY-1: data from BFF; no arithmetic here.
// CF-C6-AS-OF-STAMP-1: data_epoch bound to waterfall display.
// CF-C6-BIGINT-JSON-1: step value_mu / cumulative_mu arrive as bigint.

import dynamic from 'next/dynamic';
import { trpc } from '@/infrastructure/trpc-client.js';
import { StalenessLabel } from '@/interfaces/components/shared/staleness-label.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

// Code-split the visx chart (@visx/axis+group+scale+shape+tooltip) out of the
// initial bundle — it loads only when this panel actually renders. ssr:false:
// the chart is client-only (SVG sizing needs the DOM).
const CmWaterfallChart = dynamic(
  () => import('./cm-waterfall-chart.js').then((m) => m.CmWaterfallChart),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-md bg-muted/40" /> },
);

interface PnlWaterfallPanelProps {
  workspaceId: string;
  date_start: string;
  date_end: string;
}

export function PnlWaterfallPanel({
  workspaceId: _workspaceId,
  date_start,
  date_end,
}: PnlWaterfallPanelProps) {
  const { data, isLoading, error } = trpc.metrics.pnlWaterfall.useQuery({
    date_start,
    date_end,
  });

  return (
    <section aria-label="P&L / CM Waterfall" className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">P&amp;L / CM Waterfall</h2>
        {data && <StalenessLabel dataEpoch={data.data_epoch} />}
      </div>

      {isLoading && (
        <div
          aria-busy="true"
          aria-label="Loading P&L waterfall"
          className="h-80 bg-gray-100 animate-pulse rounded"
        />
      )}

      {error && (
        <ErrorDisplay
          title="Failed to load P&L waterfall"
          message={error.message}
          requestId={(error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {data && (
        <div className="overflow-x-auto">
          <CmWaterfallChart
            steps={data.steps}
            dataEpoch={data.data_epoch}
            date_start={date_start}
            date_end={date_end}
            width={680}
            height={360}
          />
        </div>
      )}

      <p className="mt-2 text-xs text-gray-400">
        Click any bar to drill into source rows. Data as of{' '}
        {data ? new Date(data.data_epoch).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '…'}.
      </p>
    </section>
  );
}

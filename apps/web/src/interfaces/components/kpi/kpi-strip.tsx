'use client';

// @paradigm: sql
// KpiStrip — Command Center revenue+profit strip.
// Fetches from metrics.kpiSummary tRPC procedure.
// CF-C6-RENDER-ONLY-1: zero arithmetic. All values from the BFF.
// CF-C6-AS-OF-STAMP-1: bound to data_epoch from the response.
// CF-C6-BIGINT-JSON-1: valueMu fields arrive as bigint via superjson.

import { trpc } from '@/infrastructure/trpc-client.js';
import { KpiCard } from '@/interfaces/components/kpi/kpi-card.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

interface KpiStripProps {
  workspaceId: string;
  date_start: string;
  date_end: string;
}

export function KpiStrip({ workspaceId: _workspaceId, date_start, date_end }: KpiStripProps) {
  const { data, isLoading, error } = trpc.metrics.kpiSummary.useQuery({
    date_start,
    date_end,
  });

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading KPI metrics"
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="bg-white rounded-lg border border-gray-200 p-4 h-28 animate-pulse"
            aria-hidden="true"
          >
            <div className="h-3 bg-gray-200 rounded w-1/2 mb-3" />
            <div className="h-7 bg-gray-200 rounded w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorDisplay
        title="Failed to load KPI metrics"
        message={error.message}
        requestId={(error as { data?: { requestId?: string } }).data?.requestId}
      />
    );
  }

  if (!data) return null;

  const { summary, data_epoch, request_id } = data;
  const commonProps = {
    dataEpoch: data_epoch,
    date_start,
    date_end,
    currencyCode: summary.currency_code,
    drillable: true,
  };

  return (
    <section aria-label="Key Performance Indicators" aria-describedby="kpi-epoch">
      <div id="kpi-epoch" className="sr-only">
        Data as of {new Date(data_epoch).toISOString()}. Request ID: {request_id}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Row 1: Revenue + CM strip */}
        <KpiCard
          {...commonProps}
          definitionId="net_revenue_mu"
          label="Net Revenue"
          valueType="money_mu"
          valueMu={summary.net_revenue_mu}
        />

        <KpiCard
          {...commonProps}
          definitionId="cm2_mu"
          label="CM2"
          valueType="money_mu"
          valueMu={summary.cm2_mu}
        />

        <KpiCard
          {...commonProps}
          definitionId="cm3_mu"
          label="CM3"
          valueType="money_mu"
          valueMu={summary.cm3_mu}
        />

        <KpiCard
          {...commonProps}
          definitionId="blended_roas_x100"
          label="Blended ROAS"
          valueType="ratio_x100"
          valueX100={summary.blended_roas_x100}
          drillable={false}
        />

        {/* Row 2: Operations */}
        <KpiCard
          {...commonProps}
          definitionId="total_orders"
          label="Orders"
          valueType="count"
          valueCount={summary.total_orders}
        />

        {/* aov_mu is typed as number in KpiSummaryRow (display-only minor-units field).
            BigInt() adapts it for formatMoney — this is a type adapter, not metric arithmetic.
            CF-C6-RENDER-ONLY-1: the value itself comes from the server; no computation here. */}
        <KpiCard
          {...commonProps}
          definitionId="aov_mu"
          label="AOV"
          valueType="money_mu"
          valueMu={summary.aov_mu != null ? BigInt(Math.floor(summary.aov_mu)) : null}
        />

        <KpiCard
          {...commonProps}
          definitionId="rto_rate_bp"
          label="RTO Rate"
          valueType="ratio_bp"
          valueBp={summary.rto_rate_bp}
          drillable={false}
        />

        <KpiCard
          {...commonProps}
          definitionId="conversion_rate_bp"
          label="Conversion Rate"
          valueType="ratio_bp"
          valueBp={summary.conversion_rate_bp}
          drillable={false}
        />
      </div>
    </section>
  );
}

'use client';

// @paradigm: sql
// RevenueLadderStrip — the /store revenue-quality strip (Phase-2 slice-1).
// Renders Gross → Net → Net of Tax → Net Revenue → Realized for the anchor brand.
// CF-C6-RENDER-ONLY-1: zero arithmetic. All values from the BFF.
// CF-C6-FORMATMONEY-CANONICAL-1: every money value goes through formatMoney.
// CF-C6-BIGINT-JSON-1: value_mu arrives as bigint via superjson.
// CF-C6-AS-OF-STAMP-1: bound to data_epoch from the response.
// CF-SEC-5: request_id surfaced in an sr-only node for traceability.

import { formatMoney } from '@brain/lib-metrics';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

interface RevenueLadderStripProps {
  date_start: string;
  date_end: string;
}

export function RevenueLadderStrip({ date_start, date_end }: RevenueLadderStripProps) {
  const { data, isLoading, error } = trpc.store.revenueLadder.useQuery({
    date_start,
    date_end,
  });

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading revenue ladder"
        className="grid grid-cols-2 md:grid-cols-5 gap-4"
      >
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="bg-white rounded-lg border border-gray-200 p-4 h-24 animate-pulse"
            aria-hidden="true"
          >
            <div className="h-3 bg-gray-200 rounded w-2/3 mb-3" />
            <div className="h-6 bg-gray-200 rounded w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorDisplay
        title="Failed to load revenue ladder"
        message={error.message}
        requestId={(error as { data?: { requestId?: string } }).data?.requestId}
      />
    );
  }

  if (!data) return null;

  const { ladder, currency_code, data_epoch, request_id } = data;

  return (
    <section aria-label="Revenue quality ladder" aria-describedby="ladder-epoch">
      <div id="ladder-epoch" className="sr-only">
        Data as of {new Date(data_epoch).toISOString()}. Request ID: {request_id}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {ladder.map((step, idx) => (
          <div
            key={step.definition_id}
            className="bg-card rounded-lg border border-border p-4"
            data-definition-id={step.definition_id}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span
                aria-hidden="true"
                className="text-xs font-mono text-muted-foreground"
              >
                {idx + 1}
              </span>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {step.label}
              </p>
            </div>
            <p className="text-xl font-bold tabular-nums text-foreground">
              {formatMoney(step.value_mu, currency_code)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

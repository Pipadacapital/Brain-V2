// @paradigm: sql
// ConnectorPending — the HONEST-STATE affordance (Phase-2 slice-10, CF-S10-HONEST-STATE-1).
// The Child-3 connector cutover is HELD, so some page tiles depend on connector-live data
// that is NOT flowing locally. Rather than fabricate a number or render a "Coming in Phase 2"
// stub, those tiles render THIS: an honest "pending connector cutover" panel. It renders
// PROSE + an optional disabled action — never a numeric value.
//
// Single primitive (Single-Primitive Rule): reused across /analytics (sessions/conversion),
// /meta-ads + /google-ads (per-campaign), /shiprocket (backfill), /settings/integrations
// and /settings/backfill — there is exactly one honest-state component, not one per page.

interface ConnectorPendingProps {
  /** What's pending, e.g. "Shopify storefront analytics". */
  source: string;
  /** Optional secondary detail line, e.g. "Connect to see per-campaign breakdown". */
  detail?: string;
  /** Optional deferred action label rendered as a DISABLED button (e.g. "Connect Meta"). */
  deferredAction?: string;
}

export function ConnectorPending({ source, detail, deferredAction }: ConnectorPendingProps) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-6 text-center"
      data-honest-state="connector-pending"
    >
      <p className="text-sm font-medium text-amber-900">{source} — pending connector cutover</p>
      <p className="mt-1 text-xs text-amber-700">
        {detail ?? 'Live data for this view becomes available after the connector cutover.'}
      </p>
      {deferredAction && (
        <button
          type="button"
          disabled
          title="Available after connector cutover"
          className="mt-3 inline-block cursor-not-allowed rounded-md border border-amber-300 bg-white/60 px-3 py-1.5 text-xs font-medium text-amber-700 opacity-60"
        >
          {deferredAction}
        </button>
      )}
    </div>
  );
}

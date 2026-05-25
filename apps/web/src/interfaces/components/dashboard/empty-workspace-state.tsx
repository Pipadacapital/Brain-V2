// @paradigm: sql
// EmptyWorkspaceState (Slice C) — the HONEST empty state for a freshly-onboarded
// workspace that has no analytics data yet.
//
// Data-reconciliation decision (Founder-binding): a brand-new workspace has a new
// UUID and NO data (the StubDataPlane demo seed is keyed to Sugandh-Lok; the LIVE
// data plane / connectors are slice D). We do NOT fabricate numbers — we show this
// honest "no data yet — connect a store (coming in integrations)" state. The
// pre-seeded Sugandh-Lok workspace keeps its demo data.
//
// CF-C6-RENDER-ONLY-1: zero arithmetic; this is a static affordance.

export function EmptyWorkspaceState() {
  return (
    <section
      aria-label="No data yet"
      className="rounded-lg border border-dashed border-border p-10 text-center bg-card space-y-3"
    >
      <h2 className="text-lg font-semibold text-foreground">No data yet</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Your workspace is set up. Connect your store to start seeing revenue,
        contribution margin, RTO, and ad performance here.
      </p>
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="inline-block rounded-md border border-dashed border-border px-4 py-2 text-sm text-muted-foreground cursor-not-allowed"
      >
        Connect a store — coming in integrations
      </button>
    </section>
  );
}

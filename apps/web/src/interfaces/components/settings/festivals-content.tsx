'use client';

// @paradigm: sql
// FestivalsContent — the /settings/festivals page (Phase-2 slice-7, feat-finance-settings-goals).
// Renders the India festival template calendar + each festival's stored EXPECTED multiplier
// (e.g. Diwali 4.0×). CF-C6-RENDER-ONLY-1: zero arithmetic; values from trpc.settings.festivals.
// ROHAN FINDING 2: there is NO learned lift — the multiplier is an operator-set template default,
// NOT a learned model. Festival CRUD (add/edit/reset-defaults) is a follow-up (display this slice).

import { useQueryState, parseAsInteger } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

/** multiplier bp (×10000) → "4.0×" (display only). */
function formatMultiplier(bp: number): string {
  return `${(bp / 10000).toFixed(1)}×`;
}

export function FestivalsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [year, setYear] = useQueryState('year', parseAsInteger.withDefault(2026));

  const enabled = Boolean(isAuthenticated && workspaceId);
  // The date range is informational for festivals (selection is by year); pass the year span.
  const q = trpc.settings.festivals.useQuery(
    { date_start: `${year}-01-01`, date_end: `${year}-12-31`, year },
    { enabled },
  );

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <a href="/login" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">Sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Festivals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">India festival calendar &amp; expected demand multipliers</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="fest-year" className="sr-only">Year</label>
          <select id="fest-year" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading festivals" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load festivals" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (
        <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{year} festival calendar</h2>
            <span className="text-sm text-muted-foreground">Peak expected: <strong className="text-foreground">{formatMultiplier(q.data.peak_multiplier_bp)}</strong></span>
          </div>
          <table className="w-full">
            <thead>
              <tr>{['Festival', 'Window', 'Expected', 'Regions', 'Categories'].map((h, i) => <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i <= 1 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {q.data.rows.map((f) => (
                <tr key={`${f.name}-${f.start_date}`} className="border-t border-gray-100">
                  <td className="py-2 text-sm font-medium">
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ backgroundColor: f.color }} aria-hidden="true" />
                    {f.name}
                    {f.is_template && <span className="ml-2 text-xs text-muted-foreground">(template)</span>}
                  </td>
                  <td className="py-2 text-sm text-muted-foreground">{f.start_date === f.end_date ? f.start_date : `${f.start_date} → ${f.end_date}`}</td>
                  <td className="py-2 text-sm tabular-nums text-right font-semibold">{formatMultiplier(f.expected_multiplier_bp)}</td>
                  <td className="py-2 text-sm text-right text-muted-foreground">{f.regions.length ? f.regions.join(', ') : 'All India'}</td>
                  <td className="py-2 text-sm text-right text-muted-foreground">{f.categories.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">Multipliers are expected-demand template defaults you can tune — not a learned forecast.</p>
        </section>
      )}
    </div>
  );
}

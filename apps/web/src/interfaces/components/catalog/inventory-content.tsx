'use client';

// @paradigm: sql
// InventoryContent — the /inventory page (Phase-2 slice-6, feat-catalog-inventory).
// Renders per-SKU inventory levels: on-hand, days-of-cover (the velocity cascade — Finding 3),
// sell-through, and status badge. CF-C6-RENDER-ONLY-1: zero arithmetic; all values from
// trpc.catalog.inventory. days_left 999999 = "no recent sales" (the INFINITE sentinel).

import { useQueryState, parseAsString } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/marketing/format-ratio.js';

const SORT = ['days_left', 'current_inventory', 'sell_through', 'status', 'label'] as const;
const STATUS_FILTERS = ['', 'Out of stock', 'Restock Soon', 'Healthy', 'Overstocked', 'Severely Overstocked'] as const;

const STATUS_TONE: Record<string, string> = {
  'Out of stock': 'bg-red-100 text-red-800',
  'Restock Soon': 'bg-amber-100 text-amber-800',
  'Healthy': 'bg-green-100 text-green-800',
  'Overstocked': 'bg-blue-100 text-blue-800',
  'Severely Overstocked': 'bg-purple-100 text-purple-800',
};

const INFINITE_DAYS = 999999n;

/** days-of-cover display: the 999999 sentinel → "No recent sales"; else "N days". */
function formatDays(days: bigint): string {
  if (days === INFINITE_DAYS) return 'No recent sales';
  return `${String(days)} days`;
}

export function InventoryContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-04-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-04-30'));
  const [sort, setSort] = useQueryState('sort', parseAsString.withDefault('days_left'));
  const [statusFilter, setStatusFilter] = useQueryState('status', parseAsString.withDefault(''));

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.catalog.inventory.useQuery(
    {
      date_start: dateStart,
      date_end: dateEnd,
      sort: sort as (typeof SORT)[number],
      direction: 'asc',
      status_filter: (statusFilter || undefined) as
        | 'Out of stock' | 'Restock Soon' | 'Healthy' | 'Overstocked' | 'Severely Overstocked' | undefined,
    },
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">on-hand, days of cover &amp; sell-through by SKU</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status filter" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {STATUS_FILTERS.map((s) => <option key={s || 'all'} value={s}>{s || 'All statuses'}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground">
            {SORT.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label htmlFor="inv-from" className="sr-only">From date</label>
          <input id="inv-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
          <label htmlFor="inv-to" className="sr-only">To date</label>
          <input id="inv-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
        </div>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading inventory" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load inventory" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (() => {
        const r = q.data.result;
        return (
          <>
            <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

            <Section title="Inventory levels">
              <Table head={['SKU', 'Product', 'On hand', 'Days of cover', 'Sell-through', 'Status']}>
                {r.rows.map((row) => (
                  <tr key={row.sku} className="border-t border-gray-100">
                    <td className="py-2 text-sm font-mono text-xs">{row.sku}</td>
                    <td className="py-2 text-sm">{row.label}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{String(row.current_inventory)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatDays(row.days_left)}</td>
                    <td className="py-2 text-sm tabular-nums text-right">{formatBpPercent(row.sell_through_bp)}</td>
                    <td className="py-2 text-sm text-right">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${STATUS_TONE[row.status] ?? ''}`}>{row.status}</span>
                    </td>
                  </tr>
                ))}
              </Table>
            </Section>
          </>
        );
      })()}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full">
      <thead>
        <tr>{head.map((h, i) => <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i <= 1 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

'use client';

// @paradigm: sql
// ProductCogsContent — /product-cogs editor. Functional parity with legacy
// coqs-content.tsx (811 LOC): per-product inline COGS editor, search, status
// filter (ACTIVE/DRAFT/ARCHIVED), COGS filter (all/set/not_set), pagination,
// bulk-edit mode (sheet with multi-row save).
//
// Backend: trpc.catalog.{cogsList, updateCogs, bulkUpdateCogs}.
// Money: backend wires cost_mu as a paise string. UI displays in major units
// (₹12.50 ↔ "1250" paise). Conversion: paise = Math.round(rupees × 100).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, ChevronLeft, ChevronRight, Save, Pencil, X } from 'lucide-react';
import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/interfaces/components/ui/sheet.js';
import { cn } from '@/lib/utils.js';

// ── Money helpers ────────────────────────────────────────────────────────────
// We accept both "12.50" and "12" — store as paise (BIGINT). Empty input ⇒
// 0 paise (legacy treats 0 / null interchangeably as "unset").
function rupeesToPaise(input: string): bigint | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0n;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return BigInt(Math.round(n * 100));
}
function paiseToRupees(paise: bigint | string): string {
  const n = typeof paise === 'string' ? BigInt(paise) : paise;
  if (n === 0n) return '';
  // Show as integer when divisible by 100; otherwise 2 decimals.
  const rupees = Number(n) / 100;
  return rupees % 1 === 0 ? rupees.toFixed(0) : rupees.toFixed(2);
}

const INPUT_CLS =
  'w-full px-2 py-1.5 border border-input bg-background rounded text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-ring';

const STATUS_OPTIONS = [
  { value: 'all',      label: 'All statuses' },
  { value: 'ACTIVE',   label: 'Active' },
  { value: 'DRAFT',    label: 'Draft' },
  { value: 'ARCHIVED', label: 'Archived' },
] as const;

const COGS_FILTER_OPTIONS = [
  { value: 'all',     label: 'All products' },
  { value: 'set',     label: 'COGS set' },
  { value: 'not_set', label: 'COGS not set' },
] as const;

type ProductRow = {
  id: string;
  vendor: string;
  vendorProductId: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  status: string;
  productType: string | null;
  inventoryQty: number | null;
  costMu: string;                    // paise (BIGINT serialized as string)
  mrpMu: string;
  costSet: boolean;
};

export function ProductCogsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const utils = trpc.useUtils();

  // URL-synced filters
  const [search, setSearch]         = useQueryState('q',      parseAsString.withDefault(''));
  const [status, setStatus]         = useQueryState('status', parseAsString.withDefault('all'));
  const [cogsFilter, setCogsFilter] = useQueryState('cogs',   parseAsString.withDefault('all'));
  const [page, setPage]             = useQueryState('page',   parseAsInteger.withDefault(1));
  const [searchInput, setSearchInput] = useState(search);

  // Debounced search → commit `search` 350 ms after typing stops.
  useEffect(() => {
    const t = setTimeout(() => { if (searchInput !== search) setSearch(searchInput || null); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Local edits keyed by product id — sit between server data and the input
  // until the user clicks Save (per-row) or Save-all (bulk).
  const [localCogs, setLocalCogs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const enabled = Boolean(isAuthenticated && workspaceId);
  const { data, isLoading, error } = trpc.catalog.cogsList.useQuery(
    {
      search:     search || undefined,
      status:     status as 'all' | 'ACTIVE' | 'DRAFT' | 'ARCHIVED',
      cogsFilter: cogsFilter as 'all' | 'set' | 'not_set',
      page,
      pageSize:   20,
    },
    { enabled },
  );

  const updateMut = trpc.catalog.updateCogs.useMutation({
    onSuccess: (_, vars) => {
      utils.catalog.cogsList.invalidate();
      setLocalCogs((p) => { const n = { ...p }; delete n[vars.productId]; return n; });
      setSavedFlash(vars.productId);
      setTimeout(() => setSavedFlash(null), 1500);
    },
  });
  const bulkMut = trpc.catalog.bulkUpdateCogs.useMutation({
    onSuccess: () => utils.catalog.cogsList.invalidate(),
  });

  const getInputValue = (row: ProductRow) =>
    row.id in localCogs ? localCogs[row.id] : paiseToRupees(row.costMu);

  const handleSaveRow = (row: ProductRow) => {
    const paise = rupeesToPaise(getInputValue(row));
    if (paise === null) return;
    setSavingId(row.id);
    updateMut.mutate(
      { productId: row.id, costMu: paise.toString() },
      { onSettled: () => setSavingId(null) },
    );
  };

  // Bulk-edit sheet ──────────────────────────────────────────────────────────
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLocal, setBulkLocal] = useState<Record<string, string>>({});
  const [bulkSetAll, setBulkSetAll] = useState('');
  const bulkChanges = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows
      .map((r) => {
        const v = r.id in bulkLocal ? bulkLocal[r.id] : null;
        if (v === null) return null;
        const paise = rupeesToPaise(v);
        if (paise === null) return null;
        if (paise.toString() === r.costMu) return null;     // no change
        return { productId: r.id, costMu: paise.toString() };
      })
      .filter((x): x is { productId: string; costMu: string } => x != null);
  }, [bulkLocal, data?.rows]);

  const applyBulkSetAll = () => {
    if (!data?.rows) return;
    const paise = rupeesToPaise(bulkSetAll);
    if (paise === null) return;
    const next: Record<string, string> = {};
    for (const r of data.rows) {
      // Only set rows that are currently "not_set" (COGS = 0) to the bulk value
      // when bulkSetAll is "fill empty"; otherwise apply to everything.
      next[r.id] = paiseToRupees(paise);
    }
    setBulkLocal(next);
  };

  const handleBulkSave = async () => {
    if (bulkChanges.length === 0) return;
    await bulkMut.mutateAsync({ updates: bulkChanges });
    setBulkLocal({});
    setBulkSetAll('');
    setBulkOpen(false);
  };

  // ─────────────────────────────────────────────────────────────────────────

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-col gap-6 py-4 md:py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Product COGS</h1>
        <p className="text-sm text-muted-foreground">Sign in and pick a workspace to manage product COGS.</p>
      </div>
    );
  }
  if (error) {
    return <ErrorDisplay title="Couldn't load products" message={error.message} />;
  }

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rows = (data?.rows ?? []) as ProductRow[];

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Product COGS</h1>
          <p className="text-sm text-muted-foreground">
            Set per-product cost of goods sold. Feeds CM1 in every margin report.
          </p>
        </div>
        <Button variant="outline" onClick={() => { setBulkLocal({}); setBulkOpen(true); }}>
          <Pencil className="mr-1.5 h-4 w-4" />
          Bulk edit
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text" placeholder="Search by title or handle…"
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            className={cn(INPUT_CLS, 'pl-9')}
          />
        </div>
        <select
          value={status} onChange={(e) => { setStatus(e.target.value === 'all' ? null : e.target.value); setPage(1); }}
          className={cn(INPUT_CLS, 'w-40')}
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={cogsFilter} onChange={(e) => { setCogsFilter(e.target.value === 'all' ? null : e.target.value); setPage(1); }}
          className={cn(INPUT_CLS, 'w-44')}
        >
          {COGS_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="ml-auto text-sm text-muted-foreground">
          {isLoading ? 'Loading…' : `${total.toLocaleString()} product${total !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="grid grid-cols-[80px_1fr_120px_160px_120px] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
          <div>Image</div>
          <div>Product</div>
          <div className="text-right">MRP</div>
          <div>COGS (₹)</div>
          <div className="text-right">Save</div>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No products match the current filters.
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[80px_1fr_120px_160px_120px] items-center gap-3 border-b px-4 py-2 last:border-b-0"
            >
              <div className="h-12 w-12 rounded-md overflow-hidden bg-muted">
                {r.imageUrl ? (
                  // Using <img> instead of <Image> to avoid Next domain config for arbitrary CDNs.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.imageUrl} alt="" className="h-12 w-12 object-cover" />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.handle || r.vendorProductId} · {r.status || 'unknown'}
                  {r.productType ? ` · ${r.productType}` : ''}
                </p>
              </div>
              <div className="text-right text-sm tabular-nums text-muted-foreground">
                {r.mrpMu === '0' ? '—' : `₹${paiseToRupees(r.mrpMu)}`}
              </div>
              <div>
                <input
                  type="text" inputMode="decimal"
                  value={getInputValue(r)}
                  onChange={(e) => setLocalCogs((p) => ({ ...p, [r.id]: e.target.value }))}
                  placeholder={r.costSet ? '' : '0'}
                  className={cn(INPUT_CLS, !r.costSet && !(r.id in localCogs) && 'border-dashed')}
                />
              </div>
              <div className="text-right">
                <Button
                  size="sm"
                  variant={savedFlash === r.id ? 'default' : 'outline'}
                  onClick={() => handleSaveRow(r)}
                  disabled={savingId === r.id || rupeesToPaise(getInputValue(r)) === null}
                >
                  {savingId === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : savedFlash === r.id ? (
                    'Saved'
                  ) : (
                    <><Save className="mr-1 h-4 w-4" />Save</>
                  )}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Bulk edit sheet ─────────────────────────────────────────────────── */}
      <Sheet open={bulkOpen} onOpenChange={setBulkOpen}>
        <SheetContent side="right" className="w-[640px] max-w-[95vw] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Bulk edit COGS</SheetTitle>
            <SheetDescription>
              Edit COGS for the currently-filtered page. Same-value rows are skipped on save.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex items-center gap-2">
            <input
              type="text" inputMode="decimal" placeholder="Set all on this page to…"
              value={bulkSetAll} onChange={(e) => setBulkSetAll(e.target.value)}
              className={cn(INPUT_CLS, 'flex-1')}
            />
            <Button variant="outline" size="sm" onClick={applyBulkSetAll}>Apply</Button>
            <Button variant="ghost" size="sm" onClick={() => { setBulkLocal({}); setBulkSetAll(''); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-4 rounded-lg border divide-y">
            {rows.map((r) => {
              const v = r.id in bulkLocal ? bulkLocal[r.id] : paiseToRupees(r.costMu);
              return (
                <div key={r.id} className="grid grid-cols-[1fr_140px] items-center gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.handle || r.vendorProductId}</p>
                  </div>
                  <input
                    type="text" inputMode="decimal" value={v}
                    onChange={(e) => setBulkLocal((p) => ({ ...p, [r.id]: e.target.value }))}
                    placeholder="0" className={INPUT_CLS}
                  />
                </div>
              );
            })}
          </div>
          <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 border-t bg-card pt-3">
            <p className="text-sm text-muted-foreground">
              {bulkChanges.length === 0 ? 'No changes' : `${bulkChanges.length} row(s) to save`}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
              <Button onClick={handleBulkSave} disabled={bulkChanges.length === 0 || bulkMut.isPending}>
                {bulkMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save {bulkChanges.length || ''}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

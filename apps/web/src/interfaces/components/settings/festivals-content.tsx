'use client';

// @paradigm: sql
// FestivalsContent — Wave-3 CRUD restore. Parity-38.
// Full CRUD: add / edit / delete / reset-defaults over the India festival calendar.
// Mutations: settings.createFestival / updateFestival / deleteFestival / resetFestivals (MANAGER).
// Read: settings.festivals (ANALYST, no IDs in FestivalRow from proto-types).
// ID gap: proto-types FestivalRow has no `id`. IDs are tracked from mutation responses
//   in localIdMap (keyed by `name+start_date`). Rows whose IDs are not yet known
//   show Edit/Delete as disabled until that row is re-created or updated in this session.
// Multiplier: UI shows ×N.N; stored as basis points (10000 = 1.0×).
//   multiplier input → bp: Math.round(input * 10000).

import { useState, useEffect } from 'react';
import { useQueryState, parseAsInteger } from 'nuqs';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';
import { Badge } from '@/interfaces/components/ui/badge.js';

// ─── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_LEVEL: Record<string, number> = {
  OWNER: 4, ADMIN: 3, MANAGER: 2, ANALYST: 1, VIEWER: 0,
};

function atLeast(role: string | null, required: string): boolean {
  return (ROLE_LEVEL[role ?? ''] ?? 0) >= (ROLE_LEVEL[required] ?? 99);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** multiplier bp (×10000) → "4.0×" */
function formatMultiplier(bp: number): string {
  return `${(bp / 10000).toFixed(1)}×`;
}

const COLORS = ['#F59E0B', '#EF4444', '#8B5CF6', '#3B82F6', '#10B981', '#EC4899'];

/** Stable key for matching a FestivalRow to a locally-known ID */
function rowKey(name: string, start_date: string): string {
  return `${name}::${start_date}`;
}

// ─── FestivalRow augmented with optional ID ───────────────────────────────────

interface FestivalDisplayRow {
  name: string;
  start_date: string;
  end_date: string;
  expected_multiplier_bp: number;
  regions: string[];
  categories: string[];
  color: string;
  is_template: boolean;
  is_active: boolean;
  /** Populated from mutation responses; null when the read-only list has no ID. */
  id: string | null;
}

// ─── Edit row (inline) ────────────────────────────────────────────────────────

interface EditDraft {
  name: string;
  start_date: string;
  end_date: string;
  color: string;
  multiplierStr: string;
  regions: string;
  categories: string;
}

function buildDraft(row: FestivalDisplayRow): EditDraft {
  return {
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    color: row.color,
    multiplierStr: (row.expected_multiplier_bp / 10000).toFixed(1),
    regions: row.regions.join(', '),
    categories: row.categories.join(', '),
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FestivalsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceRole = useAppSelector((s) => s.session.workspaceRole);
  const canManage = atLeast(workspaceRole, 'MANAGER');

  const [year, setYear] = useQueryState('year', parseAsInteger.withDefault(2026));

  // Map of rowKey → festival_id; populated from mutation onSuccess
  const [localIdMap, setLocalIdMap] = useState<Record<string, string>>({});
  // Inline editing state
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.settings.festivals.useQuery(
    { date_start: `${year}-01-01`, date_end: `${year}-12-31`, year },
    { enabled },
  );

  // Hydrate row ids from core-service (the analytics festival read carries no id), so
  // EXISTING festivals are editable/deletable on load — not only ones mutated this session.
  const configFestivalsQ = trpc.settings.listFestivals.useQuery(undefined, { enabled });
  useEffect(() => {
    if (configFestivalsQ.data) {
      setLocalIdMap((prev) => {
        const next = { ...prev };
        for (const r of configFestivalsQ.data.rows) next[rowKey(r.name, r.start_date)] = r.id;
        return next;
      });
    }
  }, [configFestivalsQ.data]);

  const utils = trpc.useUtils();

  function invalidate() {
    utils.settings.festivals.invalidate();
    utils.settings.listFestivals.invalidate();
  }

  const createMut = trpc.settings.createFestival.useMutation({
    onSuccess: (row) => {
      const key = rowKey(row.name, row.start_date);
      setLocalIdMap((prev) => ({ ...prev, [key]: row.id }));
      invalidate();
      setMutError(null);
    },
    onError: (e) => setMutError(e.message),
  });

  const updateMut = trpc.settings.updateFestival.useMutation({
    onSuccess: (row) => {
      const key = rowKey(row.name, row.start_date);
      setLocalIdMap((prev) => ({ ...prev, [key]: row.id }));
      setEditKey(null);
      setDraft(null);
      invalidate();
      setMutError(null);
    },
    onError: (e) => setMutError(e.message),
  });

  const deleteMut = trpc.settings.deleteFestival.useMutation({
    onSuccess: (_r, vars) => {
      // Remove from local id map
      setLocalIdMap((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(next)) {
          if (v === vars.festival_id) delete next[k];
        }
        return next;
      });
      invalidate();
      setMutError(null);
    },
    onError: (e) => setMutError(e.message),
  });

  const resetMut = trpc.settings.resetFestivals.useMutation({
    onSuccess: () => {
      setLocalIdMap({});
      invalidate();
      setMutError(null);
    },
    onError: (e) => setMutError(e.message),
  });

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

  // Build display rows: merge server rows with local ID map
  const displayRows: FestivalDisplayRow[] = (q.data?.rows ?? []).map((f) => ({
    ...f,
    id: localIdMap[rowKey(f.name, f.start_date)] ?? null,
  }));

  function handleAddFestival() {
    const defaultStart = `${year}-01-01`;
    createMut.mutate({
      name: `Festival ${year}`,
      start_date: defaultStart,
      end_date: defaultStart,
      color: '#3B82F6',
      expected_multiplier_bp: 16000, // 1.6×
      regions: [],
      categories: ['all'],
    });
  }

  function handleResetDefaults() {
    resetMut.mutate();
  }

  function handleSaveEdit(festival_id: string) {
    if (!draft) return;
    const multiplier = parseFloat(draft.multiplierStr);
    if (Number.isNaN(multiplier) || multiplier < 0.5 || multiplier > 6) {
      setMutError('Multiplier must be between 0.5 and 6.');
      return;
    }
    updateMut.mutate({
      festival_id,
      name: draft.name,
      start_date: draft.start_date,
      end_date: draft.end_date,
      color: draft.color,
      expected_multiplier_bp: Math.round(multiplier * 10000),
      regions: draft.regions.split(',').map((x) => x.trim()).filter(Boolean),
      categories: draft.categories.split(',').map((x) => x.trim()).filter(Boolean),
    });
  }

  function handleToggleActive(row: FestivalDisplayRow) {
    if (!row.id) return;
    updateMut.mutate({ festival_id: row.id, is_active: !row.is_active });
  }

  const isPending = createMut.isPending || updateMut.isPending || deleteMut.isPending || resetMut.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Festival Calendar</h1>
          <p className="text-sm text-muted-foreground mt-0.5">India festival calendar &amp; expected demand multipliers</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {canManage && (
            <>
              <Button
                variant="outline"
                onClick={handleAddFestival}
                disabled={isPending}
                data-testid="add-festival-btn"
              >
                + Add Festival
              </Button>
              <Button
                variant="outline"
                onClick={handleResetDefaults}
                disabled={isPending}
                data-testid="reset-festivals-btn"
              >
                Reset to defaults
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Year selector */}
      <div className="flex gap-2" role="group" aria-label="Year selection">
        {[2024, 2025, 2026, 2027].map((y) => (
          <Button
            key={y}
            size="sm"
            variant={y === year ? 'default' : 'outline'}
            onClick={() => setYear(y)}
            aria-pressed={y === year}
          >
            {y}
          </Button>
        ))}
      </div>

      {mutError && <p className="text-sm text-destructive" role="alert">{mutError}</p>}

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading festivals" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
          ))}
        </div>
      )}

      {q.error && (
        <ErrorDisplay
          title="Failed to load festivals"
          message={q.error.message}
          requestId={(q.error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {q.data && (
        <>
          <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">
              {displayRows.length} festival{displayRows.length !== 1 ? 's' : ''} in {year}
            </span>
            <span className="text-sm text-muted-foreground">
              Peak expected: <strong className="text-foreground">{formatMultiplier(q.data.peak_multiplier_bp)}</strong>
            </span>
          </div>

          {displayRows.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm border rounded-lg">
              No festivals for {year}.{canManage ? ' Add one or reset to defaults.' : ''}
            </div>
          ) : (
            <div className="rounded-lg border divide-y" role="list" aria-label="Festival list">
              {displayRows.map((f) => {
                const key = rowKey(f.name, f.start_date);
                const isEditing = editKey === key;
                const hasFestivalId = f.id !== null;

                return (
                  <div
                    key={key}
                    className="p-3 space-y-2"
                    role="listitem"
                    data-testid={`festival-row-${key}`}
                  >
                    {/* Display row */}
                    <div className="flex items-center justify-between gap-3 text-sm flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="inline-block h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: f.color }}
                          aria-hidden="true"
                        />
                        <span className="font-medium">{f.name}</span>
                        {f.is_template && (
                          <Badge variant="secondary" className="text-xs">template</Badge>
                        )}
                        {f.is_template && !f.is_active && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">inactive</Badge>
                        )}
                        <span className="text-muted-foreground">
                          {f.start_date === f.end_date ? f.start_date : `${f.start_date} → ${f.end_date}`}
                        </span>
                        <span className="font-semibold tabular-nums">{formatMultiplier(f.expected_multiplier_bp)}</span>
                        <span className="text-muted-foreground">{f.regions.length ? f.regions.join(', ') : 'All India'}</span>
                      </div>

                      {canManage && (
                        <div className="flex gap-2 shrink-0">
                          {hasFestivalId ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditKey(isEditing ? null : key);
                                  setDraft(isEditing ? null : buildDraft(f));
                                  setMutError(null);
                                }}
                                disabled={isPending}
                                aria-expanded={isEditing}
                                data-testid={`edit-festival-${key}`}
                              >
                                {isEditing ? 'Cancel' : 'Edit'}
                              </Button>
                              {f.is_template ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleToggleActive(f)}
                                  disabled={isPending}
                                  data-testid={`toggle-active-festival-${key}`}
                                >
                                  {f.is_active ? 'Deactivate' : 'Activate'}
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => deleteMut.mutate({ festival_id: f.id! })}
                                  disabled={deleteMut.isPending && deleteMut.variables?.festival_id === f.id}
                                  data-testid={`delete-festival-${key}`}
                                  aria-label={`Delete festival ${f.name}`}
                                >
                                  Delete
                                </Button>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">
                              Edit/Delete available after adding via this session
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Inline edit form */}
                    {isEditing && draft && f.id && (
                      <div className="grid grid-cols-1 md:grid-cols-6 gap-2 pt-2 border-t border-gray-100" aria-label={`Edit ${f.name}`}>
                        <div className="space-y-1 md:col-span-2">
                          <Label htmlFor={`edit-name-${key}`} className="sr-only">Festival name</Label>
                          <Input
                            id={`edit-name-${key}`}
                            value={draft.name}
                            onChange={(e) => setDraft((d) => d ? { ...d, name: e.target.value } : d)}
                            placeholder="Name"
                            disabled={!canManage}
                            aria-label="Festival name"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`edit-start-${key}`} className="sr-only">Start date</Label>
                          <Input
                            id={`edit-start-${key}`}
                            type="date"
                            value={draft.start_date}
                            onChange={(e) => setDraft((d) => d ? { ...d, start_date: e.target.value } : d)}
                            disabled={!canManage}
                            aria-label="Start date"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`edit-end-${key}`} className="sr-only">End date</Label>
                          <Input
                            id={`edit-end-${key}`}
                            type="date"
                            value={draft.end_date}
                            onChange={(e) => setDraft((d) => d ? { ...d, end_date: e.target.value } : d)}
                            disabled={!canManage}
                            aria-label="End date"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`edit-mult-${key}`} className="sr-only">Expected multiplier</Label>
                          <Input
                            id={`edit-mult-${key}`}
                            type="number"
                            min={0.5}
                            max={6}
                            step={0.1}
                            value={draft.multiplierStr}
                            onChange={(e) => setDraft((d) => d ? { ...d, multiplierStr: e.target.value } : d)}
                            disabled={!canManage}
                            aria-label="Expected multiplier (e.g. 4.0 for 4.0×)"
                          />
                        </div>
                        <div className="flex gap-1 items-center md:col-span-1" role="group" aria-label="Color picker">
                          {COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className={`h-6 w-6 rounded border-2 ${draft.color === c ? 'border-foreground' : 'border-transparent'}`}
                              style={{ backgroundColor: c }}
                              onClick={() => setDraft((d) => d ? { ...d, color: c } : d)}
                              disabled={!canManage}
                              aria-label={`Color ${c}`}
                              aria-pressed={draft.color === c}
                            />
                          ))}
                        </div>
                        <div className="md:col-span-3 space-y-1">
                          <Label htmlFor={`edit-regions-${key}`} className="sr-only">Regions</Label>
                          <Input
                            id={`edit-regions-${key}`}
                            placeholder="Regions (comma-separated)"
                            value={draft.regions}
                            onChange={(e) => setDraft((d) => d ? { ...d, regions: e.target.value } : d)}
                            disabled={!canManage}
                            aria-label="Regions (comma-separated)"
                          />
                        </div>
                        <div className="md:col-span-3 space-y-1">
                          <Label htmlFor={`edit-categories-${key}`} className="sr-only">Categories</Label>
                          <Input
                            id={`edit-categories-${key}`}
                            placeholder="Categories (comma-separated)"
                            value={draft.categories}
                            onChange={(e) => setDraft((d) => d ? { ...d, categories: e.target.value } : d)}
                            disabled={!canManage}
                            aria-label="Categories (comma-separated)"
                          />
                        </div>
                        <div className="flex gap-2 md:col-span-2">
                          <Button
                            size="sm"
                            disabled={updateMut.isPending}
                            onClick={() => handleSaveEdit(f.id!)}
                            data-testid={`save-edit-festival-${key}`}
                          >
                            {updateMut.isPending ? 'Saving…' : 'Save'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setEditKey(null); setDraft(null); setMutError(null); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Multipliers are expected-demand template defaults you can tune — not a learned forecast.
            Edit/Delete require a festival ID; rows added in this session are immediately manageable.
          </p>
        </>
      )}
    </div>
  );
}

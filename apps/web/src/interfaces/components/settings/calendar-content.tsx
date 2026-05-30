'use client';

// @paradigm: sql
// CalendarContent — the /calendar page (parity-38 restore).
// Restores: marketing-action add/edit/delete dialogs + dropdown menus,
// Klaviyo overlay (honest-disabled), festival RAG colour bands, icon legend.
// CF-C6-RENDER-ONLY-1: zero arithmetic; values + RAG bands from trpc.calendar.report.
// Money: formatMoney (INR lakh/crore). No dangerouslySetInnerHTML.

import { useCallback, useEffect, useState } from 'react';
import {
  Mail,
  MessageSquare,
  Tag,
  Rocket,
  Megaphone,
  Image,
  CalendarDays,
  Flame,
  MoreVertical,
  Plus,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react';
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { RagBadge, type GoalRag } from '@/interfaces/components/shared/rag-badge.js';
import { formatBpMultiple } from '@/interfaces/components/marketing/format-ratio.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/interfaces/components/ui/dialog.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/interfaces/components/ui/select.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/interfaces/components/ui/dropdown-menu.js';

// ---------------------------------------------------------------------------
// Date helpers (no date-fns dependency — native JS only).
// ---------------------------------------------------------------------------

/** Format a Date as "yyyy-MM" */
function formatYearMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Format a Date as "yyyy-MM-dd" */
function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add N months to a yyyy-MM-dd-or-yyyy-MM date string */
function addMonthsToYm(ym: string, delta: number): string {
  const y = parseInt(ym.slice(0, 4));
  const m = parseInt(ym.slice(5, 7)) - 1;
  const d = new Date(y, m + delta, 1);
  return formatYearMonth(d);
}

/** Parse "yyyy-MM-dd" → Date (UTC noon to avoid DST edge) */
function parseIsoDate(s: string): Date {
  const [y, mo, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d!, 12));
}

/** Format "yyyy-MM-dd" → "MMM d" (e.g. "Oct 20") */
function formatMonthDay(isoDate: string): string {
  const d = parseIsoDate(isoDate);
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Get last day of month for yyyy-MM */
function lastDayOfMonth(ym: string): string {
  const y = parseInt(ym.slice(0, 4));
  const m = parseInt(ym.slice(5, 7));
  // Day 0 of next month = last day of this month
  const last = new Date(y, m, 0);
  return formatIsoDate(last);
}

// ---------------------------------------------------------------------------
// Marketing action config — mirrors legacy + core-settings canonical types.
// ---------------------------------------------------------------------------

const MARKETING_ACTION_TYPES = [
  'email_campaign',
  'sms_campaign',
  'promotion',
  'product_launch',
  'influencer',
  'ad_creative_change',
  'external_event',
  'sale_event',
] as const;

type MarketingActionTypeValue = (typeof MARKETING_ACTION_TYPES)[number];

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email_campaign:    Mail,
  sms_campaign:      MessageSquare,
  promotion:         Tag,
  product_launch:    Rocket,
  influencer:        Megaphone,
  ad_creative_change: Image,
  external_event:    CalendarDays,
  sale_event:        Flame,
};

const ACTION_LABELS: Record<string, string> = {
  email_campaign:    'Email',
  sms_campaign:      'SMS',
  promotion:         'Promotion',
  product_launch:    'Product launch',
  influencer:        'Influencer',
  ad_creative_change: 'Creative',
  external_event:    'External',
  sale_event:        'Sale',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Cell = { actual: bigint | null; goal: bigint | null; rag: GoalRag | null };
type ActionRow = {
  id: string;
  action_date: string;
  action_type: string;
  action_name: string;
  notes: string | null;
  source: 'manual' | 'klaviyo';
};

type FestivalBand = {
  name: string;
  start_date: string;
  end_date: string;
  expected_multiplier_bp: number;
  color: string;
  is_active: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ragBg(r: GoalRag | null): string {
  if (r === 'green') return 'bg-emerald-500/12 dark:bg-emerald-500/20';
  if (r === 'amber') return 'bg-amber-500/12 dark:bg-amber-500/20';
  if (r === 'red')   return 'bg-red-500/12 dark:bg-red-500/20';
  return '';
}

function moneyCell(c: Cell, currencyCode: string): string {
  return c.actual == null ? '—' : formatMoney(c.actual, currencyCode);
}

function ratioCell(c: Cell): string {
  return c.actual == null ? '—' : formatBpMultiple(Number(c.actual));
}

function currentMonthYm(): string {
  return formatYearMonth(new Date());
}

function festivalForDate(dateKey: string, festivals: FestivalBand[]): FestivalBand | null {
  const d = parseIsoDate(dateKey.slice(0, 10));
  const matching = festivals.filter((f) => {
    if (!f.is_active) return false;
    const s = parseIsoDate(f.start_date);
    const e = parseIsoDate(f.end_date);
    return d >= s && d <= e;
  });
  if (matching.length === 0) return null;
  // Highest multiplier wins if multiple overlap
  return matching.sort((a, b) => b.expected_multiplier_bp - a.expected_multiplier_bp)[0] ?? null;
}

// ---------------------------------------------------------------------------
// MetricCell component
// ---------------------------------------------------------------------------

function MetricCell({
  label,
  cell,
  display,
}: {
  label: string;
  cell: Cell;
  display: string;
}) {
  return (
    <div className="min-w-[100px]">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
      <div className={`rounded-md px-2 py-1.5 ${ragBg(cell.rag)}`}>
        <div className="text-sm font-semibold tabular-nums leading-tight">{display}</div>
        {cell.rag && (
          <div className="mt-0.5">
            <RagBadge rag={cell.rag} attainmentPct={null} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CalendarContent() {
  const workspaceId  = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceRole = useAppSelector((s) => s.session.workspaceRole as string | undefined);

  const canManage = workspaceRole === 'OWNER' || workspaceRole === 'ADMIN' || workspaceRole === 'MANAGER';

  // URL state — month picker collapsed to single nuqs field.
  const [selectedMonth, setSelectedMonth] = useQueryState('month', parseAsString.withDefault(currentMonthYm()));
  const [grain, setGrain]               = useQueryState('grain', parseAsString.withDefault('day'));

  const dateStart = `${selectedMonth}-01`;
  const dateEnd = lastDayOfMonth(selectedMonth);

  const enabled = Boolean(isAuthenticated && workspaceId);

  // ---- Queries ----
  const calQ = trpc.calendar.report.useQuery(
    { date_start: dateStart, date_end: dateEnd, grain: grain as 'day' | 'week' | 'month' },
    { enabled },
  );

  const festQ = trpc.settings.festivals.useQuery(
    { date_start: `${selectedMonth.slice(0, 4)}-01-01`, date_end: `${selectedMonth.slice(0, 4)}-12-31`, year: parseInt(selectedMonth.slice(0, 4)) },
    { enabled },
  );

  const actionsQ = trpc.marketing.listActions.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled },
  );

  const utils = trpc.useUtils();

  // ---- Mutations ----
  const createMut = trpc.marketing.createAction.useMutation({
    onSuccess: () => {
      void utils.calendar.report.invalidate();
      void utils.marketing.listActions.invalidate();
      setAddOpen(false);
      setAddName('');
      setAddNotes('');
    },
  });

  const updateMut = trpc.marketing.updateAction.useMutation({
    onSuccess: () => {
      void utils.calendar.report.invalidate();
      void utils.marketing.listActions.invalidate();
      setEditId(null);
    },
  });

  const deleteMut = trpc.marketing.deleteAction.useMutation({
    onSuccess: () => {
      void utils.calendar.report.invalidate();
      void utils.marketing.listActions.invalidate();
    },
  });

  // ---- Add dialog state ----
  const [addOpen, setAddOpen]   = useState(false);
  const [addDate, setAddDate]   = useState(() => dateStart);
  const [addType, setAddType]   = useState<MarketingActionTypeValue>('email_campaign');
  const [addName, setAddName]   = useState('');
  const [addNotes, setAddNotes] = useState('');

  // Reset add date when dialog opens
  useEffect(() => {
    if (addOpen) {
      const today = formatIsoDate(new Date());
      setAddDate(today.startsWith(selectedMonth) ? today : dateStart);
    }
  }, [addOpen, selectedMonth, dateStart]);

  // ---- Edit dialog state ----
  const [editId, setEditId]       = useState<string | null>(null);
  const [editDate, setEditDate]   = useState('');
  const [editType, setEditType]   = useState<MarketingActionTypeValue>('email_campaign');
  const [editName, setEditName]   = useState('');
  const [editNotes, setEditNotes] = useState('');

  const openEdit = useCallback((a: ActionRow) => {
    if (a.source === 'klaviyo') return;
    setEditId(a.id);
    setEditDate(a.action_date);
    setEditType((a.action_type as MarketingActionTypeValue) || 'email_campaign');
    setEditName(a.action_name);
    setEditNotes(a.notes ?? '');
  }, []);

  function shiftMonth(delta: number) {
    void setSelectedMonth(addMonthsToYm(selectedMonth, delta));
  }

  // ---- Derived ----
  const festivals: FestivalBand[] = (festQ.data?.rows ?? []).filter((f) => f.is_active);

  const rows = calQ.data?.rows ?? [];
  const currencyCode = calQ.data?.currency_code ?? 'INR';

  // Merge listActions overlay onto calendar rows (supplement the calendar.report actions)
  const actionsByDate = new Map<string, ActionRow[]>();
  for (const a of actionsQ.data?.rows ?? []) {
    const key = a.action_date.slice(0, 10);
    const existing = actionsByDate.get(key) ?? [];
    existing.push({ ...a, source: 'manual' });
    actionsByDate.set(key, existing);
  }

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

  const isLoading = calQ.isLoading || festQ.isLoading;
  const error = calQ.error ?? festQ.error;

  return (
    <div className="space-y-6">
      {/* --- Header --- */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calendar report</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Month view: every day vs goals (RAG) and marketing actions. Revenue uses the
          same store net + order gap-fill as MER/P&amp;L when analytics daily lags.
        </p>
      </div>

      {/* --- Controls --- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            ←
          </Button>
          <div className="flex flex-col gap-0.5">
            <label htmlFor="cal-month" className="sr-only">Month</label>
            <Input
              id="cal-month"
              type="month"
              className="w-[160px]"
              value={selectedMonth}
              onChange={(e) => void setSelectedMonth(e.target.value)}
              aria-label="Month"
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => shiftMonth(1)} aria-label="Next month">
            →
          </Button>
        </div>

        <Select value={grain} onValueChange={(v) => void setGrain(v)}>
          <SelectTrigger className="w-[140px]" aria-label="Granularity">
            <SelectValue placeholder="Granularity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">By day</SelectItem>
            <SelectItem value="week">By week</SelectItem>
            <SelectItem value="month">By month</SelectItem>
          </SelectContent>
        </Select>

        {canManage && (
          <Button
            onClick={() => setAddOpen(true)}
            size="sm"
            data-testid="add-action-btn"
          >
            <Plus className="size-4 mr-1" aria-hidden="true" />
            Add action
          </Button>
        )}

        {/* Klaviyo overlay — honest-disabled (not connected locally) */}
        <div
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/40 bg-violet-500/8 px-3 py-1.5 text-xs text-violet-700 dark:text-violet-300"
          title="Klaviyo: connect to overlay email sends on the calendar"
          data-testid="klaviyo-disabled-badge"
        >
          <Mail className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Klaviyo sends</span>
          <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground uppercase tracking-wide">Connect</span>
        </div>
      </div>

      {/* --- Icon legend --- */}
      <div
        className="rounded-lg border bg-card p-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"
        aria-label="Marketing action type legend"
        data-testid="action-legend"
      >
        <span className="font-medium text-foreground">Manual actions:</span>
        {MARKETING_ACTION_TYPES.map((t) => {
          const Ic = ACTION_ICONS[t] ?? MoreVertical;
          return (
            <span key={t} className="inline-flex items-center gap-1">
              <Ic className="size-3.5 shrink-0" aria-hidden="true" />
              {ACTION_LABELS[t]}
            </span>
          );
        })}
      </div>

      {/* --- Error --- */}
      {error && (
        <ErrorDisplay
          title="Failed to load calendar"
          message={error.message}
          requestId={(error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {/* --- Festival band legend --- */}
      {!isLoading && festivals.length > 0 && (
        <div
          className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1"
          data-testid="festival-legend"
          aria-label="Festivals this month"
        >
          <span className="font-medium text-foreground">Festivals:</span>
          {festivals.map((f) => (
            <span key={`${f.name}::${f.start_date}`} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: f.color }}
                aria-hidden="true"
              />
              <span>
                {f.name} ({formatMonthDay(f.start_date)}–{formatMonthDay(f.end_date)})
                {' '}{(f.expected_multiplier_bp / 10000).toFixed(1)}×
              </span>
            </span>
          ))}
        </div>
      )}

      {/* --- Loading --- */}
      {isLoading && (
        <div className="flex justify-center py-20" aria-busy="true" aria-label="Loading calendar">
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      )}

      {/* --- Empty --- */}
      {!isLoading && !error && rows.length === 0 && (
        <p className="text-muted-foreground py-8">
          No rows. Connect Shopify to load this month.
        </p>
      )}

      {/* --- Grid table --- */}
      {!isLoading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border" data-testid="calendar-grid">
          <table className="w-full min-w-[820px] text-sm" role="grid">
            <thead>
              <tr className="border-b bg-muted/40">
                <th
                  scope="col"
                  className="sticky left-0 z-20 bg-muted/40 w-[120px] min-w-[120px] px-3 py-2 text-left text-xs font-medium text-muted-foreground shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]"
                >
                  Date
                </th>
                <th
                  scope="col"
                  className="sticky left-[120px] z-20 bg-muted/40 w-[130px] min-w-[130px] border-r px-3 py-2 text-left text-xs font-medium text-muted-foreground shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]"
                >
                  Actions
                </th>
                <th scope="col" className="min-w-[520px] px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Metrics
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const periodKey = row.period_key;
                const dateKey = periodKey.length >= 10 ? periodKey.slice(0, 10) : periodKey;
                const festival = festivalForDate(dateKey, festivals);
                // Merge calendar.report actions + listActions overlay
                const calActions = row.actions as ActionRow[];
                const overlayActions = actionsByDate.get(dateKey) ?? [];
                // Deduplicate by id (listActions may echo what calendar.report already returned)
                const seen = new Set(calActions.map((a) => a.id));
                const mergedActions: ActionRow[] = [
                  ...calActions,
                  ...overlayActions.filter((a) => !seen.has(a.id)),
                ];

                return (
                  <tr
                    key={periodKey}
                    className="border-b last:border-b-0 hover:bg-muted/20"
                  >
                    {/* Date cell with festival left-border band */}
                    <td
                      className="sticky left-0 z-10 bg-card align-top px-3 py-3 font-medium text-sm whitespace-nowrap shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]"
                      style={festival ? { borderLeft: `4px solid ${festival.color}` } : undefined}
                      title={
                        festival
                          ? `${festival.name} · ${(festival.expected_multiplier_bp / 10000).toFixed(1)}× expected lift`
                          : undefined
                      }
                      data-testid={`cal-date-${dateKey}`}
                    >
                      {row.label}
                    </td>

                    {/* Actions cell */}
                    <td className="sticky left-[120px] z-10 bg-card border-r align-top px-2 py-2 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]">
                      <div className="flex flex-wrap gap-1">
                        {mergedActions.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          mergedActions.map((a) => {
                            const Ic = ACTION_ICONS[a.action_type] ?? MoreVertical;
                            const isKlaviyo = a.source === 'klaviyo';
                            return (
                              <DropdownMenu key={a.id}>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className={`inline-flex rounded-md border p-1 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                      isKlaviyo ? 'bg-violet-500/10 border-violet-500/30' : 'bg-muted/50'
                                    }`}
                                    title={a.action_name}
                                    aria-label={`${a.action_name} (${isKlaviyo ? 'Klaviyo' : ACTION_LABELS[a.action_type] ?? a.action_type})`}
                                    data-testid={`action-btn-${a.id}`}
                                  >
                                    <Ic className="size-4" aria-hidden="true" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-56">
                                  <div className="px-2 py-1.5 text-xs border-b">
                                    {isKlaviyo && (
                                      <p className="text-[10px] uppercase tracking-wide text-violet-600 dark:text-violet-400 mb-1">
                                        Klaviyo
                                      </p>
                                    )}
                                    <p className="font-medium">{a.action_name}</p>
                                    <p className="text-muted-foreground">
                                      {a.action_date} · {ACTION_LABELS[a.action_type] ?? a.action_type}
                                    </p>
                                    {a.notes && <p className="mt-1 text-foreground">{a.notes}</p>}
                                  </div>
                                  {!isKlaviyo && canManage && (
                                    <>
                                      <DropdownMenuItem
                                        onClick={() => openEdit(a)}
                                        data-testid={`edit-action-${a.id}`}
                                      >
                                        <Pencil className="size-3.5 mr-2" aria-hidden="true" />
                                        Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => deleteMut.mutate({ action_id: a.id })}
                                        data-testid={`delete-action-${a.id}`}
                                      >
                                        <Trash2 className="size-3.5 mr-2" aria-hidden="true" />
                                        Delete
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            );
                          })
                        )}
                      </div>
                    </td>

                    {/* Metrics cell */}
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap gap-3 items-start">
                        <MetricCell
                          label="Revenue"
                          cell={row.revenue}
                          display={moneyCell(row.revenue, currencyCode)}
                        />
                        <MetricCell
                          label="CM3"
                          cell={row.cm3}
                          display={moneyCell(row.cm3, currencyCode)}
                        />
                        <div className="min-w-[88px]">
                          <p className="text-[9px] uppercase text-muted-foreground mb-0.5">Tot spend</p>
                          <div className="text-sm font-semibold tabular-nums py-1.5">
                            {formatMoney(row.total_spend_mu, currencyCode)}
                          </div>
                        </div>
                        <MetricCell
                          label="MER"
                          cell={row.mer}
                          display={ratioCell(row.mer)}
                        />
                        <MetricCell
                          label="aMER"
                          cell={row.amer}
                          display={ratioCell(row.amer)}
                        />
                        <MetricCell
                          label="New NC"
                          cell={row.new_customers}
                          display={
                            row.new_customers.actual == null
                              ? '—'
                              : Number(row.new_customers.actual).toLocaleString('en-IN')
                          }
                        />
                        <MetricCell
                          label="CAC"
                          cell={row.cac}
                          display={moneyCell(row.cac, currencyCode)}
                        />
                        <MetricCell
                          label="AOV"
                          cell={row.aov}
                          display={moneyCell(row.aov, currencyCode)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* --- Request ID trace --- */}
      {calQ.data && (
        <p className="text-[10px] text-muted-foreground sr-only">
          Data as of {new Date(calQ.data.data_epoch).toISOString()}. Request ID: {calQ.data.request_id}
        </p>
      )}

      {/* ================================================================
          Add Action Dialog
          ================================================================ */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent aria-label="Add marketing action">
          <DialogHeader>
            <DialogTitle>Add marketing action</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label htmlFor="add-action-date">Date</Label>
              <Input
                id="add-action-date"
                type="date"
                value={addDate}
                onChange={(e) => setAddDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="add-action-type">Type</Label>
              <Select value={addType} onValueChange={(v) => setAddType(v as MarketingActionTypeValue)}>
                <SelectTrigger id="add-action-type" aria-label="Action type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETING_ACTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ACTION_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="add-action-name">Name</Label>
              <Input
                id="add-action-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Campaign or event name"
              />
            </div>
            <div>
              <Label htmlFor="add-action-notes">Notes (optional)</Label>
              <Input
                id="add-action-notes"
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
              />
            </div>
          </div>
          {createMut.error && (
            <p className="text-sm text-destructive">{createMut.error.message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createMut.mutate({
                  action_date: addDate,
                  action_type: addType,
                  action_name: addName,
                  notes:       addNotes || null,
                })
              }
              disabled={createMut.isPending || !addName.trim()}
              data-testid="save-add-action-btn"
            >
              {createMut.isPending ? <Loader2 className="size-4 animate-spin mr-1" aria-hidden="true" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================
          Edit Action Dialog
          ================================================================ */}
      <Dialog open={!!editId} onOpenChange={(o) => { if (!o) setEditId(null); }}>
        <DialogContent aria-label="Edit marketing action">
          <DialogHeader>
            <DialogTitle>Edit action</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label htmlFor="edit-action-date">Date</Label>
              <Input
                id="edit-action-date"
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-action-type">Type</Label>
              <Select value={editType} onValueChange={(v) => setEditType(v as MarketingActionTypeValue)}>
                <SelectTrigger id="edit-action-type" aria-label="Action type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETING_ACTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ACTION_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-action-name">Name</Label>
              <Input
                id="edit-action-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-action-notes">Notes</Label>
              <Input
                id="edit-action-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>
          </div>
          {updateMut.error && (
            <p className="text-sm text-destructive">{updateMut.error.message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editId) return;
                updateMut.mutate({
                  action_id:   editId,
                  action_date: editDate,
                  action_type: editType,
                  action_name: editName,
                  notes:       editNotes || null,
                });
              }}
              disabled={updateMut.isPending}
              data-testid="save-edit-action-btn"
            >
              {updateMut.isPending ? <Loader2 className="size-4 animate-spin mr-1" aria-hidden="true" /> : null}
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

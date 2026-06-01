'use client';

// @paradigm: sql
// GoalsContent — /settings/goals — CRUD editor (Wave 3 parity restoration).
// Restores the legacy goal-management editor: add/update/delete goals across
// periods with goal_type (TARGET/MINIMUM/MAXIMUM) and metric description.
// A separate Attainment section below shows the RAG report from settings.goals.
//
// Unit contract (CF-C6-UNIT-1 — bigint minor units):
//   currency → paise (user rupees × 100)     → goal_unit "mu"
//   ratio    → bp    (user value × 10000)     → goal_unit "bp"
//   percent  → bp    (user pct  × 100)        → goal_unit "bp"
//   count    → integer as-is                  → goal_unit "count"
//
// MANAGER-gated writes; ANALYST can read (attainment section). Role from Redux
// session.workspaceRole. CF-C6-RENDER-ONLY-1: display only, no inline math.

import { useState, useCallback, useEffect } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { RagBadge } from '@/interfaces/components/shared/rag-badge.js';
import { formatBpPercent, formatBpMultiple } from '@/interfaces/components/marketing/format-ratio.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/interfaces/components/ui/select.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/interfaces/components/ui/table.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';
import { Badge } from '@/interfaces/components/ui/badge.js';

// ---------------------------------------------------------------------------
// Metric registry (canonical — metric registry source of truth, do not extend)
// ---------------------------------------------------------------------------

type GoalMetricId =
  | 'revenue' | 'cm3' | 'cm3_pct' | 'mer' | 'amer' | 'cac'
  | 'aov' | 'new_customers' | 'acos' | 'meta_roas' | 'google_roas';

type MetricUnit = 'currency' | 'percent' | 'ratio' | 'count';

interface MetricMeta {
  label: string;
  description: string;
  higherBetter: boolean;
  unit: MetricUnit;
}

const METRIC_REGISTRY: Record<GoalMetricId, MetricMeta> = {
  revenue:       { label: 'Net revenue',    description: 'Store net sales (selected range)',                   higherBetter: true,  unit: 'currency' },
  cm3:           { label: 'CM3',            description: 'Contribution margin 3 after misc expenses',          higherBetter: true,  unit: 'currency' },
  cm3_pct:       { label: 'CM3 %',          description: 'CM3 ÷ net sales × 100',                              higherBetter: true,  unit: 'percent'  },
  mer:           { label: 'MER',            description: 'Net revenue ÷ total ad spend',                       higherBetter: true,  unit: 'ratio'    },
  amer:          { label: 'aMER',           description: 'New-customer revenue ÷ acquisition ad spend',        higherBetter: true,  unit: 'ratio'    },
  cac:           { label: 'Blended CAC',    description: 'Acquisition cost per new customer',                  higherBetter: false, unit: 'currency' },
  aov:           { label: 'AOV',            description: 'Average order value',                                higherBetter: true,  unit: 'currency' },
  new_customers: { label: 'New customers',  description: 'First-order customers in range',                     higherBetter: true,  unit: 'count'    },
  acos:          { label: 'ACOS',           description: 'Ad spend ÷ net sales × 100',                         higherBetter: false, unit: 'percent'  },
  meta_roas:     { label: 'Meta ROAS',      description: 'Attributed purchase value ÷ Meta spend',             higherBetter: true,  unit: 'ratio'    },
  google_roas:   { label: 'Google ROAS',    description: 'Conversion value ÷ Google spend',                    higherBetter: true,  unit: 'ratio'    },
};

const METRIC_IDS = Object.keys(METRIC_REGISTRY) as GoalMetricId[];

type PeriodType  = 'DAILY' | 'WEEKLY' | 'MONTHLY';
type GoalType    = 'TARGET' | 'MINIMUM' | 'MAXIMUM';

const PERIODS: { value: PeriodType; label: string }[] = [
  { value: 'DAILY',   label: 'Daily'              },
  { value: 'WEEKLY',  label: 'Weekly (Mon start)' },
  { value: 'MONTHLY', label: 'Monthly'            },
];

const GOAL_TYPES: { value: GoalType; label: string; hint: string }[] = [
  { value: 'TARGET',  label: 'Target',  hint: 'RAG uses metric direction'  },
  { value: 'MINIMUM', label: 'Minimum', hint: 'Higher is better'           },
  { value: 'MAXIMUM', label: 'Maximum', hint: 'Lower is better'            },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert display value → bigint minor units per unit type. */
function toMinorUnits(displayValue: number, unit: MetricUnit): bigint {
  if (unit === 'currency') return BigInt(Math.round(displayValue * 100));  // rupees → paise
  if (unit === 'ratio')    return BigInt(Math.round(displayValue * 10000)); // 1.5× → 15000 bp
  if (unit === 'percent')  return BigInt(Math.round(displayValue * 100));  // 20% → 2000 bp
  return BigInt(Math.round(displayValue));                                  // count
}

/** goal_unit string for the API input. */
function toGoalUnit(unit: MetricUnit): 'mu' | 'bp' | 'count' {
  if (unit === 'currency') return 'mu';
  if (unit === 'ratio' || unit === 'percent') return 'bp';
  return 'count';
}

/** Display a stored bigint value (from attainment row) for a given metric. */
function fmtStoredValue(metricId: string, value: bigint, currencyCode: string): string {
  const meta = METRIC_REGISTRY[metricId as GoalMetricId];
  if (!meta) return String(value);
  if (meta.unit === 'currency') return formatMoney(value, currencyCode);
  if (meta.unit === 'ratio')    return formatBpMultiple(Number(value));
  if (meta.unit === 'percent')  return formatBpPercent(Number(value));
  return String(value);
}

/** Human-readable placeholder hint for the goal-value input. */
function valuePlaceholder(unit: MetricUnit): string {
  if (unit === 'currency') return 'e.g. 500000 (₹ amount)';
  if (unit === 'ratio')    return 'e.g. 4.5 for 4.5×';
  if (unit === 'percent')  return 'e.g. 20 for 20%';
  return 'e.g. 100';
}

function isManager(role: string | null): boolean {
  return role === 'MANAGER' || role === 'OWNER';
}

// ---------------------------------------------------------------------------
// Locally tracked goal row (populated from createGoal mutation responses)
// We store enough for the editor table; the attainment section uses server data.
// ---------------------------------------------------------------------------
interface LocalGoal {
  id: string;  // UUID from createGoal response
  metric_name: GoalMetricId;
  period_type: PeriodType;
  period_start: string;
  goal_value: bigint;
  goal_unit: 'mu' | 'bp' | 'count';
  goal_type: GoalType;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GoalsContent() {
  const workspaceId     = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceRole   = useAppSelector((s) => s.session.workspaceRole);

  const canChange = isManager(workspaceRole);

  // Date-range URL state for the attainment section
  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-05-01'));
  const [dateEnd,   setDateEnd]   = useQueryState('to',   parseAsString.withDefault('2026-05-31'));

  // Editor form state
  const [metricName,   setMetricName]   = useState<GoalMetricId>('revenue');
  const [periodType,   setPeriodType]   = useState<PeriodType>('MONTHLY');
  const [periodStart,  setPeriodStart]  = useState(() => new Date().toISOString().slice(0, 10));
  const [goalValue,    setGoalValue]    = useState('');
  const [goalType,     setGoalType]     = useState<GoalType>('TARGET');
  const [formError,    setFormError]    = useState<string | null>(null);

  // Locally tracked saved goals (populated/updated from mutation responses)
  const [localGoals, setLocalGoals] = useState<LocalGoal[]>([]);

  const enabled = Boolean(isAuthenticated && workspaceId);
  const utils   = trpc.useUtils();

  // Attainment read query (for the RAG report section)
  const attainmentQ = trpc.settings.goals.useQuery(
    { date_start: dateStart, date_end: dateEnd },
    { enabled },
  );

  // Hydrate the editable/deletable goal list WITH ids from core-service (the attainment
  // read is an aggregate with no row id), so existing goals are editable on load.
  const configGoalsQ = trpc.settings.listGoals.useQuery(undefined, { enabled });
  useEffect(() => {
    if (configGoalsQ.data) {
      setLocalGoals(
        configGoalsQ.data.rows.map((r) => ({
          id: r.id,
          metric_name: r.metric_name as GoalMetricId,
          period_type: r.period_type as PeriodType,
          period_start: r.period_start,
          goal_value: BigInt(r.goal_value as unknown as string),
          goal_unit: (r.goal_unit as 'mu' | 'bp' | 'count') ?? 'mu',
          goal_type: r.goal_type as GoalType,
          updated_at: r.updated_at,
        })),
      );
    }
  }, [configGoalsQ.data]);

  // CRUD mutations
  const createMutation = trpc.settings.createGoal.useMutation({
    onSuccess: (data) => {
      const meta = METRIC_REGISTRY[data.metric_name as GoalMetricId];
      const row: LocalGoal = {
        id:          data.id as string,
        metric_name: data.metric_name as GoalMetricId,
        period_type: data.period_type as PeriodType,
        period_start:data.period_start as string,
        goal_value:  BigInt(data.goal_value),
        goal_unit:   (data.goal_unit as 'mu' | 'bp' | 'count') ?? (meta ? toGoalUnit(meta.unit) : 'mu'),
        goal_type:   data.goal_type as GoalType,
        updated_at:  (data.updated_at as string) ?? new Date().toISOString(),
      };
      // Upsert locally: same key = replace
      setLocalGoals((prev) => {
        const key = `${row.metric_name}::${row.period_type}::${row.period_start}`;
        const filtered = prev.filter(
          (g) => `${g.metric_name}::${g.period_type}::${g.period_start}` !== key,
        );
        return [...filtered, row];
      });
      void utils.settings.goals.invalidate();
      void utils.settings.listGoals.invalidate();
      setGoalValue('');
      setFormError(null);
    },
    onError: (err) => setFormError(err.message),
  });

  const deleteMutation = trpc.settings.deleteGoal.useMutation({
    onSuccess: (_data, vars) => {
      setLocalGoals((prev) => prev.filter((g) => g.id !== vars.goal_id));
      void utils.settings.goals.invalidate();
      void utils.settings.listGoals.invalidate();
    },
    onError: (err) => setFormError(err.message),
  });

  const handleSave = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);
      const num = parseFloat(goalValue);
      if (!goalValue.trim() || Number.isNaN(num) || num < 0) {
        setFormError('Enter a valid goal value (≥ 0)');
        return;
      }
      const meta = METRIC_REGISTRY[metricName];
      const minorUnits = toMinorUnits(num, meta.unit);
      createMutation.mutate({
        metric_name:  metricName,
        period_type:  periodType,
        period_start: periodStart,
        goal_value:   minorUnits,
        goal_unit:    toGoalUnit(meta.unit),
        goal_type:    goalType,
      });
    },
    [goalValue, metricName, periodType, periodStart, goalType, createMutation],
  );

  const handleDelete = useCallback(
    (goalId: string) => {
      if (!confirm('Remove this goal?')) return;
      deleteMutation.mutate({ goal_id: goalId });
    },
    [deleteMutation],
  );

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <a href="/login" className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
            Sign in
          </a>
        </div>
      </div>
    );
  }

  const selectedMeta = METRIC_REGISTRY[metricName];

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground">
          Metric goals
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Set targets by period. KPI cards compare your selected date range to the goal for the
          period containing the range end (daily → weekly → monthly precedence). Calendar and alerts
          will build on this later.
        </p>
      </div>

      {!canChange && (
        <p className="text-sm text-muted-foreground" role="note">
          Only workspace managers can edit goals.
        </p>
      )}

      {/* Form error banner */}
      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          data-testid="goals-form-error"
        >
          {formError}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* EDITOR: Add / update goal                                         */}
      {/* ---------------------------------------------------------------- */}
      <form
        onSubmit={handleSave}
        className="rounded-xl border bg-card p-6 space-y-4"
        data-testid="goals-editor-form"
        aria-label="Add or update goal"
      >
        <h3 className="text-sm font-medium">Add or update goal</h3>
        <p className="text-xs text-muted-foreground">
          Same metric + period type + period start updates the existing row. Monthly/week start is
          normalised automatically (e.g. any day in March → March 1 for monthly).
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Metric selector */}
          <div className="space-y-2">
            <Label htmlFor="goals-metric" className="text-xs font-medium text-muted-foreground">
              Metric
            </Label>
            <Select
              value={metricName}
              onValueChange={(v) => setMetricName(v as GoalMetricId)}
              disabled={!canChange}
            >
              <SelectTrigger id="goals-metric" data-testid="goals-metric-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {METRIC_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {METRIC_REGISTRY[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground" data-testid="goals-metric-desc">
              {selectedMeta.description}
            </p>
          </div>

          {/* Period type */}
          <div className="space-y-2">
            <Label htmlFor="goals-period" className="text-xs font-medium text-muted-foreground">
              Period
            </Label>
            <Select
              value={periodType}
              onValueChange={(v) => setPeriodType(v as PeriodType)}
              disabled={!canChange}
            >
              <SelectTrigger id="goals-period" data-testid="goals-period-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Period anchor date */}
          <div className="space-y-2">
            <Label htmlFor="goals-period-start" className="text-xs font-medium text-muted-foreground">
              Period anchor date
            </Label>
            <Input
              id="goals-period-start"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              disabled={!canChange}
              required
              data-testid="goals-period-start"
            />
          </div>

          {/* Goal value */}
          <div className="space-y-2">
            <Label htmlFor="goals-value" className="text-xs font-medium text-muted-foreground">
              Goal value
            </Label>
            <Input
              id="goals-value"
              type="number"
              step="any"
              min="0"
              placeholder={valuePlaceholder(selectedMeta.unit)}
              value={goalValue}
              onChange={(e) => setGoalValue(e.target.value)}
              disabled={!canChange}
              required
              data-testid="goals-value-input"
            />
          </div>

          {/* Goal type */}
          <div className="space-y-2">
            <Label htmlFor="goals-type" className="text-xs font-medium text-muted-foreground">
              Goal type
            </Label>
            <Select
              value={goalType}
              onValueChange={(v) => setGoalType(v as GoalType)}
              disabled={!canChange}
            >
              <SelectTrigger id="goals-type" data-testid="goals-type-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label} — {t.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          type="submit"
          disabled={!canChange || createMutation.isPending}
          data-testid="goals-save-btn"
          aria-busy={createMutation.isPending}
        >
          {createMutation.isPending ? 'Saving…' : 'Save goal'}
        </Button>
      </form>

      {/* ---------------------------------------------------------------- */}
      {/* SAVED GOALS list (client-tracked from mutation responses)         */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-xl border bg-card overflow-hidden" data-testid="goals-saved-list">
        <div className="border-b px-6 py-3">
          <h3 className="text-sm font-medium">Saved goals</h3>
        </div>
        {localGoals.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No goals yet. Add revenue, MER, CAC, or other metrics above. They will appear on Store
            Analytics, Acquisition, and ad summaries when the date range matches.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Start</TableHead>
                <TableHead className="text-right">Goal</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {localGoals.map((g) => {
                const meta = METRIC_REGISTRY[g.metric_name];
                return (
                  <TableRow key={g.id} data-testid={`goal-row-${g.id}`}>
                    <TableCell className="font-medium">
                      {meta?.label ?? g.metric_name}
                    </TableCell>
                    <TableCell>{g.period_type}</TableCell>
                    <TableCell className="tabular-nums">{g.period_start}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtStoredValue(g.metric_name, g.goal_value, 'INR')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{g.goal_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        disabled={!canChange || deleteMutation.isPending}
                        onClick={() => handleDelete(g.id)}
                        aria-label={`Delete goal for ${meta?.label ?? g.metric_name}`}
                        data-testid={`goal-delete-${g.id}`}
                      >
                        {/* Inline SVG trash — avoids @tabler/icons-react dep in web bundle */}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="size-4"
                          aria-hidden="true"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* ATTAINMENT REPORT — directional RAG (read, separate section)      */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="attainment-heading" className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h3 id="attainment-heading" className="text-sm font-medium">
            Goal attainment report
          </h3>
          <div className="flex items-center gap-2 shrink-0 flex-wrap" aria-label="Date range for attainment report">
            <Label htmlFor="goals-from" className="sr-only">From date</Label>
            <input
              id="goals-from"
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              aria-label="Attainment from date"
            />
            <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
            <Label htmlFor="goals-to" className="sr-only">To date</Label>
            <input
              id="goals-to"
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              aria-label="Attainment to date"
            />
          </div>
        </div>

        {attainmentQ.isLoading && (
          <div aria-busy="true" aria-label="Loading attainment" className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-9 bg-muted rounded animate-pulse" aria-hidden="true" />
            ))}
          </div>
        )}

        {attainmentQ.error && (
          <ErrorDisplay
            title="Failed to load goal attainment"
            message={attainmentQ.error.message}
            requestId={(attainmentQ.error as { data?: { requestId?: string } }).data?.requestId}
          />
        )}

        {attainmentQ.data && (
          <div className="rounded-xl border bg-card overflow-hidden" data-testid="goals-attainment-table">
            <div className="sr-only">
              Data as of {new Date(attainmentQ.data.data_epoch).toISOString()}.
              Request ID: {attainmentQ.data.request_id}
            </div>
            {attainmentQ.data.rows.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                No attainment data for this period. Goals set above will appear here once the
                period contains data.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead className="text-right">Goal</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Attainment</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attainmentQ.data.rows.map((row) => {
                    const meta   = METRIC_REGISTRY[row.metric_name as GoalMetricId];
                    const pct    = row.attainment_bp == null ? null : Math.round(row.attainment_bp / 100);
                    const cc     = 'INR';
                    return (
                      <TableRow key={`${row.metric_name}-${row.period_type}-${row.period_start}`}>
                        <TableCell className="font-medium">
                          {meta?.label ?? row.metric_name}
                          {!row.higher_better && (
                            <span className="ml-1 text-xs text-muted-foreground" title="lower is better">
                              (↓ better)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.period_type}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{row.period_start}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtStoredValue(row.metric_name, row.goal_value, cc)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.goal_type}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtStoredValue(row.metric_name, row.actual, cc)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pct == null ? '—' : `${pct}%`}
                        </TableCell>
                        <TableCell className="text-right">
                          <RagBadge
                            rag={row.rag}
                            label={`${meta?.label ?? row.metric_name}${pct != null ? ` at ${pct}% of goal` : ''}`}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

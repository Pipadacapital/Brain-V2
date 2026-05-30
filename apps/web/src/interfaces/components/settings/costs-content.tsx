'use client';

// @paradigm: sql
// CostsContent — Wave-3 CRUD restore. Parity-18.
// Sections (primary, CRUD): Costs & Charges | Miscellaneous Expenses | Founder's Salary.
// Analytics blocks (secondary, read-only): COGS resolution | Cost stack | CM landing.
// CRUD calls: settings.createCost / deleteCost (MANAGER),
//             settings.createMiscExpense / deleteMiscExpense (MANAGER),
//             settings.getFounderSalary (ANALYST) / setFounderSalary (OWNER).
// Money: rupee input → paise (×100 as bigint) on save; formatMoney for display.
// Role gate: hide Add/Delete when workspaceRole is not MANAGER+; Founder salary edit is OWNER-only.

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useQueryState, parseAsString } from 'nuqs';
import { formatMoney } from '@brain/lib-metrics';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { formatBpPercent } from '@/interfaces/components/marketing/format-ratio.js';
import { Button } from '@/interfaces/components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/interfaces/components/ui/dialog.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/interfaces/components/ui/select.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/interfaces/components/ui/table.js';

// ─── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_LEVEL: Record<string, number> = {
  OWNER: 4, ADMIN: 3, MANAGER: 2, ANALYST: 1, VIEWER: 0,
};

function atLeast(role: string | null, required: string): boolean {
  return (ROLE_LEVEL[role ?? ''] ?? 0) >= (ROLE_LEVEL[required] ?? 99);
}

// ─── Display helpers ──────────────────────────────────────────────────────────

const COST_TYPE_LABELS: Record<string, string> = {
  SHIPPING: 'Shipping',
  PACKAGING: 'Packaging',
  WEBSITE: 'Website Charges (%)',
  CUSTOM: 'Custom',
};

const BILLING_MODE_LABELS: Record<string, string> = {
  MONTHLY: 'Monthly',
  PER_ORDER: 'Per order',
};

const KIND_LABEL: Record<string, string> = {
  fixed_monthly: 'Fixed / month',
  per_order: 'Per order',
  percent: '% of revenue',
};

function formatCostAmount(kind: string, amountMu: bigint, amountBp: number, currency: string): string {
  if (kind === 'percent') return formatBpPercent(amountBp);
  return formatMoney(amountMu, currency);
}

const CURRENCY_OPTIONS = [
  { value: 'INR', label: 'INR (₹)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'AED', label: 'AED' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
];

// ─── Local row types (with IDs from mutation responses) ───────────────────────

interface LocalCostRow {
  id: string;
  cost_type: string;
  name: string | null;
  amount_mu: bigint;
  is_percent: boolean;
  effective_from: string;
  effective_to: string | null;
  currency_code: string | null;
  billing_mode: string | null;
}

interface LocalMiscRow {
  id: string;
  name: string;
  amount_mu: bigint;
  currency_code: string;
  effective_start_date: string;
}

// ─── Add Cost dialog ──────────────────────────────────────────────────────────

function AddCostDialog({
  onCreated,
  currency,
}: {
  onCreated: (row: LocalCostRow) => void;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [costType, setCostType] = useState<'SHIPPING' | 'PACKAGING' | 'WEBSITE' | 'CUSTOM'>('SHIPPING');
  const [name, setName] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [billingMode, setBillingMode] = useState<'MONTHLY' | 'PER_ORDER'>('MONTHLY');
  const [currencyCode, setCurrencyCode] = useState(currency || 'INR');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const create = trpc.settings.createCost.useMutation({
    onSuccess: (row) => {
      onCreated({
        id: row.id,
        cost_type: row.cost_type,
        name: row.name ?? null,
        amount_mu: BigInt(row.amount_mu as unknown as string),
        is_percent: row.is_percent ?? false,
        effective_from: row.effective_from,
        effective_to: row.effective_to ?? null,
        currency_code: row.currency_code ?? null,
        billing_mode: row.billing_mode ?? null,
      });
      utils.settings.costs.invalidate();
      setOpen(false);
      resetForm();
    },
    onError: (e) => setError(e.message),
  });

  function resetForm() {
    setCostType('SHIPPING');
    setName('');
    setAmountStr('');
    setBillingMode('MONTHLY');
    setCurrencyCode(currency || 'INR');
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setError(null);
  }

  const isWebsite = costType === 'WEBSITE';
  const isShippingOrPackaging = costType === 'SHIPPING' || costType === 'PACKAGING';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountNum = parseFloat(amountStr);
    if (Number.isNaN(amountNum) || amountNum < 0) {
      setError('Amount must be a non-negative number.');
      return;
    }
    // Website is stored as a percent — send as bp (basis points × 100).
    // All other costs: rupee input → paise (×100 as bigint).
    const amount_mu: bigint = isWebsite
      ? 0n
      : BigInt(Math.round(amountNum * 100));
    create.mutate({
      cost_type: costType,
      name: (costType === 'CUSTOM' && name.trim()) ? name.trim() : undefined,
      amount_mu,
      is_percent: isWebsite,
      currency_code: isWebsite ? undefined : currencyCode,
      billing_mode: billingMode,
      effective_from: effectiveFrom,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button data-testid="add-cost-btn">
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Add Cost
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Cost</DialogTitle>
          <DialogDescription>Set a new cost effective from a specific date.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" aria-label="Add cost form">
          <div className="space-y-1.5">
            <Label htmlFor="cost-type">Type</Label>
            <Select value={costType} onValueChange={(v) => setCostType(v as typeof costType)}>
              <SelectTrigger id="cost-type" className="w-full">
                <SelectValue placeholder="Select a cost type" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(COST_TYPE_LABELS) as Array<typeof costType>).map((t) => (
                  <SelectItem key={t} value={t}>{COST_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {costType === 'CUSTOM' && (
            <div className="space-y-1.5">
              <Label htmlFor="cost-name">Name</Label>
              <Input id="cost-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Storage Fee" />
            </div>
          )}

          {isShippingOrPackaging && (
            <div className="space-y-1.5">
              <Label htmlFor="billing-mode">Billing</Label>
              <Select value={billingMode} onValueChange={(v) => setBillingMode(v as typeof billingMode)}>
                <SelectTrigger id="billing-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">Monthly (flat amount per month)</SelectItem>
                  <SelectItem value="PER_ORDER">Per order</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className={isWebsite ? '' : 'grid grid-cols-2 gap-4'}>
            <div className="space-y-1.5">
              <Label htmlFor="cost-amount">
                {isWebsite ? 'Website Charges (%)' : billingMode === 'PER_ORDER' ? 'Per-order amount' : 'Monthly amount'}
              </Label>
              <Input
                id="cost-amount"
                type="number"
                step="0.01"
                min={0}
                max={isWebsite ? 100 : undefined}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder={isWebsite ? 'e.g. 2.5' : undefined}
              />
              {isWebsite && <p className="text-xs text-muted-foreground">Calculated as % of Gross Sales</p>}
            </div>
            {!isWebsite && (
              <div className="space-y-1.5">
                <Label htmlFor="cost-currency">Currency</Label>
                <Select value={currencyCode} onValueChange={setCurrencyCode}>
                  <SelectTrigger id="cost-currency" className="w-full">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cost-effective-from">Effective From</Label>
            <Input
              id="cost-effective-from"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={create.isPending} data-testid="save-cost-btn">
              {create.isPending ? 'Saving…' : 'Save Cost'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Misc Expense dialog ──────────────────────────────────────────────────

function AddMiscDialog({
  onCreated,
  currency,
}: {
  onCreated: (row: LocalMiscRow) => void;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [miscName, setMiscName] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [currencyCode, setCurrencyCode] = useState(currency || 'INR');
  const [effectiveStartDate, setEffectiveStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const create = trpc.settings.createMiscExpense.useMutation({
    onSuccess: (row) => {
      onCreated({
        id: row.id,
        name: row.name,
        amount_mu: BigInt(row.amount_mu as unknown as string),
        currency_code: row.currency_code ?? currency,
        effective_start_date: row.effective_start_date,
      });
      utils.settings.costs.invalidate();
      setOpen(false);
      resetForm();
    },
    onError: (e) => setError(e.message),
  });

  function resetForm() {
    setMiscName('');
    setAmountStr('');
    setCurrencyCode(currency || 'INR');
    setEffectiveStartDate(new Date().toISOString().slice(0, 10));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!miscName.trim()) { setError('Name is required.'); return; }
    const amountNum = parseFloat(amountStr);
    if (Number.isNaN(amountNum) || amountNum < 0) { setError('Amount must be a non-negative number.'); return; }
    // Rupee input → paise (×100 as bigint)
    const amount_mu = BigInt(Math.round(amountNum * 100));
    create.mutate({ name: miscName.trim(), amount_mu, currency_code: currencyCode, effective_start_date: effectiveStartDate });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button data-testid="add-misc-btn">
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Add Expense
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Miscellaneous Expense</DialogTitle>
          <DialogDescription>This expense will be included in CM3 calculation for any date range that overlaps.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" aria-label="Add misc expense form">
          <div className="space-y-1.5">
            <Label htmlFor="misc-name">Expense Name</Label>
            <Input id="misc-name" value={miscName} onChange={(e) => setMiscName(e.target.value)} placeholder="e.g. Office Rent, Employee Salary" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="misc-amount">Amount</Label>
              <Input id="misc-amount" type="number" step="0.01" min={0} value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="misc-currency">Currency</Label>
              <Select value={currencyCode} onValueChange={setCurrencyCode}>
                <SelectTrigger id="misc-currency" className="w-full">
                  <SelectValue placeholder="Currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="misc-start-date">Effective Start Date</Label>
            <Input id="misc-start-date" type="date" value={effectiveStartDate} onChange={(e) => setEffectiveStartDate(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending} data-testid="save-misc-btn">
              {create.isPending ? 'Saving…' : 'Save Expense'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CostsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceRole = useAppSelector((s) => s.session.workspaceRole);

  const [dateStart, setDateStart] = useQueryState('from', parseAsString.withDefault('2026-05-01'));
  const [dateEnd, setDateEnd] = useQueryState('to', parseAsString.withDefault('2026-05-31'));

  // Local ID caches: mutation responses carry IDs; the read query (CostStackRow) does not.
  const [localCosts, setLocalCosts] = useState<LocalCostRow[]>([]);
  const [localMisc, setLocalMisc] = useState<LocalMiscRow[]>([]);

  // Founder salary
  const [founderSalaryInput, setFounderSalaryInput] = useState('');
  const [founderCurrency, setFounderCurrency] = useState('INR');

  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.settings.costs.useQuery({ date_start: dateStart, date_end: dateEnd }, { enabled });
  const founderQ = trpc.settings.getFounderSalary.useQuery(undefined, { enabled });

  const utils = trpc.useUtils();

  const canManage = atLeast(workspaceRole, 'MANAGER');
  const isOwner = workspaceRole === 'OWNER';

  // Sync founder salary form from query
  const founderData = founderQ.data;
  if (founderData && founderSalaryInput === '' && founderData.founder_salary_monthly_mu != null) {
    const mu = BigInt(founderData.founder_salary_monthly_mu as unknown as string);
    setFounderSalaryInput(String(Number(mu) / 100));
    setFounderCurrency(founderData.founder_salary_currency ?? 'INR');
  }

  const deleteCost = trpc.settings.deleteCost.useMutation({
    onSuccess: (_r, vars) => {
      setLocalCosts((prev) => prev.filter((c) => c.id !== vars.cost_id));
      utils.settings.costs.invalidate();
    },
  });

  const deleteMisc = trpc.settings.deleteMiscExpense.useMutation({
    onSuccess: (_r, vars) => {
      setLocalMisc((prev) => prev.filter((m) => m.id !== vars.expense_id));
      utils.settings.costs.invalidate();
    },
  });

  const setFounderSalary = trpc.settings.setFounderSalary.useMutation({
    onSuccess: () => utils.settings.getFounderSalary.invalidate(),
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

  const workspaceCurrency = q.data?.result?.currency_code ?? 'INR';

  function handleSaveFounderSalary() {
    const amt = parseFloat(founderSalaryInput);
    if (Number.isNaN(amt) || amt < 0) return;
    // Rupee input → paise (×100 as bigint)
    setFounderSalary.mutate({
      amount_mu: BigInt(Math.round(amt * 100)),
      currency_code: founderCurrency,
    });
  }

  return (
    <div className="space-y-10">

      {/* ═══ CRUD: Costs & Charges ═══ */}
      <section aria-labelledby="costs-charges-heading" className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="costs-charges-heading" className="text-2xl font-bold tracking-tight text-foreground">
              Costs &amp; Charges
            </h2>
            <p className="text-muted-foreground text-sm">Manage your shipping, packaging, and other operational costs.</p>
          </div>
          {canManage && (
            <AddCostDialog
              currency={workspaceCurrency}
              onCreated={(row) => setLocalCosts((prev) => [...prev, row])}
            />
          )}
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Effective From</TableHead>
                <TableHead>Effective To</TableHead>
                {canManage && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {localCosts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5} className="h-24 text-center text-muted-foreground">
                    No costs added yet.{canManage ? ' Add one to get started.' : ''}
                  </TableCell>
                </TableRow>
              ) : (
                localCosts.map((cost) => (
                  <TableRow key={cost.id} data-testid={`cost-row-${cost.id}`}>
                    <TableCell className="font-medium">{COST_TYPE_LABELS[cost.cost_type] ?? cost.cost_type}</TableCell>
                    <TableCell>{cost.name || '-'}</TableCell>
                    <TableCell className="tabular-nums">
                      {cost.is_percent
                        ? `${(Number(cost.amount_mu) / 100).toFixed(2)}%`
                        : `${formatMoney(cost.amount_mu, cost.currency_code ?? workspaceCurrency)} (${BILLING_MODE_LABELS[cost.billing_mode ?? 'MONTHLY'] ?? cost.billing_mode})`}
                    </TableCell>
                    <TableCell>{cost.effective_from}</TableCell>
                    <TableCell>{cost.effective_to ?? 'Present'}</TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete cost ${cost.name ?? cost.cost_type}`}
                          disabled={deleteCost.isPending && deleteCost.variables?.cost_id === cost.id}
                          onClick={() => deleteCost.mutate({ cost_id: cost.id })}
                          data-testid={`delete-cost-${cost.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Cost rows added in this session are listed above. Pre-existing rows resolve via the analytics view below.
        </p>
      </section>

      {/* ═══ CRUD: Miscellaneous Expenses ═══ */}
      <section aria-labelledby="misc-expenses-heading" className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="misc-expenses-heading" className="text-2xl font-bold tracking-tight text-foreground">
              Miscellaneous Expenses
            </h2>
            <p className="text-muted-foreground text-sm">Add recurring business expenses (salaries, rent, tools, etc.) to calculate CM3.</p>
          </div>
          {canManage && (
            <AddMiscDialog
              currency={workspaceCurrency}
              onCreated={(row) => setLocalMisc((prev) => [...prev, row])}
            />
          )}
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Effective From</TableHead>
                {canManage && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {localMisc.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 4 : 3} className="h-24 text-center text-muted-foreground">
                    No miscellaneous expenses.{canManage ? ' Add one to include in CM3.' : ''}
                  </TableCell>
                </TableRow>
              ) : (
                localMisc.map((exp) => (
                  <TableRow key={exp.id} data-testid={`misc-row-${exp.id}`}>
                    <TableCell className="font-medium">{exp.name}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(exp.amount_mu, exp.currency_code)}
                    </TableCell>
                    <TableCell>{exp.effective_start_date}</TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete expense ${exp.name}`}
                          disabled={deleteMisc.isPending && deleteMisc.variables?.expense_id === exp.id}
                          onClick={() => deleteMisc.mutate({ expense_id: exp.id })}
                          data-testid={`delete-misc-${exp.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ═══ CRUD: Founder's salary (ANALYST can view, OWNER can edit) ═══ */}
      <section aria-labelledby="founder-salary-heading" className="space-y-4">
        <div>
          <h2 id="founder-salary-heading" className="text-2xl font-bold tracking-tight text-foreground">
            Founder&apos;s salary
          </h2>
          <p className="text-muted-foreground text-sm">Monthly amount allocated in P&amp;L Net Profit. Owner-only editable.</p>
        </div>
        <div className="rounded-md border p-4">
          {founderQ.isLoading && (
            <div aria-busy="true" aria-label="Loading founder salary" className="h-9 bg-gray-100 rounded animate-pulse" />
          )}
          {founderQ.error && (
            <p className="text-sm text-destructive">{founderQ.error.message}</p>
          )}
          {!founderQ.isLoading && !founderQ.error && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="founder-salary-amount" className="text-sm">Monthly amount</Label>
                <Input
                  id="founder-salary-amount"
                  type="number"
                  min={0}
                  step={0.01}
                  value={founderSalaryInput}
                  onChange={(e) => setFounderSalaryInput(e.target.value)}
                  disabled={!isOwner}
                  className="w-36"
                  aria-label="Founder monthly salary amount"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="founder-currency" className="text-sm">Currency</Label>
                <Select value={founderCurrency} onValueChange={setFounderCurrency} disabled={!isOwner}>
                  <SelectTrigger id="founder-currency" className="w-36">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isOwner && (
                <Button
                  onClick={handleSaveFounderSalary}
                  disabled={setFounderSalary.isPending}
                  data-testid="save-founder-salary-btn"
                >
                  {setFounderSalary.isPending ? 'Saving…' : 'Save'}
                </Button>
              )}
              {!isOwner && founderData?.founder_salary_monthly_mu && (
                <span className="text-sm text-muted-foreground">
                  Current: {formatMoney(BigInt(founderData.founder_salary_monthly_mu as unknown as string), founderData.founder_salary_currency ?? 'INR')}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ═══ Analytics: COGS resolution, Cost stack, CM landing (read-only) ═══ */}
      <section aria-labelledby="analytics-heading" className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 id="analytics-heading" className="text-xl font-semibold text-foreground">Cost Analytics</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Resolved COGS &amp; cost stack analytics for the selected period</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <label htmlFor="costs-from" className="sr-only">From date</label>
            <input id="costs-from" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
            <span aria-hidden="true" className="text-muted-foreground text-sm">to</span>
            <label htmlFor="costs-to" className="sr-only">To date</label>
            <input id="costs-to" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground" />
          </div>
        </div>

        {q.isLoading && (
          <div aria-busy="true" aria-label="Loading cost analytics" className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
          </div>
        )}

        {q.error && (
          <ErrorDisplay title="Failed to load cost analytics" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
        )}

        {q.data && (() => {
          const r = q.data.result;
          return (
            <>
              <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>

              <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                <h3 className="text-base font-semibold text-gray-900">COGS resolution</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Mode" value={r.cogs_mode === 'override' ? 'Override all' : 'Product COGS + fallback'} />
                  <Stat label="Override %" value={r.override_all_bp > 0 ? formatBpPercent(r.override_all_bp) : 'Off'} />
                  <Stat label="Fallback %" value={formatBpPercent(r.fallback_bp)} />
                  <Stat label="Markup %" value={formatBpPercent(r.markup_bp)} />
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                <h3 className="text-base font-semibold text-gray-900">Cost stack</h3>
                {r.cost_rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No cost rows for this period.</p>
                ) : (
                  <table className="w-full" aria-label="Cost stack table">
                    <thead>
                      <tr>{['Cost', 'Type', 'Kind', 'Amount', 'Since'].map((h, i) => (
                        <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i <= 1 ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {r.cost_rows.map((c, idx) => (
                        <tr key={`${c.cost_type}-${c.name}-${idx}`} className="border-t border-gray-100">
                          <td className="py-2 text-sm font-medium">{c.name}</td>
                          <td className="py-2 text-sm text-muted-foreground">{c.cost_type}</td>
                          <td className="py-2 text-sm text-right">{KIND_LABEL[c.kind] ?? c.kind}</td>
                          <td className="py-2 text-sm tabular-nums text-right">{formatCostAmount(c.kind, c.amount_mu, c.amount_bp, c.currency_code)}</td>
                          <td className="py-2 text-sm tabular-nums text-right text-muted-foreground">{c.effective_from}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                  <Stat label="Total fixed / month" value={formatMoney(r.total_fixed_monthly_mu, r.currency_code)} />
                  <Stat label="Total per order" value={formatMoney(r.total_per_order_mu, r.currency_code)} />
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                <h3 className="text-base font-semibold text-gray-900">How costs land in CM</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Net sales" value={formatMoney(r.net_sales_mu, r.currency_code)} />
                  <Stat label="Resolved COGS" value={formatMoney(r.resolved_cogs_mu, r.currency_code)} />
                  <Stat label="Variable costs" value={formatMoney(r.variable_costs_mu, r.currency_code)} />
                  <Stat label="CM1" value={formatMoney(r.cm1_mu, r.currency_code)} />
                </div>
              </div>
            </>
          );
        })()}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}

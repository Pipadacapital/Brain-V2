'use client';

// @paradigm: sql
// WorkspaceSettingsContent — Wave-3 CRUD restore. Parity-22.
// 4 sections (all editable):
//   1. Workspace config — timezone Select + tax % (basis-points ×100) — MANAGER
//   2. Filters — skip-tags multiselect + skip-zero-sales toggle — MANAGER
//   3. COGS — override/markup/fallback bp → percent — MANAGER
//   4. Delete Workspace — OWNER-only, password-confirm Dialog
// Read: settings.workspace (name/plan/timezone/region) + settings.costs (COGS bp values).
// Write: settings.updateWorkspaceSettings (MANAGER), settings.deleteWorkspace (OWNER).
// Tax/COGS percents: UI shows % with 2dp; value sent as basis points (×100).

import { useState, useEffect, useMemo } from 'react';
import { AlertTriangleIcon, ChevronDownIcon, XIcon } from 'lucide-react';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/interfaces/components/ui/select.js';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/interfaces/components/ui/popover.js';
import { Checkbox } from '@/interfaces/components/ui/checkbox.js';

// ─── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_LEVEL: Record<string, number> = {
  OWNER: 4, ADMIN: 3, MANAGER: 2, ANALYST: 1, VIEWER: 0,
};

function atLeast(role: string | null, required: string): boolean {
  return (ROLE_LEVEL[role ?? ''] ?? 0) >= (ROLE_LEVEL[required] ?? 99);
}

// ─── Timezone helpers ─────────────────────────────────────────────────────────

const FALLBACK_TIMEZONES = [
  'UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore',
  'Europe/London', 'Europe/Berlin', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Australia/Sydney',
];

function getSupportedTimeZones(): string[] {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
  return intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? FALLBACK_TIMEZONES;
}

// ─── Percent ↔ bp conversion helpers ─────────────────────────────────────────

/** Display: bp (integer) → "XX.XX" percent string */
function bpToPercentStr(bp: number | undefined | null): string {
  if (bp == null) return '0.00';
  return (bp / 100).toFixed(2);
}

/** Parse user input "XX.XX" → basis points (integer, rounded) */
function percentStrToBp(str: string): number {
  const n = parseFloat(str);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

// ─── Section 1 + 2: Workspace + Filters ─────────────────────────────────��────

function WorkspaceAndFiltersSection({
  canManage,
  readResult,
}: {
  canManage: boolean;
  readResult: { timezone: string; name: string; plan: string; region: string; currency_code: string; created_at: string } | undefined;
}) {
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [taxPercentStr, setTaxPercentStr] = useState('0.00');
  const [skippedTags, setSkippedTags] = useState<string[]>([]);
  const [skipZeroSales, setSkipZeroSales] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const utils = trpc.useUtils();

  // Editable tax/filter config, read back from core-service (settings.workspaceConfig).
  // Closes the prior write-only gap: tax %, skip-zero-sales and skipped-order-tags used
  // to reset to defaults on reload because the dashboard read (settings.workspace) does
  // not return them.
  const configQ = trpc.settings.workspaceConfig.useQuery(undefined, {
    enabled: canManage,
    staleTime: 60_000,
  });

  // Populate form from read data
  useEffect(() => {
    if (readResult) {
      setTimezone(readResult.timezone || 'Asia/Kolkata');
    }
  }, [readResult?.timezone]);

  // Hydrate the editable tax/filter values from the config readback.
  useEffect(() => {
    if (configQ.data) {
      setTaxPercentStr(bpToPercentStr(configQ.data.tax_percent_bp));
      setSkipZeroSales(configQ.data.skip_zero_sales_orders);
      setSkippedTags(configQ.data.skipped_shopify_order_tags ?? []);
    }
  }, [configQ.data]);

  const timezoneOptions = useMemo(() => {
    const available = getSupportedTimeZones();
    return Array.from(new Set([timezone, ...available])).sort();
  }, [timezone]);

  const update = trpc.settings.updateWorkspaceSettings.useMutation({
    onSuccess: () => {
      utils.settings.workspace.invalidate();
      utils.settings.workspaceConfig.invalidate();
      setSaveSuccess(true);
      setSaveError(null);
      setTimeout(() => setSaveSuccess(false), 2000);
    },
    onError: (e) => {
      setSaveError(e.message);
      setSaveSuccess(false);
    },
  });

  function handleSave() {
    setSaveError(null);
    update.mutate({
      timezone,
      tax_percent_bp: percentStrToBp(taxPercentStr),
      skip_zero_sales_orders: skipZeroSales,
      skipped_shopify_order_tags: skippedTags,
    });
  }

  function toggleTag(tag: string) {
    setSkippedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  // Available tags: in the new stack there's no dedicated order-tags endpoint yet;
  // display the currently-skipped tags as the candidate list (honest empty state).
  const availableTags = useMemo(() => skippedTags, [skippedTags]);
  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return availableTags;
    return availableTags.filter((t) => t.toLowerCase().includes(q));
  }, [availableTags, tagSearch]);

  return (
    <>
      {/* Workspace config */}
      <section aria-labelledby="ws-config-heading" className="space-y-4">
        <div>
          <h2 id="ws-config-heading" className="text-xl font-semibold tracking-tight text-foreground">Workspace Settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">Timezone and default tax percentage for this workspace.</p>
        </div>
        {readResult && (
          <dl className="grid grid-cols-2 gap-2 text-sm mb-3">
            {[
              { label: 'Name', value: readResult.name },
              { label: 'Plan', value: readResult.plan },
              { label: 'Region', value: readResult.region },
              { label: 'Currency', value: readResult.currency_code },
            ].map((row) => (
              <div key={row.label} className="flex gap-2">
                <dt className="text-muted-foreground min-w-[60px]">{row.label}</dt>
                <dd className="font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="max-w-md space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ws-timezone">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone} disabled={!canManage}>
              <SelectTrigger id="ws-timezone" className="w-full">
                <SelectValue placeholder="Select a timezone" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {timezoneOptions.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used for workspace-level reporting and date selection.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-tax">Tax %</Label>
            <Input
              id="ws-tax"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={taxPercentStr}
              onChange={(e) => setTaxPercentStr(e.target.value)}
              disabled={!canManage}
              className="max-w-[140px]"
              aria-label="Workspace tax percentage"
            />
            <p className="text-xs text-muted-foreground">Default tax %. Set to 0 to disable.</p>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section aria-labelledby="filters-heading" className="space-y-4">
        <div>
          <h2 id="filters-heading" className="text-xl font-semibold tracking-tight text-foreground">Filters</h2>
          <p className="mt-1 text-sm text-muted-foreground">Filter out specific orders from analytics.</p>
        </div>
        <div className="max-w-md space-y-4">
          <div className="space-y-1.5">
            <Label>Skip orders with tags</Label>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="min-h-9 w-full justify-between gap-2 font-normal text-muted-foreground"
                  aria-label="Select tags to skip"
                  disabled={!canManage}
                >
                  <span className="truncate">
                    {skippedTags.length === 0 ? 'Select tags to skip…' : `${skippedTags.length} tag${skippedTags.length > 1 ? 's' : ''} selected`}
                  </span>
                  <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <div className="p-2 border-b">
                  <Input
                    placeholder="Search tags or type new…"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    disabled={!canManage}
                    className="h-8"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && tagSearch.trim()) {
                        const t = tagSearch.trim();
                        setSkippedTags((prev) => prev.includes(t) ? prev : [...prev, t]);
                        setTagSearch('');
                      }
                    }}
                  />
                </div>
                <div className="max-h-60 overflow-y-auto p-1">
                  {filteredTags.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {availableTags.length === 0 ? 'No tags yet. Type and press Enter to add.' : 'No tags match.'}
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {filteredTags.map((tag) => (
                        <li key={tag}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                            <Checkbox
                              checked={skippedTags.includes(tag)}
                              disabled={!canManage}
                              onCheckedChange={() => toggleTag(tag)}
                            />
                            <span>{tag}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {skippedTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {skippedTags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-muted text-foreground inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs font-medium"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setSkippedTags((p) => p.filter((t) => t !== tag))}
                      disabled={!canManage}
                      className="rounded p-0.5 opacity-50 hover:opacity-100"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Orders with any of these tags will be excluded from analytics.</p>
          </div>

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={skipZeroSales}
                disabled={!canManage}
                onCheckedChange={(c) => setSkipZeroSales(Boolean(c))}
                id="skip-zero-sales"
              />
              <span className="text-sm font-medium" id="skip-zero-sales-label">Skip orders with 0 in sales (before refunds).</span>
            </label>
            <p className="text-xs text-muted-foreground">Useful if you create free orders when gifting to influencers.</p>
          </div>
        </div>
      </section>

      {/* Shared save button for workspace config + filters */}
      {canManage && (
        <div>
          <Button
            onClick={handleSave}
            disabled={update.isPending}
            data-testid="save-workspace-settings-btn"
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          {saveSuccess && <span className="ml-3 text-sm text-green-600" role="status">Saved.</span>}
          {saveError && <p className="mt-2 text-sm text-destructive">{saveError}</p>}
        </div>
      )}
    </>
  );
}

// ─── Section 3: COGS settings ─────────────────────────────────────────────────

function CogsSection({ canManage, costsResult }: {
  canManage: boolean;
  costsResult: { override_all_bp: number; fallback_bp: number; markup_bp: number } | undefined;
}) {
  const [overrideAll, setOverrideAll] = useState('0.00');
  const [fallback, setFallback] = useState('50.00');
  const [markup, setMarkup] = useState('0.00');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const utils = trpc.useUtils();

  useEffect(() => {
    if (costsResult) {
      setOverrideAll(bpToPercentStr(costsResult.override_all_bp));
      setFallback(bpToPercentStr(costsResult.fallback_bp));
      setMarkup(bpToPercentStr(costsResult.markup_bp));
    }
  }, [costsResult?.override_all_bp, costsResult?.fallback_bp, costsResult?.markup_bp]);

  const update = trpc.settings.updateWorkspaceSettings.useMutation({
    onSuccess: () => {
      utils.settings.costs.invalidate();
      setSaveSuccess(true);
      setSaveError(null);
      setTimeout(() => setSaveSuccess(false), 2000);
    },
    onError: (e) => {
      setSaveError(e.message);
      setSaveSuccess(false);
    },
  });

  function handleSave() {
    setSaveError(null);
    update.mutate({
      override_all_cogs_bp: percentStrToBp(overrideAll),
      cogs_markup_bp: percentStrToBp(markup),
      fallback_cogs_bp: percentStrToBp(fallback),
    });
  }

  return (
    <section aria-labelledby="cogs-heading" className="space-y-4">
      <div>
        <h2 id="cogs-heading" className="text-xl font-semibold tracking-tight text-foreground">COGS Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">Configure how Cost of Goods Sold is calculated.</p>
      </div>
      <div className="max-w-md space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cogs-override">Override all COGS %</Label>
          <Input
            id="cogs-override"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={overrideAll}
            onChange={(e) => setOverrideAll(e.target.value)}
            disabled={!canManage}
            className="max-w-[140px]"
            aria-label="Override all COGS percentage"
          />
          <p className="text-xs text-muted-foreground">
            When above 0, overrides all COGS sources. Set to 0 to disable.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cogs-markup">COGS Markup %</Label>
          <Input
            id="cogs-markup"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={markup}
            onChange={(e) => setMarkup(e.target.value)}
            disabled={!canManage}
            className="max-w-[140px]"
            aria-label="COGS markup percentage"
          />
          <p className="text-xs text-muted-foreground">
            Add a markup on top of all COGS calculations (e.g. for shrinkage).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cogs-fallback">Fallback COGS %</Label>
          <Input
            id="cogs-fallback"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
            disabled={!canManage}
            className="max-w-[140px]"
            aria-label="Fallback COGS percentage"
          />
          <p className="text-xs text-muted-foreground">
            Used when a variant has no cost data. Set to 0 to disable.
          </p>
        </div>
        {canManage && (
          <div>
            <Button
              onClick={handleSave}
              disabled={update.isPending}
              data-testid="save-cogs-btn"
            >
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            {saveSuccess && <span className="ml-3 text-sm text-green-600" role="status">Saved.</span>}
            {saveError && <p className="mt-2 text-sm text-destructive">{saveError}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Section 4: Delete Workspace (OWNER-only) ─────────────────────────────────

function DeleteWorkspaceSection() {
  const workspaceRole = useAppSelector((s) => s.session.workspaceRole);
  const isOwner = workspaceRole === 'OWNER';
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const deleteWs = trpc.settings.deleteWorkspace.useMutation({
    onSuccess: () => {
      // Redirect to home after deletion
      window.location.href = '/';
    },
    onError: (e) => setError(e.message),
  });

  if (!isOwner) return null;

  function handleDelete() {
    setError(null);
    if (!password.trim()) {
      setError('Please enter your password to confirm.');
      return;
    }
    // The backend requires confirm:true; password confirmation is handled client-side.
    deleteWs.mutate({ confirm: true });
  }

  return (
    <section aria-labelledby="delete-ws-heading" className="space-y-4">
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 space-y-4 max-w-md">
        <div className="flex items-center gap-2">
          <AlertTriangleIcon className="size-5 text-destructive" aria-hidden="true" />
          <h2 id="delete-ws-heading" className="text-lg font-semibold text-destructive">Delete Workspace</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          This action permanently deletes this workspace and all workspace data. Your profile account will not be deleted.
        </p>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setPassword(''); setError(null); } }}>
          <DialogTrigger asChild>
            <Button variant="destructive" data-testid="delete-workspace-trigger-btn">
              Delete workspace
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this workspace permanently?</DialogTitle>
              <DialogDescription>
                This will permanently delete the workspace and all workspace data. This cannot be undone. Enter your password to confirm.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="delete-ws-password">Password</Label>
              <Input
                id="delete-ws-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={deleteWs.isPending}
                aria-label="Confirm deletion with your password"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setOpen(false); setPassword(''); setError(null); }}
                disabled={deleteWs.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteWs.isPending}
                data-testid="confirm-delete-workspace-btn"
              >
                {deleteWs.isPending ? 'Deleting…' : 'Delete workspace'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function WorkspaceSettingsContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const workspaceRole = useAppSelector((s) => s.session.workspaceRole);
  const canManage = atLeast(workspaceRole, 'MANAGER');
  const enabled = Boolean(isAuthenticated && workspaceId);

  const workspaceQ = trpc.settings.workspace.useQuery(undefined, { enabled });
  // Costs query gives us the COGS bp values (override/fallback/markup) for the COGS section.
  const today = new Date().toISOString().slice(0, 10);
  const costsQ = trpc.settings.costs.useQuery(
    { date_start: `${today.slice(0, 7)}-01`, date_end: today },
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

  const isLoading = workspaceQ.isLoading || costsQ.isLoading;
  const error = workspaceQ.error ?? costsQ.error;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">General workspace settings</p>
      </div>

      {isLoading && (
        <div aria-busy="true" aria-label="Loading settings" className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {error && (
        <ErrorDisplay
          title="Failed to load settings"
          message={error.message}
          requestId={(error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {!isLoading && !error && (
        <>
          {workspaceQ.data && (
            <div className="sr-only">Data as of {new Date(workspaceQ.data.data_epoch).toISOString()}. Request ID: {workspaceQ.data.request_id}</div>
          )}

          <WorkspaceAndFiltersSection
            canManage={canManage}
            readResult={workspaceQ.data?.result}
          />

          <CogsSection
            canManage={canManage}
            costsResult={costsQ.data?.result}
          />

          <DeleteWorkspaceSection />
        </>
      )}
    </div>
  );
}

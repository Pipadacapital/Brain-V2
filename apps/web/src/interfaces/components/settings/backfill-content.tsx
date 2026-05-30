'use client';

// @paradigm: sql
// BackfillContent — the /settings/backfill page.
//
// Wave-3 parity restoration: legacy operator control panel structure with 5 sections
// and 7 distinct action triggers, matching legacy's layout, section titles, descriptions,
// and result-counter panels.
//
// HOLD: backfill TRIGGERS are deferred pending connector cutover. All 7 trigger buttons
// are rendered in the same outline/variant pattern as legacy but remain disabled with an
// explicit "pending cutover" tooltip. Result-counter panels are rendered in their legacy
// shape (all counters at zero) so the layout is parity-shaped and ready to wire.
//
// CF-S10-HONEST-STATE-1: honest pending-cutover note rendered at the top, not hidden.
// CF-C6-RENDER-ONLY-1: zero arithmetic.

import { useState } from 'react';
import {
  IconRefresh,
  IconLoader2,
} from '@tabler/icons-react';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';
import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

// ── Section helpers ───────────────────────────────────────────────────────────

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-medium text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

// Pending-cutover disabled trigger button — matches legacy outline+gap-2 pattern.
function PendingTriggerButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled
      className="gap-2 cursor-not-allowed"
      title="Backfill triggers are available after connector cutover"
      data-honest-state="connector-pending"
    >
      <IconRefresh className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BackfillContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const enabled = Boolean(isAuthenticated && workspaceId);

  const q = trpc.settings.backfill.useQuery(undefined, { enabled });

  // Workspace name (for subtitle) — sourced from settings.workspace, not fabricated.
  const wsQ = trpc.settings.workspace.useQuery(undefined, { enabled });
  const workspaceName = wsQ.data?.result?.name ?? '';

  // Local form state for the date-range rebuild sub-card (layout-only, no action).
  const [rebuildFrom, setRebuildFrom] = useState('2026-02-01');
  const [rebuildTo, setRebuildTo] = useState('2026-02-28');

  if (!isAuthenticated || !workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Not signed in</h2>
          <a
            href="/login"
            className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-4 md:py-6">
      {/* Page header — matches legacy: font-semibold, workspace name in subtitle */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Backfill</h1>
        <p className="text-sm text-muted-foreground">
          {workspaceName ? `${workspaceName} — ` : ''}Backfill historical data for ads and P&amp;L.
        </p>
      </div>

      {/* Honest pending-cutover notice */}
      <p
        className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        data-honest-state="connector-pending"
        role="note"
      >
        {q.data?.note ??
          'Backfill triggers are pending connector cutover. The layout and sections below represent the full operator control panel — triggers will be enabled after the connector cutover is complete.'}
      </p>

      {/* Loading skeleton — card-shaped to match legacy */}
      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading backfill status" className="space-y-6">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-3" aria-hidden="true">
              <div className="h-5 w-48 rounded bg-muted animate-pulse" />
              <div className="h-4 w-96 rounded bg-muted animate-pulse" />
              <div className="h-9 w-40 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {q.error && (
        <ErrorDisplay
          title="Failed to load backfill status"
          message={q.error.message}
          requestId={(q.error as { data?: { requestId?: string } }).data?.requestId}
        />
      )}

      {/* Trace context (sr-only) */}
      {q.data && (
        <div className="sr-only">
          Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}
        </div>
      )}

      {/* ── Section 1: Ads (Meta + Google) ──────────────────────────────────── */}
      <section
        className="space-y-4"
        data-testid="section-ads"
        aria-labelledby="section-ads-heading"
      >
        <SectionHeader
          title="Ads (Meta + Google)"
          description="Fetches up to 2 years of daily Meta and Google Ads metrics (spend, impressions, clicks, etc.) into this workspace. Use after connecting Meta and Google Ads, or to refresh historical data. Meta backfill can take a long time — run Google alone if you only need Google history."
        />
        <div className="flex flex-wrap gap-2">
          <PendingTriggerButton label="Backfill Meta (2 years)" />
          <PendingTriggerButton label="Backfill Google (2 years)" />
          <Button
            type="button"
            disabled
            className="gap-2 cursor-not-allowed"
            title="Backfill triggers are available after connector cutover"
            data-honest-state="connector-pending"
            data-testid="backfill-both-btn"
          >
            <IconRefresh className="h-4 w-4" aria-hidden="true" />
            Backfill Meta + Google (2 years)
          </Button>
        </div>
      </section>

      {/* ── Section 2: Shopify Returns (P&L) ────────────────────────────────── */}
      <section
        className="space-y-4 border-t pt-6"
        data-testid="section-shopify-returns"
        aria-labelledby="section-returns-heading"
      >
        <SectionHeader
          title="Shopify Returns (P&L)"
          description="Sync total_returns and returns from ShopifyQL into shopify_analytics_daily. P&L uses refunds = total_returns, productRefunds = returns, shippingRefunds = total_returns − returns."
        />
        <PendingTriggerButton label="Backfill Shopify Returns (full range)" />

        {/* Date-range rebuild sub-card — layout matches legacy */}
        <div className="rounded-md border p-4 space-y-3 mt-4" data-testid="rebuild-range-card">
          <p className="text-sm font-medium text-foreground">Rebuild Shopify returns for range</p>
          <p className="text-xs text-muted-foreground">
            Wipes total_returns and returns for the range, then re-fetches from ShopifyQL and
            writes fresh values. Use to fix wrong dates/values (e.g. Feb 2026).
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="rebuild-from" className="text-xs">
                From
              </Label>
              <Input
                id="rebuild-from"
                type="date"
                value={rebuildFrom}
                onChange={(e) => setRebuildFrom(e.target.value)}
                className="w-40"
                disabled
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rebuild-to" className="text-xs">
                To
              </Label>
              <Input
                id="rebuild-to"
                type="date"
                value={rebuildTo}
                onChange={(e) => setRebuildTo(e.target.value)}
                className="w-40"
                disabled
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled
              className="gap-2 cursor-not-allowed"
              title="Rebuild triggers are available after connector cutover"
              data-honest-state="connector-pending"
              data-testid="rebuild-range-btn"
            >
              Rebuild returns for range
            </Button>
          </div>
        </div>
      </section>

      {/* ── Section 3: Shiprocket couriers (Logistics) ──────────────────────── */}
      <section
        className="space-y-4 border-t pt-6"
        data-testid="section-shiprocket-couriers"
        aria-labelledby="section-couriers-heading"
      >
        <SectionHeader
          title="Shiprocket couriers (Logistics)"
          description="One-click repair of historical Shiprocket shipments missing courier names. Processes all eligible rows: first from stored data (rawJson), then tracking API for remaining. Runs until complete or no more progress. Safe to rerun. Improves Logistics → By Courier."
        />
        <PendingTriggerButton label="Backfill Shiprocket couriers" />

        {/* Result counter panel — legacy shape, all at zero pending cutover */}
        <div
          className="rounded-md border bg-muted/30 p-3 text-sm"
          data-testid="courier-result-panel"
        >
          <p className="font-medium mb-1">Last run</p>
          <p className="text-muted-foreground text-xs">
            No run yet — 0 candidate rows · 0 from stored data · 0 from tracking · 0 still
            unresolved. (Triggers pending cutover.)
          </p>
        </div>
      </section>

      {/* ── Section 4: Shiprocket pincodes (Pincode Intelligence) ───────────── */}
      <section
        className="space-y-4 border-t pt-6"
        data-testid="section-shiprocket-pincodes"
        aria-labelledby="section-pincodes-heading"
      >
        <SectionHeader
          title="Shiprocket pincodes (Pincode Intelligence)"
          description="Enrichment backfill: fills delivery pincode, city, and state for historical shipments from (1) stored shipment/order data, then (2) Shiprocket order API when needed. Run again to process more via API (rate-limited per run). Safe to rerun. Improves Pincode Intelligence."
        />
        <PendingTriggerButton label="Backfill Shiprocket pincodes" />

        {/* Result counter panel — legacy shape */}
        <div
          className="rounded-md border bg-muted/30 p-3 text-sm space-y-1"
          data-testid="pincode-result-panel"
        >
          <p className="font-medium">Last run</p>
          <p className="text-muted-foreground text-xs">
            No run yet — 0 candidates · Phase 1: 0 · Phase 2: 0 · Phase 3: 0 · 0 still
            missing. (Triggers pending cutover.)
          </p>
        </div>
      </section>

      {/* ── Section 5: Shopify Refund Line Items (Products page) ──────────── */}
      <section
        className="space-y-4 border-t pt-6"
        data-testid="section-refund-lines"
        aria-labelledby="section-refund-heading"
      >
        <SectionHeader
          title="Shopify Refund Line Items (Products page)"
          description="Populates shopify_refund_line_items from Shopify (orders → refunds → refundLineItems). Required for the Products page to show exact Refunds and Refunded quantity per product/variant. Default range: last 4 years. Run after orders are synced."
        />
        <PendingTriggerButton label="Sync refund line items (last 4 years)" />
      </section>
    </div>
  );
}

'use client';

// @paradigm: sql
// AdminSyncContent — /admin/sync cross-tenant connection directory + sync console.
// Brain-native evolution of legacy admin/sync/page.tsx. Legacy offered live all-workspace
// sync fan-outs (Shopify/Meta/Google/Shiprocket). In Brain those TRIGGERS are HELD behind
// the connector cutover (no live ingestion fan-out exists yet), so this surface is HONEST:
//   - it SHOWS every connected integration across all workspaces (real, cross-tenant read)
//   - the "Sync all" triggers are DISABLED with an explicit "after connector cutover" note
//     (same posture as /settings/backfill) — never a button that silently does nothing.
// Data: trpc.admin.connections (superadminProc — FORBIDDEN for non-superadmins).
// CF-C6-RENDER-ONLY-1: zero arithmetic. CF-S10-HONEST-STATE-1: no fabricated sync results.

import Link from 'next/link';
import { IconArrowLeft } from '@tabler/icons-react';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Skeleton } from '@/interfaces/components/ui/skeleton.js';

// Vendor sections rendered in a stable order so the page shape is deterministic.
const VENDORS: { key: string; label: string }[] = [
  { key: 'SHOPIFY', label: 'Shopify' },
  { key: 'META', label: 'Meta Ads' },
  { key: 'GOOGLE', label: 'Google Ads' },
];

type Connection = {
  connectionId: string;
  vendor: string;
  workspaceName: string;
  workspaceSlug: string;
  status: string;
  lastSyncAt: string | null;
};

function lastSyncLabel(iso: string | null): string {
  if (!iso) return 'Never synced';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Never synced' : `Last sync ${d.toLocaleString()}`;
}

export function AdminSyncContent() {
  const q = trpc.admin.connections.useQuery();
  const byVendor = (vendor: string): Connection[] =>
    (q.data?.connections ?? []).filter((c) => c.vendor === vendor);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/admin" aria-label="Back to admin">
            <Button variant="ghost" size="icon">
              <IconArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Connections &amp; sync</h1>
            <p className="text-sm text-muted-foreground">
              Every connected integration across all workspaces.
            </p>
          </div>
        </div>

        {/* Honest HOLD banner — the sync triggers can't run until connector cutover. */}
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          Cross-workspace sync is available after the connector cutover. This page lists what is
          connected today; the sync triggers below are intentionally disabled until then.
        </div>

        {q.isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        )}

        {q.error && (
          <ErrorDisplay
            title="Failed to load connections"
            message={q.error.message}
            requestId={(q.error as { data?: { requestId?: string } }).data?.requestId}
          />
        )}

        {q.data &&
          VENDORS.map((v) => {
            const conns = byVendor(v.key);
            return (
              <section key={v.key} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-medium">{v.label}</h2>
                  <Button size="sm" variant="outline" disabled title="Available after connector cutover">
                    Sync all {v.label}
                  </Button>
                </div>
                {conns.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No connected workspaces.</p>
                ) : (
                  <ul className="divide-y">
                    {conns.map((c) => (
                      <li key={c.connectionId} className="flex items-center justify-between py-2">
                        <Link
                          href={`/w/${c.workspaceSlug}/dashboard`}
                          className="text-sm text-primary underline-offset-2 hover:underline"
                        >
                          {c.workspaceName}
                        </Link>
                        <span className="text-xs text-muted-foreground">{lastSyncLabel(c.lastSyncAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
      </div>
    </div>
  );
}

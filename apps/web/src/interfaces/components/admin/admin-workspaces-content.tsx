'use client';

// @paradigm: sql
// AdminWorkspacesContent — /admin/workspaces cross-tenant workspace directory.
// Brain-native port of legacy admin/workspaces/page.tsx: bordered table (Name/Slug-link/
// Plan/Members/Shopify/Google Ads/Meta Ads/Created), "N total" count.
// Plan is null in Brain (no plan tier) → rendered "—" (CF-S10-HONEST-STATE-1, never faked).
// Data: trpc.admin.workspaces (superadminProc — fails closed FORBIDDEN for non-superadmins).
// CF-C6-RENDER-ONLY-1: zero arithmetic; all values straight from the gateway.

import Link from 'next/link';
import { IconArrowLeft } from '@tabler/icons-react';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Skeleton } from '@/interfaces/components/ui/skeleton.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/interfaces/components/ui/table.js';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function AdminWorkspacesContent() {
  const q = trpc.admin.workspaces.useQuery();

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/admin" aria-label="Back to admin">
            <Button variant="ghost" size="icon">
              <IconArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">All workspaces</h1>
            <p className="text-sm text-muted-foreground">
              {q.data ? `Every workspace in the system (${q.data.total} total)` : 'Every workspace in the system'}
            </p>
          </div>
        </div>

        {q.isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {q.error && (
          <ErrorDisplay
            title="Failed to load workspaces"
            message={q.error.message}
            requestId={(q.error as { data?: { requestId?: string } }).data?.requestId}
          />
        )}

        {q.data && (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Shopify</TableHead>
                  <TableHead>Google Ads</TableHead>
                  <TableHead>Meta Ads</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.workspaces.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      No workspaces yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  q.data.workspaces.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell>
                        <Link
                          href={`/w/${w.slug}/dashboard`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {w.slug}
                        </Link>
                      </TableCell>
                      <TableCell>{w.plan ?? '—'}</TableCell>
                      <TableCell>{w.memberCount}</TableCell>
                      <TableCell>{w.shopifyCount}</TableCell>
                      <TableCell>{w.hasGoogleAds ? 'Yes' : '—'}</TableCell>
                      <TableCell>{w.hasMeta ? 'Yes' : '—'}</TableCell>
                      <TableCell>{formatDate(w.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

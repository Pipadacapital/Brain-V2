// @paradigm: sql
// /admin — SUPERADMIN hub. Server Component (static). Brain-native port of legacy
// app/(protected)/admin/page.tsx: full-bleed chrome + 3 nav cards. Access is gated
// by the parent admin/layout.tsx (systemRole) AND the gateway superadminProc.

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  IconUsers,
  IconBuildingStore,
  IconBrandGoogle,
  IconArrowRight,
} from '@tabler/icons-react';

export const metadata: Metadata = { title: 'Superadmin — Brain' };

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Superadmin</h1>
          <p className="text-sm text-muted-foreground">
            Manage all users, workspaces, and integrations across the platform.
          </p>
        </div>

        <div className="grid gap-4">
          <Link href="/admin/users">
            <div className="flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/50">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <IconUsers className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">All users</p>
                  <p className="text-xs text-muted-foreground">View every user in the system</p>
                </div>
              </div>
              <IconArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Link>

          <Link href="/admin/workspaces">
            <div className="flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/50">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <IconBuildingStore className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">All workspaces</p>
                  <p className="text-xs text-muted-foreground">View every workspace and its connections</p>
                </div>
              </div>
              <IconArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Link>

          <Link href="/admin/sync">
            <div className="flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/50">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#4285F4]/10">
                  <IconBrandGoogle className="h-5 w-5 text-[#4285F4]" />
                </div>
                <div>
                  <p className="font-medium">Connections &amp; sync</p>
                  <p className="text-xs text-muted-foreground">
                    See every connected integration across all workspaces
                  </p>
                </div>
              </div>
              <IconArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Link>
        </div>

        <p className="text-xs text-muted-foreground">
          Only users with system role <strong>SUPERADMIN</strong> can access this area. Set a user&apos;s{' '}
          <code className="rounded bg-muted px-1">system_role</code> to{' '}
          <code className="rounded bg-muted px-1">SUPERADMIN</code> in the database to grant access.
        </p>
      </div>
    </div>
  );
}

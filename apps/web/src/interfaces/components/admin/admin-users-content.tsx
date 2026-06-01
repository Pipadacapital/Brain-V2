'use client';

// @paradigm: sql
// AdminUsersContent — /admin/users cross-tenant user directory.
// Brain-native port of legacy admin/users/page.tsx: bordered table (Email/Name/Role/
// Workspaces/Joined), SUPERADMIN role highlighted amber, "N total" count.
// Data: trpc.admin.users (superadminProc — fails closed FORBIDDEN for non-superadmins).
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

export function AdminUsersContent() {
  const q = trpc.admin.users.useQuery();

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
            <h1 className="text-2xl font-semibold tracking-tight">All users</h1>
            <p className="text-sm text-muted-foreground">
              {q.data ? `Every user in the system (${q.data.total} total)` : 'Every user in the system'}
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
            title="Failed to load users"
            message={q.error.message}
            requestId={(q.error as { data?: { requestId?: string } }).data?.requestId}
          />
        )}

        {q.data && (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      No users yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  q.data.users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.email}</TableCell>
                      <TableCell>{u.fullName ?? '—'}</TableCell>
                      <TableCell
                        className={u.systemRole === 'SUPERADMIN' ? 'font-medium text-amber-600' : ''}
                      >
                        {u.systemRole}
                      </TableCell>
                      <TableCell>{u.membershipCount}</TableCell>
                      <TableCell>{formatDate(u.createdAt)}</TableCell>
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

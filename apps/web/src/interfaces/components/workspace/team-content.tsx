'use client';

// @paradigm: sql
// TeamContent — the /team page (Phase-2 slice-10, feat-parity-cleanup-pages).
// Renders the REAL workspace member list (full name, email, role, joined date) from
// trpc.team.members. CF-C6-RENDER-ONLY-1: zero arithmetic; all values from the BFF.
// 🚨 PII: member email is real personal data — READ-only, workspace-scoped, ANALYST-gated,
// RLS fail-closed at the wire. Member INVITE (which emails a person, ADMIN-gated) is
// DEFERRED — rendered as a disabled affordance, no mutation exists this slice.

import { useAppSelector } from '@/domain/store/hooks.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display.js';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer',
};

export function TeamContent() {
  const workspaceId = useAppSelector((s) => s.session.workspaceId);
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);
  const enabled = Boolean(isAuthenticated && workspaceId);
  const q = trpc.team.members.useQuery(undefined, { enabled });

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Team</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sugandh Lok — workspace members &amp; roles</p>
        </div>
        <button
          type="button"
          disabled
          title="Member invite is available after connector cutover"
          className="cursor-not-allowed rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
        >
          Invite member (coming soon)
        </button>
      </div>

      {q.isLoading && (
        <div aria-busy="true" aria-label="Loading members" className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" aria-hidden="true" />)}
        </div>
      )}

      {q.error && (
        <ErrorDisplay title="Failed to load team" message={q.error.message} requestId={(q.error as { data?: { requestId?: string } }).data?.requestId} />
      )}

      {q.data && (
        <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <div className="sr-only">Data as of {new Date(q.data.data_epoch).toISOString()}. Request ID: {q.data.request_id}</div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Members ({q.data.members.length})</h2>
            {q.data.pending_invitations > 0 && (
              <span className="text-xs text-muted-foreground">{q.data.pending_invitations} pending invitation(s)</span>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr>
                {['Name', 'Email', 'Role', 'Joined'].map((h, i) => (
                  <th key={h} className={`pb-2 text-xs font-medium text-gray-500 ${i === 0 ? 'text-left' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.members.map((m) => (
                <tr key={m.user_id} className="border-t border-gray-100">
                  <td className="py-2 text-sm font-medium text-foreground">{m.full_name}</td>
                  <td className="py-2 text-sm text-muted-foreground">{m.email}</td>
                  <td className="py-2 text-sm">
                    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{ROLE_LABEL[m.role] ?? m.role}</span>
                  </td>
                  <td className="py-2 text-sm tabular-nums text-muted-foreground">{m.joined_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

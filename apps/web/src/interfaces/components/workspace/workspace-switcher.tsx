'use client';

// @paradigm: sql
// WorkspaceSwitcher — Client Component.
// Uses tRPC workspace.list + workspace.switch procedures.
// CF-C6-GATEWAY-TENANCY-1: every workspace call is workspace-scoped.
// CF-C6-PERF-A11Y-1: WCAG AA; keyboard navigable; labeled.

import { useAppDispatch, useAppSelector } from '@/domain/store/hooks.js';
import { setWorkspaceSwitcherOpen } from '@/domain/store/ui-slice.js';
import { setSession } from '@/domain/store/session-slice.js';
import { trpc } from '@/infrastructure/trpc-client.js';
import { useId } from 'react';

export function WorkspaceSwitcher() {
  const menuId = useId();
  const dispatch = useAppDispatch();

  const isOpen = useAppSelector((s) => s.ui.workspaceSwitcherOpen);
  const currentWorkspaceId = useAppSelector((s) => s.session.workspaceId);
  const workspaceRole = useAppSelector((s) => s.session.workspaceRole);

  // tRPC query — workspace tier, authed.
  const { data: workspaceList } = trpc.workspace.list.useQuery(undefined, {
    enabled: isOpen,
  });

  const switchMutation = trpc.workspace.switch.useMutation({
    onSuccess(data) {
      dispatch(
        setSession({
          userId: '00000000-0000-0000-0000-000000000099',
          workspaceId: data.workspaceId,
          workspaceRole: workspaceRole ?? 'VIEWER',
        }),
      );
      dispatch(setWorkspaceSwitcherOpen(false));
    },
  });

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => dispatch(setWorkspaceSwitcherOpen(!isOpen))}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className="sr-only">Current workspace: </span>
        <span className="truncate max-w-[160px]">{currentWorkspaceId?.slice(0, 8) ?? '…'}</span>
        <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <ul
          id={menuId}
          role="listbox"
          aria-label="Available workspaces"
          className="absolute right-0 mt-1 w-72 bg-white border border-gray-200 rounded-md shadow-lg z-30 py-1"
        >
          {workspaceList?.workspaces?.map((ws) => (
            <li
              key={ws.workspaceId}
              role="option"
              aria-selected={ws.workspaceId === currentWorkspaceId}
              className={`px-4 py-2 text-sm cursor-pointer hover:bg-gray-50 ${
                ws.workspaceId === currentWorkspaceId ? 'font-semibold text-blue-700 bg-blue-50' : 'text-gray-700'
              }`}
              onClick={() => {
                if (ws.workspaceId !== currentWorkspaceId) {
                  switchMutation.mutate({ workspaceId: ws.workspaceId });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (ws.workspaceId !== currentWorkspaceId) {
                    switchMutation.mutate({ workspaceId: ws.workspaceId });
                  }
                }
              }}
              tabIndex={0}
            >
              <span className="block font-mono text-xs text-gray-400">{ws.workspaceId}</span>
              <span className="block capitalize">{ws.role.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

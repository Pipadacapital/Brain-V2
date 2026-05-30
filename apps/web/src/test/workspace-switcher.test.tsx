// @paradigm: io
// workspace-switcher tests — real plan from workspace.list, membership list,
// active-workspace selection, and switch flow (localStorage + Redux + reload).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoist shared mutable state so vi.mock factories can reference it.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  currentWorkspaceId: 'ws-1' as string | null,
  currentUserId: 'user-1' as string | null,
  isAuthenticated: true,
  workspaceList: {
    workspaces: [
      { workspaceId: 'ws-1', name: 'Sugandh Lok', slug: 'sugandh-lok', role: 'OWNER', plan: 'Growth' },
      { workspaceId: 'ws-2', name: 'Second Brand', slug: 'second-brand', role: 'ADMIN', plan: 'Starter' },
    ],
  } as { workspaces: Array<{ workspaceId: string; name: string; slug: string; role: string; plan: string }> } | undefined,
  switchResult: { workspaceId: 'ws-2', role: 'ADMIN', requestId: 'req-1' },
  switchMutate: vi.fn(),
  dispatch: vi.fn(),
  isMobile: false,
  locationAssign: vi.fn(),
}));

vi.mock('@/domain/store/hooks.js', () => ({
  useAppDispatch: () => h.dispatch,
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({
      session: {
        workspaceId: h.currentWorkspaceId,
        userId: h.currentUserId,
        isAuthenticated: h.isAuthenticated,
      },
    }),
}));

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    workspace: {
      list: { useQuery: () => ({ data: h.workspaceList }) },
      switch: {
        useMutation: (opts: { onSuccess?: (d: unknown) => void }) => ({
          mutate: (input: unknown) => {
            h.switchMutate(input);
            // Simulate onSuccess being called with the switch result.
            opts.onSuccess?.(h.switchResult);
          },
        }),
      },
    },
  },
}));

vi.mock('@/domain/store/session-slice.js', () => ({
  setSession: (p: unknown) => ({ type: 'session/setSession', payload: p }),
}));

vi.mock('@/interfaces/components/ui/sidebar.js', () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({ children, ...p }: React.HTMLAttributes<HTMLButtonElement> & { asChild?: boolean; size?: string; 'data-testid'?: string }) => (
    <button {...p}>{children}</button>
  ),
  useSidebar: () => ({ isMobile: h.isMobile }),
}));

vi.mock('@/interfaces/components/ui/dropdown-menu.js', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? <>{children}</> : <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, onClick, 'data-testid': testId }: { children: React.ReactNode; onClick?: () => void; 'data-testid'?: string }) => (
    <div role="menuitem" onClick={onClick} data-testid={testId}>{children}</div>
  ),
}));

let localStorageData: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => localStorageData[k] ?? null,
  setItem: (k: string, v: string) => { localStorageData[k] = v; },
  removeItem: (k: string) => { delete localStorageData[k]; },
});

import { WorkspaceSwitcher } from '@/interfaces/components/shell/workspace-switcher.js';

const DEFAULT_WORKSPACE_LIST = {
  workspaces: [
    { workspaceId: 'ws-1', name: 'Sugandh Lok', slug: 'sugandh-lok', role: 'OWNER', plan: 'Growth' },
    { workspaceId: 'ws-2', name: 'Second Brand', slug: 'second-brand', role: 'ADMIN', plan: 'Starter' },
  ],
};

beforeEach(() => {
  h.currentWorkspaceId = 'ws-1';
  h.currentUserId = 'user-1';
  h.isAuthenticated = true;
  h.workspaceList = { ...DEFAULT_WORKSPACE_LIST };
  h.switchMutate.mockReset();
  h.dispatch.mockReset();
  h.locationAssign.mockReset();
  localStorageData = {};
  Object.defineProperty(window, 'location', {
    value: { assign: h.locationAssign },
    writable: true,
  });
});

describe('WorkspaceSwitcher', () => {
  it('renders all memberships from workspace.list', () => {
    render(<WorkspaceSwitcher />);
    // Name appears in the trigger (current ws) AND in the dropdown list item.
    expect(screen.getAllByText('Sugandh Lok').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Second Brand').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the real plan label from the current workspace (not hardcoded)', () => {
    render(<WorkspaceSwitcher />);
    // ws-1 has plan "Growth" → displayed as "growth plan"
    expect(screen.getByText('growth plan')).toBeTruthy();
  });

  it('shows correct plan for a workspace with a different plan', () => {
    h.currentWorkspaceId = 'ws-2';
    h.workspaceList = {
      workspaces: [
        { workspaceId: 'ws-2', name: 'Second Brand', slug: 'second-brand', role: 'ADMIN', plan: 'Starter' },
      ],
    };
    render(<WorkspaceSwitcher />);
    expect(screen.getByText('starter plan')).toBeTruthy();
  });

  it('marks the current workspace with an active check icon', () => {
    render(<WorkspaceSwitcher />);
    // The current workspace is ws-1. The IconCheck should render for ws-1.
    // We check that the ws-1 menu item has the check indicator (svg from tabler)
    // and the ws-2 does not. The testid on each option lets us inspect.
    const ws1Option = screen.getByTestId('workspace-option-ws-1');
    const ws2Option = screen.getByTestId('workspace-option-ws-2');
    // ws-1 should contain an svg (IconCheck); ws-2 should not.
    expect(ws1Option.querySelector('svg')).toBeTruthy();
    expect(ws2Option.querySelector('svg')).toBeNull();
  });

  it('selecting another workspace calls switch mutation + persists to localStorage + dispatches setSession + reloads', () => {
    render(<WorkspaceSwitcher />);
    const ws2Option = screen.getByTestId('workspace-option-ws-2');
    fireEvent.click(ws2Option);

    // Mutation called with the new workspace id.
    expect(h.switchMutate).toHaveBeenCalledWith({ workspaceId: 'ws-2' });

    // localStorage persisted the new workspace id.
    expect(localStorageData['brain.activeWorkspace']).toBe('ws-2');

    // Redux dispatched setSession with the new workspace + role from the server.
    expect(h.dispatch).toHaveBeenCalledWith({
      type: 'session/setSession',
      payload: { userId: 'user-1', workspaceId: 'ws-2', workspaceRole: 'ADMIN' },
    });

    // Hard reload to /dashboard so all queries refetch under the new workspace.
    expect(h.locationAssign).toHaveBeenCalledWith('/dashboard');
  });

  it('clicking the current workspace does nothing (no mutation)', () => {
    render(<WorkspaceSwitcher />);
    const ws1Option = screen.getByTestId('workspace-option-ws-1');
    fireEvent.click(ws1Option);
    expect(h.switchMutate).not.toHaveBeenCalled();
    expect(h.locationAssign).not.toHaveBeenCalled();
  });

  it('renders initials from the workspace name (not hardcoded)', () => {
    render(<WorkspaceSwitcher />);
    // "Sugandh Lok" → "SL"
    expect(screen.getByTestId('workspace-switcher-trigger').textContent).toContain('SL');
  });

  it('renders trigger with data-testid for testing', () => {
    render(<WorkspaceSwitcher />);
    expect(screen.getByTestId('workspace-switcher-trigger')).toBeTruthy();
  });

  it('shows "Workspace" and "Growth plan" fallback when list is loading', () => {
    h.workspaceList = undefined;
    h.isAuthenticated = true;
    render(<WorkspaceSwitcher />);
    // No workspaces to list — trigger shows the fallback name.
    expect(screen.getByTestId('workspace-switcher-trigger').textContent).toContain('W');
    // Plan falls back to "Growth plan".
    expect(screen.getByText('growth plan')).toBeTruthy();
  });
});

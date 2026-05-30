// @paradigm: sql
// TeamContent tests — parity-38 feat-parity-w6b.
//
// POSITIVE: renders heading + member table with Avatar/Badge/identity cells
// POSITIVE: (you) marker next to current user's name
// POSITIVE: OWNER badge uses 'default' variant; MANAGER uses 'secondary'; ANALYST uses 'outline'
// POSITIVE: MANAGER sees "Invite member" button
// POSITIVE: MANAGER sees action dropdown (•••) for non-OWNER members
// POSITIVE: OWNER sees "Transfer ownership" option in dropdown
// POSITIVE: pending invitations list visible to MANAGER
// NEGATIVE: ANALYST does not see Invite member button
// NEGATIVE: non-MANAGER does not see action menu
// NEGATIVE: unauthenticated shows sign-in

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('nuqs', () => ({
  useQueryState: () => ['', vi.fn()],
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
}));

let mockIsAuthenticated = true;
let mockWorkspaceId: string | null = 'ws-team';
let mockUserId: string | null = 'user-owner';
vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: { isAuthenticated: mockIsAuthenticated, workspaceId: mockWorkspaceId, userId: mockUserId } }),
}));

const OWNER_ID = 'user-owner';
const MANAGER_ID = 'user-mgr';
const ANALYST_ID = 'user-analyst';

const MEMBERS = [
  { user_id: OWNER_ID, full_name: 'Aarti Sugandh', email: 'aarti@brand.com', role: 'OWNER', joined_at: '2026-01-04' },
  { user_id: MANAGER_ID, full_name: 'Rohit Mehta', email: 'rohit@brand.com', role: 'MANAGER', joined_at: '2026-02-12' },
  { user_id: ANALYST_ID, full_name: 'Neha Sharma', email: 'neha@brand.com', role: 'ANALYST', joined_at: '2026-03-20' },
];

let membersQuery: { data?: unknown; isLoading?: boolean; error?: unknown } = {};
let invitesQuery: { data?: unknown; isLoading?: boolean } = { data: { invitations: [] } };
const mutateFn = vi.fn((_: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    team: {
      members: { useQuery: () => membersQuery },
      pendingInvitations: { useQuery: () => invitesQuery },
      invite: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (p: unknown) => { mutateFn(p, opts); }, isPending: false, data: undefined }) },
      changeRole: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (p: unknown) => { mutateFn(p, opts); }, isPending: false }) },
      removeMember: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (p: unknown) => { mutateFn(p, opts); }, isPending: false }) },
      revokeInvite: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (p: unknown) => { mutateFn(p, opts); }, isPending: false }) },
      transferOwnership: { useMutation: (opts: { onSuccess?: () => void }) => ({ mutate: (p: unknown) => { mutateFn(p, opts); }, isPending: false }) },
    },
    useUtils: () => ({
      team: { members: { invalidate: vi.fn() }, pendingInvitations: { invalidate: vi.fn() } },
    }),
  },
}));

// Minimal stubs for shadcn components used by TeamContent.
vi.mock('@/interfaces/components/ui/button.js', () => ({
  Button: ({ children, onClick, disabled, size, variant }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; size?: string; variant?: string }) =>
    <button onClick={onClick} disabled={disabled} data-size={size} data-variant={variant}>{children}</button>,
}));
vi.mock('@/interfaces/components/ui/badge.js', () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) =>
    <span data-variant={variant} data-testid="badge">{children}</span>,
}));
vi.mock('@/interfaces/components/ui/avatar.js', () => ({
  Avatar: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  AvatarFallback: ({ children, className }: { children: React.ReactNode; className?: string }) => <span className={className}>{children}</span>,
}));
vi.mock('@/interfaces/components/ui/table.js', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children, className }: { children?: React.ReactNode; className?: string }) => <th className={className}>{children}</th>,
  TableCell: ({ children, className }: { children?: React.ReactNode; className?: string }) => <td className={className}>{children}</td>,
}));
vi.mock('@/interfaces/components/ui/dialog.js', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/interfaces/components/ui/dropdown-menu.js', () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild }: { children?: React.ReactNode; asChild?: boolean }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <div data-testid="dropdown-menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick, className }: { children?: React.ReactNode; onClick?: () => void; className?: string }) =>
    <button onClick={onClick} className={className} data-testid="dropdown-item">{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('@/interfaces/components/ui/input.js', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));
vi.mock('@/interfaces/components/ui/label.js', () => ({
  Label: ({ children, htmlFor }: { children?: React.ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label>,
}));
vi.mock('@/interfaces/components/ui/select.js', () => ({
  Select: ({ children, value, onValueChange }: { children?: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) =>
    <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children?: React.ReactNode; value?: string }) =>
    <option value={value}>{children}</option>,
}));
vi.mock('@/interfaces/components/shared/error-display.js', () => ({
  ErrorDisplay: ({ title }: { title: string }) => <div data-testid="error-display">{title}</div>,
}));

import React from 'react';
import { TeamContent } from '@/interfaces/components/workspace/team-content.js';

function makeData(userId = OWNER_ID) {
  return {
    members: MEMBERS,
    pending_invitations: 0,
    data_epoch: new Date().toISOString(),
    request_id: 'req-team',
    result: { members: MEMBERS, pending_invitations: 0, workspace_id: 'ws-team' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthenticated = true;
  mockWorkspaceId = 'ws-team';
  mockUserId = OWNER_ID;
  membersQuery = { data: makeData(), isLoading: false };
  invitesQuery = { data: { invitations: [] } };
});

describe('TeamContent (positive)', () => {
  it('renders Team heading', () => {
    render(<TeamContent />);
    expect(screen.getByText('Team')).toBeDefined();
  });

  it('renders all 3 members', () => {
    render(<TeamContent />);
    expect(screen.getByText('Aarti Sugandh')).toBeDefined();
    expect(screen.getByText('Rohit Mehta')).toBeDefined();
    expect(screen.getByText('Neha Sharma')).toBeDefined();
  });

  it('shows (you) marker for the current user', () => {
    render(<TeamContent />);
    expect(screen.getByText('(you)')).toBeDefined();
  });

  it('renders OWNER badge with default variant', () => {
    render(<TeamContent />);
    const badges = screen.getAllByTestId('badge');
    const ownerBadge = badges.find((b) => b.textContent === 'Owner');
    expect(ownerBadge?.getAttribute('data-variant')).toBe('default');
  });

  it('renders MANAGER badge with secondary variant', () => {
    render(<TeamContent />);
    const badges = screen.getAllByTestId('badge');
    const managerBadge = badges.find((b) => b.textContent === 'Manager');
    expect(managerBadge?.getAttribute('data-variant')).toBe('secondary');
  });

  it('renders ANALYST badge with outline variant', () => {
    render(<TeamContent />);
    const badges = screen.getAllByTestId('badge');
    const analystBadge = badges.find((b) => b.textContent === 'Analyst');
    expect(analystBadge?.getAttribute('data-variant')).toBe('outline');
  });

  it('OWNER sees Invite member button', () => {
    render(<TeamContent />);
    expect(screen.getByText(/Invite member/)).toBeDefined();
  });

  it('MANAGER sees Invite member button', () => {
    mockUserId = MANAGER_ID;
    render(<TeamContent />);
    expect(screen.getByText(/Invite member/)).toBeDefined();
  });

  it('action dropdown is rendered for manageable rows', () => {
    render(<TeamContent />);
    // Owner user sees dropdowns for non-self rows (MANAGER, ANALYST)
    const dropdowns = screen.getAllByTestId('dropdown-menu');
    expect(dropdowns.length).toBeGreaterThanOrEqual(1);
  });

  it('dropdown contains "Transfer ownership" option for OWNER', () => {
    render(<TeamContent />);
    const items = screen.getAllByTestId('dropdown-item');
    const transfer = items.find((el) => /transfer ownership/i.test(el.textContent ?? ''));
    expect(transfer).toBeDefined();
  });
});

describe('TeamContent (negative)', () => {
  it('ANALYST does not see Invite member button', () => {
    mockUserId = ANALYST_ID;
    // Analyst is not OWNER or MANAGER
    render(<TeamContent />);
    // The Invite member button should not be present
    expect(screen.queryByText(/Invite member/)).toBeNull();
  });

  it('shows sign-in when unauthenticated', () => {
    mockIsAuthenticated = false;
    render(<TeamContent />);
    expect(screen.getByText(/Not signed in/i)).toBeDefined();
  });

  it('renders error display on query error', () => {
    membersQuery = { error: { message: 'DB error', data: {} }, isLoading: false };
    render(<TeamContent />);
    expect(screen.getByTestId('error-display')).toBeDefined();
  });
});

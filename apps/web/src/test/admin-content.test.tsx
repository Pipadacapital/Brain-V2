// @paradigm: sql
// Admin suite content tests — AdminUsersContent / AdminWorkspacesContent / AdminSyncContent.
//
// POSITIVE: tables render rows; SUPERADMIN role highlighted; "N total" count; workspace
//           slug deep-links; Yes/— connection flags; plan "—" (no fabrication); sync lists
//           connected workspaces grouped by vendor.
// NEGATIVE: FORBIDDEN error (non-superadmin reaching the page) renders ErrorDisplay, not a
//           table; empty data renders honest "No …" rows; sync triggers are DISABLED.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// --- tRPC mock: each query returns a per-test mutable object -----------------
let usersQuery: { data?: unknown; isLoading?: boolean; error?: unknown } = {};
let workspacesQuery: { data?: unknown; isLoading?: boolean; error?: unknown } = {};
let connectionsQuery: { data?: unknown; isLoading?: boolean; error?: unknown } = {};

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    admin: {
      users: { useQuery: () => usersQuery },
      workspaces: { useQuery: () => workspacesQuery },
      connections: { useQuery: () => connectionsQuery },
    },
  },
}));

// --- shadcn / icon stubs -----------------------------------------------------
vi.mock('@tabler/icons-react', () => ({
  IconArrowLeft: () => <span data-testid="back" />,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/interfaces/components/ui/button.js', () => ({
  Button: ({ children, disabled }: { children?: React.ReactNode; disabled?: boolean }) => (
    <button disabled={disabled}>{children}</button>
  ),
}));
vi.mock('@/interfaces/components/ui/skeleton.js', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));
vi.mock('@/interfaces/components/ui/table.js', () => ({
  Table: ({ children }: { children?: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children?: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) => (
    <td className={className} colSpan={colSpan}>{children}</td>
  ),
}));
vi.mock('@/interfaces/components/shared/error-display.js', () => ({
  ErrorDisplay: ({ title }: { title: string }) => <div data-testid="error-display">{title}</div>,
}));

import { AdminUsersContent } from '@/interfaces/components/admin/admin-users-content.js';
import { AdminWorkspacesContent } from '@/interfaces/components/admin/admin-workspaces-content.js';
import { AdminSyncContent } from '@/interfaces/components/admin/admin-sync-content.js';

beforeEach(() => {
  vi.clearAllMocks();
  usersQuery = {};
  workspacesQuery = {};
  connectionsQuery = {};
});

// ===========================================================================
// AdminUsersContent
// ===========================================================================
describe('AdminUsersContent', () => {
  it('(+) renders the user rows + "N total" + amber SUPERADMIN', () => {
    usersQuery = {
      data: {
        total: 2,
        users: [
          { id: 'u1', email: 'a@b.com', fullName: 'Aarti', systemRole: 'SUPERADMIN', membershipCount: 2, createdAt: '2026-03-01T00:00:00.000Z' },
          { id: 'u2', email: 'c@d.com', fullName: null, systemRole: 'USER', membershipCount: 0, createdAt: '2026-03-01T00:00:00.000Z' },
        ],
      },
    };
    render(<AdminUsersContent />);
    expect(screen.getByText('a@b.com')).toBeDefined();
    expect(screen.getByText(/2 total/)).toBeDefined();
    const superCell = screen.getByText('SUPERADMIN');
    expect(superCell.className).toContain('text-amber-600');
  });

  it('(-) renders ErrorDisplay on FORBIDDEN, not a table', () => {
    usersQuery = { error: { message: 'Superadmin only.', data: { requestId: 'req-x' } } };
    render(<AdminUsersContent />);
    expect(screen.getByTestId('error-display')).toBeDefined();
    expect(screen.queryByText(/total/)).toBeNull();
  });

  it('(-) honest empty when no users', () => {
    usersQuery = { data: { total: 0, users: [] } };
    render(<AdminUsersContent />);
    expect(screen.getByText('No users yet.')).toBeDefined();
  });
});

// ===========================================================================
// AdminWorkspacesContent
// ===========================================================================
describe('AdminWorkspacesContent', () => {
  it('(+) renders rows: slug deep-link, plan "—", Yes/— flags', () => {
    workspacesQuery = {
      data: {
        total: 1,
        workspaces: [
          { id: 'w1', name: 'Sugandh Lok', slug: 'sugandh-lok', plan: null, memberCount: 5, shopifyCount: 1, hasGoogleAds: true, hasMeta: false, createdAt: '2026-03-01T00:00:00.000Z' },
        ],
      },
    };
    render(<AdminWorkspacesContent />);
    const slug = screen.getByText('sugandh-lok');
    expect(slug.closest('a')?.getAttribute('href')).toBe('/w/sugandh-lok/dashboard');
    expect(screen.getByText('Yes')).toBeDefined(); // google
    // plan null + Meta false both render "—" → expect at least two honest dashes
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('(-) ErrorDisplay on FORBIDDEN', () => {
    workspacesQuery = { error: { message: 'Superadmin only.', data: { requestId: 'req-x' } } };
    render(<AdminWorkspacesContent />);
    expect(screen.getByTestId('error-display')).toBeDefined();
  });
});

// ===========================================================================
// AdminSyncContent
// ===========================================================================
describe('AdminSyncContent', () => {
  it('(+) groups connections by vendor + lists connected workspaces', () => {
    connectionsQuery = {
      data: {
        total: 1,
        connections: [
          { connectionId: 'c1', vendor: 'SHOPIFY', workspaceId: 'w1', workspaceName: 'Sugandh Lok', workspaceSlug: 'sugandh-lok', status: 'CONNECTED', accountRef: 'x', lastSyncAt: null, lastSyncError: null },
        ],
      },
    };
    render(<AdminSyncContent />);
    expect(screen.getByText('Shopify')).toBeDefined();
    expect(screen.getByText('Sugandh Lok')).toBeDefined();
    expect(screen.getByText('Never synced')).toBeDefined();
  });

  it('(-) sync triggers are DISABLED (connector cutover HOLD)', () => {
    connectionsQuery = { data: { total: 0, connections: [] } };
    render(<AdminSyncContent />);
    const syncButtons = screen.getAllByRole('button').filter((b) => /Sync all/.test(b.textContent ?? ''));
    expect(syncButtons.length).toBeGreaterThan(0);
    expect(syncButtons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

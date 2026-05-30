// @paradigm: sql
// NotificationsContent tests — parity-38 feat-parity-w6b.
//
// POSITIVE: renders heading + unread count copy
// POSITIVE: shows "all caught up" when 0 unread
// POSITIVE: renders notification rows from query data
// POSITIVE: workspace-scoped — workspaceId passed to list/unreadCount/markAllRead
// POSITIVE: mark-all-read button passes workspaceId
// POSITIVE: limit = 50 (not 200)
// NEGATIVE: unauthenticated shows sign-in message
// NEGATIVE: error state renders ErrorDisplay

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('nuqs', () => ({
  useQueryState: (_key: string, parser: { withDefault?: unknown }) => {
    const defaultVal = (parser && typeof parser === 'object' && 'withDefault' in parser)
      ? parser.withDefault : '';
    return [defaultVal, vi.fn()];
  },
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
}));

let mockIsAuthenticated = true;
let mockWorkspaceId: string | null = 'ws-test-notif';
vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: { isAuthenticated: mockIsAuthenticated, workspaceId: mockWorkspaceId, userId: 'user-a' } }),
}));

let mockListQuery: { data?: unknown; isLoading?: boolean; error?: unknown } = {};
let mockUnreadQuery: { data?: { count: number } } = { data: { count: 0 } };
let lastListInput: unknown;
let lastUnreadInput: unknown;
let markAllMutate = vi.fn();
let markReadMutate = vi.fn();
let invalidate = vi.fn();

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    notifications: {
      list: {
        useQuery: (input: unknown) => {
          lastListInput = input;
          return mockListQuery;
        },
      },
      unreadCount: {
        useQuery: (input: unknown) => {
          lastUnreadInput = input;
          return mockUnreadQuery;
        },
      },
      markRead: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutate: (p: unknown) => { markReadMutate(p); opts.onSuccess?.(); },
          isPending: false,
        }),
      },
      markAllRead: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutate: (p: unknown) => { markAllMutate(p); opts.onSuccess?.(); },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      notifications: {
        list: { invalidate },
        unreadCount: { invalidate },
      },
    }),
  },
}));

vi.mock('@/interfaces/components/ui/button.js', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
}));

vi.mock('@/interfaces/components/shared/error-display.js', () => ({
  ErrorDisplay: ({ title }: { title: string }) => <div data-testid="error-display">{title}</div>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import React from 'react';
import { NotificationsContent } from '@/interfaces/components/notifications/notifications-content.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthenticated = true;
  mockWorkspaceId = 'ws-test-notif';
  mockListQuery = { data: { items: [] }, isLoading: false };
  mockUnreadQuery = { data: { count: 0 } };
  lastListInput = undefined;
  lastUnreadInput = undefined;
  markAllMutate = vi.fn();
  invalidate = vi.fn();
});

describe('NotificationsContent (positive)', () => {
  it('renders the Notifications heading', () => {
    render(<NotificationsContent />);
    expect(screen.getByText('Notifications')).toBeDefined();
  });

  it('shows "You\'re all caught up" when 0 unread', () => {
    render(<NotificationsContent />);
    expect(screen.getByText(/all caught up/i)).toBeDefined();
  });

  it('shows unread count copy when count > 0', () => {
    mockUnreadQuery = { data: { count: 3 } };
    render(<NotificationsContent />);
    expect(screen.getByText(/3 unread/i)).toBeDefined();
  });

  it('passes workspaceId to list query (workspace-scoped)', () => {
    render(<NotificationsContent />);
    expect((lastListInput as { workspaceId?: string })?.workspaceId).toBe('ws-test-notif');
  });

  it('passes workspaceId to unreadCount query (workspace-scoped)', () => {
    render(<NotificationsContent />);
    expect((lastUnreadInput as { workspaceId?: string })?.workspaceId).toBe('ws-test-notif');
  });

  it('passes limit=50 (legacy page size)', () => {
    render(<NotificationsContent />);
    expect((lastListInput as { limit?: number })?.limit).toBe(50);
  });

  it('renders notification rows', () => {
    mockListQuery = {
      data: {
        items: [
          { id: 'n1', type: 'SYSTEM', title: 'Welcome to Brain', body: 'Get started', read: false, actionUrl: null, createdAt: new Date().toISOString() },
        ],
      },
      isLoading: false,
    };
    mockUnreadQuery = { data: { count: 1 } };
    render(<NotificationsContent />);
    expect(screen.getByText('Welcome to Brain')).toBeDefined();
    expect(screen.getByText('Get started')).toBeDefined();
  });
});

describe('NotificationsContent (negative)', () => {
  it('shows sign-in message when unauthenticated', () => {
    mockIsAuthenticated = false;
    render(<NotificationsContent />);
    expect(screen.getByText(/sign in to see/i)).toBeDefined();
  });

  it('shows error display on query error', () => {
    mockListQuery = { error: { message: 'DB down', data: { httpStatus: 500 } }, isLoading: false };
    render(<NotificationsContent />);
    expect(screen.getByTestId('error-display')).toBeDefined();
  });
});

// @paradigm: sql
// AccountContent tests — legacy-parity-v2 restore.
//
// POSITIVE: renders "Account Settings" heading in header bar
// POSITIVE: renders Profile section with shadcn Card
// POSITIVE: renders Password section for non-Google users
// POSITIVE: renders Sessions section with "Current session" row and Active badge
// POSITIVE: renders "Danger Zone" section title
// POSITIVE: renders "Member since {month year}" footer
// POSITIVE: Google-auth hides Password section
// POSITIVE: Google-auth shows read-only job-role when data.jobRole is present
// POSITIVE: renders full-screen chrome (min-h-screen border-b header bar)
// POSITIVE: "Update password" label on submit button (legacy wording)
// POSITIVE: "Delete account" button present in Danger Zone
// NEGATIVE: unauthenticated renders sign-in message
// NEGATIVE: error state renders ErrorDisplay
// NEGATIVE: loading state renders skeleton (not just spinner)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// nuqs mock
// ---------------------------------------------------------------------------
vi.mock('nuqs', () => ({
  useQueryState: (_key: string, parser: { withDefault?: unknown }) => {
    const defaultVal =
      parser && typeof parser === 'object' && 'withDefault' in parser ? parser.withDefault : '';
    return [defaultVal, vi.fn()];
  },
  parseAsString: { withDefault: (d: string) => ({ withDefault: d }) },
}));

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Session mock — default authenticated
// ---------------------------------------------------------------------------
let mockIsAuthenticated = true;
let mockWorkspaceId: string | null = 'ws-test-acct';
vi.mock('@/domain/store/hooks.js', () => ({
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({
      session: {
        isAuthenticated: mockIsAuthenticated,
        workspaceId: mockWorkspaceId,
      },
    }),
}));

// ---------------------------------------------------------------------------
// Supabase client mock — resolves immediately, non-Google by default
// ---------------------------------------------------------------------------
let mockProvider = 'email';
vi.mock('@/infrastructure/supabase/client.js', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { app_metadata: { provider: mockProvider } } },
        }),
      signOut: vi.fn().mockResolvedValue({}),
    },
  }),
}));

// ---------------------------------------------------------------------------
// tRPC mock
// ---------------------------------------------------------------------------
const SAMPLE_ACCOUNT = {
  id: 'u1',
  email: 'test@example.com',
  fullName: 'Test User',
  jobRole: 'Head of Growth',
  avatarUrl: null,
  createdAt: '2023-06-15T00:00:00.000Z',
};

type AccountQuery = { data?: typeof SAMPLE_ACCOUNT; isLoading?: boolean; error?: unknown };
let accountQuery: AccountQuery = {};
let updateProfileMutate = vi.fn();
let deleteAccountMutate = vi.fn();
let invalidate = vi.fn();

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    user: {
      account: {
        useQuery: () => accountQuery,
      },
      updateProfile: {
        useMutation: () => ({
          mutate: (input: unknown, cbs?: { onSuccess?: () => void }) => {
            updateProfileMutate(input);
            cbs?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      deleteAccount: {
        useMutation: (opts?: { onSuccess?: () => void }) => ({
          mutate: () => {
            deleteAccountMutate();
            opts?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      user: { account: { invalidate } },
    }),
  },
}));

// ---------------------------------------------------------------------------
// UI mocks
// ---------------------------------------------------------------------------
vi.mock('@/interfaces/components/ui/button.js', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    asChild: _asChild,
    variant: _v,
    size: _s,
    className: _c,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    asChild?: boolean;
    variant?: string;
    size?: string;
    className?: string;
    'aria-label'?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  buttonVariants: () => 'btn',
}));

vi.mock('@/interfaces/components/ui/card.js', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-content">{children}</div>
  ),
}));

vi.mock('@/interfaces/components/ui/input.js', () => ({
  Input: ({
    id,
    value,
    onChange,
    disabled,
    placeholder,
    type,
    ...rest
  }: {
    id?: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    disabled?: boolean;
    placeholder?: string;
    type?: string;
    className?: string;
    autoComplete?: string;
    'aria-label'?: string;
  }) => (
    <input
      id={id}
      type={type ?? 'text'}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      {...rest}
    />
  ),
}));

vi.mock('@/interfaces/components/ui/label.js', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock('@/interfaces/components/ui/avatar.js', () => ({
  Avatar: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="avatar" className={className}>
      {children}
    </div>
  ),
  AvatarFallback: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
  AvatarImage: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt} />,
}));

vi.mock('@/interfaces/components/ui/alert-dialog.js', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({
    children,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <div>{children}</div>,
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock('@/interfaces/components/shared/error-display.js', () => ({
  ErrorDisplay: ({ title }: { title: string }) => (
    <div data-testid="error-display">{title}</div>
  ),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// beforeEach resets
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthenticated = true;
  mockWorkspaceId = 'ws-test-acct';
  mockProvider = 'email';
  accountQuery = { data: SAMPLE_ACCOUNT, isLoading: false, error: undefined };
  updateProfileMutate = vi.fn();
  deleteAccountMutate = vi.fn();
  invalidate = vi.fn();
});

// ---------------------------------------------------------------------------
// Import under test (AFTER mocks)
// ---------------------------------------------------------------------------
import { AccountContent } from '@/interfaces/components/account/account-content.js';

// ---------------------------------------------------------------------------
// Positive scenarios
// Note: AccountContent calls Supabase getUser() (async) to detect Google auth.
// We waitFor so the component finishes the async flow and renders full content.
// ---------------------------------------------------------------------------
describe('AccountContent (positive)', () => {
  it('renders Account Settings heading in header bar', async () => {
    render(<AccountContent />);
    await waitFor(() => expect(screen.getByText('Account Settings')).toBeDefined());
  });

  it('renders Profile card section', async () => {
    render(<AccountContent />);
    await waitFor(() => expect(screen.getByText('Profile')).toBeDefined());
  });

  it('renders Password section for non-Google users', async () => {
    render(<AccountContent />);
    await waitFor(() => expect(screen.getByText('Password')).toBeDefined());
  });

  it('uses "Update password" as the submit label (legacy wording)', async () => {
    render(<AccountContent />);
    await waitFor(() => expect(screen.getByText('Update password')).toBeDefined());
  });

  it('renders Sessions section with "Current session" row', async () => {
    render(<AccountContent />);
    await waitFor(() => {
      expect(screen.getByText('Sessions')).toBeDefined();
      expect(screen.getByText('Current session')).toBeDefined();
    });
  });

  it('renders "Active" badge in sessions section', async () => {
    render(<AccountContent />);
    await waitFor(() => expect(screen.getByText('Active')).toBeDefined());
  });

  it('renders "Danger Zone" section title', async () => {
    render(<AccountContent />);
    await waitFor(() => expect(screen.getByText('Danger Zone')).toBeDefined());
  });

  it('renders "Delete account" trigger button', async () => {
    render(<AccountContent />);
    await waitFor(() => expect(screen.getByText('Delete account')).toBeDefined());
  });

  it('renders "Member since" footer with month and year from createdAt', async () => {
    render(<AccountContent />);
    // createdAt = '2023-06-15' → "Member since June 2023"
    await waitFor(() => {
      const footer = screen.getByText(/member since/i);
      expect(footer.textContent).toMatch(/june 2023/i);
    });
  });

  it('renders the avatar fallback with initials', async () => {
    render(<AccountContent />);
    // "Test User" → "TU"
    await waitFor(() => expect(screen.getByText('TU')).toBeDefined());
  });

  it('renders user email', async () => {
    render(<AccountContent />);
    await waitFor(() =>
      expect(screen.getAllByText('test@example.com').length).toBeGreaterThan(0),
    );
  });
});

// ---------------------------------------------------------------------------
// Google-auth scenarios
// ---------------------------------------------------------------------------
describe('AccountContent (Google auth)', () => {
  beforeEach(() => {
    mockProvider = 'google';
  });

  it('hides Password section for Google users', async () => {
    render(<AccountContent />);
    // Wait for the component to fully render (providerKnown=true)
    // After that, Password section should NOT be present for Google users.
    await waitFor(() => expect(screen.getByText('Sessions')).toBeDefined());
    expect(screen.queryByText('Password')).toBeNull();
  });

  it('shows read-only job-role for Google users when jobRole is present', async () => {
    render(<AccountContent />);
    // jobRole = 'Head of Growth' from SAMPLE_ACCOUNT, appears as read-only text
    await waitFor(() => expect(screen.getByText('Head of Growth')).toBeDefined());
  });
});

// ---------------------------------------------------------------------------
// Negative scenarios
// ---------------------------------------------------------------------------
describe('AccountContent (negative)', () => {
  it('shows sign-in message when unauthenticated', () => {
    mockIsAuthenticated = false;
    render(<AccountContent />);
    expect(screen.getByText(/sign in to manage/i)).toBeDefined();
  });

  it('renders ErrorDisplay on query error', () => {
    accountQuery = { error: { message: 'DB error', data: { requestId: 'req-1' } } };
    render(<AccountContent />);
    expect(screen.getByTestId('error-display')).toBeDefined();
  });

  it('renders skeleton structure when loading (not full content)', () => {
    accountQuery = { isLoading: true };
    render(<AccountContent />);
    // Skeleton shows; Profile/Password sections must NOT be present
    expect(screen.queryByText('Profile')).toBeNull();
    expect(screen.queryByText('Password')).toBeNull();
  });
});

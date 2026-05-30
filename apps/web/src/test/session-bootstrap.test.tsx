// @paradigm: io
// SessionBootstrap tests — hydration + the no-membership routing fix.
//
// Regression guard (found in monitoring 2026-05-29): a VERIFIED user with no workspace
// membership hits auth.session (workspace tier) → UNAUTHORIZED. SessionBootstrap used to
// treat ANY session error as "invalid session" → signOut → /login, looping the user.
// The fix probes identity-tier user.me on session error: needsOnboarding → /onboarding;
// genuine identity failure → signOut + /login.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  sessionResult: { data: undefined as unknown, isError: false },
  meResult: { data: undefined as unknown, isLoading: false, isError: false },
  dispatch: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  isAuthenticated: false,
}));

vi.mock('@/domain/store/hooks.js', () => ({
  useAppDispatch: () => h.dispatch,
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ session: { isAuthenticated: h.isAuthenticated } }),
}));

vi.mock('@/infrastructure/trpc-client.js', () => ({
  trpc: {
    auth: { session: { useQuery: () => h.sessionResult } },
    user: { me: { useQuery: () => h.meResult } },
  },
}));

vi.mock('@/domain/store/session-slice.js', () => ({
  setSession: (p: unknown) => ({ type: 'session/setSession', payload: p }),
}));

vi.mock('@/infrastructure/supabase/client.js', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signOut: h.signOut } }),
}));

import { SessionBootstrap } from '@/interfaces/components/auth/session-bootstrap.js';

const assign = vi.fn();

beforeEach(() => {
  h.sessionResult = { data: undefined, isError: false };
  h.meResult = { data: undefined, isLoading: false, isError: false };
  h.isAuthenticated = false;
  h.dispatch.mockReset();
  h.signOut.mockReset().mockResolvedValue(undefined);
  assign.mockReset();
  Object.defineProperty(window, 'location', { value: { assign }, writable: true });
});

describe('SessionBootstrap', () => {
  it('resolved session → dispatches setSession and renders children', () => {
    h.sessionResult = {
      data: { userId: 'u1', workspaceId: 'ws1', workspaceRole: 'OWNER' },
      isError: false,
    };
    h.isAuthenticated = true;
    render(<SessionBootstrap><div>child-content</div></SessionBootstrap>);
    expect(h.dispatch).toHaveBeenCalledWith({
      type: 'session/setSession',
      payload: { userId: 'u1', workspaceId: 'ws1', workspaceRole: 'OWNER' },
    });
    expect(screen.getByText('child-content')).toBeTruthy();
  });

  it('session error + needsOnboarding → routes to /onboarding, does NOT sign out', async () => {
    h.sessionResult = { data: undefined, isError: true };
    h.meResult = { data: { needsOnboarding: true }, isLoading: false, isError: false };
    render(<SessionBootstrap><div>child-content</div></SessionBootstrap>);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/onboarding'));
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('session error + identity probe also failed → signs out and routes to /login', async () => {
    h.sessionResult = { data: undefined, isError: true };
    h.meResult = { data: undefined, isLoading: false, isError: true };
    render(<SessionBootstrap><div>child-content</div></SessionBootstrap>);
    await waitFor(() => expect(h.signOut).toHaveBeenCalled());
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login?error=session'));
  });

  it('session error + probe still loading → waits (no navigation yet)', () => {
    h.sessionResult = { data: undefined, isError: true };
    h.meResult = { data: undefined, isLoading: true, isError: false };
    render(<SessionBootstrap><div>child-content</div></SessionBootstrap>);
    expect(assign).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
  });
});

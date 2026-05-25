// @paradigm: sql
// Tests for LoginForm (Slice A — real Supabase auth path).
// CF-C6-PII-CLIENT-1: email/password/token never in logs; tested negatively.
//
// The default test env has NEXT_PUBLIC_BRAIN_LOCAL_HARNESS unset (= real auth),
// so these tests exercise the REAL Supabase path with the browser client mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider as ReduxProvider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { LoginForm } from '@/interfaces/components/auth/login-form.js';
import uiReducer from '@/domain/store/ui-slice.js';
import sessionReducer from '@/domain/store/session-slice.js';

// Mock next/navigation router.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock the Supabase browser client.
const { signInWithPasswordMock, signInWithOAuthMock } = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn(),
  signInWithOAuthMock: vi.fn(),
}));
vi.mock('@/infrastructure/supabase/client.js', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signInWithOAuth: signInWithOAuthMock,
    },
  }),
}));

// Stub window.location.assign so the success path is observable in jsdom.
const assignMock = vi.fn();
beforeEach(() => {
  pushMock.mockClear();
  signInWithPasswordMock.mockReset();
  signInWithOAuthMock.mockReset();
  assignMock.mockClear();
  Object.defineProperty(window, 'location', {
    value: { origin: 'http://localhost:3000', assign: assignMock },
    writable: true,
  });
});

function makeStore() {
  return configureStore({ reducer: { ui: uiReducer, session: sessionReducer } });
}

function renderForm(props?: Parameters<typeof LoginForm>[0]) {
  const store = makeStore();
  const utils = render(
    <ReduxProvider store={store}>
      <LoginForm {...props} />
    </ReduxProvider>,
  );
  return { ...utils, store };
}

describe('LoginForm — real Supabase auth', () => {
  it('renders email + password + Google button', () => {
    renderForm();
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('POSITIVE: valid credentials → signInWithPassword called, navigates to /dashboard', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/work email/i), 'real@brand.com');
    await user.type(screen.getByLabelText(/password/i), 'realpassword');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(signInWithPasswordMock).toHaveBeenCalledWith({
        email: 'real@brand.com',
        password: 'realpassword',
      });
    });
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('NEGATIVE: Supabase rejects → generic error, no navigation, no detail leaked', async () => {
    signInWithPasswordMock.mockResolvedValue({
      error: { message: 'AuthApiError: invalid login credentials for real@brand.com' },
    });
    renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/work email/i), 'real@brand.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/invalid email or password/i);
      // The raw Supabase detail must NOT be surfaced.
      expect(alert).not.toHaveTextContent(/AuthApiError/);
    });
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('POSITIVE: Google button → signInWithOAuth("google") with the callback redirect', async () => {
    signInWithOAuthMock.mockResolvedValue({ error: null });
    renderForm();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /sign in with google/i }));

    await waitFor(() => {
      expect(signInWithOAuthMock).toHaveBeenCalledWith({
        provider: 'google',
        options: { redirectTo: 'http://localhost:3000/auth/callback' },
      });
    });
  });

  it('form has noValidate — HTML5 validation suppressed (UX)', () => {
    renderForm();
    const form = screen.getByRole('form', { name: /sign in form/i });
    expect(form).toHaveAttribute('novalidate');
  });
});

describe('LoginForm — PII client log negative test (CF-C6-PII-CLIENT-1)', () => {
  it('does not console.log email or password on submit', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/work email/i), 'real@brand.com');
    await user.type(screen.getByLabelText(/password/i), 'secretpassword');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    const allCalls = [
      ...consoleSpy.mock.calls,
      ...consoleWarnSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
    ]
      .flat()
      .map(String);

    for (const call of allCalls) {
      expect(call).not.toContain('real@brand.com');
      expect(call).not.toContain('secretpassword');
    }

    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

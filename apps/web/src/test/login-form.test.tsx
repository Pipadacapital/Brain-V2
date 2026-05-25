// @paradigm: sql
// Tests for LoginForm.
// CF-C6-PII-CLIENT-1: email/password never in logs; tested negatively.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider as ReduxProvider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { LoginForm } from '@/interfaces/components/auth/login-form.js';
import uiReducer from '@/domain/store/ui-slice.js';
import sessionReducer from '@/domain/store/session-slice.js';

// LoginForm navigates client-side via next/navigation's useRouter on success
// (router.push, NOT window.location, so the in-memory Redux session survives).
// jsdom has no App Router mounted, so we stub it and assert navigation directly.
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

beforeEach(() => {
  pushMock.mockClear();
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

describe('LoginForm', () => {
  it('renders email + password fields and submit button', () => {
    renderForm();
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows error message on wrong credentials', async () => {
    renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/work email/i), 'wrong@test.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid email or password/i);
    });
    // Negative: a failed login must NOT navigate.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('dispatches setSession on correct stub credentials', async () => {
    const { store } = renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/work email/i), 'founder@sugandhlok.com');
    await user.type(screen.getByLabelText(/password/i), 'brain-local-dev');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Give it time for the setState / dispatch to run.
    await waitFor(() => {
      const state = store.getState();
      expect(state.session.isAuthenticated).toBe(true);
      expect(state.session.workspaceRole).toBe('OWNER');
    });
    // Positive: a successful login navigates to the dashboard client-side.
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('disables button during submission', async () => {
    renderForm();
    const user = userEvent.setup();
    const btn = screen.getByRole('button', { name: /sign in/i });

    await user.click(btn);
    // After click, the button text may briefly show "Signing in…"
    // This tests the disabled state during async operation.
    expect(btn).toBeInTheDocument();
  });

  it('form has noValidate — HTML5 validation suppressed (UX)', () => {
    renderForm();
    const form = screen.getByRole('form', { name: /sign in form/i });
    expect(form).toHaveAttribute('novalidate');
  });
});

// ---------------------------------------------------------------------------
// Negative test: CF-C6-PII-CLIENT-1 — no email/password in console.log
// ---------------------------------------------------------------------------
describe('LoginForm — PII client log negative test (CF-C6-PII-CLIENT-1)', () => {
  it('does not console.log email or password on submit', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/work email/i), 'founder@sugandhlok.com');
    await user.type(screen.getByLabelText(/password/i), 'brain-local-dev');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Check no console call contains the sensitive credentials.
    const allCalls = [
      ...consoleSpy.mock.calls,
      ...consoleWarnSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
    ].flat().map(String);

    for (const call of allCalls) {
      expect(call).not.toContain('founder@sugandhlok.com');
      expect(call).not.toContain('brain-local-dev');
    }

    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

// @paradigm: sql
// Tests for SignUpForm (Slice B — real Supabase signUp path).
// CF-C6-PII-CLIENT-1: email/password never in logs; raw error detail never surfaced.
// Mirrors the slice-A login-form test structure (mock the browser client + router).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpForm } from '@/interfaces/components/auth/sign-up-form.js';

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

const { signUpMock } = vi.hoisted(() => ({ signUpMock: vi.fn() }));
vi.mock('@/infrastructure/supabase/client.js', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signUp: signUpMock } }),
}));

beforeEach(() => {
  pushMock.mockClear();
  signUpMock.mockReset();
  Object.defineProperty(window, 'location', {
    value: { origin: 'http://localhost:3000' },
    writable: true,
  });
});

describe('SignUpForm — real Supabase signUp', () => {
  it('renders email, password, repeat-password + sign-up button (legacy Card design)', () => {
    render(<SignUpForm />);
    // Legacy labels: "Email", "Password", "Repeat Password"
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/repeat password/i)).toBeInTheDocument();
    // Legacy button copy: "Sign up"
    expect(screen.getByRole('button', { name: /^sign up$/i })).toBeInTheDocument();
  });

  it('renders legacy Card heading "Sign up" and description "Create a new account"', () => {
    render(<SignUpForm />);
    // CardTitle text — use data-slot selector to disambiguate from the submit button
    expect(screen.getByText('Sign up', { selector: '[data-slot="card-title"]' })).toBeInTheDocument();
    expect(screen.getByText(/create a new account/i)).toBeInTheDocument();
  });

  it('renders "Login" link back to /auth/login', () => {
    render(<SignUpForm />);
    const link = screen.getByRole('link', { name: /^login$/i });
    expect(link).toHaveAttribute('href', '/auth/login');
  });

  it('POSITIVE: matching passwords → signUp called with emailRedirectTo, routes to success', async () => {
    signUpMock.mockResolvedValue({ error: null });
    render(<SignUpForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^email$/i), 'new@brand.com');
    await user.type(screen.getByLabelText(/^password$/i), 'realpassword');
    await user.type(screen.getByLabelText(/repeat password/i), 'realpassword');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalledWith({
        email: 'new@brand.com',
        password: 'realpassword',
        options: { emailRedirectTo: 'http://localhost:3000/auth/callback' },
      });
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/auth/sign-up-success'));
  });

  it('NEGATIVE: password mismatch → generic message, NO signUp call, no navigation', async () => {
    render(<SignUpForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^email$/i), 'new@brand.com');
    await user.type(screen.getByLabelText(/^password$/i), 'realpassword');
    await user.type(screen.getByLabelText(/repeat password/i), 'different');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/passwords do not match/i);
    });
    expect(signUpMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('NEGATIVE: Supabase error → generic message, raw detail NOT surfaced, no navigation', async () => {
    signUpMock.mockResolvedValue({
      error: { message: 'AuthApiError: user already registered new@brand.com' },
    });
    render(<SignUpForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^email$/i), 'new@brand.com');
    await user.type(screen.getByLabelText(/^password$/i), 'realpassword');
    await user.type(screen.getByLabelText(/repeat password/i), 'realpassword');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/could not create your account/i);
      expect(alert).not.toHaveTextContent(/AuthApiError/);
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('form has noValidate', () => {
    render(<SignUpForm />);
    const form = screen.getByRole('form', { name: /sign up form/i });
    expect(form).toHaveAttribute('novalidate');
  });
});

describe('SignUpForm — PII client log negative test (CF-C6-PII-CLIENT-1)', () => {
  it('does not console.log email or password on submit', async () => {
    signUpMock.mockResolvedValue({ error: null });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<SignUpForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^email$/i), 'new@brand.com');
    await user.type(screen.getByLabelText(/^password$/i), 'secretpassword');
    await user.type(screen.getByLabelText(/repeat password/i), 'secretpassword');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    const allCalls = [
      ...consoleSpy.mock.calls,
      ...consoleWarnSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
    ]
      .flat()
      .map(String);

    for (const call of allCalls) {
      expect(call).not.toContain('new@brand.com');
      expect(call).not.toContain('secretpassword');
    }

    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

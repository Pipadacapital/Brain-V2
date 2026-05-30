// @paradigm: sql
// Tests for ForgotPasswordForm (Slice B — real Supabase resetPasswordForEmail).
// CF-C6-PII-CLIENT-1: email never logged; raw error detail never surfaced.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordForm } from '@/interfaces/components/auth/forgot-password-form.js';

const { resetMock } = vi.hoisted(() => ({ resetMock: vi.fn() }));
vi.mock('@/infrastructure/supabase/client.js', () => ({
  createSupabaseBrowserClient: () => ({ auth: { resetPasswordForEmail: resetMock } }),
}));

beforeEach(() => {
  resetMock.mockReset();
  Object.defineProperty(window, 'location', {
    value: { origin: 'http://localhost:3000' },
    writable: true,
  });
});

describe('ForgotPasswordForm — real Supabase reset', () => {
  it('renders email + send button (legacy Card design)', () => {
    render(<ForgotPasswordForm />);
    // Legacy label: "Email" (not "Work email")
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    // Legacy button copy: "Send reset email"
    expect(screen.getByRole('button', { name: /send reset email/i })).toBeInTheDocument();
  });

  it('renders legacy Card heading "Reset Your Password" and description', () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByText('Reset Your Password')).toBeInTheDocument();
    expect(screen.getByText(/type in your email/i)).toBeInTheDocument();
  });

  it('renders "Login" link back to /auth/login', () => {
    render(<ForgotPasswordForm />);
    const link = screen.getByRole('link', { name: /^login$/i });
    expect(link).toHaveAttribute('href', '/auth/login');
  });

  it('POSITIVE: resetPasswordForEmail called with redirectTo, shows success state', async () => {
    resetMock.mockResolvedValue({ error: null });
    render(<ForgotPasswordForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^email$/i), 'reset@brand.com');
    await user.click(screen.getByRole('button', { name: /send reset email/i }));

    await waitFor(() => {
      expect(resetMock).toHaveBeenCalledWith('reset@brand.com', {
        redirectTo: 'http://localhost:3000/auth/update-password',
      });
    });
    // Legacy success Card: "Check Your Email" heading + description
    await waitFor(() => {
      expect(screen.getByText('Check Your Email')).toBeInTheDocument();
      expect(screen.getByText(/password reset instructions sent/i)).toBeInTheDocument();
    });
  });

  it('NEGATIVE: Supabase error → generic message, raw detail NOT surfaced', async () => {
    resetMock.mockResolvedValue({
      error: { message: 'AuthApiError: rate limit exceeded for reset@brand.com' },
    });
    render(<ForgotPasswordForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^email$/i), 'reset@brand.com');
    await user.click(screen.getByRole('button', { name: /send reset email/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/could not send the reset email/i);
      expect(alert).not.toHaveTextContent(/AuthApiError/);
    });
    // Stays on the form (no success state).
    expect(screen.queryByText('Check Your Email')).not.toBeInTheDocument();
  });

  it('form has noValidate', () => {
    render(<ForgotPasswordForm />);
    const form = screen.getByRole('form', { name: /forgot password form/i });
    expect(form).toHaveAttribute('novalidate');
  });
});

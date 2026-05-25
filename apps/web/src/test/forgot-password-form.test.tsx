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
  it('renders email + send button', () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset email/i })).toBeInTheDocument();
  });

  it('POSITIVE: resetPasswordForEmail called with redirectTo, shows success state', async () => {
    resetMock.mockResolvedValue({ error: null });
    render(<ForgotPasswordForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/work email/i), 'reset@brand.com');
    await user.click(screen.getByRole('button', { name: /send reset email/i }));

    await waitFor(() => {
      expect(resetMock).toHaveBeenCalledWith('reset@brand.com', {
        redirectTo: 'http://localhost:3000/auth/update-password',
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
  });

  it('NEGATIVE: Supabase error → generic message, raw detail NOT surfaced', async () => {
    resetMock.mockResolvedValue({
      error: { message: 'AuthApiError: rate limit exceeded for reset@brand.com' },
    });
    render(<ForgotPasswordForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/work email/i), 'reset@brand.com');
    await user.click(screen.getByRole('button', { name: /send reset email/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/could not send the reset email/i);
      expect(alert).not.toHaveTextContent(/AuthApiError/);
    });
    // Stays on the form (no success state).
    expect(screen.queryByText(/instructions sent/i)).not.toBeInTheDocument();
  });

  it('form has noValidate', () => {
    render(<ForgotPasswordForm />);
    const form = screen.getByRole('form', { name: /forgot password form/i });
    expect(form).toHaveAttribute('novalidate');
  });
});

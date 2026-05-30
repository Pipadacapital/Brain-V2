// @paradigm: sql
// Tests for UpdatePasswordForm (Slice B — real Supabase updateUser).
// CF-C6-PII-CLIENT-1: password never logged; raw error detail never surfaced.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdatePasswordForm } from '@/interfaces/components/auth/update-password-form.js';

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

const { updateUserMock } = vi.hoisted(() => ({ updateUserMock: vi.fn() }));
vi.mock('@/infrastructure/supabase/client.js', () => ({
  createSupabaseBrowserClient: () => ({ auth: { updateUser: updateUserMock } }),
}));

beforeEach(() => {
  pushMock.mockClear();
  updateUserMock.mockReset();
});

describe('UpdatePasswordForm — real Supabase updateUser', () => {
  it('renders new-password field + save button (legacy Card design)', () => {
    render(<UpdatePasswordForm />);
    // Legacy label: "New password"
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
    // Legacy button copy: "Save new password"
    expect(screen.getByRole('button', { name: /save new password/i })).toBeInTheDocument();
  });

  it('renders legacy Card heading "Reset Your Password" and description', () => {
    render(<UpdatePasswordForm />);
    expect(screen.getByText('Reset Your Password')).toBeInTheDocument();
    expect(screen.getByText(/please enter your new password below/i)).toBeInTheDocument();
  });

  it('POSITIVE: updateUser({ password }) → navigates to /dashboard', async () => {
    updateUserMock.mockResolvedValue({ error: null });
    render(<UpdatePasswordForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/new password/i), 'brandnewpass');
    await user.click(screen.getByRole('button', { name: /save new password/i }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({ password: 'brandnewpass' });
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('NEGATIVE: Supabase error → generic message, raw detail NOT surfaced, no navigation', async () => {
    updateUserMock.mockResolvedValue({
      error: { message: 'AuthApiError: session expired token xyz' },
    });
    render(<UpdatePasswordForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/new password/i), 'brandnewpass');
    await user.click(screen.getByRole('button', { name: /save new password/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/could not update your password/i);
      expect(alert).not.toHaveTextContent(/AuthApiError/);
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('form has noValidate', () => {
    render(<UpdatePasswordForm />);
    const form = screen.getByRole('form', { name: /update password form/i });
    expect(form).toHaveAttribute('novalidate');
  });
});

describe('UpdatePasswordForm — PII client log negative test (CF-C6-PII-CLIENT-1)', () => {
  it('does not console.log the password on submit', async () => {
    updateUserMock.mockResolvedValue({ error: null });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<UpdatePasswordForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/new password/i), 'topsecretpass');
    await user.click(screen.getByRole('button', { name: /save new password/i }));

    const allCalls = [
      ...consoleSpy.mock.calls,
      ...consoleWarnSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
    ]
      .flat()
      .map(String);

    for (const call of allCalls) {
      expect(call).not.toContain('topsecretpass');
    }

    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

'use client';

// @paradigm: sql
// ForgotPasswordForm — Client Component (Slice B — feat-auth-supabase-recovery).
//
// Real auth: Supabase resetPasswordForEmail(email) → Supabase sends a recovery
//   email whose link returns to ${origin}/auth/update-password (where the user
//   sets a new password under the recovery session). On success we show a generic
//   "check your email" state (we do NOT confirm whether the address exists — that
//   would leak account-existence; the message is intentionally non-committal).
//
// CF-C6-PII-CLIENT-1: email NEVER logged; raw Supabase error detail NEVER surfaced.
// CF-C6-PERF-A11Y-1: WCAG AA labels, error roles, keyboard nav, noValidate.

import { useState, useId } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/infrastructure/supabase/client.js';

export function ForgotPasswordForm() {
  const emailId = useId();
  const errorId = useId();

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/update-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (resetError) {
        // Generic message — never echo the Supabase error detail (CF-C6-PII-CLIENT-1).
        setError('Could not send the reset email. Please try again.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Could not send the reset email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="bg-white py-8 px-6 shadow rounded-lg space-y-4 text-center">
        <h2 className="text-lg font-semibold text-gray-900">Check your email</h2>
        <p className="text-sm text-gray-600">
          If an account exists for that email, you will receive a link to reset your password.
        </p>
        <Link
          href="/auth/login"
          className="inline-block font-medium text-blue-600 hover:text-blue-700 text-sm"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white py-8 px-6 shadow rounded-lg space-y-6">
      <form
        onSubmit={handleSubmit}
        aria-label="Forgot password form"
        noValidate
        className="space-y-6"
      >
        <div className="space-y-1">
          <label htmlFor={emailId} className="block text-sm font-medium text-gray-700">
            Work email
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? 'true' : undefined}
          />
        </div>

        {error && (
          <p id={errorId} role="alert" aria-live="assertive" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Sending…' : 'Send reset email'}
        </button>
      </form>

      <p className="text-sm text-center text-gray-600">
        Remembered it?{' '}
        <Link href="/auth/login" className="font-medium text-blue-600 hover:text-blue-700">
          Sign in
        </Link>
      </p>
    </div>
  );
}

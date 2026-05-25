'use client';

// @paradigm: sql
// SignUpForm — Client Component (Slice B — feat-auth-supabase-recovery).
//
// Real auth: Supabase signUp(email, password) against the real Supabase project.
//   On success Supabase sends a confirmation email whose link returns to
//   ${origin}/auth/callback (exchangeCodeForSession — slice A). We then route to
//   /auth/sign-up-success ("check your email").
//
// NO backend/DB user creation here — that is slice C (onboarding / ensure-user).
// Slice B is Supabase-auth flows + pages only.
//
// CF-C6-PII-CLIENT-1: email/password NEVER logged; raw Supabase error detail
//   NEVER surfaced to the user (generic message only).
// CF-C6-PERF-A11Y-1: WCAG AA labels, error roles, keyboard nav, noValidate.

import { useState, useId } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/infrastructure/supabase/client.js';

export function SignUpForm() {
  const emailId = useId();
  const passwordId = useId();
  const repeatId = useId();
  const errorId = useId();

  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (password !== repeatPassword) {
      // Client-side guard — no network call until the passwords match.
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const emailRedirectTo = `${window.location.origin}/auth/callback`;
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo },
      });
      if (signUpError) {
        // Generic message — never echo the Supabase error detail (CF-C6-PII-CLIENT-1).
        setError('Could not create your account. Please try again.');
        return;
      }
      router.push('/auth/sign-up-success');
    } catch {
      setError('Could not create your account. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white py-8 px-6 shadow rounded-lg space-y-6">
      <form onSubmit={handleSubmit} aria-label="Sign up form" noValidate className="space-y-6">
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

        <div className="space-y-1">
          <label htmlFor={passwordId} className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor={repeatId} className="block text-sm font-medium text-gray-700">
            Repeat password
          </label>
          <input
            id={repeatId}
            type="password"
            autoComplete="new-password"
            required
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
          {isLoading ? 'Creating account…' : 'Sign up'}
        </button>
      </form>

      <p className="text-sm text-center text-gray-600">
        Already have an account?{' '}
        <Link href="/auth/login" className="font-medium text-blue-600 hover:text-blue-700">
          Sign in
        </Link>
      </p>
    </div>
  );
}

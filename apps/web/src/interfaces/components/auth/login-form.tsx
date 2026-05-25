'use client';

// @paradigm: sql
// LoginForm — Client Component.
// CF-C6-PII-CLIENT-1: email/password NEVER logged.
// CF-C6-PERF-A11Y-1: WCAG AA labels, error roles, keyboard nav.
// NOTE: In Phase-0 LOCAL harness, login is stubbed. Production auth
//   flows through Supabase JWT → BrainClaim via the api-gateway session endpoint.

import { useState, useId } from 'react';
import { useAppDispatch } from '@/domain/store/hooks.js';
import { setSession } from '@/domain/store/session-slice.js';

// Sugandh-Lok LOCAL harness stub credentials.
// SECURITY: These values are only active when NEXT_PUBLIC_BRAIN_LOCAL_HARNESS=true
// (set by the local dev .env.local). They must NEVER appear in production builds
// where this env var is absent/false.  SEC-C6-L1 disposition: gated, not removed,
// because the Phase-0 harness requires them; remove at production auth cutover.
const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true';
const STUB_EMAIL = 'founder@sugandhlok.com';
const STUB_PASSWORD = 'brain-local-dev';
const STUB_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  const dispatch = useAppDispatch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // LOCAL harness: accept stub credentials when harness flag is set.
      // Production path: NEXT_PUBLIC_BRAIN_LOCAL_HARNESS is absent → falls through
      // to the "Invalid email or password" error, ensuring prod users cannot stub-auth.
      // CF-C6-PII-CLIENT-1: never log email or password.
      if (IS_LOCAL_HARNESS && email === STUB_EMAIL && password === STUB_PASSWORD) {
        dispatch(
          setSession({
            userId: '00000000-0000-0000-0000-000000000099',
            workspaceId: STUB_WORKSPACE_ID,
            workspaceRole: 'OWNER',
          }),
        );
        if (onSuccess) onSuccess();
        else window.location.href = '/dashboard';
      } else {
        setError('Invalid email or password.');
      }
    } catch {
      // CF-C6-PII-CLIENT-1: no user data in the error.
      setError('Sign-in failed. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white py-8 px-6 shadow rounded-lg space-y-6"
      aria-label="Sign in form"
      noValidate
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

      <div className="space-y-1">
        <label htmlFor={passwordId} className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          aria-live="assertive"
          className="text-sm text-red-600"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isLoading ? 'Signing in…' : 'Sign in'}
      </button>

      {/* SEC-C6-L1: stub credential hint is ONLY shown when local harness flag is set.
          It is invisible in production builds (NEXT_PUBLIC_BRAIN_LOCAL_HARNESS absent). */}
      {IS_LOCAL_HARNESS && (
        <p className="text-xs text-center text-gray-400">
          LOCAL harness: {STUB_EMAIL} / brain-local-dev
        </p>
      )}
    </form>
  );
}

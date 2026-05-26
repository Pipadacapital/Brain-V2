'use client';

// @paradigm: sql
// LoginForm — Client Component (Slice A — feat-auth-supabase-identity).
//
// Real auth (default): Supabase signInWithPassword (email/pw) + signInWithOAuth
//   ('google') against the real Supabase project. On success the @supabase/ssr
//   browser client sets the session cookies; we navigate to /dashboard.
// LOCAL harness (NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true' ONLY): the offline
//   stub path is kept as a fallback so the app boots without network.
//
// CF-C6-PII-CLIENT-1: email/password/token NEVER logged.
// CF-C6-PERF-A11Y-1: WCAG AA labels, error roles, keyboard nav.

import { useState, useId, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppDispatch } from '@/domain/store/hooks.js';
import { setSession } from '@/domain/store/session-slice.js';
import { createSupabaseBrowserClient } from '@/infrastructure/supabase/client.js';

// LOCAL harness flag — when true, the offline stub login is available as a fallback.
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
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Surface a reason when the app bounced us back here (e.g. SessionBootstrap could
  // not resolve a session on a protected route). Read from the URL client-side to
  // avoid a useSearchParams Suspense boundary.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('error');
    if (reason === 'session') {
      setError('Your session has expired or could not be verified. Please sign in again.');
    }
  }, []);

  const goToDashboard = () => {
    if (onSuccess) onSuccess();
    else router.push('/dashboard');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // LOCAL harness fallback (flag-gated): accept stub credentials offline.
      // CF-C6-PII-CLIENT-1: never log email or password.
      if (IS_LOCAL_HARNESS && email === STUB_EMAIL && password === STUB_PASSWORD) {
        dispatch(
          setSession({
            userId: '00000000-0000-0000-0000-000000000099',
            workspaceId: STUB_WORKSPACE_ID,
            workspaceRole: 'OWNER',
          }),
        );
        goToDashboard();
        return;
      }

      // REAL auth: Supabase email/password.
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        // Generic message — never echo the Supabase error detail (CF-C6-PII-CLIENT-1).
        setError('Invalid email or password.');
        return;
      }
      // Hard navigation so the middleware re-evaluates with the fresh session
      // cookie and the tRPC client picks up the new access token.
      window.location.assign('/dashboard');
    } catch {
      setError('Sign-in failed. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (oauthError) {
        setError('Could not start Google sign-in.');
        setIsLoading(false);
      }
      // On success the browser is redirected to Google; no further code runs here.
    } catch {
      setError('Could not start Google sign-in.');
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white py-8 px-6 shadow rounded-lg space-y-6">
      <form onSubmit={handleSubmit} aria-label="Sign in form" noValidate className="space-y-6">
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
          <div className="flex items-center justify-between">
            <label htmlFor={passwordId} className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <Link
              href="/auth/forgot-password"
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Forgot password?
            </Link>
          </div>
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
          <p id={errorId} role="alert" aria-live="assertive" className="text-sm text-red-600">
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
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-2 text-gray-400">or</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={isLoading}
        className="w-full flex justify-center items-center gap-2 py-2 px-4 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
        aria-label="Sign in with Google"
      >
        Sign in with Google
      </button>

      <p className="text-sm text-center text-gray-600">
        Don&apos;t have an account?{' '}
        <Link href="/auth/sign-up" className="font-medium text-blue-600 hover:text-blue-700">
          Sign up
        </Link>
      </p>

      {/* The stub credential hint is ONLY shown under the local harness flag. */}
      {IS_LOCAL_HARNESS && (
        <p className="text-xs text-center text-gray-400">
          LOCAL harness: {STUB_EMAIL} / brain-local-dev
        </p>
      )}
    </div>
  );
}

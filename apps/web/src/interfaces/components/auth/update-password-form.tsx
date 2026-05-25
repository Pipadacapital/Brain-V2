'use client';

// @paradigm: sql
// UpdatePasswordForm — Client Component (Slice B — feat-auth-supabase-recovery).
//
// Real auth: the user arrives here via the recovery link in the password-reset
//   email, which has already established a recovery SESSION (slice A's
//   @supabase/ssr cookie handling). updateUser({ password }) sets the new
//   password under that session; on success we navigate to /dashboard
//   (membership resolution is slice C — any authed user maps to the seed
//   workspace via the LocalSeedMembershipResolver).
//
// CF-C6-PII-CLIENT-1: password NEVER logged; raw Supabase error detail NEVER surfaced.
// CF-C6-PERF-A11Y-1: WCAG AA labels, error roles, keyboard nav, noValidate.

import { useState, useId } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/infrastructure/supabase/client.js';

export function UpdatePasswordForm() {
  const passwordId = useId();
  const errorId = useId();

  const router = useRouter();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        // Generic message — never echo the Supabase error detail (CF-C6-PII-CLIENT-1).
        setError('Could not update your password. The reset link may have expired.');
        return;
      }
      router.push('/dashboard');
    } catch {
      setError('Could not update your password. The reset link may have expired.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white py-8 px-6 shadow rounded-lg space-y-6">
      <form
        onSubmit={handleSubmit}
        aria-label="Update password form"
        noValidate
        className="space-y-6"
      >
        <div className="space-y-1">
          <label htmlFor={passwordId} className="block text-sm font-medium text-gray-700">
            New password
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          {isLoading ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </div>
  );
}

// @paradigm: sql
// Sign-up success (Slice B) — /auth/sign-up-success.
// Static "check your email" confirmation shown after a successful signUp.
// No PII, no form, no Supabase call.
// CF-C6-PII-CLIENT-1 / CF-C6-PERF-A11Y-1.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Confirm your email — Brain',
};

export default function AuthSignUpSuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-xl font-semibold text-gray-900">Check your email</h1>
        <p className="text-sm text-gray-600">
          We sent you a confirmation link. Click it to activate your account, then sign in.
        </p>
        <Link
          href="/auth/login"
          className="inline-block py-2 px-4 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

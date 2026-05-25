// @paradigm: sql
// Auth error landing (Slice A) — /auth/auth-code-error.
// Generic, no detail leaked (CF-C6-PII-CLIENT-1).

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sign-in problem — Brain',
};

export default function AuthCodeErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-xl font-semibold text-gray-900">We could not sign you in</h1>
        <p className="text-sm text-gray-600">
          The sign-in link was invalid or expired. Please try again.
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

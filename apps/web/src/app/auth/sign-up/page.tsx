// @paradigm: sql
// Sign-up page (Slice B) — /auth/sign-up.
// Server Component shell + the real Supabase sign-up form.
// CF-C6-PII-CLIENT-1: no PII in client logs.
// CF-C6-PERF-A11Y-1: WCAG AA labels, keyboard navigable.

import type { Metadata } from 'next';
import { SignUpForm } from '@/interfaces/components/auth/sign-up-form.js';

export const metadata: Metadata = {
  title: 'Sign up — Brain',
};

export default function AuthSignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
          <p className="mt-1 text-sm text-gray-600">Brain — DTC Analytics OS</p>
        </div>
        <SignUpForm />
      </div>
    </div>
  );
}

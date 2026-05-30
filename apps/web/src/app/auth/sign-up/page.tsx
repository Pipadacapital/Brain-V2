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
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <SignUpForm />
      </div>
    </div>
  );
}

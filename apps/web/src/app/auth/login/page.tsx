// @paradigm: sql
// Canonical login page (Slice A) — /auth/login.
// Server Component shell + the real Supabase auth form (email/pw + Google).
// CF-C6-PII-CLIENT-1: no PII in client logs.
// CF-C6-PERF-A11Y-1: WCAG AA labels, keyboard navigable.

import type { Metadata } from 'next';
import { LoginForm } from '@/interfaces/components/auth/login-form.js';

export const metadata: Metadata = {
  title: 'Sign in — Brain',
};

export default function AuthLoginPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  );
}

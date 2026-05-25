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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Brain</h1>
          <p className="mt-1 text-sm text-gray-600">DTC Analytics OS</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}

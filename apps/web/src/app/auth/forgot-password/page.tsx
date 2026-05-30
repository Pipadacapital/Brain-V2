// @paradigm: sql
// Forgot-password page (Slice B) — /auth/forgot-password.
// Server Component shell + the real Supabase reset-request form.
// CF-C6-PII-CLIENT-1 / CF-C6-PERF-A11Y-1.

import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/interfaces/components/auth/forgot-password-form.js';

export const metadata: Metadata = {
  title: 'Reset your password — Brain',
};

export default function AuthForgotPasswordPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
          <p className="mt-1 text-sm text-gray-600">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}

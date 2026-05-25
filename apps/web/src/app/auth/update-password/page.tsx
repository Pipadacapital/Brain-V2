// @paradigm: sql
// Update-password page (Slice B) — /auth/update-password.
// Reached via the recovery link in the password-reset email (the link
// establishes a recovery session). Server Component shell + the new-password form.
// CF-C6-PII-CLIENT-1 / CF-C6-PERF-A11Y-1.

import type { Metadata } from 'next';
import { UpdatePasswordForm } from '@/interfaces/components/auth/update-password-form.js';

export const metadata: Metadata = {
  title: 'Set a new password — Brain',
};

export default function AuthUpdatePasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Set a new password</h1>
          <p className="mt-1 text-sm text-gray-600">Enter your new password below.</p>
        </div>
        <UpdatePasswordForm />
      </div>
    </div>
  );
}

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
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <UpdatePasswordForm />
      </div>
    </div>
  );
}

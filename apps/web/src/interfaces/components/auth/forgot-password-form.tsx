'use client';

// @paradigm: sql
// ForgotPasswordForm — Client Component (Slice B — feat-auth-supabase-recovery).
//
// Real auth: Supabase resetPasswordForEmail(email) → Supabase sends a recovery
//   email whose link returns to ${origin}/auth/update-password (where the user
//   sets a new password under the recovery session). On success we show a generic
//   "check your email" state (we do NOT confirm whether the address exists — that
//   would leak account-existence; the message is intentionally non-committal).
//
// CF-C6-PII-CLIENT-1: email NEVER logged; raw Supabase error detail NEVER surfaced.
// CF-C6-PERF-A11Y-1: WCAG AA labels, error roles, keyboard nav, noValidate.

import { useState, useId } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/infrastructure/supabase/client.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/interfaces/components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/interfaces/components/ui/card.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';

interface ForgotPasswordFormProps {
  className?: string;
}

export function ForgotPasswordForm({ className }: ForgotPasswordFormProps) {
  const emailId = useId();
  const errorId = useId();

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/update-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (resetError) {
        // Generic message — never echo the Supabase error detail (CF-C6-PII-CLIENT-1).
        setError('Could not send the reset email. Please try again.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Could not send the reset email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {success ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Check Your Email</CardTitle>
            <CardDescription>Password reset instructions sent</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              If you registered using your email and password, you will receive a password reset
              email.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Reset Your Password</CardTitle>
            <CardDescription>
              Type in your email and we&apos;ll send you a link to reset your password
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit}
              aria-label="Forgot password form"
              noValidate
            >
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor={emailId}>Email</Label>
                  <Input
                    id={emailId}
                    type="email"
                    placeholder="m@example.com"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-describedby={error ? errorId : undefined}
                    aria-invalid={error ? 'true' : undefined}
                  />
                </div>
                {error && (
                  <p id={errorId} role="alert" aria-live="assertive" className="text-sm text-red-500">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Sending...' : 'Send reset email'}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                Already have an account?{' '}
                <Link href="/auth/login" className="underline underline-offset-4">
                  Login
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

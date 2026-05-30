'use client';

// @paradigm: sql
// UpdatePasswordForm — Client Component (Slice B — feat-auth-supabase-recovery).
//
// Real auth: the user arrives here via the recovery link in the password-reset
//   email, which has already established a recovery SESSION (slice A's
//   @supabase/ssr cookie handling). updateUser({ password }) sets the new
//   password under that session; on success we navigate to /dashboard
//   (membership resolution is slice C — any authed user maps to the seed
//   workspace via the LocalSeedMembershipResolver).
//
// CF-C6-PII-CLIENT-1: password NEVER logged; raw Supabase error detail NEVER surfaced.
// CF-C6-PERF-A11Y-1: WCAG AA labels, error roles, keyboard nav, noValidate.

import { useState, useId } from 'react';
import { useRouter } from 'next/navigation';
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

interface UpdatePasswordFormProps {
  className?: string;
}

export function UpdatePasswordForm({ className }: UpdatePasswordFormProps) {
  const passwordId = useId();
  const errorId = useId();

  const router = useRouter();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        // Generic message — never echo the Supabase error detail (CF-C6-PII-CLIENT-1).
        setError('Could not update your password. The reset link may have expired.');
        return;
      }
      router.push('/dashboard');
    } catch {
      setError('Could not update your password. The reset link may have expired.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Reset Your Password</CardTitle>
          <CardDescription>Please enter your new password below.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit}
            aria-label="Update password form"
            noValidate
          >
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor={passwordId}>New password</Label>
                <Input
                  id={passwordId}
                  type="password"
                  placeholder="New password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
                {isLoading ? 'Saving...' : 'Save new password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

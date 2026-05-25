// @paradigm: sql
// Onboarding page (Slice C) — /onboarding.
// Server Component shell: requires a real Supabase session; unauthenticated → /auth/login.
// The multi-step form (client) calls the tRPC onboarding.complete procedure, which
// creates the workspace + OWNER membership in the LOCAL dev DB and redirects to /dashboard.
//
// Harness note: under NEXT_PUBLIC_BRAIN_LOCAL_HARNESS the offline stub is already a
// member of Sugandh-Lok, so onboarding is a real-auth concern. The middleware lets
// /auth/* and the shell through; /onboarding is reachable post-login.
//
// CF-C6-PII-CLIENT-1: never log email or token.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/infrastructure/supabase/server.js';
import { OnboardingForm } from '@/interfaces/components/onboarding/onboarding-form.js';

export const metadata: Metadata = {
  title: 'Set up your workspace — Brain',
};

const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true';

export default async function OnboardingPage() {
  let defaultFullName = '';

  // Real auth: confirm a session exists; derive a default display name from the
  // verified user metadata (never logged). Offline harness: skip the Supabase call.
  if (!IS_LOCAL_HARNESS) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect('/auth/login');
    }
    defaultFullName =
      (user.user_metadata?.['full_name'] as string | undefined) ??
      (user.user_metadata?.['name'] as string | undefined) ??
      '';
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Set up your workspace</h1>
          <p className="mt-1 text-sm text-gray-600">A few quick steps to get started.</p>
        </div>
        <OnboardingForm defaultFullName={defaultFullName} />
      </div>
    </div>
  );
}

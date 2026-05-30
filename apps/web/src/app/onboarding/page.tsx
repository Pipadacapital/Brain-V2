// @paradigm: sql
// Onboarding page (Wave 2 parity) — /onboarding.
// Server Component shell: requires a real Supabase session; unauthenticated → /auth/login.
// Fetches the user's current membership count (via user.me) to detect the
// "add another workspace" flow (isNewWorkspace=true → profile step is skipped).
//
// The multi-step form (client) calls the tRPC onboarding.complete procedure, which
// creates the workspace + OWNER membership in the LOCAL dev DB, then redirects to
// /w/{slug}/dashboard (workspace-scoped URL, matching legacy).
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

/** Fetch the user's memberships count from the gateway using the session token. */
async function fetchMembershipCount(accessToken: string): Promise<number> {
  try {
    const gatewayUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const url = `${gatewayUrl}/trpc/user.me?batch=1&input=${encodeURIComponent('{"0":{}}')}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return 0;
    const body = (await res.json()) as Array<{
      result?: { data?: { json?: { memberships?: unknown[] } } };
    }>;
    const memberships = body?.[0]?.result?.data?.json?.memberships;
    return Array.isArray(memberships) ? memberships.length : 0;
  } catch {
    return 0;
  }
}

export default async function OnboardingPage() {
  let defaultFullName = '';
  let email = '';
  let isNewWorkspace = false;

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
    email = user.email ?? '';

    // Detect "add another workspace" mode — any existing membership means the user
    // is onboarding a second workspace, so the profile step is skipped (matching legacy).
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      const count = await fetchMembershipCount(session.access_token);
      isNewWorkspace = count > 0;
    }
  }

  const heading = isNewWorkspace ? 'Create a new workspace' : 'Welcome to Brain Analytics';
  const subtitle = isNewWorkspace
    ? 'Add another workspace to your account.'
    : "Let's get you set up in a few quick steps.";

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <OnboardingForm
          defaultFullName={defaultFullName}
          email={email}
          isNewWorkspace={isNewWorkspace}
        />
      </div>
    </div>
  );
}

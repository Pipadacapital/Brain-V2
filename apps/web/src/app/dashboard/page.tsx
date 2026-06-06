// @paradigm: sql
// /dashboard — canonical redirect landing page.
//
// The auth middleware redirects authenticated users from /auth/login to /dashboard.
// This Server Component resolves the user's active workspace slug and immediately
// redirects to /w/{slug}/dashboard — making the workspace-scoped URL the actual
// live URL in the browser.
//
// If the gateway call fails (no membership yet, session expired, etc.) we redirect
// to /onboarding so the user can set up their workspace, matching the legacy flow.
//
// CF-C6-PII-CLIENT-1: never log email or token.

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/infrastructure/supabase/server.js';
import { fetchActiveWorkspaceSlug } from '@/infrastructure/active-workspace.js';

const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true';

export default async function DashboardRedirectPage() {
  // Local harness: no Supabase — redirect to a hardcoded dev slug.
  if (IS_LOCAL_HARNESS) {
    redirect('/w/local-dev/dashboard');
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/auth/login');
  }

  const slug = await fetchActiveWorkspaceSlug(session.access_token);
  if (!slug) {
    // No workspace found — user needs onboarding.
    redirect('/onboarding');
  }

  redirect(`/w/${slug}/dashboard`);
}

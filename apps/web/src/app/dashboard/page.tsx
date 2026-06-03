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

const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true';

/** Fetch the user's active workspace slug from the gateway using the session token. */
async function fetchActiveWorkspaceSlug(accessToken: string): Promise<string | null> {
  try {
    const gatewayUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    // auth.session returns workspaceId + workspaceRole; we also need the slug from workspace.list
    const url = `${gatewayUrl}/trpc/workspace.list?batch=1&input=${encodeURIComponent('{"0":{}}')}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{
      result?: { data?: { json?: { workspaces?: Array<{ slug?: string; isDefault?: boolean }> } } };
    }>;
    const workspaces = body?.[0]?.result?.data?.json?.workspaces;
    if (!Array.isArray(workspaces) || workspaces.length === 0) return null;
    // Prefer the first workspace (the default/active one as determined by the gateway)
    return workspaces[0]?.slug ?? null;
  } catch {
    return null;
  }
}

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

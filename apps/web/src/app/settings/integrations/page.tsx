// @paradigm: sql
// Bare /settings/integrations — resolver landing for the connector OAuth callback.
//
// The provider callback (api/integrations/<vendor>/callback) redirects the browser
// here with ?connected={vendor} | ?error=<slug>&vendor=<v>. This Server Component
// resolves the user's active workspace slug and redirects to
// /w/{slug}/settings/integrations, PRESERVING the query — so the post-connect
// status banner lands on the real workspace-scoped page instead of 404'ing.
// Mirrors the /dashboard resolver. CF-C6-PII-CLIENT-1: never log email/token.

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/infrastructure/supabase/server.js';
import { fetchActiveWorkspaceSlug } from '@/infrastructure/active-workspace.js';

const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true';

function buildQuery(sp: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') params.set(k, v);
    else if (Array.isArray(v) && typeof v[0] === 'string') params.set(k, v[0]);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export default async function IntegrationsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tail = `/settings/integrations${buildQuery(await searchParams)}`;

  // Local harness: no Supabase — redirect to the hardcoded dev slug.
  if (IS_LOCAL_HARNESS) {
    redirect(`/w/local-dev${tail}`);
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
    redirect('/onboarding');
  }

  redirect(`/w/${slug}${tail}`);
}

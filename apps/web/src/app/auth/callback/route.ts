// @paradigm: sql
// OAuth / PKCE callback (Slice A + C) — /auth/callback.
// Exchanges the auth code for a session (sets the Supabase cookies), then routes via
// the /me-equivalent gate: a user with NO workspace membership → /onboarding; a member
// → /dashboard (or an explicit ?next when provided). Per @supabase/ssr SSR guide.
//
// CF-C6-PII-CLIENT-1: never log email or token; never put a token in a URL.

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/infrastructure/supabase/server.js';
import { decidePostAuthPath } from '@/infrastructure/post-auth-routing.js';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // An explicit ?next (e.g. an invite path) takes precedence.
      if (next) return NextResponse.redirect(`${origin}${next}`);
      // Otherwise decide onboarding-vs-dashboard via user.me (Slice C).
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const path = session?.access_token
        ? await decidePostAuthPath(session.access_token)
        : '/dashboard';
      return NextResponse.redirect(`${origin}${path}`);
    }
  }

  // No code, or exchange failed → generic error page (no detail leaked).
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}

// @paradigm: sql
// OAuth / PKCE callback (Slice A) — /auth/callback.
// Exchanges the auth code for a session (sets the Supabase cookies), then
// redirects to the post-login landing (/dashboard) or ?next=.
// Per @supabase/ssr SSR guide.
//
// CF-C6-PII-CLIENT-1: never log email or token; never put a token in a URL.

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/infrastructure/supabase/server.js';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // No code, or exchange failed → generic error page (no detail leaked).
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}

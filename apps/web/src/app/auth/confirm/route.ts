// @paradigm: sql
// Email-confirmation / OTP verify (Slice B + C) — /auth/confirm.
// Handles the email-link `verifyOtp` flow (signup confirmation, magic link,
// email change). Reads `token_hash` + `type`, verifies via Supabase, then routes via
// the /me-equivalent gate (Slice C): a user with NO workspace membership →
// /onboarding; a member → /dashboard. An explicit same-origin ?next still wins.
// On missing params or verify error → /auth/auth-code-error.
//
// Slice C closes the legacy gap this handler previously deferred: it now upserts the
// user (via user.me) and decides onboarding-vs-dashboard from REAL membership.
//
// CF-C6-PII-CLIENT-1: never log email/token; never surface raw error detail;
//   never put a token in a redirect URL.

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/infrastructure/supabase/server.js';
import { decidePostAuthPath } from '@/infrastructure/post-auth-routing.js';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const nextParam = searchParams.get('next');
  // Only honour same-origin relative paths to avoid an open-redirect.
  const next = nextParam && nextParam.startsWith('/') ? nextParam : null;

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      if (next) return NextResponse.redirect(`${origin}${next}`);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const path = session?.access_token
        ? await decidePostAuthPath(session.access_token)
        : '/dashboard';
      return NextResponse.redirect(`${origin}${path}`);
    }
  }

  // No token/type, or verify failed → generic error page (no detail leaked).
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}

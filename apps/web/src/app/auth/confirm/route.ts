// @paradigm: sql
// Email-confirmation / OTP verify (Slice B) — /auth/confirm.
// Handles the email-link `verifyOtp` flow (signup confirmation, magic link,
// email change). Reads `token_hash` + `type` from the query, verifies via
// Supabase, then redirects to /dashboard on success (membership resolution is
// slice C — the LocalSeedMembershipResolver maps any authed user to the seed
// workspace). On missing params or verify error → /auth/auth-code-error.
//
// NOTE: legacy /auth/confirm also called /api/user/ensure + /me and resolved a
// workspace slug. That backend/DB onboarding is SLICE C and is intentionally
// omitted here — slice B is Supabase-auth flows only.
//
// CF-C6-PII-CLIENT-1: never log email/token; never surface raw error detail;
//   never put a token in a redirect URL.

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/infrastructure/supabase/server.js';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const nextParam = searchParams.get('next');
  // Only honour same-origin relative paths to avoid an open-redirect.
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/dashboard';

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // No token/type, or verify failed → generic error page (no detail leaked).
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}

// @paradigm: sql
// Supabase browser client (Slice A — feat-auth-supabase-identity).
// Used by Client Components (login form) for signInWithPassword / signInWithOAuth
// and to read the current session's access token for the tRPC Bearer header.
//
// CF-C6-PII-CLIENT-1: never log email or token.

import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required ' +
        'for real auth. Set them in apps/web/.env.local (see .env.example).',
    );
  }
  return createBrowserClient(url, key);
}

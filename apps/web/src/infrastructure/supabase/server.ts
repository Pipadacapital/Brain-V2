// @paradigm: sql
// Supabase server client (Slice A). Cookie-backed — used by the /auth/callback
// route handler (exchangeCodeForSession) and Server Components / RSC that need
// the session. Per @supabase/ssr SSR guide.
//
// CF-C6-PII-CLIENT-1: never log email or token.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required ' +
        'for real auth. Set them in apps/web/.env.local (see .env.example).',
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // setAll called from a Server Component — safe to ignore when the
          // session is refreshed by middleware (per @supabase/ssr guidance).
        }
      },
    },
  });
}

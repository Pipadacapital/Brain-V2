// @paradigm: sql
// Supabase session refresh for Next middleware (Slice A). Per @supabase/ssr SSR guide.
// Refreshes the auth cookies on every matched request and returns the resolved
// user so the middleware can enforce route protection.
//
// CF-C6-PII-CLIENT-1: never log email or token.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  user: { id: string } | null;
}> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    // Misconfigured env — fail closed (treat as unauthenticated). Do not crash
    // the edge middleware; the route guard will redirect to /auth/login.
    return { response, user: null };
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT (@supabase/ssr): use getUser() — it revalidates the token with the
  // Supabase Auth server. Do NOT trust getSession() in server code.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user: user ? { id: user.id } : null };
}

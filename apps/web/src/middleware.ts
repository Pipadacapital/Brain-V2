// @paradigm: sql
// Next middleware — route protection (Slice A).
// Unauthenticated users hitting a protected (shell) route are redirected to
// /auth/login. Authenticated users hitting /auth/login are sent to /dashboard.
//
// Harness bypass: when NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true' the middleware
// performs NO Supabase calls and allows everything (offline dev). The default
// (flag absent/false) is REAL auth.
//
// CF-C6-PII-CLIENT-1: never log email or token.

import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/infrastructure/supabase/middleware.js';

const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true';

/** Paths that are always reachable without a session. */
const PUBLIC_PREFIXES = ['/auth/', '/login'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Offline harness: skip all auth, allow everything.
  if (IS_LOCAL_HARNESS) {
    return NextResponse.next();
  }

  // Real auth: refresh the session cookies and resolve the user.
  const { response, user } = await updateSession(request);

  // Unauthenticated + protected route → redirect to /auth/login.
  if (!user && !isPublic(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/auth/login';
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated + on the login page → go to the dashboard.
  if (user && (pathname === '/auth/login' || pathname === '/login')) {
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = '/dashboard';
    return NextResponse.redirect(dashUrl);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals + static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

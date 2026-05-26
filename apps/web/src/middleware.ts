// @paradigm: sql
// Next middleware — route protection (Slice A) + correlation ID generation.
//
// Two responsibilities, both per-request:
//
// 1. Auth (Slice A):
//    Unauthenticated users hitting a protected (shell) route are redirected to
//    /auth/login. Authenticated users hitting /auth/login are sent to /dashboard.
//    Harness bypass: NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true' performs NO
//    Supabase calls and allows everything (offline dev). Default = REAL auth.
//
// 2. Correlation (observability spine):
//    Generates `x-request-id` + `x-trace-id` UUIDs when the incoming request
//    has none, attaches them to the OUTGOING response (so the browser can
//    surface them in DevTools / error reports), and logs the per-request
//    line. The same request_id flows to the api-gateway via the tRPC client
//    header injection (apps/web/src/infrastructure/trpc-client.ts) so one
//    correlation ID traces a user action end-to-end: browser → web SSR/
//    middleware → gateway → core → DB and back.
//
// CF-C6-PII-CLIENT-1: never log email or token.

import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/infrastructure/supabase/middleware.js';
import { webLogger } from '@/infrastructure/logger.js';
// Browser-safe subpath — Next.js middleware runs on the Edge runtime which
// does not have Node's std-lib (pino's stdSerializers fail there). Using the
// /correlation subpath keeps pino out of the middleware bundle.
import {
  newCorrelationId,
  REQUEST_ID_HEADER,
  TRACE_ID_HEADER,
} from '@brain/lib-logger/correlation';

const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true';

/** Paths that are always reachable without a session. */
const PUBLIC_PREFIXES = ['/auth/', '/login'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * Pull the correlation 4-tuple from incoming headers; mint fresh UUIDs when
 * absent. Browser-initiated navigations don't send these headers, so the first
 * hop (this middleware) is where they're typically created. Direct API calls
 * from another service would send them upstream and we'd preserve.
 */
function resolveCorrelation(request: NextRequest): {
  request_id: string;
  trace_id: string;
} {
  const request_id = request.headers.get(REQUEST_ID_HEADER) || newCorrelationId();
  const trace_id = request.headers.get(TRACE_ID_HEADER) || newCorrelationId();
  return { request_id, trace_id };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const started = Date.now();

  const correlation = resolveCorrelation(request);
  const log = webLogger().child({
    request_id: correlation.request_id,
    trace_id: correlation.trace_id,
    route: pathname,
    method: request.method,
  });

  // Helper to stamp the correlation headers onto whatever response we return,
  // so the browser sees them in DevTools + the server logs of any downstream
  // hop see the SAME request_id (propagation contract).
  const stamp = (resp: NextResponse): NextResponse => {
    resp.headers.set(REQUEST_ID_HEADER, correlation.request_id);
    resp.headers.set(TRACE_ID_HEADER, correlation.trace_id);
    return resp;
  };

  // Offline harness: skip all auth, allow everything (still log + stamp).
  if (IS_LOCAL_HARNESS) {
    log.info({ duration_ms: Date.now() - started, harness: true }, 'middleware: allow (harness)');
    return stamp(NextResponse.next());
  }

  // Real auth: refresh the session cookies and resolve the user.
  const { response, user } = await updateSession(request);

  // Copy any refreshed Supabase cookies from `response` onto a redirect
  // response. updateSession() rotates the access token during getUser() and
  // stamps the new cookies on `response` — if we return a fresh
  // NextResponse.redirect() without those cookies, the next request lands
  // with the old (now-invalid) token and the user gets bounced back to login.
  // Bug surfaced post-Docker as a tight redirect-to-login loop after a
  // successful Google OAuth callback. See @supabase/ssr SSR guide.
  const propagateCookies = (target: NextResponse): NextResponse => {
    response.cookies.getAll().forEach((c) => {
      target.cookies.set(c.name, c.value, c);
    });
    return target;
  };

  // Unauthenticated + protected route → redirect to /auth/login.
  if (!user && !isPublic(pathname)) {
    log.info(
      { duration_ms: Date.now() - started, decision: 'redirect-to-login' },
      'middleware: unauthenticated → /auth/login',
    );
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/auth/login';
    return stamp(propagateCookies(NextResponse.redirect(loginUrl)));
  }

  // Authenticated + on the login page → go to the dashboard.
  if (user && (pathname === '/auth/login' || pathname === '/login')) {
    log.info(
      {
        duration_ms: Date.now() - started,
        decision: 'redirect-to-dashboard',
        user_id: user.id,  // sub only — never email
      },
      'middleware: authenticated on login → /dashboard',
    );
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = '/dashboard';
    return stamp(propagateCookies(NextResponse.redirect(dashUrl)));
  }

  log.info(
    {
      duration_ms: Date.now() - started,
      decision: 'pass',
      authenticated: Boolean(user),
      ...(user ? { user_id: user.id } : {}),
    },
    'middleware: pass',
  );
  return stamp(response);
}

export const config = {
  // Run on everything except Next internals + static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

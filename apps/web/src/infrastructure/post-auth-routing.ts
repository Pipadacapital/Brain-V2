// @paradigm: sql
// Post-auth routing decision (Slice C) — the /me-equivalent gate.
//
// After a session is established (/auth/callback or /auth/confirm), decide whether to
// send the user to /onboarding (no workspace membership yet) or /dashboard (has a
// membership). This calls the gateway's tRPC `user.me` procedure with the verified
// session access token as a Bearer — the SAME verify→resolve path every other authed
// call uses. `user.me` upserts the users row and returns `needsOnboarding`.
//
// FAIL-SAFE: if the gateway is unreachable or returns an error, default to /dashboard
// (the dashboard itself renders the honest empty-state via workspace.dataAvailability,
// and the gateway still fail-closes any workspace-data call). We NEVER block login on
// this convenience routing. CF-C6-PII-CLIENT-1: never log email or token.

function gatewayUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

/**
 * @param accessToken the verified Supabase session access token (a credential —
 *   passed as a Bearer to the gateway, never logged, never put in a URL).
 * @returns the path to redirect to: '/onboarding' or '/dashboard'.
 */
export async function decidePostAuthPath(accessToken: string): Promise<string> {
  try {
    // tRPC query over httpBatchLink wire format: GET /trpc/user.me?batch=1&input=...
    const url = `${gatewayUrl()}/trpc/user.me?batch=1&input=${encodeURIComponent('{"0":{}}')}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      // The route handler runs server-side per request; no caching of an auth call.
      cache: 'no-store',
    });
    if (!res.ok) return '/dashboard';
    const body = (await res.json()) as Array<{
      result?: { data?: { json?: { needsOnboarding?: boolean } } };
    }>;
    const needsOnboarding = body?.[0]?.result?.data?.json?.needsOnboarding;
    return needsOnboarding ? '/onboarding' : '/dashboard';
  } catch {
    // Gateway unreachable / parse error → never block login; dashboard handles empty state.
    return '/dashboard';
  }
}

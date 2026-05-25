// @paradigm: sql
// Tests for the /auth/confirm route handler (Slice B — verifyOtp).
// CF-C6-PII-CLIENT-1: no token/email leaked; error → generic auth-code-error page.
//
// We mock the Supabase server client and capture NextResponse.redirect targets.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { verifyOtpMock, getSessionMock, decidePostAuthPathMock } = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
  getSessionMock: vi.fn(),
  decidePostAuthPathMock: vi.fn(),
}));
vi.mock('@/infrastructure/supabase/server.js', () => ({
  createSupabaseServerClient: async () => ({
    auth: { verifyOtp: verifyOtpMock, getSession: getSessionMock },
  }),
}));
// Slice C: the route routes via the /me-equivalent gate. Mock it so the test asserts
// the route delegates the onboarding-vs-dashboard decision (proven separately).
vi.mock('@/infrastructure/post-auth-routing.js', () => ({
  decidePostAuthPath: decidePostAuthPathMock,
}));

// Capture redirect targets without booting the Next runtime.
vi.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: string | URL) => ({ redirectedTo: String(url) }),
  },
}));

import { GET } from '@/app/auth/confirm/route.js';

/** Build a minimal NextRequest-like object exposing nextUrl. */
function makeRequest(url: string) {
  const u = new URL(url);
  return { nextUrl: u } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  verifyOtpMock.mockReset();
  getSessionMock.mockReset();
  decidePostAuthPathMock.mockReset();
  // Default: a session exists and the gate sends members to /dashboard.
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  decidePostAuthPathMock.mockResolvedValue('/dashboard');
});

describe('/auth/confirm route handler', () => {
  it('POSITIVE: valid token_hash + type → verifyOtp called, routes via the /me gate', async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    const res = (await GET(
      makeRequest('http://localhost:3000/auth/confirm?token_hash=abc123&type=signup'),
    )) as unknown as { redirectedTo: string };

    expect(verifyOtpMock).toHaveBeenCalledWith({ type: 'signup', token_hash: 'abc123' });
    // Slice C: the gate decided /dashboard (member). The token went to the gate, not a URL.
    expect(decidePostAuthPathMock).toHaveBeenCalledWith('tok');
    expect(res.redirectedTo).toBe('http://localhost:3000/dashboard');
  });

  it('Slice C: a no-membership user is routed to /onboarding by the gate', async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    decidePostAuthPathMock.mockResolvedValue('/onboarding');
    const res = (await GET(
      makeRequest('http://localhost:3000/auth/confirm?token_hash=abc123&type=signup'),
    )) as unknown as { redirectedTo: string };
    expect(res.redirectedTo).toBe('http://localhost:3000/onboarding');
  });

  it('honours a same-origin relative ?next path (gate NOT consulted)', async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    const res = (await GET(
      makeRequest('http://localhost:3000/auth/confirm?token_hash=abc&type=email&next=/cohorts'),
    )) as unknown as { redirectedTo: string };
    expect(res.redirectedTo).toBe('http://localhost:3000/cohorts');
    expect(decidePostAuthPathMock).not.toHaveBeenCalled();
  });

  it('SECURITY: ignores an absolute (off-origin) ?next → routes via the gate instead', async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    const res = (await GET(
      makeRequest(
        'http://localhost:3000/auth/confirm?token_hash=abc&type=email&next=https://evil.com',
      ),
    )) as unknown as { redirectedTo: string };
    // Off-origin next is dropped; the gate decides (defaults to /dashboard here).
    expect(res.redirectedTo).toBe('http://localhost:3000/dashboard');
    expect(res.redirectedTo).not.toContain('evil.com');
  });

  it('NEGATIVE: missing token_hash/type → auth-code-error, verifyOtp NOT called', async () => {
    const res = (await GET(
      makeRequest('http://localhost:3000/auth/confirm'),
    )) as unknown as { redirectedTo: string };
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe('http://localhost:3000/auth/auth-code-error');
  });

  it('NEGATIVE: verifyOtp error → auth-code-error (no detail leaked in target)', async () => {
    verifyOtpMock.mockResolvedValue({ error: { message: 'AuthApiError: token expired' } });
    const res = (await GET(
      makeRequest('http://localhost:3000/auth/confirm?token_hash=expired&type=recovery'),
    )) as unknown as { redirectedTo: string };
    expect(res.redirectedTo).toBe('http://localhost:3000/auth/auth-code-error');
    expect(res.redirectedTo).not.toContain('AuthApiError');
    expect(res.redirectedTo).not.toContain('token');
  });
});

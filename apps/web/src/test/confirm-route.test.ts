// @paradigm: sql
// Tests for the /auth/confirm route handler (Slice B — verifyOtp).
// CF-C6-PII-CLIENT-1: no token/email leaked; error → generic auth-code-error page.
//
// We mock the Supabase server client and capture NextResponse.redirect targets.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { verifyOtpMock } = vi.hoisted(() => ({ verifyOtpMock: vi.fn() }));
vi.mock('@/infrastructure/supabase/server.js', () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp: verifyOtpMock } }),
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
});

describe('/auth/confirm route handler', () => {
  it('POSITIVE: valid token_hash + type → verifyOtp called, redirect to /dashboard', async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    const res = (await GET(
      makeRequest('http://localhost:3000/auth/confirm?token_hash=abc123&type=signup'),
    )) as unknown as { redirectedTo: string };

    expect(verifyOtpMock).toHaveBeenCalledWith({ type: 'signup', token_hash: 'abc123' });
    expect(res.redirectedTo).toBe('http://localhost:3000/dashboard');
  });

  it('honours a same-origin relative ?next path', async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    const res = (await GET(
      makeRequest('http://localhost:3000/auth/confirm?token_hash=abc&type=email&next=/cohorts'),
    )) as unknown as { redirectedTo: string };
    expect(res.redirectedTo).toBe('http://localhost:3000/cohorts');
  });

  it('SECURITY: ignores an absolute (off-origin) ?next → falls back to /dashboard', async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    const res = (await GET(
      makeRequest(
        'http://localhost:3000/auth/confirm?token_hash=abc&type=email&next=https://evil.com',
      ),
    )) as unknown as { redirectedTo: string };
    expect(res.redirectedTo).toBe('http://localhost:3000/dashboard');
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

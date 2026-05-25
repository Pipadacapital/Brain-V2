// @paradigm: sql
// Supabase JWT verifier (Slice A — feat-auth-supabase-identity).
//
// Verifies the real Supabase Auth access token (RS256/ES256, JWKS) and returns the
// `sub` (Supabase auth user UUID) plus the verified `email`. Membership / workspace
// resolution is a SEPARATE concern (membership-resolver.ts) — this module does
// identity only.
//
// Persona bindings:
//   B2 (JWKS hardening): asymmetric algorithms only; exact JWKS URL; issuer/aud
//      pinned; SUPABASE_URL asserted non-empty at construction (boot fatal upstream).
//   S1 (failure mapping): EVERY jose failure mode (fetch fail, key mismatch,
//      expired, wrong aud/iss, malformed) is collapsed into a single AuthVerifyError.
//      The jose error class/message is NEVER surfaced to the caller's response — the
//      caller maps AuthVerifyError → generic UNAUTHORIZED. cacheMaxAge pinned 600s.
//   S2 (no PII in claim/logs): the email is returned for slice-C onboarding (it is
//      the verified source for the users.email column) but it is NEVER placed in the
//      BrainClaim and NEVER logged. The claim is still assembled from `sub` only;
//      every log line carries sub/requestId only — never the email.

import { createRemoteJWKSet, jwtVerify, type JWTVerifyResult } from 'jose';

/**
 * Sentinel error for ALL verification failures. Carries a machine code for
 * `warn`-level logging (error class + requestId) but NEVER the token, email,
 * or the underlying jose message — those must not reach a response body or log.
 */
export class AuthVerifyError extends Error {
  constructor(
    /** Coarse machine code — safe to log. NOT the jose message. */
    public readonly reason:
      | 'missing_token'
      | 'verify_failed', // collapses key-mismatch/expired/aud/iss/fetch/malformed
  ) {
    super(`auth verify failed: ${reason}`);
    this.name = 'AuthVerifyError';
  }
}

export interface SupabaseJwtVerifier {
  /**
   * @returns the verified Supabase auth user UUID (JWT `sub`) and `email`.
   * The email is for the slice-C onboarding user-row only — it MUST NOT be logged
   * or placed in the BrainClaim (S2).
   */
  verify(bearerToken: string): Promise<{ sub: string; email: string }>;
}

/**
 * Build a verifier bound to a Supabase project URL.
 *
 * @throws Error (boot-fatal upstream) if supabaseUrl is empty — B2.
 */
export function createSupabaseJwtVerifier(opts: {
  supabaseUrl: string;
}): SupabaseJwtVerifier {
  const supabaseUrl = (opts.supabaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!supabaseUrl) {
    // B2: assert SUPABASE_URL non-empty. Caller boot path turns this fatal.
    throw new Error(
      'SUPABASE_URL is required to verify Supabase JWTs (Slice A / B2).',
    );
  }

  const jwksUrl = new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  const issuer = `${supabaseUrl}/auth/v1`;
  const audience = 'authenticated';

  // S1: explicit JWKS cache TTL (10 min). Avoids a fetch per request while
  // still rotating keys within a bounded window.
  const jwks = createRemoteJWKSet(jwksUrl, { cacheMaxAge: 600_000 });

  return {
    async verify(bearerToken: string): Promise<{ sub: string; email: string }> {
      const token = extractBearer(bearerToken);
      if (!token) {
        throw new AuthVerifyError('missing_token');
      }

      let result: JWTVerifyResult;
      try {
        result = await jwtVerify(token, jwks, {
          // B2 (amended at Stage-5 verification): pin the ASYMMETRIC algorithm set.
          // The security property B2 protects is "never accept a symmetric (HS*)
          // algorithm" — HS256 verified against a public JWK would let an attacker
          // forge tokens using the published anon key — and "never accept `none`".
          // Supabase signs JWTs with asymmetric keys; legacy projects use RS256,
          // current projects (incl. this one) use ES256 (EC P-256). Pinning BOTH
          // asymmetric algs keeps the property while matching the live JWKS. The
          // jwtVerify call still rejects any token whose alg is not in this list
          // (so HS256/none are refused) AND whose signature/kid does not match the
          // JWKS — see supabase-jwt-verifier.test.ts.
          algorithms: ['RS256', 'ES256'],
          issuer,
          audience,
        });
      } catch {
        // S1: collapse ALL jose failure modes into one generic reason. We do
        // NOT inspect or re-surface the jose error class/message.
        throw new AuthVerifyError('verify_failed');
      }

      const sub = result.payload.sub;
      if (typeof sub !== 'string' || sub.length === 0) {
        throw new AuthVerifyError('verify_failed');
      }

      // Slice C: read the verified email for the onboarding user-row. Supabase
      // access tokens carry `email` as a top-level claim. It is returned but
      // NEVER logged and NEVER placed in the BrainClaim (S2). A token with no
      // email (rare; e.g. phone-only auth) yields '' — onboarding then errors
      // cleanly rather than writing a null-email user.
      const email = typeof result.payload['email'] === 'string'
        ? (result.payload['email'] as string)
        : '';

      return { sub, email };
    },
  };
}

/**
 * Extract the raw token from an `Authorization: Bearer <token>` header value.
 * Returns null for absent/malformed headers (caller throws missing_token).
 */
export function extractBearer(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!m) return null;
  const token = m[1]?.trim();
  return token && token.length > 0 ? token : null;
}

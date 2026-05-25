// @paradigm: sql
// Slice A — Supabase JWT verifier (B2 hardening, S1 failure mapping, S2 sub-only).
//
// Stands up a real RS256 keypair and a tiny in-process JWKS HTTP server, mints
// real tokens with jose, and asserts the verifier accepts the good token and
// collapses every bad-token mode into AuthVerifyError.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  SignJWT,
  type CryptoKey,
  type KeyObject,
} from 'jose';
import {
  createSupabaseJwtVerifier,
  AuthVerifyError,
  extractBearer,
} from './supabase-jwt-verifier.js';

// jose v6 keys are CryptoKey | KeyObject (KeyLike was removed in v6).
type JoseKey = CryptoKey | KeyObject;

// Derive a public key from a private one (export → strip private → reimport).
async function importPublicFrom(priv: JoseKey): Promise<JoseKey> {
  const jwk = await exportJWK(priv);
  delete jwk.d; delete jwk.p; delete jwk.q; delete jwk.dp; delete jwk.dq; delete jwk.qi;
  return (await importJWK({ ...jwk, alg: 'RS256' }, 'RS256')) as JoseKey;
}

let jwksServer: Server;
let baseUrl: string;
let privateKey: JoseKey;
let wrongPrivateKey: JoseKey;
const KID = 'test-key-1';

async function mint(opts: {
  key?: JoseKey;
  iss: string;
  aud: string;
  sub?: string;
  alg?: string;
  expSecondsFromNow?: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: KID })
    .setIssuer(opts.iss)
    .setAudience(opts.aud)
    .setSubject(opts.sub ?? 'real-sub-uuid-123')
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expSecondsFromNow ?? 3600));
  return jwt.sign(opts.key ?? privateKey);
}

beforeAll(async () => {
  // extractable: true so we can export the public JWK for the JWKS endpoint.
  ({ privateKey } = await generateKeyPair('RS256', { extractable: true }));
  ({ privateKey: wrongPrivateKey } = await generateKeyPair('RS256', { extractable: true }));

  // Public JWK for the legit key, advertised at the JWKS URL.
  const goodPub = await exportJWK(await importPublicFrom(privateKey));
  goodPub.kid = KID;
  goodPub.alg = 'RS256';
  goodPub.use = 'sig';

  jwksServer = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [goodPub] }));
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const addr = jwksServer.address();
  if (addr && typeof addr === 'object') {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
});

describe('createSupabaseJwtVerifier (B2/S1/S2)', () => {
  it('B2: refuses construction with an empty SUPABASE_URL (boot-fatal upstream)', () => {
    expect(() => createSupabaseJwtVerifier({ supabaseUrl: '' })).toThrow(/SUPABASE_URL is required/);
  });

  it('verifies a good RS256 token and returns sub (+ email empty when absent) (S2)', async () => {
    const v = createSupabaseJwtVerifier({ supabaseUrl: baseUrl });
    const token = await mint({ iss: `${baseUrl}/auth/v1`, aud: 'authenticated', sub: 'sub-abc' });
    const out = await v.verify(`Bearer ${token}`);
    // Slice C: the verifier returns sub + email. With no email claim in the token,
    // email is '' (the BrainClaim still carries NO email — proven in the context test).
    expect(out).toEqual({ sub: 'sub-abc', email: '' });
  });

  it('S1: missing/non-Bearer header → AuthVerifyError(missing_token)', async () => {
    const v = createSupabaseJwtVerifier({ supabaseUrl: baseUrl });
    await expect(v.verify('')).rejects.toBeInstanceOf(AuthVerifyError);
    await expect(v.verify(undefined as unknown as string)).rejects.toBeInstanceOf(AuthVerifyError);
    await expect(v.verify('Basic xyz')).rejects.toBeInstanceOf(AuthVerifyError);
  });

  it('B2/S1: wrong issuer → AuthVerifyError(verify_failed)', async () => {
    const v = createSupabaseJwtVerifier({ supabaseUrl: baseUrl });
    const token = await mint({ iss: 'https://evil.example/auth/v1', aud: 'authenticated' });
    await expect(v.verify(`Bearer ${token}`)).rejects.toMatchObject({ reason: 'verify_failed' });
  });

  it('B2/S1: wrong audience → AuthVerifyError(verify_failed)', async () => {
    const v = createSupabaseJwtVerifier({ supabaseUrl: baseUrl });
    const token = await mint({ iss: `${baseUrl}/auth/v1`, aud: 'anon' });
    await expect(v.verify(`Bearer ${token}`)).rejects.toMatchObject({ reason: 'verify_failed' });
  });

  it('B2/S1: signed by an unknown key → AuthVerifyError(verify_failed)', async () => {
    const v = createSupabaseJwtVerifier({ supabaseUrl: baseUrl });
    const token = await mint({ key: wrongPrivateKey, iss: `${baseUrl}/auth/v1`, aud: 'authenticated' });
    await expect(v.verify(`Bearer ${token}`)).rejects.toMatchObject({ reason: 'verify_failed' });
  });

  it('B2/S1: expired token → AuthVerifyError(verify_failed)', async () => {
    const v = createSupabaseJwtVerifier({ supabaseUrl: baseUrl });
    const token = await mint({ iss: `${baseUrl}/auth/v1`, aud: 'authenticated', expSecondsFromNow: -10 });
    await expect(v.verify(`Bearer ${token}`)).rejects.toMatchObject({ reason: 'verify_failed' });
  });

  it('S1: the thrown error never leaks the underlying jose message/class to callers', async () => {
    const v = createSupabaseJwtVerifier({ supabaseUrl: baseUrl });
    const token = await mint({ iss: 'https://evil.example/auth/v1', aud: 'authenticated' });
    try {
      await v.verify(`Bearer ${token}`);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AuthVerifyError);
      // message is our generic sentinel, not a jose "unexpected iss" message.
      expect((e as Error).message).toMatch(/^auth verify failed: verify_failed$/);
      expect((e as Error).message).not.toMatch(/iss|issuer|jose|JWT/i);
    }
  });
});

describe('ES256 (live Supabase signing alg) + symmetric rejection (B2 amended)', () => {
  it('verifies an ES256 token from the JWKS (this project signs ES256, not RS256)', async () => {
    // Stand up a SECOND JWKS server advertising an EC P-256 public key.
    const { privateKey: ecPriv } = await generateKeyPair('ES256', { extractable: true });
    const ecPub = await exportJWK(await importPublicEC(ecPriv));
    const ecKid = 'ec-key-1';
    ecPub.kid = ecKid;
    ecPub.alg = 'ES256';
    ecPub.use = 'sig';

    const ecServer = createServer((req, res) => {
      if (req.url === '/auth/v1/.well-known/jwks.json') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ keys: [ecPub] }));
      } else {
        res.statusCode = 404;
        res.end('nf');
      }
    });
    await new Promise<void>((r) => ecServer.listen(0, '127.0.0.1', r));
    const addr = ecServer.address();
    const ecBase = addr && typeof addr === 'object' ? `http://127.0.0.1:${addr.port}` : '';

    const now = Math.floor(Date.now() / 1000);
    // Slice C: include the email claim (Supabase access tokens carry it) to prove
    // the verifier extracts it on the live ES256 signing alg.
    const token = await new SignJWT({ email: 'es-user@brain.test' })
      .setProtectedHeader({ alg: 'ES256', kid: ecKid })
      .setIssuer(`${ecBase}/auth/v1`)
      .setAudience('authenticated')
      .setSubject('es-sub-1')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(ecPriv);

    const v = createSupabaseJwtVerifier({ supabaseUrl: ecBase });
    const out = await v.verify(`Bearer ${token}`);
    expect(out).toEqual({ sub: 'es-sub-1', email: 'es-user@brain.test' });
    await new Promise<void>((r) => ecServer.close(() => r()));
  });

  it('SECURITY: rejects an HS256 token signed with a symmetric key (no alg-confusion)', async () => {
    // An attacker who knows the public/anon key must NOT be able to forge a token
    // by signing HS256. Our algorithms list excludes HS*, so jwtVerify refuses it.
    const now = Math.floor(Date.now() / 1000);
    const secret = new TextEncoder().encode('public-anon-key-pretending-to-be-secret');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(`${baseUrl}/auth/v1`)
      .setAudience('authenticated')
      .setSubject('attacker')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(secret);
    const v = createSupabaseJwtVerifier({ supabaseUrl: baseUrl });
    await expect(v.verify(`Bearer ${token}`)).rejects.toMatchObject({ reason: 'verify_failed' });
  });
});

// EC public-key derivation helper (mirrors importPublicFrom for RSA).
async function importPublicEC(priv: JoseKey): Promise<JoseKey> {
  const jwk = await exportJWK(priv);
  delete jwk.d; // EC private scalar
  return (await importJWK({ ...jwk, alg: 'ES256' }, 'ES256')) as JoseKey;
}

describe('extractBearer', () => {
  it('extracts a token from a well-formed header', () => {
    expect(extractBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearer('bearer abc.def.ghi')).toBe('abc.def.ghi'); // case-insensitive
  });
  it('NEGATIVE: returns null for absent/malformed headers', () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer('')).toBeNull();
    expect(extractBearer('Token abc')).toBeNull();
    expect(extractBearer('Bearer ')).toBeNull();
  });
});

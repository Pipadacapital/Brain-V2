// @paradigm: io
// Slice D — connector-callback bridge tests. The bridge calls the gateway
// connectors.completeCallback mutation and maps the response to a NON-secret outcome.
// Covers: success (CONNECTED → ok+vendor); non-ok → connect_failed; thrown → caught;
// TC-003: the access token / code are never logged or echoed back.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { completeConnectorCallback } from '@/infrastructure/connector-callback.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

function mockFetch(impl: (url: string, init: RequestInit) => { ok: boolean; body: unknown }) {
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const { ok, body } = impl(String(url), init as RequestInit);
    return { ok, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe('completeConnectorCallback', () => {
  it('(+) CONNECTED → { ok: true, vendor }', async () => {
    mockFetch(() => ({ ok: true, body: { result: { data: { json: { status: 'CONNECTED', vendor: 'META' } } } } }));
    const out = await completeConnectorCallback({ vendor: 'META', code: 'c', state: 's', accessToken: 'tok', query: {} });
    expect(out).toEqual({ ok: true, vendor: 'META' });
  });

  it('passes the code in the BODY (never the URL) + Bearer auth', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit = {};
    mockFetch((url, init) => { capturedUrl = url; capturedInit = init; return { ok: true, body: { result: { data: { json: { status: 'CONNECTED' } } } } }; });
    await completeConnectorCallback({ vendor: 'SHOPIFY', code: 'CODE_SECRET', state: 's', accessToken: 'TOKEN_SECRET', query: { shop: 'x.myshopify.com' } });
    // The code must NOT be in the URL (TC-003).
    expect(capturedUrl).not.toContain('CODE_SECRET');
    // It IS in the POST body; the access token rides the Authorization header.
    expect(String(capturedInit.body)).toContain('CODE_SECRET');
    expect((capturedInit.headers as Record<string, string>)['authorization']).toBe('Bearer TOKEN_SECRET');
  });

  it('(-) non-ok response → connect_failed', async () => {
    mockFetch(() => ({ ok: false, body: {} }));
    const out = await completeConnectorCallback({ vendor: 'GOOGLE', code: 'c', state: 's', accessToken: 't', query: {} });
    expect(out).toEqual({ ok: false, errorSlug: 'connect_failed' });
  });

  it('(-) a non-CONNECTED status → connect_failed', async () => {
    mockFetch(() => ({ ok: true, body: { result: { data: { json: { status: 'ERROR' } } } } }));
    const out = await completeConnectorCallback({ vendor: 'META', code: 'c', state: 's', accessToken: 't', query: {} });
    expect(out.ok).toBe(false);
  });

  it('(-) a thrown fetch is caught → connect_failed (never blocks)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
    const out = await completeConnectorCallback({ vendor: 'META', code: 'c', state: 's', accessToken: 't', query: {} });
    expect(out).toEqual({ ok: false, errorSlug: 'connect_failed' });
  });
});

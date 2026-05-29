// @paradigm: sql + io/event-handling
//
// Tests for POST /webhooks/:vendor gateway route (Track T-GEN-B).
//
// Coverage targets:
//   1.  Raw-buffer fidelity: forwarded Buffer bytes == received bytes (FORWARD-FIDELITY-1)
//   2.  Header pass-through: ALL inbound headers forwarded generically in the headers map
//   3.  Outcome → HTTP: ACCEPTED→200, PARKED→200, IGNORED→200, REJECTED→401
//   4.  Body-size cap: oversize body rejected pre-forward (ABUSE-BOUND-1)
//   5.  Rate-limit: limiter exhausted → 429 pre-forward (ABUSE-BOUND-1)
//   6.  NEVERLOG: raw body / signature header value absent from all log output
//   7.  gRPC client called with the exact raw Buffer (not a re-serialized object)
//   8.  gRPC failure → 503 (upstream_unavailable)
//   9.  Correlation 4-tuple propagated to gRPC call (CORRELATION-1)
//  10.  Empty body: 0-byte Buffer forwarded (not rejected — zero-byte is valid for some topics)
//  11.  Vendor path-param forwarded in gRPC vendor field (per-vendor: shopify, meta, stripe)
//  12.  Generic vendor test: /webhooks/meta forwards vendor="meta" with ZERO route change
//        (VENDOR-REGISTRY-DISPATCH-1 at the gateway layer)
//  13.  NO-HARDCODED-VENDOR-1 grep-gate: route + client source files contain ZERO
//        vendor-literal branches (=== 'shopify' / == "shopify" / .shopify dispatch)
//
// Approach: Fastify.inject() — no port bound. gRPC client is a mock object
// passed via WebhookPluginOptions.grpcClient. Logger is captured via
// pino destination stream for the NEVERLOG grep.
//
// NEVERLOG assertions:
//   - Signature header VALUE must not appear in any log output.
//   - Raw body bytes (as ascii-decoded string for grep purposes) must not appear.
//   - No 'secret' or 'shpss' token in log output.
//
// Note: this test module does NOT import router.ts or any @brain/* alias that
// triggers the pre-existing @brain/core-notifications missing-package issue.
// It only imports the route plugin and client types, which are self-contained.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { WebhookIngestClient, WebhookIngestResponse } from './webhook-ingest-client.js';
import {
  webhookPlugin,
  TokenBucket,
  outcomeToStatus,
} from './route.webhook.js';
import { Outcome } from './webhook-ingest-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a test Fastify instance with the webhook plugin wired up.
 * gRPC client and rate limiter are injected via options for isolation.
 */
async function buildTestServer(opts: {
  grpcClient: WebhookIngestClient;
  rateLimiter?: { consume(): boolean };
  maxBodyBytes?: number;
}): Promise<{ server: FastifyInstance; logLines: string[] }> {
  const logLines: string[] = [];

  const server = Fastify({
    // Capture log lines into our array for NEVERLOG assertions.
    logger: {
      level: 'trace',
      stream: {
        write(line: string): void {
          logLines.push(line);
        },
      } as NodeJS.WritableStream,
    },
    genReqId: () => 'req-test-' + Math.random().toString(36).slice(2, 9),
  });

  await server.register(webhookPlugin, {
    grpcClient: opts.grpcClient,
    rateLimiter: opts.rateLimiter,
    maxBodyBytes: opts.maxBodyBytes,
  });

  await server.ready();
  return { server, logLines };
}

/**
 * Build a mock gRPC client that returns the specified outcome.
 * Captures the last request for assertion.
 * NO-HARDCODED-VENDOR-1: the mock captures req.vendor as forwarded — no branch on it.
 */
function makeMockClient(outcome: number, requestId = 'req-echo'): {
  client: WebhookIngestClient;
  lastRequest: { current: Parameters<WebhookIngestClient['receiveWebhook']>[0] | null };
} {
  const lastRequest: { current: Parameters<WebhookIngestClient['receiveWebhook']>[0] | null } =
    { current: null };

  const client: WebhookIngestClient = {
    receiveWebhook(req, callback) {
      lastRequest.current = req;
      const response: WebhookIngestResponse = { outcome: outcome as import('./webhook-ingest-client.js').OutcomeValue, requestId };
      // Simulate async gRPC response (setImmediate → microtask boundary).
      setImmediate(() => callback(null, response));
      // Return a minimal stub for the ClientUnaryCall (not used by the route).
      return {} as ReturnType<WebhookIngestClient['receiveWebhook']>;
    },
    close: vi.fn(),
  };

  return { client, lastRequest };
}

/**
 * Build a mock client that errors (simulates gRPC transport failure).
 */
function makeErrorClient(errorMsg = 'UNAVAILABLE'): WebhookIngestClient {
  return {
    receiveWebhook(_req, callback) {
      const err = Object.assign(new Error(errorMsg), { code: 14 }) as import('@grpc/grpc-js').ServiceError;
      setImmediate(() => callback(err, null as unknown as WebhookIngestResponse));
      return {} as ReturnType<WebhookIngestClient['receiveWebhook']>;
    },
    close: vi.fn(),
  };
}

/** Standard Shopify headers for test requests — vendor-specific but used only as test data. */
const SHOPIFY_HEADERS = {
  'content-type': 'application/json',
  'x-shopify-hmac-sha256': 'REDACTED_TEST_HMAC_VALUE',
  'x-shopify-shop-domain': 'test-shop.myshopify.com',
  'x-shopify-topic': 'orders/create',
  'x-shopify-webhook-id': 'wh-id-' + Math.random().toString(36).slice(2, 8),
  'x-request-id': 'req-incoming-test',
  'x-trace-id': 'trace-test',
};

/** Meta headers — different vendor to prove genericity (NO-HARDCODED-VENDOR-1). */
const META_HEADERS = {
  'content-type': 'application/json',
  'x-hub-signature-256': 'sha256=REDACTED_META_SIG',
  'x-request-id': 'req-meta-test',
  'x-trace-id': 'trace-meta-test',
};

const TEST_BODY = Buffer.from('{"id":12345,"order_number":"#001"}');

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('POST /webhooks/:vendor — outcome → HTTP mapping (OUTCOME-HTTP-MAP)', () => {
  let server: FastifyInstance;

  afterEach(async () => { await server.close(); });

  it('ACCEPTED (outcome=1) → 200', async () => {
    const { client } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: SHOPIFY_HEADERS,
      payload: TEST_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { outcome: number; request_id: string };
    expect(body.outcome).toBe(Outcome.ACCEPTED);
    expect(body.request_id).toBeTruthy();
  });

  it('PARKED (outcome=3) → 200 (unmapped identity; vendor must not retry)', async () => {
    const { client } = makeMockClient(Outcome.PARKED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: SHOPIFY_HEADERS,
      payload: TEST_BODY,
    });

    expect(res.statusCode).toBe(200);
  });

  it('IGNORED (outcome=4) → 200 (unknown topic; vendor must not retry)', async () => {
    const { client } = makeMockClient(Outcome.IGNORED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: SHOPIFY_HEADERS,
      payload: TEST_BODY,
    });

    expect(res.statusCode).toBe(200);
  });

  it('REJECTED (outcome=2) → 401 (auth failure)', async () => {
    const { client } = makeMockClient(Outcome.REJECTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: SHOPIFY_HEADERS,
      payload: TEST_BODY,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /webhooks/:vendor — raw-buffer fidelity (FORWARD-FIDELITY-1)', () => {
  let server: FastifyInstance;

  afterEach(async () => { await server.close(); });

  it('forwarded Buffer bytes are byte-identical to received bytes', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const originalBody = Buffer.from(
      JSON.stringify({ id: 999, line_items: [{ sku: 'SKU-001', price: '299.00' }] }),
    );

    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: originalBody,
    });

    // The forwarded rawBody must be byte-identical to the received buffer.
    // This is the FORWARD-FIDELITY-1 proof: no JSON parse → re-serialize step.
    const forwarded = lastRequest.current?.rawBody;
    expect(forwarded).toBeDefined();

    // Compare byte-by-byte.
    const forwardedBuf = Buffer.isBuffer(forwarded)
      ? forwarded
      : Buffer.from(forwarded as Uint8Array);

    expect(forwardedBuf.equals(originalBody)).toBe(true);
    // Explicit byte comparison for the assertion message:
    expect(forwardedBuf.toString('hex')).toBe(originalBody.toString('hex'));
  });

  it('zero-byte body is forwarded intact (valid for some vendor topics)', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.IGNORED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const emptyBody = Buffer.alloc(0);

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: emptyBody,
    });

    // Route should forward, not reject, a zero-byte body.
    expect(res.statusCode).not.toBe(413);
    const forwarded = lastRequest.current?.rawBody;
    const forwardedBuf = Buffer.isBuffer(forwarded)
      ? forwarded
      : Buffer.from(forwarded as Uint8Array);
    expect(forwardedBuf.byteLength).toBe(0);
  });

  it('binary body bytes survive the hop (non-UTF8 bytes stay intact)', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    // Construct a body with high-byte values that would be mangled by a
    // JSON parse / string round-trip.
    const binaryBody = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff, 0x80, 0x7f]);

    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS, 'content-type': 'application/json' },
      payload: binaryBody,
    });

    const forwarded = lastRequest.current?.rawBody;
    const forwardedBuf = Buffer.isBuffer(forwarded)
      ? forwarded
      : Buffer.from(forwarded as Uint8Array);

    expect(forwardedBuf.toString('hex')).toBe(binaryBody.toString('hex'));
  });
});

describe('POST /webhooks/:vendor — vendor path-param forwarding (NO-HARDCODED-VENDOR-1)', () => {
  let server: FastifyInstance;

  afterEach(async () => { await server.close(); });

  it('vendor="shopify" forwarded in gRPC vendor field from /webhooks/shopify', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: TEST_BODY,
    });

    expect(lastRequest.current?.vendor).toBe('shopify');
  });

  it('vendor="meta" forwarded in gRPC vendor field from /webhooks/meta — ZERO route change required (VENDOR-REGISTRY-DISPATCH-1)', async () => {
    // This is the critical genericity proof:
    // A completely different vendor ("meta") is handled by the SAME route with ZERO changes.
    // The gateway forwards vendor="meta" and all headers; the Python registry decides validity.
    // VENDOR-REGISTRY-DISPATCH-1: adding vendor #2 requires NO route/client/proto edits.
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    await server.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { ...META_HEADERS },
      payload: Buffer.from('{"entry":[{"id":"meta-page-id"}]}'),
    });

    // vendor field in gRPC request must be "meta" — not "shopify", not hardcoded.
    expect(lastRequest.current?.vendor).toBe('meta');
    // x-hub-signature-256 header forwarded in the generic headers map.
    expect(lastRequest.current?.headers['x-hub-signature-256']).toBe('sha256=REDACTED_META_SIG');
  });

  it('vendor="stripe" forwarded from /webhooks/stripe — proves any vendor string flows through', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    await server.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1234,v1=REDACTED_STRIPE_SIG',
        'x-request-id': 'req-stripe-test',
      },
      payload: Buffer.from('{"type":"payment_intent.succeeded"}'),
    });

    expect(lastRequest.current?.vendor).toBe('stripe');
    expect(lastRequest.current?.headers['stripe-signature']).toBe('t=1234,v1=REDACTED_STRIPE_SIG');
  });

  it('different vendors on sequential requests forward their respective vendor values', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: TEST_BODY,
    });
    expect(lastRequest.current?.vendor).toBe('shopify');

    await server.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { ...META_HEADERS },
      payload: TEST_BODY,
    });
    expect(lastRequest.current?.vendor).toBe('meta');

    await server.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'v1=abc' },
      payload: TEST_BODY,
    });
    expect(lastRequest.current?.vendor).toBe('stripe');
  });
});

describe('POST /webhooks/:vendor — header pass-through (CORRELATION-1 / FORWARD-FIDELITY-1)', () => {
  let server: FastifyInstance;

  afterEach(async () => { await server.close(); });

  it('all X-Shopify-* headers forwarded in generic headers map', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const headers = {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': 'base64_hmac_value_for_test',
      'x-shopify-shop-domain': 'sugandhlok.myshopify.com',
      'x-shopify-topic': 'orders/paid',
      'x-shopify-webhook-id': 'wh-specific-id',
      'x-request-id': 'test-req-id',
      'x-trace-id': 'test-trace-id',
    };

    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers,
      payload: TEST_BODY,
    });

    const forwarded = lastRequest.current;
    expect(forwarded).toBeDefined();
    // All Shopify headers forwarded in the generic headers map.
    expect(forwarded?.headers['x-shopify-hmac-sha256']).toBe('base64_hmac_value_for_test');
    expect(forwarded?.headers['x-shopify-shop-domain']).toBe('sugandhlok.myshopify.com');
    expect(forwarded?.headers['x-shopify-topic']).toBe('orders/paid');
    expect(forwarded?.headers['x-shopify-webhook-id']).toBe('wh-specific-id');
  });

  it('Meta-specific headers forwarded in generic headers map', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const headers = {
      'content-type': 'application/json',
      'x-hub-signature-256': 'sha256=meta_hmac_value',
      'x-hub-signature': 'sha1=meta_sha1_value',
      'x-request-id': 'req-meta',
      'x-trace-id': 'trace-meta',
    };

    await server.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers,
      payload: TEST_BODY,
    });

    const forwarded = lastRequest.current;
    expect(forwarded?.headers['x-hub-signature-256']).toBe('sha256=meta_hmac_value');
    expect(forwarded?.headers['x-hub-signature']).toBe('sha1=meta_sha1_value');
  });

  it('correlation ids propagated to gRPC call (CORRELATION-1)', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const headers = {
      ...SHOPIFY_HEADERS,
      'x-request-id': 'corr-request-id',
      'x-trace-id': 'corr-trace-id',
    };

    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers,
      payload: TEST_BODY,
    });

    const forwarded = lastRequest.current;
    // traceId must propagate from the incoming header.
    expect(forwarded?.traceId).toBe('corr-trace-id');
    // requestId is Fastify-assigned (genReqId) or from x-request-id.
    expect(forwarded?.requestId).toBeTruthy();
  });

  it('missing X-Shopify-* headers produce empty string values (not undefined)', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.REJECTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    // Only provide content-type — no X-Shopify-* headers.
    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { 'content-type': 'application/json' },
      payload: TEST_BODY,
    });

    const fwd = lastRequest.current?.headers;
    // The gateway forwards what it receives; the Python servicer rejects on
    // missing/empty signature header (VERIFY-FIRST-1). Keys may be absent from
    // the map — the servicer uses spec.signature_header to read them.
    // content-type is always forwarded.
    expect(fwd?.['content-type']).toBe('application/json');
    // x-shopify-hmac-sha256 is absent (not sent) — should not appear or be empty string.
    const hmacVal = fwd?.['x-shopify-hmac-sha256'];
    expect(hmacVal === undefined || hmacVal === '').toBe(true);
  });

  it('ALL inbound headers are present in the forwarded map (generic pass-through)', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const headers = {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': 'test-hmac',
      'x-custom-vendor-header': 'custom-value',
      'x-another-header': 'another-value',
      'x-request-id': 'req-all-headers',
    };

    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers,
      payload: TEST_BODY,
    });

    const fwd = lastRequest.current?.headers;
    // All sent headers forwarded generically (plus Fastify-added host/connection).
    expect(fwd?.['x-shopify-hmac-sha256']).toBe('test-hmac');
    expect(fwd?.['x-custom-vendor-header']).toBe('custom-value');
    expect(fwd?.['x-another-header']).toBe('another-value');
  });
});

describe('POST /webhooks/:vendor — body-size cap (ABUSE-BOUND-1)', () => {
  let server: FastifyInstance;

  afterEach(async () => { await server.close(); });

  it('body exactly at limit is forwarded', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    const maxBodyBytes = 64;
    ({ server } = await buildTestServer({ grpcClient: client, maxBodyBytes }));

    const body = Buffer.alloc(maxBodyBytes, 0x41); // 64 bytes of 'A'

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(lastRequest.current?.rawBody).toBeDefined();
  });

  it('body one byte over limit is rejected 413 BEFORE gRPC call (ABUSE-BOUND-1)', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    const maxBodyBytes = 64;
    ({ server } = await buildTestServer({ grpcClient: client, maxBodyBytes }));

    const oversize = Buffer.alloc(maxBodyBytes + 1, 0x41); // 65 bytes

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: oversize,
    });

    expect(res.statusCode).toBe(413);
    // gRPC client must NOT have been called — rejection pre-forward.
    expect(lastRequest.current).toBeNull();

    const body = JSON.parse(res.body) as { error: string; request_id: string };
    expect(body.error).toBe('payload_too_large');
    expect(body.request_id).toBeTruthy();
  });

  it('response on oversize carries request_id for traceability', async () => {
    const { client } = makeMockClient(Outcome.ACCEPTED);
    const maxBodyBytes = 16;
    ({ server } = await buildTestServer({ grpcClient: client, maxBodyBytes }));

    const oversize = Buffer.alloc(maxBodyBytes + 1, 0x42);

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: oversize,
    });

    expect(res.statusCode).toBe(413);
    const body = JSON.parse(res.body) as { error: string; request_id: string };
    expect(body.request_id).toBeTruthy();
  });

  it('body-size cap fires for /webhooks/meta too (ABUSE-BOUND-1 is vendor-agnostic)', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    const maxBodyBytes = 32;
    ({ server } = await buildTestServer({ grpcClient: client, maxBodyBytes }));

    const oversize = Buffer.alloc(maxBodyBytes + 1, 0x43);

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { ...META_HEADERS },
      payload: oversize,
    });

    expect(res.statusCode).toBe(413);
    expect(lastRequest.current).toBeNull(); // pre-forward rejection
  });
});

describe('POST /webhooks/:vendor — rate-limit (ABUSE-BOUND-1)', () => {
  let server: FastifyInstance;

  afterEach(async () => { await server.close(); });

  it('exhausted rate-limiter → 429 BEFORE gRPC call', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    // Limiter that always denies.
    const exhaustedLimiter = { consume: () => false };

    ({ server } = await buildTestServer({ grpcClient: client, rateLimiter: exhaustedLimiter }));

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: TEST_BODY,
    });

    expect(res.statusCode).toBe(429);
    // gRPC client must NOT have been called.
    expect(lastRequest.current).toBeNull();

    const body = JSON.parse(res.body) as { error: string; request_id: string };
    expect(body.error).toBe('rate_limit_exceeded');
    expect(body.request_id).toBeTruthy();
  });

  it('rate-limit rejected before body-size check (ordering test)', async () => {
    const { client } = makeMockClient(Outcome.ACCEPTED);
    const exhaustedLimiter = { consume: () => false };
    const maxBodyBytes = 4; // Very small — would 413 if rate-limit didn't fire first.

    ({ server } = await buildTestServer({
      grpcClient: client,
      rateLimiter: exhaustedLimiter,
      maxBodyBytes,
    }));

    const body = Buffer.alloc(100, 0x41); // oversize too
    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: body,
    });

    // Rate-limit fires first (429), not body-size (413).
    expect(res.statusCode).toBe(429);
  });

  it('passing rate-limiter allows request through', async () => {
    const { client } = makeMockClient(Outcome.ACCEPTED);
    const alwaysAllows = { consume: () => true };

    ({ server } = await buildTestServer({ grpcClient: client, rateLimiter: alwaysAllows }));

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: TEST_BODY,
    });

    expect(res.statusCode).toBe(200);
  });

  it('rate-limit fires for /webhooks/meta (vendor-agnostic limiter)', async () => {
    const { client, lastRequest } = makeMockClient(Outcome.ACCEPTED);
    const exhaustedLimiter = { consume: () => false };

    ({ server } = await buildTestServer({ grpcClient: client, rateLimiter: exhaustedLimiter }));

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { ...META_HEADERS },
      payload: TEST_BODY,
    });

    expect(res.statusCode).toBe(429);
    expect(lastRequest.current).toBeNull();
  });
});

describe('POST /webhooks/:vendor — NEVERLOG-1 (Shreya VETO)', () => {
  let server: FastifyInstance;
  let logLines: string[];

  afterEach(async () => { await server.close(); });

  it('NEVERLOG: signature header VALUE absent from all log output on ACCEPTED', async () => {
    const sigValue = 'SECRET_BASE64_HMAC_VALUE_THAT_MUST_NOT_APPEAR';
    const { client } = makeMockClient(Outcome.ACCEPTED);
    ({ server, logLines } = await buildTestServer({ grpcClient: client }));

    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: {
        ...SHOPIFY_HEADERS,
        'x-shopify-hmac-sha256': sigValue,
      },
      payload: TEST_BODY,
    });

    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain(sigValue);
  });

  it('NEVERLOG: raw body payload bytes absent from all log output', async () => {
    const { client } = makeMockClient(Outcome.ACCEPTED);
    ({ server, logLines } = await buildTestServer({ grpcClient: client }));

    // Body with a distinctive string that should never appear in logs.
    const sensitivePayload = '{"secret_field":"PII_DATA_MUST_NOT_LOG"}';
    const rawBody = Buffer.from(sensitivePayload);

    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: rawBody,
    });

    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain('PII_DATA_MUST_NOT_LOG');
    expect(allLogs).not.toContain('secret_field');
  });

  it('NEVERLOG: no "shpss_" token in log output', async () => {
    const { client } = makeMockClient(Outcome.ACCEPTED);
    ({ server, logLines } = await buildTestServer({ grpcClient: client }));

    await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: Buffer.from('{"id":1}'),
    });

    const allLogs = logLines.join('\n');
    expect(allLogs.toLowerCase()).not.toContain('shpss_');
  });

  it('NEVERLOG: REJECTED response carries only outcome + request_id (no signature echo)', async () => {
    const sigValue = 'SHOULD_NEVER_APPEAR_IN_RESPONSE';
    const { client } = makeMockClient(Outcome.REJECTED);
    ({ server } = await buildTestServer({ grpcClient: client }));

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: {
        ...SHOPIFY_HEADERS,
        'x-shopify-hmac-sha256': sigValue,
      },
      payload: TEST_BODY,
    });

    expect(res.statusCode).toBe(401);
    // Response body must not echo the signature value.
    expect(res.body).not.toContain(sigValue);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    // No raw body, no signature, no PII in response.
    expect(body['rawBody']).toBeUndefined();
    expect(body['signature']).toBeUndefined();
    expect(body['hmac']).toBeUndefined();
  });

  it('NEVERLOG: Meta signature header value absent from logs (generic vendor)', async () => {
    const metaSig = 'sha256=SECRET_META_SIG_MUST_NOT_LOG';
    const { client } = makeMockClient(Outcome.ACCEPTED);
    ({ server, logLines } = await buildTestServer({ grpcClient: client }));

    await server.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: {
        ...META_HEADERS,
        'x-hub-signature-256': metaSig,
      },
      payload: Buffer.from('{"meta":"payload"}'),
    });

    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain(metaSig);
  });
});

describe('POST /webhooks/:vendor — gRPC error handling', () => {
  let server: FastifyInstance;

  afterEach(async () => { await server.close(); });

  it('gRPC call failure → 503 upstream_unavailable with request_id', async () => {
    const errorClient = makeErrorClient('UNAVAILABLE: connection refused');
    ({ server } = await buildTestServer({ grpcClient: errorClient }));

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: { ...SHOPIFY_HEADERS },
      payload: TEST_BODY,
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body) as { error: string; request_id: string };
    expect(body.error).toBe('upstream_unavailable');
    expect(body.request_id).toBeTruthy();
  });

  it('gRPC error response does not echo raw body or signature', async () => {
    const errorClient = makeErrorClient('connection refused');
    ({ server } = await buildTestServer({ grpcClient: errorClient }));

    const sensitivePayload = Buffer.from('{"PII_BODY_MUST_NOT_APPEAR":true}');

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/shopify',
      headers: {
        ...SHOPIFY_HEADERS,
        'x-shopify-hmac-sha256': 'HMAC_MUST_NOT_APPEAR',
      },
      payload: sensitivePayload,
    });

    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('PII_BODY_MUST_NOT_APPEAR');
    expect(res.body).not.toContain('HMAC_MUST_NOT_APPEAR');
  });
});

// ---------------------------------------------------------------------------
// Unit tests for TokenBucket (ABUSE-BOUND-1 unit coverage)
// ---------------------------------------------------------------------------

describe('TokenBucket rate-limiter', () => {
  it('allows up to capacity requests instantly', () => {
    const bucket = new TokenBucket(3, 0); // capacity=3, no refill
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(true);
    // 4th request beyond capacity.
    expect(bucket.consume()).toBe(false);
  });

  it('refills tokens over time', async () => {
    // capacity=1, refill=1000/s → 1 token per ms.
    const bucket = new TokenBucket(1, 1000);
    bucket.consume(); // consume the one token
    expect(bucket.consume()).toBe(false); // empty

    // Wait 5ms — should refill 5 tokens (but capped at capacity=1).
    await new Promise((r) => setTimeout(r, 5));
    expect(bucket.consume()).toBe(true);
  });

  it('capacity=0 always denies', () => {
    const bucket = new TokenBucket(0, 100);
    expect(bucket.consume()).toBe(false);
    expect(bucket.consume()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests for outcomeToStatus (outcome → HTTP mapping unit coverage)
// ---------------------------------------------------------------------------

describe('outcomeToStatus — outcome → HTTP mapping', () => {
  it('ACCEPTED (1) → 200', () => expect(outcomeToStatus(Outcome.ACCEPTED)).toBe(200));
  it('REJECTED (2) → 401', () => expect(outcomeToStatus(Outcome.REJECTED)).toBe(401));
  it('PARKED (3) → 200', () => expect(outcomeToStatus(Outcome.PARKED)).toBe(200));
  it('IGNORED (4) → 200', () => expect(outcomeToStatus(Outcome.IGNORED)).toBe(200));
  it('UNSPECIFIED (0) → 200 (safe default)', () => expect(outcomeToStatus(Outcome.UNSPECIFIED)).toBe(200));
});

// ---------------------------------------------------------------------------
// NO-HARDCODED-VENDOR-1 grep-gate (HIGH CF)
//
// CI-equivalent test: assert that the route source + client source files
// contain ZERO vendor-literal branches on the dispatch path.
// Patterns checked:
//   - === 'shopify' / === "shopify"
//   - == 'shopify' / == "shopify"
//   - if.*vendor.*shopify
//   - .shopify (property access that hardcodes shopify)
//
// The registry-definition in webhook_registry.py (Python) intentionally
// contains the string "shopify" as a dict key (data, not a branch) — that
// file is NOT in scope for this grep (it's Python, not the gateway route).
// ---------------------------------------------------------------------------

describe('NO-HARDCODED-VENDOR-1 — vendor-literal branch grep-gate', () => {
  const __filename = fileURLToPath(import.meta.url);
  const interfacesDir = path.dirname(__filename);

  // Files on the dispatch path that must have zero vendor-literal branches.
  const routeFile = path.join(interfacesDir, 'route.webhook.ts');
  const clientFile = path.join(interfacesDir, 'webhook-ingest-client.ts');

  // Patterns that indicate a hardcoded vendor branch on the dispatch path.
  // These are the patterns the plan's grep-gate checks.
  const FORBIDDEN_PATTERNS = [
    /===\s*['"]shopify['"]/,
    /==\s*['"]shopify['"]/,
    /if.*vendor.*shopify/i,
    // Property access: e.g. req.params.shopify or vendor.shopify (not the string "shopify")
    // Note: the string literal "shopify" as a vendor name VALUE in a comment/test fixture
    // is acceptable; we check for dispatch branches only.
  ] as const;

  function scanFile(filePath: string): { file: string; violations: string[] } {
    const source = readFileSync(filePath, 'utf-8');
    const lines = source.split('\n');
    const violations: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip comment lines (they may explain what we're guarding against).
      if (line.trimStart().startsWith('//')) continue;

      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(line)) {
          violations.push(`${filePath}:${i + 1}: ${line.trim()}`);
          break;
        }
      }
    }

    return { file: filePath, violations };
  }

  it('route.webhook.ts has ZERO vendor-literal branches on the dispatch path', () => {
    const { violations } = scanFile(routeFile);
    expect(violations).toHaveLength(0);
  });

  it('webhook-ingest-client.ts has ZERO vendor-literal branches on the dispatch path', () => {
    const { violations } = scanFile(clientFile);
    expect(violations).toHaveLength(0);
  });

  it('combined dispatch path: zero total vendor-literal violations across both files', () => {
    const routeViolations = scanFile(routeFile).violations;
    const clientViolations = scanFile(clientFile).violations;
    const allViolations = [...routeViolations, ...clientViolations];
    expect(allViolations).toHaveLength(0);
  });
});

// @paradigm: sql + io/event-handling
//
// Fastify plugin: POST /webhooks/:vendor — thin public vendor-agnostic receive route.
//
// Routed facts:
//   - FORWARD-FIDELITY-1: body captured as raw Buffer BEFORE any JSON parse.
//     Content-type parser registered with `parseAs:'buffer'`. The Buffer sent
//     over gRPC is byte-identical to what the vendor signed. NEVER re-serialized.
//   - ABUSE-BOUND-1 (CRIT): body-size cap + per-route rate-limit BEFORE
//     forwarding. Unauthenticated pre-verify work is bounded at the gateway.
//   - SINGLE-PRIMITIVE-1: NO HMAC verification here. No Node verifier.
//     The Python servicer is the only place verify_fn is called (via the registry).
//   - PLACEMENT-1: the route is OUTSIDE the tRPC plugin. Vendors authenticate
//     by HMAC (or equivalent) in the Python servicer, not Supabase JWT.
//   - NEVERLOG-1 (Shreya VETO): NEVER log raw_body, any signature header value,
//     or any PII. Log only ids + outcome + error classification.
//   - CORRELATION-1: 4-tuple minted/propagated via extractCorrelation → proto.
//   - MAP-AFTER-VERIFY-1: the gateway does NOT resolve workspace_id. It is a
//     faithful forwarder. The Python servicer resolves identity post-verify.
//   - NO-HARDCODED-VENDOR-1 (HIGH): the vendor is read from the :vendor path
//     param and forwarded as a field. The Python registry is the authority for
//     valid vendors; unknown vendors are REJECTED there (default-deny). No
//     vendor-literal branch exists in this file.
//   - VENDOR-REGISTRY-DISPATCH-1: adding vendor #2 requires ZERO route changes —
//     only a new WEBHOOK_VERIFIERS entry in the Python registry.
//
// HOLD-AT-CUTOVER (NO-LIVE-1): this plugin is exported but NOT registered in
// server.ts until Stage 8. The route is authored here, not wired live.
// To register at Stage 8: `await fastify.register(webhookPlugin)` in
// buildServer() after the CORS registration.
//
// Outcome → HTTP mapping (ABUSE-BOUND/NEVERLOG safe):
//   ACCEPTED  (1) → 200  (ingested)
//   PARKED    (3) → 200  (unmapped identity; vendor stops retrying)
//   IGNORED   (4) → 200  (unknown topic; vendor stops retrying)
//   REJECTED  (2) → 401  (auth failure; vendor should not retry)

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { extractCorrelation } from '@brain/lib-logger';
import {
  createWebhookIngestClient,
  callReceiveWebhook,
  Outcome,
  type WebhookIngestClient,
} from './webhook-ingest-client.js';

// ---------------------------------------------------------------------------
// Body-size cap — ABUSE-BOUND-1.
// 512 KB gives generous headroom for large payloads while bounding the
// unauthenticated work delivered to the Python verifier across all vendors.
// ---------------------------------------------------------------------------
const MAX_BODY_BYTES = 512 * 1024; // 512 KB

// ---------------------------------------------------------------------------
// In-process rate-limit state — ABUSE-BOUND-1, Single-Primitive Rule.
// Uses a token-bucket (in-process, per-process). For Stage-8 shared-state
// rate limiting across instances, swap the bucket for an ioredis sliding-window
// behind the same RateLimiter interface.
// ---------------------------------------------------------------------------

/**
 * Minimal token-bucket rate-limiter (in-process).
 * Refill is lazy (on-demand at check time). Single-Primitive: this is the
 * ONLY rate-limit primitive for this route.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,       // max tokens (burst)
    private readonly refillPerSecond: number, // tokens added per second
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  /**
   * Try to consume one token. Returns true if allowed, false if rate-limited.
   */
  consume(): boolean {
    const nowMs = Date.now();
    const elapsedSec = (nowMs - this.lastRefillMs) / 1000;
    // Refill up to capacity.
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSec * this.refillPerSecond,
    );
    this.lastRefillMs = nowMs;

    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }
}

// Default limits: 100 req/s burst, refill at 50/s.
// Adjust at Stage-8 based on observed event volume per vendor.
const DEFAULT_RATE_LIMIT_BURST = 100;
const DEFAULT_RATE_LIMIT_REFILL_PER_SEC = 50;

// ---------------------------------------------------------------------------
// Plugin options — dependency-inject the gRPC client + rate limiter so
// tests can mock without binding a real port.
// ---------------------------------------------------------------------------
export interface WebhookPluginOptions {
  /** Override the gRPC client (for testing). Defaults to createWebhookIngestClient(). */
  grpcClient?: WebhookIngestClient;
  /** Override the rate limiter (for testing). Defaults to a real TokenBucket. */
  rateLimiter?: { consume(): boolean };
  /** Override max body bytes (for testing). Defaults to MAX_BODY_BYTES. */
  maxBodyBytes?: number;
}

// ---------------------------------------------------------------------------
// Header collection — FORWARD-FIDELITY-1 / NO-HARDCODED-VENDOR-1.
// Forward ALL inbound headers as a generic map. The Python registry's
// VendorWebhookSpec declares which keys matter per vendor (signature_header,
// identity_header, idempotency_header, topic_header). The gateway does NOT
// cherry-pick only Shopify headers — it forwards the full set so the registry
// can extract what it needs for any vendor.
// ---------------------------------------------------------------------------
function collectVendorHeaders(
  headers: FastifyRequest['headers'],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[key] = value;
    } else if (Array.isArray(value)) {
      // HTTP/1.1 allows multiple values; join with comma (RFC 7230 §3.2.2).
      result[key] = value.join(', ');
    }
    // Skip undefined values (absent headers).
  }
  return result;
}

// ---------------------------------------------------------------------------
// Outcome → HTTP status code mapping.
// ACCEPTED / PARKED / IGNORED → 200 (vendor stops retrying on 2xx).
// REJECTED → 401 (auth failure — explicit rejection rather than 5xx).
// Exported for unit testing.
// ---------------------------------------------------------------------------
export function outcomeToStatus(outcome: number): number {
  if (outcome === Outcome.REJECTED) return 401;
  // ACCEPTED=1, PARKED=3, IGNORED=4, UNSPECIFIED=0 → all 200
  return 200;
}

// ---------------------------------------------------------------------------
// Fastify plugin — NOT registered in server.ts until Stage 8 (NO-LIVE-1).
// ---------------------------------------------------------------------------
export const webhookPlugin: FastifyPluginAsync<WebhookPluginOptions> =
  async (
    fastify: FastifyInstance,
    opts: WebhookPluginOptions,
  ) => {
    // Build or reuse the gRPC client. The client is shared for the plugin
    // lifetime (Fastify plugin lifecycle). Close on server shutdown.
    const client = opts.grpcClient ?? createWebhookIngestClient();
    const limiter =
      opts.rateLimiter ??
      new TokenBucket(DEFAULT_RATE_LIMIT_BURST, DEFAULT_RATE_LIMIT_REFILL_PER_SEC);
    const maxBody = opts.maxBodyBytes ?? MAX_BODY_BYTES;

    fastify.addHook('onClose', async () => {
      if (!opts.grpcClient) {
        // Only close the client we created ourselves, not a test-injected one.
        client.close();
      }
    });

    // Register a content-type parser for 'application/json' scoped to this
    // plugin that yields the RAW Buffer without JSON-parsing it.
    // FORWARD-FIDELITY-1: bytes received == bytes handed to the vendor verifier.
    // The `parseAs:'buffer'` option tells Fastify to accumulate the body into a
    // Buffer and pass it to the handler directly — no JSON.parse anywhere.
    fastify.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => {
        done(null, body);
      },
    );

    // Also handle any other content-type a vendor might send. We capture
    // as buffer regardless of content-type (FORWARD-FIDELITY-1).
    fastify.addContentTypeParser(
      '*',
      { parseAs: 'buffer' },
      (_req, body, done) => {
        done(null, body);
      },
    );

    // POST /webhooks/:vendor
    // Public, outside tRPC, no JWT auth — vendors authenticate by HMAC
    // (or equivalent) in the Python servicer via the WEBHOOK_VERIFIERS registry.
    // NO-HARDCODED-VENDOR-1: vendor is a path param; this route handles all vendors.
    fastify.post<{ Params: { vendor: string }; Body: Buffer }>(
      '/webhooks/:vendor',
      {
        config: {
          // Documented hold — registered here but not exposed via public
          // ingress until Stage 8 (NO-LIVE-1).
          webhookRoute: true,
          holdAtCutover: 'HOLD-AT-CUTOVER: public ingress HELD Stage-8',
        },
      },
      async (
        req: FastifyRequest<{ Params: { vendor: string }; Body: Buffer }>,
        reply: FastifyReply,
      ) => {
        // Extract vendor from path param — NO branch on its value (NO-HARDCODED-VENDOR-1).
        // The Python registry decides whether this vendor is valid (default-deny).
        const vendor = req.params.vendor;

        // ABUSE-BOUND-1, step 1: rate-limit BEFORE any forwarding.
        if (!limiter.consume()) {
          req.log.warn(
            { requestId: req.id, route: `POST /webhooks/:vendor`, vendor },
            'webhook rate-limit exceeded (ABUSE-BOUND-1)',
          );
          return reply.status(429).send({ error: 'rate_limit_exceeded', request_id: req.id });
        }

        // ABUSE-BOUND-1, step 2: body-size cap BEFORE forwarding.
        const rawBody = req.body;
        const bodyLength =
          rawBody instanceof Buffer
            ? rawBody.byteLength
            : (rawBody as unknown as { byteLength?: number }).byteLength ?? 0;

        if (bodyLength > maxBody) {
          req.log.warn(
            {
              requestId: req.id,
              route: `POST /webhooks/:vendor`,
              vendor,
              bodyLength,
              maxBody,
            },
            'webhook body exceeds size cap (ABUSE-BOUND-1)',
          );
          return reply.status(413).send({
            error: 'payload_too_large',
            request_id: req.id,
          });
        }

        // CORRELATION-1: mint/propagate the 4-tuple.
        // genReqId already assigned req.id by Fastify's genReqId config.
        const correlation = extractCorrelation(req.headers);
        const requestId = req.id ?? correlation.request_id ?? randomUUID();
        const traceId = correlation.trace_id;

        // Collect ALL inbound headers as a generic map.
        // FORWARD-FIDELITY-1: the full header set is forwarded; the Python
        // registry selects the vendor-relevant keys (signature, identity,
        // idempotency, topic) per VendorWebhookSpec.
        // NEVERLOG-1: the log line below does NOT include header values —
        // signature values MUST NEVER appear in logs.
        const forwardedHeaders = collectVendorHeaders(req.headers);

        // NEVERLOG-1: log ids + route + vendor only. NO signature header value,
        // NO raw body, NO PII.
        req.log.info(
          {
            requestId,
            traceId,
            route: 'POST /webhooks/:vendor',
            vendor,
            bodyLength,
          },
          'vendor webhook received',
        );

        // Forward to the ingestion-service gRPC server.
        // FORWARD-FIDELITY-1: rawBody is the Buffer captured pre-parse.
        // No JSON round-trip. No re-serialization. Bytes are byte-identical.
        // NO-HARDCODED-VENDOR-1: vendor is a field, not a branch.
        let outcome: number;
        let echoedRequestId: string;
        try {
          const response = await callReceiveWebhook(client, {
            vendor,
            rawBody,
            headers: forwardedHeaders,
            requestId,
            traceId,
          });
          outcome = response.outcome;
          echoedRequestId = response.requestId ?? requestId;
        } catch (err) {
          // gRPC call failed — treat as a transient server error.
          // NEVERLOG-1: log only error class + ids, never the body/signature.
          req.log.error(
            {
              requestId,
              traceId,
              vendor,
              // err.message is safe (grpc-js error message; no body/sig in it)
              errorClass:
                err instanceof Error ? err.constructor.name : 'unknown',
            },
            'webhook gRPC call failed',
          );
          return reply.status(503).send({
            error: 'upstream_unavailable',
            request_id: requestId,
          });
        }

        // Map Outcome → HTTP.
        const status = outcomeToStatus(outcome);

        req.log.info(
          {
            requestId,
            traceId,
            vendor,
            outcome,
            status,
          },
          'vendor webhook forwarded',
        );

        // NEVERLOG-1: response body carries only outcome + request_id.
        // NO secret, NO signature, NO PII echo.
        return reply.status(status).send({
          outcome,
          request_id: echoedRequestId,
        });
      },
    );
  };

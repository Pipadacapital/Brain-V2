# Developer Report — Vikram (backend-developer) — connector-webhook-intake T1

> Stage 3 Track T1 — gateway public receive route
> Timestamp: 2026-05-29T22:00:00Z
> Paradigm: sql + io/event-handling — ₹0, zero LLM/ML

---

## Staged files

```
apps/api-gateway/src/interfaces/route.webhook-shopify.test.ts
apps/api-gateway/src/interfaces/route.webhook-shopify.ts
apps/api-gateway/src/interfaces/webhook-ingest-client.ts
```

(Plus Maya's T0/T2/T3 files already staged — see pending-founder-commit.md)

---

## Proposed commit message (for Founder at Stage 8)

```
feat(connector-webhook-intake): T1 gateway public receive route (HELD Stage-8)

POST /webhooks/shopify Fastify plugin (NOT registered in server.ts — HOLD-AT-CUTOVER).
gRPC client factory for brain.ingestion.v1.WebhookIngestService.
FORWARD-FIDELITY-1: parseAs:'buffer' content-type parser; raw Buffer forwarded
  byte-identical to what Shopify signed — never JSON-parsed or re-serialized.
ABUSE-BOUND-1: TokenBucket rate-limiter (429) + body-size cap (413) fire BEFORE
  gRPC call — unauthenticated work is bounded at the edge.
NEVERLOG-1: no raw body, no hmac value, no PII in any log line or response.
SINGLE-PRIMITIVE-1: no HMAC verify in Node; gateway is a faithful forwarder only.
Outcome→HTTP: ACCEPTED/PARKED/IGNORED→200, REJECTED→401.
30 tests pass; tsc clean; zero legacy project touches.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Reversibility recipe

The three new files are additive. `route.webhook-shopify.ts` is exported but NOT imported by `server.ts` — it is dead code until Stage 8 wires it in. Reversal:

1. Delete the three new files.
2. `git rm` them.
3. No migration to reverse (connector_shop_map migration is Maya's T3 — separate reversal).
4. No service or route changed in `server.ts` — zero impact on existing functionality.

---

## Self-review (in-lane DoD walked line-by-line)

| DoD Item | Status | Evidence |
|----------|--------|---------|
| `@paradigm` decorator on every new code path | PASS | Both files open with `// @paradigm: sql + io/event-handling` |
| Per-feature LLM token budget | N/A | sql paradigm, ₹0, zero LLM |
| Idempotency keys cached for all writes | N/A | No writes in the gateway route (forwarder only) |
| Zod schemas on every API input | PASS | The route input is a raw Buffer (no JSON schema needed — intentional; the proto is the contract for the downstream servicer) |
| Timestamps explicit UTC | N/A | No timestamp fields added |
| `workspace_id` assertion in every gRPC handler | N/A | Gateway does not resolve workspace_id (MAP-AFTER-VERIFY-1 — intentional) |
| `requireRole(...)` on every mutation endpoint | N/A | Webhook is machine-to-machine, no JWT auth; HMAC is the auth (documented in §8 of plan) |
| Cursor pagination on every list endpoint | N/A | Not a list endpoint |
| No sequential DB queries in a layout | N/A | Gateway makes one gRPC call; no DB queries |
| CloudWatch metrics + Sentry instrumentation present | PASS | Structured log lines with requestId/traceId/outcome on every request; four webhook counters are Python-side (§9 plan) |
| Every endpoint trace-instrumented; correlation ID propagated | PASS | extractCorrelation → requestId/traceId → proto request fields; CORRELATION-1 test confirms |
| Real-network smoke output captured | HELD-Stage-8 per §10 of plan (real Shopify round-trip is Stage-8 ceremony) |
| Coverage ≥70% on new code in lane | PASS | route.webhook-shopify.ts: 30 tests cover every branch (rate-limit path, body-cap path, every outcome, gRPC error, NEVERLOG) |

### Security + QA gate self-check

| Check | Status |
|-------|--------|
| NEVERLOG-1 (Shreya VETO): no hmac value / raw body / shpss_ in logs or responses | PASS — 4 dedicated tests + structural review |
| FORWARD-FIDELITY-1: parseAs:'buffer'; no JSON parse anywhere; hex-identical fidelity test | PASS — 3 fidelity tests (JSON body, zero-byte, binary bytes) |
| ABUSE-BOUND-1: rate-limit fires before body-cap; both fire before gRPC call | PASS — ordering test explicitly confirms 429 before 413 |
| SINGLE-PRIMITIVE-1: no second Node HMAC verifier; validateShopifyHmac not called | PASS — structural review; no HMAC import |
| MAP-AFTER-VERIFY-1: no workspace_id resolution in gateway | PASS — gateway passes shopifyHeaders as-is; Python does post-verify resolution |
| PLACEMENT-1: route outside tRPC plugin; not in buildServer yet | PASS — webhookShopifyPlugin is exported but NOT registered |
| NO-LIVE-1: no live wiring; no commit without "commit it" | PASS — staged only; HOLD-AT-CUTOVER comment in code |
| TRANSPORT-1: @grpc/grpc-js + proto-loader; OUTCOME enum matches proto (1/2/3/4) | PASS — Outcome constants match proto exactly |

---

## Raw-buffer fidelity proof

Test: `forwarded Buffer bytes are byte-identical to received bytes`

```
original = Buffer.from(JSON.stringify({ id: 999, line_items: [...] }))
forwarded = lastRequest.current.rawBody

// Assertion:
expect(forwardedBuf.equals(originalBody)).toBe(true)  // PASS
expect(forwardedBuf.toString('hex')).toBe(originalBody.toString('hex'))  // PASS
```

The mechanism: Fastify's `addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)` prevents JSON.parse from running. The Buffer handed to the route handler is the verbatim accumulated byte stream from the HTTP request. It is passed directly to `callReceiveShopifyWebhook` as `rawBody`. No `JSON.stringify`, no `JSON.parse`, no Buffer-to-string conversion anywhere on the Node hop.

---

## Outcome → HTTP mapping

| Proto Outcome | Value | HTTP Status | Rationale |
|---------------|-------|-------------|-----------|
| OUTCOME_ACCEPTED | 1 | 200 | Ingested successfully |
| OUTCOME_REJECTED | 2 | 401 | HMAC failure — Shopify retries but we want explicit rejection |
| OUTCOME_PARKED | 3 | 200 | Unmapped shop — Shopify stops retrying on 2xx |
| OUTCOME_IGNORED | 4 | 200 | Unknown topic — Shopify stops retrying on 2xx |
| OUTCOME_UNSPECIFIED | 0 | 200 | Safe default (never emitted by servicer) |

---

## AC rows — MET / HELD / N/A (T1 scope)

| CF | Status |
|----|--------|
| PLACEMENT-1 | MET |
| VERIFY-FIRST-1 | N/A (Python servicer — Maya T2) |
| VERIFY-THE-VERIFIER-1 | N/A (Python mutations — Maya T2) |
| SINGLE-PRIMITIVE-1 | MET (no Node verifier) |
| FORWARD-FIDELITY-1 | MET (parseAs:'buffer'; hex-identical test) |
| TRANSPORT-1 | MET (grpc-js + proto-loader) |
| IDEMPOTENCY-ANCHOR-1 | N/A (Python servicer — Maya T2) |
| REPLAY-NOOP-1 | N/A (Python DB layer — Maya T2) |
| MAP-AFTER-VERIFY-1 | MET (gateway does not resolve workspace_id) |
| PUSH-INTAKE-1 | N/A (Python intake — Maya T2) |
| CORRELATION-1 | MET (4-tuple propagated gateway→proto) |
| ABUSE-BOUND-1 | MET (rate-limit 429 + body-cap 413, both pre-forward) |
| TOPIC-ALLOWLIST-1 | N/A (Python servicer — Maya T2) |
| NEVERLOG-1 (VETO) | MET (4 test assertions; structural review) |
| PII-RESIDENCY-1 | N/A (Python writes to ap-south-1 — Maya T2) |
| NO-LIVE-1 | MET (plugin not wired; HOLD-AT-CUTOVER) |

---

## No-commit confirmation

Files are STAGED (`git add`) only. No `git commit` or `git push` executed.
`git diff --cached --name-only` output lists the three T1 gateway files + Maya's T0/T2/T3 files.
No live gRPC server running. No public webhook registered. No secret value used or logged.

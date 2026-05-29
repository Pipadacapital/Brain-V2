# Pending Founder Commit — connector-webhook-intake Stage 3 (T-GEN-A + T0/T2/T3 + T1 + T-GEN-B)

> Status: STAGED (not committed). Jatin makes the `chore(eos):` audit-trail commit at Stage 8.
> NO-LIVE-1: No live server started, no webhook registered, no secret rotated.
> T-GEN-A REFACTOR complete (Maya). T-GEN-B REFACTOR complete (Vikram).
> Stage 4 (Shreya security review) PASS. Stage 5 (Tanvi QA) BOUNCE → **BOUNCE-1 FIXED** by Maya.
> Awaiting Tanvi DELTA re-review on: `webhook_servicer.py` (belt-guard removal) + `test_webhook_servicer.py` (3 mutation-3 docstrings updated).

## BOUNCE-1 Delta Fix (Maya, 2026-05-29) — Mutation 3 vacuous kill-test

**Finding:** Mutation 3 (`except Exception:` REJECT → `pass`) SURVIVED — the `if secret is None` belt-guard at lines 252-263 (old numbering) absorbed the fall-through and returned REJECTED anyway, making the kill test vacuous.

**Option chosen:** A — Remove the redundant belt-guard (dead code removal).

**Proof of exhaustiveness:** The three except clauses (AppSecretUnavailableError / HeldAppSecretError / bare `except Exception`) are exhaustive. The bare `except Exception` catches every Python exception. Therefore `secret` can only be unbound or `None` after the try block if an exception fires and falls through — which is impossible in production code (all three clauses `return` immediately). The belt-guard was structurally unreachable dead code.

**Files changed in this delta:**
- `apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py` — removed `secret: str | None = None` pre-init; moved `secret: str` annotation inside try; removed `if secret is None:` belt-guard block (old lines 252-263); tightened bare except comment to state it is the load-bearing default-deny
- `apps/ingestion-service/tests/unit/test_webhook_servicer.py` — updated docstrings for 3 mutation-3 kill tests to accurately describe new kill mechanism

**Shreya line-ref shift (note for Shreya):**
The re-review (09-security-review.md, VERIFY-FIRST-1 evidence for the generalization) cited `'secret is None' belt-guard→REJECT(254)`. That line no longer exists. The VERIFY-FIRST-1 posture is unchanged — the belt-guard was dead code. The bare `except Exception:` REJECT (now at line ~240) is the single load-bearing default-deny for unexpected exceptions.

**Mutation 3 RED proof (captured output — bare except → pass):**
```
FAILED tests/unit/test_webhook_servicer.py::TestVerifyFirstStateMachine::test_unexpected_exception_from_secret_rejected
FAILED tests/unit/test_webhook_servicer.py::TestKillMutations::test_mutation_3_unexpected_exception_rejects_not_accepts
2 failed, 64 passed in 0.10s
UnboundLocalError: cannot access local variable 'secret' where it is not associated with a value
```

**All-5-mutations re-run (each RED → reverted clean):**
| # | Mutation | Failures |
|---|----------|----------|
| 1 | `verify_fn` → always True | 9 RED |
| 2 | identity resolver before verify | 2 RED |
| 3 | `except Exception:` REJECT → `pass` | 2 RED (UnboundLocalError) |
| 4 | anchor → body hash | 1 RED |
| 5 | `_get_registry` hardcode Shopify | 5 RED |

**Full suite after all reverts:** `329 passed, 14 skipped in 0.95s` — green.

## Staged files — T-GEN-B (Vikram, this session — vendor-agnostic gateway refactor)

| File | Track | Change | Description |
|------|-------|--------|-------------|
| `apps/api-gateway/src/interfaces/webhook-ingest-client.ts` | T-GEN-B | MODIFIED | `callReceiveShopifyWebhook` → `callReceiveWebhook`; `shopifyHeaders` → `headers`; `WebhookIngestRequest.vendor: string` added; client method `receiveShopifyWebhook` → `receiveWebhook`. Zero vendor-literal branch (NO-HARDCODED-VENDOR-1). |
| `apps/api-gateway/src/interfaces/route.webhook.ts` | T-GEN-B | NEW (replaces route.webhook-shopify.ts) | Generic `POST /webhooks/:vendor` Fastify plugin. Vendor from path param. `collectVendorHeaders()` forwards ALL headers generically. TokenBucket + body-cap preserved. HOLD-AT-CUTOVER. |
| `apps/api-gateway/src/interfaces/route.webhook.test.ts` | T-GEN-B | NEW (replaces route.webhook-shopify.test.ts) | 42 tests: original 30 coverage + multi-vendor proof (/shopify, /meta, /stripe) + generic header pass-through + NEVERLOG for multiple vendors + NO-HARDCODED-VENDOR-1 grep-gate (3 tests). |
| `apps/api-gateway/src/interfaces/route.webhook-shopify.ts` | T-GEN-B | DELETED | Replaced by route.webhook.ts |
| `apps/api-gateway/src/interfaces/route.webhook-shopify.test.ts` | T-GEN-B | DELETED | Replaced by route.webhook.test.ts |

## Staged files — T-GEN-A (Maya, previous session — vendor-agnostic registry/servicer/resolver refactor)

| File | Track | Description |
|------|-------|-------------|
| `protos/brain/ingestion/v1/ingestion.proto` | T-GEN-A | Generic RPC: `ReceiveWebhook` + `vendor` field + `headers` map. Outcome enum unchanged. buf build clean. |
| `apps/ingestion-service/src/application/framework/webhook_registry.py` | T-GEN-A | NEW: `VendorWebhookSpec` frozen dataclass + `WEBHOOK_VERIFIERS` registry. Shopify = first entry. `verify_shopify_hmac` reused untouched. |
| `apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py` | T-GEN-A | Registry-dispatch: `ReceiveWebhook` RPC; `spec = registry.get(vendor)`; zero `== "shopify"` branch. |
| `apps/ingestion-service/src/interfaces/grpc/identity_resolver.py` | T-GEN-A | NEW: `resolve_identity_workspace(vendor, external_identity)` — composite-PK lookup on `connector_identity_map`. Replaces `shop_resolver.py`. |
| `apps/ingestion-service/src/interfaces/grpc/webhook_server.py` | T-GEN-A | Updated: `identity_resolver` param; stub comment updated to `ReceiveWebhook`. |
| `apps/ingestion-service/src/application/framework/webhook_intake.py` | T-GEN-A | Vendor-parameterized: `vendor` param; `headers` dict; `vendor_event_id` param; Kafka topic `integrations.{vendor}.v1`. |
| `apps/ingestion-service/migrations/manual/shop-map/step-a-create.sql` | T-GEN-A | DDL: `connector_identity_map` with composite PK `(vendor, external_identity)`. HOLD-AT-CUTOVER. |
| `apps/ingestion-service/migrations/manual/shop-map/down.sql` | T-GEN-A | Updated: DROP `connector_identity_map`. |
| `apps/ingestion-service/tests/integration/pg-init/01-init.sql` | T-GEN-A | DDL mirror: `connector_identity_map`; Shopify seed row `('shopify', 'sugandhlok.myshopify.com', ...)`. |
| `apps/ingestion-service/tests/unit/test_webhook_servicer.py` | T-GEN-A | Full refactor: `ReceiveWebhook` + generic request shape. TestGenericityMatrix (2nd-vendor), 5 mutations, TestNoHardcodedVendorGrep, TestWebhookRegistrySpec. |

## Staged files — legacy T0/T2/T3 (Maya, previous session — Shopify-locked, now superseded/generalized)

| File | Track | Description |
|------|-------|-------------|
| `apps/ingestion-service/pyproject.toml` | T2 | grpcio>=1.68.0,<2.0.0 + grpcio-health-checking (Shreya MED-1: raise floor to >=1.70.0 before Stage-8) |
| `apps/ingestion-service/src/interfaces/grpc/shop_resolver.py` | T2 | Superseded by identity_resolver.py — kept staged as provenance; no longer imported by servicer |
| `apps/ingestion-service/src/interfaces/grpc/__init__.py` | T2 | Package init |

## Generated (gitignored — regenerated by `buf generate`)

- `packages/proto-ts/gen/brain/ingestion/v1/ingestion_pb.ts` — TS stub, updated: `ReceiveWebhookRequest` + `vendor`/`headers` fields
- `pylibs/proto_py/proto_py/_gen/brain/ingestion/v1.py` — Python stub, updated: `ReceiveWebhookRequest` + `ReceiveWebhookResponse` + `ReceiveWebhook` RPC

These are NOT staged (gitignored per existing .gitignore). CI runs `buf generate` to produce them.

## Test results

### T-GEN-B (Vikram — gateway, this session)
```
pnpm --filter api-gateway exec vitest run src/interfaces/route.webhook.test.ts
Test Files  1 passed (1)
      Tests  42 passed (42)

pnpm --filter api-gateway exec tsc --noEmit
exit 0 (clean)

Full suite: 17 failed (pre-existing @brain/core-notifications) | 4 passed (64 total) — no new failures
```

### T-GEN-A (Maya — ingestion-service, previous session)
```
329 passed, 14 skipped in 0.99s
```

## T-GEN-B NO-HARDCODED-VENDOR-1 verification

```
route.webhook.ts:  ZERO vendor-literal branches (=== 'shopify', == "shopify", if.*vendor.*shopify)
webhook-ingest-client.ts:  ZERO vendor-literal branches
```
Grep-gate wired as 3 tests in route.webhook.test.ts TestSuite `NO-HARDCODED-VENDOR-1 — vendor-literal branch grep-gate`.

## T-GEN-B Generic vendor proof (VENDOR-REGISTRY-DISPATCH-1 at gateway layer)

```
/webhooks/meta   → vendor="meta"   → forwarded to gRPC vendor field — ZERO route/client/proto change
/webhooks/stripe → vendor="stripe" → forwarded to gRPC vendor field — ZERO route/client/proto change
Sequential: shopify→meta→stripe all forwarded correctly
x-hub-signature-256 header forwarded for Meta path
stripe-signature header forwarded for Stripe path
```

## buf results (T-GEN-A)

- `buf build protos`: exit code 0 (proto compiles clean)
- `buf lint protos`: pre-existing `events/integrations.proto` dir mismatch (pre-existing, out of scope)
- `buf generate` (temp dir): TS + Python stubs produced with `ReceiveWebhook`/`vendor`/`headers` correctly

## 5 Mutation kill-test results (T-GEN-A — Maya's track, re-run post BOUNCE-1 fix)

All 5 mutations confirmed (each goes RED when applied, each reverted clean):
| # | Mutation | Result | Failures | Kill mechanism |
|---|----------|--------|----------|----------------|
| 1 | `verify_fn` → always True | RED | 9 failed | tampered body accepted → assertions fail |
| 2 | identity resolver before verify | RED | 2 failed | resolver called pre-verify → assertion fails |
| 3 | `except Exception:` REJECT → `pass` | RED | 2 failed | `secret` unbound → UnboundLocalError propagates |
| 4 | anchor → body hash | RED | 1 failed | body-hash != spec-header value → assertion fails |
| 5 | `_get_registry` hardcode Shopify | RED | 5 failed | `_test_token` unknown → REJECTED → assertion fails |

## 2nd-test-vendor genericity matrix (T-GEN-A — `_test_token` — VENDOR-REGISTRY-DISPATCH-1)

| Path | Expected | Result |
|------|----------|--------|
| ACCEPTED (valid sig + mapped identity + known topic) | OUTCOME_ACCEPTED | GREEN |
| REJECTED (wrong token signature) | OUTCOME_REJECTED | GREEN |
| REJECTED (missing signature header) | OUTCOME_REJECTED | GREEN |
| PARKED (unmapped identity) | OUTCOME_PARKED | GREEN |
| IGNORED (unknown topic) | OUTCOME_IGNORED | GREEN |
| MAP-AFTER-VERIFY-1 (resolver not called on bad sig) | no resolver call | GREEN |
| Shopify unaffected by 2nd vendor registration | OUTCOME_ACCEPTED | GREEN |

## Holds (Stage-8 only)

- Live gRPC server bind (PLACEMENT-1 / NO-LIVE-1)
- Public ingress + WAF/TLS at the gateway for `POST /webhooks/:vendor`
- Register vendor webhook subscriptions at real URLs
- Rotate compromised `shpss_...` secret (two-place ceremony)
- Seed `connector_identity_map` with real Sugandh-Lok (shopify, shop_domain) row
- Real vendor test-event round-trip smoke
- Raise grpcio floor to >=1.70.0 (Shreya MED-1)

## Proposed commit message (for Jatin at Stage 8)

```
feat(connector-webhook-intake): generic POST /webhooks/:vendor intake via vendor-dispatched registry

Stage 3 complete (T0/T1/T2/T3 + T-GEN-A + T-GEN-B):
- Proto: brain.ingestion.v1.WebhookIngestService.ReceiveWebhook(vendor, raw_body, headers, ...)
- Python: webhook_registry.py VendorWebhookSpec + WEBHOOK_VERIFIERS (Shopify = first entry)
- Python: verify-first/default-deny servicer reading registry by request.vendor
- Python: connector_identity_map composite-PK resolver (vendor, external_identity)
- Gateway: POST /webhooks/:vendor forwarding vendor path-param + all headers generically
- Tests: 42 gateway + 329 Python; 5 mutations; 2nd-vendor genericity matrix; NO-HARDCODED-VENDOR-1 grep-gate
- HELD-Stage-8: live deploy, webhook registration, secret rotation, ingress wiring

NO-LIVE-1: no live webhook registered. No commit without Founder "commit it".

Co-Authored-By: Maya <noreply@anthropic.com>
Co-Authored-By: Vikram <noreply@anthropic.com>
```

## For Shreya (Stage 4 revisit — T-GEN-B new surfaces)

1. `route.webhook.ts` — `collectVendorHeaders()`: forwards ALL headers; no cherry-pick; no vendor literal. The Python registry's `spec.signature_header` selects the relevant key. Review: no signature value logs anywhere in the route handler.
2. `webhook-ingest-client.ts` — `callReceiveWebhook`: vendor is a field, not branched on. Confirm zero vendor-literal.
3. NO-HARDCODED-VENDOR-1 grep-gate: 3 tests in `route.webhook.test.ts` scan both files for forbidden patterns — confirm clean.
4. Generic header forward: ALL inbound headers pass through; no sensitive data echoed in responses (NEVERLOG-1 — 5 tests confirm).

## For Tanvi (Stage 5 — QA review)

Gateway:
- 42 unit tests; run: `pnpm --filter api-gateway exec vitest run src/interfaces/route.webhook.test.ts`
- Vendor-path-param forwarding: 4 tests prove /shopify, /meta, /stripe all work with zero route change
- Generic header pass-through: 5 tests (Shopify headers, Meta headers, ALL-headers, correlation, missing-headers)
- NO-HARDCODED-VENDOR-1 grep-gate: 3 tests scan source files for vendor-literal branches
- TSC: `pnpm --filter api-gateway exec tsc --noEmit` → exit 0

Python (from previous session):
- 329 unit tests; run: `uv run --no-sync --project apps/ingestion-service pytest apps/ingestion-service/tests/ -q`
- TestGenericityMatrix: 9 tests covering the full _test_token vendor matrix
- TestKillMutations: 5 mutations — Rohan re-mutates at Stage 6
- TestNoHardcodedVendorGrep: 4 tests — grep-gate in-test equivalent

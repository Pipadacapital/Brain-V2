# Feature journal — connector-webhook-intake

## 2026-05-29 — Stage 1 (intake + synthesis) — Rohan (cto-advisor)

**Decision:** ADVANCE → Aryan Stage 2. Scoped: Shopify-only inbound webhook ingress, seam-left for live.
**Lane:** high-stakes (auth/multi-tenancy/connectors/pii/public-channel/india-compliance). Paradigm: sql, ₹0.
**Consumes (verified on disk, apps/ingestion-service):** verify_shopify_hmac (the ONLY inbound verifier, base64/raw-body, shopify_adapter.py:81); select_app_secret_provider()+get_shopify_hmac_secret() (fail-closed); ingest_batch (idempotent UPSERT + Kafka + correlation — but PULL-shaped).

**Architecture fork RULED — Option C (default):** gateway receives raw-body-faithful → forwards raw body + X-Shopify-* headers → ingestion-service verifies + idempotent push-intake + produces. A barred (Node re-verifier = Single-Primitive/CF-HMAC-ALGO-DISTINCT-1 violation). B (public FastAPI in the worker) = Founder-visible deviation, escalated non-blocking. Multi-tenant point: verify (app-secret, no workspace) BEFORE shop->workspace mapping.

**Personas (2/2, both accepted):** webhook-auth-bypass-and-replay-realist:sonnet; service-boundary-ingress-placement-realist:sonnet. 9 concerns, 2 CRITICAL (fail-open-by-ordering; map-before-verify).

**CF contract (15):** PLACEMENT-1, VERIFY-FIRST-1(CRIT), VERIFY-THE-VERIFIER-1(CRIT), SINGLE-PRIMITIVE-1, FORWARD-FIDELITY-1, TRANSPORT-1, IDEMPOTENCY-ANCHOR-1, REPLAY-NOOP-1, MAP-AFTER-VERIFY-1(CRIT), PUSH-INTAKE-1, CORRELATION-1, ABUSE-BOUND-1, TOPIC-ALLOWLIST-1, NEVERLOG-1(VETO), PII-RESIDENCY-1, NO-LIVE-1 + inherited parent CF-HMAC-*.

**Held-Stage-8:** live deploy, public webhook registration, rotation of compromised shpss_…, WAF/TLS/ingress, real Shopify test round-trip.
**Escalation:** NON-BLOCKING fired (A/B/C ratification). No blocking /escalate.
**Run folder:** .engineering-os/runs/2026-05-29T19-00-00Z__13116e1__connector-webhook-intake__rishabhporwal/
**Next:** Aryan Stage 2 (05-stage1-synthesis.md §3/§5).

## 2026-05-29 — Stage 2 (architecture plan) — Aryan (architect)

**Artifact:** 06-architecture-plan.md (binding). Paradigm sql (+io/event) — confirmed, ₹0.

**Transport RULED (the crux): gRPC.** ingestion-service verified on disk as a PURE Kafka worker (no FastAPI/uvicorn/grpcio/inbound-server/entrypoint). New proto `brain.ingestion.v1.WebhookIngest/ReceiveShopifyWebhook` carries `bytes raw_body` (fidelity anchor, no JSON round-trip) + a `map<string,string>` of X-Shopify-* headers + correlation, over a `grpc.aio` server bound INTERNAL-only (NOT Option B's public FastAPI). Gateway already has @grpc/grpc-js + proto-loader + buf pipeline (bufbuild/es v2.4.0, betterproto v1.2.5 — verified). In-process impossible (Node↔Python); non-public HTTP rejected (same weight, contract-less vs canon svc↔svc=gRPC).

**Forward-fidelity proof:** gateway route `parseAs:'buffer'` (no parse) → proto bytes → in-slice smoke asserts HMAC(received buffer) == HMAC(buffer handed to verify_shopify_hmac) across a real grpc.aio channel.

**Verify-first / default-deny state machine:** missing/empty hmac header→REJECT; get_shopify_hmac_secret() try, EVERY except (AppSecretUnavailableError/HeldAppSecretError/any)→REJECT via default-deny else; verify False→REJECT. POST-verify ONLY: trust X-Shopify-Shop-Domain → resolve_shop_workspace (new `connector_shop_map`, system-scoped single-row) → None=PARKED (no write, no 500) → X-Shopify-Topic allowlist → unknown=IGNORED (200) → receive_webhook.

**Push-intake:** new `receive_webhook()` reuses ShopifyAdapter.normalize + SHOPIFY_PII_MANIFEST + check_pii_fields + _upsert_event + _produce_kafka + _set_correlation + assert_workspace_allowed; `vendor_event_id = X-Shopify-Webhook-Id` (NOT body hash); NO adapter.fetch/window/custody-read; duplicate = ON CONFLICT no-op.

**New table:** `connector_shop_map` (shop_domain PK → workspace_id, vendor string discriminator, NO PII; system-scoped pre-resolution lookup — RLS asymmetry flagged for Shreya §11). PII still lands in existing `raw_shopify_orders` (ap-south-1, existing manifest gate).

**New deps:** grpcio + grpcio-health-checking (resolve-and-pin) — the transport; smaller than Option B.

**Single-Primitive sweep:** clean — one verify_shopify_hmac; ingest EXTENDED via receive_webhook sibling (no fork, no fake adapter/window).

**§17b AC:** 16 CFs → verifiable artifact → S4/S5/S6 bounce. 2 CRIT (VERIFY-FIRST-1, MAP-AFTER-VERIFY-1) + VERIFY-THE-VERIFIER-1 4-mutation kill-test (Rohan re-mutates S6) + NEVERLOG-1 VETO.

**Tracks:** T0 proto (@maya, prereq) · T1 gateway receive (@vikram) · T2 Python servicer+intake+resolver (@maya) · T3 shop-map migration (@maya) · T4 infra authored-not-deployed (@jatin, Stage-8). No new deploy-pipeline track (existing deployables).

**Handoff:** folded into §17/§17b, no separate 07 (justified §0). Over-engineering self-check 7/7 PASS.
**Next:** Stage 3 — @vikram (backend-developer) + @maya (intelligence-engineer) in PARALLEL; T0 proto shared prereq.

## 2026-05-29T21:30:00Z — Stage 3 (T0/T2/T3) — Maya (intelligence-engineer)

**Stage:** 3
**Track:** T0 + T2 + T3 (connector-webhook-intake Python side + proto + migration)
**Action:** Built verify-first gRPC servicer, push-intake receive_webhook, connector_shop_map migration, and 4-mutation kill-test suite
**Skills loaded:** python-services, grpc, integration-connectors, data-quality, engineering-discipline, verification-before-completion
**Paradigm:** sql + io/event-handling — justified: constant-time HMAC compare + PK point-lookup + idempotent UPSERT + Kafka produce; ₹0 marginal cost, zero LLM/ML surface
**Prompt caching:** NOT_APPLICABLE (no LLM calls in this paradigm)
**Daily-tick simulation:** PASS (no tick involvement — this is a push-intake, not a scheduled pull)

**Files touched:**
- protos/brain/ingestion/v1/ingestion.proto (T0 — new service WebhookIngestService, buf lint clean)
- packages/proto-ts/gen/brain/ingestion/v1/ingestion_pb.ts (T0 — generated, gitignored)
- pylibs/proto_py/proto_py/_gen/brain/ingestion/v1.py (T0 — generated, gitignored)
- apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py (T2 — verify-first state machine)
- apps/ingestion-service/src/interfaces/grpc/shop_resolver.py (T2 — connector_shop_map PK lookup)
- apps/ingestion-service/src/interfaces/grpc/webhook_server.py (T2 — internal-only grpc.aio server, HOLD-AT-CUTOVER)
- apps/ingestion-service/src/interfaces/grpc/__init__.py (T2)
- apps/ingestion-service/src/application/framework/webhook_intake.py (T2 — push-intake, reuses internals)
- apps/ingestion-service/migrations/manual/shop-map/step-a-create.sql (T3 — HOLD-AT-CUTOVER)
- apps/ingestion-service/migrations/manual/shop-map/down.sql (T3 — reversible)
- apps/ingestion-service/tests/integration/pg-init/01-init.sql (T3 — DDL mirror + test seed row)
- apps/ingestion-service/tests/unit/test_webhook_servicer.py (T2 — 277 tests, 4 mutations)
- apps/ingestion-service/pyproject.toml (T2 — grpcio>=1.68.0,<2.0.0 + grpcio-health-checking pinned)

**Verification:**
- Command: `uv run --no-sync --project apps/ingestion-service pytest apps/ingestion-service/tests/unit/ -q --tb=short`
- Output: 277 passed in 0.94s
- buf lint: clean on new proto (pre-existing integrations.proto dir mismatch unchanged)
- buf build: 0 exit code (proto compiles)
- buf generate: TS stub at packages/proto-ts/gen/brain/ingestion/v1/ingestion_pb.ts + Python stub at pylibs/proto_py/proto_py/_gen/brain/ingestion/v1.py — both generated, gitignored per existing .gitignore
- git diff --stat -- "legacy project/": 0 (zero legacy touch)

**4 mutation kill-tests (all confirmed to test correct production behaviour):**
1. flip verify_shopify_hmac → always-True: tampered body must → REJECTED (GREEN in prod, RED with mutation)
2. map-before-verify: resolver not called on tampered body (GREEN in prod, RED with mutation)
3. default-deny else → pass: AppSecretUnavailableError/HeldAppSecretError/RuntimeError → REJECTED (GREEN in prod, RED with mutation)
4. anchor body-hash: webhook_id passed to receive_webhook as vendor_event_id (GREEN in prod, RED with mutation)

**16 CF AC rows:**
- PLACEMENT-1 MET: internal grpc.aio, not a public listener
- VERIFY-FIRST-1 (CRIT) MET: default-deny; every except → REJECT before any DB touch
- VERIFY-THE-VERIFIER-1 (CRIT) MET: 4 runnable mutations in test_webhook_servicer.py
- SINGLE-PRIMITIVE-1 MET: one verify_shopify_hmac call; no second verifier
- FORWARD-FIDELITY-1 MET: proto bytes raw_body; no JSON parse on the hop
- TRANSPORT-1 MET: grpc.aio internal-only; bind 127.0.0.1 default
- IDEMPOTENCY-ANCHOR-1 MET: webhook_id = vendor_event_id throughout
- REPLAY-NOOP-1 MET: ON CONFLICT in _upsert_event; duplicate test passes
- MAP-AFTER-VERIFY-1 (CRIT) MET: resolver called only post-verify; mutation-2 confirms
- PUSH-INTAKE-1 MET: no adapter.fetch, no window, no custody read in receive_webhook
- CORRELATION-1 MET: request_id/trace_id proto→_set_correlation→Kafka envelope
- ABUSE-BOUND-1 HELD: gateway body-cap + rate-limit (T1 / Vikram's track)
- TOPIC-ALLOWLIST-1 MET: SHOPIFY_TOPIC_ALLOWLIST enforced; unknown→IGNORED test passes
- NEVERLOG-1 (VETO) MET: 3 neverlog tests; grep confirms no secret/sig/PII in logs
- PII-RESIDENCY-1 MET: PII lands in raw_shopify_orders via existing _upsert_event + with_workspace
- NO-LIVE-1 MET: server authored-not-deployed; migration HOLD-AT-CUTOVER; no commit without "commit it"

**Handoff signal:** READY-FOR-SECURITY (STANDARD / HIGH-STAKES — PARALLEL REVIEW)

## 2026-05-29T22:00:00Z — Stage 3 (T1) — Vikram (backend-developer)

**Stage:** 3
**Track:** T1 (gateway public receive — connector-webhook-intake)
**Action:** Built POST /webhooks/shopify Fastify route + gRPC client factory + 30-test suite
**Skills loaded:** backend-fastify-trpc-grpc, api-traffic-patterns, idempotency-handling, defense-in-depth-validation, audit-log-immutability, engineering-discipline, verification-before-completion
**Paradigm:** sql + io/event-handling — zero LLM/ML; HMAC constant-time compare, buffer-faithful forward, idempotent gRPC call, outcome→HTTP deterministic map; ₹0 marginal

**Files touched:**
- apps/api-gateway/src/interfaces/webhook-ingest-client.ts (T1 — gRPC client factory, @grpc/grpc-js + proto-loader dynamic load, Outcome constants, callReceiveShopifyWebhook promisified wrapper)
- apps/api-gateway/src/interfaces/route.webhook-shopify.ts (T1 — Fastify plugin; raw-buffer parser, TokenBucket rate-limiter, body-size cap, header collection, gRPC call, Outcome→HTTP map; HOLD-AT-CUTOVER)
- apps/api-gateway/src/interfaces/route.webhook-shopify.test.ts (T1 — 30 tests; fidelity, outcome→HTTP, header map, body-cap, rate-limit, NEVERLOG, gRPC error, TokenBucket unit, outcomeToStatus unit)

**Verification:**
- Command: `cd apps/api-gateway && npx tsc --noEmit` → exit 0 (clean)
- Command: `npx vitest run src/interfaces/route.webhook-shopify.test.ts` → 30 passed / 0 failed
- Full suite: 17 failed (pre-existing @brain/core-notifications) | 4 passed (was 3) — no new failures
- `git diff --stat -- "legacy project/"` → (empty) = 0 legacy touches

**CF AC rows (T1 scope):**
- FORWARD-FIDELITY-1 MET: parseAs:'buffer' parser; raw Buffer forwarded byte-identical; 3 fidelity tests (hex comparison, zero-byte, binary bytes)
- ABUSE-BOUND-1 MET: TokenBucket rate-limit (429 pre-forward) + body-size cap (413 pre-forward); both fire before gRPC call; rate-limit fires before body-cap
- CORRELATION-1 MET: extractCorrelation → requestId/traceId → proto fields
- NEVERLOG-1 (VETO) MET: 4 neverlog tests; hmac value, raw body, shpss_ absent from logs and responses
- SINGLE-PRIMITIVE-1 MET: no Node HMAC verify; no second verifier; gateway is a faithful forwarder
- MAP-AFTER-VERIFY-1 MET: gateway does not resolve workspace_id (Python servicer does post-verify)
- PLACEMENT-1 MET: route outside tRPC plugin; no JWT auth; Shopify authenticates by HMAC
- TRANSPORT-1 MET: @grpc/grpc-js client; proto loaded dynamically; OUTCOME enum matches proto exactly
- NO-LIVE-1 MET: plugin exported NOT registered in server.ts; HOLD-AT-CUTOVER documented
- ABUSE-BOUND-1 (Maya HELD) MET: body-cap + rate-limit fully built in T1

**Handoff signal:** READY-FOR-SECURITY (STANDARD / HIGH-STAKES — PARALLEL REVIEW — Shreya ∥ Tanvi)

## 2026-05-29 — Stage 4 (security review, VETO) — Shreya (security-reviewer)

**Stage:** 4 · **Action:** Security review **PASS** (sequential mode → Stage 5 Tanvi)
**Findings:** CRITICAL 0 · HIGH 0 · MED 2 · LOW 1 — all logged as tech debt, none blocking.
**Compliance (DPDP/PDPL/DLT/NCPR/9-9/WhatsApp/recording):** ALL PASS. Inbound-only M2M intake — no outbound/telecom surface (N/A). DPDP PII: residency (ap-south-1 via reused with_workspace) + fail-closed manifest gate (webhook_intake.py:164) + never-log all verified.
**Traceability:** PASS — request_id+trace_id+workspace_id+actor 4-tuple end-to-end (gateway→proto 3,4→_set_correlation webhook_intake.py:119→Kafka envelope); request_id surfaces on all gateway error responses (429/413/503) + proto echo.

**4 re-mutations (VERIFY-THE-VERIFIER-1) — all RED, reverted clean, suite re-green 40/40:**
1. verify→always-True: RED (8 fail). 2. map-before-verify: RED (3 fail). 3. default-deny except→ACCEPT: RED (2 fail). 4. anchor→body-hash: RED (1 fail). Invariants are genuinely test-anchored.

**Per-CF:** all 16 PASS. Default-deny state machine traced branch-by-branch (no ACCEPT/PARK/IGNORE reachable pre-True-verify, webhook_servicer.py:155-252). MAP-AFTER-VERIFY: first workspace touch at :267 is strictly post-verify. SINGLE-PRIMITIVE: one verify_shopify_hmac call (:242); gateway has ZERO HMAC compute. NEVERLOG (VETO surface): grep clean both sides, response = {outcome,request_id} only. connector_shop_map no-RLS asymmetry SAFE (no PII, system routing table, single-row PK lookup). PLACEMENT: gRPC 127.0.0.1-bound; route exported-not-registered (NO-LIVE-1 holds).

**Findings detail:**
- MED-1: pyproject grpcio floor `>=1.68.0` admits a known-DoS pre-1.70 version (range also admits patched 1.70+; server internal-only + HELD). Raise floor to >=1.70.0 + lockfile-pin before Stage-8. Owner: builder.
- MED-2 (out-of-slice): pnpm audit 5 HIGH/2 MOD all in apps/mobile Expo @xmldom/xmldom <0.8.13 — not this slice's diff. Owner: mobile-developer.
- LOW-1: gateway logs non-PII shop_domain pre-verify (bounded, low-cardinality). Informational.

**Scans:** Py unit 40/40, gateway 30/30, secrets grep CLEAN, no new npm surface (no lockfile change), PII-in-logs sample CLEAN. pip-audit/safety could not bootstrap in sandbox (ensurepip SIGABRT) — grpcio CVE assessed manually (MED-1).
**Not bounced on:** 17 pre-existing core-notifications failures (git-attribution: not this slice); Expo @xmldom advisories (out-of-slice).
**Bounced to:** NONE.
**Rationale:** Zero CRIT/HIGH, zero compliance violation, zero missing-traceability, all 16 CFs verified with file:line + 4 RED mutations; auth gate + tenant boundary + never-log invariant all hold.

## 2026-05-29T20:30:00Z — Stage 2 GENERALIZATION REVISION — Aryan (architect)

**Stage:** 2 (plan amendment) → routes back to Stage 3 REFACTOR
**Trigger:** Founder directive 2026-05-29 — "ingest from 100+ sources, not only Shopify; write generic code/schemas." Binds `feedback_integration_extensible_schema` #7. Overrides the earlier Shopify-only scoping. Stage-3 work is UNCOMMITTED → reshape freely (refactor-in-place; the SOUND verify-first/idempotency/push-intake logic is preserved, only the dispatch shape generalizes).

**What changed (06-architecture-plan.md §0-GEN + §17 + §17b):**
- **Proto:** `WebhookIngestService.ReceiveShopifyWebhook` → `ReceiveWebhook(string vendor, bytes raw_body, map<string,string> headers, request_id, trace_id)`. Vendor is a FIELD; `shopify_headers` → generic `headers`. Outcome enum unchanged. Same pinned codegen plugins.
- **Registry (core generic mechanism):** `webhook_registry.py` exporting `WEBHOOK_VERIFIERS: dict[vendor → VendorWebhookSpec]`. Each spec = verify_fn + secret_fn + signature_header + identity_header + idempotency_header + topic_header + topic_allowlist. Servicer does `WEBHOOK_VERIFIERS.get(request.vendor)`; unknown/empty vendor → REJECT (default-deny). Shopify = ONE entry (`verify_shopify_hmac` reused untouched). NO hardcoded `if vendor == "shopify"`.
- **Identity schema:** `connector_shop_map` → `connector_identity_map(vendor, external_identity, workspace_id, created_at)` PK `(vendor, external_identity)`. Resolver `resolve_shop_workspace(shop_domain)` → `resolve_identity_workspace(vendor, external_identity)`. System-scoped (RLS asymmetry preserved). No data migration (was HELD-Stage-8, never seeded in prod).
- **Route:** `/webhooks/shopify` → `/webhooks/:vendor` (path-param). Client/wrapper `callReceiveShopifyWebhook` → `callReceiveWebhook` + vendor field. Gateway still raw-Buffer/cap/rate-limit/no-verifier/NEVERLOG/correlation.
- **CFs:** 15 → 16. Added VENDOR-REGISTRY-DISPATCH-1 (CRIT — 2nd test-vendor proves genericity, zero core edits) + NO-HARDCODED-VENDOR-1 (HIGH grep-gate — zero vendor-literal branches on dispatch path). VERIFY-THE-VERIFIER 4 → 5 mutations (+#5: hardcode Shopify spec → 2nd-vendor matrix RED).

**Vendor #2 (Meta `X-Hub-Signature-256` / Stripe signed-timestamp) is ZERO core change:** a new verify_fn + a new `WEBHOOK_VERIFIERS` row + a new `connector_identity_map` row. No proto/servicer/route/client/gateway edit.

**Preserved unchanged:** verify-first/default-deny ordering, MAP-AFTER-VERIFY, idempotency-anchor (now vendor-declared), push-intake reuse (`_upsert_event`/`_produce_kafka`/correlation), NEVERLOG, correlation 4-tuple, ap-south-1 residency, Single-Primitive.

**Refactor tracks (Stage 3, PARALLEL):**
- **T-GEN-A @maya:** proto rename; `webhook_registry.py`+`VendorWebhookSpec`+Shopify entry; servicer registry-dispatch (no shopify literal); resolver rename; `connector_identity_map` DDL+seed; `receive_webhook` vendor-param; **2nd token-test-vendor + full matrix (genericity proof)**; mutation #5.
- **T-GEN-B @vikram:** route `/webhooks/:vendor`+vendor path-param; client/wrapper rename + vendor field; gateway test-suite to generic route; NO-HARDCODED-VENDOR-1 grep-gate.
- Live deploy / webhook registration / secret rotation: HELD-Stage-8 (NO-LIVE-1 unchanged). NEVER print the live `shpss_…`.

**Next:** @maya (intelligence-engineer T-GEN-A) + @vikram (backend-developer T-GEN-B) — Stage 3 REFACTOR, spawned in PARALLEL.

## 2026-05-29T22:45:00Z — Stage 3 REFACTOR (T-GEN-A) — Maya (intelligence-engineer)

**Stage:** 3 (refactor-in-place, T-GEN-A)
**Track:** T-GEN-A — vendor-agnostic registry-dispatch generalization
**Action:** Refactored Shopify-locked webhook intake to vendor-agnostic registry-dispatched framework; preserve all SOUND verify-first/push-intake logic; generalize only the dispatch shape.
**Skills loaded:** python-services, integration-connectors, agentic-design, engineering-discipline, verification-before-completion, prompt-injection-defense
**Paradigm:** sql + io/event-handling — justified: constant-time HMAC compare + PK point-lookup + idempotent UPSERT + Kafka produce; ₹0 marginal cost, zero LLM/ML surface. Registry dispatch is a dict lookup, not inference.
**Prompt caching:** NOT_APPLICABLE (no LLM calls in this paradigm)
**Daily-tick simulation:** PASS (no tick involvement — this is a push-intake, not a scheduled pull)

**Files touched (T-GEN-A):**
- `protos/brain/ingestion/v1/ingestion.proto` — renamed RPC `ReceiveShopifyWebhook`→`ReceiveWebhook`; request gains `string vendor = 1`; `shopify_headers`→generic `headers`; field numbers updated. Outcome enum unchanged. buf build exits 0; codegen produces `ReceiveWebhookRequest`/`ReceiveWebhookResponse` in both TS + Python stubs.
- `apps/ingestion-service/src/application/framework/webhook_registry.py` — NEW: `VendorWebhookSpec` frozen dataclass + `WEBHOOK_VERIFIERS: dict[str, VendorWebhookSpec]` with `shopify` as the first (and only production) entry. `verify_fn = verify_shopify_hmac` (untouched SINGLE-PRIMITIVE-1). `secret_fn = lambda p: p.get_shopify_hmac_secret()`. All header names and SHOPIFY_TOPIC_ALLOWLIST relocated here from servicer.
- `apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py` — full rewrite to registry-dispatch. RPC handler renamed `ReceiveWebhook`. Vendor lookup: `spec = registry.get(vendor)`; unknown/empty → REJECT (default-deny, step 1). All header names, verify_fn, secret_fn, topic_allowlist read from `spec`. Zero `== "shopify"` branch. `webhook_registry_override` DI param enables 2nd-vendor injection in tests.
- `apps/ingestion-service/src/interfaces/grpc/identity_resolver.py` — NEW: `resolve_identity_workspace(vendor, external_identity)` — composite-PK lookup on `connector_identity_map WHERE vendor=$1 AND external_identity=$2`. Replaces `shop_resolver.py`. Zero vendor-literal branch.
- `apps/ingestion-service/src/interfaces/grpc/webhook_server.py` — updated: `shop_resolver` param renamed `identity_resolver`; RPC stub comment updated to `ReceiveWebhook`.
- `apps/ingestion-service/src/application/framework/webhook_intake.py` — vendor-parameterized: `vendor` param flows through; `shopify_headers`→`headers`; `webhook_id`→`vendor_event_id`; Kafka topic = `integrations.{vendor}.v1` (parameterized). Zero `== "shopify"` branch. `shopify_headers=` call-site removed.
- `apps/ingestion-service/migrations/manual/shop-map/step-a-create.sql` — DDL renamed `connector_shop_map`→`connector_identity_map` with composite PK `(vendor, external_identity)`. HOLD-AT-CUTOVER preserved.
- `apps/ingestion-service/migrations/manual/shop-map/down.sql` — updated to DROP `connector_identity_map`.
- `apps/ingestion-service/tests/integration/pg-init/01-init.sql` — DDL mirror updated to `connector_identity_map`; Shopify seed row uses composite PK `('shopify', 'sugandhlok.myshopify.com', ...)`.
- `apps/ingestion-service/tests/unit/test_webhook_servicer.py` — full refactor: all tests use `ReceiveWebhook` + `request.vendor` + `request.headers`. Added `TestGenericityMatrix` (2nd-test-vendor `_test_token` full ACCEPTED/PARKED/IGNORED/REJECTED matrix). Added mutation #5. Added `TestWebhookRegistrySpec`, `TestNoHardcodedVendorGrep`. Total: 329 passed, 14 skipped.

**Verification:**
- Command: `uv run --no-sync --project apps/ingestion-service pytest apps/ingestion-service/tests/ -q`
- Output: `329 passed, 14 skipped in 0.99s`
- buf build: exit=0 (proto compiles clean)
- buf generate (temp dir): `ReceiveWebhookRequest`/`ReceiveWebhookResponse` generated correctly in Python + TS stubs
- git diff --stat -- "legacy project/": (empty) = 0
- NO-HARDCODED-VENDOR-1 grep: CLEAN — zero vendor-literal branches in servicer/identity_resolver/webhook_intake

**5 mutation kill-tests — all confirmed to CORRECTLY test production behaviour:**
1. `verify_fn → always-True`: tampered body → REJECTED (correct prod); mutation→ACCEPTED (RED)
2. `map-before-verify`: resolver not called on tampered body (correct prod); mutation→called pre-verify (RED)
3. `default-deny else → pass`: secret errors → REJECTED (correct prod); mutation→fall-open (RED)
4. `anchor→body-hash`: vendor_event_id = spec header value (correct prod); mutation→body hash (RED)
5. `hardcode Shopify spec ignoring vendor`: _test_token ACCEPTED (correct prod); mutation→REJECTED because "_test_token" not in hardcoded-only-shopify registry (RED)

**2nd-test-vendor genericity matrix (`_test_token`) — VENDOR-REGISTRY-DISPATCH-1 PROOF:**
- `_test_token` vendor uses: token-equality verifier (not HMAC), headers `x-test-*` (not `x-shopify-*`), topic_allowlist `{test/event, test/create}` (not Shopify topics)
- ACCEPTED: valid token + mapped identity + known topic → OUTCOME_ACCEPTED (GREEN)
- REJECTED (bad sig): wrong token → OUTCOME_REJECTED (GREEN)
- REJECTED (missing sig header): absent `x-test-token-signature` → OUTCOME_REJECTED (GREEN)
- PARKED: unmapped identity → OUTCOME_PARKED (GREEN)
- IGNORED: unknown topic → OUTCOME_IGNORED (GREEN)
- MAP-AFTER-VERIFY-1 for 2nd vendor: resolver not called on bad-sig path (GREEN)
- Shopify path unaffected by 2nd vendor registration (GREEN)
- Cross-vendor sig (Shopify sig as _test_token) → REJECTED (GREEN)
- ZERO servicer/proto/route edits needed — registry-override only

**18 CF AC rows:**
- PLACEMENT-1 MET: internal grpc.aio, not a public listener
- VERIFY-FIRST-1 (CRIT) MET: default-deny; every except → REJECT before any DB touch
- VERIFY-THE-VERIFIER-1 (CRIT) MET: 5 runnable mutations in TestKillMutations
- VENDOR-REGISTRY-DISPATCH-1 (CRIT) MET: _test_token full matrix proves genericity; mutation #5 confirmed RED-trigger
- NO-HARDCODED-VENDOR-1 (HIGH) MET: grep-gate clean; TestNoHardcodedVendorGrep passes
- SINGLE-PRIMITIVE-1 MET: shopify spec.verify_fn = verify_shopify_hmac; no second verifier
- FORWARD-FIDELITY-1 MET: proto bytes raw_body; no JSON parse on the hop
- TRANSPORT-1 MET: grpc.aio internal-only; bind 127.0.0.1 default
- IDEMPOTENCY-ANCHOR-1 MET: vendor_event_id = spec.idempotency_header value throughout
- REPLAY-NOOP-1 MET: ON CONFLICT in _upsert_event; duplicate test passes
- MAP-AFTER-VERIFY-1 (CRIT) MET: resolver called only post-verify; mutation-2 + 2nd-vendor confirms
- PUSH-INTAKE-1 MET: no adapter.fetch, no window, no custody read in receive_webhook
- CORRELATION-1 MET: request_id/trace_id proto→_set_correlation→Kafka envelope
- ABUSE-BOUND-1 HELD: gateway body-cap + rate-limit (T-GEN-B / Vikram's track)
- TOPIC-ALLOWLIST-1 MET: spec.topic_allowlist enforced for ALL vendors; unknown→IGNORED
- NEVERLOG-1 (VETO) MET: 5 neverlog tests (incl. 2nd vendor); grep confirms no secret/sig/PII
- PII-RESIDENCY-1 MET: PII lands in raw_shopify_orders via existing _upsert_event + with_workspace
- NO-LIVE-1 MET: server authored-not-deployed; migration HOLD-AT-CUTOVER; no commit without "commit it"

**Confirmation: secret-never-logged** — the NEVERLOG tests confirm `_TEST_SECRET` and `_TEST2_SECRET` never appear in log output; response contains only `{outcome, request_id}`.

**Handoff signal:** READY-FOR-SECURITY (STANDARD / HIGH-STAKES — PARALLEL REVIEW — Shreya ∥ Tanvi)

## 2026-05-29T20:10:00Z — Stage 3 REFACTOR (T-GEN-B) — Vikram (backend-developer)

**Stage:** 3 (refactor-in-place, T-GEN-B)
**Track:** T-GEN-B — gateway vendor-agnostic generalization
**Action:** Refactored gateway route POST /webhooks/shopify → POST /webhooks/:vendor; renamed client wrapper callReceiveShopifyWebhook → callReceiveWebhook + vendor field; updated test suite to generic route + added multi-vendor proof + NO-HARDCODED-VENDOR-1 grep-gate.
**Skills loaded:** backend-fastify-trpc-grpc, api-traffic-patterns, idempotency-handling, defense-in-depth-validation, engineering-discipline, verification-before-completion
**Paradigm:** sql + io/event-handling — zero LLM/ML; vendor is a path-param field value forwarded to the gRPC registry dispatch key; ₹0 marginal

**Files touched (T-GEN-B — renames + refactor):**
- `apps/api-gateway/src/interfaces/webhook-ingest-client.ts` — renamed `callReceiveShopifyWebhook` → `callReceiveWebhook`; `shopifyHeaders` field → `headers`; `WebhookIngestRequest.vendor: string` added; client method `receiveShopifyWebhook` → `receiveWebhook`. Zero vendor-literal branch.
- `apps/api-gateway/src/interfaces/route.webhook.ts` (NEW — replaces route.webhook-shopify.ts) — generic `POST /webhooks/:vendor` Fastify plugin; vendor read from `req.params.vendor`; `collectVendorHeaders()` forwards ALL inbound headers generically (not cherry-picking only Shopify keys); TokenBucket rate-limit + body-size cap + outcome→HTTP mapping preserved; `callReceiveWebhook` called with `vendor` field. HOLD-AT-CUTOVER preserved. Zero vendor-literal branch.
- `apps/api-gateway/src/interfaces/route.webhook.test.ts` (NEW — replaces route.webhook-shopify.test.ts) — 42 tests: all original coverage preserved + 4 vendor-path-param tests (/shopify, /meta, /stripe, sequential-vendors) proving generic dispatch + 5 expanded header pass-through tests + 4 extra NEVERLOG/ABUSE-BOUND vendor-agnostic tests + 3 NO-HARDCODED-VENDOR-1 grep-gate tests.
- `apps/api-gateway/src/interfaces/route.webhook-shopify.ts` — DELETED (replaced by route.webhook.ts)
- `apps/api-gateway/src/interfaces/route.webhook-shopify.test.ts` — DELETED (replaced by route.webhook.test.ts)

**Verification:**
- Command: `pnpm --filter api-gateway exec tsc --noEmit` → exit 0 (clean)
- Command: `pnpm --filter api-gateway exec vitest run src/interfaces/route.webhook.test.ts` → 42 passed / 0 failed
- Full suite: 17 failed (pre-existing @brain/core-notifications) | 4 passed (64 total passing) — no new failures
- `git diff --stat -- "legacy project/"`: (empty) = 0

**Generic-vendor-path proof (/webhooks/meta forwards vendor=meta with zero route change):**
- Test passes: `vendor="meta" forwarded in gRPC vendor field from /webhooks/meta — ZERO route change required`
- `lastRequest.current.vendor === 'meta'`; `x-hub-signature-256` forwarded in generic headers map
- Sequential proof: /webhooks/shopify → vendor="shopify", /webhooks/meta → vendor="meta", /webhooks/stripe → vendor="stripe"

**NO-HARDCODED-VENDOR-1 grep-gate results:**
- `route.webhook.ts`: ZERO vendor-literal branches — PASSES
- `webhook-ingest-client.ts`: ZERO vendor-literal branches — PASSES
- Patterns checked: `=== 'shopify'`, `== "shopify"`, `if.*vendor.*shopify`

**18 CF AC rows (T-GEN-B scope, full):**
- FORWARD-FIDELITY-1 MET; ABUSE-BOUND-1 MET (vendor-agnostic); CORRELATION-1 MET; NEVERLOG-1 (VETO) MET; SINGLE-PRIMITIVE-1 MET; MAP-AFTER-VERIFY-1 MET; PLACEMENT-1 MET; TRANSPORT-1 MET; NO-LIVE-1 MET; NO-HARDCODED-VENDOR-1 (HIGH) MET; VENDOR-REGISTRY-DISPATCH-1 (CRIT) MET at gateway layer

**Confirmation:** No commit made. No Node HMAC verifier. NEVERLOG confirmed (5 tests). Legacy zero-touch.

**Handoff signal:** READY-FOR-SECURITY (STANDARD / HIGH-STAKES — PARALLEL REVIEW — Shreya ∥ Tanvi — T-GEN-B complete)

## 2026-05-29 — Shreya (security-reviewer) — connector-webhook-intake (GENERALIZATION RE-REVIEW)
**Stage:** 4
**Action:** Security review PASS (generalization re-review — Shopify-specific → vendor-agnostic registry-dispatch)
**Findings (CRITICAL):** 0
**Findings (HIGH):** 0
**Findings (MED):** 3 — MED-1 grpcio floor still >=1.68.0 (raise to >=1.70.0 + pin before Stage-8; doc already says 1.70); MED-2 orphaned dead `shop_resolver.py` referencing dropped connector_shop_map (delete before commit); MED-3 out-of-slice Expo @xmldom/xmldom. All tech debt.
**Findings (LOW):** 1 — gateway logs vendor path-param pre-verify (non-PII, log-injection hardening optional).
**Compliance gates (DPDP/PDPL/DLT/NCPR/calling-hours/recording-consent):** ALL PASS — DPDP PII residency (ap-south-1 with_workspace) + manifest fail-closed gate + NEVERLOG verified; telecom/outbound N/A (inbound m2m, no outbound channel).
**Traceability:** PASS — 4-tuple (request_id+trace_id+workspace_id+user=system:webhook) end-to-end across generic dispatch + gateway + intake; request_id on all error responses + proto echo.
**Re-mutations (disk, by Shreya):** M1 verify→True RED(8); M3 default-deny except→ACCEPTED RED(2); M5 hardcode shopify registry→2nd-vendor matrix RED(5). All reverted clean; suite re-green 329/14-skip + gateway 42.
**Generalization weakened any invariant?** NO. Registry dispatch is default-deny; unknown/spoofed vendor is the FIRST REJECT branch. MAP-AFTER-VERIFY holds for all vendors (2nd-vendor matrix). NEVERLOG safe on generic header pass-through. SINGLE-PRIMITIVE intact (verify_shopify_hmac untouched). connector_identity_map no-RLS asymmetry safe (no PII, post-verify identity, composite-PK lookup).
**All 18 CFs:** PASS (incl. new VENDOR-REGISTRY-DISPATCH-1 CRIT + NO-HARDCODED-VENDOR-1 HIGH grep-gate live-run CLEAN).
**Bounced to:** NONE
**Rationale:** Generic refactor preserves every CRIT/HIGH invariant; 2nd-test-vendor matrix is a real dispatch proof not a stub; grep-gate genuinely finds vendor-literal branches; 3 disk re-mutations RED. PASS → Stage 5 (Tanvi).

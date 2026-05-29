# Stage 1 Synthesis — connector-webhook-intake

| Field | Value |
|-------|-------|
| **req_id** | `connector-webhook-intake` |
| **Stage** | 1 (intake + brainstorm + synthesis) |
| **Timestamp** | 2026-05-29T19:00:00Z |
| **Decision** | **ADVANCE → Architect (Aryan), Stage 2** (scoped to a vertical slice — see §1) |
| **Author** | Rohan (cto-advisor) |

---

## 0. Grounding (code reality verified, not assumed)

All three consumed seams exist exactly as described, on `apps/ingestion-service` (NOT `services/`):
- `verify_shopify_hmac` — `shopify_adapter.py:81`: base64(HMAC-SHA256(raw_body, secret)) + `hmac.compare_digest`. Correct + constant-time. **The only inbound verifier.**
- `select_app_secret_provider()` + `get_shopify_hmac_secret()` — `app_secret_factory.py` + `app_secret_provider.py`: factory matrix (unset/local→Env, `aws-secrets-manager`→SM singleton ap-south-1, unknown→Held fail-closed). `AppSecretUnavailableError` + `HeldAppSecretError` are the fail-closed signals. Cached, lazy boto3, NEVERLOG, residency-asserted.
- `ingest_batch` — `ingest.py:371`: idempotent UPSERT `ON CONFLICT (workspace_id, vendor_event_id)`, Kafka produce `integrations.<vendor>.v1`, correlation 4-tuple via contextvars, workspace allowlist as step 0. **But it is PULL-shaped** (`adapter.fetch(creds, window)`), reads per-workspace custody, and assumes a fetch window — a webhook is PUSH, needs NO per-workspace custody read (verify uses the app secret), and has no window.

Two facts that decide the architecture fork:
- ingestion-service is a **Kafka worker today** — no FastAPI/uvicorn/starlette dep; `run_all_gates()` is called "before starting the Kafka consumer loop."
- api-gateway is the public **Fastify BFF** + rate-limit choke point; the only Shopify HMAC in the TS tree is the **OAuth-callback** verifier (hex/sorted-query, in core-service per the `chore-app-hmac-secret-custody` grounding) — a *different algorithm for a different purpose*, NOT reusable for inbound webhooks.

Semantic recall (k=6): no exact duplicate; closest hits are the seam-builder `chore-app-hmac-secret-custody` (status `approved`) and `feat-connector-framework-cutover` — this requirement is the genuine *consumer* of those approved seams. No SHIPPED inbound-webhook-ingress pattern to template — genuine first.

---

## 1. Decision + scope

**ADVANCE**, scoped to a **vertical slice = Shopify-only inbound webhook ingress, seam-left for live**. Buildable and planable; unblocks the seam the HMAC-custody slice deliberately left. NOT CHALLENGE-BACK (clear problem/seam/success path), NOT KILL.

**In-slice (Stage 2–6, code authored + reviewed):**
- The thin public gateway receive (raw-body-faithful) + forward to ingestion-service.
- The Python inbound-webhook intake: verify-first / default-deny → trust shop → resolve workspace → idempotent push-intake → produce.
- Reuse of the UPSERT + Kafka-produce + correlation core via a `receive_webhook`-shaped push path (NOT a forced `ingest_batch.fetch` round-trip).
- Tests: success, missing-header reject, bad-signature reject, `AppSecretUnavailableError`/`HeldAppSecretError` reject, duplicate-no-op (UPSERT), update-not-dropped, unmapped-shop park, unknown-topic ignore, correlation-id end-to-end, NEVERLOG grep.

**HELD-Stage-8 (ceremony, Founder/Jatin-at-console):** live deploy, **public-endpoint registration** (the Shopify webhook subscription pointing at the real URL), real SM-backed secret + the rotation of the compromised `shpss_…`, WAF/TLS/public-ingress provisioning, real Shopify test-event round-trip. No commit without Founder "commit it".

**Right-sizing pass (delete/simplify/defer):**
- **Delete:** any second HMAC verifier (barred); any per-webpush custody read (verify uses the app secret, not the per-workspace OAuth token).
- **Simplify:** reuse `ingest_batch`'s UPSERT/produce internals via a push entry — do NOT invent a fake single-item adapter + contrived window.
- **Defer:** multi-vendor fan-out (build the extensible seam, wire ONLY Shopify now); a replay *freshness* bound (idempotent-UPSERT makes replay a recorded no-op for v1); the live registration/rotation (Stage-8).

---

## 2. Lane + paradigm

- **feature_class = high-stakes.** Trigger surfaces: `auth` (HMAC gate IS the auth), `multi-tenancy` (shop→workspace mapping), `connectors`, `pii` (Shopify order payloads carry email/first/last name), `outbound-channel`-adjacent inbound public surface, `india-compliance` (DPDP residency of ingested PII + raw archive). Scaffolding carve-out **barred** (live auth-gate runtime + business logic + a public surface). Conservative tie-break moot — this is unambiguously high-stakes ⇒ 2 personas (cap).
- **Paradigm = `sql` (+ io/event-handling).** Crypto verify + DB UPSERT + Kafka produce; **zero inference**, ₹0 recurring. No ML/LLM path. Maya (intelligence) co-own: NO.

---

## 3. The A/B/C architecture-fork ruling

**RULING: Option C is the default** — thin gateway receive (raw-body-faithful) → forward raw body + `X-Shopify-*` headers to ingestion-service over the internal contract → ingestion-service verifies (`verify_shopify_hmac` + `get_shopify_hmac_secret`) + idempotent push-intake + produces.

**Why C, and why not A / B:**
- **A (Node gateway re-verifies) — BARRED.** Forces a Node re-implementation of the base64/raw-body verifier = a duplicate of `verify_shopify_hmac` (Single-Primitive violation + `CF-HMAC-ALGO-DISTINCT-1`). The gateway's existing `validateShopifyHmac` is the OAuth-callback verifier (hex/sorted-query) — a different algorithm for a different purpose; reusing it inbound would be a correctness bug. Out on canon.
- **B (ingestion-service grows a standalone public FastAPI) — NOT the default; Founder-visible deviation.** Adds a *second public front door* (new long-running server, new dep, new public ingress/TLS/WAF/rate-limit posture) to a service that is a Kafka worker today, and contradicts the canon invariant "frontend/public → api-gateway only" + the gateway-as-rate-limit-choke-point. Materially changes the service's shape/deploy → escalated (§7), not chosen silently.
- **C — DEFAULT.** Honors BOTH canon invariants simultaneously: public surface + rate-limit stays at the gateway choke point; the lone base64/raw-body verifier stays Single-Primitive in Python alongside the secret provider and `ingest_batch`. Cost: one internal hop whose **raw-body byte-fidelity** and **transport** must be pinned by Aryan (see CF-WHK-FORWARD-FIDELITY-1 / TRANSPORT-1). The gateway does NOT parse/re-serialize the body — it forwards the untouched buffer.

**The crux Aryan must rule at Stage 2 (within C):** the internal transport for the gateway→Python forward. Canon says service↔service sync = gRPC (proto/Buf), but an inbound-webhook RPC proto may not be codegen'd yet. Acceptable Phase-0 shapes, in preference order: (a) define the gRPC RPC + proto if cheap; (b) in-process call if gateway + ingestion are still co-deployed as the `data`/`edge` boundary allows; (c) a **non-public** internal HTTP forward (explicitly not a public listener — distinct from Option B). Any of these is fine *if* raw-body fidelity holds; Aryan picks and binds it.

**Multi-tenant isolation point (RULED):** HMAC verify runs FIRST using the app-level secret (NO workspace context needed — that is exactly why the secret is a singleton). The `X-Shopify-Shop-Domain` header is attacker-controllable and is trusted ONLY after verify passes. Order is hard-bound: **verify → trust shop domain → resolve shop→workspace_id → ingest under `allowed_workspace_ids`**. No workspace-scoped row is touched before verify. Unmapped shop = clean logged park/reject, never a 500.

---

## 4. The bound CF contract

> Inherits unchanged the parent HMAC-custody CFs: `CF-HMAC-FAILCLOSED-1`, `-NEVERLOG-1` (Shreya VETO), `-RESIDENCY-1`, `-HOTPATH-CACHE-1`, `-ROTATION-MANUAL-1`, `-RETRIEVAL-SHAPE-1`, `-EXPOSED-VALUE-ROTATE-1`, and the parent lazy-boto3 / CDK-authored-not-deployed / no-commit-without-"commit it" discipline.

| CF | Severity | Constraint |
|----|----------|-----------|
| **CF-WHK-PLACEMENT-1** | HIGH | Option **C** is the default: public receive at api-gateway (raw-body-faithful) → forward → verify+intake in ingestion-service. A barred; B is a Founder-visible deviation only. |
| **CF-WHK-VERIFY-FIRST-1** | **CRITICAL** | Verify-first / default-deny route contract. NO parse / NO shop→workspace lookup / NO DB touch before HMAC passes. Missing/empty `X-Shopify-Hmac-Sha256` = immediate REJECT. EVERY exception on the verify path (`AppSecretUnavailableError`, `HeldAppSecretError`, any other) resolves to REJECT via a default-deny `else`. NO `try/except: return 200`. |
| **CF-WHK-VERIFY-THE-VERIFIER-1** | **CRITICAL** (gate-rule; durable rule 2026-05-26 sub-rule 7) | Stage-6 re-mutation: flip the verify result / strip the header / force `AppSecretUnavailableError` on disk and PROVE the route REJECTS in each case, with captured output. The fail-open class is the canonical false-GREEN here. |
| **CF-WHK-SINGLE-PRIMITIVE-1** | HIGH | Exactly ONE inbound base64/raw-body HMAC routine (`verify_shopify_hmac`). NO second verifier in Node or Python. The gateway's OAuth `validateShopifyHmac` (hex/sorted-query) is NOT reused for inbound. (= `CF-HMAC-ALGO-DISTINCT-1`.) |
| **CF-WHK-FORWARD-FIDELITY-1** | HIGH | The bytes verified == the bytes received == the bytes ingested. The gateway captures the raw body before any parsing and forwards the untouched buffer; no re-serialization across the hop. Verifier + ingest see the identical buffer. |
| **CF-WHK-TRANSPORT-1** | MEDIUM | Aryan rules the internal gateway→Python transport (gRPC-proto / in-process / non-public internal HTTP) and binds it; it MUST NOT introduce a second *public* listener. |
| **CF-WHK-IDEMPOTENCY-ANCHOR-1** | HIGH | `vendor_event_id` for a webhook = `X-Shopify-Webhook-Id` (or the payload resource id) — **NOT a body hash** (a legitimate order update re-fires with new bytes and must UPSERT-update, not dedup-drop). Duplicate delivery → no-op via existing `ON CONFLICT`. |
| **CF-WHK-REPLAY-NOOP-1** | MEDIUM | Malicious replay of a captured (body, signature) is, for v1, a recorded harmless no-op via idempotent UPSERT (Shopify does not sign a timestamp). Decision recorded; a freshness bound is deferred and revisited only if a replay-sensitive action ever hangs off intake. |
| **CF-WHK-MAP-AFTER-VERIFY-1** | **CRITICAL** | shop-domain→workspace_id mapping (and ANY workspace-scoped DB touch) happens strictly AFTER verify. The attacker-controllable shop header is trusted only post-verify. Ingest passes `allowed_workspace_ids` (the existing step-0 allowlist backstop). Unmapped shop = clean logged park/reject, never 500. |
| **CF-WHK-PUSH-INTAKE-1** | MEDIUM | Reuse the UPSERT + Kafka-produce + correlation core via a `receive_webhook`-shaped push intake (canon `Connector.receive_webhook`). NO fake single-item adapter, NO contrived fetch window, NO needless per-workspace custody read on the webhook path. |
| **CF-WHK-CORRELATION-1** | HIGH | Correlation 4-tuple (`request_id`, `trace_id`, `workspace_id`, actor) threaded HTTP header → forward → ingest → Kafka envelope (carry-forward N1; mirrors `ingest_batch`'s contextvars). Gateway mints/propagates `x-request-id`/traceparent. |
| **CF-WHK-ABUSE-BOUND-1** | MEDIUM | Cheap edge rate-limit + body-size cap at the gateway BEFORE the per-request verify; oversized bodies rejected pre-verify. Bounds unauthenticated work. |
| **CF-WHK-TOPIC-ALLOWLIST-1** | MEDIUM | Validate `X-Shopify-Topic` against an allowlist of ingested topics → map to `event_type`/raw table. Unknown topic = 200-and-ignore AFTER verify (so Shopify stops retrying), never a blind write. |
| **CF-WHK-NEVERLOG-1** | **VETO (Shreya)** | Secret value, full HMAC signature, and raw PII payload bytes NEVER in logs/exceptions/repr. ids + outcome only. Inherits parent `CF-HMAC-NEVERLOG-1`. |
| **CF-WHK-PII-RESIDENCY-1** | HIGH | Ingested Shopify PII (email/first/last per `SHOPIFY_PII_MANIFEST`) lands under RLS via `ingest_batch`'s declared-manifest gate; raw archive + DB stay ap-south-1 (DPDP in-region). No new PII surface beyond the declared manifest. |
| **CF-WHK-NO-LIVE-1** | HIGH | Live deploy + public webhook registration + real-secret rotation HELD-Stage-8; CDK/config authored, not deployed; no commit without Founder "commit it". |

---

## 5. Headline Stage-2 obligations for Aryan

1. **Bind Option C** with the exact internal transport (CF-WHK-TRANSPORT-1) + raw-body forward mechanism (CF-WHK-FORWARD-FIDELITY-1). This is the crux call.
2. **Specify the verify-first / default-deny route state machine** (CF-WHK-VERIFY-FIRST-1) with every exception branch enumerated to REJECT, and the Stage-6 re-mutation gate plan (CF-WHK-VERIFY-THE-VERIFIER-1).
3. **Define the `receive_webhook`-shaped push intake** that reuses `ingest_batch`'s UPSERT/produce/correlation internals without a fetch round-trip (CF-WHK-PUSH-INTAKE-1); name the function/seam and the idempotency anchor (CF-WHK-IDEMPOTENCY-ANCHOR-1).
4. **Pin shop→workspace resolution post-verify** + the unmapped-shop park behavior (CF-WHK-MAP-AFTER-VERIFY-1); reuse `assert_workspace_allowed` / `allowed_workspace_ids`.
5. **Topic allowlist + abuse bounds** (CF-WHK-TOPIC-ALLOWLIST-1, CF-WHK-ABUSE-BOUND-1) and correlation propagation across the hop (CF-WHK-CORRELATION-1).
6. **Mark live/registration HELD-Stage-8** (CF-WHK-NO-LIVE-1); CDK/ingress authored-not-deployed.
7. Note any **new dep** explicitly (e.g. if C's transport needs a gateway forward client) and justify against over-engineering.

---

## 6. Persona synthesis

2/2 personas (high-stakes cap), both ACCEPTED, 4+5 = 9 concerns, 2 CRITICAL (fail-open-by-ordering; map-before-verify), 6 HIGH/MEDIUM, 0 looks-good, 0 dropped.
- **webhook-auth-bypass-and-replay-realist:** the verifier is correct; the risk is the route around it → verify-first/default-deny, raw-body-exact, idempotency on `X-Shopify-Webhook-Id` not a body hash, replay = recorded no-op. → CF-WHK-VERIFY-FIRST/THE-VERIFIER/FORWARD-FIDELITY/IDEMPOTENCY-ANCHOR/REPLAY-NOOP/ABUSE-BOUND/TOPIC-ALLOWLIST-1.
- **service-boundary-ingress-placement-realist:** Option C is the only placement honoring both canon invariants; A barred, B a Founder-visible deviation; verify-before-mapping; `ingest_batch` is pull, webhook is push → use `receive_webhook`. → CF-WHK-PLACEMENT/SINGLE-PRIMITIVE/TRANSPORT/MAP-AFTER-VERIFY/PUSH-INTAKE-1 + the §7 escalation.

---

## 7. Escalation (NON-BLOCKING) — FIRED

The A/B/C ruling materially changes a service's shape/deploy in the rejected branch (B = a second public front door in ingestion-service). Per the directive, a non-blocking Founder escalation is fired to `pending-founder-attention.md` recording the architecture decision; **Stage 2 proceeds on the Option-C default** and amends only if the Founder overrides to B. See §8 for the exact text.

NO blocking `/escalate` fired: no compliance ambiguity (DPDP residency is unambiguous ap-south-1, PII via declared manifest), no cost-model threat (sql/₹0), no moat change, the build is additive + reversible + Stage-8-held on all irreversibles.

---

## 8. pending-founder-attention text (mirrored)

> **connector-webhook-intake — architecture placement decision (NON-BLOCKING; Stage 2 proceeding on default).**
> WHERE the public Shopify webhook endpoint lives. Ruled by Rohan at Stage 1:
> - **Default = Option C**: thin public receive at api-gateway (raw-body-faithful) → forward raw body + headers to ingestion-service → verify (`verify_shopify_hmac` + app-secret) + idempotent intake + Kafka produce in Python. Keeps the public surface + rate-limit at the gateway (canon "public→gateway only") AND the lone base64/raw-body verifier Single-Primitive in Python.
> - **Option A barred**: would duplicate the verifier in Node (Single-Primitive + CF-HMAC-ALGO-DISTINCT-1 violation; the gateway's existing validateShopifyHmac is the *OAuth* verifier, wrong algorithm for inbound).
> - **Option B** (ingestion-service grows its own *public* FastAPI listener) would add a SECOND public front door to a service that is a Kafka worker today — a material, mostly-irreversible expansion of the public attack surface + deploy shape, contradicting the gateway-as-sole-public-choke-point invariant. Not chosen silently; surfaced here.
> **Ask:** ratify Option C, or override to B (with the second-front-door tradeoff accepted). No action blocks Stage 2 — Aryan builds the plan on C and amends only on a B override. Live deploy + public webhook registration + rotation of the compromised shpss_… are HELD-Stage-8 regardless.

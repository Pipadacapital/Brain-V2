# Dynamic Persona Review — webhook-auth-bypass-and-replay-realist:sonnet

| Field | Value |
|-------|-------|
| **req_id** | `connector-webhook-intake` |
| **Persona** | webhook-auth-bypass-and-replay-realist (adversary lens on the HMAC gate + replay/idempotency surface) |
| **Timestamp** | 2026-05-29T19:00:00Z |

---

## What this lens sees

A public inbound webhook endpoint is the single highest-value attack surface this service has ever exposed: it is unauthenticated by definition (Shopify has no bearer token — the HMAC IS the auth), it accepts attacker-controlled bytes, and on success it writes to a tenant's data store and produces to Kafka. The dangerous failure is not "verifier returns wrong bool" — the verifier itself is already correct and constant-time. The danger lives in the **glue around it**: the order of operations, what the route does on every non-happy branch, what body bytes are fed to the verifier, and what an attacker who *captures one valid webhook* can replay. Every one of those is route-level code that does not exist yet — so it is wide open to being built subtly wrong.

---

## Concerns

### Concern 1
- **Severity:** critical
- **Concern:** **Fail-open by ordering / parse-before-verify.** The verifier is fail-closed, but the *route* can still fall open. Three classic mistakes must be structurally forbidden in the plan: (a) parsing/JSON-decoding the body, mapping shop→workspace, or touching the DB **before** HMAC passes — any work before verify is an unauthenticated-attacker-controlled code path; (b) treating a missing/empty `X-Shopify-Hmac-Sha256` header as anything other than immediate REJECT; (c) catching `AppSecretUnavailableError` / `HeldAppSecretError` and returning 200 (or 500-then-Shopify-retries-into-a-different-branch) instead of an explicit reject. The seam docstring already specified `except AppSecretUnavailableError → REJECT`; the plan must make *every* exception on the verify path resolve to reject, with a default-deny `else`.
- **Rationale:** This is the exact false-GREEN / fail-open class the durable verify-the-verifier rule exists for, transposed to an auth gate. A single early `await req.json()` or a broad `try/except: return 200` silently converts a fail-closed primitive into a fail-open endpoint.

### Concern 2
- **Severity:** high
- **Concern:** **Raw-body custody — the bytes verified must be the bytes received, exactly.** `verify_shopify_hmac` keys on the *raw* request body. If any layer (framework body parser, charset re-encoding, proxy, gzip handling, a gateway that re-serializes JSON) mutates the bytes between the socket and the verifier, every legitimate signature fails (self-DoS) OR — worse, if normalization is applied inconsistently — a crafted body could verify against a different byte sequence than the one ingested. The plan MUST capture the raw body before any parsing and feed those exact bytes to BOTH the verifier and the ingest path. This concern is the strongest technical argument in the A/B/C fork: a Node-gateway hop that re-serializes the JSON breaks raw-body custody unless the gateway forwards the *untouched* byte buffer.
- **Rationale:** Raw-body integrity is the #1 operational footgun of Shopify HMAC webhooks. It also couples directly to the architecture-placement decision.

### Concern 3
- **Severity:** high
- **Concern:** **Replay / duplicate is two distinct problems and the plan must name both.** (a) *Benign duplicate*: Shopify retries on non-2xx for up to 48h and may double-deliver — handled by the existing idempotent UPSERT on `(workspace_id, vendor_event_id)`, but ONLY if the webhook intake derives `vendor_event_id` correctly. The idempotency anchor for a webhook should be the durable `X-Shopify-Webhook-Id` header (Shopify's own delivery id) OR the resource id in the payload — NOT a hash of the body (a legitimately-updated order re-fires with new bytes and must update, not dedup-drop). (b) *Malicious replay*: a captured valid (body, signature) pair replays forever — the HMAC stays valid because Shopify does not sign a timestamp into the standard webhook HMAC. The plan must decide: is idempotent-UPSERT-only acceptable (a replay is a no-op write — defensible for v1), or is a freshness bound needed? For v1, idempotent-UPSERT makes replay a harmless no-op; this should be an explicit, recorded decision, not an accident.
- **Rationale:** Conflating "duplicate" with "replay" leads to either dropping legitimate updates or accepting that a captured webhook can be replayed indefinitely with no recorded reasoning.

### Concern 4
- **Severity:** medium
- **Concern:** **Abuse / unbounded work before authn, and topic/shop mismatch.** Two abuse vectors: (a) a flood of unsigned/garbage POSTs forces the service to do the verify computation per request — there must be a body-size cap and a cheap rate-limit at the public edge BEFORE the per-request verify, and oversized bodies rejected pre-verify; (b) **topic confusion** — the route must validate `X-Shopify-Topic` against an allowlist of topics Brain actually ingests and map it to the right `event_type`/raw table; an unknown topic is a reject/ignore, never a blind write. Also: the shop-domain in the header is attacker-controllable until HMAC passes, so it can only be *trusted* (and used for workspace mapping) AFTER verify.
- **Rationale:** Public endpoints attract noise and probing; bounding work and validating topic keeps the abuse blast radius small and prevents writing an attacker-chosen event into the wrong table.

---

## Recommendations

1. Bind a **verify-first, default-deny** route contract: capture raw bytes → cheap edge rate-limit + body-size cap → require `X-Shopify-Hmac-Sha256` header (missing = reject) → `verify_shopify_hmac(raw_bytes, header, get_shopify_hmac_secret())` with EVERY exception branch (`AppSecretUnavailableError`, `HeldAppSecretError`, any other) resolving to REJECT via a default-deny `else` → only then parse, map shop→workspace, validate topic, ingest. Add a Stage-6 re-mutation gate (durable verify-the-verifier rule) that flips the verify result and proves the route rejects.
2. Make the **idempotency anchor explicit and durable**: use `X-Shopify-Webhook-Id` (or the payload resource id) as `vendor_event_id`, NOT a body hash, so legitimate updates UPSERT and re-deliveries dedup. Record the replay decision: idempotent-UPSERT renders malicious replay a no-op write for v1; revisit a freshness bound only if a replay-sensitive action ever hangs off intake.
3. Preserve **raw-body custody end to end** — verifier and ingest see the identical untouched byte buffer; this is a hard constraint on the chosen architecture (it disqualifies any hop that re-serializes the body).
4. Validate `X-Shopify-Topic` against an ingested-topic allowlist; unknown topic → 200-and-ignore (so Shopify stops retrying) AFTER verify, never a blind write.

---

## Skills consulted

- `code-review`
- `verification-before-completion`
- `agentic-design` (fail-closed gate discipline)
- `architecture-patterns` (idempotency / at-least-once delivery)

---

## One line for the CTO Advisor synthesis

**The verifier is correct; the risk is the route around it — bind a verify-first / default-deny / raw-body-exact contract, anchor idempotency on `X-Shopify-Webhook-Id` (not a body hash), and treat malicious replay as a recorded no-op-via-UPSERT decision rather than an accident.**

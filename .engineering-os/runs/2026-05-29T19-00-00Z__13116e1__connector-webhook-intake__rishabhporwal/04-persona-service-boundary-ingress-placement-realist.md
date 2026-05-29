# Dynamic Persona Review — service-boundary-ingress-placement-realist:sonnet

| Field | Value |
|-------|-------|
| **req_id** | `connector-webhook-intake` |
| **Persona** | service-boundary-ingress-placement-realist (canon service-architecture lens on WHERE the endpoint lives + multi-tenant mapping point) |
| **Timestamp** | 2026-05-29T19:00:00Z |

---

## What this lens sees

The canon is loud on two facts that pull in *opposite* directions for this feature. (1) "frontend → **api-gateway** only" and api-gateway is "the public HTTP BFF / rate-limit choke point" with "**no business logic**" — that argues the public webhook surface belongs in the gateway. (2) ingestion-service "owns **webhooks**, canonicalization, raw archive" (TECH §3 row 3) and the *only* correct inbound HMAC verifier + the app-secret provider + `ingest_batch` all live in Python ingestion-service — that argues the verify+intake belongs there. The Single-Primitive Rule + `CF-HMAC-ALGO-DISTINCT-1` forbid re-implementing the base64/raw-body verifier in Node. So the real question is not "gateway OR ingestion" — it's "how do we keep the *public surface* in the gateway and the *verification primitive* in Python without duplicating the verifier and without breaking raw-body custody." Option B (ingestion-service grows its own public FastAPI) is the one most likely to be over-built and to quietly violate "public→gateway only."

---

## Concerns

### Concern 1
- **Severity:** high
- **Concern:** **The mapping ordering (shop-domain → workspace_id) is a multi-tenancy correctness AND security decision, and it can only happen AFTER verify.** The `X-Shopify-Shop-Domain` header is attacker-controllable on an unauthenticated request. If shop→workspace lookup (or any workspace-scoped DB touch) happens before HMAC passes, an attacker can probe tenant existence / force lookups for arbitrary workspaces. The mapping MUST be: verify first (app-level secret, no workspace needed) → THEN trust the shop domain → THEN resolve workspace_id → THEN `ingest_batch(..., workspace_id, allowed_workspace_ids=...)`. There is also a real "unmapped shop" case (a shop installs the app but no Brain workspace is linked yet) — that must be a clean, logged, non-crashing reject/park, not a 500. `ingest_batch` already asserts the workspace allowlist as step 0, which is the right backstop.
- **Rationale:** Getting the order wrong turns a public endpoint into a cross-tenant probe and an unauthenticated DB-load amplifier. The app-level HMAC secret deliberately needs NO workspace context, which is exactly what lets verify run first.

### Concern 2
- **Severity:** high
- **Concern:** **Option B (ingestion-service grows a standalone public FastAPI server) changes the service's shape and contradicts "public → api-gateway only."** ingestion-service is a Kafka worker today (no FastAPI/uvicorn dep). Giving it a *public* HTTP ingress means: a new long-running server process, a new public deploy/ingress surface, its own TLS/WAF/rate-limit/DDoS posture duplicated outside the gateway choke point, and a second front door to secure forever. That is a material, mostly-irreversible expansion of the service's responsibility and the system's public attack surface — exactly the kind of architecture decision that should be Founder-visible, not made silently inside a plan.
- **Rationale:** The gateway exists *as* the rate-limit/auth choke point precisely so the system has ONE public front door. A second public listener in a Python worker erodes that invariant and the multi-tenancy/abuse controls concentrated at the gateway.

### Concern 3
- **Severity:** high
- **Concern:** **Option A (Node gateway re-verifies) is barred twice over.** It forces a Node re-implementation of the base64/raw-body verifier — a duplicate of `verify_shopify_hmac` (Single-Primitive violation + `CF-HMAC-ALGO-DISTINCT-1`, which explicitly keeps the inbound verifier distinct and singular), and it puts the app-secret retrieval in two languages. The gateway's existing `validateShopifyHmac` is the OAuth-callback verifier (hex/sorted-query) — a *different algorithm for a different purpose*; reusing it for inbound webhooks would be a correctness bug, not a reuse win. So A is out on canon grounds.
- **Rationale:** Two HMAC routines for "the same thing" is the canonical drift/maintenance hazard the Single-Primitive Rule and the distinct-algo CF were written to prevent.

### Concern 4
- **Severity:** medium
- **Concern:** **Option C (thin gateway receive → forward raw body + headers to ingestion-service over the internal contract → verify + ingest in Python) is the canon-aligned default, but it has two non-trivial obligations the plan must bind: raw-body fidelity across the hop, and the transport.** The gateway must forward the *untouched* raw byte buffer + the relevant `X-Shopify-*` headers without re-serializing (no JSON parse-and-re-emit). Transport: canon says service↔service is gRPC (sync) — but gRPC contracts are proto-defined and Stage-0 codegen (Buf) for an inbound-webhook RPC may not exist yet; the plan must either define that proto/RPC or pick a deliberate Phase-0 internal-call shape (in-process if still co-deployed as the `data` deployable, or a minimal internal HTTP forward that is NOT public). This is the one place Option C adds plumbing, and Aryan must rule it explicitly rather than hand-wave "forward to Python."
- **Rationale:** C keeps the public surface + rate-limit at the gateway (canon) and the verifier Single-Primitive in Python (canon), at the cost of one internal hop whose byte-fidelity and transport must be pinned down — otherwise it silently degrades into the raw-body-mutation footgun the other persona flagged.

### Concern 5
- **Severity:** medium
- **Concern:** **`ingest_batch` is PULL-shaped; a webhook is PUSH — the impedance mismatch must be designed, not forced.** `ingest_batch` drives `adapter.fetch(creds, window)` and pulls. A webhook delivers ONE already-received payload, with NO credential read needed (verify uses the app secret, not the per-workspace OAuth token) and NO fetch window. Forcing a webhook through the unmodified `fetch`-loop would mean a fake "single-item adapter" + a contrived window + an unnecessary custody read. The plan should reuse the *idempotent-UPSERT + Kafka-produce + correlation* core of `ingest_batch` but via a webhook-shaped entry (e.g. a `receive_webhook`-style intake that normalizes the pushed payload and calls the same UPSERT/produce internals) — NOT a forced `fetch` round-trip. The `Connector` interface already names `receive_webhook` as a first-class method (TECH §11), so this is canon-sanctioned, not a fork.
- **Rationale:** Bending the pull primitive into a push shape is how Single-Primitive reuse turns into a contrived abstraction; the canon's own `Connector.receive_webhook` is the intended seam.

---

## Recommendations

1. **Default = Option C** (thin gateway receive → forward raw body + `X-Shopify-*` headers to ingestion-service → verify + idempotent intake + produce in Python). It satisfies "public→gateway only" + the gateway rate-limit choke point AND keeps `verify_shopify_hmac` Single-Primitive in Python. Reject A (duplicate verifier / distinct-algo violation) and treat B (standalone public Python listener) as a deliberate, Founder-visible deviation, not a default.
2. Bind the **verify-then-map** ordering: HMAC verify (app-secret, no workspace) → trust shop domain → resolve workspace_id (clean reject/park on unmapped shop) → ingest under `allowed_workspace_ids`. Never touch a workspace-scoped row before verify.
3. Make Aryan **rule the internal transport + raw-body fidelity** for the gateway→Python hop explicitly (gRPC RPC w/ proto, in-process call while co-deployed, or a non-public internal HTTP forward) — and forbid any re-serialization of the body across it.
4. Reuse the **idempotent-UPSERT + Kafka-produce + correlation core**, but via a `receive_webhook`-shaped push intake (canon `Connector.receive_webhook`), not a forced `ingest_batch.fetch` window — no fake adapter, no needless per-workspace custody read.
5. Because B materially changes ingestion-service's shape/deploy if chosen, fire a **NON-BLOCKING Founder escalation** recording the A/B/C decision while Stage 2 proceeds on the C default.

---

## Skills consulted

- `architecture-patterns`
- `cost-routing-paradigms` (sql/io — zero inference on this path)
- `engineering-discipline` (Single-Primitive Rule)
- `task-tracker-integration`

---

## One line for the CTO Advisor synthesis

**Option C is the only placement that honors both canon invariants at once — public surface + rate-limit at the gateway, the lone base64/raw-body verifier Single-Primitive in Python — provided Aryan pins the internal transport + raw-body fidelity and verify runs strictly before shop→workspace mapping; A is barred (duplicate/distinct-algo verifier) and B is a Founder-visible deviation, not a default.**

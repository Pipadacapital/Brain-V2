# Dynamic Persona Review — webhook-hmac-verification-correctness-realist

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **Persona** | webhook-hmac-verification-correctness-realist (`:haiku` — bounded single-gate correctness checklist) |
| **Timestamp** | 2026-05-29T17:02:00Z |

---

## What this lens sees

A Shopify webhook HMAC check is an **authentication gate**: a wrong, skipped, or
non-constant-time comparison is a forgery/auth-bypass that lets an attacker inject
fabricated orders/refunds into the analytics + Decision Log. The reality found in code
is worse than "needs a custody home": `verify_shopify_hmac()` exists as a pure function
but **has no caller and no webhook ingress route** — so today there is nothing enforcing
it, and a custody-only slice could "wire the secret" without ever wiring the gate. The
secret-retrieval path and the verification gate are two different load-bearing things and
the requirement risks conflating them.

---

## Concerns

### Concern 1
- **Severity:** critical
- **Concern:** Fail-OPEN on missing/unretrievable secret. If the app-level secret can't be fetched (AWS error, unset env, cold boot before fetch completes), the verifier must FAIL-CLOSED (reject the webhook), never fall through to "process anyway" or "skip verification." A custody layer that throws and is caught upstream into a 200-OK is an auth bypass.
- **Rationale:** Shopify retries failed webhooks for ~48h; dropping on fail-closed is recoverable, accepting a forged event is not. The whole point of the gate is to reject unverifiable input.

### Concern 2
- **Severity:** high
- **Concern:** The webhook digest is base64 over the RAW request body; the OAuth-callback digest is hex over the sorted query string. They are NOT interchangeable. A retrieval refactor that "unifies" the secret must not accidentally unify or swap the two verification routines (C3 base64-raw-body vs C1 hex-sorted-query). The existing code already carries an H3/F-2 scar (a prior `.hexdigest()` bug that never matched a real Shopify signature).
- **Rationale:** Misapplying the OAuth-callback algorithm to webhooks (or vice-versa) silently rejects all valid traffic OR, worse, weakens the check. The two algorithms must stay distinct and both stay constant-time (`hmac.compare_digest` / `timingSafeEqual`).

### Concern 3
- **Severity:** high
- **Concern:** No verify-the-verifier kill-test. Per the 2026-05-26 durable rule, this security-load-bearing gate needs a captured kill-test proving the gate actually rejects: (a) a tampered body, (b) a missing/empty HMAC header, (c) a valid HMAC computed with the WRONG secret, AND a mutation test proving that breaking the comparison turns the test RED.
- **Rationale:** A green "HMAC verified" test that still passes when the comparison is stubbed to `return True` is the canonical false-GREEN. This exact class bounced the parent custody slice (vacuous gate test).

### Concern 4
- **Severity:** medium
- **Concern:** Per-request Secrets Manager fetch on the webhook hot path. Webhooks are high-frequency and latency-sensitive; calling Secrets Manager on every inbound webhook adds latency + cost + a new failure mode. Fetch once at boot / cache with a TTL + refresh-on-rotation, not per-request.
- **Rationale:** A 48h-retry queue backing up because each webhook does a network round-trip to AWS is an availability + cost regression; the secret changes ~never (rotation is rare).

---

## Recommendations

1. Treat the verification GATE as a named deliverable distinct from secret retrieval: the secret-retrieval seam feeds `client_secret` into the EXISTING `verify_shopify_hmac()`, which stays the single verification primitive (Single-Primitive — do not add a second HMAC routine).
2. Bind a fail-closed contract (CF): unretrievable/missing secret ⇒ reject webhook (never process); plus a captured 3-case kill-test + a mutation test that flips it RED.
3. Cache the secret at boot / TTL-refresh; never fetch per webhook. Define the rotation-refresh behavior (how the cache learns of a new secret).
4. Keep C3 (base64/raw-body) and C1 (hex/sorted-query) as separate, individually-tested routines; do not unify the algorithms.

---

## Skills consulted
- `code-review`
- `verification-before-completion`
- `architecture-patterns`

---

## One line for the CTO Advisor synthesis

**The custody slice must FAIL-CLOSED on an unretrievable secret, keep the base64-raw-body webhook HMAC distinct from the hex-sorted-query OAuth HMAC, cache the secret off the hot path, and ship a verify-the-verifier mutation kill-test on the gate.**

# CTO Advisor Review — Stage 1 (intake)

| Field | Value |
|-------|-------|
| **req_id** | `connector-webhook-intake` |
| **Stage** | 1 |
| **Timestamp** | 2026-05-29T19:00:00Z |
| **Decision** | **ADVANCE** (scoped to a Shopify-only vertical slice; seam-left for live) → Architect (Aryan), Stage 2 |

---

## Made requirements less dumb first

**Could delete:**
- Any second HMAC verifier (Node or Python) — barred; one base64/raw-body routine only.
- Any per-workspace custody read on the webhook path — verify uses the app-level singleton secret, not the per-workspace OAuth token.

**Could simplify:**
- Reuse `ingest_batch`'s UPSERT + Kafka-produce + correlation internals via a `receive_webhook`-shaped push intake — do NOT invent a fake single-item adapter + contrived fetch window to force the pull primitive.

**Could defer:**
- Multi-vendor fan-out (build the extensible seam, wire only Shopify now).
- A replay *freshness* bound (idempotent-UPSERT makes replay a recorded no-op for v1).
- Live deploy + public webhook registration + rotation of the compromised `shpss_…` (HELD-Stage-8).

---

## Lane decision

- **feature_class:** `high-stakes`
- **feature_class_rationale:** trigger surfaces ≥1 → high-stakes (auth: HMAC gate IS the auth; multi-tenancy: shop→workspace mapping; connectors; pii: Shopify order payloads carry email/first/last name; public inbound channel; india-compliance: DPDP residency of ingested PII + raw archive). Scaffolding carve-out **barred** (live auth-gate runtime + business logic + public surface). Conservative tie-break moot.
- **trigger_surfaces_touched:** `["auth","multi-tenancy","connectors","pii","outbound-channel","india-compliance","schema-proto"]` (schema-proto if Aryan defines a webhook RPC proto for the C transport)
- **Stages that will run:** 2 (Aryan) → 3 (Maya/backend) → 4 (Shreya) → 5 (Tanvi) → 6 (Rohan final + re-mutation) → 7 (Founder gate, delegated) → 8 (Jatin, HELD behind live ceremony).

## Persona-count decision

- **Count: 2** (high-stakes cap).
- **Rationale:** two distinct dominant risk dimensions intersect — (a) webhook auth-bypass + replay/idempotency correctness, (b) service-boundary/ingress placement (the A/B/C fork) + the multi-tenant mapping ordering. Both reasoning-heavy ⇒ `:sonnet`.
- **Spawned:** `webhook-auth-bypass-and-replay-realist:sonnet` (03), `service-boundary-ingress-placement-realist:sonnet` (04). Both ACCEPTED — 4+5 = 9 concerns, 2 CRITICAL, 0 looks-good.

---

## Paradigm recommendation

**Recommended paradigm:** `sql` (+ io / event-handling)

**Why:** crypto HMAC verify + idempotent DB UPSERT + Kafka produce. Zero inference, ₹0 recurring. No ML/LLM path on this surface. Intelligence-service (Maya) co-own: NO.

> Architect may refine in Stage 2 — first-pass read.

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | None directly; webhook intake feeds order facts that downstream RTO math consumes — no RTO logic here. |
| **COD** | None directly; payment/COD classification is downstream at the ACL, not at intake. |
| **GST** | None at intake; raw payload archived verbatim, per-SKU GST extraction is downstream (RegionAdapter). |
| **Festival seasonality** | Operationally relevant only at Stage-8: do NOT register/cut over the live webhook during a festival freeze. |
| **Pincode reliability** | None at intake. |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | None — inbound, read-only data intake; NO outbound channel triggered. No DLT/NCPR surface. |
| **DPDP / residency** | HIGH — ingested PII (email/first/last per `SHOPIFY_PII_MANIFEST`) lands under RLS via the declared-manifest gate; raw archive + DB stay ap-south-1 (in-region). No new PII surface beyond the declared manifest. NEVERLOG on secret + signature + raw PII bytes (Shreya VETO). |

---

## Architecture-fork ruling (A/B/C)

**Default = Option C** (thin gateway receive → forward raw body + headers → verify + idempotent intake + produce in Python). **A barred** (duplicate/distinct-algo verifier — Single-Primitive + CF-HMAC-ALGO-DISTINCT-1). **B = Founder-visible deviation** (a second public front door in a Kafka-worker service; contradicts public→gateway-only). Full reasoning + the 15-item CF contract + Stage-2 obligations in [`05-stage1-synthesis.md`](./05-stage1-synthesis.md) §3–§5.

**Multi-tenant isolation point:** verify (app-secret, no workspace) → trust shop domain → resolve shop→workspace_id → ingest under `allowed_workspace_ids`. No workspace-scoped touch before verify.

---

## Personas spawned (Stage 1)

1. **webhook-auth-bypass-and-replay-realist:sonnet** — see [`03-persona-webhook-auth-bypass-and-replay-realist.md`](./03-persona-webhook-auth-bypass-and-replay-realist.md)
2. **service-boundary-ingress-placement-realist:sonnet** — see [`04-persona-service-boundary-ingress-placement-realist.md`](./04-persona-service-boundary-ingress-placement-realist.md)

**Synthesis:** Both accepted; 2 CRITICAL (fail-open-by-ordering; map-before-verify) drove CF-WHK-VERIFY-FIRST-1 + CF-WHK-MAP-AFTER-VERIFY-1. Placement persona's reasoning produced the Option-C ruling + the §7 non-blocking escalation. Full synthesis in `05-stage1-synthesis.md` §6.

---

## Escalation

**NON-BLOCKING — FIRED** to `pending-founder-attention.md`: ratify Option C or override to B (second-front-door tradeoff). Stage 2 proceeds on C regardless. NO blocking `/escalate` (residency unambiguous, sql/₹0, no moat change, additive + Stage-8-held on irreversibles).

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-29T19:00:00Z",
  "actor": "cto-advisor",
  "type": "intake-advance",
  "req_id": "connector-webhook-intake",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "personas": ["webhook-auth-bypass-and-replay-realist:sonnet", "service-boundary-ingress-placement-realist:sonnet"],
  "architecture_ruling": "Option-C-default (gateway-receive→forward→verify+intake-in-python); A-barred; B-founder-visible-deviation",
  "escalation": "non-blocking-founder-architecture-decision (A/B/C)",
  "rationale": "Consumes approved HMAC-custody seam; Option C honors public→gateway-only + Single-Primitive verifier in Python; verify-first/map-after-verify bound; live HELD-Stage-8"
}
```

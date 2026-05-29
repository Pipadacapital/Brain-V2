# CTO Advisor Review — Stage 1 (intake)

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **Stage** | 1 |
| **Timestamp** | 2026-05-29T17:05:00Z |
| **Decision** | **ADVANCE** |

---

## Made requirements less dumb first

**Could delete:**
- Nothing in the core ask — closing a plaintext-secret posture on a security-load-bearing gate is non-deletable.

**Could simplify:**
- The "OR a dedicated environment variable" branch is an escape hatch that reopens the posture. Simplify to: Secrets Manager singleton is the default/prod path; env var is the DEV-only fallback gated by the SAME factory flag the parent shipped. One mental model, not two.
- Reuse the parent's lazy-client/residency/never-log/recovery primitives — do NOT author a parallel app-level custody class. This shrinks the slice to: one provisioned singleton key + a thin app-level reader (+cache) + feed the existing verifier.

**Could defer:**
- Building the inbound-webhook INGRESS route is a separate feature; this slice only leaves a clean retrieval seam for it. The webhook verifier function (`verify_shopify_hmac`) already exists.
- Real AWS provisioning + live-value rotation + legacy-`.env` rotation → Stage-8 console ceremony (Founder/Jatin), not this build.

---

## Lane decision

- **feature_class:** `high-stakes`
- **feature_class_rationale:** Trigger-surface scan fires on ≥1 surface → high-stakes, conservative tie-break holds. Foundational-scaffolding carve-out BARRED (this is a live-credential + auth-gate runtime, not empty scaffolding).
- **trigger_surfaces_touched:** `auth` (HMAC verification is an auth gate), `secrets/credential-custody`, `connectors` (Shopify), `india-compliance` (DPDP residency of secret+CMK). No money/PII-row/outbound-channel surface (the secret is not customer PII; webhook is inbound/read).
- **Stages that will run:** 1 (this) → 2 architect (Aryan) → 3 build (backend-developer Vikram TS + Maya Python; co-own likely) → 4 security (Shreya, VETO) → 5 QA (Tanvi, VETO) → 6 final review (Rohan, VETO) → 7 Founder gate (delegated) → 8 deploy/ceremony-held (Jatin).

---

## Persona-count decision

- **Count chosen:** 2 (the high-stakes cap).
- **Rationale:** Two distinct risk dimensions intersect — (1) webhook-HMAC verification CORRECTNESS / auth-bypass (a wrong/skipped/fail-open check is a forgery vector), and (2) app-level secret CUSTODY + residency + Single-Primitive reuse of the merged per-workspace slice. Neither subsumes the other; the classifier's "two distinct dimensions intersect" rule applies.
- **Personas spawned:**
  1. `webhook-hmac-verification-correctness-realist:haiku` — bounded single-gate correctness checklist (fail-closed, algorithm distinctness, kill-test, hot-path). See `03-persona-*.md`.
  2. `app-level-secret-custody-residency-realist:sonnet` — reasoning over retrieval-shape trade-off + residency + reuse-vs-fork of the parent custody. See `04-persona-*.md`.
- **Declined:** `ai-cost-realist` (zero inference path — paradigm sql); generic-architecture persona (that is Aryan's Stage-2 job).

**Synthesis:** see `05-stage1-synthesis.md`. Both personas ACCEPTED (4 + 5 = 9 concerns, 0 looks-good, 0 dropped). 1 CRITICAL (fail-open on unretrievable secret) + 5 HIGH + 3 MEDIUM. All fold into the bound CF contract.

---

## Paradigm recommendation

**Recommended paradigm:** `sql`  *(infra/crypto/secret-retrieval; ₹0 recurring; zero inference)*

**Why:** HMAC is deterministic crypto; secret retrieval is an AWS API + cache. No ML, no LLM, no inference of any kind. Same posture as the parent custody slice (`sql`, ₹0/mo). A reach for any LLM here would be an immediate paradigm-bypass challenge.

> Architect (Aryan) may refine in Stage 2 — first-pass read.

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | None directly. Webhook integrity protects the *correctness* of the order/refund facts that feed RTO economics — a forged webhook would poison RTO/CM2 math, so the gate indirectly protects honest economics. |
| **COD** | Same as RTO — integrity of inbound order facts. No direct COD logic. |
| **GST** | None directly; protects the integrity of line-item facts the per-SKU GST extractor consumes. |
| **Festival seasonality** | Stage-8 ceremony (live rotation) should avoid a festival-freeze window — flagged for Jatin/Founder, consistent with the parent slice's freeze discipline. |
| **Pincode reliability** | None. |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | None — inbound webhook, no outbound channel. |
| **DPDP residency** | Secret + CMK MUST be ap-south-1 (in-region-by-default). The secret itself is app credential, not customer PII, but residency consistency with the parent custody posture is bound as a CF. |

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-29T17:05:00Z",
  "actor": "cto-advisor",
  "type": "stage1-intake-decision",
  "req_id": "chore-app-hmac-secret-custody",
  "parent": "feat-credential-custody-aws-sm",
  "cf_ref": "CF-CC-SHOPIFY-HMAC-1",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "trigger_surfaces_touched": ["auth", "secrets-custody", "connectors", "india-compliance"],
  "personas": ["webhook-hmac-verification-correctness-realist:haiku", "app-level-secret-custody-residency-realist:sonnet"],
  "paradigm": "sql",
  "monthly_cost_inr": 0,
  "escalation": "none",
  "rationale": "Buildable+planable closure of a real plaintext-secret posture on an auth-load-bearing gate; reuses merged parent custody primitives; no hard-rule deviation; no cost/moat/compliance ambiguity requiring Founder."
}
```

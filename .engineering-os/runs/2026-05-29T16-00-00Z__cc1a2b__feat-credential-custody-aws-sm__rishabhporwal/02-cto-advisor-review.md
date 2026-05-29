# CTO Advisor Review — Stage 1 (intake / brainstorm)

| Field | Value |
|-------|-------|
| **req_id** | `feat-credential-custody-aws-sm` |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-29T16:00:00Z |
| **Decision** | **ADVANCE** (2 personas requested → synthesis in §`05` → Architect Stage 2) |

---

## Made requirements less dumb first

**Could delete:**
- The Option-B branch is NOT this requirement's concern. Founder chose Option A; do not "keep both backings
  live in case." `supabase_column_custody.py` stays a stub (or is later retired) — building it now is
  speculative dead code. Single-Primitive: ONE real production backing.

**Could simplify:**
- Reuse the EXISTING TS factory pattern (`custody-factory.ts`) rather than invent a new gating mechanism. The
  Python side needs the same shape: an env-driven selector that defaults to a non-AWS backing and only selects
  AWS when explicitly opted in. Mirror, don't reinvent.
- The TS `production-custody.ts` does NOT need a real AWS backing in this build — see the boundary ruling below.
  Simplify scope to the Python `ingestion-service` backing (the connector credentials are read by Python per
  the Child-3 escalation).

**Could defer (already deferred — keep deferred):**
- Real AWS provisioning, IAM role creation, live token rotation, the plaintext DELETE — all HELD for the
  Stage-8 Founder/Jatin-at-console ceremony. This build ships code + CDK + mocked-boto3 tests ONLY.
- Bulk per-workspace erasure API — document the erasure path (= `seal` across a workspace's vendors), do not
  build a new bulk API this child.

---

## Lane decision

- **feature_class:** `high-stakes`
- **feature_class_rationale:** Trigger-surface scan fires **auth/secrets** (vendor OAuth tokens + API keys at
  rest), **multi-tenancy** (secret path keyed by `workspace_id`), **pii/india-compliance** (DPDP residency for
  credentials-at-rest in ap-south-1 + KMS envelope encryption), and **connectors** (this custody is the
  connector-cutover's blocking dependency). Foundational-scaffolding carve-out is BARRED — this is real
  security-critical runtime code with live-credential blast radius, not empty structure. Conservative tie-break
  moot (clearly high-stakes from the first surface).
- **trigger_surfaces_touched:** `["auth", "multi-tenancy", "pii", "india-compliance", "connectors"]`
- **Stages that will run:** full high-stakes lane — 1 (intake, this) → 2 (Aryan, binding plan; Shreya-relevant
  IAM/residency inputs) → 3 (backend-developer, Python; CDK) → 4 (Shreya, Security VETO — IAM least-privilege +
  residency + never-log) → 5 (Tanvi, QA — mocked-boto3 tests, zero-real-AWS proof, mutation on the gate) →
  6 (Rohan, final review VETO) → 7 (Founder gate / delegated) → 8 (Jatin readiness; live provisioning HELD).

---

## Persona-count decision

- **Count chosen:** **2** (high-stakes cap).
- **Rationale (classifier rule fired):** TWO distinct risk dimensions intersect — (1) **AWS-SM / IAM
  least-privilege engineering correctness** (activation-gating that fails closed, lazy client construction,
  recovery-window semantics, mocked-vs-real boundary) and (2) **DPDP residency + custody compliance**
  (ap-south-1 secret + CMK, workspace isolation in path/IAM, erasure, the app-level Shopify HMAC line). This is
  the canonical "cost + compliance" / "engineering + compliance" two-dimension case → 2 personas.
- **Personas spawned:**
  1. `aws-secrets-least-privilege-realist:sonnet` — engineering correctness + false-GREEN/activation-gating.
  2. `dpdp-residency-custody-compliance-officer:sonnet` — residency, isolation, erasure, Shopify HMAC line.
- **Why `:sonnet` for both:** both are reasoning-heavy (recovery-window/seal semantics + mocked-vs-real boundary;
  DPDP residency + KMS + erasure trade-offs), not bounded checklists. Declined `ai-cost-realist` (zero inference
  path — pure infra/SQL paradigm) and a generic architecture persona (Aryan's Stage-2 job).

> **NOTE on the round-trip:** I am a subagent with no Agent tool. Per Stage-1 step 10, I authored the persona
> briefs and (because this is a single-session intake) the persona artifacts in-session (`03`, `04`); the
> synthesis below treats them as returned. Both surfaced ≥1 genuine concern (5 each); neither is a "looks good"
> pass.

---

## Personas spawned

1. **aws-secrets-least-privilege-realist** — see [`03-persona-aws-secrets-least-privilege-realist.md`](.)
2. **dpdp-residency-custody-compliance-officer** — see [`04-persona-dpdp-residency-custody-compliance-officer.md`](.)

**Synthesis:** see [`05-stage1-synthesis.md`](.) — full fold of all 10 concerns into the CF contract.

---

## Paradigm recommendation

**Recommended paradigm:** `sql` (infra / deterministic — ZERO LLM, ZERO ML)

**Why:** Credential custody is deterministic crypto + AWS API I/O + DB/secret persistence. There is no inference
path. Any `@paradigm small_llm/frontier_llm/ml` decorator appearing anywhere in this build at Stage 6 is a
paradigm violation → BOUNCE. (Matches the Child-3 custody module annotation `@paradigm: sql`.)

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | None directly. (Indirect: secure connector custody is a precondition to the live-cutover that powers RTO analytics — but no RTO logic here.) |
| **COD** | None directly. |
| **GST** | None. |
| **Festival seasonality** | None in code. (Process note: any LIVE rotation/provisioning in the Stage-8 ceremony must respect the festival-freeze discipline — but that is HELD, not this build.) |
| **Pincode reliability** | None. |
| **Telecom compliance** | None (no DLT/NCPR/calling-window surface). |
| **DPDP / residency** | **PRIMARY.** Credentials-at-rest must be ap-south-1 (DPDP in-region) with an ap-south-1 KMS CMK; never-log discipline is a reportable-exposure surface; workspace-erasure path must be named. See persona 2 + the CF contract. |

---

## Decision

**ADVANCE.** The requirement is sound, precisely scoped, and dependency-clean. The load-bearing decision
(Option A) is already Founder-made — my job is to scope the BUILD and bind the CF contract, not re-open it.
NOT a CHALLENGE-BACK (buildable + planable), NOT a KILL (it unblocks a FIRED escalation gate on the critical path).

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-29T16:00:00Z",
  "actor": "cto-advisor",
  "type": "stage1-intake-decision",
  "req_id": "feat-credential-custody-aws-sm",
  "parent_epic": "chore-security-governance-hardening-phase",
  "stage": 1,
  "decision": "ADVANCE",
  "lane": "high-stakes",
  "feature_class": "high-stakes",
  "paradigm": "sql",
  "persona_count": 2,
  "personas": ["aws-secrets-least-privilege-realist:sonnet", "dpdp-residency-custody-compliance-officer:sonnet"],
  "founder_decision_basis": "CF-C3-SECRETS-INTERIM-1 = Option A AWS Secrets Manager ap-south-1 (2026-05-29); do-not-relitigate",
  "unblocks": "CF-C7-CUSTODY-PROOF-1 (real seal()/get() leg) -> per-connector legacy-plaintext-DELETE PoNR",
  "escalation": "none-fired; one non-blocking Founder readiness item mirrored (real AWS account/ap-south-1/CMK existence is the Stage-8 provisioning prereq, HELD)",
  "rationale": "Make the Founder's Option-A decision real: real Python AWS-SM backing + CDK + mocked-boto3 tests, activation-gated, live provisioning/rotation/DELETE held for Stage-8 ceremony."
}
```

# 10 — CTO Final Review (Stage 6) — spike-legacy-migration-architecture

| Field | Value |
|---|---|
| **req_id** | `spike-legacy-migration-architecture` (Child 0 of epic `chore-migrate-legacy-to-brain`) |
| **Reviewer** | Rohan (cto-advisor) — Stage 6 VETO |
| **Timestamp** | 2026-05-24T01:36:40Z |
| **Inputs reviewed** | `02-cto-advisor-review.md` (my Stage-1 contract), `05-stage1-synthesis.md` (9 bound concerns), `06-architecture-plan.md` (A1–A6 deliverable), `08-security-review.md` (Shreya PASS), `09-qa-review.md` (Tanvi PASS) |
| **VERDICT** | **PASS** → Founder gate (Stage 7). Recommend `/approve` (accept this architecture as binding for the migration program + greenlight Child 1). |

---

## 0. What "PASS" means here (program-shaping, not routine)

This spike's approval is not a routine deploy gate — it is **accepting this architecture as BINDING for the entire 7-child migration program** and authorizing the filing of Child 1+. Even though the Founder has delegated routine gates to me, this is a program-shaping decision he should consciously ratify (he just ratified the epic decomposition). So I **PASS it to the Founder gate and STOP** — I do NOT self-approve Stage 8. My recommendation to him is APPROVE; the load-bearing reason and the carry-forward ledger are below.

---

## 1. Plan-binding check (delivered A1–A6 vs my Stage-1 acceptance contract)

| Contract item (02 / 05) | Delivered? | Evidence |
|---|---|---|
| **A1 Capability map — zero orphans** | YES | A1.1 (44 models + enums + index rows, all dispositioned, `SystemSettings` explicitly deprecate, `AuditLog` null-WS in A1.4), A1.2 (13 route/lib groups), A1.3 (7 connectors + replay matrix), A1.5 (Maya: 8 rollup tables column-by-column + AI surface). Tanvi confirmed zero orphans; I concur. |
| **A2 Strangler-fig sequence — demonstrably phased** | YES | A2.2 7-row DAG; A2.3 cycle proof (0→1→2→4→5→6→7 + 1→3); the C5 RLS+session gate is an explicit **column**, not prose; Child 5→Child 4 is the only hard sequential edge. Genuinely phased, not a disguised big-bang. |
| **A3 Facade / ACL — no model leakage** | YES | A3.1–A3.4: routing flag per context, 3 explicit no-leakage rules (no app-layer-only scoping, no Decimal/float money, no dual-homed token), single-writer enforcement (A3.3). |
| **A4 Per-slice parity + rollback + decommission — measurable** | YES | 7 rows, each with measurable parity (Child 2 = exact-integer-equality zero-tolerance), rollback proc, decommission criterion. |
| **A5 Dual-run / shadow-compare — numeric, money + metrics** | YES | A5.1 (6 binding rules) + A5.2 (Maya: exact-equality harness, ClickHouse shadow DDL, FX-exclusion 4 mechanics, mismatch taxonomy, AI-input shadow + cache-purge gate, ROUND_HALF_EVEN byte-identity proof + 6 vectors + TS/Py skeletons). |
| **A6 Risk register — 6 NN + leak + PII/residency + money integrity** | YES | A6.1 (6 absent NN), A6.2 (R-LEAK-01 + R-RES-01 armed tripwire + PII register, 5 models), A6.3 (R-FX-01/R-FIN-01 + connector ceremony), A6.4 (R-CRED-01/R-AUD-01). |
| **9 persona concerns C1–C9 bound onto the artifacts** | **9/9** | Cross-checked the synthesis binding table vs the plan + both reviews' traceability matrices. Each lands in a concrete, falsifiable rule. 0 hand-waved (Shreya: 0/9; Tanvi: 9/9 located). |
| **No-prod-code guardrail** | HELD | Independently re-verified (§4). |

**Inputs delivered: 6/6 artifacts. Persona concerns: 9/9. Plan-binding: OK.**

The two CRITICALs (C1 single-token connectors, C5 no-RLS isolation) are bound with the strongest mechanics in the plan — a facade-enforced hard gate rendered as a table column (C5) and an explicit single-owner-cutover-not-shadow rule (C1). This is exactly the acceptance bar I set at Stage 1.

---

## 2. Over-engineering / scope-discipline audit (MANDATORY)

The spike's job is to make later slices planable — not to gold-plate or invent product code. Walked requirement → contract → deliverable → reports:

- **Files beyond the plan?** No. The deliverable is exactly the A1–A6 contract + the wrapping arch-plan sections (§1–§17). Nothing invented beyond the contract. PASS.
- **Speculative abstractions ("future use")?** No. The facade/ACL is the minimum a reversible strangler-fig requires; no speculative layers. Single-Primitive Rule respected. PASS.
- **Premature implementation?** No — and this is the load-bearing discipline for a spike. All DDL / connector code / metric defs / AI roster / frontend rewrite are **explicitly DEFERRED** to Children 1–6 (Tanvi's §6 deferral table: 7/7 explicit, zero silent omissions). New-layer decisions (Zustand→Redux Toolkit, axios→tRPC) are **recorded with rationale**, bound in Child 6 — not built. PASS.
- **Observability beyond requirement?** No — only parity reports + gate-state flags (§14). PASS.
- **Dependencies added?** None (design-only). PASS.
- **Length proportionate to risk?** A ~46k-token prescriptive doc binding a 7-child program over 48 models + 7 connectors + 204 components is proportionate for a high-stakes architecture spike, not bloat. The detail IS the deliverable (it removes re-derivation cost from every child). PASS.
- **30+ line WHAT-not-WHY comments?** The code skeletons (TS/Py `roundHalfEven`, ClickHouse DDL, cache-purge) are *contract specifications* the children implement against, not shipped code with bloated comments. Appropriate. PASS.

**Over-engineering audit: CLEAN.** No finding. The plan resisted the strongest temptation a deep-audit spike has — to start designing the implementations — and held the map/bind/defer line correctly.

---

## 3. Phased-not-big-bang re-confirmation (the spike's core risk)

I independently re-read the A2.3 DAG proof against the dependency edges and the `state.active.json` `proposed_children.blocks` arrays. The sequence is a genuine DAG with no backward edge:
- Child 3 (connectors) is correctly named as the **single slice most likely to force a big-bang** (single-owner webhook tokens can't be dual-homed) and is explicitly carved out as a **single-owner cutover, not a shadow**, with the per-connector ceremony + rollback tree as the reversibility mechanism — reversible *per connector*, not all-or-nothing. This is the honest answer; it does not pretend a token can be dual-homed.
- The C5 gate (RLS+session GREEN before any shadow) being a *facade-enforced column* on every child is what keeps each slice's dual-run from re-opening the leak window. Sound.
- The state.json `blocks` (filing prerequisites) vs A2 entry-criteria (runtime gates) nuance Tanvi flagged is a real two-layer distinction, not a contradiction — confirmed.

This is a phased, per-slice-reversible migration, not a big-bang wearing a phased label. Confirmed.

---

## 4. Independent gate re-run (MANDATORY — ≥3 of Stage-5 gates, captured output)

I do not take a PASS on faith. For a no-code spike, the verifiable gates are the guardrail, the secrets scan, and the load-bearing ground-truth the whole architecture rests on. I re-ran 5, with captured output:

| # | Gate | My independent result | Matches Tanvi/Shreya? |
|---|---|---|---|
| 1 | **No-prod-code guardrail** (`git status --short`) | Every modified/untracked path under `.engineering-os/**`; zero `legacy project/**`, zero `apps/`/`backend/`/`services/`/`packages/`/`pylibs/`/`protos/`. | YES — guardrail HELD |
| 2 | **Secrets grep on staged diff** | Empty (no staged product code; diff is `.engineering-os/**` bookkeeping). Zero matches. | YES |
| 3 | **No-RLS ground truth** (`grep ENABLE ROW LEVEL SECURITY\|CREATE POLICY\|FORCE ROW` in `legacy project`) | **0 policies** — the central premise of the RLS-first sequence is real. | YES (Shreya CONFIRMED) |
| 4 | **Cron cross-workspace fan-out** (`cron.ts`) | `cron.ts:65` and `:148` both `shopifyConnection.findMany(...)` — the C5 co-mingling surface, at the exact cited lines. | YES (Shreya CONFIRMED) |
| 5 | **Plaintext creds** (schema lines) | Confirmed at cited lines: `Shiprocket.password:498`, `shiprocketApiPassword:500`, `Klaviyo.apiKey:559`, `Woo.consumerSecret:1014`, `Shopify.accessToken:286`/`clientSecret:293`, `google.refresh_token:699`, `meta.access_token:763` — all bare `String`. | YES (Shreya CONFIRMED) |

**I replicated every gate's PASS with my own captured output.** The two reviews are grounded in the real codebase, not a strawman — which is the precondition for trusting the rest of the design. No Stage-4/5 quality issue. No bounce.

---

## 5. Residency tripwire — gate-zero correctness (MANDATORY check)

- **Recorded correctly as gate-zero:** A2.0 states the region must be confirmed "before A2 can be treated as finalized-and-executable" and sequences a Step-0 residency migration ahead of Child 1. Shreya's independent sharpening — "confirm region BEFORE Child-1 RLS DDL touches the DB (gate-zero)" — is the right ordering and I adopt it as the binding phrasing.
- **Status:** ARMED-unconfirmed. Region is genuinely undeterminable from the repo — I re-verified 0 region markers in config/docs; `DATABASE_URL`/`DIRECT_URL` live in uncommitted `backend/.env`. This is exactly why it is a tripwire on a *fact* the spike cannot read from code, not an `/escalate`-now on a *canon ambiguity*. Both Shreya and I (Stage 1) reached this independently. Correct call.
- **Founder heads-up accuracy:** the `pending-founder-attention.md` line is accurate — it asks for nothing now and pre-frames the conditional escalation (if region ≠ ap-south-1 → immediate `/escalate` + freeze A2 + pre-Child-1 residency migration). No change needed; I am sharpening it to gate-zero in the carry-forward ledger.

---

## 6. Hard-rule deviation check (MANDATORY)

Scanned all artifacts for: dependency violation · Single-Primitive Rule violation · compliance gap (business canon) · paradigm escalation beyond plan · gate-skip without codified exception.
- Dependency violation: none (Child 0 `blocks: []`; pre-flight clean).
- Single-Primitive Rule: respected (no speculative abstraction; facade is the minimum).
- Compliance gap: none baked into the plan (Shreya: 0 compliance violations; DPDP/residency/PII handled without a violation; the one *open* compliance item — MED-3 migration-time lawful basis — is correctly carried forward to Child 1/3, with an `/escalate` flag if it proves ambiguous at child-time, not a gap in *this* spike).
- Paradigm escalation: none — the program targets *reducing* LLM over-use (~80% of the legacy AI surface is deterministic SQL/ML, mapped as `@paradigm: sql`); Child 5 binds the cost model.
- Gate-skip: the code-specific gates (mutation tests, real-network smoke, Stage-8 runtime deploy) are degraded to design-only analogues via a **codified exception I set at Stage 1** (`gate_applicability_no_code_spike`), not a silent skip.

**No hard-rule deviation. Auto-approve eligibility is therefore not blocked on this axis — but I am still NOT self-approving, because §0: this approval is program-shaping and belongs to the Founder.**

---

## 7. The carry-forward ledger (THE load-bearing output of this Stage 6)

For an architecture spike, the most important Stage-6 deliverable is consolidating every non-blocking finding into **binding constraints the future children inherit** — so nothing is lost when those children are filed. The following are BINDING on the named child requirements. Each child's Stage-1 (my intake) and Stage-4 (Shreya) MUST pick these up; missing one is a Stage-4 VETO at that child.

### 7.1 — Security findings (Shreya, 08) → binding child constraints

| ID | Constraint | Severity | Binds child(ren) | VETO surface |
|---|---|---|---|---|
| **CF-SEC-1** (MED-1) | Facade RLS+session gate must be a **fail-closed, auditable predicate**: GREEN derived from a live RLS-verification probe + cron-session-scope assertion (NOT a manually-toggled boolean); RED-by-default on unknown state; flip events written to the immutable Decision Log. | MED | **Child 1** | Stage-4 VETO @ Child 1 |
| **CF-SEC-2** (MED-2) | Shadow-compare read path must read from a **physically-separate** read replica or PITR snapshot AND the analytics-service read connection must be **RLS-session-scoped per workspace** (a read-only role alone does NOT prevent a cross-workspace `findMany` without RLS context). The G1+G2 gate applies to the analytics read connection, not only write paths. | MED | **Child 2, Child 4** | Stage-4 VETO @ Child 2/4 |
| **CF-SEC-3** (MED-3) | Establish the **lawful basis for migration-time PII processing** (DPDP §4) — migrating existing legacy PII into the new architecture is itself §4 processing, before any new consent primitive exists. Likely DPDP §7 legitimate-use / existing-consent continuity; document whether fresh notice/consent is required at cutover. **If genuinely ambiguous at child-time → `/escalate` to Founder** (do not decide it silently). | MED | **Child 1, Child 3** | Stage-4 VETO @ Child 1/3; `/escalate` candidate |
| **CF-SEC-4** (LOW-1) | `oauth_states` (schema:843, A1.1 #44) "reuse" must be confirmed **short-TTL + single-use + tamper-evident** at connector cutover (OAuth-flow injection surface). | LOW | **Child 3** | Stage-4 @ Child 3 |
| **CF-SEC-5** (LOW-2) | **Correlation-ID 4-tuple** (`request_id` + `trace_id` + `workspace_id` + `user_id`) MUST propagate end-to-end through: the facade, every per-workspace-session cron invocation, every connector ingest event, every shadow-compare job, every Decision-Log / AI write. Missing-traceability is a **Stage-4 VETO at every child** that ships runtime. | LOW | **Children 1–7 (every runtime child)** | Stage-4 VETO @ each child |

### 7.2 — QA finding (Tanvi, 09) → binding child constraint

| ID | Constraint | Severity | Binds child | VETO surface |
|---|---|---|---|---|
| **CF-QA-1** (NB-1) | The TS `roundHalfEven` must NOT use intermediate float arithmetic (`n - floored`) — for large money values IEEE-754 error can shift the `.5` test, breaking TS↔Python byte-identity. **Child 2 must implement TS rounding at Decimal precision** (BigDecimal-equivalent, or operate on scaled integers from the start). The 6 CI test vectors are necessary but not sufficient; the implementation must be precision-safe by construction. (The Python side is already protected via `Decimal(str(value))`.) | LOW | **Child 2** | Stage-5 @ Child 2 (parity gate) |

### 7.3 — Maya's two child pre-conditions (A1.5 / state `maya_plan_amendment_notes`) → binding child constraints

| ID | Constraint | Binds child | Note |
|---|---|---|---|
| **CF-MAYA-1** | The **Definitional-Delta Register** is an explicit Child-4 deliverable — one row per (metric, source) where `legacy_formula != brain_formula` (e.g., the P&L lagged-shipping CM2 vs `compute-daily.ts` actual-cost CM2). Each row reviewed + signed off by me (Rohan) before Child-4 cutover. Money-exact-equality is *insufficient* where the CM2 **definition** itself changes; the register is how that delta is classified `EXPECTED_DEFINITIONAL_DELTA` rather than `BLOCKING_BUG`. | **Child 4** | Pairs with A5.2 M-A5-4 triage taxonomy. |
| **CF-MAYA-2** | **`WorkspaceCost` currency-at-entry migration is a Child-2 pre-condition**: workspace costs must be stored in the workspace primary currency post-migration (date-stamped historical rate at entry), NOT relying on the hardcoded `EXCHANGE_RATES` FX conversion at compute time. The `WorkspaceCost.currency @default("USD")` mismatch (schema:256) is the contamination source. | **Child 2** | Pairs with R-FX-01 + A5.2 M-A5-3. |

### 7.4 — Residency tripwire (sharpened to gate-zero) → binding on Child 1

| ID | Constraint | Binds child | Note |
|---|---|---|---|
| **CF-RES-1** | **GATE-ZERO:** confirm the live Postgres/Supabase region **BEFORE Child-1 RLS DDL touches the database.** If `ap-south-1` → record in R-RES-01, proceed. If **≠ ap-south-1** → immediate `/escalate` to Founder + FREEZE A2 + insert a pre-Child-1 data-residency-migration (Step 0) before any PII crosses into Brain. This is a non-negotiable ordering; it cannot slip to mid-Child-1. | **Child 1 (gate-zero)** | Armed tripwire R-RES-01 / A2.0; Shreya + Rohan concur. |

### 7.5 — Carry-forward summary

**11 binding constraints** consolidated: 5 security (1 cross-cutting on all runtime children), 1 QA, 2 Maya pre-conditions, 1 residency gate-zero, plus the 9 concern-bindings C1–C9 already embedded in A1–A6 (those are *in* the architecture; the 11 here are the *additional* hardening/pre-conditions the children inherit). When I run Stage-1 intake on each child, I will pull the relevant rows from this ledger into that child's acceptance contract. None may drift.

---

## 8. Recommended Child 1 (what `/approve` greenlights next)

**Child 1 = `child-1-tenancy-auth-rls-hardening`** (`blocks: [child-0]` — unblocked the instant this spike is approved). It:
1. Executes **CF-RES-1 gate-zero first** (confirm region before any DDL).
2. Establishes the universal hard gate: Postgres **RLS live + verified on ALL workspace-scoped tables** (G1) + **cron fan-out converted to per-workspace-session-scoped invocations** (G2) — the C5 entry gate every later slice depends on.
3. Carries CF-SEC-1 (fail-closed auditable gate predicate), CF-SEC-3 (migration-time lawful-basis), and the `Invitation.email` PII crossing (A6.2).
4. Parity bar (A4 Child 1): live API responses byte-identical pre/post RLS on a fixed corpus per workspace; cross-workspace query returns 0 rows under each workspace session; no cross-workspace `findMany` in cron. Fully reversible (RLS is additive).

It is correctly the root: it opens nothing it cannot close, and it arms the gate that protects every subsequent dual-run.

---

## 9. Decision

**PASS → Founder gate (Stage 7).** No bounce. The deliverable matches my Stage-1 contract (6/6 artifacts, 9/9 concerns), is phased-not-big-bang, holds the no-prod-code guardrail, passes the over-engineering audit clean, and both parallel reviews are grounded in re-verified ground truth. The non-blocking findings are consolidated into the 11-row carry-forward ledger so nothing is lost.

**Recommendation to Founder:** `/approve spike-legacy-migration-architecture` — which means (a) accept this architecture as **binding for the whole migration program**, and (b) greenlight filing **Child 1 (tenancy/auth/RLS hardening)** with the carry-forward ledger attached. Or `/reject <reason>` if you want the architecture reshaped before the program proceeds.

I am **NOT** self-approving Stage 8 — this is program-shaping and belongs to your conscious ratification, exactly as the epic decomposition did.

---

## Stage 6 DoD

- [x] All artifacts read; original requirement re-read (drift check — none)
- [x] Plan-binding check: 6/6 artifacts delivered, 9/9 concerns bound
- [x] Over-engineering audit: CLEAN (no finding)
- [x] Phased-not-big-bang re-confirmed (DAG, single-owner-cutover carve-out)
- [x] ≥3 Stage-5 gates independently re-run with captured output (5 run; all match)
- [x] Residency tripwire confirmed as gate-zero; Founder heads-up accurate
- [x] Hard-rule deviation check: none
- [x] Carry-forward ledger consolidated (11 binding child constraints) — the load-bearing output
- [x] Recommended Child 1 named
- [x] Verdict: PASS → Founder gate (no self-approve; program-shaping)
- [x] state/active.json updated (.bak first); journal + decision-log + live.log appended

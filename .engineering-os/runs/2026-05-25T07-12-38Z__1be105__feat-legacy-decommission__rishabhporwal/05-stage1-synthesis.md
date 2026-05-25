# Stage 1 — Persona Synthesis — `feat-legacy-decommission` (Child 7, FINAL)

> Rohan (cto-advisor). Synthesis pass: read `02-cto-advisor-review.md` (shape ruling + 5 intake rulings) + `03-persona-dpdp-decommission-safety-realist.md`. The persona returned 5 grounded concerns. This folds them into the binding CF-C7-* contract, rules the C7-D-001 escalation, confirms the order/PoNR/dwell/DDR/festival gates, and finalizes the Stage-1 decision.

| Field | Value |
|-------|-------|
| **req_id** | `feat-legacy-decommission` |
| **Stage** | 1 (intake — synthesis) |
| **Timestamp** | 2026-05-25T08:15:00Z |
| **Decision** | **ADVANCE** → Stage 2 (Aryan: decommission runbook + PoNR ledger + final-state checklist + DPDP close-out) |
| **Personas synthesized** | 1 / 1 (`dpdp-decommission-safety-realist:sonnet`) |
| **Persona quality gate** | **PASS** — 5 grounded concerns (3 HIGH + 2 MED), each cites a specific artifact (Child-3 `seal()` stub, arch A4, DDR rows 8/9, `WorkspaceFestival`); NOT a "runbook looks complete" pass. Accepted. |

---

## 1. Persona quality gate — verified PASS

The persona was required (intake §"Why this persona must surface ≥1 grounded concern") to adversarially attack four things. It did, and went beyond:

| Required attack | Persona delivered? | Evidence cited |
|---|---|---|
| PoNR crossed before dependency parity signed | YES — C7-D-004 (Gate P1 vs P2), C7-D-003 (serve/read coupling) | DDR rows 8/9 unsigned; arch A4 rollback validity window |
| "Brain custody proven" strong enough per plaintext-delete (Shiprocket no-replay) | YES — C7-D-001, the headline | Child-3 `11-final-review.md`: `seal()`/`get()`/`put()` = `NotImplementedError`; Option A/B unresolved |
| Archive erasure-scopable post-shutdown | YES — C7-D-002 | DPDP §12/§13; flat pg_dump not per-principal scopable |
| AI serve-flip rollback outrunning metric read-flip | YES — C7-D-003 | arch A4: "re-enable legacy AI read path only valid while Child-4 legacy-reads not decommissioned" |
| (bonus) festival window as a machine gate | YES — C7-D-005 | advisory prose → `WorkspaceFestival` calendar query |

This is a genuine adversarial pass. **All 5 accepted.** None rejected, none downgraded.

**Cross-check against my own 5 intake rulings:** the persona did not contradict any of my fixed rulings — it *sharpened* three of them and surfaced two net-new gates I did not name at intake:
- Ruling (b) [irreversible/custody] → C7-D-001 sharpens it from "custody proven (authenticated call + parity + sealed)" to "the seal() *production path* is implemented + is the call path, not a direct-DB-read that passes a live-auth-test." **This is a real gap I underspecified.** My intake said "secret sealed in Brain secrets manager" — but I did not check that the seal mechanism *exists in code*. The persona did, and it does not (it's a stub).
- Ruling (c) [DPDP archival] → C7-D-002 sharpens "erasure-scopable" into "name the physical archive format; a flat pg_dump fails §12." Confirmed against the data-privacy-dpdp skill: the canon erasure mechanism is PG-tombstone + plaintext-hard-delete → CH `ALTER…DELETE WHERE workspace_id=? AND customer_id=?` → S3 purge → consent `withdrawn`, audit entry retained. **A flat `.sql` dump supports none of that** — you cannot run a scoped DELETE against a dump without a full restore. The persona is canon-correct.
- Ruling (d) [DDR rows] → C7-D-004 sharpens it into TWO named gates (P1 legacy-sourced / P2 Brain-sourced) so the first GREEN can't license the PoNR.
- **Net-new:** C7-D-003 (the serve↔read dwell coupling) and C7-D-005 (festival as a machine gate) — I named the serve/read ordering hazard at intake (§a hold #4) but did NOT require a *dwell period*; and I named festival timing under India-context but as advisory. The persona converts both from prose to enforceable gates. Accepted as additive.

---

## 2. The binding CF-C7-* constraint table (folded, with owners + severities)

These bind Aryan's Stage-2 runbook. Owners: **Aryan** = runbook author (PoNR ledger / order / dwell gates / DDR P1-P2 gates / festival query design). **Founder** = the Option A/B custody *implementation* (real `seal()`). **Jatin** = Stage-8 execution against the runbook.

| CF | Source | Severity | What it binds in the runbook | Owner |
|---|---|---|---|---|
| **CF-C7-CUSTODY-PROOF-1** | C7-D-001 | **HIGH** | Per-connector plaintext-delete PoNR is NOT crossable until ALL of: (1) Founder Option A or B on record AND the corresponding `seal()`/`get()` path is confirmed **non-`NotImplementedError`** (real impl replaced the stub — not "the config swap was made"); (2) a Brain connector call via the **production custody path** (not a direct legacy-DB column read) returns vendor HTTP 200; (3) parity GREEN within the connector's rollback window. All three signed in the per-connector PoNR checklist before `DELETE`. Shiprocket last (no replay = max exposure). | **Aryan** writes the gate; **Founder** must implement the real `seal()` (see §3 escalation ruling) |
| **CF-C7-DPDP-ERASURE-1** | C7-D-002 | **HIGH** | Runbook MUST name the physical archive format + its §12 erasure-query mechanism BEFORE naming DB shutdown as a PoNR. The chosen format must satisfy §12 by EITHER (a) DB stays **live-but-read-only** in ap-south-1 until the retention window expires, then wholesale-deleted (erasure = scoped `DELETE` while live), OR (b) a per-workspace-partitioned erasure-capable format (e.g. S3 Parquet partitioned by `workspace_id`, erasure = `DeleteObject` on the partition). Name retention basis + period + the decommission trigger ("retention expired + no pending §12 requests"). **"Archive" and "decommission" are TWO dates** — Jatin must understand the shutdown of the *app* ≠ the deletion of the *archive*. **A flat pg_dump is NOT §12-compliant** (cannot run a scoped DELETE without full restore). **This is the armed `/escalate` tripwire** — see §3. | **Aryan** (names the format; if he cannot name a §12-satisfying one → tripwire FIRES at Stage 2) |
| **CF-C7-SERVE-READ-COUPLING-1** | C7-D-003 | **HIGH** | A **minimum 24h dwell period** of stable Brain AI serving (zero user-visible error escalation) between the HOLD-AT-SERVE flip and the HOLD-AT-READ-FLIP `legacy-reads-decommissioned` transition. The `legacy-reads-decommissioned` PoNR is NOT runbook-executable until the HOLD-AT-SERVE *sustained-stability* gate is explicitly signed (not "AI is serving" — proven stable over the dwell). The runbook's HOLD-AT-SERVE rollback row must record the coupling explicitly: while at `legacy-reads-fallback`, rollback = re-enable legacy reads + re-enable legacy AI path; once `legacy-reads-decommissioned`, that rollback is GONE. Prevents an operator advancing both holds in one console session and silently destroying the AI rollback tree. | **Aryan** |
| **CF-C7-DDR-GATE-1** | C7-D-004 | **MED** | The runbook names TWO distinct parity gates on HOLD-AT-READ-FLIP: **Gate P1** (legacy-sourced shadow-compare GREEN) → licenses ONLY the reversible `Brain-writes/legacy-reads-fallback` transition. **Gate P2** (a SECOND parity run on **Brain-Child-3-sourced** data, AFTER Shopify connector cutover AND after DDR rows `total_tax_mu`+`fx_restatement` are signed by Rohan) → the ONLY gate that licenses the `legacy-reads-decommissioned` PoNR. The PoNR ledger row for the read-flip references **P2**, not P1. Stops "first GREEN = cutover license," the most common migration cutover error. | **Aryan** (gate naming); **Rohan** (signs the 2 DDR rows between P1 and P2) |
| **CF-C7-FESTIVAL-WINDOW-1** | C7-D-005 | **MED** | The festival constraint is a **machine-checkable Stage-8 pre-flight gate**, not advisory prose: no irreversible hold-flip (HOLD-AT-CUTOVER Shiprocket, the `legacy-reads-decommissioned` transition, the DB shutdown) executes within **14 days before / 7 days after** any festival in `workspace_festivals` for any active workspace. Mechanism: `SELECT name, festival_date FROM workspace_festivals WHERE festival_date BETWEEN NOW() AND NOW() + INTERVAL '14 days'` before each irreversible step; the per-hold PoNR row carries this as a named precondition. Shiprocket gets an explicit pre-cutover calendar blackout (72h window × COD-4x-during-Diwali = max blast radius). | **Aryan** (designs the query gate); **Founder/Jatin** own the calendar at Stage 8 |

**Carried-forward (from intake, unchanged):** `CF-BN-NOLEGACY-1`, `CF-RES-1` (archive stays ap-south-1; out-of-region = DPDP §16), single-owner C8, single-writer C2 final state, the full DDR sign-off (Rohan), `AuditLog` null-rows → system-workspace-sentinel (R-AUD-01) carried into the archive so system events stay attributable post-retirement.

---

## 3. The escalation ruling — C7-D-001 (custody) + C7-D-002 (archive format)

### C7-D-001 — the custody `seal()` stub. **RULING: FIRE NOW — but as a NARROW build-gating prerequisite addendum to the already-fired Child-3 escalation, NOT a new mid-pipeline /escalate.**

This is the load-bearing decision of the synthesis, so I reason it explicitly.

**The new fact since intake.** At intake I wrote ruling (b): "custody proven = authenticated Brain call + parity-in-window + secret sealed in Brain secrets manager." I treated "sealed" as a state to verify. The persona checked the *code* (Child-3 `11-final-review.md`) and found the seal mechanism is a `NotImplementedError` stub in BOTH backings (`aws_secrets_manager_custody.py`, `supabase_column_custody.py`), and Child-3's own final review deferred the Option A/B decision to the Stage-8 ceremony **as "a config swap."** It is not a config swap — you cannot config-swap between two stubs that both raise `NotImplementedError`. **There is no production seal() path to prove custody against.** A live-auth-test (Child-3 Stage-8 STEP 2) can pass by reading the credential *directly from the legacy Postgres column*, bypassing Brain custody entirely — and then the plaintext gets deleted on the strength of a test that never exercised Brain's custody. For Shiprocket (no historical replay), that is the single highest-irreversibility step in the entire 7-child program: a dead connector with no recovery path.

**Is this a NEW escalation, or part of the one already fired?** The top of `pending-founder-attention.md` already carries a **FIRED** Child-3 escalation (2026-05-24T20:30:00Z) asking the Founder to choose Option A (provision AWS Secrets Manager + rotate) or Option B (interim Supabase-column custody, Sugandh-Lok-only). That fired escalation asked the Founder to **DECIDE** A or B. **It did NOT ask the Founder to IMPLEMENT a real `seal()`.** The persona's contribution is precisely this delta: *deciding* A/B is necessary but not sufficient — for the irreversible plaintext-delete, the chosen option's `seal()` must be **implemented and confirmed non-stub** before the delete is crossable, because Shiprocket has no replay and the delete is forever.

**Ruling — I FIRE it now as an addendum, Child-3-style, because it meets the rubric:** it is an *irreversible/high-blast-radius* decision (plaintext-delete on unproven custody = dead connector, no rollback) AND it requires a Founder-owned instrument that does not exist (a real custody implementation, not just a decision). I do not open a *separate* `/escalate` thread — I sharpen the already-fired Child-3 custody escalation with the build-gating prerequisite the decommission runbook depends on, so the Founder sees ONE coherent custody ask, not two. Why now and not "carry silently to Stage-8": the autonomous-run directive is "run the pipeline, Founder checks at the end" — exactly the case where a silent dependency on a non-existent instrument is most dangerous, because the runbook would otherwise write "verify custody, then delete" as if a custody path exists. Firing now means the Founder can implement the real `seal()` in parallel with Aryan's Stage-2 runbook (no live data, no creds touched). It does NOT block Aryan: the runbook is *written* assuming the gate; it is the *execution* (Stage-8 Shiprocket delete) that is hard-gated.

**Exact Founder ask (addendum to the fired Child-3 custody escalation):**

> Your Child-3 Option A/B custody decision is necessary but, for the legacy plaintext-credential DELETE in the decommission runbook, not sufficient. Before the Stage-8 Shiprocket (and each connector's) plaintext-delete may be executed, the **chosen option's `seal()` / `get()` path must be IMPLEMENTED and confirmed non-`NotImplementedError`** — i.e. a real custody implementation, not just the decision and not a config swap between two stubs. Concretely, please confirm ONE of:
> - **(A)** AWS Secrets Manager (ap-south-1) is provisioned and `aws_secrets_manager_custody.{put,get,seal}` are real implementations; OR
> - **(B)** the Supabase-column custody path (`supabase_column_custody.{put,get,seal}`) is a real encrypt-in-place implementation (Sugandh-Lok-only, ap-south-1 AES-256 at-rest confirmed).
>
> The decommission runbook will write the per-connector plaintext-delete PoNR with this as a hard, signed precondition (CF-C7-CUSTODY-PROOF-1): real `seal()` confirmed + a Brain connector call **via the production custody path** (not a direct legacy-DB-column read) returns vendor 200 + parity GREEN — THEN delete, Shiprocket last. No decision is needed to *write* the runbook; this gate must be satisfied before the Stage-8 delete is *executed*.

**Status:** FIRED (mirrored to `pending-founder-attention.md` as an addendum to the open Child-3 custody escalation). **Effect:** Stage 2 PROCEEDS; the Stage-8 plaintext-delete is `build_gated_on` = CF-C7-CUSTODY-PROOF-1 (real `seal()` confirmed).

### C7-D-002 — archive format. **RULING: ARMED tripwire stays armed; it FIRES at Stage 2 if Aryan cannot name a §12-satisfying archive format/mechanism.**

This is exactly the armed-not-fired condition I logged at intake — the persona made it concrete. I do NOT fire it now: naming a §12-satisfying archive format is a *design act Aryan can perform at Stage 2* (the canon offers at least two satisfying shapes — live-read-only-until-retention-expiry, or per-workspace-partitioned S3 — per the data-privacy-dpdp erasure mechanism). It becomes a genuine retention-vs-erasure compliance ambiguity (a Founder `/escalate`) ONLY if Aryan reaches Stage 2 and finds **no** §12-satisfying format is achievable without re-architecting the archive. **Disposition: ARMED; the tripwire fires at Stage 2 if and only if CF-C7-DPDP-ERASURE-1 cannot be satisfied in the runbook.** Logged to `pending-founder-attention.md`.

### C7-D-003 / C7-D-004 / C7-D-005 — **no escalation.** All three resolve inside Aryan's runbook (dwell gate / P1-P2 gate naming / festival query). Confirmed against the persona's own dispositions (it marked all three "NO" for escalation).

---

## 4. Confirmed: shape, order, PoNR ledger, and the new dwell/DDR/festival gates

**Shape — CONFIRMED runbook-only (design child, Child-0 analogue).** No app code build; deliverable = decommission runbook + PoNR ledger + final-state verification checklist + DPDP close-out. Stages: 1 → 2 (Aryan) → 6 (Rohan: compliance + reversibility IS the gate, my VETO). No Stage-3/4/5 code build; Shreya = design-level VETO on the irreversibility/PoNR/credential-destruction design; Tanvi = artifact-completeness + internal-consistency. EXECUTION is Stage-8 / Founder-at-console. **Paradigm: sql/runbook — CONFIRMED.** Zero inference path, zero new runtime; any `@paradigm` LLM decorator or new compute = paradigm violation → BOUNCE. This child DEFENDS the cost model (confirms retirement of the legacy direct-Anthropic-SDK + Ollama serving path).

**The DAG-forced order — CONFIRMED (unchanged from intake §a), now annotated with the folded gates:**

```
HOLD-AT-FORCE (Child-1 RLS)
   pre-req: Child-3 residual-writer conversion + COMPLETE bare-write grep GREEN + FK-scope EXPLAIN
   reversible: NO FORCE → DISABLE → DROP POLICY (down.sql).   NOT a PoNR.
        ↓
HOLD-AT-CUTOVER (Child-3 connectors, per-connector, Shiprocket LAST — no replay)
   PoNR = legacy plaintext-credential DELETE (C8).
   gate: CF-C7-CUSTODY-PROOF-1 — real seal() confirmed + prod-custody-path 200 + parity GREEN, signed, before DELETE.
        ↓
HOLD-AT-READ-FLIP (Child-4 metrics)
   states: legacy-writes/Brain-reads-shadow → Brain-writes/legacy-reads-fallback → legacy-reads-decommissioned
   Gate P1 (legacy-sourced parity GREEN)  → licenses ...fallback (reversible).
   Gate P2 (Brain-Child-3-sourced parity GREEN + Rohan signs DDR total_tax_mu + fx_restatement) → licenses legacy-reads-decommissioned.
   PoNR = legacy-reads-decommissioned (references Gate P2, NOT P1).   [CF-C7-DDR-GATE-1]
        ↓
HOLD-AT-SERVE (Child-5 AI)
   CACHE-PURGE-C4C5 fires (post-purge stale-narration count must = 0) + per-agent graduation.
   reversible: re-enable legacy AI read path — VALID ONLY while Child-4 not yet legacy-reads-decommissioned.
   *** CF-C7-SERVE-READ-COUPLING-1: min 24h dwell of stable Brain serving BEFORE crossing the read-flip PoNR; ***
   *** the legacy-reads-decommissioned transition is NOT executable until the HOLD-AT-SERVE sustained-stability gate is signed. ***
        ↓
HOLD-AT-ROUTE-FLIP (Child-6 frontend, per-route-group)
   production JWT-verify + membership lookup replaces dev-only header-trust.
   reversible per-route-group (re-point facade to legacy) per Child-0 A4.
        ↓
LEGACY DB SHUTDOWN + ARCHIVE  → PROGRAM-LEVEL TERMINAL PoNR
   gate: 100%-decommissioned everywhere + archive verified restorable + CF-C7-DPDP-ERASURE-1 (named §12-satisfying format) + Founder authorization at console.
   NOTE: "archive" (app shutdown) and "decommission" (archive deletion at retention-expiry) are TWO dates.
ALL irreversible flips also gated by CF-C7-FESTIVAL-WINDOW-1 (workspace_festivals 14d-before/7d-after machine check).
```

**Per-hold PoNR ledger row schema (Aryan binds):** `{hold, pre-req gate (ref to the child's own gate), reversibility action, the explicit PoNR line, what is destroyed/irreversible past it, festival-window check, custody/dwell/P2 gate (where applicable)}`. **The PoNR ledger is THE load-bearing artifact.** Invariant: **no PoNR is crossed before its dependency's parity is signed AND its named gate (custody / P2 / dwell / festival) is GREEN.**

---

## 5. Persona accept/reject summary

| ID | Concern (one line) | Severity | Disposition | Folded into |
|----|---|---|---|---|
| C7-D-001 | `seal()` stub → custody unverifiable before Shiprocket plaintext delete (highest irreversibility) | HIGH | **ACCEPT** | CF-C7-CUSTODY-PROOF-1 + **FIRED** escalation addendum (§3) |
| C7-D-002 | Archive format undefined → flat pg_dump not §12 erasure-scopable | HIGH | **ACCEPT** | CF-C7-DPDP-ERASURE-1 + **ARMED** tripwire (fires at Stage 2 if no §12 format) |
| C7-D-003 | No dwell between serve-flip and read-decommission PoNR → AI rollback tree silently destroyed | HIGH | **ACCEPT** | CF-C7-SERVE-READ-COUPLING-1 (min 24h dwell) |
| C7-D-004 | 2 unsigned DDR rows → legacy-sourced P1 GREEN wrongly licenses the read PoNR | MED | **ACCEPT** | CF-C7-DDR-GATE-1 (P1 vs P2; P2 is the PoNR gate) |
| C7-D-005 | Festival window advisory, not machine-checkable | MED | **ACCEPT** | CF-C7-FESTIVAL-WINDOW-1 (workspace_festivals query gate) |

All 5 accepted. None rejected. None downgraded. Highest irreversibility risk confirmed = C7-D-001 (Shiprocket plaintext-delete on unproven custody).

---

## 6. Final Stage-1 decision

**ADVANCE → Stage 2 (Aryan).** The requirement is sound and well-shaped; the persona sharpened it without changing its shape. No CHALLENGE-BACK (the runbook is the right deliverable and it is plannable today), no KILL.

### What Stage 2 (Aryan) must produce
A binding **decommission runbook** that:
1. Carries the DAG-forced order (§4) with a **per-hold PoNR ledger** (the load-bearing artifact), each row in the schema above.
2. Binds all 5 CF-C7-* constraints (§2) as named gates on the relevant PoNR rows.
3. **CF-C7-DPDP-ERASURE-1 is the tripwire:** Aryan MUST name a concrete §12-satisfying archive format + erasure mechanism (live-read-only-until-retention-expiry OR per-workspace-partitioned S3 — NOT a flat pg_dump) + retention basis/period + decommission trigger, and make "archive" vs "decommission" two explicit dates. **If he cannot, the `/escalate` FIRES at Stage 2.**
4. Writes the per-connector plaintext-delete PoNR with **CF-C7-CUSTODY-PROOF-1** as a hard signed precondition (real `seal()` confirmed + prod-custody-path 200 + parity GREEN), Shiprocket last.
5. Binds the **min 24h serve→read dwell gate** and the **P1/P2 two-gate** structure on the read-flip; the PoNR references P2.
6. Designs **CF-C7-FESTIVAL-WINDOW-1** as a machine query gate on every irreversible step.
7. Sequences my **DDR full sign-off** (the 2 remaining rows) AFTER Shopify cutover + BEFORE the read-flip PoNR.
8. Does NOT restate the per-child gates (references them); does NOT introduce any app code, any `@paradigm` decorator, or any new runtime (paradigm sql/runbook).
   My **Stage-6 design review (compliance + reversibility) IS the gate** (my VETO). EXECUTION is Stage-8 / Founder-at-console.

### Escalation disposition (summary)
- **C7-D-001 (custody) — FIRED** as a build-gating prerequisite addendum to the already-open Child-3 custody escalation. Founder ask = confirm the chosen Option A/B `seal()` is a real implementation (non-stub) before the Stage-8 plaintext-delete. Mirrored to `pending-founder-attention.md`.
- **C7-D-002 (archive format) — ARMED;** fires at Stage 2 iff Aryan cannot name a §12-satisfying archive format.
- **Stage-8 execution gate (production cutovers / DB shutdown) — by design, Founder-at-console** (not a mid-pipeline /escalate).
- C7-D-003 / 004 / 005 — no escalation; resolved inside the runbook.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T08:15:00Z",
  "actor": "cto-advisor",
  "type": "stage1-persona-synthesis",
  "req_id": "feat-legacy-decommission",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "epic_child_id": "child-7-decommission",
  "stage": 1,
  "decision": "ADVANCE",
  "personas_synthesized": true,
  "persona_quality_gate": "PASS (5 grounded concerns: 3 HIGH + 2 MED; all accepted)",
  "folded_constraints": [
    "CF-C7-CUSTODY-PROOF-1 (HIGH)",
    "CF-C7-DPDP-ERASURE-1 (HIGH)",
    "CF-C7-SERVE-READ-COUPLING-1 (HIGH, min 24h dwell)",
    "CF-C7-DDR-GATE-1 (MED, P1 vs P2)",
    "CF-C7-FESTIVAL-WINDOW-1 (MED, workspace_festivals machine gate)"
  ],
  "escalation": "C7-D-001 FIRED (addendum to open Child-3 custody escalation — real seal() impl confirmed before Stage-8 plaintext-delete; build_gated_on CF-C7-CUSTODY-PROOF-1); C7-D-002 archive-format tripwire ARMED (fires at Stage 2 if no §12-satisfying format named); Stage-8 execution gate = Founder-at-console by design.",
  "next_stage": 2,
  "next_agent": "architect",
  "rationale": "Persona sharpened intake without changing shape: seal()-stub means custody is unverifiable before the irreversible Shiprocket plaintext-delete (fired addendum); flat pg_dump fails DPDP §12 (armed tripwire); 24h serve->read dwell required or AI rollback tree dies; read-flip PoNR must reference Brain-sourced Gate P2 not legacy-sourced P1; festival window is a machine gate. Runbook-only shape + sql/runbook paradigm confirmed. ADVANCE to Aryan."
}
```

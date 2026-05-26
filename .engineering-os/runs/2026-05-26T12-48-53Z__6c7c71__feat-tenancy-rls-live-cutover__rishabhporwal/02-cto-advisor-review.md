# CTO Advisor Review — Stage 1 (intake)

> Filled by Rohan (cto-advisor) at Stage 1 intake.
> Predecessor: `feat-tenancy-rls-brain-native` (MERGED, HOLD-AT-FORCE). This slice is the
> live FORCE-flip ceremony with explicit legacy-app coexistence — the slice that finally
> closes the OPEN P0 logged in `pending-founder-attention.md`.

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-live-cutover` |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-26T12:48:53Z |
| **Decision** | **ADVANCE → personas (2) → synthesis → Architect (Aryan), Stage 2** |

---

## Lane decision *(durable rule: conservative tie-break to higher rigor)*

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Trigger-surface scan fires on `multi-tenancy` (RLS policies on workspace-scoped tables), `pii` (DPDP §4 processing on prod PII rows via the probe/legacy reads), `india-compliance` (DPDP §4/§8(6); ap-south-1 residency assert), `schema-proto` (RLS DDL on the live shared DB), and `connectors` (the legacy Express/Prisma app is a connector-class consumer; its connection-identity is the load-bearing decision). The foundational-scaffolding carve-out is explicitly barred by live-data/PII/compliance presence. Conservative tie-break holds. |
| **trigger_surfaces_touched** | `multi-tenancy`, `pii`, `india-compliance`, `schema-proto`, `connectors` |
| **Lane stage list** | High-stakes runs the full pipeline: Stage 1 (intake + personas + synthesis) → Stage 2 (Aryan) → Stage 3 (Vikram) → Stage 4 (Shreya, VETO) → Stage 5 (Tanvi) → Stage 6 (Rohan final review, mutation-re-run) → Stage 7 (Founder gate, delegated to Rohan per `feedback_founder_delegates_to_cto_advisor.md`) → Stage 8 (Jatin readiness + Founder-at-console live ceremony). |

---

## Pre-flight dependency check

This requirement is a Child-1 follow-on of `chore-migrate-legacy-to-brain`. Its hard dependency is the predecessor that owns the Brain-native code, primitive, runbook, and probe.

| Blocker | Required status | Actual status | Verdict |
|---|---|---|---|
| `feat-tenancy-rls-brain-native` (predecessor; Brain-native primitive + migrations + probe + runbook) | shipped / merged-on-development | `merged-on-development`, committed SHA `860aeee`, HOLD-AT-FORCE per state[req_id].post_commit_next | **PASS** |

No other blockers. The new slice does NOT introduce a Brain runtime requirement (the FORCE ceremony is operator-led under the existing manual runbook; it does NOT depend on Children 3-7 — those are out of scope for this slice; explicit non-goal).

**Note on the existing `CF-C3-FORCE-UNLOCK-SCOPE-1`** (recorded in `pending-founder-attention.md` against Child-3): Child-3's Stage-6 recorded that the Brain-native FORCE unlock additionally requires "Shiprocket DECOMMISSION + bare-write grep ZERO + sign-off." That gate is about converting the **Brain-native** consumers' residual no-context writers BEFORE FORCE. **This slice is the orthogonal coexistence question for the LEGACY consumer that won't go through that conversion** — it is the slice in which Aryan must reconcile the two (e.g. under Path C, the Brain-native bare-write-grep ZERO requirement still binds; the legacy-bypass is the dispensation only for the explicitly-named legacy connection identity). I'm carrying this as a binding constraint to Stage 2, not as a pre-flight block on this slice — it does not stop the runbook design, but it does shape the binding contract.

---

## Made requirements less dumb first

**Could delete:** Nothing. The draft already deletes the wrong-shape options (the 4 paths are mutually exclusive; the recommendation pre-prunes A1/A2 in favor of C). The draft's non-goals are correctly excluded (connectors / ClickHouse / legacy retirement).

**Could simplify:** The "Path A1/A2" subdivision can be collapsed — A1 violates `feedback_legacy_is_reference_only.md` outright and is therefore not a Founder-available option; A2 (`SECURITY DEFINER` + pgbouncer custom auth) is real infra work whose blast radius dwarfs Path C's narrow bypass. After Stage-1 synthesis I expect to recommend collapsing the path-set to **{B, C}** (with the draft's recommended C as the immediate close, B as the longer-cycle final close).

**Could defer:** Nothing in this slice. The Brain-native FORCE-execution side of C5 has been deferred as long as it lawfully can be (the OPEN P0 has been open since 2026-05-24); waiting longer is the DPDP §4 risk that motivated the requirement.

**The one challenge-worthy framing question:** the draft recommends "Path C immediate, Path B follow-on." That is reasonable, but the *Founder-canon* answer is closer to "Path B is the only path that cleanly satisfies `feedback_legacy_is_reference_only.md` AND closes the OPEN P0 with no residual bypass." So the real Stage-2 choice is between **'C with a bounded, expiring, audited service-role-bypass to the explicitly-named legacy connection identity'** vs **'wait for B'**. I'll surface this as the headline path question for synthesis; my read is C-as-bridge-to-B is correct given the leak window has been open since 2026-05-24, but it is a Founder trade-off I want explicit (CHALLENGE-BACK candidate if I cannot derive the trade-off from canon alone).

---

## Personas spawned *(Stage 1 — 0/1/2 by complexity; cap 2)*

### Persona-count decision

**Count: 2** (the high-stakes lane's cap; rationale below).

| Field | Value |
|-------|-------|
| **Persona 1** | `india-data-isolation-compliance-officer:sonnet` |
| **Persona 2** | `live-rollout-strangler-realist:sonnet` |
| **Why 2** | This requirement intersects **two materially distinct risk dimensions**: (a) **DPDP §4 / §8(6) compliance** — the live PROD DB has PII; the FORCE flip is the act that closes the leak surface, but a Path-C bypass to the legacy connection is a *residual* §4 surface that needs a documented lawful answer (single-tenant-per-process audit, or expiring authorization, or an exit deadline); and (b) **live-rollout / strangler-fig ops realism** — quiesce vs in-flight transactions, idempotent runbook augmentation, atomic rollback (DDL + shim removal in one path), and the load-bearing legacy-connection-identity question. A single persona cannot do both honestly. Neither risk dominates the other. |
| **Why not 1** | A single compliance OR ops persona would silently drop the other dimension. Compliance-only would not catch the "STEP 5 legacy smoke test asserts the wrong thing if it runs as the bypass role" class of failure; ops-only would not surface "the bypass is a §4 surface that needs an exit deadline / documented authorization." |
| **Why not 3** | No third risk dimension survives the high-stakes lane cap. AI cost-routing is not in scope (paradigm `sql`); numeric-parity is not in scope (no money/metric writes); UX is not in scope (operator-only runbook). 3+ personas would overshoot per Founder rule (2026-05-19). |
| **Why these depths (`:sonnet`)** | Both personas are reasoning-heavy: compliance is a multi-step trade-off (DPDP §4 vs leak-window vs bypass-as-residual-surface vs legacy-retirement-cycle); strangler is a multi-step ops trade-off (quiesce ordering, in-flight tx, atomic rollback, idempotency, bare-write-grep reconciliation with Child-3's CF-C3-FORCE-UNLOCK-SCOPE-1). `:haiku` would underfit; both warrant Sonnet. |

### Persona 1 brief — `india-data-isolation-compliance-officer:sonnet`

**Mandate:** Audit the live-cutover plan against DPDP Act 2023 + Rules 2025 (§4 lawful basis, §8(6) penalty exposure, §12 erasure scope), the data-residency assertion (ap-south-1 on BOTH `:6543` + `:5432` at runbook STEP 0), and the residual-leak surface introduced by Path C's service-role-style bypass for the legacy connection.

**Required questions to surface (≥1 concern each, or persona is rejected):**

1. **Path C residual surface.** Is a service-role-style bypass for the legacy connection identity a lawful answer under §4 *as a permanent state*? If not, what time-bounded / scoped form does it need (named connection only, expiring authorization, exit deadline = Path B completion date)? Does the bypass need to be Decision-Logged on every use, or just on creation/removal?
2. **CF-SEC-3.HARD re-arm boundary.** The inherited gate re-arms before any third-party-brand PII is processed. Does the live FORCE-flip ceremony itself trigger that re-arm (it touches Sugandh-Lok PII rows via the legacy app's continued operation), or does it stay satisfied (Sugandh-Lok is still the only in-scope brand)? Pin a falsifiable test for the re-arm boundary.
3. **§4 lawful basis for the CF-SEC-1 probe against LIVE.** The probe queries PII rows (e.g. `Invitation.email`, `ShopifyCustomer.email`) to assert zero-row return. Is the Founder-as-controller-of-Sugandh-Lok memo (from the Child-1 escalation, resolved 2026-05-24) the lawful basis for this live probe execution, or does the live execution require a separate explicit step? Name the artifact.
4. **§16 cross-border check.** All three URLs (DATABASE_URL/DIRECT_URL/connection-pool routes) MUST be ap-south-1. Assert at the Postgres level on BOTH pooled and direct routes (mirror CF-RES-1.a from Child-1). If the staging clone is provisioned outside ap-south-1 for the rehearsal, is that a §16 issue or out-of-scope (staging = synthetic data)?
5. **DPDP §12 erasure scope of the legacy connection's audit log.** If the legacy connection's bypass usage is recorded (it should be — see Q1), where? Is that log itself per-data-principal erasure-scopable, or does it need its own format decision (mirror Child-7's CF-C7-DPDP-ERASURE-1 tripwire)?

**Permitted to escalate** the path choice to the Founder ONLY if Q1 cannot be resolved from canon (i.e. it requires a Founder trade-off between "permanent residual bypass" and "wait for Path B"). Otherwise return to me at synthesis with a binding path choice + falsifiable §4 answer.

### Persona 2 brief — `live-rollout-strangler-realist:sonnet`

**Mandate:** Pressure-test the live-cutover runbook augmentation, the legacy-coexistence shim, atomic rollback, and the reconciliation with Child-3's `CF-C3-FORCE-UNLOCK-SCOPE-1` (Brain-native bare-write grep ZERO + Shiprocket DECOMMISSION).

**Required questions to surface (≥1 concern each, or persona is rejected):**

1. **In-flight transaction handling at FORCE.** STEP 1 quiesces crons, but the legacy Express app's HTTP requests are not crons — they may still be in-flight at the moment of `ALTER TABLE … FORCE ROW LEVEL SECURITY`. Does the runbook require an additional "drain in-flight HTTP requests on the legacy app's process tree" gate, OR does it require the maintenance window to take the legacy app off the load balancer first? Either way: name the deterministic step, do not assume "no traffic at 3am."
2. **STEP 5 smoke-test correctness (the verify-the-verifier hazard for THIS slice).** Per the durable rule `2026-05-26__verify-the-verifier-mutation-on-gate`, STEP 5's "legacy frontend renders the same row counts" assertion is a high-stakes GATE — its GREEN authorizes the cutover-complete signature. A vacuous form of this gate is: assert against the bypass connection (which trivially sees all rows pre- and post-FORCE). The REAL form is: assert via the *production legacy HTTP path*, exercised end-to-end, NOT against a hand-built psql double. Name the real-path test fixture + the kill-test (mutation: remove FORCE on one table; expect the CF-SEC-1 probe to go RED via the `rls_app` role and the legacy smoke to STILL PASS — proving that the legacy smoke is NOT load-bearing for the leak verdict, only for the no-outage verdict).
3. **Atomic rollback contract.** `down.sql` drops policies AND `ALTER TABLE … NO FORCE` — but the Path-C bypass is a separate object (a role-grant or a connection-string change). If `down.sql` runs while the bypass exists, the bypass becomes a no-op (no policies to bypass) — fine. If the bypass-removal step runs while FORCE is still on, the legacy app 0-rows — NOT fine. What's the binding ordering? Document it; the runbook MUST `down.sql` BEFORE bypass-removal, OR include the bypass-removal as the first step of `down.sql`. Choose one and bind it.
4. **Reconciliation with `CF-C3-FORCE-UNLOCK-SCOPE-1`.** Child-3's recorded gate is "FORCE stays HELD until Shiprocket DECOMMISSION + Brain-native bare-write grep ZERO + sign-off." Under Path C, the bare-write grep still binds for Brain-native code (no bare writes that would bypass `withWorkspace`), AND Shiprocket DECOMMISSION still needs to ship — OR the legacy-bypass dispensation is broader than the requirement claims. Reconcile in writing: "Path C bypass applies ONLY to the legacy-Express connection identity X; all Brain-native consumers MUST satisfy bare-write-grep ZERO + Shiprocket DECOMMISSION before FORCE." If Shiprocket DECOMMISSION is not yet done, FORCE may need to wait OR the runbook needs an explicit "Shiprocket connector quiesced for the cutover window" sub-step.
5. **Idempotency.** If the operator re-runs the runbook after a STEP 3 failure, does STEP 1 (quiesce) re-run cleanly? Does STEP 3 (apply shim) re-run cleanly (e.g. role-grant `IF NOT EXISTS`)? Does STEP 5 (smoke) re-run cleanly? Name each.
6. **Maintenance-window calendar constraint.** The Child-7 informational heads-up already encoded "no irreversible cutovers in a festival-peak GMV window" as a Stage-8 calendar constraint. Does this slice inherit that constraint? Confirm yes/no.

**Permitted to escalate** the cutover ordering vs `chore-security-governance-hardening-phase` WS-1 ONLY if it surfaces a binding conflict (e.g. WS-1 needs the legacy creds rotated, which requires the legacy app to be reachable on a non-bypass connection during rotation). Otherwise return to me at synthesis with a binding runbook outline + falsifiable kill-test names.

---

## Paradigm recommendation

**Recommended paradigm:** `sql`

**Why:** Pure deterministic storage-layer work — RLS DDL (`ALTER TABLE … FORCE ROW LEVEL SECURITY`), connection-handling (a service-role-style bypass for one named connection identity), shell-driven runbook, psql probe. ZERO LLM, ZERO ML, ZERO numeric-parity, ZERO LLM-as-write-path. The `withWorkspace()` primitive is unchanged. Audit: `@paradigm sql` on every artifact this slice ships.

Architect (Aryan) may refine in Stage 2 — but I do not see a paradigm-escalation path here. A re-paradigming to `small_llm` or above would be a CHALLENGE-BACK.

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | n/a (no fulfillment / no operational flow touched). |
| **COD** | n/a. |
| **GST** | n/a (no money / tax / metric writes). |
| **Festival seasonality** | **HIGH.** Mirrors Child-7: the irreversible FORCE flip + the legacy app's brief quiesce window MUST NOT be scheduled in a festival-peak GMV window (Diwali / Republic-Day-sale / EOSS). Founder owns the calendar; the runbook must name this constraint in writing. |
| **Pincode reliability** | n/a. |
| **Telecom compliance** | n/a. |
| **DPDP** | **HIGH — primary risk dimension.** The OPEN P0 closure is itself the DPDP §4 / §8(6) story. Path C's bypass is a *residual* §4 surface; persona 1 must produce a lawful answer (time-bounded / named-connection-only / exit-deadline). §16 residency on BOTH `:6543` + `:5432` must be re-asserted at runbook STEP 0. CF-SEC-3.HARD inherited and not re-triggered (still Sugandh-Lok only). |
| **Data residency** | **HIGH.** ap-south-1 must be Postgres-asserted on both routes before any DDL — CF-RES-1.a inherited and re-binds. If the staging clone is provisioned outside ap-south-1, that's a §16 escalation. |

---

## Escalation ruling (mid-pipeline `/escalate` rubric)

**No mid-pipeline `/escalate` at intake.** Mirror to `pending-founder-attention.md` for VISIBILITY ONLY (non-blocking), because this slice (a) materially closes a Founder-OPEN P0, (b) introduces a residual-bypass surface that intersects an existing Founder-deferred policy (`chore-security-governance-hardening-phase` WS-1), and (c) the path choice (B vs C-as-bridge-to-B) is a Founder trade-off that personas 1+2 may resolve at synthesis — but if they cannot, I `/escalate` at synthesis (precedent: Child-1 DPDP, Child-3 custody Option A/B both escalated at synthesis-time, not intake).

**Why visibility-not-permission at intake:** the operational substance of the runbook augmentation can be designed without a Founder decision (Aryan can write the Path-C runbook in parallel with Founder's path ratification, because the Path-C runbook is a strict superset of Path-B's eventual runbook — drop the bypass and you have B). The path choice itself is a trade-off only the Founder can sign, but it is best surfaced at synthesis with the personas' binding inputs in hand.

**Armed escalations (FIRE at synthesis if conditions met):**

- **CF-CUT-PATH-1** (path choice). FIRES at synthesis if persona 1 cannot resolve "is a permanent Path-C bypass lawful under DPDP §4?" without a Founder trade-off. Default fallback if FIRED: Founder picks {C-with-exit-deadline, B, A2} (A1 is barred by `feedback_legacy_is_reference_only.md`).
- **CF-CUT-SHIPROCKET-RECONCILE-1** (cross-child gate). FIRES at synthesis if persona 2 finds Child-3's `CF-C3-FORCE-UNLOCK-SCOPE-1` (Shiprocket DECOMMISSION + bare-write grep ZERO) is NOT compatible with executing FORCE before Shiprocket DECOMMISSION ships. If FIRED, the live ceremony is sequenced after Shiprocket DECOMMISSION OR the runbook adds a "Shiprocket connector quiesced for the cutover window" sub-step + a Founder-ratified narrowing of `CF-C3-FORCE-UNLOCK-SCOPE-1`.
- **CF-CUT-RESIDENCY-1** (staging clone region). FIRES at Stage-2/3 if the staging clone is provisioned outside ap-south-1 (§16 cross-border transfer of PROD PII via the clone).

---

## Binding contract carried to Stage 2 (initial Stage-1 draft; synthesis will sharpen)

**Inherited (from Child-1 `feat-tenancy-rls-brain-native`, MERGED, HOLD-AT-FORCE — these binds carry forward unchanged):**

- **CF-RES-1.a** — assert region `ap-south-1` on BOTH pooled (`:6543`) + direct (`:5432`) URLs at runbook STEP 0; Postgres-level, never DNS-trusted.
- **CF-SEC-1** — fail-closed RLS probe must run live this slice (predecessor was code-only): cross-workspace = 0, context-less = 0, same-workspace = expected non-zero. Captured output in run folder. Probe runs as `rls_app` (rolbypassrls=false) — NOT as a superuser or as the bypass role.
- **CF-SEC-3.HARD** — inherited; re-arms before any third-party-brand PII is processed. NOT re-triggered by this slice (Sugandh-Lok-only).
- **CF-SEC-5** — correlation-ID 4-tuple (`request_id`/`trace_id`/`workspace_id`/`user_id`) on every Brain runtime path (unchanged; no new Brain runtime in this slice).
- **CF-C1-POOL-1.a** — `withWorkspace()` unchanged.
- **CF-C1-RLS-DEFAULT-1.a** — fail-closed policy shapes unchanged.
- **CF-C1-CRON-SCOPE-1.a** — cron fan-out per-workspace-session-scoped (no new crons in this slice).
- **CF-C1-AUDITLOG-1.a** — dual-policy for nullable-`workspace_id` tables.
- **CF-C1-ROLLOUT-ORDER-1 (SHARPENED)** — quiesce-crons-FIRST at ENABLE *and* FORCE; CF-CUT-DRAIN-1 (NEW, below) extends this to in-flight HTTP requests on the legacy app.
- **CF-C1-ZERO-BEHAVIOR-1** — byte-identical live API behavior pre/post.
- **CF-BN-NOLEGACY-1** — zero legacy code imported/edited/committed; legacy stays reference-only on disk. Binds Path C / Path A2 / Path B; explicitly bars Path A1.

**New for this slice (initial Stage-1 draft; personas + synthesis sharpen):**

- **CF-CUT-PATH-1 (CRITICAL — binding deliverable, Aryan Stage 2):** Pick path A2 / B / C with binding rationale; if C, name the legacy connection identity that receives the bypass, the form of the bypass (role-grant vs connection-string vs `BYPASSRLS` flag — `BYPASSRLS` is the easiest BUT also the highest residual surface), the exit deadline / Path-B-completion linkage, and the audit form (per-use Decision-Log or just create/remove). A1 is explicitly barred by `feedback_legacy_is_reference_only.md`.
- **CF-CUT-RUNBOOK-AUG-1 (CRITICAL — binding deliverable, Vikram Stage 3):** Extend `apps/core-service/migrations/manual/rls/rollout-runbook.sh` with STEP 3 (apply shim) + STEP 5 (legacy smoke) per the chosen path; preserve all existing STEPs 0-6; idempotent; atomic rollback per CF-CUT-ROLLBACK-ATOMIC-1.
- **CF-CUT-ROLLBACK-ATOMIC-1 (HIGH — binding, Aryan + Vikram):** Define the binding ordering for `down.sql` + shim removal: which goes first, what's the atomicity contract, what's the measured time-to-rollback budget (target ≤ 60 s on staging clone). If the rollback ordering is wrong, the legacy app 0-rows during rollback — same outage class as a failed FORCE.
- **CF-CUT-DRAIN-1 (HIGH — binding, Aryan + Vikram):** Quiesce-crons (existing) is necessary but NOT sufficient. In-flight HTTP requests on the legacy Express app process tree are a separate concurrency surface at the moment of FORCE. Runbook MUST name the deterministic drain step (e.g. legacy app off the load balancer first, OR `kill -SIGTERM` + drain timeout, OR explicit operator confirmation that the legacy app's request queue is empty for ≥ N seconds).
- **CF-CUT-VERIFY-THE-VERIFIER-1 (HIGH — binding, per durable rule `2026-05-26__verify-the-verifier-mutation-on-gate`):** Every high-stakes gate in this slice MUST carry a real-path test + a captured killed-mutant + an inverse mutant. Apply to: (a) CF-SEC-1 probe (kill-test: remove FORCE on one table; expect probe RED via `rls_app`); (b) STEP-5 legacy smoke (kill-test: STEP-5 must use the actual legacy HTTP path, not a psql double of the bypass role; mutation: remove FORCE on one table — the CF-SEC-1 probe goes RED while the legacy smoke STILL PASSES, proving STEP-5 is NOT load-bearing for the leak verdict, only the no-outage verdict); (c) rollback contract (kill-test: artificially desync `down.sql` + shim-removal ordering; expect a 0-row window — proves the ordering matters). Stage-2 plan MUST name each kill-test by function name + capture-file location. Stage-5 MUST capture the killed-mutant outputs. Stage-6 MUST re-mutate on disk per sub-rule 7.
- **CF-CUT-SHIPROCKET-RECONCILE-1 (HIGH — binding, Aryan Stage 2):** Reconcile with Child-3's `CF-C3-FORCE-UNLOCK-SCOPE-1` (Shiprocket DECOMMISSION + Brain-native bare-write grep ZERO + sign-off). Under Path C, the bare-write grep still binds for Brain-native consumers; the legacy bypass is dispensation only for the explicitly-named legacy connection identity. If Shiprocket DECOMMISSION is not yet shipped, runbook MUST add a "Shiprocket connector quiesced for the cutover window" sub-step OR the live ceremony is sequenced after Shiprocket DECOMMISSION.
- **CF-CUT-RESIDENCY-1 (HIGH — binding, Vikram + Tanvi):** Re-asserts CF-RES-1.a at the live ceremony AND at the staging clone. Staging clone MUST be in ap-south-1 OR explicitly use synthetic data only (no PROD PII), to avoid a DPDP §16 cross-border transfer via the rehearsal.
- **CF-CUT-CALENDAR-1 (MEDIUM — binding, Founder owns calendar):** Live FORCE flip + legacy quiesce window MUST NOT be scheduled in a festival-peak GMV window (mirrors Child-7 constraint). Runbook documents the constraint; Founder owns the date.
- **CF-CUT-BYPASS-AUDIT-1 (MEDIUM — binding, Aryan Stage 2, refined by persona 1):** If Path C, the bypass usage MUST be auditable. Persona 1 settles whether per-use Decision-Log or just create/remove is the required granularity. The audit log itself MUST be DPDP §12 erasure-scopable (mirror Child-7's CF-C7-DPDP-ERASURE-1 framing).

**Maya (intelligence) co-owner:** **No.** No metric/money/AI/numeric-parity/registry dimension in this slice. Pure storage-layer work.

---

## Synthesis pass

Will run after the orchestrator spawns personas 1+2 and re-invokes me. Will fold both personas' concerns into the binding contract, decide CF-CUT-PATH-1 at synthesis OR `/escalate` it to the Founder if it requires a trade-off only the Founder can make. Output: `05-stage1-synthesis.md`.

---

## Decision

**ADVANCE.** The requirement is buildable, properly scoped (delete/simplify/defer applied), correctly classified as high-stakes, lane-appropriate, dependency-clean, and intersects two distinct risk dimensions that the 2-persona pass will pressure-test. The OPEN P0 closure is materially overdue — this is the right slice.

Next step: orchestrator spawns the two personas; I synthesize; Aryan picks up at Stage 2.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-26T12:48:53Z",
  "actor": "cto-advisor",
  "type": "stage1-intake",
  "req_id": "feat-tenancy-rls-live-cutover",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "predecessor": "feat-tenancy-rls-brain-native",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "feature_class_rationale": "multi-tenancy + pii + india-compliance + schema-proto + connectors trigger surfaces on live PROD DB; foundational-scaffolding carve-out barred; conservative tie-break holds.",
  "trigger_surfaces_touched": ["multi-tenancy", "pii", "india-compliance", "schema-proto", "connectors"],
  "paradigm": "sql",
  "needs_personas": ["india-data-isolation-compliance-officer:sonnet", "live-rollout-strangler-realist:sonnet"],
  "armed_escalations": ["CF-CUT-PATH-1", "CF-CUT-SHIPROCKET-RECONCILE-1", "CF-CUT-RESIDENCY-1"],
  "binding_constraints_initial": ["CF-CUT-PATH-1", "CF-CUT-RUNBOOK-AUG-1", "CF-CUT-ROLLBACK-ATOMIC-1", "CF-CUT-DRAIN-1", "CF-CUT-VERIFY-THE-VERIFIER-1", "CF-CUT-SHIPROCKET-RECONCILE-1", "CF-CUT-RESIDENCY-1", "CF-CUT-CALENDAR-1", "CF-CUT-BYPASS-AUDIT-1"],
  "inherited_constraints": ["CF-RES-1.a", "CF-SEC-1", "CF-SEC-3.HARD", "CF-SEC-5", "CF-C1-POOL-1.a", "CF-C1-RLS-DEFAULT-1.a", "CF-C1-CRON-SCOPE-1.a", "CF-C1-AUDITLOG-1.a", "CF-C1-ROLLOUT-ORDER-1", "CF-C1-ZERO-BEHAVIOR-1", "CF-BN-NOLEGACY-1"],
  "durable_rule_applied": "2026-05-26__verify-the-verifier-mutation-on-gate",
  "escalation": "none-at-intake; visibility-only mirror to pending-founder-attention.md; armed for synthesis if personas cannot resolve path choice"
}
```

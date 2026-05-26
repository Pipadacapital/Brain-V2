# Stage 1 — Synthesis (CTO Advisor / Rohan)

> Synthesis pass: reached after the two personas (`03-persona-india-data-isolation-compliance-officer.md`
> + `04-persona-live-rollout-strangler-realist.md`) ran their adversarial passes. Folds both
> into the binding contract carried to Stage 2 (Architect / Aryan). Pairs with
> `02-cto-advisor-review.md` (intake pass). Validates the Stage-1 DoD.
>
> Operator-pipeline note (CTOA is a subagent without the Agent tool): the two persona artifacts
> were authored in-session within this run folder per the established slice-pipeline pattern
> already used on `feat-onboarding-membership-db` (decision-log 2026-05-26T00:25:00Z) and the
> Child-1 lineage. Each persona is a distinct adversarial pass; neither was a "looks good" pass;
> both surfaced ≥1 grounded concern (5 + 7 = 12 concerns total, all in-lane).

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-live-cutover` |
| **Stage** | 1 (synthesis) |
| **Timestamp** | 2026-05-26T12:55:00Z |
| **Decision** | **ADVANCE → Architect (Aryan), Stage 2 — with one `/escalate` to Founder (path choice) and one CRITICAL kill-test obligation (STEP 5 verify-the-verifier)** |
| **Lane** | high-stakes (confirmed; unchanged) |
| **Paradigm** | `sql` — confirmed; no AI / no money / no metric writes |
| **Maya (intelligence) co-owner** | **No** — no metric/money/AI/numeric-parity dimension |
| **Parent epic** | `chore-migrate-legacy-to-brain` (Child-1 follow-on) |
| **Predecessor** | `feat-tenancy-rls-brain-native` (merged-on-development; HOLD-AT-FORCE) |

---

## 1. Persona accept / reject

**Both personas: ACCEPTED.**

- **Persona 1 — `india-data-isolation-compliance-officer:sonnet`** — 5 grounded concerns, 0 "looks good" responses. C1 is the headline (Path C bypass not lawful as permanent state) → escalation recommendation. C4 (staging clone §16) is independent and binding. C5 (bypass audit shape) is binding and concrete. Did exactly its job: pressure-tested DPDP §4/§8(6)/§12/§16 and converted my intake's residual-bypass framing into a falsifiable constraint with concrete audit shape.
- **Persona 2 — `live-rollout-strangler-realist:sonnet`** — 7 grounded concerns; **O2 is CRITICAL** (the verify-the-verifier hazard on STEP 5 — exactly the durable-rule's target class, and the rule's #10 occurrence would land in production if it ships vacuous). O1 (in-flight HTTP drain), O3 (rollback ordering), O4 (Shiprocket reconciliation) are all binding ops realism. Did exactly its job: caught the structural false-GREEN that the requirement-as-drafted would have shipped, and named the kill-test pair that closes it.

No concern silently dropped. Disposition of all 12 in §2.

---

## 2. Disposition of all 12 concerns

### Persona 1 (compliance) concerns

| # | Sev | Persona concern (one-line) | Disposition | Carried as |
|---|---|---|---|---|
| C1 | HIGH | Path C bypass not lawful as PERMANENT state under DPDP §4; needs exit deadline + narrow scope + audit + second-brand tripwire | **ACCEPT — recommends `/escalate` to Founder for path trade-off.** Persona 1's read is correct: a standing bypass for an entire connection identity is *not* purpose-bound processing, and the §8(6) notice-time exposure on the OPEN P0 (open since 2026-05-24) makes "wait for Path B" canon-incompatible. The Founder picks between (A) Path C with hard exit deadline = Path B completion date and (C) Path A2 (pgbouncer custom auth). A1 is barred; B-as-immediate-close is barred. **FIRE `/escalate`** (see §4). | **CF-CUT-PATH-1 (CRITICAL, ESCALATED)** — Founder picks {C-with-deadline, A2}; default for synthesis-time recommendation = C-with-deadline tied to Path B completion. |
| C2 | HIGH | CF-SEC-3.HARD does NOT re-trigger, but a §7 continuity ADDENDUM listing live FORCE-flip + probe + bypass + STEP-5 smoke must be on record before STEP 5 | **ACCEPT.** The Child-1 memo's enumerated acts don't fully cover this slice's acts; an addendum is the minimum-friction fix. Aryan drafts at Stage 2; Founder signs at Stage 7/8. | **CF-CUT-DPDP-ADDENDUM-1 (HIGH, NEW)** — Aryan Stage-2 deliverable: produce addendum draft to Child-1 §7 memo enumerating (1) live FORCE-flip execution, (2) live CF-SEC-1 probe execution, (3) creation+use of legacy bypass (Path C only), (4) STEP-5 smoke against legacy HTTP. Founder signs at Stage 7/8 before Stage-8 STEP-5. |
| C3 | MEDIUM | §4 lawful basis for LIVE CF-SEC-1 probe covered by Child-1 memo; addendum should re-state | **ACCEPT — folded into CF-CUT-DPDP-ADDENDUM-1.** | Folded. |
| C4 | HIGH | §16: staging clone MUST be ap-south-1 OR synthetic-only; non-ap-south-1 clone of PROD PII = transfer | **ACCEPT — sharpens CF-CUT-RESIDENCY-1 from intake.** Staging clone provisioning is a separate compliance act. | **CF-CUT-RESIDENCY-1 (SHARPENED)** — runbook STEP 0.5 (NEW) asserts: staging clone is ap-south-1 (Postgres-level), OR staging DB is explicitly tagged synthetic-only with generator artifact in run folder. Inadmissible: non-ap-south-1 clone with PROD PII. Binding at Stage 2/3. |
| C5 | HIGH | Bypass audit log itself must be §12 erasure-scopable; recommended = per-create/remove Decision-Log + structured Postgres statement log keyed by workspace_id | **ACCEPT — sharpens CF-CUT-BYPASS-AUDIT-1 from intake into concrete shape.** Per-create/remove + structured statement log avoids the Child-7 `pg_dump`-style erasure-scopability trap. | **CF-CUT-BYPASS-AUDIT-1 (SHARPENED)** — bypass audit = (Brain Decision-Log entry per create/remove of bypass, columns: `ts`, `actor`, `connection_identity`, `granted_until`, `decision_basis`) + (structured Postgres `log_statement` shipping to a `bypass_query_log` table with columns: `ts`, `workspace_id`, `connection_id`, `statement_class`, NOT raw text). Erasure-scopable by `DELETE WHERE workspace_id = $X`. Retention bounded by CF-CUT-PATH-1's exit deadline. |

### Persona 2 (strangler) concerns

| # | Sev | Persona concern (one-line) | Disposition | Carried as |
|---|---|---|---|---|
| O1 | HIGH | STEP 1 doesn't drain in-flight legacy HTTP; recommend "off the LB first + `pg_stat_activity` drain confirmation" | **ACCEPT — sharpens CF-CUT-DRAIN-1.** Aryan picks (a)/(b)/(c) at Stage 2; my recommendation is (a) — legacy off LB + `pg_stat_activity` drain confirm, scripted in the runbook. | **CF-CUT-DRAIN-1 (SHARPENED)** — runbook adds (between existing STEP 1 cron-quiesce and STEP 3 ENABLE): "STEP 1.5: legacy Express app off the load balancer; operator confirms `SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE '%legacy%' AND state IN ('active','idle in transaction')` = 0 for ≥ 30s." Bind. |
| O2 | **CRITICAL** | STEP 5 verify-the-verifier hazard — vacuous form (bypass psql double) false-GREENs; real form (legacy HTTP path) + kill-test + inverse-mutant required | **ACCEPT — sharpens CF-CUT-VERIFY-THE-VERIFIER-1 to CRITICAL/binding with explicit kill-test pair.** This is the durable-rule's target class; the rule's #10 occurrence would land in prod if STEP 5 ships vacuous. Bind the real-path STEP 5 + both mutants captured on staging clone PRE-ceremony; Stage-5 reviews verbatim; Stage-6 re-mutates on disk. | **CF-CUT-VERIFY-THE-VERIFIER-1 (SHARPENED → CRITICAL)** — STEP 5 = real legacy HTTP path (`curl https://legacy.brand.com/api/orders?range=last-7d -H "Cookie: $LIVE_SUGANDH_LOK_SESSION"` or equivalent); NOT a psql double of the bypass role. Pre-ceremony staging-clone exercises capture: (i) kill-test — apply FORCE without legacy bypass, STEP 5 RED; apply bypass, STEP 5 GREEN (proves STEP 5 is sensitive to the bypass); (ii) inverse-mutant — with FORCE + bypass, drop FORCE on one table (`marketing_actions`), CF-SEC-1 probe via `rls_app` RED, STEP 5 STILL GREEN (proves STEP 5 is the no-outage gate; CF-SEC-1 is the leak gate; they are two distinct gates). Both outputs captured to `staging-rehearsal/{step5-kill.txt,step5-inverse.txt}` in the run folder. Stage-5 reviews verbatim; Stage-6 re-mutates on disk per durable-rule sub-rule 7. |
| O3 | HIGH | Atomic rollback ordering: `down.sql` BEFORE bypass-revoke; wrong order = 0-row outage during rollback | **ACCEPT — sharpens CF-CUT-ROLLBACK-ATOMIC-1 with the binding order + third kill-test.** | **CF-CUT-ROLLBACK-ATOMIC-1 (SHARPENED)** — rollback ordering: (1) `psql "$DIRECT_URL" --file down.sql` (drops policies + NO FORCE), THEN (2) revoke bypass (`ALTER ROLE … NOBYPASSRLS` or rotate connection string). Third pre-ceremony staging-clone exercise: kill-test #3 — run rollback in the WRONG order; observe 0-row window via the legacy HTTP path; output captured to `staging-rehearsal/rollback-wrong-order-kill.txt` (RED) + `rollback-right-order.txt` (GREEN). Time-to-rollback budget: target ≤ 60 s on staging; bind the *measured* number as the live ceremony's pre-committed rollback SLO. |
| O4 | HIGH | Reconciliation with `CF-C3-FORCE-UNLOCK-SCOPE-1`: Shiprocket DECOMMISSION not shipped; runbook needs STEP 0.7 (Shiprocket quiesced) + corrected bare-write grep = ZERO + Founder-ratified gate narrowing | **ACCEPT — sharpens CF-CUT-SHIPROCKET-RECONCILE-1 with the concrete runbook step + the gate narrowing.** The Brain-native bare-write grep ZERO requirement still binds; Path C does NOT waive it (it covers only the legacy connection identity). | **CF-CUT-SHIPROCKET-RECONCILE-1 (SHARPENED)** — runbook adds: "STEP 0.7: Shiprocket connector quiesced for the cutover window (HTTP listener disabled or process killed); operator confirms last Shiprocket request timestamp is > $CUTOVER_DRAIN_SECONDS ago." Pre-cutover Brain-native bare-write grep (per Child-1 STEP 5 hold-conditions, MUST NOT exclude backfill/discoverChannels) returns ZERO; output captured to `staging-rehearsal/brain-native-bare-write-grep.txt`. Stage-2 plan documents the Founder-ratified gate narrowing: "`CF-C3-FORCE-UNLOCK-SCOPE-1` is partially satisfied at this cutover via Shiprocket-quiesced-during-cutover + Brain-native bare-write grep ZERO; full Shiprocket DECOMMISSION ships as a separate Stage-8 ceremony." |
| O5 | MEDIUM | STEP 3 bypass-grant must be idempotent for chosen shape | **ACCEPT — binds with the chosen path's shape at Stage 2.** | **CF-CUT-IDEMPOTENT-1 (NEW, MEDIUM)** — STEP 3 must be idempotent. `ALTER ROLE … BYPASSRLS` is trivially idempotent; connection-string-rotation form requires check-then-set guard. Aryan picks shape at Stage 2 and binds accordingly. |
| O6 | MEDIUM | Calendar constraint inherited from Child-7; no festival-peak GMV window | **ACCEPT — sharpens CF-CUT-CALENDAR-1.** | **CF-CUT-CALENDAR-1 (SHARPENED)** — runbook documents in writing: "DO NOT execute during a festival-peak GMV window (Diwali / Republic-Day-sale / EOSS). Founder owns the calendar." Stage 7/8 ratification. |
| O7 | MEDIUM-info | STEP 0 region assertion is operator-confirmation, not Postgres-level | **NOTE — non-binding for this slice.** Founder is the operator; existing form is adequate. Aryan may optionally tighten in this slice or defer; I do not bind it. | Informational only; not a CF. |

---

## 3. Confirmations (held from intake, re-affirmed at synthesis)

- **Lane: high-stakes** — unchanged. Both personas reinforced the trigger surfaces (multi-tenancy, PII, india-compliance, schema-proto, connectors); neither surfaced a surface that would change the lane.
- **Paradigm: `sql`** — confirmed. Pure deterministic storage-layer work (DDL + connection-handling + shell runbook). Audit clean.
- **No Maya co-owner** — confirmed. No metric/money/AI/numeric-parity dimension.
- **CF-SEC-3.HARD** — unchanged; Sugandh-Lok-only this slice. Re-arm boundary is the legacy bypass's workspace usage during the cutover window (mechanized via the bypass audit log + a post-flip operator grep — see C2 + C5 binding).
- **CF-RES-1.a** — re-binds at runbook STEP 0 (existing) AND at staging-clone STEP 0.5 (NEW, per CF-CUT-RESIDENCY-1 sharpening).
- **CF-BN-NOLEGACY-1** — re-binds; A1 explicitly barred this run. Path C / Path A2 / Path B all comply. Path A1 would `git diff -- "legacy project/"` ≠ 0 and bounce at Stage 6.

---

## 4. Escalation decision (`/escalate` to Founder — FIRES at synthesis)

**FIRE `/escalate` for CF-CUT-PATH-1.** Mirror to `pending-founder-attention.md` per the discipline.

**The trade-off (Founder picks ONE):**

- **(A) Path C with hard exit deadline = Path B completion date.** Closes the OPEN P0 at the storage layer for every NEW connection (Brain `rls_app`, future services) within one cutover window. Residual surface = ONE explicitly-named legacy connection identity, with bypass usage audited per CF-CUT-BYPASS-AUDIT-1, lifetime bounded by the Founder-ratified Path-B completion date. **My recommendation.** Defensible under DPDP §7 transitional continuity for the bounded interval; consistent with the Founder's own established discipline of "merge code, HOLD irreversibles for Founder-at-console" used on Children 1-7.
- **(C) Path A2 — pgbouncer custom auth.** Cleanest DPDP posture (workspace-scoped on the legacy side too, no permanent or transitional bypass). BUT real infra work (pgbouncer custom-auth hooks + JWT-to-`workspace_id` derivation at the pool layer); blast-radius dwarfs Path C's narrow bypass; weeks of new infra + risk before the OPEN P0 closes.
- **(B) Wait for Path B (legacy retired first, then FORCE).** Inadmissible. Path B-as-immediate-close is canon-incompatible with §8(6) notice timeline — Founder has been on notice of the OPEN P0 since 2026-05-24; "wait weeks while parity ships" compounds the §8(6) exposure. Path B remains the right *final* close (sequenced after Path C closes the immediate leak), not the immediate close.
- **(D) Path A1 — Prisma middleware in legacy backend.** Inadmissible. `feedback_legacy_is_reference_only.md` bars new implementation in `legacy project/`.

**Why escalate at synthesis (not at intake, not at Stage 7):**

- At intake, the path choice was an open question with insufficient grounding — I needed the compliance persona's read on whether C-as-permanent is lawful before I could frame the trade-off correctly. It is not.
- The synthesis pass is the moment when I have the personas' grounded inputs but Stage 2 hasn't started building yet — Founder ratification here lets Aryan write the binding plan to one path, not three.
- Deferring to Stage 7 risks a Stage-2 plan written to one path that the Founder then rejects = rework. Worse: a Stage-3 build that Founder rejects = much more rework. Synthesis is the right gate per the same precedent set on Child-1 (DPDP escalation at synthesis, not at Stage 7) and Child-3 (custody Option A/B at synthesis).
- Under my rubric (system-prompt + cto-advisor.md): a Founder-priced trade-off that the personas + canon cannot resolve = `/escalate`. ✅ matches.

**Default if Founder does not respond before Stage 2 starts:** Stage 2 proceeds on **Path C with exit deadline = Path B completion date** (my recommendation). Aryan binds the runbook + shim shape to Path C; if Founder later picks A2, Stage 2 amends with a decision-logged plan revision (not a hard rework — the runbook outline transfers; STEP 3's shim shape changes; the rest of the binding contract is path-agnostic).

**Effect:** `build_gated_on` = CF-CUT-PATH-1 (Founder ratification of path choice on record before Stage-3 build authorization). Stage 2 PROCEEDS in parallel on the default path (C) so Aryan does not sit idle.

---

## 5. Headline Stage-2 obligations for Aryan (the synthesis hand-off)

1. **(CRITICAL, headline, blocked on Founder ratification) Pick the path.** Default for Stage-2 design = **Path C with exit deadline = Path B completion date**. If Founder rules differently via `/escalate` response, Stage-2 plan amends. *(CF-CUT-PATH-1.)*
2. **(CRITICAL) Bind the STEP-5 real-path + kill-test pair.** Plan names: the actual legacy HTTP endpoint exercised by STEP 5 (with capture mechanism — `curl -i` to a captured file); the kill-test fixture; the inverse-mutant fixture; the staging-clone rehearsal commands that produce `staging-rehearsal/{step5-kill.txt,step5-inverse.txt}`; the binding that Stage-5 reviews verbatim and Stage-6 re-mutates on disk per durable-rule sub-rule 7. *(CF-CUT-VERIFY-THE-VERIFIER-1.)*
3. **(HIGH) Bind atomic rollback ordering.** `down.sql` BEFORE bypass-revoke; third kill-test on staging captures wrong-order outage; measured time-to-rollback becomes live SLO. *(CF-CUT-ROLLBACK-ATOMIC-1.)*
4. **(HIGH) Bind in-flight HTTP drain.** Recommended (a): legacy off LB → `pg_stat_activity` drain confirmation → bypass grant → FORCE → smoke → back on LB. Runbook STEP 1.5 (NEW) scripts it. *(CF-CUT-DRAIN-1.)*
5. **(HIGH) Reconcile Shiprocket gate.** Runbook STEP 0.7 (NEW) quiesces Shiprocket; pre-cutover corrected Brain-native bare-write grep = ZERO captured; Stage-2 plan documents the Founder-ratified narrowing of `CF-C3-FORCE-UNLOCK-SCOPE-1`. *(CF-CUT-SHIPROCKET-RECONCILE-1.)*
6. **(HIGH) Bind staging-clone residency.** Runbook STEP 0.5 (NEW) asserts ap-south-1 on staging clone OR explicit synthetic-only tag + generator artifact. *(CF-CUT-RESIDENCY-1.)*
7. **(HIGH) Bind bypass audit shape.** Per-create/remove Brain Decision-Log + structured Postgres `log_statement` to `bypass_query_log` keyed by `workspace_id` (NOT raw text); §12-scopable. *(CF-CUT-BYPASS-AUDIT-1.)*
8. **(HIGH) Draft DPDP §7 addendum.** Enumerate (1) live FORCE-flip execution, (2) live CF-SEC-1 probe execution, (3) creation+use of legacy bypass (Path C only), (4) STEP-5 smoke against legacy HTTP path as covered transitional acts under Founder-as-controller-of-Sugandh-Lok. Founder signs at Stage 7/8 BEFORE Stage-8 STEP 5. *(CF-CUT-DPDP-ADDENDUM-1.)*
9. **(MEDIUM) Bind idempotency of STEP 3.** Per chosen path's shape. *(CF-CUT-IDEMPOTENT-1.)*
10. **(MEDIUM) Document calendar constraint** in writing in the runbook header. *(CF-CUT-CALENDAR-1.)*

**Plan-template guidance:** the architecture plan MUST carry a "High-stakes Gate Inventory" section per the durable rule's follow-on guidance, with each of CF-SEC-1, STEP-5 legacy-smoke, and rollback-ordering listed as a gate with its real-path test name, kill-test name, and captured-mutant output location.

---

## 6. Folded binding contract carried to Stage 2 (full CF-* list)

**Inherited (Child-1, MERGED, HOLD-AT-FORCE — carry unchanged):**

- **CF-RES-1.a** — region `ap-south-1` asserted on BOTH pooled (`:6543`) + direct (`:5432`) at runbook STEP 0; Postgres-level.
- **CF-SEC-1** — fail-closed RLS probe (live this slice): cross-workspace = 0, context-less = 0, same-workspace = expected non-zero. Probe runs as `rls_app` (rolbypassrls=false), NOT as superuser or bypass role.
- **CF-SEC-3.HARD** — inherited; not re-triggered this slice. Re-arm boundary mechanized via bypass audit log + post-flip operator grep.
- **CF-SEC-5** — correlation 4-tuple (no new Brain runtime in this slice).
- **CF-C1-POOL-1.a** / **CF-C1-RLS-DEFAULT-1.a** / **CF-C1-CRON-SCOPE-1.a** / **CF-C1-AUDITLOG-1.a** — `withWorkspace()` + policy shapes + cron fan-out + dual-policy unchanged.
- **CF-C1-ROLLOUT-ORDER-1 (SHARPENED by CF-CUT-DRAIN-1)** — quiesce-crons + drain HTTP first at ENABLE *and* FORCE.
- **CF-C1-ZERO-BEHAVIOR-1** — byte-identical live API behavior pre/post.
- **CF-BN-NOLEGACY-1** — zero legacy code edits. Bars Path A1.

**New / Sharpened this slice:**

- **CF-CUT-PATH-1 (CRITICAL, ESCALATED)** — Founder picks {C-with-deadline, A2}. Default for Stage-2 design = Path C with exit deadline = Path B completion date.
- **CF-CUT-RUNBOOK-AUG-1 (CRITICAL)** — extend `apps/core-service/migrations/manual/rls/rollout-runbook.sh` with STEP 0.5 (staging-clone residency), STEP 0.7 (Shiprocket quiesce), STEP 1.5 (legacy off LB + drain), STEP 3 (apply shim), STEP 5 (real-path legacy HTTP smoke); preserve existing STEPs; idempotent; atomic rollback per CF-CUT-ROLLBACK-ATOMIC-1.
- **CF-CUT-VERIFY-THE-VERIFIER-1 (CRITICAL)** — STEP-5 real-path + 3 pre-ceremony kill-tests (STEP-5 kill, STEP-5 inverse-mutant, rollback-wrong-order) captured on staging clone; reviewed verbatim at Stage 5; re-mutated on disk at Stage 6 per durable-rule sub-rule 7.
- **CF-CUT-ROLLBACK-ATOMIC-1 (SHARPENED, HIGH)** — `down.sql` BEFORE bypass-revoke; measured time-to-rollback ≤ 60 s on staging = pre-committed live SLO.
- **CF-CUT-DRAIN-1 (SHARPENED, HIGH)** — runbook STEP 1.5: legacy off LB + `pg_stat_activity` drain confirmation ≥ 30 s.
- **CF-CUT-SHIPROCKET-RECONCILE-1 (SHARPENED, HIGH)** — runbook STEP 0.7: Shiprocket quiesced; pre-cutover Brain-native bare-write grep = ZERO; Stage-2 plan documents Founder-ratified narrowing of `CF-C3-FORCE-UNLOCK-SCOPE-1`.
- **CF-CUT-RESIDENCY-1 (SHARPENED, HIGH)** — runbook STEP 0.5: staging clone ap-south-1 (Postgres-level) OR synthetic-only with generator artifact.
- **CF-CUT-BYPASS-AUDIT-1 (SHARPENED, HIGH)** — per-create/remove Brain Decision-Log + structured Postgres `log_statement` to `bypass_query_log` keyed by `workspace_id`; §12-scopable.
- **CF-CUT-DPDP-ADDENDUM-1 (NEW, HIGH)** — Aryan drafts §7 continuity addendum to Child-1 memo; Founder signs at Stage 7/8 BEFORE Stage-8 STEP 5.
- **CF-CUT-IDEMPOTENT-1 (NEW, MEDIUM)** — STEP 3 idempotent per chosen shape.
- **CF-CUT-CALENDAR-1 (SHARPENED, MEDIUM)** — no festival-peak GMV window; Founder owns calendar.

---

## 7. Decision

**ADVANCE → Architect (Aryan), Stage 2.**

**Build gated on:** Founder ratification of `CF-CUT-PATH-1` (path choice between C-with-deadline / A2). Stage 2 proceeds on default = Path C with exit deadline = Path B completion date; if Founder rules A2, plan amends with decision-logged revision.

**State transitions:**

- `state/active.json[feat-tenancy-rls-live-cutover]`: created; status = `architect`; stage = 2; current_owner = `architect`; feature_class = `high-stakes`; trigger_surfaces_touched = `["multi-tenancy", "pii", "india-compliance", "schema-proto", "connectors"]`; needs_personas = `["india-data-isolation-compliance-officer:sonnet", "live-rollout-strangler-realist:sonnet"]`; binding_constraints = the full CF-* list in §6; build_gated_on = `CF-CUT-PATH-1`; armed_escalations_remaining = `[]` (CF-CUT-PATH-1 now FIRED; others resolved at Stage 2).
- `decision-log/2026/05/2026-05-26.jsonl`: appended `stage1-intake` + `stage1-synthesis` entries.
- `pending-founder-attention.md`: appended new `/escalate` block for CF-CUT-PATH-1 + non-blocking heads-up for the OPEN-P0 closure path.

**Next agent:** Aryan (Architect), Stage 2.

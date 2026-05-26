# Persona — live-rollout-strangler-realist:sonnet

> Adversarial ops/strangler-fig review of `feat-tenancy-rls-live-cutover` — runbook augmentation,
> coexistence shim, atomic rollback, in-flight transaction handling, idempotency, and the
> reconciliation with Child-3's `CF-C3-FORCE-UNLOCK-SCOPE-1` (Shiprocket DECOMMISSION + Brain-native
> bare-write grep ZERO + sign-off).
>
> Spawned by Rohan at Stage 1 intake. Mandate per `02-cto-advisor-review.md` §Persona 2 brief.
> ≥1 grounded concern per question, or this review is rejected.

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-live-cutover` |
| **Persona** | `live-rollout-strangler-realist:sonnet` |
| **Timestamp** | 2026-05-26T12:52:00Z |
| **Verdict** | **CONCERNS — 7 ops findings; one is a CRITICAL kill-test for the verify-the-verifier rule** |

---

## Mandate recap

Pressure-test the live-cutover runbook augmentation, the legacy-coexistence shim, atomic rollback, and reconciliation with Child-3's FORCE-unlock gate. Six required questions; concrete answers below.

---

## Concern O1 (HIGH) — STEP 1 quiesces crons but NOT in-flight HTTP requests on the legacy Express app. FORCE against a connection in mid-transaction wedges that connection.

**Finding.** The existing `rollout-runbook.sh` STEP 1 says "Disable ALL cron jobs that write to workspace-scoped tables (legacy cron.ts + syncAll*). Confirm crons are quiesced." It is silent on the legacy Express app's HTTP request path — those are NOT crons; they are user-driven HTTP transactions executed against the same prod DB.

What happens at `ALTER TABLE … FORCE ROW LEVEL SECURITY` while a legacy HTTP request is mid-transaction on a `SELECT … FROM shopify_orders WHERE …`:

- Postgres serializes DDL behind in-flight DML — the `ALTER TABLE` will wait for the in-flight tx to finish OR fail with a lock-timeout depending on `lock_timeout` / `statement_timeout`.
- Once the in-flight tx commits, the `ALTER TABLE` proceeds. The NEXT legacy query on a fresh tx hits the now-FORCEd table — and (under Path C) needs to be hitting the bypass connection identity to succeed.

**Real failure mode:** the legacy Express app uses a connection pool. If only SOME of its pool connections have the bypass-role identity, the moment after FORCE, the non-bypass pool connections 0-row. There is no clean "quiesce HTTP" without one of:

- **(a) Take the legacy app off the load balancer FIRST.** Deterministic but requires LB control + a maintenance-page substitution. Cleanest.
- **(b) Rolling-restart the legacy app pool AFTER bypass is granted but BEFORE FORCE.** Forces every connection to re-authenticate under the new bypass identity. Risky if (b) overlaps with FORCE.
- **(c) Set `lock_timeout = 30s` and accept that the FORCE waits then either succeeds or fails fast.** The simplest but leaves in-flight transactions to either fail or succeed under the OLD policy, with no clean signal to the user.

**Binding constraint (sharpens Rohan's CF-CUT-DRAIN-1):** Aryan must pick one of (a)/(b)/(c) at Stage 2, with binding rationale. My recommendation: **(a)** — legacy app off the LB → wait for in-flight tx to drain (operator-confirmed via a `pg_stat_activity` query the runbook scripts) → bypass grant → FORCE → smoke → legacy app back on LB. STEP 3 in the augmented runbook should be: "operator removes the legacy app's listener from the LB; confirm `pg_stat_activity WHERE application_name LIKE '%legacy%' AND state IN ('active','idle in transaction')` = 0 for ≥ 30s; proceed."

---

## Concern O2 (CRITICAL) — STEP 5's "legacy smoke renders the same row counts" gate is the canonical verify-the-verifier hazard. As drafted, it CAN false-GREEN.

**Finding.** Per durable rule `2026-05-26__verify-the-verifier-mutation-on-gate` (adopted 2026-05-26 by Founder, evidence count = 9 across the migration epic), every high-stakes GATE whose GREEN authorizes an irreversible act needs (i) a real-path test + (ii) a captured killed-mutant. STEP 5's GREEN authorizes the "cutover complete, ready for Founder Stage-7 sign-off" signal — it is exactly the rule's target class.

**The vacuous form of STEP 5:** `psql "$BYPASS_DIRECT_URL" -tAc "SELECT COUNT(*) FROM shopify_orders WHERE …"` — this counts via the bypass role, which by construction sees all rows pre- and post-FORCE, so it always returns the same count. **This is a fake gate** — it never detects an outage in the actual legacy-app HTTP path because it doesn't traverse the legacy app's connection identity or its query path.

**The real form of STEP 5:** call the legacy Express app via its public HTTP endpoint (e.g. `curl https://legacy.brand.com/api/orders?range=last-7d -H "Cookie: $LIVE_SUGANDH_LOK_SESSION"`) and assert the response body's order count is identical pre/post. This exercises the legacy app's authentication, session→workspace_id mapping (which is the thing that must keep working), connection-pool path, and query path.

**Kill-test (the mutant that proves STEP 5 is non-vacuous):** before the cutover ceremony, on the staging clone, run STEP 5 with `ALTER TABLE shopify_orders DISABLE ROW LEVEL SECURITY` (the opposite of FORCE — a no-RLS state). STEP 5 should return the SAME count (because no-RLS = full access). Now apply FORCE WITHOUT the bypass for the legacy connection. STEP 5 MUST now return ZERO or fail (because the legacy connection 0-rows). Now apply the bypass for the legacy connection. STEP 5 returns the original count again.

The kill-test proves STEP 5 is sensitive to the bypass — i.e. its GREEN is load-bearing for the no-outage verdict. Without this kill-test on file, STEP 5's PASS during the live ceremony is inadmissible — could be a fake green.

**Companion inverse-mutant (proves STEP 5 is NOT load-bearing for the LEAK verdict):** with FORCE applied and bypass granted, remove FORCE on ONE table (say `marketing_actions`). CF-SEC-1 probe via `rls_app` should go RED on that table. STEP 5 (legacy app) should STILL PASS (because the legacy app reads via bypass which is RLS-invariant). This proves STEP 5 is purely the no-outage gate; the leak gate is CF-SEC-1, not STEP 5. Two distinct gates, two distinct mutants.

**Binding constraint (sharpens Rohan's CF-CUT-VERIFY-THE-VERIFIER-1):**

- STEP 5 = real legacy HTTP path, NOT a psql double of the bypass role.
- Kill-test captured on staging clone PRE-CEREMONY; output file lives in run folder.
- Inverse-mutant captured on staging clone PRE-CEREMONY; output file lives in run folder.
- Stage-5 QA reviews the captured outputs verbatim.
- Stage-6 (Rohan) re-mutates on disk per sub-rule 7.

**This is the persona's headline concern.** Without it, the slice's verify-the-verifier compliance is decorative, and the durable rule's #10 occurrence would land in production.

---

## Concern O3 (HIGH) — Atomic rollback ordering is ambiguous and the ambiguity creates a 0-row window.

**Finding.** The requirement says "Hardened rollback: `down.sql` MUST drop the policies AND remove the shim atomically, with measured maximum time-to-rollback." Two objects to undo (the policies + the bypass), and Postgres has no cross-DDL transaction for "DROP POLICY + ALTER ROLE" as one atomic act. The ordering matters:

- **If we run `down.sql` first (drop policies + NO FORCE), then revoke the bypass:** there is a window between "policies dropped" and "bypass revoked" where the legacy connection has bypass-power on a now-unprotected table — equivalent to the pre-cutover state. No outage, no extra leak (already at OPEN-P0 baseline).
- **If we revoke the bypass first, then run `down.sql`:** there is a window between "bypass revoked" and "policies dropped" where the legacy connection sees ZERO rows on every still-FORCEd table. **Outage.**

**Binding ordering:** `down.sql` first (drop policies + `NO FORCE`), THEN revoke the bypass. Bind this. The runbook's rollback section MUST execute in this order; any other order is a 0-row outage during the rollback itself.

**Falsifiable test (the third kill-test under CF-CUT-VERIFY-THE-VERIFIER-1):** on the staging clone, artificially run the rollback in the WRONG order and observe the 0-row window. Capture the output. This proves the ordering matters; the test goes RED in the wrong order, GREEN in the right order.

**Time-to-rollback budget.** Target ≤ 60 s on staging clone. `down.sql` is 43 tables × ~3 ops = ~129 DDL statements; on a quiescent Postgres these are millisecond ops. The bypass revoke is one `ALTER ROLE` or one connection-string rotation. 60 s is conservative; 10 s is realistic. Bind the *measured* number from the staging-clone rehearsal as the live ceremony's pre-committed rollback-time SLO.

---

## Concern O4 (HIGH) — Reconciliation with Child-3's `CF-C3-FORCE-UNLOCK-SCOPE-1`: Shiprocket DECOMMISSION is NOT shipped; either FORCE waits or the runbook adds a "Shiprocket quiesced" sub-step.

**Finding.** Child-3 Stage-6 recorded `CF-C3-FORCE-UNLOCK-SCOPE-1` explicitly: "Child-1 FORCE stays HELD until Shiprocket DECOMMISSION + bare-write grep ZERO + sign-off." Reading the predecessor's Child-3 commit doc: Child-3 is staged but the Stage-8 cutover (which includes Shiprocket DECOMMISSION) is HELD; Shiprocket is not decommissioned today.

**The conflict:** if we execute FORCE today without Shiprocket DECOMMISSION, ANY Brain-native consumer that still touches the Shiprocket-related tables via a `bare write` path (e.g. a residual no-context writer that Child-3 didn't convert) 0-rows post-FORCE. Under Path C, the legacy bypass covers the LEGACY connection — but NOT the Brain-native consumers. So `CF-C3-FORCE-UNLOCK-SCOPE-1` is NOT fully waivable by Path C; the Brain-native bare-write grep ZERO requirement still binds.

**Two options:**

- **(a) Sequence: ship Shiprocket DECOMMISSION first, then this cutover.** Adds weeks; the OPEN P0 stays open longer.
- **(b) Augment the runbook with: "STEP 0.7 — Shiprocket connector quiesced for the cutover window" (parallel to STEP 1 cron quiesce) + a corrected bare-write grep on Brain-native code returning ZERO before STEP 5 + a Founder-ratified narrowing of `CF-C3-FORCE-UNLOCK-SCOPE-1` to "Shiprocket reads quiesced during cutover; full DECOMMISSION as a separate slice."**

**Recommendation:** (b), gated on the corrected bare-write grep returning ZERO. This is a Stage-2 decision Aryan owns; he must produce the corrected grep and run it pre-cutover. The runbook's existing STEP 5 hold-conditions already name this grep — the Stage-2 augmented runbook just needs to re-bind it.

**Binding constraint (sharpens Rohan's CF-CUT-SHIPROCKET-RECONCILE-1):** runbook STEP 0.7 = Shiprocket connector quiesced; pre-cutover Brain-native bare-write grep returns ZERO; Founder-ratified narrowing of `CF-C3-FORCE-UNLOCK-SCOPE-1` documented in the Stage-2 plan. Without all three, FORCE waits for Shiprocket DECOMMISSION.

---

## Concern O5 (MEDIUM) — Runbook idempotency: STEP 3 (apply shim) and the bypass grant MUST be re-runnable.

**Finding.** If STEP 3 fails mid-way and the operator re-runs the runbook from STEP 0, the bypass-grant statement (e.g. `GRANT BYPASSRLS ON ROLE …` or `ALTER ROLE … BYPASSRLS`) is naturally idempotent (the grant is a state, not a delta). Good. But:

- The connection-string rotation form of the bypass (if Aryan picks that shape instead of a role flag) is NOT trivially idempotent — re-running could rotate to a third connection string. Bind: the connection-string form must include a check-then-set guard.
- STEP 1 (quiesce crons) — if the operator re-runs after STEP 1 already disabled crons, the second run should be a confirmation no-op, not an error. Current runbook uses operator `confirm` — already idempotent. Good.
- STEP 5 (smoke) — pure read, naturally idempotent. Good.
- `down.sql` — already idempotent (`DROP POLICY IF EXISTS`, `NO FORCE`/`DISABLE` are idempotent). Good.

**Binding constraint:** STEP 3 must be idempotent for the chosen bypass shape. If `ALTER ROLE` flag: trivially. If connection-string rotation: check-then-set guard.

---

## Concern O6 (MEDIUM) — Maintenance-window calendar constraint: inherited from Child-7; binding.

**Finding.** Child-7 informational heads-up: "festival-window note: the irreversible cutovers + DB shutdown must not be scheduled in a festival peak GMV window (maximum blast radius)." This slice is structurally identical to that constraint: a brief maintenance window with measurable rollback budget. Sugandh-Lok is the live brand; festival windows (Diwali / Republic-Day-sale / EOSS) are the GMV peaks; a 0-row outage during those windows = maximum-blast-radius incident.

**Binding (sharpens Rohan's CF-CUT-CALENDAR-1):** the runbook documents the constraint in writing ("DO NOT execute during a festival-peak GMV window; Founder owns the calendar"). The Founder picks the date as a Stage-7/8 ratification.

---

## Concern O7 (MEDIUM — informational) — One nit on the predecessor runbook's STEP 0 region assertion.

**Finding.** The existing STEP 0 (lines 41-66 of `rollout-runbook.sh`) asserts ap-south-1 via "operator confirmation against the Supabase project console." That's reasonable for the predecessor's Stage-8 ceremony but is NOT a Postgres-level assertion — it's a human assertion. CF-RES-1.a as bound says "Postgres-level, never DNS-trusted."

**Recommendation (non-blocking for this slice, optional sharpening):** add a Postgres-level region check, e.g. `SELECT current_setting('cluster_name')` or `SELECT current_setting('TimeZone')` and assert against an expected value, OR query `pg_stat_database` for the cluster ID and assert. This is a tightening of the inherited gate, not a new constraint. Aryan can decide whether to land it in this slice or leave it for the next.

**Why MEDIUM not HIGH:** the existing operator-confirmation is sufficient for the slice's compliance posture (the operator IS the Founder, who knows which region the Supabase project is in). The tightening would only matter if a non-Founder operator ever runs this. For this slice's Founder-at-console ceremony, the existing form is adequate.

---

## Summary of concerns

| # | Sev | Concern | Disposition |
|---|-----|---------|-------------|
| O1 | HIGH | STEP 1 doesn't drain in-flight legacy HTTP transactions; recommend "off the LB first + `pg_stat_activity` drain confirmation" | Sharpens Rohan's CF-CUT-DRAIN-1; Aryan picks (a)/(b)/(c) at Stage 2 |
| O2 | **CRITICAL** | STEP 5 is the canonical verify-the-verifier hazard — vacuous form (bypass psql double) false-GREENs; real form (legacy HTTP path) + kill-test + inverse-mutant required | Sharpens Rohan's CF-CUT-VERIFY-THE-VERIFIER-1; binding Stage-2/3/5/6 |
| O3 | HIGH | Atomic rollback ordering: `down.sql` BEFORE bypass-revoke; the wrong order creates a 0-row outage during rollback | Sharpens Rohan's CF-CUT-ROLLBACK-ATOMIC-1; third kill-test on staging |
| O4 | HIGH | Reconciliation with `CF-C3-FORCE-UNLOCK-SCOPE-1`: Shiprocket DECOMMISSION not shipped; runbook needs STEP 0.7 (Shiprocket quiesced) + corrected bare-write grep = ZERO + Founder-ratified gate narrowing | Sharpens Rohan's CF-CUT-SHIPROCKET-RECONCILE-1; Stage-2 binding |
| O5 | MEDIUM | STEP 3 bypass-grant must be idempotent for the chosen shape | Stage-2 binding |
| O6 | MEDIUM | Calendar constraint inherited from Child-7; no festival-peak GMV window | Sharpens Rohan's CF-CUT-CALENDAR-1; Founder owns date |
| O7 | MEDIUM-info | STEP 0 region assertion is operator-confirmation, not Postgres-level; tightening optional in this slice | Non-blocking; Aryan's call |

---

## Recommended-`/escalate` to Rohan

**No `/escalate` recommended from this persona.** O1-O7 are all Stage-2/3 binding constraints resolvable within Aryan + Vikram's scope. The only Founder-trade-off in this slice (path choice) was already flagged by persona 1 (compliance) and Rohan can fold both inputs into the synthesis-time `/escalate` decision.

**Note on the `chore-security-governance-hardening-phase` WS-1 ordering question** (open question #4 in the requirement): I do not see a binding conflict. WS-1 is about Secrets Manager + credential rotation; this slice is about RLS + connection-identity. They share the live-prod-DB blast radius (so don't schedule them on the same day) but are technically independent. No escalation needed — Founder picks the order on operational convenience.

---

## Signed

`live-rollout-strangler-realist:sonnet` — 7 grounded concerns surfaced; 1 CRITICAL (O2, verify-the-verifier hazard on STEP 5); 0 escalations recommended; binding constraints sharpened for CF-CUT-DRAIN-1 / CF-CUT-VERIFY-THE-VERIFIER-1 / CF-CUT-ROLLBACK-ATOMIC-1 / CF-CUT-SHIPROCKET-RECONCILE-1 / CF-CUT-CALENDAR-1.

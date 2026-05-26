# Persona — india-data-isolation-compliance-officer:sonnet

> Adversarial compliance review of `feat-tenancy-rls-live-cutover` against DPDP Act 2023 + Rules 2025
> (§4 lawful basis, §8(6) penalty exposure, §12 erasure scope, §16 cross-border transfer).
> Spawned by Rohan at Stage 1 intake. Mandate per `02-cto-advisor-review.md` §Persona 1 brief.
>
> Rule of engagement: ≥1 grounded concern per question, or this persona's review is rejected.
> Sole-authority `/escalate` deferred to Rohan; this persona may *recommend* escalation only.

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-live-cutover` |
| **Persona** | `india-data-isolation-compliance-officer:sonnet` |
| **Timestamp** | 2026-05-26T12:50:00Z |
| **Verdict** | **CONCERNS — Stage-2 actionable; one Founder-trade-off recommended for `/escalate` at synthesis** |

---

## Mandate recap (from Rohan's brief)

Audit the live-cutover plan against DPDP §4 / §8(6) / §12 / §16, the residency assertion at runbook STEP 0, and the residual-leak surface introduced by Path C's service-role-style bypass for the legacy connection. Five required questions; concrete answers below.

---

## Concern C1 (HIGH) — Path C's bypass is NOT lawful as a permanent state under DPDP §4. It needs an exit deadline + a documented authorization or it becomes a §8(6) exposure.

**Finding.** DPDP §4(1)(a) requires processing of personal data to be for a "lawful purpose for which the Data Principal has given her consent or for certain legitimate uses." A standing service-role-style bypass on the legacy connection — meaning the legacy app, by virtue of its connection identity, reads ALL workspaces' PII — is not a *purpose-bound* processing surface; it is an architectural dispensation that lets the legacy app read *anything* the DB contains. As a permanent state, this is materially weaker than the Brain-native `rls_app` story (workspace-scoped, purpose-bound).

It IS defensible as a **time-bounded transitional dispensation** under §7 legitimate-use continuity (the basis the Founder already ratified for Child-1's migration acts on 2026-05-24), PROVIDED the dispensation has:

1. **A named, narrowly-scoped connection identity** — one role, one connection-string, grep-provable as the ONLY consumer. NOT a wildcard, NOT a role family.
2. **An exit deadline** linked to a Founder-ratified Path-B completion date (or equivalent: e.g. "Brain web parity reaches X bar on date Y; legacy app retired by date Z; this bypass is REVOKED on date Z+0 days").
3. **An audit form** that records bypass usage (see C5 below for the form).
4. **A "second-brand" tripwire** — the moment a non-Sugandh-Lok brand's PII enters the legacy app's read path (i.e. the legacy app serves a second workspace), the bypass exposure widens beyond Founder-as-controller-of-own-brand justification.

**As a permanent state, Path C is NOT lawful** — it would re-introduce the same OPEN-P0 leak surface for the legacy connection that we're closing for every other connection.

**Trade-off — Founder-only, recommended for `/escalate` at synthesis.** Either:

- **(A) Path C with a hard exit deadline = Path B completion date** (recommended; closes the leak now for every NEW consumer, narrows it to one named identity with a deadline). My read: defensible under §7-style transitional continuity for the time-bounded interval.
- **(B) Wait for Path B** — leak window stays open until parity + customer cutover (weeks). My read: not defensible under §8(6) — Founder has been on notice of the OPEN P0 since 2026-05-24 and the §8(6) exposure compounds with notice-time.
- **(C) Path A2** (pgbouncer custom auth) — most cleanly DPDP-compliant (workspace-scoped on the legacy side too), but persona 2 should weigh the infra-blast-radius before accepting.

**The Founder trade-off is between "narrow transitional bypass with deadline" (defensible) vs "wait" (NOT defensible).** I recommend Rohan `/escalate` this at synthesis with the framing "Founder picks {C-with-deadline, A2}. Path B-as-immediate-close is canon-incompatible with the §8(6) notice timeline."

---

## Concern C2 (HIGH) — CF-SEC-3.HARD does NOT re-trigger at this cutover, BUT a Founder-signed §7 continuity addendum naming the live FORCE-flip + legacy bypass should be on record before STEP 5 executes.

**Finding.** CF-SEC-3.HARD is "DPDP lawful-basis instrument required before processing third-party-brand PII." The cutover ceremony itself is Sugandh-Lok-only (the only live brand using the legacy frontend, per project memory). So **CF-SEC-3.HARD does not re-trigger** — Founder-as-controller-of-Sugandh-Lok continues to cover the §4 processing acts.

**However:** the CF-SEC-3.HARD memo on record (drafted at Child-1, ratified 2026-05-24) names "RLS-policy application + CF-SEC-1 probe queries + any `workspace_id` denormalization backfill" as the in-scope processing acts. The acts in THIS slice are different and additional:

1. **Live execution of FORCE ROW LEVEL SECURITY** on the prod DB (a §4 act in the broad sense — it changes how PII is accessed).
2. **Live CF-SEC-1 probe execution** against PII rows (`Invitation.email`, `ShopifyCustomer.email`, etc.).
3. **Creation + use of the legacy-connection bypass** (Path C only).
4. **STEP 5 smoke** — calling the legacy HTTP path against live PII.

**Recommendation:** before STEP 5 execution, the Child-1 §7 memo needs a short **addendum** explicitly listing (1)–(4) as covered transitional acts under the same Founder-as-controller-of-Sugandh-Lok basis. This is NOT an escalation (Founder owns Sugandh Lok, the basis is the same), but it IS a paperwork act the Founder should sign before Stage 8. Aryan owns producing the addendum draft at Stage 2; Founder signs at Stage 7 / Stage 8.

**Falsifiable test for the re-arm boundary:** if at any point during the cutover the legacy app's bypass is exercised on behalf of a workspace other than the canonical Sugandh-Lok workspace UUID, CF-SEC-3.HARD re-arms and FORCE must roll back. Mechanize as: the bypass audit log (see C5) MUST have `workspace_id = $SUGANDH_LOK_UUID` for every entry during the cutover window; any other workspace_id triggers the rollback. The Brain runtime is not yet live to mechanize this; for the live ceremony, mechanize as a post-flip grep against the legacy app's request log + bypass audit, performed by the operator before exiting the ceremony.

---

## Concern C3 (MEDIUM) — §4 lawful basis for the LIVE CF-SEC-1 probe execution is covered by the Child-1 memo, but the addendum from C2 should explicitly include it.

**Finding.** The CF-SEC-1 probe queries PII rows to assert zero-row return for cross-workspace and context-less reads. The Child-1 §7 memo already names "CF-SEC-1 probe queries" as in-scope; the LIVE execution of that probe was deferred to Stage 8 in Child-1 and lands now. The basis carries forward — the same memo authorizes the live execution. The addendum in C2 should re-state this for clarity.

**Concrete artifact:** `…/feat-tenancy-auth-rls-hardening/dpdp-lawful-basis-memo-DRAFT.md` §8 (per `pending-founder-attention.md`). Aryan should reference this in the Stage-2 plan.

**No new escalation.** This concern resolves at Stage 2 via the addendum.

---

## Concern C4 (HIGH) — DPDP §16 cross-border-transfer hazard: the STAGING CLONE must be in ap-south-1 OR use synthetic data only.

**Finding.** The requirement's "Verify-before-report" section says: "Staging: provision a staging clone of the live DB (or use a CDC snapshot in `brain_test`); run the FULL augmented runbook against it." This is the right test discipline, but the clone is **PROD PII at rest** by construction. If the clone is provisioned in any region OTHER than `ap-south-1`, the act of provisioning the clone is itself a §16 cross-border transfer of personal data — a separate compliance act from the FORCE flip.

**Two acceptable forms:**

- **(a) Staging clone in ap-south-1.** Same region, no §16 transfer. Costs more but simplest.
- **(b) Synthetic data only in `brain_test`** — the schema + a deterministic generator that NEVER reads from prod PII, with the generator's output marked as test-only (no `@brand` emails, etc.). The augmented runbook runs against this synthetic DB.

**Inadmissible form:** provisioning a clone in any region outside ap-south-1 with PROD PII included.

**Binding constraint (recommend Rohan bind at synthesis as a sharpened form of CF-CUT-RESIDENCY-1):** the staging-clone provisioning step in the runbook MUST assert region == ap-south-1 if PROD PII is present, OR explicitly tag the staging DB as synthetic-only with a generator artifact in the run folder.

**No `/escalate` at intake** — this is a Stage-2/3 binding constraint, fully resolvable by Aryan + Vikram.

---

## Concern C5 (HIGH) — The bypass audit log itself must be DPDP §12 erasure-scopable, mirroring Child-7's CF-C7-DPDP-ERASURE-1 framing.

**Finding.** If Path C ships with a service-role-style bypass for the legacy connection, the **fact of bypass usage** is itself information that should be auditable (per C1's exit-deadline requirement and per CF-SEC-1 traceability). Two questions:

1. **Granularity.** Per-use Decision-Log (every legacy query that hits a workspace-scoped table) OR per-create/remove only (one entry when the bypass is granted, one when it's revoked)?

   - **Per-use** is the right answer for completeness, BUT the legacy Express app's query volume could be 10⁶/day for a busy workspace — a Decision-Log row per query is operationally infeasible without changes to the legacy app (which is barred by `feedback_legacy_is_reference_only.md`).
   - **Per-create/remove** is operationally feasible and is the standard PostgreSQL `ALTER ROLE` audit shape — but it loses per-query attribution.

   **Recommended split:** per-create/remove in the Brain Decision-Log + per-query attribution via Postgres `log_statement = 'all'` on the bypass role's connection (a Postgres-level setting, no legacy code change), with the resulting `postgresql.log` shipped to the Brain audit store. This satisfies the audit goal without touching legacy code.

2. **§12 erasure-scopability.** The audit log records workspace IDs + query patterns that touch PII rows. If a Data Principal exercises §12 erasure rights, the audit log entries that reference that principal's workspace_id must be erasure-scopable. Per-create/remove entries: trivially scopable (delete WHERE workspace_id = $X). Postgres statement log: the log is text — same trap as Child-7's `pg_dump` archive (not per-data-principal erasure-scopable without re-architecting).

**Recommendation (Aryan binds at Stage 2):** the audit log shape is per-create/remove in Brain Decision-Log + structured Postgres statement log (one row per query, columns: `ts`, `workspace_id`, `connection_id`, `statement_class`) — NOT raw text. This makes the statement log §12 erasure-scopable by `DELETE WHERE workspace_id = $X`. The bypass's lifetime is bounded by C1's exit deadline, so the statement-log retention is bounded too.

**Binding constraint (sharpens Rohan's CF-CUT-BYPASS-AUDIT-1):** bypass audit = (per-create/remove Brain Decision-Log) + (per-query structured Postgres statement log, §12-scopable by `workspace_id`).

---

## Summary of concerns

| # | Sev | Concern | Disposition |
|---|-----|---------|-------------|
| C1 | HIGH | Path C bypass not lawful as permanent state under §4; needs exit deadline + narrow scope + audit + second-brand tripwire | Recommend Rohan `/escalate` the path trade-off at synthesis (Founder picks {C-with-deadline, A2}; B is not §8(6)-defensible given notice timeline) |
| C2 | HIGH | CF-SEC-3.HARD does NOT re-trigger, BUT a §7 continuity addendum to the Child-1 memo must explicitly list the live FORCE-flip + probe + bypass + STEP-5 smoke as covered transitional acts before STEP 5 | Aryan drafts addendum at Stage 2; Founder signs at Stage 7/8 |
| C3 | MEDIUM | §4 lawful basis for LIVE CF-SEC-1 probe execution is covered by Child-1 memo; addendum should re-state for clarity | Folded into C2's addendum |
| C4 | HIGH | DPDP §16: staging clone MUST be ap-south-1 OR synthetic-only; non-ap-south-1 clone of PROD PII = §16 transfer | Sharpens Rohan's CF-CUT-RESIDENCY-1; binding at Stage 2/3 |
| C5 | HIGH | Bypass audit log itself must be §12 erasure-scopable; recommended shape = per-create/remove Decision-Log + structured Postgres statement log keyed by workspace_id | Sharpens Rohan's CF-CUT-BYPASS-AUDIT-1; binding at Stage 2 |

---

## Recommended-`/escalate` to Rohan (sole-authority `/escalate` is Rohan's)

**Recommend FIRE at synthesis: `CF-CUT-PATH-1`.** The Founder trade-off between (A) Path C with hard exit deadline = Path B completion date, vs (C) Path A2 (pgbouncer custom auth), is a Founder-only call. Path B-as-immediate-close is canon-incompatible with §8(6) notice-time exposure. A1 is barred by `feedback_legacy_is_reference_only.md`.

The personas + canon cannot resolve this without a Founder-priced trade-off (residual-bypass exposure vs infra blast radius vs leak-window duration). My read: Path C-with-deadline is the right answer, but it must be a Founder ratification, not a Rohan synthesis call.

---

## No-action items (informational)

- The Founder-as-controller-of-Sugandh-Lok memo on record (Child-1) covers this slice's §4 acts with the C2 addendum. No third-party DPA needed.
- §11 Grievance Officer / §12 erasure-channel: not in scope for this slice (Sugandh-Lok-only; Founder is also Grievance Officer of his own brand).
- §6 (notice to Data Principals) for the cutover itself: not legally required — the cutover does not change the purpose or scope of processing visible to the Data Principal; it tightens an internal storage-layer control. Optional courtesy note to Sugandh-Lok end-users via the legacy frontend if there's a maintenance-window message.

---

## Signed

`india-data-isolation-compliance-officer:sonnet` — 5 grounded concerns surfaced; 1 escalation recommended; binding constraints sharpened for CF-CUT-PATH-1 / CF-CUT-RESIDENCY-1 / CF-CUT-BYPASS-AUDIT-1 / CF-SEC-3.HARD addendum.

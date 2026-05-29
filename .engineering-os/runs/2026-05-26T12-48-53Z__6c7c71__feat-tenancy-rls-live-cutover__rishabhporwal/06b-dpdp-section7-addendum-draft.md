# DPDP §7 Continuity Addendum — `feat-tenancy-rls-live-cutover`

> **Status: UNSIGNED DRAFT.** Drafted by Aryan (architect) at Stage 2 per
> `CF-CUT-DPDP-ADDENDUM-1` (Stage-1 synthesis §5 item 8). Founder signs at
> Stage 7/8 BEFORE Stage-8 STEP 5 executes (i.e. before the live FORCE flip).
>
> **This addendum EXTENDS the Child-1 §7 memo** (`.engineering-os/runs/2026-05-24T07-23-52Z__654a53__feat-tenancy-auth-rls-hardening/dpdp-lawful-basis-memo-DRAFT.md`, ACCEPTED via Founder Decision 2026-05-24). It does not replace that memo; it
> covers four additional transitional acts under the SAME §7 legitimate-use /
> §8(2) processor-continuity basis the Founder already ratified.
>
> **⚠️ Not legal advice.** Drafted by the engineering pipeline for the Founder.
> Recommend review by qualified Indian data-protection counsel before relying on
> it for an enterprise/anchor-customer security review.

| Field | Value |
|-------|-------|
| **Instrument type** | §7 continuity addendum extending Child-1 lawful-basis memo |
| **Covers requirement** | `feat-tenancy-rls-live-cutover` (Child-1 follow-on of epic `chore-migrate-legacy-to-brain`) |
| **Satisfies gate** | `CF-CUT-DPDP-ADDENDUM-1` (HIGH; binding pre-condition for Stage-8 STEP 5 execution) |
| **Builds on** | Child-1 §7 memo (Founder Decision 2026-05-24); same lawful-basis chain |
| **Governing law** | Digital Personal Data Protection Act, 2023 (India) + DPDP Rules, 2025 |
| **Data location** | `ap-south-1` (Mumbai) — re-confirmed at runbook STEP 0 + STEP 0.5 (staging-clone residency) |
| **Signed by** | _(Founder — Rishabh Porwal) — UNSIGNED IN DRAFT_ |
| **Date** | _(to be set at signing — Stage 7/8 ratification, BEFORE Stage-8 STEP 5)_ |
| **Review-by date** | **Superseded automatically when Path B (legacy retirement) ships AND the per-brand Sugandh Lok DPA from Child-1 §6.2 is executed.** Otherwise re-reviewed within 90 days of signing. |

---

## 1. Parties & roles (carried unchanged from Child-1 §1)

1.1 **Brain** (operated by Pipada Capital) is a Data Processor under DPDP §2(k)/§8(2).
1.2 **Sugandh Lok** is the Data Fiduciary for its own customers' personal data,
of which the Founder is the legal owner and authorized controller (per Child-1
§8 attestation).
1.3 No third-party brand's PII is in scope at the time of signing this addendum
(Sugandh-Lok-only basis carries forward; the second-brand tripwire in §6.5 below
mechanizes the re-arm boundary).

---

## 2. Personal data in scope (carried + sharpened from Child-1 §2)

This addendum expressly covers Brain processing of the same in-scope personal
data named in Child-1 §2 — `Invitation.email`, `ShopifyCustomer` PII (`email`,
`firstName`, `lastName`, address fields on `WoocommerceOrder` /
`ShiprocketShipment`), `User` (email, name) — during the four additional
transitional acts in §3 below. **No new PII categories** are introduced by this
addendum.

No card numbers, CVV, full UPI IDs, bank accounts, Aadhaar, or passwords are in
scope (Brain does not store these — canon §21.1 / PCI SAQ-A posture).

---

## 3. The four additional processing acts being authorised (this slice only)

This addendum extends the Child-1 §3 acts (RLS-policy application + CF-SEC-1
probe + denorm backfill) with the following four:

### Act A — Live execution of `FORCE ROW LEVEL SECURITY`

The runbook STEP 5 executes `step-b-force.sql` against the live Postgres,
applying `ALTER TABLE … FORCE ROW LEVEL SECURITY` to the 44 workspace-scoped
tables. This is a DDL operation that **changes how PII is *accessed* but does
not read or transmit PII content**. It is a control-strengthening act: post-FORCE,
non-bypass connections receive ZERO rows on cross-workspace queries (the leak
surface that motivates this whole slice).

**§4 lawful basis:** §8(2) processor-continuity — the act is internal technical
isolation hardening of the same processing the Data Fiduciary engaged Brain for.
No new purpose. **Privacy-enhancing**: closes the OPEN P0 cross-tenant leak at
the storage layer.

### Act B — Live CF-SEC-1 probe execution (via `rls_app` role)

Runbook STEP 4 + STEP 6 execute the CF-SEC-1 fail-closed probe against the live
PII rows (e.g. `Invitation.email`, `ShopifyCustomer.email`) **solely to prove
tenant isolation works** (deny-by-default). The probe `SELECT`s a small number
of rows for each of 44 tables, asserts the count is ZERO for cross-workspace
and context-less reads, and discards the results. **The probe MUST run as the
non-bypass `rls_app` role** for its GREEN to be meaningful (per architecture
plan §3 + §6 Gate G1).

**§4 lawful basis:** Child-1 §3.2 already enumerated "the `CF-SEC-1` RLS probe"
as in-scope; this addendum re-states for clarity that the LIVE execution
(deferred from Child-1) lands now. Same basis: §8(2) + minimisation (only the
rows necessary to verify isolation; nothing retained, nothing transmitted).

### Act C — Creation + use of the legacy-connection bypass (Path C)

The runbook STEP 3.5 executes `ALTER ROLE postgres.<tenant_id> BYPASSRLS` (per
architecture-plan §3 + Founder ratification 2026-05-26T16:00:00Z of Path C with
exit deadline = Path B completion). The bypass allows the legacy Express/Prisma
app to continue reading `workspace_id`-scoped tables during the bounded
transitional interval between the FORCE flip and Path B (legacy retirement).

**§4 / §7 lawful basis** (this is the act with the residual surface):

(C.1) **§7 transitional / processor-continuity dispensation.** The Brain
processing on behalf of the Data Fiduciary (Sugandh Lok) continues without
interruption through the cutover; the bypass exists *only* to prevent a
0-row outage to the same Data Principals (Sugandh Lok customers) whose
service-of-record (the legacy app's analytics frontend) is being preserved
during the migration to the Brain-native runtime.

(C.2) **Narrow scope.** The bypass applies to ONE explicitly-named role
(`postgres.<tenant_id>`), grep-proven as the sole legacy consumer at runbook
STEP 2.7 (`staging-rehearsal/live-role-inventory.txt`). Tripwire
`CF-CUT-IDENTITY-AUDIT-1` fires if a second bypass role is detected;
tripwire `CF-SEC-3.HARD` re-arm (mechanized at STEP 6 + §6.5 below) fires if a
non-Sugandh-Lok workspace_id ever appears in the bypass query log.

(C.3) **Time-bounded.** The bypass is revoked at the Path B (legacy retirement)
completion date. The runbook header documents the deadline in writing. The
Brain Decision-Log entry at STEP 3.5 records `granted_until = "Path-B-
completion-date"`. Path B is on its own Stage-8 timeline; until that ships,
the bypass is a known, audited, scoped, time-limited dispensation.

(C.4) **Audited.** Two audit channels (CF-CUT-BYPASS-AUDIT-1):
- **Brain Decision-Log** (`ai.decision_log`) — per-create and per-remove of
  the bypass. Columns: `ts`, `actor`, `connection_identity`,
  `granted_until`, `decision_basis`.
- **Structured Postgres statement log** → `bypass_query_log` table
  (workspace_id, application_name, statement_class — NOT raw text). §12
  erasure-scopable by `DELETE WHERE workspace_id = $X`. Retention bounded by
  the bypass-revoke date.

(C.5) **Defensible under §7 only because of (C.1)-(C.4).** A standing,
unaudited, unbounded bypass would NOT be defensible under §4. The four
controls above are what make the dispensation lawful for the bounded
interval.

### Act D — STEP-5 real-path legacy HTTP smoke

The runbook STEP 5 executes a real legacy HTTP request (`curl -i
"$LEGACY_BASE_URL$STEP5_ENDPOINT" -H "Cookie: $LIVE_SUGANDH_LOK_SESSION"`) with
a valid Sugandh-Lok session cookie, both pre-FORCE and post-FORCE, asserting
that the response body's row count is identical. The endpoint is chosen by the
builder at Stage 3 per the architecture plan §6a procedure (Vikram inspects the
legacy route table read-only; selects a stable, countable endpoint).

The HTTP path traverses the Sugandh-Lok session's PII (the session cookie
itself is PII attached to the Founder's own brand user). The act reads the
PII row set that the legacy endpoint would have returned to that session
*anyway* — i.e. it does NOT expand the access surface; it merely exercises
the existing access path to prove it still works under FORCE+bypass.

**§4 lawful basis:** §8(2) processor-continuity (the legacy endpoint is the
Data Fiduciary's own service-of-record, exercised by the Founder-as-controller).
Minimisation: ONE endpoint, ONE session, captured to one file
(`staging-rehearsal/step5-green.txt`); no PII forwarded outside the operator's
shell session.

---

## 4. Lawful basis summary (DPDP)

4.1 **Primary basis — §8(2) processor-under-contract continuity.** All four acts
(A-D) are internal technical control acts performed by Brain as Processor on
behalf of the Sugandh Lok Data Fiduciary, in continuation of the existing
analytics processing. No new purpose; no new disclosure; no new transfer.

4.2 **Supporting basis — §7 legitimate-use / purpose continuity.** The acts
fall within the purpose for which the Data Principals provided their data to
the Data Fiduciary (analytics-service operation) and for which the Data
Fiduciary engaged Brain. The transitional bypass (Act C) is the §7 instrument
that bridges the FORCE flip to Path B legacy retirement.

4.3 **Privacy-enhancing direction.** Acts A + B materially **reduce** the
existing OPEN P0 cross-tenant leak surface for every non-bypass connection
(Brain `rls_app`, future services, any new consumer). Act C preserves the
status-quo (pre-cutover) access surface for ONE explicitly-named legacy role,
scoped/audited/deadlined per §3 Act C. Act D verifies (A+C) deliver
zero-customer-outage. **Net direction: PII risk DECREASES** for every Data
Principal whose data the leak surface previously exposed cross-tenant.

4.4 **Minimisation.** No bulk PII export, no logging of PII content, no
transmission to any third party or model. The probe reads minimum rows; the
HTTP smoke reads one endpoint, one session; the bypass logging captures
`statement_class` (verb), not statement text.

---

## 5. Residency & transfer (re-affirmed from Child-1 §5)

5.1 The live data resides in **`ap-south-1` (Mumbai)**, re-confirmed at the
Postgres level at runbook STEP 0 (existing region assert on `:6543` + `:5432`).

5.2 The **staging clone** used for the pre-ceremony rehearsal is asserted at
runbook STEP 0.5 (CF-CUT-RESIDENCY-1) to be either (a) ap-south-1 OR (b)
synthetic-only (no PROD PII) — inadmissible: non-ap-south-1 clone with PROD
PII (would itself be a §16 transfer).

5.3 **No personal data is transferred outside India during this slice. DPDP
§16 cross-border-transfer restrictions are not engaged.**

---

## 6. Conditions & commitments (Founder attests)

By signing, the Founder attests and commits that:

6.1 The Child-1 §6 attestations (DPA commitment, no-new-purpose, no-transfer-
outside-ap-south-1, no-model-training, credential-rotation commitment,
audit-log erasure-scopability) carry forward unchanged to the four additional
acts in §3 above.

6.2 The bypass granted at runbook STEP 3.5 will be **revoked** when Path B
(legacy retirement) ships (separate Stage-8 slice). The Brain Decision-Log
entries at grant and revoke capture the lifecycle. Pending Path B's date, the
runbook documents the deadline as "Path-B-completion-date" in writing.

6.3 The CF-SEC-1 probe runs **only as the non-bypass `rls_app` role** for its
GREEN to be meaningful. Running the probe as the bypass role is the
inverse-mutant captured at `staging-rehearsal/cf-sec-1-inverse.txt` and is
expressly NOT the gate.

6.4 The STEP-5 real-path smoke is executed with the Founder's own
Sugandh-Lok session cookie; no third-party Data Principal's session is used.

6.5 **Second-brand re-arm tripwire (CF-SEC-3.HARD mechanization).** Post-flip,
the operator runs the grep at runbook STEP 6:
```
SELECT DISTINCT workspace_id FROM bypass_query_log WHERE ts > $CUTOVER_TS;
```
Expected result ⊆ `{$SUGANDH_LOK_WORKSPACE_ID, NULL}`. Any other workspace_id
fires **immediate rollback** (the binding ordering: `down.sql` BEFORE
`NOBYPASSRLS`, per architecture-plan §9 ROLLBACK) AND CF-SEC-3.HARD re-arm
(this addendum is NOT a standing waiver to process a second brand's PII).

6.6 The DPDP §12 erasure-scopability of `bypass_query_log` is preserved by
the workspace_id-keyed structure (`DELETE WHERE workspace_id = $X`); raw
statement text is **not** logged. If a Data Principal exercises §12 erasure,
the bypass log entries that reference that principal's workspace are
scopably deleted.

6.7 This addendum does not, under cover of the §7 transitional basis,
authorise (a) introducing a new processing purpose, (b) disclosing in-scope
PII to any third party, (c) transferring it outside ap-south-1, (d) using it
to train any model, (e) extending the bypass to any role other than
`postgres.<tenant_id>`, or (f) extending the bypass-revoke deadline beyond
Path B completion — without a separate, explicit basis.

---

## 7. Scope limits

This addendum authorises **only** the four acts in §3 (A-D), bounded by the
controls in §3 + the commitments in §6. It does NOT pre-authorise:

- Any post-cutover act not in §3 (separate compliance review required).
- The Path B (legacy retirement) ceremony itself (separate Stage-8 slice; its
  own lawful-basis review).
- Any new collection, new disclosure, or new transfer.
- Any extension of the bypass to a non-named role or a non-Sugandh-Lok
  workspace_id.

It is an interim §7 transitional instrument, not a standing waiver. It is
superseded automatically when (a) the Sugandh Lok DPA from Child-1 §6.2 is
executed AND (b) Path B (legacy retirement) ships.

---

## 8. Signature

**Founder decision (to be recorded verbatim at signing):**
> _"As legal owner and authorized controller of Sugandh Lok — the only brand
> whose data is in the live DB at the time of this cutover — I authorize the
> four transitional acts (A-D) in §3 of this addendum, performed in continuation
> of the Child-1 §7 memo I accepted on 2026-05-24. The bypass granted at
> runbook STEP 3.5 will be revoked at Path B completion; the CF-SEC-3.HARD
> second-brand tripwire and the §12 erasure-scopability of the bypass query
> log preserve the protections relied on by Child-1."_

```
Authorization: FOUNDER DECISION (ownership-based; §7 transitional continuity)
Basis:         Legal owner + authorized controller of Sugandh Lok
               (the in-scope brand)
Bridge-to:     Child-1 §7 memo (ACCEPTED 2026-05-24) + Sugandh Lok DPA
               (Child-1 §6.2, scheduled in chore-security-governance-hardening-phase)
Gate:          CF-CUT-DPDP-ADDENDUM-1 — SATISFIED for Stage-8 STEP 5 execution
Name:          Rishabh Porwal (Founder, Pipada Capital)
Date (UTC):    _____  (set at Stage 7/8 signing, BEFORE Stage-8 STEP 5)
Recorded-by:   orchestrator (per Founder instruction in-session)
Deferred-to:   chore-security-governance-hardening-phase (post-migration);
               Path B (legacy retirement) for bypass-revoke
```
